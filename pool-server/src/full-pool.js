import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express from 'express';
import { createRequire } from 'module';
import crypto from 'crypto';

import { config } from './config.js';
import apiRoutes from './api/routes.js';
import { attachToPool, updateBlockConfirmations, getStoredVarDiff, getVarDiffLimits } from './stratum-integration.js';
import { createPaymentProcessor } from './payments/processor.js';
import { updateAllImmatureBalances, creditConfirmedBlockEarnings } from './payments/calculator.js';
import { cleanupOldShares, cleanupOldPoolStats, flushShareBuffer } from './db/postgres.js';
import * as postgres from './db/postgres.js';
import * as redis from './db/redis.js';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function isValidBitokAddress(address) {
    if (!address || typeof address !== 'string') return false;
    if (address.length < 25 || address.length > 34) return false;
    if (!address.startsWith('1')) return false;
    for (const char of address) {
        if (!BASE58_ALPHABET.includes(char)) return false;
    }
    try {
        const decoded = base58Decode(address);
        if (decoded.length !== 25) return false;
        const checksum = decoded.slice(-4);
        const payload = decoded.slice(0, -4);
        const hash1 = crypto.createHash('sha256').update(payload).digest();
        const hash2 = crypto.createHash('sha256').update(hash1).digest();
        const calculatedChecksum = hash2.slice(0, 4);
        return checksum.equals(calculatedChecksum);
    } catch {
        return false;
    }
}

function base58Decode(str) {
    const ALPHABET_MAP = {};
    for (let i = 0; i < BASE58_ALPHABET.length; i++) {
        ALPHABET_MAP[BASE58_ALPHABET.charAt(i)] = BigInt(i);
    }
    let num = 0n;
    for (let i = 0; i < str.length; i++) {
        num = num * 58n + ALPHABET_MAP[str[i]];
    }
    let leadingZeros = 0;
    for (let i = 0; i < str.length && str[i] === '1'; i++) {
        leadingZeros++;
    }
    const hex = num.toString(16);
    const hexPadded = hex.length % 2 === 0 ? hex : '0' + hex;
    return Buffer.concat([
        Buffer.alloc(leadingZeros),
        Buffer.from(hexPadded, 'hex')
    ]);
}

const Stratum = require('../../lib/index.js');

const poolConfig = {
    coin: {
        name: 'Bitok',
        symbol: 'BITOK',
        algorithm: 'bitokpow',
        peerMagic: 'b40bc0de',
        hasGetInfo: true,
        reward: 'POW',
        requiresPubkey: true
    },
    address: process.env.POOL_ADDRESS,
    rewardRecipients: {},
    blockRefreshInterval: 1000,
    jobRebroadcastTimeout: 55,
    connectionTimeout: 600,
    emitInvalidBlockHashes: false,
    tcpProxyProtocol: false,
    banning: {
        enabled: true,
        time: 600,
        invalidPercent: 50,
        checkThreshold: 500,
        purgeInterval: 300
    },
    ports: {
        [config.pool.stratumPort]: {
            diff: config.pool.minDiff,
            varDiff: {
                minDiff: config.pool.minDiff,
                maxDiff: config.pool.maxDiff,
                targetTime: 15,
                retargetTime: 90,
                variancePercent: 30
            }
        }
    },
    daemons: [{
        host: process.env.RPC_HOST || '127.0.0.1',
        port: parseInt(process.env.RPC_PORT) || 8332,
        user: process.env.RPC_USER,
        password: process.env.RPC_PASSWORD
    }],
    p2p: {
        enabled: false,
        host: '127.0.0.1',
        port: 18333,
        disableTransactions: true
    }
};

if (!poolConfig.address) {
    console.error('ERROR: POOL_ADDRESS not set in .env');
    process.exit(1);
}

if (!poolConfig.daemons[0].user || !poolConfig.daemons[0].password) {
    console.error('ERROR: RPC_USER and RPC_PASSWORD must be set in .env');
    process.exit(1);
}

function authorizeFn(ip, port, workerName, password, callback) {
    const [address] = (workerName || '').split('.');
    const worker = workerName?.includes('.') ? workerName.split('.').slice(1).join('.') : 'default';

    if (!isValidBitokAddress(address)) {
        console.log('Worker rejected:', workerName, 'from', ip, '- invalid Bitok address');
        callback({
            error: [20, 'Invalid Bitok address. Address must start with 1', null],
            authorized: false,
            disconnect: false
        });
        return;
    }

    console.log('Worker authorized:', address + '.' + worker, 'from', ip);
    callback({
        error: null,
        authorized: true,
        disconnect: false
    });
}

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));
app.use('/api', apiRoutes);
app.get('*', (req, res) => {
    res.sendFile(join(__dirname, '../public/index.html'));
});

