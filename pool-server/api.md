# Bitok Pool API Documentation

Base URL: `http://<host>:<port>/api`

## Endpoints

### GET /stats

Returns pool configuration and current statistics.

**Response:**
```json
{
  "pool": {
    "name": "Bitok Pool",
    "symbol": "BITOK",
    "algorithm": "bitokpow",
    "fee": 1,
    "blockReward": 5000000000,
    "blockTime": 60,
    "paymentThreshold": 100000000,
    "coinbaseMaturity": 100,
    "paymentInterval": 3600
  },
  "stats": {
    "hashrate": 125000000,
    "miners": 5,
    "workers": 12,
    "blocksFound": 142,
    "difficulty": 0.00125,
    "height": 15234,
    "lastBlockTime": 1706195967000
  },
  "payments": {
    "lastPaymentTime": 1706192400000,
    "paymentInterval": 3600000,
    "nextPaymentTime": 1706196000000
  },
  "stratum": {
    "host": "pool.example.com",
    "port": 3333
  }
}
```

---

### GET /blocks

Returns paginated list of blocks found by the pool.

**Query Parameters:**
| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| page | number | 1 | - | Page number |
| limit | number | 20 | 100 | Results per page |

**Response:**
```json
{
  "blocks": [
    {
      "height": 15234,
      "hash": "000000abc123...",
      "reward": 5000000000,
      "difficulty": 0.00125,
      "timestamp": 1706195967000,
      "confirmed": true,
      "confirmations": 150,
      "paid": true,
      "miner": "1ABC123...",
      "worker": "rig1"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 142,
    "pages": 8
  }
}
```

---

### GET /payments

Returns paginated list of all pool payments.

**Query Parameters:**
| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| page | number | 1 | - | Page number |
| limit | number | 20 | 100 | Results per page |

**Response:**
```json
{
  "payments": [
    {
      "address": "1ABC123...",
      "amount": 500000000,
      "txHash": "tx123abc...",
      "timestamp": 1706192400000,
      "status": "paid"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 85,
    "pages": 5
  }
}
```

---

### GET /miners

Returns paginated list of online miners sorted by hashrate.

**Query Parameters:**
| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| page | number | 1 | - | Page number |
| limit | number | 20 | 100 | Results per page |

**Response:**
```json
{
  "miners": [
    {
      "address": "1ABC123...",
      "hashrate": 50000000,
      "shares": 12500,
      "workers": 3,
      "lastShare": 1706195900000
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 5,
    "pages": 1
  }
}
```

---

### GET /miners/:address

Returns detailed statistics for a specific miner.

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| address | string | Miner's wallet address |

**Response:**
```json
{
  "address": "1ABC123...",
  "hashrate": 50000000,
  "shares": 12500,
  "sessionShares": 250,
  "lastShare": 1706195900000,
  "workers": [
    {
      "name": "rig1",
      "hashrate": 25000000,
      "shares": 125,
      "lastShare": 1706195900000
    },
    {
      "name": "rig2",
      "hashrate": 25000000,
      "shares": 125,
      "lastShare": 1706195850000
    }
  ],
  "payments": [
    {
      "amount": 500000000,
      "txHash": "tx123abc...",
      "timestamp": 1706192400000,
      "status": "paid"
    }
  ],
  "totals": {
    "paid": 2500000000,
    "blocks": 5,
    "shares": 12500
  },
  "balance": {
    "immature": 250000000,
    "pending": 150000000,
    "paid": 2500000000,
    "immatureBitok": 2.5,
    "pendingBitok": 1.5,
    "paidBitok": 25.0
  }
}
```

**Error Response (404):**
```json
{
  "error": "Miner not found"
}
```

---

### GET /miners/:address/balance

Returns balance information for a specific miner.

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| address | string | Miner's wallet address |

**Response:**
```json
{
  "address": "1ABC123...",
  "immature": 250000000,
  "pending": 150000000,
  "paid": 2500000000,
  "immatureBitok": 2.5,
  "pendingBitok": 1.5,
  "paidBitok": 25.0
}
```

**Balance Types:**
- `immature` - Earnings from unconfirmed blocks (< 100 confirmations)
- `pending` - Confirmed earnings awaiting payment
- `paid` - Total amount already paid out

---

### GET /hashrate

Returns pool hashrate history.

**Query Parameters:**
| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| hours | number | 24 | 168 | Hours of history |

**Response:**
```json
{
  "history": [
    {
      "timestamp": 1706192400000,
      "hashrate": 125000000
    },
    {
      "timestamp": 1706196000000,
      "hashrate": 130000000
    }
  ]
}
```

---

### GET /diagnostics

Returns pool diagnostics and accounting summary.

**Response:**
```json
{
  "blocks": {
    "total": 142,
    "confirmed": 135,
    "unconfirmed": 5,
    "creditedToBalance": 130,
    "pendingCredit": 5,
    "orphaned": 2,
    "totalRewardsSatoshi": 710000000000,
    "totalRewardsBitok": 7100.0
  },
  "miners": {
    "count": 25,
    "totalPendingSatoshi": 1500000000,
    "totalPendingBitok": 15.0,
    "totalImmatureSatoshi": 2500000000,
    "totalImmatureBitok": 25.0,
    "totalPaidSatoshi": 650000000000,
    "totalPaidBitok": 6500.0
  },
  "payments": {
    "count": 85,
    "totalPaidSatoshi": 650000000000,
    "totalPaidBitok": 6500.0,
    "failedCount": 0
  },
  "verification": {
    "confirmedBlockRewardsBitok": 6750.0,
    "expectedToMinersBitok": 6682.5,
    "actualPaidPlusPendingBitok": 6515.0,
    "immatureBlockRewardsBitok": 250.0,
    "expectedImmatureBitok": 247.5,
    "actualImmatureBitok": 25.0,
    "discrepancyBitok": 167.5
  },
  "poolFeePercent": 1
}
```

---

### GET /reconciliation

Returns detailed per-miner earnings reconciliation based on confirmed blocks.

**Response:**
```json
{
  "summary": {
    "confirmedBlocks": 135,
    "totalExpectedSatoshi": 668250000000,
    "totalExpectedBitok": 6682.5,
    "totalActualCreditedSatoshi": 651500000000,
    "totalActualCreditedBitok": 6515.0,
    "totalDiscrepancySatoshi": -16750000000,
    "totalDiscrepancyBitok": -167.5,
    "overPaymentBitok": 0
  },
  "miners": [
    {
      "address": "1ABC123...",
      "expectedSatoshi": 150000000000,
      "expectedBitok": 1500.0,
      "actualCreditedSatoshi": 148500000000,
      "actualCreditedBitok": 1485.0,
      "balanceSatoshi": 50000000,
      "balanceBitok": 0.5,
      "paidSatoshi": 148450000000,
      "paidBitok": 1484.5,
      "discrepancySatoshi": -1500000000,
      "discrepancyBitok": -15.0
    }
  ]
}
```

**Note:** Miners are sorted by absolute discrepancy (largest first).

---

## Units

All monetary values are returned in both satoshi (smallest unit) and BITOK:

- `1 BITOK = 100,000,000 satoshi`
- Fields ending in `Satoshi` contain the raw integer value
- Fields ending in `Bitok` contain the human-readable decimal value

## Timestamps

All timestamps are Unix milliseconds (JavaScript `Date.now()` format).

## Error Responses

All endpoints return errors in this format:

```json
{
  "error": "Error description"
}
```

Common HTTP status codes:
- `200` - Success
- `404` - Resource not found
- `500` - Internal server error
