import Redis from 'ioredis';
import { config } from '../config.js';

const redis = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    retryStrategy: (times) => Math.min(times * 50, 2000)
});

redis.on('error', (err) => {
    console.error('Redis error:', err.message);
});

redis.on('connect', () => {
    console.log('Connected to Redis');
});

const KEYS = {
    POOL_HASHRATE: 'pool:hashrate',
    POOL_MINERS: 'pool:miners',
    POOL_WORKERS: 'pool:workers',
    POOL_BLOCKS: 'pool:blocks:total',
    POOL_LAST_BLOCK: 'pool:lastblock',
    POOL_DIFFICULTY: 'pool:difficulty',
    POOL_HEIGHT: 'pool:height',
    POOL_LAST_PAYMENT: 'pool:lastpayment',
    MINER_PREFIX: 'miner:',
    WORKER_PREFIX: 'worker:',
    SHARES_PREFIX: 'shares:',
    HASHRATE_HISTORY: 'pool:hashrate:history',
    ONLINE_MINERS: 'pool:miners:online',
    ONLINE_WORKERS: 'pool:workers:online',
    VARDIFF_PREFIX: 'vardiff:'
};

export async function getPoolStats() {
    const tenMinutesAgo = Date.now() - 600000;
    const [hashrate, minersCount, workersCount, blocksTotal, lastBlock, difficulty, height] = await Promise.all([
        redis.get(KEYS.POOL_HASHRATE),
        redis.zcount(KEYS.ONLINE_MINERS, tenMinutesAgo, '+inf'),
        redis.get(KEYS.POOL_WORKERS),
        redis.get(KEYS.POOL_BLOCKS),
        redis.get(KEYS.POOL_LAST_BLOCK),
        redis.get(KEYS.POOL_DIFFICULTY),
        redis.get(KEYS.POOL_HEIGHT)
    ]);

    return {
        hashrate: parseFloat(hashrate) || 0,
        miners: parseInt(minersCount) || 0,
        workers: parseInt(workersCount) || 0,
        blocksTotal: parseInt(blocksTotal) || 0,
        lastBlock: lastBlock ? JSON.parse(lastBlock) : null,
        difficulty: parseFloat(difficulty) || 0,
        height: parseInt(height) || 0
    };
}

export async function setPoolStats(stats) {
    const multi = redis.multi();
    if (stats.hashrate !== undefined) multi.set(KEYS.POOL_HASHRATE, stats.hashrate);
    if (stats.workers !== undefined) multi.set(KEYS.POOL_WORKERS, stats.workers);
    if (stats.blocksTotal !== undefined) multi.set(KEYS.POOL_BLOCKS, stats.blocksTotal);
    if (stats.difficulty !== undefined) multi.set(KEYS.POOL_DIFFICULTY, stats.difficulty);
    if (stats.height !== undefined) multi.set(KEYS.POOL_HEIGHT, stats.height);
    if (stats.lastBlock !== undefined) multi.set(KEYS.POOL_LAST_BLOCK, JSON.stringify(stats.lastBlock));
    await multi.exec();
}

export async function recordShare(minerAddress, workerName, difficulty) {
    const now = Date.now();
    const minerKey = `${KEYS.MINER_PREFIX}${minerAddress}`;
    const workerKey = `${KEYS.WORKER_PREFIX}${minerAddress}:${workerName}`;
    const sharesKey = `${KEYS.SHARES_PREFIX}${minerAddress}`;

    const multi = redis.multi();
    multi.zadd(KEYS.ONLINE_MINERS, now, minerAddress);
    multi.zremrangebyscore(KEYS.ONLINE_MINERS, 0, now - 86400000);
    multi.hset(minerKey, 'lastShare', now, 'address', minerAddress);
    multi.hincrby(minerKey, 'shares', 1);
    multi.hincrbyfloat(minerKey, 'difficulty', difficulty);
    multi.expire(minerKey, 86400);
    multi.hset(workerKey, 'lastShare', now, 'worker', workerName);
    multi.hincrby(workerKey, 'shares', 1);
    multi.hincrbyfloat(workerKey, 'difficulty', difficulty);
    multi.expire(workerKey, 86400);
    multi.zadd(sharesKey, now, `${now}:${difficulty}`);
    multi.zremrangebyscore(sharesKey, 0, now - 3600000);

    const workerSharesKey = `${KEYS.SHARES_PREFIX}${minerAddress}:${workerName}`;
    multi.zadd(workerSharesKey, now, `${now}:${difficulty}`);
    multi.zremrangebyscore(workerSharesKey, 0, now - 3600000);

    await multi.exec();
}

