const util = require('./util.js');

const generateOutputTransactions = function(poolRecipient, recipients, rpcData) {
    let reward = rpcData.coinbasevalue;
    let rewardToPool = reward;

    const txOutputBuffers = [];

    if (rpcData.masternode && rpcData.superblock) {
        if (rpcData.masternode.payee) {
            const payeeReward = rpcData.masternode.amount;
            reward -= payeeReward;
            rewardToPool -= payeeReward;

            const payeeScript = util.addressToScript(rpcData.masternode.payee);
            txOutputBuffers.push(Buffer.concat([
                util.packInt64LE(payeeReward),
                util.varIntBuffer(payeeScript.length),
                payeeScript
            ]));
        } else if (rpcData.superblock.length > 0) {
            for (const sb of rpcData.superblock) {
                const payeeReward = sb.amount;
                reward -= payeeReward;
                rewardToPool -= payeeReward;

                const payeeScript = util.addressToScript(sb.payee);
                txOutputBuffers.push(Buffer.concat([
                    util.packInt64LE(payeeReward),
                    util.varIntBuffer(payeeScript.length),
                    payeeScript
                ]));
            }
        }
    }

    if (rpcData.payee) {
        let payeeReward = 0;

        if (rpcData.payee_amount) {
            payeeReward = rpcData.payee_amount;
        } else {
            payeeReward = Math.ceil(reward / 5);
        }

        reward -= payeeReward;
        rewardToPool -= payeeReward;

        const payeeScript = util.addressToScript(rpcData.payee);
        txOutputBuffers.push(Buffer.concat([
            util.packInt64LE(payeeReward),
            util.varIntBuffer(payeeScript.length),
            payeeScript
        ]));
    }

    for (const recipient of recipients) {
        const recipientReward = Math.floor(recipient.percent * reward);
        rewardToPool -= recipientReward;

        txOutputBuffers.push(Buffer.concat([
            util.packInt64LE(recipientReward),
            util.varIntBuffer(recipient.script.length),
            recipient.script
        ]));
    }

    txOutputBuffers.unshift(Buffer.concat([
        util.packInt64LE(rewardToPool),
        util.varIntBuffer(poolRecipient.length),
        poolRecipient
    ]));

    if (rpcData.default_witness_commitment !== undefined) {
        const witness_commitment = Buffer.from(rpcData.default_witness_commitment, 'hex');
        txOutputBuffers.unshift(Buffer.concat([
            util.packInt64LE(0),
            util.varIntBuffer(witness_commitment.length),
            witness_commitment
        ]));
    }

    return Buffer.concat([
        util.varIntBuffer(txOutputBuffers.length),
        Buffer.concat(txOutputBuffers)
    ]);
};

exports.CreateGeneration = function(rpcData, publicKey, extraNoncePlaceholder, reward, txMessages, recipients) {
    const txInputsCount = 1;
    const txVersion = txMessages === true ? 2 : 1;
    const txLockTime = 0;

    const txInPrevOutHash = "";
    const txInPrevOutIndex = Math.pow(2, 32) - 1;
    const txInSequence = 0;

    const txTimestamp = reward === 'POS' ?
        util.packUInt32LE(rpcData.curtime) : Buffer.alloc(0);

    const txComment = txMessages === true ?
        util.serializeString('https://github.com/elvisjedusor/bitok') :
        Buffer.alloc(0);

    const scriptSigPart1 = Buffer.concat([
        util.serializeNumber(rpcData.height),
        Buffer.alloc(0),
        util.serializeNumber(Date.now() / 1000 | 0),
        Buffer.from([extraNoncePlaceholder.length])
    ]);

    const scriptSigPart2 = util.serializeString('/BitokPool/');

    const p1 = Buffer.concat([
        util.packUInt32LE(txVersion),
        txTimestamp,
        util.varIntBuffer(txInputsCount),
        util.uint256BufferFromHash(txInPrevOutHash),
        util.packUInt32LE(txInPrevOutIndex),
        util.varIntBuffer(scriptSigPart1.length + extraNoncePlaceholder.length + scriptSigPart2.length),
        scriptSigPart1
    ]);

    const outputTransactions = generateOutputTransactions(publicKey, recipients, rpcData);

    const p2 = Buffer.concat([
        scriptSigPart2,
        util.packUInt32LE(txInSequence),
        outputTransactions,
        util.packUInt32LE(txLockTime),
        txComment
    ]);

    return [p1, p2];
};
