'use strict';

const events = require('events');
const varDiff = require('./varDiff.js');
const daemon = require('./daemon.js');
const peer = require('./peer.js');
const stratum = require('./stratum.js');
const JobManager = require('./jobManager.js');
const util = require('./util.js');

class Pool extends events.EventEmitter {
    constructor(options, authorizeFn) {
        super();
        this.options = options;
        this.authorizeFn = authorizeFn;
        this.blockPollingIntervalId = null;
        this.daemon = null;
        this.peer = null;
        this.stratumServer = null;
        this.jobManager = null;
        this.varDiff = {};
    }

    emitLog(text) { this.emit('log', 'debug', text); }
    emitWarningLog(text) { this.emit('log', 'warning', text); }
    emitErrorLog(text) { this.emit('log', 'error', text); }
    emitSpecialLog(text) { this.emit('log', 'special', text); }

    start() {
        if (!(this.options.coin.algorithm in algos)) {
            this.emitErrorLog('The ' + this.options.coin.algorithm + ' hashing algorithm is not supported.');
            throw new Error('Unsupported algorithm');
        }

        this.setupVarDiff();
        this.setupApi();
        this.setupDaemonInterface(() => {
            this.detectCoinData(() => {
                this.setupRecipients();
                this.setupJobManager();
                this.onBlockchainSynced(() => {
                    this.getFirstJob(() => {
                        this.setupBlockPolling();
                        this.setupPeer();
                        this.startStratumServer(() => {
                            this.outputPoolInfo();
                            this.emit('started');
                        });
                    });
                });
            });
        });
    }

    getFirstJob(finishedCallback) {
        this.getBlockTemplate((error, result) => {
            if (error) {
                this.emitErrorLog('Error with getblocktemplate on creating first job, server cannot start');
                return;
            }

            const portWarnings = [];
            const networkDiffAdjusted = this.options.initStats.difficulty;

            Object.keys(this.options.ports).forEach((port) => {
                const portDiff = this.options.ports[port].diff;
                if (networkDiffAdjusted < portDiff) {
                    portWarnings.push('port ' + port + ' w/ diff ' + portDiff);
                }
            });

            if (portWarnings.length > 0 && (!process.env.forkId || process.env.forkId === '0')) {
                const warnMessage = 'Network diff of ' + networkDiffAdjusted + ' is lower than ' + portWarnings.join(' and ');
                this.emitWarningLog(warnMessage);
            }

            finishedCallback();
        });
    }

    outputPoolInfo() {
        const startMessage = 'Stratum Pool Server Started for ' + this.options.coin.name +
            ' [' + this.options.coin.symbol.toUpperCase() + '] {' + this.options.coin.algorithm + '}';

        if (process.env.forkId && process.env.forkId !== '0') {
            this.emitLog(startMessage);
            return;
        }

        const infoLines = [
            startMessage,
            'Network Connected:\t' + (this.options.testnet ? 'Testnet' : 'Mainnet'),
            'Detected Reward Type:\t' + this.options.coin.reward,
            'Current Block Height:\t' + this.jobManager.currentJob.rpcData.height,
            'Current Connect Peers:\t' + this.options.initStats.connections,
            'Current Block Diff:\t' + this.jobManager.currentJob.difficulty * algos[this.options.coin.algorithm].multiplier,
            'Network Difficulty:\t' + this.options.initStats.difficulty,
            'Network Hash Rate:\t' + util.getReadableHashRateString(this.options.initStats.networkHashRate),
            'Stratum Port(s):\t' + this.options.initStats.stratumPorts.join(', '),
            'Pool Fee Percent:\t' + this.options.feePercent + '%'
        ];

        if (typeof this.options.blockRefreshInterval === 'number' && this.options.blockRefreshInterval > 0) {
            infoLines.push('Block polling every:\t' + this.options.blockRefreshInterval + ' ms');
        }

        this.emitSpecialLog(infoLines.join('\n\t\t\t\t\t\t'));
    }

    onBlockchainSynced(syncedCallback) {
        const checkSynced = (displayNotSynced) => {
            this.daemon.cmd('getblocktemplate', [{}], (results) => {
                const synced = results.every((r) => !r.error || r.error.code !== -10);

                if (synced) {
                    syncedCallback();
                } else {
                    if (displayNotSynced) displayNotSynced();
                    setTimeout(() => checkSynced(), 5000);

                    if (!process.env.forkId || process.env.forkId === '0') {
                        this.generateProgress();
                    }
                }
            });
        };

        checkSynced(() => {
            if (!process.env.forkId || process.env.forkId === '0') {
                this.emitErrorLog('Daemon is still syncing with network (download blockchain) - server will be started once synced');
            }
        });
    }

