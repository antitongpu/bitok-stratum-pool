import { Router } from 'express';
import { config } from '../config.js';
import * as redis from '../db/redis.js';
import * as postgres from '../db/postgres.js';
import { getMinerBalance, calculateImmatureEarnings, calculateBlockEarnings } from '../payments/calculator.js';

const router = Router();

router.get('/stats', async (req, res) => {
    try {
        const stats = await redis.getPoolStats();
        const onlineMiners = await redis.getOnlineMiners();
        const lastPaymentTime = await redis.getLastPaymentTime();

        res.json({
            pool: {
                name: config.pool.name,
                symbol: config.pool.symbol,
                algorithm: config.pool.algorithm,
                fee: config.pool.fee,
                blockReward: config.pool.blockReward,
                blockTime: config.pool.blockTime,
                paymentThreshold: config.pool.paymentThreshold,
                coinbaseMaturity: config.pool.coinbaseMaturity,
                paymentInterval: config.pool.paymentInterval
            },
            stats: {
                hashrate: stats.hashrate,
                miners: onlineMiners.length,
                workers: stats.workers,
                blocksFound: stats.blocksTotal,
                difficulty: stats.difficulty,
                height: stats.height,
                lastBlockTime: stats.lastBlock?.timestamp || null
            },
            payments: {
                lastPaymentTime: lastPaymentTime,
                paymentInterval: config.pool.paymentInterval * 1000,
                nextPaymentTime: lastPaymentTime ? lastPaymentTime + (config.pool.paymentInterval * 1000) : null
            },
            stratum: {
                host: config.pool.stratumHost,
                port: config.pool.stratumPort
            }
        });
    } catch (err) {
        console.error('Error getting stats:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/blocks', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const offset = (page - 1) * limit;

        const [blocks, total] = await Promise.all([
            postgres.getBlocks(limit, offset),
            postgres.getBlocksCount()
        ]);

        res.json({
            blocks: blocks.map(b => ({
                height: b.height,
                hash: b.hash,
                reward: b.reward,
                difficulty: b.difficulty,
                timestamp: b.timestamp,
                confirmed: b.confirmed,
                confirmations: b.confirmations,
                credited: b.credited || false,
                miner: b.miner_address,
                worker: b.worker_name
            })),
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('Error getting blocks:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/payments', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const offset = (page - 1) * limit;

        const [payments, total] = await Promise.all([
            postgres.getPayments(limit, offset),
            postgres.getPaymentsCount()
        ]);

        res.json({
            payments: payments.map(p => ({
                address: p.miner_address,
                amount: p.amount,
                txHash: p.tx_hash,
                timestamp: p.timestamp,
                status: p.status
            })),
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('Error getting payments:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/miners', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const offset = (page - 1) * limit;

        const onlineMiners = await redis.getOnlineMiners();
        const miners = [];

        for (const address of onlineMiners) {
            const [stats, dbMiner] = await Promise.all([
                redis.getMinerStats(address),
                postgres.getMiner(address)
            ]);
            if (stats) {
                miners.push({
                    ...stats,
                    shares: dbMiner?.total_shares || stats.shares || 0
                });
            }
        }

        miners.sort((a, b) => b.hashrate - a.hashrate);
        const total = miners.length;
        const paginatedMiners = miners.slice(offset, offset + limit);

        res.json({
            miners: paginatedMiners,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('Error getting miners:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/miners/:address', async (req, res) => {
    try {
        const { address } = req.params;

        const [stats, workers, payments, dbMiner, balanceData] = await Promise.all([
            redis.getMinerStats(address),
            redis.getMinerWorkers(address),
            postgres.getMinerPayments(address, 25, 0),
            postgres.getMiner(address),
            getMinerBalance(address)
        ]);

        if (!stats && !dbMiner) {
            const immature = await calculateImmatureEarnings(address);
            if (immature === 0) {
                return res.status(404).json({ error: 'Miner not found' });
            }
        }

        res.json({
            address,
            hashrate: stats?.hashrate || 0,
            shares: dbMiner?.total_shares || 0,
            sessionShares: stats?.shares || 0,
            lastShare: stats?.lastShare || 0,
            workers,
            payments: payments.map(p => ({
                amount: p.amount,
                txHash: p.tx_hash,
                timestamp: p.timestamp,
                status: p.status
            })),
            totals: {
                paid: dbMiner?.total_paid || 0,
                blocks: dbMiner?.total_blocks || 0,
                shares: dbMiner?.total_shares || 0
            },
            balance: {
                immature: balanceData.immature,
                pending: balanceData.balance,
                paid: balanceData.paid,
                immatureBitok: balanceData.immature / 100000000,
                pendingBitok: balanceData.balance / 100000000,
                paidBitok: balanceData.paid / 100000000
            }
        });
    } catch (err) {
        console.error('Error getting miner:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/hashrate', async (req, res) => {
    try {
        const hours = Math.min(parseInt(req.query.hours) || 24, 168);
        const history = await redis.getHashrateHistory(hours);

        res.json({ history });
    } catch (err) {
        console.error('Error getting hashrate history:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/miners/:address/balance', async (req, res) => {
    try {
        const { address } = req.params;
        const balanceData = await getMinerBalance(address);

        res.json({
            address,
            immature: balanceData.immature,
            pending: balanceData.balance,
            paid: balanceData.paid,
            immatureBitok: balanceData.immature / 100000000,
            pendingBitok: balanceData.balance / 100000000,
            paidBitok: balanceData.paid / 100000000
        });
    } catch (err) {
        console.error('Error getting miner balance:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/diagnostics', async (req, res) => {
    try {
        const blockStats = await postgres.query(`
            SELECT
                COUNT(*) as total_blocks,
                SUM(CASE WHEN confirmed = true THEN 1 ELSE 0 END) as confirmed_blocks,
                SUM(CASE WHEN confirmed = false AND confirmations >= 0 THEN 1 ELSE 0 END) as immature_blocks,
                SUM(CASE WHEN credited = true THEN 1 ELSE 0 END) as credited_to_balance,
                SUM(CASE WHEN confirmed = true AND (credited = false OR credited IS NULL) THEN 1 ELSE 0 END) as pending_credit,
                SUM(CASE WHEN confirmations = -1 THEN 1 ELSE 0 END) as orphaned_blocks,
                SUM(reward) as total_rewards
            FROM blocks
        `);

        const minerStats = await postgres.query(`
            SELECT
                COUNT(*) as total_miners,
                SUM(balance) as total_pending,
                SUM(immature) as total_immature,
                SUM(total_paid) as total_paid
            FROM miners
        `);

        const confirmedRewards = await postgres.query(`
            SELECT SUM(reward) as sum FROM blocks WHERE confirmed = true
        `);

        const immatureRewards = await postgres.query(`
            SELECT SUM(reward) as sum FROM blocks WHERE confirmed = false AND confirmations >= 0
        `);

        const paymentStats = await postgres.query(`
            SELECT
                COUNT(*) as total_payments,
                SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) as total_paid_amount,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_payments
            FROM payments
        `);

        const bs = blockStats.rows[0];
        const ms = minerStats.rows[0];
        const ps = paymentStats.rows[0];

        const totalPending = parseInt(ms.total_pending) || 0;
        const totalImmature = parseInt(ms.total_immature) || 0;
        const totalPaid = parseInt(ms.total_paid) || 0;
        const confirmedRewardSum = parseInt(confirmedRewards.rows[0].sum) || 0;
        const immatureRewardSum = parseInt(immatureRewards.rows[0].sum) || 0;
        const poolFee = config.pool.fee / 100;
        const expectedConfirmedToMiners = Math.floor(confirmedRewardSum * (1 - poolFee));
        const expectedImmatureToMiners = Math.floor(immatureRewardSum * (1 - poolFee));

        res.json({
            blocks: {
                total: parseInt(bs.total_blocks) || 0,
                confirmed: parseInt(bs.confirmed_blocks) || 0,
                immature: parseInt(bs.immature_blocks) || 0,
                creditedToBalance: parseInt(bs.credited_to_balance) || 0,
                pendingCredit: parseInt(bs.pending_credit) || 0,
                orphaned: parseInt(bs.orphaned_blocks) || 0,
                totalRewardsSatoshi: parseInt(bs.total_rewards) || 0,
                totalRewardsBitok: (parseInt(bs.total_rewards) || 0) / 100000000
            },
            miners: {
                count: parseInt(ms.total_miners) || 0,
                totalPendingSatoshi: totalPending,
                totalPendingBitok: totalPending / 100000000,
                totalImmatureSatoshi: totalImmature,
                totalImmatureBitok: totalImmature / 100000000,
                totalPaidSatoshi: totalPaid,
                totalPaidBitok: totalPaid / 100000000
            },
            payments: {
                count: parseInt(ps.total_payments) || 0,
                totalPaidSatoshi: parseInt(ps.total_paid_amount) || 0,
                totalPaidBitok: (parseInt(ps.total_paid_amount) || 0) / 100000000,
                failedCount: parseInt(ps.failed_payments) || 0
            },
            verification: {
                confirmedBlockRewardsBitok: confirmedRewardSum / 100000000,
                expectedToMinersBitok: expectedConfirmedToMiners / 100000000,
                actualPaidPlusPendingBitok: (totalPaid + totalPending) / 100000000,
                immatureBlockRewardsBitok: immatureRewardSum / 100000000,
                expectedImmatureBitok: expectedImmatureToMiners / 100000000,
                actualImmatureBitok: totalImmature / 100000000,
                discrepancyBitok: (expectedConfirmedToMiners - totalPaid - totalPending) / 100000000
            },
            poolFeePercent: config.pool.fee
        });
    } catch (err) {
        console.error('Error getting diagnostics:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/reconciliation', async (req, res) => {
    try {
        const creditedBlocks = await postgres.query(
            `SELECT * FROM blocks WHERE confirmed = true AND credited = true ORDER BY height ASC`
        );

        const expectedEarningsByMiner = new Map();

        for (const block of creditedBlocks.rows) {
            const earnings = await calculateBlockEarnings(block);
            for (const [address, amount] of earnings) {
                const current = expectedEarningsByMiner.get(address) || 0;
                expectedEarningsByMiner.set(address, current + amount);
            }
        }

        const miners = await postgres.query(
            `SELECT address, balance, total_paid, immature FROM miners ORDER BY total_paid DESC`
        );

        const reconciliation = [];
        let totalExpected = 0;
        let totalActual = 0;
        let totalDiscrepancy = 0;

        for (const miner of miners.rows) {
            const expected = expectedEarningsByMiner.get(miner.address) || 0;
            const actualCredited = (parseInt(miner.balance) || 0) + (parseInt(miner.total_paid) || 0);
            const discrepancy = actualCredited - expected;

            totalExpected += expected;
            totalActual += actualCredited;
            totalDiscrepancy += discrepancy;

            if (discrepancy !== 0 || actualCredited > 0) {
                reconciliation.push({
                    address: miner.address,
                    expectedSatoshi: expected,
                    expectedBitok: expected / 100000000,
                    actualCreditedSatoshi: actualCredited,
                    actualCreditedBitok: actualCredited / 100000000,
                    balanceSatoshi: parseInt(miner.balance) || 0,
                    balanceBitok: (parseInt(miner.balance) || 0) / 100000000,
                    paidSatoshi: parseInt(miner.total_paid) || 0,
                    paidBitok: (parseInt(miner.total_paid) || 0) / 100000000,
                    discrepancySatoshi: discrepancy,
                    discrepancyBitok: discrepancy / 100000000
                });
            }

            expectedEarningsByMiner.delete(miner.address);
        }

        for (const [address, expected] of expectedEarningsByMiner) {
            totalExpected += expected;
            reconciliation.push({
                address,
                expectedSatoshi: expected,
                expectedBitok: expected / 100000000,
                actualCreditedSatoshi: 0,
                actualCreditedBitok: 0,
                balanceSatoshi: 0,
                balanceBitok: 0,
                paidSatoshi: 0,
                paidBitok: 0,
                discrepancySatoshi: -expected,
                discrepancyBitok: -expected / 100000000
            });
        }

        reconciliation.sort((a, b) => Math.abs(b.discrepancySatoshi) - Math.abs(a.discrepancySatoshi));

        res.json({
            summary: {
                creditedBlocks: creditedBlocks.rows.length,
                totalExpectedSatoshi: totalExpected,
                totalExpectedBitok: totalExpected / 100000000,
                totalActualCreditedSatoshi: totalActual,
                totalActualCreditedBitok: totalActual / 100000000,
                totalDiscrepancySatoshi: totalDiscrepancy,
                totalDiscrepancyBitok: totalDiscrepancy / 100000000,
                overPaymentBitok: totalDiscrepancy > 0 ? totalDiscrepancy / 100000000 : 0
            },
            miners: reconciliation
        });
    } catch (err) {
        console.error('Error getting reconciliation:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
