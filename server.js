// 🚀 Server standalone per HuggingFace Spaces (o altri hosting Node.js)
// Questo file wrappa l'handler Vercel in un server Express

import express from 'express';
import handler from './api/index.js';

// 🔧 Import DB helper for early initialization
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const dbHelper = require('./db-helper.cjs');

const app = express();
const PORT = process.env.PORT || 7860; // HuggingFace usa porta 7860

// 🚀 Initialize database at startup (before handling requests)
// This ensures cache lookups work on the first request after restart
if (process.env.DATABASE_URL) {
    dbHelper.initDatabase();
    console.log('✅ Database pre-initialized at startup');
}

// Middleware per parsing JSON e form data
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 🚀 Mount Manual Import Route
const manualImportRoute = require('./manual_import_route.cjs');
app.use('/scrape', manualImportRoute);

// Serve static files dalla cartella public
app.use(express.static('public'));

// Health check endpoint per HuggingFace
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ⏩ IntroSkip HLS Proxy endpoint
const hlsProxy = require('./hls-proxy.cjs');

// Accept both /introskip/hls and /introskip/hls.m3u8
app.get(['/introskip/hls', '/introskip/hls.m3u8'], async (req, res) => {
    try {
        await hlsProxy.handleHlsProxy(req, res);
    } catch (error) {
        console.error('⏩ [HLS] Route error:', error);
        if (!res.headersSent) {
            const stream = req.query.stream;
            if (stream) {
                res.redirect(302, decodeURIComponent(stream));
            } else {
                res.status(500).send('HLS proxy error');
            }
        }
    }
});

// Route catch-all: inoltra tutte le richieste all'handler Vercel
app.all('*', async (req, res) => {
    try {
        // Adatta req/res per compatibilità con Vercel handler
        await handler(req, res);
    } catch (error) {
        console.error('❌ Server error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// Avvia il server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Il Corsaro Viola running on http://0.0.0.0:${PORT}`);
    console.log(`📺 Configure Stremio with: http://your-space.hf.space/manifest.json`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('👋 SIGTERM received, shutting down...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('👋 SIGINT received, shutting down...');
    process.exit(0);
});
