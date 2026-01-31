import 'dotenv/config';

export const config = {
    server: {
        port: parseInt(process.env.WEB_PORT) || 8080,
        host: process.env.WEB_HOST || '0.0.0.0'
    },
    redis: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD || undefined
    },
    postgres: {
        host: process.env.PG_HOST || '127.0.0.1',
        port: parseInt(process.env.PG_PORT) || 5432,
        database: process.env.PG_DATABASE || 'bitok_pool',
        user: process.env.PG_USER || 'postgres',
        password: process.env.PG_PASSWORD || ''
    },
    pool: {
        name: 'Bitok Pool',
        symbol: 'BITOK',
        algorithm: 'BitokPoW (Yespower)',
        fee: parseFloat(process.env.POOL_FEE) || 1.0,
        stratumHost: process.env.STRATUM_HOST || 'localhost',
        stratumPort: parseInt(process.env.STRATUM_PORT) || 3032,
        blockReward: parseFloat(process.env.BLOCK_REWARD) || 50,
        blockTime: 600,
        pplnsWindow: parseInt(process.env.PPLNS_WINDOW) || 60,
        coinbaseMaturity: 12,
        paymentThreshold: parseFloat(process.env.PAYMENT_THRESHOLD) || 1.0,
        paymentInterval: parseInt(process.env.PAYMENT_INTERVAL) || 3600,
        minDiff: 0.5,
        maxDiff: 16
    },
    explorer: {
        url: 'https://bitokd.run',
        txUrl: 'https://bitokd.run/tx/',
        blockUrl: 'https://bitokd.run/block/',
        addressUrl: 'https://bitokd.run/address/'
    }
};
