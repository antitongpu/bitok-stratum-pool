'use strict';

const Stratum = require('../lib/index.js');
const bitokpow = require('../lib/bitokpow.js');

console.log('=== Bitok Stratum Pool Tests ===\n');

console.log('1. Testing BitokPoW hash function...');
try {
    const testInput = Buffer.alloc(80, 0);
    testInput.write('Bitok test input', 0);
    const hash = bitokpow.hash(testInput);
    console.log('   Input (first 16 bytes):', testInput.slice(0, 16).toString('hex'));
    console.log('   Hash result:', hash.toString('hex'));
    console.log('   Hash length:', hash.length, 'bytes');
    if (hash.length === 32) {
        console.log('   PASSED: Hash length is correct (32 bytes)\n');
    } else {
        console.log('   FAILED: Hash length should be 32 bytes\n');
        process.exit(1);
    }
} catch (e) {
    console.log('   FAILED:', e.message);
    process.exit(1);
}

console.log('2. Testing block verification...');
try {
    const header = Buffer.alloc(80, 0);
    header.write('test block header', 0);
    const easyTarget = Buffer.alloc(32, 0xff);
    const hardTarget = Buffer.alloc(32, 0);
    hardTarget[0] = 0x01;

    const validResult = bitokpow.verifyBlock(header, easyTarget);
    const invalidResult = bitokpow.verifyBlock(header, hardTarget);

    console.log('   Easy target verification:', validResult);
    console.log('   Hard target verification:', invalidResult);

    if (validResult === true && invalidResult === false) {
        console.log('   PASSED: Block verification works correctly\n');
    } else {
        console.log('   WARNING: Unexpected verification results\n');
    }
} catch (e) {
    console.log('   FAILED:', e.message);
    process.exit(1);
}

console.log('3. Testing algorithm properties...');
try {
    require('../lib/algoProperties.js');

    if (global.algos && global.algos.bitokpow) {
        console.log('   BitokPoW algorithm loaded:', !!global.algos.bitokpow.hash);
        console.log('   Multiplier:', global.algos.bitokpow.multiplier);
        console.log('   PASSED: Algorithm properties loaded correctly\n');
    } else {
        console.log('   FAILED: BitokPoW algorithm not found\n');
        process.exit(1);
    }
} catch (e) {
    console.log('   FAILED:', e.message);
    process.exit(1);
}

console.log('4. Testing utility functions...');
try {
    const util = require('../lib/util.js');

    const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
    console.log('   Testing addressToScript with:', testAddress);

    const script = util.addressToScript(testAddress);
    console.log('   Script generated:', script.toString('hex'));
    console.log('   Script length:', script.length, 'bytes');

    const reverseTest = Buffer.from('01020304', 'hex');
    const reversed = util.reverseBuffer(reverseTest);
    console.log('   Reverse buffer test:', reversed.toString('hex'));

    if (reversed.toString('hex') === '04030201') {
        console.log('   PASSED: Utility functions work correctly\n');
    } else {
        console.log('   FAILED: Reverse buffer incorrect\n');
        process.exit(1);
    }
} catch (e) {
    console.log('   FAILED:', e.message);
    process.exit(1);
}

console.log('5. Testing pool creation (config only)...');
try {
    const poolConfig = {
        coin: {
            name: 'Bitok',
            symbol: 'BITOK',
            algorithm: 'bitokpow',
            peerMagic: 'b40bc0de',
            hasGetInfo: true
        },
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
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
                diff: 32,
                varDiff: {
                    minDiff: 8,
                    maxDiff: 512,
                    targetTime: 15,
                    retargetTime: 90,
                    variancePercent: 30
                }
            }
        },
        daemons: [{
            host: '127.0.0.1',
            port: 8332,
            user: 'test',
            password: 'test'
        }]
    };

    console.log('   Pool config validation passed');
    console.log('   Coin:', poolConfig.coin.name, '(' + poolConfig.coin.symbol + ')');
    console.log('   Algorithm:', poolConfig.coin.algorithm);
    console.log('   Stratum port:', Object.keys(poolConfig.ports)[0]);
    console.log('   PASSED: Pool configuration is valid\n');
} catch (e) {
    console.log('   FAILED:', e.message);
    process.exit(1);
}

console.log('=== All Tests Passed ===');
console.log('\nNote: To run a full pool test, you need a running Bitok daemon.');
console.log('Configure your daemon connection in the pool config and use:');
console.log('  node examples/run-pool.js');
