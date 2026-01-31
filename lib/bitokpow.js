const path = require('path');
let bitokpow;

try {
    bitokpow = require('../build/Release/bitokpow.node');
} catch (e) {
    try {
        bitokpow = require('../build/Debug/bitokpow.node');
    } catch (e2) {
        throw new Error('BitokPoW native module not found. Please run: npm install');
    }
}

function hash(data) {
    if (!Buffer.isBuffer(data)) {
        data = Buffer.from(data, 'hex');
    }
    return bitokpow.hash(data);
}

function verifyBlock(header, target) {
    if (!Buffer.isBuffer(header)) {
        header = Buffer.from(header, 'hex');
    }
    if (!Buffer.isBuffer(target)) {
        target = Buffer.from(target, 'hex');
    }
    return bitokpow.verifyBlock(header, target);
}

module.exports = {
    hash,
    verifyBlock
};