export async function getMinerStats(address) {
    const minerKey = `${KEYS.MINER_PREFIX}${address}`;
    const sharesKey = `${KEYS.SHARES_PREFIX}${address}`;

    const [minerData, recentShares] = await Promise.all([
        redis.hgetall(minerKey),
        redis.zrangebyscore(sharesKey, Date.now() - 3600000, '+inf')
    ]);

    if (!minerData || Object.keys(minerData).length === 0) {
        return null;
    }

    let hashrate = 0;
    if (recentShares.length > 0) {
        const now = Date.now();
        let oldestShare = now;
        for (const share of recentShares) {
            const [timestamp] = share.split(':');
            const ts = parseInt(timestamp);
            if (ts < oldestShare) oldestShare = ts;
        }
        const timeWindow = Math.max((now - oldestShare) / 1000, 60);
        const normalizedDiff = recentShares.length * config.pool.minDiff;
        hashrate = (normalizedDiff * Math.pow(2, 16)) / timeWindow;
    }

    return {
        address: minerData.address,
        hashrate,
        shares: parseInt(minerData.shares) || 0,
        lastShare: parseInt(minerData.lastShare) || 0
    };
}

export async function getMinerWorkers(address) {
    const pattern = `${KEYS.WORKER_PREFIX}${address}:*`;
    const keys = await redis.keys(pattern);

    const workers = [];
    for (const key of keys) {
        const data = await redis.hgetall(key);
        if (data && data.worker) {
            const workerSharesKey = `${KEYS.SHARES_PREFIX}${address}:${data.worker}`;
            let recentShares = await redis.zrangebyscore(workerSharesKey, Date.now() - 3600000, '+inf');

            if (recentShares.length === 0) {
                const minerSharesKey = `${KEYS.SHARES_PREFIX}${address}`;
                recentShares = await redis.zrangebyscore(minerSharesKey, Date.now() - 3600000, '+inf');
            }

            let hashrate = 0;
            if (recentShares.length > 0) {
                const now = Date.now();
                let oldestShare = now;
                for (const share of recentShares) {
                    const [timestamp] = share.split(':');
                    const ts = parseInt(timestamp);
                    if (ts < oldestShare) oldestShare = ts;
                }
                const timeWindow = Math.max((now - oldestShare) / 1000, 60);
                const normalizedDiff = recentShares.length * config.pool.minDiff;
                hashrate = (normalizedDiff * Math.pow(2, 16)) / timeWindow;
            }

            workers.push({
                name: data.worker,
                hashrate,
                shares: parseInt(data.shares) || 0,
                lastShare: parseInt(data.lastShare) || 0
            });
        }
    }

    return workers;
}

export async function getOnlineMiners() {
    const tenMinutesAgo = Date.now() - 600000;
    return await redis.zrangebyscore(KEYS.ONLINE_MINERS, tenMinutesAgo, '+inf');
}

export async function recordHashrate(hashrate) {
    const timestamp = Math.floor(Date.now() / 1000);
    await redis.zadd(KEYS.HASHRATE_HISTORY, timestamp, `${timestamp}:${hashrate}`);
    await redis.zremrangebyscore(KEYS.HASHRATE_HISTORY, 0, timestamp - 86400);
}

