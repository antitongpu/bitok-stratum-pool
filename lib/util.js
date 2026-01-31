const crypto = require('crypto');

exports.sha256 = function(buffer) {
    const hash1 = crypto.createHash('sha256');
    hash1.update(buffer);
    return hash1.digest();
};

exports.sha256d = function(buffer) {
    return exports.sha256(exports.sha256(buffer));
};

exports.reverseBuffer = function(buff) {
    const reversed = Buffer.alloc(buff.length);
    for (let i = buff.length - 1; i >= 0; i--)
        reversed[buff.length - i - 1] = buff[i];
    return reversed;
};

exports.reverseHex = function(hex) {
    return exports.reverseBuffer(Buffer.from(hex, 'hex')).toString('hex');
};

exports.reverseByteOrder = function(buff) {
    for (let i = 0; i < 8; i++) buff.writeUInt32LE(buff.readUInt32BE(i * 4), i * 4);
    return exports.reverseBuffer(buff);
};

exports.uint256BufferFromHash = function(hex) {
    let fromHex = Buffer.from(hex, 'hex');

    if (fromHex.length !== 32) {
        const empty = Buffer.alloc(32);
        fromHex.copy(empty);
        fromHex = empty;
    }

    return exports.reverseBuffer(fromHex);
};

exports.hexFromReversedBuffer = function(buffer) {
    return exports.reverseBuffer(buffer).toString('hex');
};

exports.varIntBuffer = function(n) {
    if (n < 0xfd)
        return Buffer.from([n]);
    else if (n <= 0xffff) {
        const buff = Buffer.alloc(3);
        buff[0] = 0xfd;
        buff.writeUInt16LE(n, 1);
        return buff;
    }
    else if (n <= 0xffffffff) {
        const buff = Buffer.alloc(5);
        buff[0] = 0xfe;
        buff.writeUInt32LE(n, 1);
        return buff;
    }
    else {
        const buff = Buffer.alloc(9);
        buff[0] = 0xff;
        exports.packUInt16LE(n).copy(buff, 1);
        return buff;
    }
};

exports.varStringBuffer = function(string) {
    const strBuff = Buffer.from(string);
    return Buffer.concat([exports.varIntBuffer(strBuff.length), strBuff]);
};

exports.serializeNumber = function(n) {
    if (n >= 1 && n <= 16) return Buffer.from([0x50 + n]);
    let l = 1;
    const buff = Buffer.alloc(9);
    while (n > 0x7f) {
        buff.writeUInt8(n & 0xff, l++);
        n >>= 8;
    }
    buff.writeUInt8(l, 0);
    buff.writeUInt8(n, l++);
    return buff.slice(0, l);
};

exports.serializeString = function(s) {
    if (s.length < 253)
        return Buffer.concat([
            Buffer.from([s.length]),
            Buffer.from(s)
        ]);
    else if (s.length < 0x10000)
        return Buffer.concat([
            Buffer.from([253]),
            exports.packUInt16LE(s.length),
            Buffer.from(s)
        ]);
    else if (s.length < 0x100000000)
        return Buffer.concat([
            Buffer.from([254]),
            exports.packUInt32LE(s.length),
            Buffer.from(s)
        ]);
    else
        return Buffer.concat([
            Buffer.from([255]),
            exports.packUInt16LE(s.length),
            Buffer.from(s)
        ]);
};

exports.packUInt16LE = function(num) {
    const buff = Buffer.alloc(2);
    buff.writeUInt16LE(num, 0);
    return buff;
};

exports.packInt32LE = function(num) {
    const buff = Buffer.alloc(4);
    buff.writeInt32LE(num, 0);
    return buff;
};

exports.packInt32BE = function(num) {
    const buff = Buffer.alloc(4);
    buff.writeInt32BE(num, 0);
    return buff;
};

exports.packUInt32LE = function(num) {
    const buff = Buffer.alloc(4);
    buff.writeUInt32LE(num, 0);
    return buff;
};

exports.packUInt32BE = function(num) {
    const buff = Buffer.alloc(4);
    buff.writeUInt32BE(num, 0);
    return buff;
};

exports.packInt64LE = function(num) {
    const buff = Buffer.alloc(8);
    buff.writeUInt32LE(num % Math.pow(2, 32), 0);
    buff.writeUInt32LE(Math.floor(num / Math.pow(2, 32)), 4);
    return buff;
};

