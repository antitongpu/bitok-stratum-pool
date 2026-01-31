'use strict';

const net = require('net');
const crypto = require('crypto');
const events = require('events');
const util = require('./util.js');

function fixedLenStringBuffer(s, len) {
    const buff = Buffer.alloc(len);
    buff.fill(0);
    buff.write(s);
    return buff;
}

function commandStringBuffer(s) {
    return fixedLenStringBuffer(s, 12);
}

function readFlowingBytes(stream, amount, preRead, callback) {
    let buff = preRead ? preRead : Buffer.alloc(0);

    const readData = (data) => {
        buff = Buffer.concat([buff, data]);
        if (buff.length >= amount) {
            const returnData = buff.slice(0, amount);
            const lopped = buff.length > amount ? buff.slice(amount) : null;
            callback(returnData, lopped);
        } else {
            stream.once('data', readData);
        }
    };

    readData(Buffer.alloc(0));
}

class Peer extends events.EventEmitter {
    constructor(options) {
        super();
        this.options = options;
        this.client = null;
        this.magic = Buffer.from(options.testnet ? options.coin.peerMagicTestnet : options.coin.peerMagic, 'hex');
        this.magicInt = this.magic.readUInt32LE(0);
        this.verack = false;
        this.validConnectionConfig = true;

        this.invCodes = {
            error: 0,
            tx: 1,
            block: 2
        };

        this.networkServices = Buffer.from('0100000000000000', 'hex');
        this.emptyNetAddress = Buffer.from('010000000000000000000000000000000000ffff000000000000', 'hex');
        this.userAgent = util.varStringBuffer('/bitok-stratum/');
        this.blockStartHeight = Buffer.from('00000000', 'hex');
        this.relayTransactions = options.p2p.disableTransactions === true ? Buffer.from([0]) : Buffer.alloc(0);

        this.commands = {
            version: commandStringBuffer('version'),
            inv: commandStringBuffer('inv'),
            verack: commandStringBuffer('verack'),
            addr: commandStringBuffer('addr'),
            getblocks: commandStringBuffer('getblocks'),
            ping: commandStringBuffer('ping'),
            pong: commandStringBuffer('pong')
        };

        this.connect();
    }

    connect() {
        this.client = net.connect({
            host: this.options.p2p.host,
            port: this.options.p2p.port
        }, () => {
            this.sendVersion();
        });

        this.client.on('close', () => {
            if (this.verack) {
                this.emit('disconnected');
                this.verack = false;
                this.connect();
            } else if (this.validConnectionConfig) {
                this.emit('connectionRejected');
            }
        });

        this.client.on('error', (e) => {
            if (e.code === 'ECONNREFUSED') {
                this.validConnectionConfig = false;
                this.emit('connectionFailed');
            } else {
                this.emit('socketError', e);
            }
        });

        this.setupMessageParser(this.client);
    }

    setupMessageParser(client) {
        const beginReadingMessage = (preRead) => {
            readFlowingBytes(client, 24, preRead, (header, lopped) => {
                const msgMagic = header.readUInt32LE(0);
                if (msgMagic !== this.magicInt) {
                    this.emit('error', 'bad magic number from peer');
                    let h = header;
                    while (h.readUInt32LE(0) !== this.magicInt && h.length >= 4) {
                        h = h.slice(1);
                    }
                    if (h.length >= 4 && h.readUInt32LE(0) === this.magicInt) {
                        beginReadingMessage(h);
                    } else {
                        beginReadingMessage(Buffer.alloc(0));
                    }
                    return;
                }

                const msgCommand = header.slice(4, 16).toString();
                const msgLength = header.readUInt32LE(16);
                const msgChecksum = header.readUInt32LE(20);

                readFlowingBytes(client, msgLength, lopped, (payload, loppedPayload) => {
                    if (util.sha256d(payload).readUInt32LE(0) !== msgChecksum) {
                        this.emit('error', 'bad payload - failed checksum');
                        beginReadingMessage(null);
                        return;
                    }
                    this.handleMessage(msgCommand, payload);
                    beginReadingMessage(loppedPayload);
                });
            });
        };

        beginReadingMessage(null);
    }

    handleInv(payload) {
        let count = payload.readUInt8(0);
        let p = payload.slice(1);

        if (count >= 0xfd) {
            count = p.readUInt16LE(0);
            p = p.slice(2);
        }

        while (count--) {
            const type = p.readUInt32LE(0);
            if (type === this.invCodes.block) {
                const block = p.slice(4, 36).toString('hex');
                this.emit('blockFound', block);
            }
            p = p.slice(36);
        }
    }

    handleMessage(command, payload) {
        this.emit('peerMessage', { command: command, payload: payload });

        switch (command) {
            case this.commands.inv.toString():
                this.handleInv(payload);
                break;
            case this.commands.verack.toString():
                if (!this.verack) {
                    this.verack = true;
                    this.emit('connected');
                }
                break;
            case this.commands.version.toString():
                this.sendMessage(this.commands.verack, Buffer.alloc(0));
                break;
            case this.commands.ping.toString():
                this.sendMessage(this.commands.pong, payload);
                break;
            default:
                break;
        }
    }

    sendMessage(command, payload) {
        const message = Buffer.concat([
            this.magic,
            command,
            util.packUInt32LE(payload.length),
            util.sha256d(payload).slice(0, 4),
            payload
        ]);
        this.client.write(message);
        this.emit('sentMessage', message);
    }

    sendVersion() {
        const payload = Buffer.concat([
            util.packUInt32LE(this.options.protocolVersion),
            this.networkServices,
            util.packInt64LE(Date.now() / 1000 | 0),
            this.emptyNetAddress,
            this.emptyNetAddress,
            crypto.randomBytes(8),
            this.userAgent,
            this.blockStartHeight,
            this.relayTransactions
        ]);
        this.sendMessage(this.commands.version, payload);
    }
}

module.exports = Peer;
