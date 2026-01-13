/**
 * External Addon Integration Module
 * 
 * Integra Torrentio, MediaFusion e Comet per aggregare risultati da addon esterni.
 * Gestisce chiamate parallele, normalizzazione e deduplicazione.
 */

// ✅ VERBOSE LOGGING - configurabile via ENV
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

// ============================================================================
// CONFIGURATION - URL completi degli addon esterni con configurazione base64
// ============================================================================

// Get Torrentio base domain from env to hide the real URL
const TORRENTIO_BASE_DOMAIN = process.env.TORRENTIO_BASE_URL || '';

const EXTERNAL_ADDONS = {
    torrentio: {
        baseUrl: TORRENTIO_BASE_DOMAIN ? `${TORRENTIO_BASE_DOMAIN}/oResults=false/aHR0cHM6Ly90b3JyZW50aW8uc3RyZW0uZnVuL3Byb3ZpZGVycz15dHMsZXp0dixyYXJiZywxMzM3eCx0aGVwaXJhdGViYXksa2lja2Fzc3RvcnJlbnRzLHRvcnJlbnRnYWxheHksbWFnbmV0ZGwsaG9ycmlibGVzdWJzLG55YWFzaSx0b2t5b3Rvc2hvLGFuaWRleCxydXRvcixydXRyYWNrZXIsY29tYW5kbyxibHVkdix0b3JyZW50OSxpbGNvcnNhcm9uZXJvLG1lam9ydG9ycmVudCx3b2xmbWF4NGssY2luZWNhbGlkYWQsYmVzdHRvcnJlbnRzfGxhbmd1YWdlPWl0YWxpYW58c29ydD1xdWFsaXR5c2l6ZXxxdWFsaXR5ZmlsdGVyPXRocmVlZCxzY3IsY2FtfGxpbWl0PTc=` : null,
        name: 'Torrentio',
        emoji: '🅣',
        timeout: 1500
    },
    mediafusion: {
        baseUrl: 'https://mediafusionfortheweebs.midnightignite.me/D-JsGOdGy5ORD4ALwdnjM8ulgRM6r34Tns_EE8B_VMbNfIk-ZvEuNjmH3hWZWZVhtWYhI2qA5KbFKYEkhjalpr4xLCicz01i9zKOQL3Fhcqv2LkJdyYGjeTUNodJPCEGd_FwpjiJ3IjMqmD6BAVbvtJUOQPS_of8hQP_DbUo9-CCJun7_xJMfNqgaEmbWLXWpc_BLtX-V9d5eDJ-GAJv-i0eg2PyGUPIRaqKhsOlxRA1g',
        name: 'MediaFusion',
        emoji: '🅜',
        timeout: 1500
    },
    comet: {
        baseUrl: 'https://cometfortheweebs.midnightignite.me/eyJtYXhSZXN1bHRzUGVyUmVzb2x1dGlvbiI6OCwibWF4U2l6ZSI6MCwiY2FjaGVkT25seSI6ZmFsc2UsInNvcnRDYWNoZWRVbmNhY2hlZFRvZ2V0aGVyIjpmYWxzZSwicmVtb3ZlVHJhc2giOnRydWUsInJlc3VsdEZvcm1hdCI6WyJhbGwiXSwiZGVicmlkU2VydmljZSI6InRvcnJlbnQiLCJkZWJyaWRBcGlLZXkiOiIiLCJkZWJyaWRTdHJlYW1Qcm94eVBhc3N3b3JkIjoiIiwibGFuZ3VhZ2VzIjp7ImV4Y2x1ZGUiOlsiZW4iLCJqYSIsInpoIiwicnUiLCJhciIsInB0IiwiZXMiLCJmciIsImRlIiwia28iLCJoaSIsImJuIiwicGEiLCJtciIsImd1IiwidGEiLCJ0ZSIsImtuIiwibWwiLCJ0aCIsInZpIiwiaWQiLCJ0ciIsImhlIiwiZmEiLCJ1ayIsImVsIiwibHQiLCJsdiIsImV0IiwicGwiLCJjcyIsInNrIiwiaHUiLCJybyIsImJnIiwic3IiLCJociIsInNsIiwibmwiLCJkYSIsImZpIiwic3YiLCJubyIsIm1zIiwibGEiXSwicHJlZmVycmVkIjpbIm11bHRpIiwiaXQiXX0sInJlc29sdXRpb25zIjp7InIzNjBwIjpmYWxzZX0sIm9wdGlvbnMiOnsicmVtb3ZlX3JhbmtzX3VuZGVyIjotMTAwMDAwMDAwMDAsImFsbG93X2VuZ2xpc2hfaW5fbGFuZ3VhZ2VzIjpmYWxzZSwicmVtb3ZlX3Vua25vd25fbGFuZ3VhZ2VzIjpmYWxzZX19',
        name: 'Comet',
        emoji: '🅒',
        timeout: 1500
    }
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Estrae info hash dal formato magnet o direttamente
 */
function extractInfoHash(stream) {
    // Prima controlla infoHash diretto
    if (stream.infoHash) {
        return stream.infoHash.toUpperCase();
    }
    // Poi prova a trovarlo nel magnet URL se presente
    if (stream.url && stream.url.includes('btih:')) {
        const match = stream.url.match(/btih:([A-Fa-f0-9]{40}|[A-Za-z2-7]{32})/i);
        if (match) return match[1].toUpperCase();
    }
    return null;
}

/**
 * Estrae la qualità dal titolo/nome dello stream
 */
function extractQuality(text) {
    if (!text) return '';
    const qualityPatterns = [
        /\b(2160p|4k|uhd)\b/i,
        /\b(1080p)\b/i,
        /\b(720p)\b/i,
        /\b(480p|sd)\b/i
    ];
    for (const pattern of qualityPatterns) {
        const match = text.match(pattern);
        if (match) return match[1].toLowerCase();
    }
    return '';
}

/**
 * Estrae seeders dal titolo formattato dell'addon
 */
function extractSeeders(text) {
    if (!text) return 0;
    // Pattern: 👤 23 o S: 23 o Seeders: 23
    const match = text.match(/👤\s*(\d+)|[Ss](?:eeders)?:\s*(\d+)/);
    if (match) return parseInt(match[1] || match[2]) || 0;
    return 0;
}

/**
 * Estrae la dimensione del file
 */
function extractSize(text) {
    if (!text) return { formatted: '', bytes: 0 };

    // Pattern: 📦 111.78 GB o 💾 111.78 GB o Size: 111.78 GB
    const match = text.match(/(?:📦|💾|Size:?)\s*([\d.,]+)\s*(B|KB|MB|GB|TB)/i);
    if (!match) return { formatted: '', bytes: 0 };

    const value = parseFloat(match[1].replace(',', '.'));
    const unit = match[2].toUpperCase();

    const multipliers = {
        'B': 1,
        'KB': 1024,
        'MB': 1024 ** 2,
        'GB': 1024 ** 3,
        'TB': 1024 ** 4
    };

    const bytes = Math.round(value * (multipliers[unit] || 1));
    return { formatted: `${value} ${unit}`, bytes };
}

/**
 * Estrae il provider originale dal titolo (es. 🔍 ilCorSaRoNeRo)
 */
function extractOriginalProvider(text) {
    if (!text) return null;
    // Torrentio: 🔍 ilCorSaRoNeRo
    const torrentioMatch = text.match(/🔍\s*([^\n]+)/);
    if (torrentioMatch) return torrentioMatch[1].trim();

    // MediaFusion: 🔗 BT4G
    const mfMatch = text.match(/🔗\s*([^\n]+)/);
    if (mfMatch) return mfMatch[1].trim();

    // Comet: 🔎 StremThru
    const cometMatch = text.match(/🔎\s*([^\n]+)/);
    if (cometMatch) return cometMatch[1].trim();

    return null;
}

/**
 * Estrae il filename dal campo behaviorHints o dal titolo
 */
function extractFilename(stream) {
    if (stream.behaviorHints?.filename) {
        return stream.behaviorHints.filename;
    }
    // Prova a estrarre da 📄 nel title/description
    const text = stream.title || stream.description || '';
    const match = text.match(/📄\s*([^\n]+)/);
    if (match) return match[1].trim();
    return stream.name || '';
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Chiama un singolo addon esterno e normalizza i risultati
 * 
 * @param {string} addonKey - Chiave dell'addon (torrentio, mediafusion, comet)
 * @param {string} type - Tipo media (movie, series)
 * @param {string} id - ID Stremio (es. tt0120737 o tt0120737:1:5)
 * @returns {Promise<Array>} Array di stream normalizzati
 */
async function fetchExternalAddon(addonKey, type, id) {
    const addon = EXTERNAL_ADDONS[addonKey];
    if (!addon) {
        console.error(`❌ [External] Unknown addon: ${addonKey}`);
        return [];
    }

    // Skip if baseUrl is not configured (env variable not set)
    if (!addon.baseUrl) {
        if (DEBUG_MODE) console.log(`⏭️ [${addon.name}] Skipped - base URL not configured`);
        return [];
    }

    const url = `${addon.baseUrl}/stream/${type}/${id}.json`;
    if (DEBUG_MODE) console.log(`🌐 [${addon.name}] Fetching: ${type}/${id}`);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), addon.timeout);

        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'IlCorsaroViola/1.0 (Stremio Addon)',
                'Accept': 'application/json'
            }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.error(`❌ [${addon.name}] HTTP ${response.status}`);
            return [];
        }

        const data = await response.json();
        const streams = data.streams || [];

        if (DEBUG_MODE) console.log(`✅ [${addon.name}] Received ${streams.length} streams`);

        // Debug: log first stream to see its structure
        if (DEBUG_MODE && streams.length > 0) {
            console.log(`🔍 [${addon.name}] First stream sample:`, JSON.stringify(streams[0], null, 2).substring(0, 500));
        }

        // Normalizza ogni stream
        return streams.map(stream => normalizeExternalStream(stream, addonKey));

    } catch (error) {
        if (error.name === 'AbortError') {
            console.error(`⏱️ [${addon.name}] Timeout after ${addon.timeout}ms`);
        } else {
            console.error(`❌ [${addon.name}] Error:`, error.message);
        }
        return [];
    }
}