export async function getHashrateHistory(hours = 24) {
    const since = Math.floor(Date.now() / 1000) - (hours * 3600);
    const data = await redis.zrangebyscore(KEYS.HASHRATE_HISTORY, since, '+inf');

    return data.map(entry => {
        const [timestamp, hashrate] = entry.split(':');
        return { timestamp: parseInt(timestamp), hashrate: parseFloat(hashrate) };
    });
}

export async function setLastPaymentTime(timestamp) {
    await redis.set(KEYS.POOL_LAST_PAYMENT, timestamp);
}

export async function getLastPaymentTime() {
    const lastPayment = await redis.get(KEYS.POOL_LAST_PAYMENT);
    return lastPayment ? parseInt(lastPayment) : null;
}

export async function setMinerVarDiff(minerAddress, workerName, difficulty, minDiff, maxDiff) {
    const key = `${KEYS.VARDIFF_PREFIX}${minerAddress}:${workerName}`;
    const safeDiff = Math.max(minDiff, Math.min(maxDiff, difficulty));
    await redis.hset(key, 'difficulty', safeDiff, 'updated', Date.now());
    await redis.expire(key, 86400);
    return safeDiff;
}

export async function getMinerVarDiff(minerAddress, workerName) {
    const key = `${KEYS.VARDIFF_PREFIX}${minerAddress}:${workerName}`;
    const data = await redis.hgetall(key);
    if (data && data.difficulty) {
        return parseFloat(data.difficulty);
    }
    return null;
}

export async function clearAllVarDiff() {
    const keys = await redis.keys(`${KEYS.VARDIFF_PREFIX}*`);
    if (keys.length > 0) {
        await redis.del(...keys);
    }
    return keys.length;
}

export async function syncFromPostgreSQL(postgresModule) {
    try {
        console.log('Checking Redis cache status...');

        const blocksTotal = await redis.get(KEYS.POOL_BLOCKS);

        if (blocksTotal !== null && blocksTotal !== '0') {
            console.log('Redis cache is populated, skipping sync');
            return;
        }

        console.log('Redis cache is empty, syncing from PostgreSQL...');

        const totalBlocks = await postgresModule.getBlocksCount();
        console.log(`Found ${totalBlocks} blocks in PostgreSQL`);

        if (totalBlocks === 0) {
            console.log('No blocks in PostgreSQL, initialization complete');
            await redis.set(KEYS.POOL_BLOCKS, 0);
            return;
        }

        const recentBlocks = await postgresModule.getBlocks(1, 0);
        let lastBlockData = null;

        if (recentBlocks.length > 0) {
            const lastBlock = recentBlocks[0];
            lastBlockData = {
                height: lastBlock.height,
                hash: lastBlock.hash,
                timestamp: new Date(lastBlock.timestamp).getTime()
            };
            console.log(`Last block: #${lastBlock.height} (${lastBlock.hash})`);
        }

        const lastPaymentResult = await postgresModule.query(
            `SELECT MAX(timestamp) as last_payment FROM payments WHERE status = 'paid'`
        );

        let lastPaymentTime = null;
        if (lastPaymentResult.rows.length > 0 && lastPaymentResult.rows[0].last_payment) {
            lastPaymentTime = new Date(lastPaymentResult.rows[0].last_payment).getTime();
            console.log(`Last payment: ${new Date(lastPaymentTime).toISOString()}`);
        }

        await setPoolStats({
            blocksTotal: totalBlocks,
            lastBlock: lastBlockData,
            hashrate: 0,
            workers: 0,
            difficulty: 0,
            height: lastBlockData ? lastBlockData.height : 0
        });

        if (lastPaymentTime) {
            await setLastPaymentTime(lastPaymentTime);
        }

        console.log('Redis cache synced successfully from PostgreSQL');
    } catch (err) {
        console.error('Error syncing Redis from PostgreSQL:', err);
        throw err;
    }
}

export { redis, KEYS };
