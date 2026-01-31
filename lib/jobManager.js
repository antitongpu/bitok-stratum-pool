'use strict';

const events = require('events');
const crypto = require('crypto');
const util = require('./util.js');
const BlockTemplate = require('./blockTemplate.js');
const algos = require('./algoProperties.js');
const diff1 = global.diff1;

class ExtraNonceCounter {
    constructor(configInstanceId) {
        const instanceId = configInstanceId || crypto.randomBytes(4).readUInt32LE(0);
        this.counter = instanceId << 27;
        this.size = 4;
    }

    next() {
        const extraNonce = util.packUInt32BE(Math.abs(this.counter++));
        return extraNonce.toString('hex');
    }
}

class JobCounter {
    constructor() {
        this.counter = 0;
    }

    next() {
        this.counter++;
        if (this.counter % 0xffff === 0) {
            this.counter = 1;
        }
        return this.cur();
    }

    cur() {
        return this.counter.toString(16);
    }
}

class JobManager extends events.EventEmitter {
    constructor(options) {
        super();

        this.options = options;
        this.jobCounter = new JobCounter();
        this.shareMultiplier = algos[options.coin.algorithm].multiplier;
        this.extraNonceCounter = new ExtraNonceCounter(options.instanceId);
        this.extraNoncePlaceholder = Buffer.from('f000000ff111111f', 'hex');
        this.extraNonce2Size = this.extraNoncePlaceholder.length - this.extraNonceCounter.size;
        this.currentJob = null;
        this.validJobs = {};
        this.hashDigest = algos[options.coin.algorithm].hash(options.coin);
        this.coinbaseHasher = util.sha256d;
    }

    updateCurrentJob(rpcData) {
        const tmpBlockTemplate = new BlockTemplate(
            this.jobCounter.next(),
            rpcData,
            this.options.poolAddressScript,
            this.extraNoncePlaceholder,
            this.options.coin.reward,
            this.options.coin.txMessages,
            this.options.recipients
        );

        this.currentJob = tmpBlockTemplate;
        this.emit('updatedBlock', tmpBlockTemplate, true);
        this.validJobs[tmpBlockTemplate.jobId] = tmpBlockTemplate;

        const jobIds = Object.keys(this.validJobs);
        if (jobIds.length > 100) {
            const toRemove = jobIds.slice(0, jobIds.length - 100);
            toRemove.forEach(id => delete this.validJobs[id]);
        }
    }

    processTemplate(rpcData) {
        let isNewBlock = typeof this.currentJob === 'undefined' || this.currentJob === null;

        if (!isNewBlock && this.currentJob.rpcData.previousblockhash !== rpcData.previousblockhash) {
            isNewBlock = true;
            if (rpcData.height < this.currentJob.rpcData.height) {
                return false;
            }
        }

        if (!isNewBlock) return false;

        const tmpBlockTemplate = new BlockTemplate(
            this.jobCounter.next(),
            rpcData,
            this.options.poolAddressScript,
            this.extraNoncePlaceholder,
            this.options.coin.reward,
            this.options.coin.txMessages,
            this.options.recipients
        );

        this.currentJob = tmpBlockTemplate;
        this.validJobs = {};
        this.emit('newBlock', tmpBlockTemplate);
        this.validJobs[tmpBlockTemplate.jobId] = tmpBlockTemplate;

        return true;
    }

    processShare(jobId, previousDifficulty, difficulty, extraNonce1, extraNonce2, nTime, nonce, ipAddress, port, workerName) {
        const shareError = (error) => {
            this.emit('share', {
                job: jobId,
                ip: ipAddress,
                worker: workerName,
                difficulty: difficulty,
                error: error[1]
            });
            return { error: error, result: null };
        };

        const submitTime = Date.now() / 1000 | 0;

        if (extraNonce2.length / 2 !== this.extraNonce2Size) {
            return shareError([20, 'incorrect size of extranonce2']);
        }

        const job = this.validJobs[jobId];

        if (typeof job === 'undefined' || job.jobId !== jobId) {
            console.log('  [REJECT] Job not found:', jobId, '| ValidJobs:', Object.keys(this.validJobs).join(','));
            return shareError([21, 'job not found']);
        }

        if (nTime.length !== 8) {
            return shareError([20, 'incorrect size of ntime']);
        }

        const nTimeInt = parseInt(nTime, 16);
        if (nTimeInt < job.rpcData.curtime || nTimeInt > submitTime + 7200) {
            return shareError([20, 'ntime out of range']);
        }

        if (nonce.length !== 8) {
            return shareError([20, 'incorrect size of nonce']);
        }

        if (!job.registerSubmit(extraNonce1, extraNonce2, nTime, nonce)) {
            return shareError([22, 'duplicate share']);
        }

        const extraNonce1Buffer = Buffer.from(extraNonce1, 'hex');
        const extraNonce2Buffer = Buffer.from(extraNonce2, 'hex');
        const coinbaseBuffer = job.serializeCoinbase(extraNonce1Buffer, extraNonce2Buffer);
        const coinbaseHash = this.coinbaseHasher(coinbaseBuffer);
        const merkleRoot = util.reverseBuffer(job.merkleTree.withFirst(coinbaseHash)).toString('hex');
        const headerBuffer = job.serializeHeader(merkleRoot, nTime, nonce);
        const headerHash = this.hashDigest(headerBuffer, nTimeInt);
        const headerBigNum = bufferToBigInt(headerHash);

        let blockHashInvalid;
        let blockHash;
        let blockHex;

        const shareDiff = Number(diff1) / Number(headerBigNum) * this.shareMultiplier;
        const blockDiffAdjusted = job.difficulty * this.shareMultiplier;

        const isBlockCandidate = job.target >= headerBigNum;

        if (isBlockCandidate) {
            console.log('*** BLOCK CANDIDATE FOUND ***');
            console.log('  Worker:', workerName);
            console.log('  Job:', jobId, '| Height:', job.rpcData.height);
            console.log('  ShareDiff:', shareDiff.toFixed(4), '| BlockDiff:', blockDiffAdjusted.toFixed(4));
            console.log('  ValidJobs count:', Object.keys(this.validJobs).length);
        }

        if (isBlockCandidate) {
            blockHex = job.serializeBlock(headerBuffer, coinbaseBuffer).toString('hex');
            blockHash = util.reverseBuffer(util.sha256d(headerBuffer)).toString('hex');
        } else {
            if (this.options.emitInvalidBlockHashes) {
                blockHashInvalid = util.reverseBuffer(util.sha256d(headerBuffer)).toString('hex');
            }

            if (shareDiff / difficulty < 0.99) {
                if (previousDifficulty && shareDiff >= previousDifficulty) {
                    difficulty = previousDifficulty;
                } else {
                    return shareError([23, 'low difficulty share of ' + shareDiff]);
                }
            }
        }

        this.emit('share', {
            job: jobId,
            ip: ipAddress,
            port: port,
            worker: workerName,
            height: job.rpcData.height,
            blockReward: job.rpcData.coinbasevalue,
            difficulty: difficulty,
            shareDiff: shareDiff.toFixed(8),
            blockDiff: blockDiffAdjusted,
            blockDiffActual: job.difficulty,
            blockHash: blockHash,
            blockHashInvalid: blockHashInvalid
        }, blockHex);

        return { result: true, error: null, blockHash: blockHash };
    }
}

function bufferToBigInt(buffer) {
    let result = 0n;
    for (let i = buffer.length - 1; i >= 0; i--) {
        result = (result << 8n) + BigInt(buffer[i]);
    }
    return result;
}

module.exports = JobManager;