console.log('');
console.log('  ╔══════════════════════════════════════╗');
console.log('  ║         BITOK MINING POOL            ║');
console.log('  ╚══════════════════════════════════════╝');
console.log('');

async function initializePool() {
    try {
        await redis.syncFromPostgreSQL(postgres);
    } catch (err) {
        console.error('  [ERROR] Failed to sync Redis from PostgreSQL:', err.message);
    }

    const pool = Stratum.createPool(poolConfig, authorizeFn);
    attachToPool(pool);

    return pool;
}

const poolPromise = initializePool();
let pool;

poolPromise.then(p => {
    pool = p;

    pool.on('started', function() {
        console.log('  Stratum server started on port', config.pool.stratumPort);
        console.log('  Connect: stratum+tcp://' + config.pool.stratumHost + ':' + config.pool.stratumPort);
        console.log('');

        setInterval(() => {
            if (pool.daemon) {
                updateBlockConfirmations(pool.daemon);
            }
        }, 60000);

        updateAllImmatureBalances().catch(err => {
            console.error('  [ERROR] Initial immature balance update failed:', err.message);
        });

        creditConfirmedBlockEarnings().catch(err => {
            console.error('  [ERROR] Initial pending balance credit failed:', err.message);
        });

        const paymentProcessor = createPaymentProcessor();
        paymentProcessor.start().catch(err => {
            console.error('  [ERROR] Failed to start payment processor:', err);
        });

        async function runDatabaseCleanup() {
            try {
                const sharesDeleted = await cleanupOldShares(7);
                const statsDeleted = await cleanupOldPoolStats(30);
                if (sharesDeleted > 0 || statsDeleted > 0) {
                    console.log(`  Database cleanup: ${sharesDeleted} old shares, ${statsDeleted} old stats removed`);
                }
            } catch (err) {
                console.error('  [ERROR] Database cleanup failed:', err.message);
            }
        }

        runDatabaseCleanup();
        setInterval(runDatabaseCleanup, 6 * 60 * 60 * 1000);

        let shareCount = 0;
        let blockCandidates = 0;
        const statsStartTime = Date.now();

        setInterval(() => {
            const clients = pool.stratumServer ? Object.keys(pool.stratumServer.stratumClients).length : 0;
            const validJobs = pool.jobManager ? Object.keys(pool.jobManager.validJobs).length : 0;
            const currentHeight = pool.jobManager?.currentJob?.rpcData?.height || 0;
            const uptimeMin = Math.floor((Date.now() - statsStartTime) / 60000);
            console.log(`  [STATS] Uptime: ${uptimeMin}min | Clients: ${clients} | Jobs: ${validJobs} | Height: ${currentHeight} | Shares: ${shareCount}`);
        }, 300000);

        pool.on('share', () => { shareCount++; });
    });

    pool.on('share', function(isValidShare, isValidBlock, data) {
        if (isValidBlock) {
            console.log('');
            console.log('  *** BLOCK FOUND ***');
            console.log('  Hash:', data.blockHash);
            console.log('  Height:', data.height);
            console.log('');
        } else if (isValidShare) {
            console.log('  Share:', data.worker, 'diff', data.shareDiff);
        }
    });

    pool.on('log', function(severity, text) {
        if (severity === 'error') {
            console.error('  [ERROR]', text);
        } else if (severity === 'warning') {
            console.warn('  [WARN]', text);
        } else if (severity === 'special') {
            console.log('');
            console.log(' ', text.replace(/\t+/g, '\n  '));
            console.log('');
        }
    });

    pool.start();
}).catch(err => {
    console.error('  [ERROR] Failed to initialize pool:', err);
    process.exit(1);
});

const webServer = app.listen(config.server.port, config.server.host, () => {
    console.log('  Web UI running at http://' + config.server.host + ':' + config.server.port);
    console.log('');
});

process.on('SIGINT', async function() {
    console.log('\n  Shutting down...');
    try {
        await flushShareBuffer();
        console.log('  Share buffer flushed');
    } catch (err) {
        console.error('  Error flushing shares:', err.message);
    }
    webServer.close(() => {
        process.exit(0);
    });
});
