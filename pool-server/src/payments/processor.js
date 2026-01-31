import { createRequire } from 'module';
import * as postgres from '../db/postgres.js';
import * as redis from '../db/redis.js';
import { config } from '../config.js';
import { calculatePayouts, deductFromBalance, updateAllImmatureBalances } from './calculator.js';

const require = createRequire(import.meta.url);
const DaemonInterface = require('../../../lib/daemon.js').interface;

export class PaymentProcessor {
    constructor() {
        this.daemon = new DaemonInterface(
            [{
                host: process.env.RPC_HOST || '127.0.0.1',
                port: parseInt(process.env.RPC_PORT) || 8332,
                user: process.env.RPC_USER,
                password: process.env.RPC_PASSWORD
            }],
            (severity, message) => {
                console.log(`[${severity}] ${message}`);
            }
        );

        this.processing = false;
        this.minPayoutAmount = 0.01;
        this.maxPayoutAmount = 21000000;
        this.feeReserve = 0.1;
        this.maxRetries = 3;
        this.retryDelay = 2000;
    }

    async withRetry(operation, operationName, retries = this.maxRetries) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await operation();
            } catch (err) {
                const isLastAttempt = attempt === retries;
                const isRetryable = this.isRetryableError(err);

                if (isLastAttempt || !isRetryable) {
                    throw err;
                }

                console.log(`${operationName} failed (attempt ${attempt}/${retries}): ${err.message}. Retrying...`);
                await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
            }
        }
    }

    isRetryableError(err) {
        const retryableMessages = [
            'ECONNREFUSED',
            'ETIMEDOUT',
            'ENOTFOUND',
            'socket hang up',
            'network',
            'timeout',
            'Loading block index',
            'Loading wallet',
            'Rewinding blocks',
            'Verifying blocks'
        ];
        const errorMsg = err.message?.toLowerCase() || '';
        return retryableMessages.some(msg => errorMsg.includes(msg.toLowerCase()));
    }

    async start() {
        console.log('Payment processor started');
        console.log(`Payment threshold: ${config.pool.paymentThreshold} BITOK`);
        console.log(`Payment interval: ${config.pool.paymentInterval}s`);

        await this.checkDaemonConnection();

        await this.processPayments();

        setInterval(async () => {
            await this.processPayments();
        }, config.pool.paymentInterval * 1000);
    }

    async checkDaemonConnection() {
        return new Promise((resolve, reject) => {
            this.daemon.isOnline((online) => {
                if (online) {
                    console.log('Connected to Bitok daemon');
                    resolve(true);
                } else {
                    console.error('Failed to connect to Bitok daemon');
                    reject(new Error('Daemon offline'));
                }
            });
        });
    }

    async getWalletBalance() {
        return this.withRetry(() => {
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('getbalance RPC timeout after 30s'));
                }, 30000);

                this.daemon.cmd('getbalance', [], (results) => {
                    clearTimeout(timeout);
                    console.log('getbalance RPC response:', JSON.stringify(results));

                    if (!results || results.length === 0) {
                        reject(new Error('Empty RPC response'));
                        return;
                    }

                    if (results[0] && !results[0].error && results[0].response !== undefined) {
                        const balance = parseFloat(results[0].response);
                        console.log(`Wallet balance: ${balance} BITOK`);
                        resolve(balance);
                    } else {
                        const errMsg = results[0]?.error?.message || JSON.stringify(results[0]);
                        reject(new Error(`getbalance failed: ${errMsg}`));
                    }
                });
            });
        }, 'getWalletBalance');
    }

    getAvailableBalance(balance) {
        return Math.max(0, balance - this.feeReserve);
    }

    validateAddress(address) {
        if (!address || typeof address !== 'string') {
            return false;
        }

        if (address.length < 26 || address.length > 35) {
            return false;
        }

        return true;
    }

    async validateAddressRPC(address) {
        return this.withRetry(() => {
            return new Promise((resolve, reject) => {
                this.daemon.cmd('validateaddress', [address], (results) => {
                    if (results && results[0] && !results[0].error && results[0].response) {
                        resolve(results[0].response.isvalid === true);
                    } else if (results[0]?.error) {
                        reject(new Error(results[0].error.message || 'Validation failed'));
                    } else {
                        resolve(false);
                    }
                });
            });
        }, 'validateAddress');
    }

    satoshiToBitok(satoshi) {
        return satoshi / 100000000;
    }

    bitokToSatoshi(bitok) {
        return Math.floor(bitok * 100000000);
    }

    async sendPayment(address, amount) {
        const amountBitok = this.satoshiToBitok(amount);

        if (amountBitok < this.minPayoutAmount) {
            throw new Error(`Amount ${amountBitok} below minimum ${this.minPayoutAmount}`);
        }

        if (amountBitok > this.maxPayoutAmount) {
            throw new Error(`Amount ${amountBitok} exceeds maximum ${this.maxPayoutAmount}`);
        }

        return this.withRetry(() => {
            return new Promise((resolve, reject) => {
                const roundedAmount = Math.floor(amountBitok * 100) / 100;
                const comment = `pool_payout_${Date.now()}`;

                this.daemon.cmd('sendtoaddress', [address, roundedAmount, comment], (results) => {
                    if (results && results[0] && !results[0].error) {
                        const txid = results[0].response;
                        resolve(txid);
                    } else {
                        const errorMsg = results[0]?.error?.message || 'Unknown error';
                        reject(new Error(`Payment failed: ${errorMsg}`));
                    }
                });
            });
        }, 'sendPayment');
    }

    async verifyTransaction(txid) {
        return new Promise((resolve, reject) => {
            this.daemon.cmd('gettransaction', [txid], (results) => {
                if (results && results[0] && !results[0].error) {
                    resolve(results[0].response);
                } else {
                    reject(new Error('Transaction verification failed'));
                }
            });
        });
    }

    async processPayments() {
        if (this.processing) {
            console.log('Payment processing already in progress, skipping...');
            return;
        }

        this.processing = true;

        try {
            console.log('\n=== Starting payment round ===');

            try {
                await redis.setLastPaymentTime(Date.now());
            } catch (redisErr) {
                console.error('Redis setLastPaymentTime failed:', redisErr.message);
            }

            let balance;
            try {
                balance = await this.getWalletBalance();
            } catch (balanceErr) {
                console.error('Failed to get wallet balance:', balanceErr.message);
                throw balanceErr;
            }

            const availableBalance = this.getAvailableBalance(balance);
            console.log(`Pool wallet balance: ${balance} BITOK (available: ${availableBalance} BITOK, fee reserve: ${this.feeReserve} BITOK)`);

            if (availableBalance < config.pool.paymentThreshold) {
                console.log('Insufficient available balance for payments');
                return;
            }

            let payouts;
            try {
                payouts = await calculatePayouts();
            } catch (calcErr) {
                console.error('Failed to calculate payouts:', calcErr.message);
                throw calcErr;
            }

            if (payouts.length === 0) {
                console.log('No pending payouts');
                return;
            }

            console.log(`Processing ${payouts.length} payouts`);

            let successCount = 0;
            let failCount = 0;
            let totalPaid = 0;

            for (const payout of payouts) {
                try {
                    if (!this.validateAddress(payout.address)) {
                        console.error(`Invalid address format: ${payout.address}`);
                        failCount++;
                        continue;
                    }

                    const isValidRPC = await this.validateAddressRPC(payout.address);
                    if (!isValidRPC) {
                        console.error(`Invalid address (RPC validation failed): ${payout.address}`);
                        failCount++;
                        continue;
                    }

                    const amountBitok = this.satoshiToBitok(payout.amount);

                    if (totalPaid + amountBitok > availableBalance) {
                        console.log(`Insufficient available balance for ${payout.address}: need ${amountBitok} BITOK, remaining: ${(availableBalance - totalPaid).toFixed(8)} BITOK`);
                        break;
                    }

                    const currentBalance = await postgres.query(
                        `SELECT balance FROM miners WHERE address = $1`,
                        [payout.address]
                    );
                    const actualBalance = parseInt(currentBalance.rows[0]?.balance) || 0;
                    if (actualBalance < payout.amount) {
                        console.error(`Balance mismatch for ${payout.address}: expected ${payout.amount}, actual ${actualBalance}`);
                        failCount++;
                        continue;
                    }

                    console.log(`Paying ${amountBitok} BITOK to ${payout.address}`);

                    const txid = await this.sendPayment(payout.address, payout.amount);

                    console.log(`Payment sent: ${txid}`);

                    await postgres.withTransaction(async (client) => {
                        await client.query(
                            `INSERT INTO payments (miner_address, amount, tx_hash, status)
                             VALUES ($1, $2, $3, 'paid')`,
                            [payout.address, payout.amount, txid]
                        );

                        const updateResult = await client.query(
                            `UPDATE miners SET balance = balance - $1, total_paid = total_paid + $1
                             WHERE address = $2 AND balance >= $1
                             RETURNING balance`,
                            [payout.amount, payout.address]
                        );

                        if (updateResult.rowCount === 0) {
                            throw new Error(`Failed to deduct balance - insufficient funds or miner not found`);
                        }
                    });

                    totalPaid += amountBitok;
                    successCount++;

                    await new Promise(resolve => setTimeout(resolve, 1000));

                } catch (err) {
                    console.error(`Payment failed for ${payout.address}:`, err.message);

                    await postgres.addPayment({
                        address: payout.address,
                        amount: payout.amount,
                        txHash: null,
                        status: 'failed'
                    });

                    failCount++;
                }
            }

            console.log(`Payment round complete: ${successCount} successful, ${failCount} failed, total paid: ${totalPaid.toFixed(8)} BITOK`);

            try {
                const minersUpdated = await updateAllImmatureBalances();
                console.log(`Updated immature balances for ${minersUpdated} miners`);
            } catch (immatureErr) {
                console.error('Failed to update immature balances:', immatureErr.message);
            }

        } catch (err) {
            console.error('Payment processing error:', err.message);
            console.error('Stack:', err.stack);
        } finally {
            this.processing = false;
            console.log('=== Payment round ended ===\n');
        }
    }
}

export function createPaymentProcessor() {
    return new PaymentProcessor();
}