    generateProgress() {
        const cmd = this.options.coin.hasGetInfo ? 'getinfo' : 'getblockchaininfo';
        this.daemon.cmd(cmd, [], (results) => {
            if (!results || !results[0] || !results[0].response) return;

            const blockCount = results.sort((a, b) => {
                return (b.response.blocks || 0) - (a.response.blocks || 0);
            })[0].response.blocks;

            this.daemon.cmd('getpeerinfo', [], (peerResults) => {
                if (!peerResults || !peerResults[0] || !peerResults[0].response) return;

                const peers = peerResults[0].response;
                if (!Array.isArray(peers) || peers.length === 0) return;

                const totalBlocks = peers.sort((a, b) => {
                    return (b.startingheight || 0) - (a.startingheight || 0);
                })[0].startingheight;

                if (totalBlocks > 0) {
                    const percent = (blockCount / totalBlocks * 100).toFixed(2);
                    this.emitWarningLog('Downloaded ' + percent + '% of blockchain from ' + peers.length + ' peers');
                }
            });
        });
    }

    setupApi() {
        if (typeof this.options.api === 'object' && typeof this.options.api.start === 'function') {
            this.options.api.start(this);
        }
    }

    setupPeer() {
        if (!this.options.p2p || !this.options.p2p.enabled) return;

        if (this.options.testnet && !this.options.coin.peerMagicTestnet) {
            this.emitErrorLog('p2p cannot be enabled in testnet without peerMagicTestnet set in coin configuration');
            return;
        } else if (!this.options.coin.peerMagic) {
            this.emitErrorLog('p2p cannot be enabled without peerMagic set in coin configuration');
            return;
        }

        this.peer = new peer(this.options);
        this.peer.on('connected', () => {
            this.emitLog('p2p connection successful');
        }).on('connectionRejected', () => {
            this.emitErrorLog('p2p connection failed - likely incorrect p2p magic value');
        }).on('disconnected', () => {
            this.emitWarningLog('p2p peer node disconnected - attempting reconnection...');
        }).on('connectionFailed', () => {
            this.emitErrorLog('p2p connection failed - likely incorrect host or port');
        }).on('socketError', (e) => {
            this.emitErrorLog('p2p had a socket error ' + JSON.stringify(e));
        }).on('error', (msg) => {
            this.emitWarningLog('p2p had an error ' + msg);
        }).on('blockFound', (hash) => {
            this.processBlockNotify(hash, 'p2p');
        });
    }

    setupVarDiff() {
        Object.keys(this.options.ports).forEach((port) => {
            if (this.options.ports[port].varDiff) {
                this.setVarDiff(port, this.options.ports[port].varDiff);
            }
        });
    }

    submitBlock(blockHex, callback) {
        let rpcCommand, rpcArgs;

        if (this.options.hasSubmitMethod) {
            rpcCommand = 'submitblock';
            rpcArgs = [blockHex];
        } else {
            rpcCommand = 'getblocktemplate';
            rpcArgs = [{ 'mode': 'submit', 'data': blockHex }];
        }

        this.daemon.cmd(rpcCommand, rpcArgs, (results) => {
            let hasError = false;
            for (let i = 0; i < results.length; i++) {
                const result = results[i];
                if (result.error) {
                    if (result.error.message === 'socket hang up') {
                        this.emitWarningLog('Daemon connection dropped during block submission - block may still have been accepted');
                        continue;
                    }
                    this.emitErrorLog('rpc error with daemon instance ' +
                        result.instance.index + ' when submitting block with ' + rpcCommand + ' ' +
                        JSON.stringify(result.error)
                    );
                    hasError = true;
                } else if (result.response === 'rejected') {
                    this.emitErrorLog('Daemon instance ' + result.instance.index + ' rejected a supposedly valid block');
                    hasError = true;
                }
            }
            if (!hasError) {
                this.emitLog('Submitted Block using ' + rpcCommand + ' successfully to daemon instance(s)');
            }
            callback();
        });
    }

