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
