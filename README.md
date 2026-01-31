# Bitok Stratum Pool

Mining pool server for Bitok (BITOK) with BitokPoW algorithm.

## Requirements

- Node.js 22+
- Running Bitok daemon

## Setup

1. Install build dependencies:
```bash
sudo apt install build-essential python3
```

2. Install:
```bash
npm install
```

3. Configure your `.env`:
```
POOL_ADDRESS=your_bitok_wallet_address
RPC_USER=your_rpc_user
RPC_PASSWORD=your_rpc_password
```

4. Make sure your `bitok.conf` has:
```
server=1
rpcuser=your_rpc_user
rpcpassword=your_rpc_password
rpcallowip=127.0.0.1
```

5. Start:
```bash
npm start
```

## Connect Miners

```
stratum+tcp://your-server:3032
```

Use any cpuminer with Yespower support:
```bash
cpuminer -a yespower -o stratum+tcp://localhost:3032 -u wallet_address
```

## Bitok Specs

| Parameter | Value |
|-----------|-------|
| Algorithm | BitokPoW (Yespower N=2048 r=32) |
| Block Time | 10 minutes |
| Block Reward | 50 BITOK |
| Stratum Port | 3032 |
| RPC Port | 8332 |
| P2P Port | 18333 |

## License

GPL-2.0