    setupRecipients() {
        const recipients = [];
        this.options.feePercent = 0;
        this.options.rewardRecipients = this.options.rewardRecipients || {};

        for (const r in this.options.rewardRecipients) {
            const percent = this.options.rewardRecipients[r];
            const rObj = { percent: percent / 100 };

            try {
                if (r.length === 40) {
                    rObj.script = util.miningKeyToScript(r);
                } else {
                    rObj.script = util.addressToScript(r);
                }
                recipients.push(rObj);
                this.options.feePercent += percent;
            } catch (e) {
                this.emitErrorLog('Error generating transaction output script for ' + r + ' in rewardRecipients');
            }
        }

        if (recipients.length === 0) {
            this.emitWarningLog('No rewardRecipients have been setup which means no fees will be taken');
        }

        this.options.recipients = recipients;
    }

    setupJobManager() {
        this.jobManager = new JobManager(this.options);

        this.jobManager.on('newBlock', (blockTemplate) => {
            if (this.stratumServer) {
                this.stratumServer.broadcastMiningJobs(blockTemplate.getJobParams());
            }
        }).on('updatedBlock', (blockTemplate) => {
            if (this.stratumServer) {
                const job = blockTemplate.getJobParams();
                job[8] = false;
                this.stratumServer.broadcastMiningJobs(job);
            }
        }).on('share', (shareData, blockHex) => {
            const isValidShare = !shareData.error;
            const isValidBlock = !!blockHex;

            const emitShare = () => {
                this.emit('share', isValidShare, isValidBlock, shareData);
            };

            if (!isValidBlock) {
                emitShare();
            } else {
                this.submitBlock(blockHex, () => {
                    this.checkBlockAccepted(shareData.blockHash, (isAccepted, tx) => {
                        shareData.txHash = tx;
                        this.emit('share', isValidShare, isAccepted, shareData);

                        this.getBlockTemplate((error, result, foundNewBlock) => {
                            if (foundNewBlock) {
                                this.emitLog('Block notification via RPC after block submission');
                            }
                        });
                    });
                });
            }
        }).on('log', (severity, message) => {
            this.emit('log', severity, message);
        });
    }

    setupDaemonInterface(finishedCallback) {
        if (!Array.isArray(this.options.daemons) || this.options.daemons.length < 1) {
            this.emitErrorLog('No daemons have been configured - pool cannot start');
            return;
        }

        this.daemon = new daemon.interface(this.options.daemons, (severity, message) => {
            this.emit('log', severity, message);
        });

        this.daemon.once('online', () => {
            finishedCallback();
        }).on('connectionFailed', (error) => {
            this.emitErrorLog('Failed to connect daemon(s): ' + JSON.stringify(error));
        }).on('error', (message) => {
            this.emitErrorLog(message);
        });

        this.daemon.init();
    }