exports.range = function(start, stop, step) {
    if (typeof stop === 'undefined') {
        stop = start;
        start = 0;
    }
    if (typeof step === 'undefined') {
        step = 1;
    }
    if ((step > 0 && start >= stop) || (step < 0 && start <= stop)) {
        return [];
    }
    const result = [];
    for (let i = start; step > 0 ? i < stop : i > stop; i += step) {
        result.push(i);
    }
    return result;
};

exports.pubkeyToScript = function(key) {
    const keyBuffer = Buffer.from(key, 'hex');
    if (keyBuffer.length === 33) {
        const script = Buffer.alloc(35);
        script[0] = 0x21;
        keyBuffer.copy(script, 1);
        script[34] = 0xac;
        return script;
    } else if (keyBuffer.length === 65) {
        const script = Buffer.alloc(67);
        script[0] = 0x41;
        keyBuffer.copy(script, 1);
        script[66] = 0xac;
        return script;
    } else {
        console.error('Invalid pubkey length: ' + keyBuffer.length + ' (expected 33 or 65 bytes)');
        throw new Error('Invalid pubkey');
    }
};

exports.miningKeyToScript = function(key) {
    const keyBuffer = Buffer.from(key, 'hex');
    return Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), keyBuffer, Buffer.from([0x88, 0xac])]);
};

exports.addressToScript = function(addr) {
    const decoded = base58Decode(addr);

    if (decoded.length !== 25) {
        console.error('invalid address length for ' + addr);
        throw new Error();
    }

    if (!decoded) {
        console.error('base58 decode failed for ' + addr);
        throw new Error();
    }

    const pubkey = decoded.slice(1, -4);

    return Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), pubkey, Buffer.from([0x88, 0xac])]);
};

function base58Decode(str) {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const ALPHABET_MAP = {};
    for (let i = 0; i < ALPHABET.length; i++) {
        ALPHABET_MAP[ALPHABET.charAt(i)] = BigInt(i);
    }
    const BASE = 58n;

    let num = 0n;
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        num = num * BASE + ALPHABET_MAP[char];
    }

    let leadingZeros = 0;
    for (let i = 0; i < str.length && str[i] === '1'; i++) {
        leadingZeros++;
    }

    const hex = num.toString(16);
    const hexPadded = hex.length % 2 === 0 ? hex : '0' + hex;
    const result = Buffer.concat([
        Buffer.alloc(leadingZeros),
        Buffer.from(hexPadded, 'hex')
    ]);

    return result;
}

exports.getReadableHashRateString = function(hashrate) {
    let i = -1;
    const byteUnits = [' KH', ' MH', ' GH', ' TH', ' PH'];
    do {
        hashrate = hashrate / 1024;
        i++;
    } while (hashrate > 1024);
    return hashrate.toFixed(2) + byteUnits[i];
};

exports.shiftMax256Right = function(shiftRight) {
    const arr256 = Array(256).fill(1);
    const arrLeft = Array(shiftRight).fill(0);
    const arr = arrLeft.concat(arr256).slice(0, 256);

    const octets = [];

    for (let i = 0; i < 32; i++) {
        octets[i] = 0;
        const bits = arr.slice(i * 8, i * 8 + 8);

        for (let f = 0; f < bits.length; f++) {
            const multiplier = Math.pow(2, f);
            octets[i] += bits[f] * multiplier;
        }
    }

    return Buffer.from(octets);
};

exports.bufferToCompactBits = function(startingBuff) {
    let bigNum = BigInt('0x' + startingBuff.toString('hex'));
    let buff = Buffer.from(bigNum.toString(16), 'hex');

    buff = buff.readUInt8(0) > 0x7f ? Buffer.concat([Buffer.from([0x00]), buff]) : buff;
    buff = Buffer.concat([Buffer.from([buff.length]), buff]);
    const compact = buff.slice(0, 4);
    return compact;
};

exports.bignumFromBitsBuffer = function(bitsBuff) {
    const numBytes = bitsBuff.readUInt8(0);
    const bigBits = BigInt('0x' + bitsBuff.slice(1).toString('hex'));
    const target = bigBits * (2n ** (8n * BigInt(numBytes - 3)));
    return target;
};

exports.bignumFromBitsHex = function(bitsString) {
    const bitsBuff = Buffer.from(bitsString, 'hex');
    return exports.bignumFromBitsBuffer(bitsBuff);
};

exports.convertBitsToBuff = function(bitsBuff) {
    const target = exports.bignumFromBitsBuffer(bitsBuff);
    const hex = target.toString(16).padStart(64, '0');
    return Buffer.from(hex, 'hex');
};

exports.getTruncatedDiff = function(shift) {
    return exports.convertBitsToBuff(exports.bufferToCompactBits(exports.shiftMax256Right(shift)));
};
