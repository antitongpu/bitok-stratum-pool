'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const Stratum = require('../lib/index.js');

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
        3032: {
            diff: 0.5,
            varDiff: {
                minDiff: 0.5,
                maxDiff: 512,
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
    console.error('       Use an address from your Bitok wallet (getnewaddress)');
    process.exit(1);
}

if (!poolConfig.daemons[0].user || !poolConfig.daemons[0].password) {
    console.error('ERROR: RPC_USER and RPC_PASSWORD must be set in .env');
    process.exit(1);
}

function authorizeFn(ip, port, workerName, password, callback) {
    console.log('Worker connected:', workerName, 'from', ip);
    callback({
        error: null,
        authorized: true,
        disconnect: false
    });
}

console.log('');
console.log('  Bitok Stratum Pool');
console.log('  ==================');
console.log('');

const pool = Stratum.createPool(poolConfig, authorizeFn);

pool.on('started', function() {
    console.log('  Pool running on port 3032');
    console.log('  Connect: stratum+tcp://localhost:3032');
    console.log('');
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

process.on('SIGINT', function() {
    console.log('\n  Shutting down...');
    process.exit(0);
});