/**
 * Normalizza uno stream dall'addon esterno nel formato interno
 * 
 * @param {Object} stream - Stream originale dall'addon
 * @param {string} addonKey - Chiave addon sorgente
 * @returns {Object} Stream normalizzato
 */
function normalizeExternalStream(stream, addonKey) {
    const addon = EXTERNAL_ADDONS[addonKey];
    const text = stream.title || stream.description || stream.name || '';

    const infoHash = extractInfoHash(stream);

    // Debug: log infoHash extraction result (solo in verbose mode)
    if (DEBUG_MODE) console.log(`🔍 [Normalize] infoHash=${infoHash ? infoHash.substring(0, 8) + '...' : 'NULL'}, url=${stream.url?.substring(0, 60) || 'none'}...`);

    const filename = extractFilename(stream);
    const quality = extractQuality(stream.name || filename || text);
    const sizeInfo = extractSize(text);
    const seeders = extractSeeders(text);
    const originalProvider = extractOriginalProvider(text);

    // Estrai dimensione da behaviorHints se disponibile
    let sizeBytes = sizeInfo.bytes;
    if (stream.behaviorHints?.videoSize) {
        sizeBytes = stream.behaviorHints.videoSize;
    }
    if (stream.video_size) {
        sizeBytes = stream.video_size;
    }

    return {
        // Campi principali per streaming
        infoHash: infoHash,
        fileIdx: stream.fileIdx ?? 0,

        // Metadati per display
        title: filename,
        filename: filename,
        websiteTitle: filename,
        quality: quality || stream.resolution?.replace(/[^0-9kp]/gi, '') || '',
        size: sizeInfo.formatted || formatBytes(sizeBytes),
        mainFileSize: sizeBytes,
        seeders: seeders || stream.peers || 0,
        leechers: 0,

        // Sorgente e tracking
        source: originalProvider ? `${addon.name} (${originalProvider})` : addon.name,
        externalAddon: addonKey,
        externalProvider: originalProvider,
        sourceEmoji: addon.emoji,

        // Magnet link (costruito da infoHash + trackers se disponibili)
        magnetLink: buildMagnetLink(infoHash, stream.sources),

        // Timestamp
        pubDate: new Date().toISOString()
    };
}

