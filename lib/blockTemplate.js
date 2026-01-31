const merkleTree = require('./merkleTree.js');
const transactions = require('./transactions.js');
const util = require('./util.js');
require('./algoProperties.js');
const diff1 = global.diff1;

class BlockTemplate {
    constructor(jobId, rpcData, poolAddressScript, extraNoncePlaceholder, reward, txMessages, recipients) {
        this.rpcData = rpcData;
        this.jobId = jobId;

        this.target = rpcData.target
            ? BigInt('0x' + rpcData.target)
            : util.bignumFromBitsHex(rpcData.bits);

        this.difficulty = parseFloat((Number(diff1) / Number(this.target)).toFixed(9));

        this.prevHashReversed = util.reverseByteOrder(Buffer.from(rpcData.previousblockhash, 'hex')).toString('hex');
        this.transactionData = Buffer.concat(rpcData.transactions.map(tx => Buffer.from(tx.data, 'hex')));
        this.merkleTree = new merkleTree(this.getTransactionBuffers(rpcData.transactions));
        this.merkleBranch = this.getMerkleHashes(this.merkleTree.steps);
        this.generationTransaction = transactions.CreateGeneration(
            rpcData,
            poolAddressScript,
            extraNoncePlaceholder,
            reward,
            txMessages,
            recipients
        );

        this.submits = [];
    }

    getMerkleHashes(steps) {
        return steps.map(step => step.toString('hex'));
    }

    getTransactionBuffers(txs) {
        const txHashes = txs.map(tx => {
            if (tx.txid !== undefined) {
                return util.uint256BufferFromHash(tx.txid);
            }
            return util.uint256BufferFromHash(tx.hash);
        });
        return [null].concat(txHashes);
    }

    getVoteData() {
        if (!this.rpcData.masternode_payments) return Buffer.alloc(0);

        return Buffer.concat(
            [util.varIntBuffer(this.rpcData.votes.length)].concat(
                this.rpcData.votes.map(vt => Buffer.from(vt, 'hex'))
            )
        );
    }

    serializeCoinbase(extraNonce1, extraNonce2) {
        return Buffer.concat([
            this.generationTransaction[0],
            extraNonce1,
            extraNonce2,
            this.generationTransaction[1]
        ]);
    }

    serializeHeader(merkleRoot, nTime, nonce) {
        const header = Buffer.alloc(80);
        let position = 0;
        header.write(nonce, position, 4, 'hex');
        header.write(this.rpcData.bits, position += 4, 4, 'hex');
        header.write(nTime, position += 4, 4, 'hex');
        header.write(merkleRoot, position += 4, 32, 'hex');
        header.write(this.rpcData.previousblockhash, position += 32, 32, 'hex');
        header.writeUInt32BE(this.rpcData.version, position + 32);
        return util.reverseBuffer(header);
    }

    serializeBlock(header, coinbase) {
        return Buffer.concat([
            header,
            util.varIntBuffer(this.rpcData.transactions.length + 1),
            coinbase,
            this.transactionData,
            this.getVoteData(),
            Buffer.alloc(this.rpcData.reward === 'POS' ? 1 : 0)
        ]);
    }

    registerSubmit(extraNonce1, extraNonce2, nTime, nonce) {
        const submission = extraNonce1 + extraNonce2 + nTime + nonce;
        if (this.submits.indexOf(submission) === -1) {
            this.submits.push(submission);
            return true;
        }
        return false;
    }

    getJobParams() {
        if (!this.jobParams) {
            this.jobParams = [
                this.jobId,
                this.prevHashReversed,
                this.generationTransaction[0].toString('hex'),
                this.generationTransaction[1].toString('hex'),
                this.merkleBranch,
                util.packInt32BE(this.rpcData.version).toString('hex'),
                this.rpcData.bits,
                util.packUInt32BE(this.rpcData.curtime).toString('hex'),
                true
            ];
        }
        return this.jobParams;
    }
}

module.exports = BlockTemplate;
