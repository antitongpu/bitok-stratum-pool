# Bitok Mining Pool - Complete Deployment Guide (check with code, can be outdated db structure setup)

Full step-by-step deployment guide for Bitok Mining Pool on Ubuntu VPS.

**Pool Features:**
- Stratum mining server with variable difficulty
- Automated PROP payout system
- Real-time hashrate statistics
- Web dashboard with miner stats
- 121-block coinbase maturity (Bitok requirement, you can set any other but pay gap to miners from your own funds)

**Example Domain:** lastbitcoin.org
**Web UI:** https://lastbitcoin.org
**Stratum:** stratum+tcp://lastbitcoin.org:3032

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Server Setup](#step-1-server-setup)
3. [Firewall Configuration](#step-2-firewall-configuration)
4. [Node.js Installation](#step-3-nodejs-22-installation)
5. [PostgreSQL Setup](#step-4-postgresql-database-setup)
6. [Redis Setup](#step-5-redis-setup)
7. [Bitok Daemon Setup](#step-6-bitok-daemon-installation)
8. [Pool Installation](#step-7-pool-installation)
9. [Database Schema](#step-8-database-schema-setup)
10. [Pool Configuration](#step-9-pool-configuration)
11. [Nginx & SSL](#step-10-nginx-with-ssl)
12. [Systemd Services](#step-11-systemd-services)
13. [Verification](#step-12-verification)

---

## Prerequisites

### Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 2 cores | 4+ cores |
| RAM | 2 GB | 4+ GB |
| Storage | 20 GB SSD | 50+ GB SSD |
| Bandwidth | 1 TB/month | Unlimited |

### Software Requirements

- Ubuntu 22.04 LTS or 24.04 LTS
- Domain name pointing to VPS IP (A record)
- Root SSH access

---

## Step 1: Server Setup

### 1.1 SSH into your VPS

```bash
ssh root@YOUR_VPS_IP
```

### 1.2 Update system packages

```bash
apt update && apt upgrade -y
```

### 1.3 Install required system packages

```bash
apt install -y \
    curl \
    wget \
    git \
    build-essential \
    nginx \
    certbot \
    python3-certbot-nginx \
    redis-server \
    postgresql \
    postgresql-contrib \
    ufw \
    htop \
    tmux \
    jq \
    autoconf \
    libtool \
    pkg-config \
    libboost-all-dev \
    libssl-dev \
    libevent-dev \
    bsdmainutils \
    libdb-dev \
    libdb++-dev
```

### 1.4 Set timezone (optional)

```bash
timedatectl set-timezone UTC
```

---

## Step 2: Firewall Configuration

### 2.1 Configure UFW firewall

```bash
# Reset firewall rules
ufw --force reset

# Default policies
ufw default deny incoming
ufw default allow outgoing

# Allow SSH (change port if you modify SSH later)
ufw allow 22/tcp comment 'SSH'

# Allow HTTP and HTTPS
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'

# Allow Stratum mining port
ufw allow 3032/tcp comment 'Stratum Mining'

# Allow Bitok P2P (optional, for full node connectivity)
ufw allow 18333/tcp comment 'Bitok P2P'

# Enable firewall
ufw --force enable

# Verify rules
ufw status verbose
```

Expected output:
```
Status: active

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW IN    Anywhere
80/tcp                     ALLOW IN    Anywhere
443/tcp                    ALLOW IN    Anywhere
3032/tcp                   ALLOW IN    Anywhere
18333/tcp                  ALLOW IN    Anywhere
```

---

## Step 3: Node.js 22 Installation

### 3.1 Install Node.js 22.x

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
```

### 3.2 Verify installation

```bash
node --version
npm --version
```

Expected output:
```
v22.x.x
10.x.x
```

### 3.3 Install node-gyp globally (for native addons)

```bash
npm install -g node-gyp
```

---

## Step 4: PostgreSQL Database Setup

### 4.1 Start and enable PostgreSQL

```bash
systemctl start postgresql
systemctl enable postgresql
systemctl status postgresql
```

### 4.2 Create database user and database

```bash
sudo -u postgres psql
```

Run these SQL commands (replace `CHANGE_THIS_PASSWORD` with a strong password):

```sql
-- Create user
CREATE USER bitokpool WITH PASSWORD 'CHANGE_THIS_PASSWORD';

-- Create database
CREATE DATABASE bitok_pool OWNER bitokpool;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE bitok_pool TO bitokpool;

-- Connect to database
\c bitok_pool

-- Grant schema privileges
GRANT ALL ON SCHEMA public TO bitokpool;

-- Exit
\q
```

### 4.3 Test database connection

```bash
PGPASSWORD='CHANGE_THIS_PASSWORD' psql -h localhost -U bitokpool -d bitok_pool -c "SELECT version();"
```

**SAVE THIS PASSWORD!** You'll need it for the pool configuration.

---

## Step 5: Redis Setup

### 5.1 Start and enable Redis

```bash
systemctl start redis-server
systemctl enable redis-server
systemctl status redis-server
```

### 5.2 Configure Redis (recommended)

Edit Redis configuration:

```bash
nano /etc/redis/redis.conf
```

Find and modify these settings:

```conf
# Bind to localhost only
bind 127.0.0.1 ::1

# Set a password (optional but recommended)
requirepass YOUR_REDIS_PASSWORD

# Set max memory
maxmemory 256mb
maxmemory-policy allkeys-lru

# Disable persistence for performance (pool data is in PostgreSQL)
save ""
appendonly no
```

Restart Redis:

```bash
systemctl restart redis-server
```

### 5.3 Test Redis connection

```bash
redis-cli ping
# Should return: PONG

# If you set a password:
redis-cli -a YOUR_REDIS_PASSWORD ping
```

---

## Step 6: Bitok Daemon Installation

### 6.1 Clone and build Bitok

```bash
cd /root
git clone https://github.com/elvisjedusor/bitok.git bitok-core
cd bitok-core
```

Build Bitok daemon:

```bash
make -f makefile.unix daemon
```

### 6.2 Create Bitok data directory

```bash
mkdir -p /root/.bitokd
```

### 6.3 Create Bitok configuration

Create config file:

```bash
cat > /root/.bitokd/bitok.conf << EOF
# Network
server=1
daemon=1


# RPC Configuration
rpcuser=bitokrpc
rpcpassword=YOUR_RPC_PASSWORD
rpcallowip=127.0.0.1
rpcport=8332

# Logging

debug=0
EOF
```

Secure the config file:

```bash
chmod 600 /root/.bitokd/bitok.conf
```

### 6.4 Start Bitok daemon

```bash
./bitokd
```

### 6.5 Wait for blockchain sync

Check sync progress:

```bash
# Check block count
./bitokd getblockcount

# Check detailed info
./bitokd getinfo

# Watch sync progress
watch -n 5 'bitokd getinfo | jq .'
```

**Wait until fully synced before proceeding!**

### 6.6 Generate pool address

```bash
# Generate new address for pool payouts
./bitokd getnewaddress "pool
```

SAVE THIS ADDRESS!

### 6.7 Check wallet balance (after mining)

```bash
./bitokd getbalance
```

---

## Step 7: Pool Installation

### 7.1 Clone pool repository

```bash
cd /root
git clone https://github.com/antitongpu/bitok-stratum-pool.git bitok-pool
cd bitok-pool
```

### 7.2 Install pool dependencies

```bash
# Install main stratum pool dependencies
npm install

# Verify native addon compiled
node -e "require('./lib/bitokpow.js'); console.log('BitokPoW module OK')"
```

### 7.3 Install pool-server dependencies

```bash
cd pool-server
npm install
```

---

## Step 8: Database Schema Setup

### 8.1 Create database tables

Connect to database and run schema:

```bash
cd /root/bitok-pool/pool-server
PGPASSWORD='YOUR_PG_PASSWORD' psql -h localhost -U bitokpool -d bitok_pool << 'EOSQL'

-- Bitok Mining Pool Database Schema

-- Blocks table (stores found blocks)
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
    miner_address VARCHAR(64),
    worker_name VARCHAR(128)
);

-- Shares table (stores miner shares)
CREATE TABLE IF NOT EXISTS shares (
    id SERIAL PRIMARY KEY,
    miner_address VARCHAR(64) NOT NULL,
    worker_name VARCHAR(128) NOT NULL,
    difficulty DOUBLE PRECISION NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    ip_address VARCHAR(45),
    is_valid BOOLEAN DEFAULT TRUE
);

-- Miners table (stores miner statistics)
CREATE TABLE IF NOT EXISTS miners (
    address VARCHAR(64) PRIMARY KEY,
    first_seen TIMESTAMP NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMP NOT NULL DEFAULT NOW(),
    total_shares BIGINT DEFAULT 0,
    total_blocks INTEGER DEFAULT 0,
    total_paid BIGINT DEFAULT 0
);

-- Payments table (stores payment history)
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

-- Pool stats table (stores historical pool statistics)
CREATE TABLE IF NOT EXISTS pool_stats (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    hashrate BIGINT DEFAULT 0,
    miners INTEGER DEFAULT 0,
    workers INTEGER DEFAULT 0,
    blocks_found INTEGER DEFAULT 0,
    difficulty DOUBLE PRECISION DEFAULT 0
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_blocks_height ON blocks(height DESC);
CREATE INDEX IF NOT EXISTS idx_blocks_timestamp ON blocks(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_blocks_confirmed ON blocks(confirmed);
CREATE INDEX IF NOT EXISTS idx_blocks_paid ON blocks(paid);
CREATE INDEX IF NOT EXISTS idx_blocks_confirmed_paid ON blocks(confirmed, paid);
CREATE INDEX IF NOT EXISTS idx_shares_miner ON shares(miner_address);
CREATE INDEX IF NOT EXISTS idx_shares_timestamp ON shares(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_payments_miner ON payments(miner_address);
CREATE INDEX IF NOT EXISTS idx_payments_timestamp ON payments(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_pool_stats_timestamp ON pool_stats(timestamp DESC);

-- Verify tables created
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';

EOSQL
```

### 8.2 Verify schema

```bash
PGPASSWORD='YOUR_PG_PASSWORD' psql -h localhost -U bitokpool -d bitok_pool -c "\dt"
```

Expected output:
```
            List of relations
 Schema |    Name     | Type  |   Owner
--------+-------------+-------+-----------
 public | blocks      | table | bitokpool
 public | miners      | table | bitokpool
 public | payments    | table | bitokpool
 public | pool_stats  | table | bitokpool
 public | shares      | table | bitokpool
```

### 8.3 Run migrations (for existing installations)

If upgrading an existing installation, run migrations:

```bash
# Migration 1: Update payments table
PGPASSWORD='YOUR_PG_PASSWORD' psql -h localhost -U bitokpool -d bitok_pool -f sql/migrations/001_update_payments_table.sql

# Migration 2: Add paid column to blocks
PGPASSWORD='YOUR_PG_PASSWORD' psql -h localhost -U bitokpool -d bitok_pool -f sql/migrations/002_add_paid_column.sql
```

---

## Step 9: Pool Configuration

### 9.1 Create environment file

```bash
cd /root/bitok-pool/pool-server

cat > .env << 'EOF'
# ===========================================
# BITOK MINING POOL CONFIGURATION
# ===========================================

# ----- Bitok Daemon RPC -----
RPC_HOST=127.0.0.1
RPC_PORT=8332
RPC_USER=bitokrpc
RPC_PASSWORD=RPC_PASSWORD

# ----- Pool Configuration -----
# Pool payout address (from bitokd getnewaddress)
POOL_ADDRESS=POOL_ADDRESS

# Pool fee percentage (1.0 = 1%)
POOL_FEE=1.0

# Block reward in BITOK (adjust if block reward changes)
BLOCK_REWARD=50

# Minimum payout threshold in BITOK
PAYMENT_THRESHOLD=1.0

# Payment processing interval in seconds (3600 = 1 hour)
PAYMENT_INTERVAL=3600

# ----- Stratum Server -----
STRATUM_HOST=lastbitcoin.org
STRATUM_PORT=3032

# ----- Web Server -----
# Bind to localhost, nginx will proxy
WEB_HOST=127.0.0.1
WEB_PORT=8080

# ----- Redis -----
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=REDIS_PASS

# ----- PostgreSQL -----
PG_HOST=127.0.0.1
PG_PORT=5432
PG_DATABASE=bitok_pool
PG_USER=bitokpool
PG_PASSWORD=YOUR_PG_PASSWORD
EOF
```

### 9.2 Edit configuration with your values

```bash
nano .env
```

Replace these placeholders:
- `PASTE_YOUR_RPC_PASSWORD_HERE` - RPC password from Step 6.3
- `PASTE_YOUR_POOL_ADDRESS_HERE` - Address from Step 6.6
- `PASTE_YOUR_PG_PASSWORD_HERE` - PostgreSQL password from Step 4.2
- `REDIS_PASSWORD` - Redis password if you set one (leave empty if not)
- `STRATUM_HOST` - Your domain name

### 9.3 Secure the environment file

```bash
chmod 600 .env
```

### 9.4 Test pool startup (manually)

```bash
cd /root/bitok-pool/pool-server
node src/full-pool.js
```

You should see:
```
Starting Bitok Mining Pool...
  Pool Fee: 1%
  Payment Threshold: 1 BITOK
  Stratum server started on port 3032
  Connect: stratum+tcp://lastbitcoin.org:3032
  Web server listening on http://127.0.0.1:8080
```

Press `Ctrl+C` to stop.

---

## Step 10: Nginx with SSL

### 10.1 Create HTTP-only Nginx configuration (for SSL certificate)

First, create an HTTP-only configuration so certbot can obtain SSL certificates:

```bash
cat > /etc/nginx/sites-available/bitok-pool << 'EOF'
# HTTP only - for SSL certificate acquisition
server {
    listen 80;
    listen [::]:80;
    server_name lastbitcoin.org www.lastbitcoin.org;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Proxy to pool server (temporary, will redirect to HTTPS after SSL setup)
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}
EOF
```

### 10.2 Enable site and test config

```bash
# Enable site
ln -sf /etc/nginx/sites-available/bitok-pool /etc/nginx/sites-enabled/

# Remove default site
rm -f /etc/nginx/sites-enabled/default

# Test configuration
nginx -t

# Reload nginx
systemctl reload nginx
```

### 10.3 Obtain SSL certificate

**Make sure your domain DNS is pointing to the VPS IP first!**

```bash
# Test DNS resolution
dig +short lastbitcoin.org

# Get SSL certificate (certbot will automatically update nginx config)
certbot --nginx -d lastbitcoin.org -d www.lastbitcoin.org
```

Follow the prompts:
1. Enter email address
2. Agree to terms (Y)
3. Share email with EFF (optional)
4. Select option to redirect HTTP to HTTPS (recommended)

Certbot will automatically:
- Obtain SSL certificates
- Update nginx configuration with SSL settings
- Add HTTP to HTTPS redirect

### 10.4 Verify nginx configuration after certbot

After certbot completes, verify the configuration:

```bash
nginx -t
systemctl reload nginx
```

### 10.5 (Optional) Enhance SSL configuration

After certbot runs, you can optionally enhance the configuration:

```bash
nano /etc/nginx/sites-available/bitok-pool
```

Add these security headers inside the HTTPS server block:

```nginx
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
```

Then reload nginx:

```bash
nginx -t && systemctl reload nginx
```

### 10.6 Test SSL auto-renewal

```bash
certbot renew --dry-run
```

### 10.7 Verify HTTPS

```bash
curl -I https://lastbitcoin.org
```

---

## Step 11: Systemd Services

### 11.1 Create Bitok daemon service

```bash
cat > /etc/systemd/system/bitokd.service << 'EOF'
[Unit]
Description=Bitok Daemon
Documentation=https://github.com/elvisjedusor/bitok
After=network-online.target
Wants=network-online.target

[Service]
Type=forking
User=root
Group=root

ExecStart=/root/bitok-core/bitokd -daemon
ExecStop=/root/bitok-core/bitokd stop

Restart=on-failure
RestartSec=30
TimeoutStartSec=infinity
TimeoutStopSec=600

# Hardening
PrivateTmp=true
ProtectSystem=full
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
```

### 11.2 Create pool service

```bash
cat > /etc/systemd/system/bitok-pool.service << 'EOF'
[Unit]
Description=Bitok Mining Pool
Documentation=https://github.com/elvisjedusor/bitok
After=network-online.target redis-server.service postgresql.service bitokd.service
Wants=network-online.target
Requires=redis-server.service postgresql.service

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=/root/bitok-pool/pool-server

ExecStart=/usr/bin/node src/full-pool.js
ExecReload=/bin/kill -HUP $MAINPID

Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

Environment=NODE_ENV=production

# Resource limits
LimitNOFILE=65535
LimitNPROC=65535

[Install]
WantedBy=multi-user.target
EOF
```

### 11.3 Enable and start services

```bash
# Reload systemd
systemctl daemon-reload

# Enable services to start on boot
systemctl enable bitokd
systemctl enable bitok-pool

# Start Bitok daemon (if not already running)
systemctl start bitokd

# Wait for daemon to be ready (check logs)
journalctl -u bitokd -f
# Press Ctrl+C when you see it's running

# Start pool
systemctl start bitok-pool

# Check status
systemctl status bitok-pool
```

---

## Step 12: Verification

### 12.1 Check all services

```bash
echo "=== Service Status ==="
systemctl is-active bitokd && echo "bitokd: OK" || echo "bitokd: FAILED"
systemctl is-active bitok-pool && echo "bitok-pool: OK" || echo "bitok-pool: FAILED"
systemctl is-active nginx && echo "nginx: OK" || echo "nginx: FAILED"
systemctl is-active redis-server && echo "redis: OK" || echo "redis: FAILED"
systemctl is-active postgresql && echo "postgresql: OK" || echo "postgresql: FAILED"
```

### 12.2 Check pool logs

```bash
journalctl -u bitok-pool -f --no-pager -n 50
```

### 12.3 Test web UI

```bash
# Test local
curl -s http://127.0.0.1:8080/api/stats | jq .

# Test HTTPS
curl -s https://lastbitcoin.org/api/stats | jq .
```

### 12.4 Test stratum port

```bash
# Check port is listening
ss -tlnp | grep 3032

# Test connection
nc -zv lastbitcoin.org 3032
```

### 12.5 Test with a miner

```bash
# Install cpuminer-opt (on a separate machine or same server)
# Connect to pool
cpuminer -a yespower -o stratum+tcp://lastbitcoin.org:3032 -u YOUR_BITOK_ADDRESS.worker1 -p x
```
---

## Monitoring Commands

### Pool Logs

```bash
# Live logs
journalctl -u bitok-pool -f

# Last 100 lines
journalctl -u bitok-pool -n 100

# Logs since today
journalctl -u bitok-pool --since today
```

### Bitok Daemon

```bash
# Blockchain info
bitokd getinfo

# Mining info
bitokd getmininginfo

# Network info
bitokd getpeerinfo | jq 'length'

# Wallet balance
bitokd getbalance

# List recent transactions
bitokd listtransactions 10
```

### Database Queries

```bash
# Connect to database
PGPASSWORD='YOUR_PASSWORD' psql -h localhost -U bitokpool -d bitok_pool

# Quick stats
SELECT
    (SELECT COUNT(*) FROM blocks) as total_blocks,
    (SELECT COUNT(*) FROM blocks WHERE confirmed = true) as confirmed_blocks,
    (SELECT COUNT(*) FROM miners) as total_miners,
    (SELECT COUNT(*) FROM payments WHERE status = 'paid') as total_payments;

# Recent blocks
SELECT height, hash, confirmed, confirmations, paid, timestamp
FROM blocks ORDER BY height DESC LIMIT 10;

# Top miners by shares
SELECT miner_address, COUNT(*) as shares
FROM shares
WHERE timestamp > NOW() - INTERVAL '24 hours'
GROUP BY miner_address
ORDER BY shares DESC
LIMIT 10;

# Payment summary
SELECT status, COUNT(*), SUM(amount)/100000000.0 as total_bitok
FROM payments
GROUP BY status;

# Exit
\q
```

### Redis Stats

```bash
# Connection test
redis-cli ping

# Memory usage
redis-cli info memory | grep used_memory_human

# All keys
redis-cli keys "*"

# Pool hashrate
redis-cli get "pool:hashrate"
```

### System Resources

```bash
# CPU and memory
htop

# Disk usage
df -h

# Network connections
ss -tlnp
```
---