/**
 * Formatta bytes in stringa leggibile
 */
function formatBytes(bytes, decimals = 2) {
    if (!bytes || bytes === 0) return '';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Costruisce magnet link da infoHash e trackers
 */
function buildMagnetLink(infoHash, sources) {
    if (!infoHash) return null;

    let magnet = `magnet:?xt=urn:btih:${infoHash}`;

    // Aggiungi trackers se disponibili
    if (sources && Array.isArray(sources)) {
        const trackers = sources
            .filter(s => s.startsWith('tracker:') || s.startsWith('udp://') || s.startsWith('http'))
            .map(s => s.replace(/^tracker:/, ''))
            .slice(0, 10); // Limita a 10 trackers

        for (const tracker of trackers) {
            magnet += `&tr=${encodeURIComponent(tracker)}`;
        }
    }

    return magnet;
}

/**
 * Chiama TUTTI gli addon esterni in parallelo
 * 
 * @param {string} type - Tipo media (movie, series)
 * @param {string} id - ID Stremio
 * @param {Object} options - Opzioni: { enabledAddons: ['torrentio', 'mediafusion', 'comet'] }
 * @returns {Promise<Object>} Risultati per addon { torrentio: [...], mediafusion: [...], comet: [...] }
 */
async function fetchAllExternalAddons(type, id, options = {}) {
    const enabledAddons = options.enabledAddons || Object.keys(EXTERNAL_ADDONS);

    if (DEBUG_MODE) console.log(`\n🔗 [External Addons] Fetching from: ${enabledAddons.join(', ')}`);
    const startTime = Date.now();

    // Crea promise per ogni addon abilitato
    const promises = enabledAddons.map(async (addonKey) => {
        const results = await fetchExternalAddon(addonKey, type, id);
        return { addonKey, results };
    });

    // Esegui tutte in parallelo
    const settledResults = await Promise.allSettled(promises);

    // Organizza risultati per addon
    const resultsByAddon = {};
    let totalResults = 0;

    for (const result of settledResults) {
        if (result.status === 'fulfilled') {
            const { addonKey, results } = result.value;
            resultsByAddon[addonKey] = results;
            totalResults += results.length;
        } else {
            console.error(`❌ [External] Promise rejected:`, result.reason);
        }
    }

    const elapsed = Date.now() - startTime;
    if (DEBUG_MODE) console.log(`✅ [External Addons] Total: ${totalResults} results in ${elapsed}ms`);

    return resultsByAddon;
}

/**
 * Ritorna un array "flat" di tutti i risultati esterni, già normalizzati
 * 
 * @param {string} type - Tipo media
 * @param {string} id - ID Stremio
 * @param {Object} options - Opzioni
 * @returns {Promise<Array>} Array flat di tutti i risultati
 */
async function fetchExternalAddonsFlat(type, id, options = {}) {
    const resultsByAddon = await fetchAllExternalAddons(type, id, options);

    // Flatten tutti i risultati in un unico array
    const allResults = [];
    for (const addonKey of Object.keys(resultsByAddon)) {
        allResults.push(...resultsByAddon[addonKey]);
    }

    return allResults;
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
    EXTERNAL_ADDONS,
    fetchExternalAddon,
    fetchAllExternalAddons,
    fetchExternalAddonsFlat,
    normalizeExternalStream,
    extractInfoHash
};
