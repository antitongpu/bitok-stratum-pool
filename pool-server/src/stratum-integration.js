import * as redis from './db/redis.js';
import * as postgres from './db/postgres.js';
import { config } from './config.js';
import { updateAllImmatureBalances, creditConfirmedBlockEarnings } from './payments/calculator.js';

let poolInstance = null;
let statsInterval = null;

export async function getStoredVarDiff(workerName) {
    const [address] = (workerName || '').split('.');
    const worker = workerName?.includes('.') ? workerName.split('.').slice(1).join('.') : 'default';
    if (!address) return null;
    return await redis.getMinerVarDiff(address, worker);
}

export function getVarDiffLimits() {
    return {
        minDiff: config.pool.minDiff,
        maxDiff: config.pool.maxDiff
    };
}

export function attachToPool(pool) {
    poolInstance = pool;

    pool.on('share', async (isValidShare, isValidBlock, data) => {
        try {
            if (isValidShare && data.worker) {
                const [address] = data.worker.split('.');
                const workerName = data.worker.includes('.') ? data.worker.split('.').slice(1).join('.') : 'default';
                let difficulty = data.difficulty || 1;

                if (difficulty > config.pool.maxDiff) {
                    console.warn(`[WARN] Share difficulty ${difficulty} exceeds maxDiff ${config.pool.maxDiff} for ${address}, capping`);
                    difficulty = config.pool.maxDiff;
                }
                if (difficulty < config.pool.minDiff) {
                    difficulty = config.pool.minDiff;
                }

                await redis.recordShare(address, workerName, difficulty);
                await postgres.updateMiner(address, { shares: 1 });

                postgres.addShareBuffered({
                    minerAddress: address,
                    workerName: workerName,
                    difficulty: difficulty,
                    ipAddress: data.ip || null,
                    isValid: true
                });
            }

            if (isValidBlock && data.blockHash) {
                const [address] = (data.worker || '').split('.');
                const workerName = data.worker?.includes('.') ? data.worker.split('.').slice(1).join('.') : 'default';

                const block = {
                    height: data.height,
                    hash: data.blockHash,
                    reward: data.reward || config.pool.blockReward * 100000000,
                    difficulty: data.blockDiffActual || data.difficulty || 0,
                    minerAddress: address || null,
                    workerName: workerName,
                    confirmed: false
                };

                await postgres.flushShareBuffer();
                await postgres.addBlock(block);

                const blocksTotal = await postgres.getBlocksCount();
                await redis.setPoolStats({
                    blocksTotal,
                    lastBlock: {
                        height: data.height,
                        hash: data.blockHash,
                        timestamp: Date.now()
                    }
                });

                console.log('Block recorded:', data.height, data.blockHash);

                setTimeout(async () => {
                    try {
                        const updated = await updateAllImmatureBalances();
                        console.log(`Immature balances updated for ${updated} miners after block ${data.height}`);
                    } catch (err) {
                        console.error('Error updating immature balances after block:', err.message);
                    }
                }, 1000);
            }
        } catch (err) {
            console.error('Error processing share/block:', err);
        }
    });

    pool.on('started', () => {
        startStatsCollection();
    });

    pool.on('difficultyUpdate', async (workerName, newDiff) => {
        try {
            const [address] = (workerName || '').split('.');
            const worker = workerName?.includes('.') ? workerName.split('.').slice(1).join('.') : 'default';
            if (address) {
                const safeDiff = await redis.setMinerVarDiff(
                    address,
                    worker,
                    newDiff,
                    config.pool.minDiff,
                    config.pool.maxDiff
                );
                if (safeDiff !== newDiff) {
                    console.log(`[VARDIFF] ${workerName}: ${newDiff} -> capped to ${safeDiff}`);
                }
            }
        } catch (err) {
            console.error('Error persisting vardiff:', err.message);
        }
    });

    return pool;
}

async function startStatsCollection() {
    if (statsInterval) clearInterval(statsInterval);

    const collectStats = async () => {
        try {
            const onlineMiners = await redis.getOnlineMiners();
            let totalHashrate = 0;
            let totalWorkers = 0;

            for (const address of onlineMiners) {
                const minerStats = await redis.getMinerStats(address);
                if (minerStats) {
                    totalHashrate += minerStats.hashrate || 0;
                }
                const workers = await redis.getMinerWorkers(address);
                totalWorkers += workers.length;
            }

            await redis.setPoolStats({
                hashrate: totalHashrate,
                workers: totalWorkers
            });

            await redis.recordHashrate(totalHashrate);

            if (poolInstance && poolInstance.jobManager && poolInstance.jobManager.currentJob) {
                await redis.setPoolStats({
                    height: (poolInstance.jobManager.currentJob.rpcData.height - 1) || 0,
                    difficulty: poolInstance.jobManager.currentJob.difficulty || 0
                });
            }

        } catch (err) {
            console.error('Error collecting stats:', err);
        }
    };

    await collectStats();
    statsInterval = setInterval(collectStats, 10000);
}

export async function updateBlockConfirmations(daemon) {
    try {
        const blocks = await postgres.getBlocks(100, 0);
        const pendingBlocks = blocks.filter(b => !b.confirmed);

        if (pendingBlocks.length === 0) return;

        console.log(`  Checking confirmations for ${pendingBlocks.length} pending block(s)...`);

        daemon.cmd('getblockcount', [], async (countResults) => {
            if (!countResults || !countResults[0] || countResults[0].error) {
                console.error('  Failed to get block count:', countResults?.[0]?.error);
                return;
            }

            const currentHeight = countResults[0].response;

            for (const block of pendingBlocks) {
                daemon.cmd('getblock', [block.hash], async (results) => {
                    if (results && results[0]) {
                        const result = results[0];

                        if (result.error) {
                            if (result.error.code === -5) {
                                console.log(`  Block ${block.height}: orphaned (not in chain)`);
                                await postgres.updateBlockConfirmations(block.hash, -1, false);
                            } else {
                                console.error(`  Block ${block.height} RPC error:`, result.error);
                            }
                            return;
                        }

                        if (result.response) {
                            const resp = result.response;
                            const blockHeight = resp.height ?? block.height;
                            const confirmations = currentHeight - blockHeight + 1;
                            const confirmed = confirmations >= config.pool.coinbaseMaturity;
                            const wasConfirmed = block.confirmed;

                            await postgres.updateBlockConfirmations(block.hash, confirmations, confirmed);
                            console.log(`  Block ${block.height}: ${confirmations}/${config.pool.coinbaseMaturity} confirmations${confirmed ? ' (CONFIRMED)' : ''}`);

                            if (confirmed && !wasConfirmed) {
                                try {
                                    const credited = await creditConfirmedBlockEarnings();
                                    if (credited.blocksProcessed > 0) {
                                        console.log(`  [PENDING] Credited ${credited.blocksProcessed} confirmed block(s) to ${credited.minersCredited} miner(s)`);
                                    }
                                    await updateAllImmatureBalances();
                                } catch (err) {
                                    console.error('  [ERROR] Failed to credit confirmed block earnings:', err.message);
                                }
                            }
                        }
                    }
                });
            }
        });
    } catch (err) {
        console.error('Error updating block confirmations:', err);
    }
}
