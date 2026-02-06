# Difficulty Multiplier Fix: 32768 -> 2

## Summary

Changed `multiplier` in `lib/algoProperties.js` from `32768` to `2` for both `bitokpow` and `yespower` algorithm entries.

The old value of 32768 was calculated under the **wrong assumption** that cpuminer-opt uses raw Bitcoin difficulty (diff1 = 2^224) for yespower. In reality, cpuminer-opt already adapts for yespower internally.

---

## Root Cause

### Three different diff1 values in play

| System | diff1 target | Leading zero bits | Source |
|--------|-------------|-------------------|--------|
| Bitcoin (raw) | 2^224 | 32 | `~uint256(0) >> 32` |
| cpuminer-opt yespower | 2^240 | 16 | `opt_target_factor = 65536` applied to Bitcoin's 2^224 |
| Bitok | 2^239 | 17 | `bnProofOfWorkLimit = ~uint256(0) >> 17`, compact `0x1e7fffff` |

### What cpuminer-opt does (yespower-gate.c)

cpuminer-opt registers **all yespower variants** with:

```c
opt_target_factor = 65536.0;  // 2^16
```

This is applied in `stratum_gen_work` (cpu-miner.c):

```c
g_work->targetdiff = sctx->job.diff / (opt_target_factor * opt_diff_factor);
```

Then `diff_to_hash` converts using Bitcoin's base formula (diff1 = 2^224):

```
target = 2^224 / targetdiff
       = 2^224 / (D / 65536)
       = 2^224 * 65536 / D
       = 2^240 / D
```

**cpuminer's effective diff1 for yespower = 2^240 (16 leading zero bits)**

### The old (wrong) multiplier calculation

The old multiplier of 32768 = 2^15 was derived as:

```
Bitcoin_diff1 / Bitok_diff1 = 2^224 / 2^239 → ratio requires 2^15 = 32768
```

This assumed cpuminer uses raw Bitcoin diff1 (2^224) for yespower. **It does not.** cpuminer already bridges 2^16 of the gap via `opt_target_factor = 65536`.

### The correct multiplier

```
cpuminer_diff1 / Bitok_diff1 = 2^240 / 2^239 = 2
```

Most yespower coins use `>> 16` (diff1 = 2^240), perfectly matching cpuminer's factor. Bitok uses `>> 17` (diff1 = 2^239), creating a factor-of-2 gap. The multiplier of `2` bridges this gap.

---

## What was broken (old multiplier = 32768)

### Share difficulty was inflated 16,384x

When pool sent `mining.set_difficulty [0.5]`:

- cpuminer target = 2^240 / 0.5 = 2^241
- Miner found hash at boundary: Bitok_diff = 2^239 / 2^241 = 0.25
- Pool calculated: `shareDiff = (2^239 / hash) * 32768 = 0.25 * 32768 = 8192`
- Pool checked: `8192 >= 0.5` -> accepted (inflated 16,384x over the threshold)

### Low-difficulty share rejection was broken

The check at `jobManager.js:185`:

```javascript
if (shareDiff / difficulty < 0.99) {
    return shareError([23, 'low difficulty share']);
}
```

With the inflated shareDiff (8192 vs threshold 0.5), even extremely weak shares passed validation. The effective minimum acceptance threshold was `0.5 / 32768 = 0.0000153` instead of `0.5`.

### Difficulty stats/display were inflated 32,768x

- `blockDiffAdjusted = job.difficulty * 32768` (should be `* 2`)
- Console output `Current Block Diff` was 32,768x too high
- Share difficulty reported in events was 32,768x too high

### VarDiff operated on wrong scale

VarDiff compared share arrival times against target times and adjusted difficulty proportionally. While the relative adjustments were correct, the absolute difficulty values sent to miners were in Bitok terms while cpuminer interpreted them against its 2^240 diff1. The 2x discrepancy meant miners always mined at half the intended difficulty.

