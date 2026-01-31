const bitokpow = require('./bitokpow.js');

const diff1 = global.diff1 = 0x00007fffff000000000000000000000000000000000000000000000000000000n;

const algos = module.exports = global.algos = {
    bitokpow: {
        multiplier: 32768,
        diff1: 0x00007fffff000000000000000000000000000000000000000000000000000000n,
        hash: function() {
            return function(data) {
                return bitokpow.hash(data);
            };
        }
    },
    yespower: {
        multiplier: 32768,
        diff1: 0x00007fffff000000000000000000000000000000000000000000000000000000n,
        hash: function() {
            return function(data) {
                return bitokpow.hash(data);
            };
        }
    }
};

for (const algo in algos) {
    if (!algos[algo].multiplier) {
        algos[algo].multiplier = 1;
    }
}