    detectCoinData(finishedCallback) {
        const batchRpcCalls = [
            ['getdifficulty', []],
            ['getmininginfo', []],
            ['submitblock', []]
        ];

        if (this.options.address) {
            batchRpcCalls.unshift(['validateaddress', [this.options.address]]);
        }

        if (this.options.coin.hasGetInfo) {
            batchRpcCalls.push(['getinfo', []]);
        } else {
            batchRpcCalls.push(['getblockchaininfo', []], ['getnetworkinfo', []]);
        }

        this.daemon.batchCmd(batchRpcCalls, (error, results) => {
            if (error || !results) {
                this.emitErrorLog('Could not start pool, error with init batch RPC call: ' + JSON.stringify(error));
                return;
            }

            const rpcResults = {};

            for (let i = 0; i < results.length; i++) {
                const rpcCall = batchRpcCalls[i][0];
                const r = results[i];
                rpcResults[rpcCall] = r.result || r.error;

                if (rpcCall !== 'submitblock' && rpcCall !== 'validateaddress' && (r.error || !r.result)) {
                    this.emitErrorLog('Could not start pool, error with init RPC ' + rpcCall + ' - ' + JSON.stringify(r.error));
                    return;
                }
            }

            if (this.options.address && rpcResults.validateaddress && !rpcResults.validateaddress.isvalid) {
                this.emitErrorLog('Daemon reports address is not valid');
                return;
            }

            if (!this.options.coin.reward) {
                if (isNaN(rpcResults.getdifficulty) && 'proof-of-stake' in rpcResults.getdifficulty) {
                    this.options.coin.reward = 'POS';
                } else {
                    this.options.coin.reward = 'POW';
                }
            }

            if (this.options.pubkey) {
                this.options.poolAddressScript = util.pubkeyToScript(this.options.pubkey);
            } else if (rpcResults.validateaddress && rpcResults.validateaddress.pubkey) {
                this.options.poolAddressScript = util.pubkeyToScript(rpcResults.validateaddress.pubkey);
                this.emitLog('Using pubkey from wallet for P2PK output: ' + rpcResults.validateaddress.pubkey.substring(0, 16) + '...');
            } else if (this.options.address && !this.options.coin.requiresPubkey) {
                this.options.poolAddressScript = util.addressToScript(this.options.address);
            } else {
                this.emitErrorLog('No pubkey available. For Bitok, the address must be in the daemon wallet.');
                this.emitErrorLog('Use getnewaddress to create an address, then use that same address here.');
                return;
            }

            this.options.testnet = this.options.coin.hasGetInfo
                ? rpcResults.getinfo.testnet
                : (rpcResults.getblockchaininfo.chain === 'test');

            this.options.protocolVersion = this.options.coin.hasGetInfo
                ? rpcResults.getinfo.protocolversion
                : rpcResults.getnetworkinfo.protocolversion;

            let difficulty = this.options.coin.hasGetInfo
                ? rpcResults.getinfo.difficulty
                : rpcResults.getblockchaininfo.difficulty;

            if (typeof difficulty === 'object') {
                difficulty = difficulty['proof-of-work'];
            }

            this.options.initStats = {
                connections: this.options.coin.hasGetInfo
                    ? rpcResults.getinfo.connections
                    : rpcResults.getnetworkinfo.connections,
                difficulty: difficulty,
                networkHashRate: rpcResults.getmininginfo.networkhashps || 0
            };

            if (rpcResults.submitblock.message === 'Method not found') {
                this.options.hasSubmitMethod = false;
            } else if (rpcResults.submitblock.code === -1 ||
                       (typeof rpcResults.submitblock === 'string' && rpcResults.submitblock.includes('submitblock'))) {
                this.options.hasSubmitMethod = true;
            } else {
                this.emitErrorLog('Could not detect block submission RPC method, ' + JSON.stringify(results));
                return;
            }

            finishedCallback();
        });
    }

    startStratumServer(finishedCallback) {
        this.stratumServer = new stratum.Server(this.options, this.authorizeFn);

        this.stratumServer.on('started', () => {
            this.options.initStats.stratumPorts = Object.keys(this.options.ports);
            this.stratumServer.broadcastMiningJobs(this.jobManager.currentJob.getJobParams());
            finishedCallback();
        }).on('broadcastTimeout', () => {
            this.emitLog('No new blocks for ' + this.options.jobRebroadcastTimeout + ' seconds - updating transactions & rebroadcasting work');

            this.getBlockTemplate((error, rpcData, processedBlock) => {
                if (error || processedBlock) return;
                this.jobManager.updateCurrentJob(rpcData);
            });
        }).on('client.connected', (client) => {
            if (typeof this.varDiff[client.socket.localPort] !== 'undefined') {
                this.varDiff[client.socket.localPort].manageClient(client);
            }

            client.on('difficultyChanged', (diff) => {
                this.emit('difficultyUpdate', client.workerName, diff);
            }).on('subscription', (params, resultCallback) => {
                const extraNonce = this.jobManager.extraNonceCounter.next();
                const extraNonce2Size = this.jobManager.extraNonce2Size;

                resultCallback(null, extraNonce, extraNonce2Size);

                if (typeof this.options.ports[client.socket.localPort] !== 'undefined' &&
                    this.options.ports[client.socket.localPort].diff) {
                    client.sendDifficulty(this.options.ports[client.socket.localPort].diff);
                } else {
                    client.sendDifficulty(8);
                }

                client.sendMiningJob(this.jobManager.currentJob.getJobParams());
            }).on('submit', (params, resultCallback) => {
                try {
                    const result = this.jobManager.processShare(
                        params.jobId,
                        client.previousDifficulty,
                        client.difficulty,
                        client.extraNonce1,
                        params.extraNonce2,
                        params.nTime,
                        params.nonce,
                        client.remoteAddress,
                        client.socket.localPort,
                        params.name
                    );

                    resultCallback(result.error, result.result ? true : null);
                } catch (e) {
                    this.emitErrorLog('Error processing share: ' + e.message);
                    console.error('Share processing error:', e);
                    resultCallback([20, 'server error'], null);
                }
            }).on('malformedMessage', (message) => {
                this.emitWarningLog('Malformed message from ' + client.getLabel() + ': ' + message);
            }).on('socketError', (err) => {
                this.emitWarningLog('Socket error from ' + client.getLabel() + ': ' + JSON.stringify(err));
            }).on('socketTimeout', (reason) => {
                this.emitWarningLog('Connected timed out for ' + client.getLabel() + ': ' + reason);
            }).on('socketDisconnect', () => {
            }).on('kickedBannedIP', (remainingBanTime) => {
                this.emitLog('Rejected incoming connection from ' + client.remoteAddress + ' banned for ' + remainingBanTime + ' more seconds');
            }).on('forgaveBannedIP', () => {
                this.emitLog('Forgave banned IP ' + client.remoteAddress);
            }).on('unknownStratumMethod', (fullMessage) => {
                this.emitLog('Unknown stratum method from ' + client.getLabel() + ': ' + fullMessage.method);
            }).on('socketFlooded', () => {
                this.emitWarningLog('Detected socket flooding from ' + client.getLabel());
            }).on('tcpProxyError', (data) => {
                this.emitErrorLog('Client IP detection failed, tcpProxyProtocol is enabled yet did not receive proxy protocol message, instead got data: ' + data);
            }).on('bootedBannedWorker', () => {
                this.emitWarningLog('Booted worker ' + client.getLabel() + ' who was connected from an IP address that was just banned');
            }).on('triggerBan', (reason) => {
                this.emitWarningLog('Banned triggered for ' + client.getLabel() + ': ' + reason);
                this.emit('banIP', client.remoteAddress, client.workerName);
            });
        });
    }

