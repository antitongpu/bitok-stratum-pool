# Bitok Mining Pool

A full-featured mining pool for Bitok with web UI, built with Node.js 22.

## Features

- Stratum mining server with vardiff support
- **Automated payout system** with Bitok RPC integration
- Real-time hashrate tracking via Redis
- Block and payment history via PostgreSQL
- Retro dark-themed web UI
- Miner statistics with worker breakdown
- Block explorer integration (bitokd.run)
- PROP (Proportional) reward distribution

## Requirements

- Node.js 22+
- Redis server
- PostgreSQL database
- Bitok daemon (bitcoind) with RPC enabled

## Quick Start

1. **Set up the database**

```bash
psql -U postgres -c "CREATE DATABASE bitok_pool;"
psql -U postgres -d bitok_pool -f sql/schema.sql
```

2. **Configure environment**

```bash
cp .env.example .env
# Edit .env with your settings
```

3. **Start the pool**

```bash
npm install
npm start
```

The pool will start:
- Stratum server on port 3032 (default)
- Web UI on port 8080 (default)

## Mining

Connect your miner:

```bash
cpuminer -a yespower -o stratum+tcp://YOUR_POOL_HOST:3032 -u YOUR_BITOK_ADDRESS.worker1
```

## Configuration

See `.env.example` for all configuration options:

| Variable | Description |
|----------|-------------|
| POOL_ADDRESS | Pool's Bitok address for block rewards |
| RPC_HOST/PORT/USER/PASSWORD | Bitok daemon RPC connection |
| POOL_FEE | Pool fee percentage (default: 1%) |
| PAYMENT_THRESHOLD | Minimum payout (default: 1 BITOK) |
| STRATUM_PORT | Stratum server port (default: 3032) |
| WEB_PORT | Web UI port (default: 8080) |
| REDIS_HOST/PORT | Redis connection |
| PG_HOST/PORT/DATABASE/USER/PASSWORD | PostgreSQL connection |

## Automated Payments

The pool includes a fully automated payment system that:

- Calculates payouts using PROP (Proportional) share distribution
- Automatically pays miners when balance exceeds threshold
- Uses Bitok RPC `sendtoaddress` for secure transactions
- Tracks all payments with transaction IDs
- Requires 10 block confirmations before payout

**Payment Configuration:**
```bash
POOL_FEE=1.0              # Pool fee percentage
PAYMENT_THRESHOLD=1.0     # Minimum payout in BITOK
PAYMENT_INTERVAL=3600     # Payment interval in seconds
```

**How it works:**
1. Miners submit shares which are recorded with difficulty
2. When a block is found, it's marked as pending
3. After 10 confirmations, block is marked as confirmed
4. Payment processor calculates each miner's share
5. Payments sent automatically via RPC every hour
6. Transaction IDs stored for audit trail

See [PAYMENTS.md](./PAYMENTS.md) for detailed documentation.

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| GET /api/stats | Pool statistics |
| GET /api/blocks | Block list with pagination |
| GET /api/payments | Payment history |
| GET /api/miners | Active miners list |
| GET /api/miners/:address | Individual miner stats |
| GET /api/miners/:address/balance | Miner balance and payout status |
| GET /api/hashrate | Hashrate history |
