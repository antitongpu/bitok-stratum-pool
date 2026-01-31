import pg from 'pg';
import { config } from '../config.js';

const pool = new pg.Pool({
    host: config.postgres.host,
    port: config.postgres.port,
    database: config.postgres.database,
    user: config.postgres.user,
    password: config.postgres.password,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
    console.error('PostgreSQL pool error:', err);
});

export async function query(text, params) {
    const start = Date.now();
    try {
        const result = await pool.query(text, params);
        const duration = Date.now() - start;
        if (duration > 100) {
            console.log('Slow query:', { text, duration, rows: result.rowCount });
        }
        return result;
    } catch (err) {
        console.error('Query error:', err);
        throw err;
    }
}

export async function getClient() {
    const client = await pool.connect();
    return client;
}

export async function withTransaction(callback) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

export async function getBlocks(limit = 50, offset = 0) {
    const result = await query(
        `SELECT * FROM blocks ORDER BY height DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
    );
    return result.rows;
}

export async function getBlocksCount() {
    const result = await query(`SELECT COUNT(*) FROM blocks`);
    return parseInt(result.rows[0].count);
}

export async function addBlock(block) {
    const result = await query(
        `INSERT INTO blocks (height, hash, reward, difficulty, miner_address, worker_name, confirmed)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (hash) DO NOTHING
         RETURNING *`,
        [block.height, block.hash, block.reward, block.difficulty, block.minerAddress, block.workerName, block.confirmed]
    );
    return result.rows[0];
}

export async function updateBlockConfirmations(hash, confirmations, confirmed) {
    await query(
        `UPDATE blocks SET confirmations = $1, confirmed = $2 WHERE hash = $3`,
        [confirmations, confirmed, hash]
    );
}

export async function getPayments(limit = 50, offset = 0) {
    const result = await query(
        `SELECT * FROM payments ORDER BY timestamp DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
    );
    return result.rows;
}

export async function getPaymentsCount() {
    const result = await query(`SELECT COUNT(*) FROM payments`);
    return parseInt(result.rows[0].count);
}

export async function getMinerPayments(address, limit = 50, offset = 0) {
    const result = await query(
        `SELECT * FROM payments WHERE miner_address = $1 ORDER BY timestamp DESC LIMIT $2 OFFSET $3`,
        [address, limit, offset]
    );
    return result.rows;
}

export async function addPayment(payment) {
    const result = await query(
        `INSERT INTO payments (miner_address, amount, tx_hash, status)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [payment.address, payment.amount, payment.txHash, payment.status || 'pending']
    );
    return result.rows[0];
}

export async function getMiner(address) {
    const result = await query(
        `SELECT * FROM miners WHERE address = $1`,
        [address]
    );
    return result.rows[0];
}

export async function updateMiner(address, updates) {
    await query(
        `INSERT INTO miners (address, last_seen, total_shares)
         VALUES ($1, NOW(), $2)
         ON CONFLICT (address)
         DO UPDATE SET last_seen = NOW(), total_shares = miners.total_shares + $2`,
        [address, updates.shares || 0]
    );
}

export async function getTopMiners(limit = 10) {
    const result = await query(
        `SELECT * FROM miners ORDER BY total_shares DESC LIMIT $1`,
        [limit]
    );
    return result.rows;
}

export async function savePoolStats(stats) {
    await query(
        `INSERT INTO pool_stats (hashrate, miners, workers, blocks_found, difficulty)
         VALUES ($1, $2, $3, $4, $5)`,
        [stats.hashrate, stats.miners, stats.workers, stats.blocksFound, stats.difficulty]
    );
}

export async function getPoolStatsHistory(hours = 24) {
    const result = await query(
        `SELECT * FROM pool_stats
         WHERE timestamp > NOW() - INTERVAL '${hours} hours'
         ORDER BY timestamp ASC`
    );
    return result.rows;
}

export async function cleanupOldShares(days = 7) {
    const result = await query(
        `DELETE FROM shares WHERE timestamp < NOW() - INTERVAL '${days} days' RETURNING id`
    );
    return result.rowCount;
}

export async function addShare(share) {
    await query(
        `INSERT INTO shares (miner_address, worker_name, difficulty, ip_address, is_valid)
         VALUES ($1, $2, $3, $4, $5)`,
        [share.minerAddress, share.workerName, share.difficulty, share.ipAddress || null, share.isValid !== false]
    );
}

const shareBuffer = [];
let flushTimeout = null;

export async function addShareBuffered(share) {
    shareBuffer.push(share);
    if (shareBuffer.length >= 50) {
        await flushShareBuffer();
    } else if (!flushTimeout) {
        flushTimeout = setTimeout(flushShareBuffer, 5000);
    }
}

export async function flushShareBuffer() {
    if (flushTimeout) {
        clearTimeout(flushTimeout);
        flushTimeout = null;
    }
    if (shareBuffer.length === 0) return;

    const shares = shareBuffer.splice(0, shareBuffer.length);
    const values = [];
    const params = [];
    let paramIndex = 1;

    for (const share of shares) {
        values.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4})`);
        params.push(share.minerAddress, share.workerName, share.difficulty, share.ipAddress || null, share.isValid !== false);
        paramIndex += 5;
    }

    try {
        await query(
            `INSERT INTO shares (miner_address, worker_name, difficulty, ip_address, is_valid)
             VALUES ${values.join(', ')}`,
            params
        );
    } catch (err) {
        console.error('Error flushing share buffer:', err);
    }
}

export async function getMinerShareStats(address) {
    const result = await query(
        `SELECT
            COUNT(*) as total_shares,
            COALESCE(SUM(difficulty), 0) as total_difficulty,
            MAX(timestamp) as last_share
         FROM shares
         WHERE miner_address = $1 AND timestamp > NOW() - INTERVAL '24 hours'`,
        [address]
    );
    return result.rows[0];
}

export async function getMinerTotalShares(address) {
    const result = await query(
        `SELECT total_shares FROM miners WHERE address = $1`,
        [address]
    );
    return result.rows[0]?.total_shares || 0;
}

export async function cleanupOldPoolStats(days = 30) {
    const result = await query(
        `DELETE FROM pool_stats WHERE timestamp < NOW() - INTERVAL '${days} days' RETURNING id`
    );
    return result.rowCount;
}

export { pool };