    setupBlockPolling() {
        if (typeof this.options.blockRefreshInterval !== 'number' || this.options.blockRefreshInterval <= 0) {
            this.emitLog('Block template polling has been disabled');
            return;
        }

        const pollingInterval = this.options.blockRefreshInterval;

        this.blockPollingIntervalId = setInterval(() => {
            this.getBlockTemplate((error, result, foundNewBlock) => {
                if (foundNewBlock) {
                    this.emitLog('Block notification via RPC polling');
                }
            });
        }, pollingInterval);
    }

    getBlockTemplate(callback) {
        this.daemon.cmd('getblocktemplate', [{}], (result) => {
            if (result.error) {
                this.emitErrorLog('getblocktemplate call failed for daemon instance ' +
                    result.instance.index + ' with error ' + JSON.stringify(result.error));
                callback(result.error);
            } else {
                const processedNewBlock = this.jobManager.processTemplate(result.response);
                callback(null, result.response, processedNewBlock);
            }
        }, true);
    }

    checkBlockAccepted(blockHash, callback) {
        console.log('DEBUG: checkBlockAccepted called with hash:', blockHash);
        this.daemon.cmd('getblock', [blockHash], (results) => {
            console.log('DEBUG: getblock results:', JSON.stringify(results, null, 2));
            const validResults = results.filter((result) => {
                return result.response && result.response.hash === blockHash;
            });

            console.log('DEBUG: validResults count:', validResults.length);
            if (validResults.length >= 1) {
                callback(true, validResults[0].response.tx[0]);
            } else {
                callback(false);
            }
        });
    }

    processBlockNotify(blockHash, sourceTrigger) {
        this.emitLog('Block notification via ' + sourceTrigger);
        if (typeof this.jobManager.currentJob !== 'undefined' &&
            blockHash !== this.jobManager.currentJob.rpcData.previousblockhash) {
            this.getBlockTemplate((error, result) => {
                if (error) {
                    this.emitErrorLog('Block notify error getting block template for ' + this.options.coin.name);
                }
            });
        }
    }

    setVarDiff(port, varDiffConfig) {
        if (typeof this.varDiff[port] !== 'undefined') {
            this.varDiff[port].removeAllListeners();
        }

        const varDiffInstance = new varDiff(port, varDiffConfig);
        this.varDiff[port] = varDiffInstance;

        this.varDiff[port].on('newDifficulty', (client, newDiff) => {
            client.enqueueNextDifficulty(newDiff);
        });
    }

    getStratumServer() {
        return this.stratumServer;
    }
}

module.exports = function(options, authorizeFn) {
    return new Pool(options, authorizeFn);
};

module.exports.Pool = Pool;
