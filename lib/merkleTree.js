const util = require('./util.js');

class MerkleTree {
    constructor(data) {
        this.data = data;
        this.steps = this.calculateSteps(data);
    }

    merkleJoin(h1, h2) {
        const joined = Buffer.concat([h1, h2]);
        return util.sha256d(joined);
    }

    calculateSteps(data) {
        let L = data;
        const steps = [];
        const PreL = [null];
        const StartL = 2;

        if (L.length > 1) {
            while (true) {
                if (L.length === 1) break;

                steps.push(L[1]);

                if (L.length % 2) {
                    L.push(L[L.length - 1]);
                }

                const Ld = [];
                const r = util.range(StartL, L.length, 2);
                for (const i of r) {
                    Ld.push(this.merkleJoin(L[i], L[i + 1]));
                }
                L = PreL.concat(Ld);
            }
        }
        return steps;
    }

    withFirst(f) {
        for (const s of this.steps) {
            f = util.sha256d(Buffer.concat([f, s]));
        }
        return f;
    }
}

module.exports = MerkleTree;
