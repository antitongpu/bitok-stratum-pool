'use strict';

require('./algoProperties.js');

const pool = require('./pool.js');

exports.daemon = require('./daemon.js');
exports.varDiff = require('./varDiff.js');

exports.createPool = function(poolOptions, authorizeFn) {
    return pool(poolOptions, authorizeFn);
};
