(function() {
    'use strict';

    const API_BASE = '/api';
    let currentPage = 'home';
    let poolConfig = null;
    let paymentInfo = null;
    let countdownInterval = null;

    function formatHashrate(hashrate) {
        if (!hashrate || hashrate === 0) return '0 H/s';
        const units = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s'];
        let unitIndex = 0;
        while (hashrate >= 1000 && unitIndex < units.length - 1) {
            hashrate /= 1000;
            unitIndex++;
        }
        return hashrate.toFixed(2) + ' ' + units[unitIndex];
    }

    function formatNumber(num) {
        if (!num && num !== 0) return '--';
        return num.toLocaleString();
    }

    function formatTime(timestamp) {
        if (!timestamp) return '--';
        const date = new Date(timestamp);
        const now = new Date();
        const diff = Math.floor((now - date) / 1000);

        if (diff < 60) return diff + 's ago';
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
        return date.toLocaleDateString();
    }

    function formatCoins(satoshis) {
        if (!satoshis) return '0 BITOK';
        return (satoshis / 100000000).toFixed(8) + ' BITOK';
    }

    function shortenHash(hash, len = 8) {
        if (!hash) return '--';
        return hash.substring(0, len) + '...' + hash.substring(hash.length - len);
    }

    async function fetchAPI(endpoint) {
        try {
            const response = await fetch(API_BASE + endpoint);
            if (!response.ok) throw new Error('API error');
            return await response.json();
        } catch (err) {
            console.error('API fetch error:', err);
            return null;
        }
    }

    async function loadStats() {
        const data = await fetchAPI('/stats');
        if (!data) return;

        poolConfig = data.pool;
        paymentInfo = data.payments;

        document.getElementById('stat-hashrate').textContent = formatHashrate(data.stats.hashrate);
        document.getElementById('stat-miners').textContent = formatNumber(data.stats.miners);
        document.getElementById('stat-blocks').textContent = formatNumber(data.stats.blocksFound);
        document.getElementById('stat-difficulty').textContent = formatNumber(data.stats.difficulty?.toFixed(4));
        document.getElementById('stat-height').textContent = formatNumber(data.stats.height);
        document.getElementById('stat-fee').textContent = data.pool.fee + '%';

        const stratumUrl = 'stratum+tcp://' + data.stratum.host + ':' + data.stratum.port;
        document.getElementById('stratum-url').textContent = stratumUrl;
        document.getElementById('stratum-host').textContent = data.stratum.host;
        document.getElementById('stratum-port').textContent = data.stratum.port;
        document.getElementById('help-host').textContent = data.stratum.host;
        document.getElementById('help-port').textContent = data.stratum.port;
        document.getElementById('help-stratum-port').textContent = data.stratum.port;

        document.getElementById('info-reward').textContent = data.pool.blockReward + ' BITOK';
        document.getElementById('info-threshold').textContent = data.pool.paymentThreshold + ' BITOK';
        document.getElementById('info-fee').textContent = data.pool.fee + '%';
        document.getElementById('help-fee').textContent = data.pool.fee + '%';
        document.getElementById('help-threshold').textContent = data.pool.paymentThreshold + ' BITOK';

        if (currentPage === 'payments') {
            updatePaymentCountdown();
        }
    }

    function formatCountdown(ms) {
        if (ms <= 0) return '00:00:00';
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return String(hours).padStart(2, '0') + ':' +
               String(minutes).padStart(2, '0') + ':' +
               String(seconds).padStart(2, '0');
    }

    function updatePaymentCountdown() {
        const countdownEl = document.getElementById('payment-countdown');
        if (!countdownEl) return;

        if (!paymentInfo || !paymentInfo.nextPaymentTime) {
            countdownEl.textContent = '< 1:00:00';
            return;
        }

        const now = Date.now();
        const timeRemaining = paymentInfo.nextPaymentTime - now;

        if (timeRemaining <= 0) {
            countdownEl.textContent = 'Processing...';
            loadStats();
        } else {
            countdownEl.textContent = formatCountdown(timeRemaining);
        }
    }

    function startPaymentCountdown() {
        if (countdownInterval) {
            clearInterval(countdownInterval);
        }
        updatePaymentCountdown();
        countdownInterval = setInterval(updatePaymentCountdown, 1000);
    }

    function stopPaymentCountdown() {
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
    }

    async function loadRecentBlocks() {
        const data = await fetchAPI('/blocks?limit=5');
        const tbody = document.getElementById('recent-blocks');

        if (!data || !data.blocks || data.blocks.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#888;">No blocks found yet</td></tr>';
            return;
        }

        const maturity = poolConfig?.coinbaseMaturity || 12;
        tbody.innerHTML = data.blocks.map(block => {
            let statusClass, statusText;
            if (block.confirmations === -1) {
                statusClass = 'orphan';
                statusText = 'Orphan';
            } else if (block.confirmed) {
                statusClass = 'confirmed';
                statusText = 'Confirmed';
            } else {
                statusClass = 'pending';
                statusText = (block.confirmations || 0) + '/' + maturity;
            }
            return `
            <tr>
                <td><a href="https://bitokd.run/block/${block.height}" target="_blank">${block.height}</a></td>
                <td><span class="hash hash-short">${shortenHash(block.hash)}</span></td>
                <td>${formatCoins(block.reward)}</td>
                <td>${formatTime(block.timestamp)}</td>
                <td><span class="status ${statusClass}">${statusText}</span></td>
            </tr>
            `;
        }).join('');
    }

    async function loadBlocksPage(page = 1) {
        const data = await fetchAPI('/blocks?page=' + page + '&limit=20');
        const tbody = document.getElementById('blocks-table');

        if (!data || !data.blocks || data.blocks.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#888;">No blocks found yet</td></tr>';
            return;
        }

        const maturity = poolConfig?.coinbaseMaturity || 12;
        tbody.innerHTML = data.blocks.map(block => {
            let statusClass, statusText;
            if (block.confirmations === -1) {
                statusClass = 'orphan';
                statusText = 'Orphan';
            } else if (block.confirmed) {
                statusClass = 'confirmed';
                statusText = 'Confirmed';
            } else {
                statusClass = 'pending';
                statusText = (block.confirmations || 0) + '/' + maturity;
            }
            return `
            <tr>
                <td><a href="https://bitokd.run/block/${block.height}" target="_blank">${block.height}</a></td>
                <td><a href="https://bitokd.run/block/${block.hash}" target="_blank" class="hash hash-short">${shortenHash(block.hash)}</a></td>
                <td><span class="hash hash-short">${block.miner ? shortenHash(block.miner) : '--'}</span></td>
                <td>${formatCoins(block.reward)}</td>
                <td>${block.difficulty?.toFixed(4) || '--'}</td>
                <td>${formatTime(block.timestamp)}</td>
                <td><span class="status ${statusClass}">${statusText}</span></td>
            </tr>
            `;
        }).join('');

        renderPagination('blocks-pagination', data.pagination, loadBlocksPage);
    }

    async function loadPaymentsPage(page = 1) {
        const data = await fetchAPI('/payments?page=' + page + '&limit=20');
        const tbody = document.getElementById('payments-table');

        if (!data || !data.payments || data.payments.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#888;">No payments yet</td></tr>';
            document.getElementById('payments-pagination').innerHTML = '';
            return;
        }

        tbody.innerHTML = data.payments.map(payment => `
            <tr>
                <td><a href="https://bitokd.run/address/${payment.address}" target="_blank" class="hash hash-short">${shortenHash(payment.address)}</a></td>
                <td>${formatCoins(payment.amount)}</td>
                <td><a href="https://bitokd.run/tx/${payment.txHash}" target="_blank" class="hash hash-short">${shortenHash(payment.txHash)}</a></td>
                <td>${formatTime(payment.timestamp)}</td>
                <td><span class="status ${payment.status}">${payment.status}</span></td>
            </tr>
        `).join('');

        renderPagination('payments-pagination', data.pagination, loadPaymentsPage);
    }

    async function loadMinersPage(page = 1) {
        const data = await fetchAPI('/miners?page=' + page + '&limit=20');
        const tbody = document.getElementById('miners-table');

        if (!data || !data.miners || data.miners.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#888;">No active miners</td></tr>';
            document.getElementById('miners-pagination').innerHTML = '';
            return;
        }

        tbody.innerHTML = data.miners.map(miner => `
            <tr style="cursor:pointer" onclick="window.lookupMinerDirect('${miner.address}')">
                <td><span class="hash hash-short">${shortenHash(miner.address, 10)}</span></td>
                <td>${formatHashrate(miner.hashrate)}</td>
                <td>${formatNumber(miner.shares)}</td>
                <td>${formatTime(miner.lastShare)}</td>
            </tr>
        `).join('');

        renderPagination('miners-pagination', data.pagination, loadMinersPage);
    }

    async function loadMinerStats(address) {
        const data = await fetchAPI('/miners/' + address);

        if (!data) {
            document.getElementById('miner-address-display').textContent = 'Miner not found';
            document.getElementById('miner-hashrate').textContent = '--';
            document.getElementById('miner-workers').textContent = '--';
            document.getElementById('miner-shares').textContent = '--';
            document.getElementById('miner-immature').textContent = '--';
            document.getElementById('miner-balance').textContent = '--';
            document.getElementById('miner-paid').textContent = '--';
            document.getElementById('worker-list').innerHTML = '<div style="color:#888;text-align:center;">No workers found</div>';
            document.getElementById('miner-payments').innerHTML = '<tr><td colspan="4" style="text-align:center;color:#888;">No payments</td></tr>';
            return;
        }

        document.getElementById('miner-address-display').innerHTML = '<a href="https://bitokd.run/address/' + address + '" target="_blank" class="hash">' + address + '</a>';
        document.getElementById('miner-hashrate').textContent = formatHashrate(data.hashrate);
        document.getElementById('miner-workers').textContent = data.workers?.length || 0;
        document.getElementById('miner-shares').textContent = formatNumber(data.shares);
        document.getElementById('miner-immature').textContent = formatCoins(data.balance?.immature || 0);
        document.getElementById('miner-balance').textContent = formatCoins(data.balance?.pending || 0);
        document.getElementById('miner-paid').textContent = formatCoins(data.balance?.paid || data.totals?.paid || 0);

        const workerList = document.getElementById('worker-list');
        if (!data.workers || data.workers.length === 0) {
            workerList.innerHTML = '<div style="color:#888;text-align:center;">No active workers</div>';
        } else {
            workerList.innerHTML = data.workers.map(worker => `
                <div class="worker-item">
                    <span class="worker-name">${worker.name}</span>
                    <div class="worker-stats">
                        <span>Hashrate: <span class="value">${formatHashrate(worker.hashrate)}</span></span>
                        <span>Shares: <span class="value">${formatNumber(worker.shares)}</span></span>
                        <span>Last: <span class="value">${formatTime(worker.lastShare)}</span></span>
                    </div>
                </div>
            `).join('');
        }

        const paymentsTable = document.getElementById('miner-payments');
        if (!data.payments || data.payments.length === 0) {
            paymentsTable.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#888;">No payments yet</td></tr>';
        } else {
            paymentsTable.innerHTML = data.payments.map(payment => `
                <tr>
                    <td>${formatCoins(payment.amount)}</td>
                    <td><a href="https://bitokd.run/tx/${payment.txHash}" target="_blank" class="hash hash-short">${shortenHash(payment.txHash)}</a></td>
                    <td>${formatTime(payment.timestamp)}</td>
                    <td><span class="status ${payment.status}">${payment.status}</span></td>
                </tr>
            `).join('');
        }
    }

    function renderPagination(containerId, pagination, callback) {
        const container = document.getElementById(containerId);
        if (!pagination || pagination.pages <= 1) {
            container.innerHTML = '';
            return;
        }

        let html = '';
        html += '<button ' + (pagination.page <= 1 ? 'disabled' : '') + ' onclick="window.paginationCallback(\'' + containerId + '\', ' + (pagination.page - 1) + ')">Prev</button>';

        const start = Math.max(1, pagination.page - 2);
        const end = Math.min(pagination.pages, pagination.page + 2);

        for (let i = start; i <= end; i++) {
            html += '<button class="' + (i === pagination.page ? 'active' : '') + '" onclick="window.paginationCallback(\'' + containerId + '\', ' + i + ')">' + i + '</button>';
        }

        html += '<button ' + (pagination.page >= pagination.pages ? 'disabled' : '') + ' onclick="window.paginationCallback(\'' + containerId + '\', ' + (pagination.page + 1) + ')">Next</button>';

        container.innerHTML = html;

        window.paginationCallback = function(id, page) {
            if (id === 'blocks-pagination') loadBlocksPage(page);
            else if (id === 'payments-pagination') loadPaymentsPage(page);
            else if (id === 'miners-pagination') loadMinersPage(page);
        };
    }

    function showPage(pageName) {
        document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
        document.getElementById('page-' + pageName).classList.remove('hidden');

        document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));
        document.querySelector('nav a[data-page="' + pageName + '"]')?.classList.add('active');

        if (currentPage === 'payments' && pageName !== 'payments') {
            stopPaymentCountdown();
        }

        currentPage = pageName;

        if (pageName === 'home') {
            loadStats();
            loadRecentBlocks();
        } else if (pageName === 'blocks') {
            loadBlocksPage(1);
        } else if (pageName === 'payments') {
            loadPaymentsPage(1);
            loadStats();
            startPaymentCountdown();
        } else if (pageName === 'miners') {
            loadMinersPage(1);
        }
    }

    window.lookupMiner = function() {
        const address = document.getElementById('miner-address-input').value.trim();
        if (!address) return;
        showPage('miner');
        loadMinerStats(address);
    };

    window.lookupMinerFromPage = function() {
        const address = document.getElementById('miner-search-input').value.trim();
        if (!address) return;
        showPage('miner');
        loadMinerStats(address);
    };

    window.lookupMinerDirect = function(address) {
        showPage('miner');
        loadMinerStats(address);
    };

    document.addEventListener('DOMContentLoaded', function() {
        const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
        const mainNav = document.getElementById('main-nav');

        if (mobileMenuToggle && mainNav) {
            mobileMenuToggle.addEventListener('click', function() {
                mainNav.classList.toggle('active');
                this.innerHTML = mainNav.classList.contains('active') ? '&#10005;' : '&#9776;';
            });
        }

        document.querySelectorAll('nav a').forEach(link => {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                const page = this.getAttribute('data-page');
                showPage(page);
                if (mainNav) {
                    mainNav.classList.remove('active');
                    if (mobileMenuToggle) mobileMenuToggle.innerHTML = '&#9776;';
                }
            });
        });

        document.querySelectorAll('[data-page]').forEach(link => {
            if (link.tagName === 'A' && !link.closest('nav')) {
                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    const page = this.getAttribute('data-page');
                    showPage(page);
                });
            }
        });

        document.getElementById('miner-address-input').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') window.lookupMiner();
        });

        document.getElementById('miner-search-input').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') window.lookupMinerFromPage();
        });

        showPage('home');

        setInterval(loadStats, 30000);
    });
})();
