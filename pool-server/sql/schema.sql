-- Bitok Mining Pool Database Schema

CREATE TABLE IF NOT EXISTS blocks (
    id SERIAL PRIMARY KEY,
    height INTEGER NOT NULL,
    hash VARCHAR(64) NOT NULL UNIQUE,
    reward BIGINT NOT NULL,
    difficulty DOUBLE PRECISION NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    confirmed BOOLEAN DEFAULT FALSE,
    confirmations INTEGER DEFAULT 0,
    paid BOOLEAN DEFAULT FALSE,
    credited BOOLEAN DEFAULT FALSE,
    miner_address VARCHAR(64),
    worker_name VARCHAR(128)
);

CREATE TABLE IF NOT EXISTS shares (
    id SERIAL PRIMARY KEY,
    miner_address VARCHAR(64) NOT NULL,
    worker_name VARCHAR(128) NOT NULL,
    difficulty DOUBLE PRECISION NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    ip_address VARCHAR(45),
    is_valid BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS miners (
    address VARCHAR(64) PRIMARY KEY,
    first_seen TIMESTAMP NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMP NOT NULL DEFAULT NOW(),
    total_shares BIGINT DEFAULT 0,
    total_blocks INTEGER DEFAULT 0,
    total_paid BIGINT DEFAULT 0,
    balance BIGINT DEFAULT 0,
    immature BIGINT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    miner_address VARCHAR(64) NOT NULL,
    amount BIGINT NOT NULL,
    tx_hash VARCHAR(64),
    timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    status VARCHAR(20) DEFAULT 'pending',
    error_message TEXT,
    blocks_included INTEGER[]
);

CREATE TABLE IF NOT EXISTS pool_stats (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    hashrate BIGINT DEFAULT 0,
    miners INTEGER DEFAULT 0,
    workers INTEGER DEFAULT 0,
    blocks_found INTEGER DEFAULT 0,
    difficulty DOUBLE PRECISION DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_blocks_height ON blocks(height DESC);
CREATE INDEX IF NOT EXISTS idx_blocks_timestamp ON blocks(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_shares_miner ON shares(miner_address);
CREATE INDEX IF NOT EXISTS idx_shares_timestamp ON shares(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_payments_miner ON payments(miner_address);
CREATE INDEX IF NOT EXISTS idx_payments_timestamp ON payments(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_pool_stats_timestamp ON pool_stats(timestamp DESC);
