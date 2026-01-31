import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from './config.js';
import apiRoutes from './api/routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

app.use('/api', apiRoutes);

app.get('*', (req, res) => {
    res.sendFile(join(__dirname, '../public/index.html'));
});

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(config.server.port, config.server.host, () => {
    console.log(`Bitok Pool Web Server running at http://${config.server.host}:${config.server.port}`);
});

process.on('SIGINT', () => {
    console.log('\nShutting down...');
    server.close(() => process.exit(0));
});
