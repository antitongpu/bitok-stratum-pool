import * as postgres from '../db/postgres.js';
import { config } from '../config.js';

export async function calculateSharesForBlock(block) {
    const pplnsWindow = config.pool.pplnsWindow || 30;
    const shares = await postgres.query(
        `SELECT miner_address, SUM(difficulty) as total_difficulty
         FROM shares
         WHERE timestamp >= $1::timestamp - INTERVAL '${pplnsWindow} minutes'
         AND timestamp <= $1::timestamp + INTERVAL '5 minutes'
         GROUP BY miner_address`,
        [block.timestamp]
    );
    return shares.rows;
}

export async function calculateBlockEarnings(block) {
    const blockReward = block.reward;
    const poolFeePercent = config.pool.fee;
    const poolFee = Math.floor(blockReward * (poolFeePercent / 100));
    const minerReward = blockReward - poolFee;

    const shares = await calculateSharesForBlock(block);
    const earnings = new Map();

    if (shares.length === 0) {
        if (block.miner_address) {
            earnings.set(block.miner_address, minerReward);
        }
        return earnings;
    }

    const totalDifficulty = shares.reduce((sum, s) => sum + parseFloat(s.total_difficulty), 0);

    for (const share of shares) {
        const minerDifficulty = parseFloat(share.total_difficulty);
        const minerShare = Math.floor((minerDifficulty / totalDifficulty) * minerReward);
        if (minerShare > 0) {
            earnings.set(share.miner_address, minerShare);
        }
    }

    return earnings;
}

export async function calculateImmatureEarnings(address) {
    const unconfirmedBlocks = await postgres.query(
        `SELECT * FROM blocks WHERE confirmed = false ORDER BY height ASC`
    );

    let immature = 0;

    for (const block of unconfirmedBlocks.rows) {
        const earnings = await calculateBlockEarnings(block);
        if (earnings.has(address)) {
            immature += earnings.get(address);
        }
    }

    return immature;
}

export async function calculateAllImmatureEarnings() {
    const unconfirmedBlocks = await postgres.query(
        `SELECT * FROM blocks WHERE confirmed = false ORDER BY height ASC`
    );

    const immatureByMiner = new Map();

    for (const block of unconfirmedBlocks.rows) {
        const earnings = await calculateBlockEarnings(block);
        for (const [address, amount] of earnings) {
            const current = immatureByMiner.get(address) || 0;
            immatureByMiner.set(address, current + amount);
        }
    }

    return immatureByMiner;
}

export async function updateAllImmatureBalances() {
    const immatureByMiner = await calculateAllImmatureEarnings();

    await postgres.query(`UPDATE miners SET immature = 0`);

    for (const [address, amount] of immatureByMiner) {
        await postgres.query(
            `INSERT INTO miners (address, immature)
             VALUES ($1, $2)
             ON CONFLICT (address)
             DO UPDATE SET immature = $2`,
            [address, amount]
        );
    }

    return immatureByMiner.size;
}

export async function creditConfirmedBlockEarnings() {
    console.log('creditConfirmedBlockEarnings: Starting...');

    return await postgres.withTransaction(async (client) => {
        const confirmedBlocks = await client.query(
            `SELECT * FROM blocks
             WHERE confirmed = true AND (credited = false OR credited IS NULL)
             ORDER BY height ASC
             FOR UPDATE SKIP LOCKED`
        );

        console.log(`Found ${confirmedBlocks.rows.length} confirmed uncredited blocks`);

        if (confirmedBlocks.rows.length === 0) {
            return { blocksProcessed: 0, minersCredited: 0 };
        }

        const totalCredits = new Map();
        const processedBlocks = [];

        for (const block of confirmedBlocks.rows) {
            console.log(`Processing block ${block.height} for balance credits`);
            const earnings = await calculateBlockEarnings(block);

            for (const [address, amount] of earnings) {
                const current = totalCredits.get(address) || 0;
                totalCredits.set(address, current + amount);
            }

            processedBlocks.push(block.height);
        }

        for (const height of processedBlocks) {
            await client.query(
                `UPDATE blocks SET credited = true WHERE height = $1`,
                [height]
            );
        }

        for (const [address, amount] of totalCredits) {
            await client.query(
                `INSERT INTO miners (address, balance)
                 VALUES ($1, $2)
                 ON CONFLICT (address)
                 DO UPDATE SET balance = miners.balance + $2`,
                [address, amount]
            );
            console.log(`  Credited ${amount / 100000000} BITOK to ${address}`);
        }

        return {
            blocksProcessed: confirmedBlocks.rows.length,
            minersCredited: totalCredits.size
        };
    });
}

export async function calculatePayouts() {
    console.log('calculatePayouts: Starting...');

    await creditConfirmedBlockEarnings();

    const paymentThreshold = config.pool.paymentThreshold * 100000000;

    const minersAboveThreshold = await postgres.query(
        `SELECT address, balance FROM miners WHERE balance >= $1 ORDER BY balance DESC`,
        [paymentThreshold]
    );

    console.log(`Payment threshold: ${config.pool.paymentThreshold} BITOK (${paymentThreshold} satoshi)`);
    console.log(`Miners meeting threshold: ${minersAboveThreshold.rows.length}`);

    const payouts = minersAboveThreshold.rows.map(miner => ({
        address: miner.address,
        amount: parseInt(miner.balance)
    }));

    for (const payout of payouts) {
        const amountBitok = payout.amount / 100000000;
        console.log(`  ${payout.address}: ${amountBitok.toFixed(8)} BITOK`);
    }

    return payouts;
}

export async function deductFromBalance(address, amount) {
    await postgres.query(
        `UPDATE miners SET balance = balance - $1 WHERE address = $2`,
        [amount, address]
    );
}

export async function markBlocksPaid(blockHeights) {
    if (!blockHeights || blockHeights.length === 0) return;

    await postgres.query(
        `UPDATE blocks SET credited = true WHERE height = ANY($1)`,
        [blockHeights]
    );
}

export async function getMinerBalance(address) {
    const result = await postgres.query(
        `SELECT balance, immature, total_paid FROM miners WHERE address = $1`,
        [address]
    );

    if (!result.rows[0]) {
        const immature = await calculateImmatureEarnings(address);
        return {
            address,
            balance: 0,
            immature,
            paid: 0
        };
    }

    const miner = result.rows[0];
    let immature = parseInt(miner.immature) || 0;

    if (immature === 0) {
        const unconfirmedCount = await postgres.query(
            `SELECT COUNT(*) FROM blocks WHERE confirmed = false AND confirmations >= 0`
        );
        if (parseInt(unconfirmedCount.rows[0].count) > 0) {
            immature = await calculateImmatureEarnings(address);
        }
    }

    return {
        address,
        balance: parseInt(miner.balance) || 0,
        immature,
        paid: parseInt(miner.total_paid) || 0
    };
}

export async function calculateMinerBalance(address) {
    return getMinerBalance(address);
}
