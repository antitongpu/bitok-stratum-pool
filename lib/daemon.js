'use strict';

const http = require('http');
const events = require('events');

class DaemonInterface extends events.EventEmitter {
    constructor(daemons, logger) {
        super();
        this.logger = logger || function(severity, message) {
            console.log(severity + ': ' + message);
        };
        this.instances = daemons.map((daemon, index) => {
            daemon.index = index;
            return daemon;
        });
    }

    init() {
        this.isOnline((online) => {
            if (online) {
                this.emit('online');
            }
        });
    }

    isOnline(callback) {
        this.cmd('getpeerinfo', [], (results) => {
            const allOnline = results.every((result) => !result.error);
            callback(allOnline);
            if (!allOnline) {
                this.emit('connectionFailed', results);
            }
        });
    }

    performHttpRequest(instance, jsonData, callback) {
        const options = {
            hostname: instance.host || '127.0.0.1',
            port: instance.port,
            method: 'POST',
            auth: instance.user + ':' + instance.password,
            headers: {
                'Content-Length': Buffer.byteLength(jsonData),
                'Content-Type': 'application/json'
            }
        };

        const parseJson = (res, data) => {
            let dataJson;

            if (res.statusCode === 401) {
                this.logger('error', 'Unauthorized RPC access - invalid RPC username or password');
                return;
            }

            try {
                dataJson = JSON.parse(data);
            } catch (e) {
                if (data.indexOf(':-nan') !== -1) {
                    data = data.replace(/:-nan,/g, ':0');
                    parseJson(res, data);
                    return;
                }
                this.logger('error', 'Could not parse rpc data from daemon instance ' + instance.index +
                    '\nRequest Data: ' + jsonData +
                    '\nResponse Data: ' + data);
            }

            if (dataJson) {
                callback(dataJson.error, dataJson, data);
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                parseJson(res, data);
            });
        });

        req.on('error', (e) => {
            if (e.code === 'ECONNREFUSED') {
                callback({ type: 'offline', message: e.message }, null);
            } else {
                callback({ type: 'request error', message: e.message }, null);
            }
        });

        req.end(jsonData);
    }

    batchCmd(cmdArray, callback) {
        const results = [];
        let completed = 0;
        const instance = this.instances[0];

        const executeNext = (index) => {
            if (index >= cmdArray.length) {
                callback(null, results);
                return;
            }

            const cmd = cmdArray[index];
            const requestJson = JSON.stringify({
                method: cmd[0],
                params: cmd[1],
                id: Date.now() + Math.floor(Math.random() * 10) + index
            });

            this.performHttpRequest(instance, requestJson, (error, result) => {
                if (error && error.type) {
                    callback(error, null);
                    return;
                }
                results[index] = result || { error: error };
                executeNext(index + 1);
            });
        };

        executeNext(0);
    }

    cmd(method, params, callback, streamResults, returnRawData) {
        const results = [];
        let completed = 0;
        const total = this.instances.length;

        this.instances.forEach((instance) => {
            const requestJson = JSON.stringify({
                method: method,
                params: params,
                id: Date.now() + Math.floor(Math.random() * 10)
            });

            this.performHttpRequest(instance, requestJson, (error, result, data) => {
                const returnObj = {
                    error: error,
                    response: (result || {}).result,
                    instance: instance
                };

                if (returnRawData) {
                    returnObj.data = data;
                }

                if (streamResults) {
                    callback(returnObj);
                } else {
                    results.push(returnObj);
                }

                completed++;
                if (completed === total && !streamResults) {
                    callback(results);
                }
            });
        });
    }
}

exports.interface = DaemonInterface;