### Block validation was NOT affected

Block candidate detection (`jobManager.js:167`) uses direct target comparison:

```javascript
const isBlockCandidate = job.target >= headerBigNum;
```

This compares the hash directly against the network target from the daemon with no multiplier involved. Blocks were always validated correctly regardless of the multiplier bug.

---

## What the fix does (multiplier = 2)

### Correct share validation

When pool sends `mining.set_difficulty [0.5]`:

- cpuminer target = 2^240 / 0.5 = 2^241
- Miner hash at boundary: h = 2^241
- Pool: `shareDiff = (2^239 / 2^241) * 2 = 0.25 * 2 = 0.5`
- Check: `0.5 >= 0.5` -> accepted (exact match at boundary)

Verification for other difficulties:

| Pool diff D | cpuminer target | Hash at boundary | shareDiff = (diff1/h)*2 | Check |
|------------|----------------|-----------------|------------------------|-------|
| 0.5 | 2^241 | 2^241 | 0.5 | 0.5 >= 0.5 pass |
| 1 | 2^240 | 2^240 | 1.0 | 1.0 >= 1.0 pass |
| 8 | 2^237 | 2^237 | 8.0 | 8.0 >= 8.0 pass |
| 16 | 2^236 | 2^236 | 16.0 | 16.0 >= 16.0 pass |

### Correct low-diff rejection

Shares below the threshold are now properly rejected. A share at half the required difficulty:

- Pool diff = 0.5, hash with Bitok_diff = 0.125
- `shareDiff = 0.125 * 2 = 0.25`
- Check: `0.25 / 0.5 = 0.5 < 0.99` -> rejected

### Correct stats/display

- `blockDiffAdjusted` now shows `networkDiff * 2` (matches the cpuminer-equivalent scale)
- Share difficulties in logs match what miners actually target

---

## Hashrate formula (unchanged)

The hashrate calculation in `pool-server/src/db/redis.js` uses:

```javascript
hashrate = (normalizedDiff * Math.pow(2, 16)) / timeWindow;
```

This uses `2^16 = 65536`, NOT `2^17 = 131072`. This is **correct** because:

- Bitok diff1 = 2^239 requires 2^17 hashes per difficulty unit
- But pool-assigned difficulty D maps to actual Bitok difficulty D/2 (due to the 2x diff1 gap)
- So: `hashrate = (D/2) * 2^17 / time = D * 2^16 / time`

The formula correctly compensates for the mismatch between pool-assigned difficulty and actual mining difficulty.

---

## Files changed

| File | Change |
|------|--------|
| `lib/algoProperties.js` | `multiplier: 32768` -> `multiplier: 2` (both `bitokpow` and `yespower` entries) |

No other files require changes. All multiplier consumers (`jobManager.js`, `pool.js`) read from `algoProperties.js` dynamically.

---

## Impact on existing data

- **Redis share data**: Stored share difficulties are pool-assigned values (e.g., 0.5), not multiplied values. No migration needed.
- **PostgreSQL shares/blocks**: Block difficulties stored via `blockDiffActual` use raw Bitok difficulty (no multiplier). No migration needed.
- **Historical hashrate**: Was calculated with `2^16` formula from pool-assigned difficulties. Still correct.
- **Displayed block difficulty on pool web UI**: Will now show correct values instead of 32,768x inflated values.

---

## Why Bitok uses >> 17 instead of >> 16

Most yespower coins (Tidecoin, Cranepay, etc.) use `bnProofOfWorkLimit = ~uint256(0) >> 16`, which gives diff1 = 2^240 and perfectly matches cpuminer-opt's `opt_target_factor = 65536`.

Bitok chose `>> 17` (diff1 = 2^239), making the minimum difficulty target 2x harder than the yespower standard. This is a valid design choice -- it means Bitok's "difficulty 1" represents twice as much work as other yespower coins' "difficulty 1". The multiplier of 2 bridges this gap at the pool level.
