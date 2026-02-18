const express = require('express');
const axios = require('axios');
const router = express.Router();
const dbHelper = require('./db-helper.cjs');
const packFilesHandler = require('./pack-files-handler.cjs');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Import ID Converter for TMDB support
let idConverter;
try {
    idConverter = require('./lib/id-converter.cjs');
} catch (e) {
    console.warn("⚠️ [MANUAL-IMPORT] Could not load id-converter. TMDB support might be limited.", e);
}

// Multer config for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// ✅ CONFIGURA QUI O PASSA NEL BODY
// Se vuoto, cercherà nel body della richiesta
const DEFAULT_RD_KEY = process.env.REALDEBRID_API_KEY;
const DEFAULT_TB_KEY = process.env.TORBOX_API_KEY;

// HELPER: Extract season from full path (e.g., "Show/Season 4/Episode 1.mkv")
function parseSeasonFromPath(fullPath) {
    if (!fullPath) return null;
    const parts = fullPath.split('/');
    // Check parent folders for "Season X" or "S0X" or "Stagione X"
    // Iterate backwards from parent of file
    for (let i = parts.length - 2; i >= 0; i--) {
        const folder = parts[i];
        // Match:
        // 1. "Season 1", "Stagione 1"
        // 2. "S01", "S1" (Start/End of string or surrounded by separators)
        // 3. "Show Name S01"
        const seasonMatch = folder.match(/([sS]eason|[sS]tagione)\s*(\d{1,2})/i) ||
            folder.match(/(?:^|[^a-zA-Z])[sS](\d{1,2})(?:$|[^a-zA-Z])/);

        if (seasonMatch) {
            // If match is from the second regex group (S01), capturing group is 1. 
            // If first (Season 01), capturing group is 2.
            // We need to check which match succeeded.
            const val = seasonMatch[2] ? seasonMatch[2] : seasonMatch[1];
            return parseInt(val);
        }
    }
    return null;
}

/**
 * HELPER: fetchFilesFromRealDebrid (Copiato da pack-files-handler.cjs perché non esportato)
 */
async function fetchFilesFromRealDebrid(infoHash, rdKey) {
    const baseUrl = 'https://api.real-debrid.com/rest/1.0';
    const headers = { 'Authorization': `Bearer ${rdKey}` };

    try {
        console.log(`📦 [MANUAL-IMPORT] Adding magnet to RD check: ${infoHash}`);


        const magnetLink = `magnet:?xt=urn:btih:${infoHash}`;

        // 1. Add Magnet
        const addResponse = await axios.post(
            `${baseUrl}/torrents/addMagnet`,
            `magnet=${encodeURIComponent(magnetLink)}`,
            { headers, timeout: 30000 }
        );

        if (!addResponse.data || !addResponse.data.id) throw new Error('Failed to add magnet to RD');
        const torrentId = addResponse.data.id;

        // 2. Get Info
        const infoResponse = await axios.get(
            `${baseUrl}/torrents/info/${torrentId}`,
            { headers, timeout: 30000 }
        );

        if (!infoResponse.data || !infoResponse.data.files) {
            await axios.delete(`${baseUrl}/torrents/delete/${torrentId}`, { headers }).catch(() => { });
            throw new Error('No files in torrent info');
        }

        const files = infoResponse.data.files.map((f) => ({
            id: f.id,
            path: f.path,
            bytes: f.bytes,
            selected: f.selected
        }));

        // 3. Delete
        await axios.delete(`${baseUrl}/torrents/delete/${torrentId}`, { headers }).catch(() => { });

        // ✅ SMART FILENAME SELECTION (Robust Check)
        const rdFilename = infoResponse.data.filename;
        const rdOriginalFilename = infoResponse.data.original_filename;

        const invalidTerms = ['invalid magnet', 'magnet', 'torrent', 'download', 'error', 'unavailable', '404 not found'];
        const isInvalid = (name) => {
            if (!name) return true;
            const lower = name.toLowerCase();
            return invalidTerms.some(term => lower.includes(term)) || name.length < 5;
        };

        // Algorithm:
        // 1. Try Original Filename (Priority) -> If valid, use it.
        // 2. If invalid, Try Filename -> If valid, use it.
        // 3. If both invalid, fallback to Original (usually contains the real title even if "invalid" somehow) or Filename

        let finalFilename = rdOriginalFilename;

        if (!isInvalid(rdOriginalFilename)) {
            finalFilename = rdOriginalFilename;
        } else if (!isInvalid(rdFilename)) {
            finalFilename = rdFilename;
        } else {
            // Both are "bad" or Original is missing. Fallback.
            finalFilename = rdOriginalFilename || rdFilename;
        }

        return {
            torrentId,
            files,
            filename: finalFilename
        };

    } catch (error) {
        console.error(`❌ [MANUAL-IMPORT] RD API error: ${error.message}`);
        throw error;
    }
}

/**
 * HELPER: fetchFilesFromTorbox (Copiato da pack-files-handler.cjs perché non esportato)
 */
async function fetchFilesFromTorbox(infoHash, torboxKey) {
    const baseUrl = 'https://api.torbox.app/v1/api';
    const headers = { 'Authorization': `Bearer ${torboxKey}` };

    try {
        // 1. Try CheckCached (Fast)
        try {
            const cacheResponse = await axios.get(`${baseUrl}/torrents/checkcached`, {
                headers,
                params: { hash: infoHash.toUpperCase(), format: 'object', list_files: true },
                timeout: 10000
            });
            const cacheData = cacheResponse.data?.data;
            if (cacheData) {
                const hashKey = Object.keys(cacheData).find(k => k.toLowerCase() === infoHash.toLowerCase());
                if (hashKey && cacheData[hashKey]?.files?.length > 0) {
                    const sortedFiles = [...cacheData[hashKey].files].sort((a, b) => (a.name || a.path || '').localeCompare(b.name || b.path || ''));
                    return {
                        torrentId: 'cached',
                        files: sortedFiles.map((f, idx) => ({ id: idx, path: f.name || f.path, bytes: f.size || 0 }))
                    };
                }
            }
        } catch (e) { /* ignore cache error */ }

        // 2. Add Magnet (Slow)
        const magnetLink = `magnet:?xt=urn:btih:${infoHash}`;
        const addResponse = await axios.post(`${baseUrl}/torrents/createtorrent`, { magnet: magnetLink }, { headers });
        const torrentId = addResponse.data?.data?.torrent_id;
        if (!torrentId) throw new Error('Failed to add to Torbox');

        // Wait a bit
        await new Promise(r => setTimeout(r, 2000));

        const infoResponse = await axios.get(`${baseUrl}/torrents/mylist`, { headers, params: { id: torrentId } });
        const torrent = infoResponse.data?.data?.find(t => t.id === torrentId);

        await axios.get(`${baseUrl}/torrents/controltorrent`, { headers, params: { torrent_id: torrentId, operation: 'delete' } }).catch(() => { });

        if (!torrent || !torrent.files) throw new Error('No files found in Torbox');

        const sortedFiles = [...torrent.files].sort((a, b) => (a.name || a.path || '').localeCompare(b.name || b.path || ''));
        return {
            torrentId,
            files: sortedFiles.map((f, idx) => ({ id: f.id !== undefined ? f.id : idx, path: f.name || f.path, bytes: f.size || 0 }))
        };

    } catch (error) {
        console.error(`❌ [MANUAL-IMPORT] Torbox API error: ${error.message}`);
        throw error;
    }
}

/**
 * NEW: fetchTorrentFromCaches (Optimized Parallel)
 * Tries to download .torrent file from public caches effectively
 */
async function fetchTorrentFromCaches(infoHash) {
    const hashUpper = infoHash.toUpperCase();
    const urls = [
        `https://itorrents.org/torrent/${hashUpper}.torrent`,
        `https://torrage.info/torrent.php?h=${hashUpper}`,
        `http://btcache.me/torrent/${hashUpper}`
    ];

    console.log(`🔍 [MANUAL-IMPORT] Parallel fetch for .torrent from ${urls.length} caches for ${infoHash}...`);

    // Helper to fetch from one URL
    const fetchOne = async (url) => {
        try {
            // console.log(`  🌐 Trying: ${url}`); // Too noisy for parallel
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 8000, // Reduced timeout for parallel check
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            if (response.status === 200 && response.data.length > 500) {
                if (response.data[0] === 0x64) {
                    const base64 = Buffer.from(response.data).toString('base64');
                    // console.log(`  ✅ [CACHE] Hit: ${new URL(url).hostname}`);
                    return parseTorrentFile(base64);
                }
            }
            throw new Error('Invalid data');
        } catch (e) {
            throw new Error(`Failed ${url}`);
        }
    };

    try {
        const result = await Promise.any(urls.map(u => fetchOne(u)));
        console.log(`✅ [MANUAL-IMPORT] Cache Hit for ${infoHash}`);
        return result;
    } catch (aggregateError) {
        console.warn(`❌ [MANUAL-IMPORT] Cache Miss for ${infoHash} (All sources failed)`);
        return null;
    }
}


/**
 * Simple Bencode decoder for parsing .torrent files
 * Extracts info_hash by hashing the 'info' dictionary
 */
const crypto = require('crypto');

function decodeBencode(buffer, start = 0) {
    const char = String.fromCharCode(buffer[start]);

    if (char === 'i') {
        // Integer: i<number>e
        let end = start + 1;
        while (buffer[end] !== 0x65) end++; // 'e'
        const num = parseInt(buffer.slice(start + 1, end).toString());
        return { value: num, end: end + 1 };
    } else if (char === 'l') {
        // List: l<items>e
        const list = [];
        let pos = start + 1;
        while (buffer[pos] !== 0x65) {
            const result = decodeBencode(buffer, pos);
            list.push(result.value);
            pos = result.end;
        }
        return { value: list, end: pos + 1 };
    } else if (char === 'd') {
        // Dictionary: d<key><value>...e
        const dict = {};
        let pos = start + 1;
        while (buffer[pos] !== 0x65) {
            const keyResult = decodeBencode(buffer, pos);
            const valResult = decodeBencode(buffer, keyResult.end);
            dict[keyResult.value] = valResult.value;
            pos = valResult.end;
        }
        return { value: dict, end: pos + 1 };
    } else if (char >= '0' && char <= '9') {
        // String: <length>:<data>
        let colonPos = start;
        while (buffer[colonPos] !== 0x3A) colonPos++; // ':'
        const len = parseInt(buffer.slice(start, colonPos).toString());
        const strStart = colonPos + 1;
        const strEnd = strStart + len;
        // Return as string if ASCII, otherwise as buffer
        const data = buffer.slice(strStart, strEnd);
        try {
            return { value: data.toString('utf8'), end: strEnd };
        } catch {
            return { value: data, end: strEnd };
        }
    }
    throw new Error('Invalid bencode at position ' + start);
}

function parseTorrentFile(base64Data) {
    const buffer = Buffer.from(base64Data, 'base64');
    const decoded = decodeBencode(buffer, 0).value;

    if (!decoded.info) throw new Error('No info dictionary in torrent');

    // Find the raw bytes of the info dict to hash it
    // We need to re-encode it or find it in the original buffer
    const infoStart = buffer.indexOf('4:info') + 6;
    const infoResult = decodeBencode(buffer, infoStart);
    const infoBytes = buffer.slice(infoStart, infoResult.end);

    const hash = crypto.createHash('sha1');
    hash.update(infoBytes);
    const infoHash = hash.digest('hex');

    // Extract file list
    const info = decoded.info;
    const files = [];
    const torrentName = info.name || 'Unknown';

    if (info.files) {
        // Multi-file torrent
        info.files.forEach((f, idx) => {
            const path = Array.isArray(f.path) ? f.path.join('/') : f.path;
            files.push({ id: idx, path: torrentName + '/' + path, bytes: f.length });
        });
    } else {
        // Single file
        files.push({ id: 0, path: info.name, bytes: info.length });
    }

    return { infoHash, files, filename: torrentName };
}

// GET /meta - Fetch metadata for preview (IMDb/TMDB)
router.get('/meta', async (req, res) => {
    const { id, type } = req.query;
    if (!id || !type) return res.status(400).json({ error: 'Missing id or type' });

    let detectedType = type;
    let warning = null;

    // Helper to fetch metadata
    const fetchMeta = async (tid, tType) => {
        try {
            // 1. Convert TMDB -> IMDb if needed
            let currentImdbId = tid;
            let resolvedTmdbId = null;

            if (!tid.startsWith('tt')) {
                let tmdbId = tid;
                if (tid.startsWith('tmdb:')) tmdbId = tid.split(':')[1];

                // Track resolved TMDB ID for response
                resolvedTmdbId = tmdbId;

                if (idConverter) {
                    const converted = await idConverter.tmdbToImdb(tmdbId, tType);
                    if (converted) {
                        currentImdbId = converted;
                    } else {
                        return null;
                    }
                } else {
                    return null;
                }
            } else if (tid.match(/^\d+$/) || tid.startsWith('tmdb:')) {
                // If it looks like numeric string but wasn't caught above, it's TMDB
                resolvedTmdbId = tid.replace('tmdb:', '');
            }

            // 2. Fetch from Cinemeta
            const metaUrl = `https://v3-cinemeta.strem.io/meta/${tType}/${currentImdbId}.json`;
            console.log(`🔍 [MANUAL-META] Fetching (${tType}): ${metaUrl}`);
            const response = await axios.get(metaUrl, { timeout: 4000 });

            if (response.data && response.data.meta) {
                return {
                    meta: response.data.meta,
                    imdbId: currentImdbId,
                    tmdbId: resolvedTmdbId,
                    type: tType
                };
            }
            return null;
        } catch (e) {
            return null;
        }
    };

    // 🔥 PARALLEL FETCH STRATEGY
    // We fetch BOTH "movie" and "series" to detect collisions (e.g. Breaking Bad ID returning "Mirror" as movie)
    // BUT ONLY if ID is IMDb (tt...). TMDB IDs are unique per type (Movie 123 != TV 123).
    const cleanId = id.trim();
    const isTmdb = cleanId.startsWith('tmdb:') || /^\d+$/.test(cleanId);

    console.log(`🔎 [MANUAL-META] ID: "${cleanId}", Type: "${type}", isTmdb: ${isTmdb}`);

    const otherType = (isTmdb) ? null : ((type === 'movie') ? 'series' : 'movie');

    if (isTmdb) console.log("🔒 [MANUAL-META] TMDB ID detected: Disabling parallel check for collision.");

    // Launch requests (skip otherType if null)
    const [resultUserType, resultOtherType] = await Promise.all([
        fetchMeta(cleanId, type),
        otherType ? fetchMeta(cleanId, otherType) : Promise.resolve(null)
    ]);

    let finalResult = null;

    // 🧠 LOGIC: Decide which result is "correct"
    if (resultUserType && !resultOtherType) {
        // Only user type found - easy
        finalResult = resultUserType;
    } else if (!resultUserType && resultOtherType) {
        // Only other type found - auto-correct
        finalResult = resultOtherType;
        detectedType = otherType;
        warning = `Tipo corretto automaticamente in: ${otherType === 'movie' ? 'Film' : 'Serie'}`;
    } else if (resultUserType && resultOtherType) {
        // ⚔️ COLLISION DETECTED: Both return data!
        // This happens when an ID exists as both (or mapped incorrectly in Cinemeta)

        console.log(`⚠️ [MANUAL-META] Collision! Found valid data for BOTH '${type}' and '${otherType}'. Applying heuristics...`);

        // Check for "Series Indicators" (presence of videos (episodes) array)
        const userHasEpisodes = resultUserType.meta.videos && resultUserType.meta.videos.length > 0;
        const otherHasEpisodes = resultOtherType.meta.videos && resultOtherType.meta.videos.length > 0;

        if (type === 'movie') {
            // User asked for Movie. 
            // If "other" (Series) has episodes, it is definitely a Series.
            // (Movies usually have empty videos or trailers, not full episode lists in Cinemeta)
            if (otherHasEpisodes && !userHasEpisodes) {
                console.log(`💡 [MANUAL-META] Detected episodes in Series result. Correcting to SERIES.`);
                finalResult = resultOtherType;
                detectedType = 'series';
                warning = `Tipo corretto automaticamente in: Serie (Rilevati episodi)`;
            } else {
                // Otherwise trust user input (assuming it's a valid movie)
                finalResult = resultUserType;
            }
        } else {
            // User asked for Series.
            // If user result has NO episodes, but "other" (Movie) exists... doubtful.
            // But if user result HAS episodes, keep it.
            if (userHasEpisodes) {
                finalResult = resultUserType;
            } else if (!userHasEpisodes && !otherHasEpisodes) {
                // Neither has episodes. Prefer Movie as default for ambiguity? or Trust user?
                // Usually Series WITHOUT episodes is weird/broken.
                // Let's stick to User Input if ambiguous, or check release year/popularity?
                // For now: Keep User Input.
                finalResult = resultUserType;
            } else if (!userHasEpisodes && otherHasEpisodes) {
                // Impossible case (Series has no eps, Movie has eps? Unlikely).
                finalResult = resultUserType;
            } else {
                finalResult = resultUserType;
            }
        }
    }

    if (finalResult && finalResult.meta) {
        const m = finalResult.meta;
        return res.json({
            found: true,
            title: m.name,
            year: m.year,
            poster: m.poster,
            background: m.background,
            description: m.description,
            imdb_id: finalResult.imdbId,
            tmdb_id: finalResult.tmdbId,
            original_id: id,
            detected_type: detectedType,
            warning
        });
    } else {
        return res.json({ found: false, error: 'Metadata not found on Cinemeta (checked both types)', warning });
    }
});

// GET /scrape - Serve UI
router.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Importazione Manuale | ICV Scrape</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600&family=Inter:wght@300;400;600&display=swap" rel="stylesheet">
    <style>
        :root {
            --neon-primary: #a855f7;
            --neon-secondary: #06b6d4;
            --bg-dark: #050507;
            --card-bg: rgba(15, 23, 42, 0.7);
            --text-glow: rgba(168, 85, 247, 0.5);
            --border-low: rgba(255, 255, 255, 0.1);
        }

        * { box-sizing: border-box; transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
        
        body { 
            font-family: 'Inter', sans-serif; 
            margin: 0; 
            padding: 0;
            background-color: var(--bg-dark);
            color: #f8fafc;
            overflow-x: hidden;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        #bg-canvas {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: -1;
            background: radial-gradient(circle at 50% 50%, #1e1b4b 0%, #050507 100%);
        }

        .container {
            width: 100%;
            max-width: 960px;
            margin: 20px;
            padding: 50px;
            background: var(--card-bg);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid var(--border-low);
            border-radius: 32px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8),
                        inset 0 0 20px rgba(168, 85, 247, 0.05);
            position: relative;
            z-index: 1;
        }

        .header-section { text-align: center; margin-bottom: 40px; }

        h1 { 
            font-family: 'Outfit', sans-serif;
            margin: 0; 
            background: linear-gradient(135deg, white 30%, var(--neon-secondary) 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            font-weight: 600;
            letter-spacing: -1px;
            font-size: 2.8rem;
            filter: drop-shadow(0 0 10px rgba(6, 182, 212, 0.3));
        }

        .subtitle {
            color: #94a3b8;
            font-size: 0.9rem;
            margin-top: 8px;
            letter-spacing: 2px;
            text-transform: uppercase;
        }

        .form-group { margin-bottom: 28px; }
        
        label { 
            display: block; 
            margin-bottom: 10px; 
            font-weight: 600; 
            font-size: 0.85rem;
            color: #cbd5e1;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        input, select { 
            width: 100%; 
            padding: 16px 20px; 
            border: 1px solid var(--border-low); 
            border-radius: 16px; 
            background: rgba(0, 0, 0, 0.3);
            font-size: 1rem;
            font-family: inherit;
            color: white;
            box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);
        }

        input:focus, select:focus {
            outline: none;
            border-color: var(--neon-secondary);
            background: rgba(0, 0, 0, 0.5);
            box-shadow: 0 0 20px rgba(6, 182, 212, 0.15), 
                        inset 0 0 10px rgba(6, 182, 212, 0.05);
        }

        .or-divider { 
            text-align: center; 
            margin: 30px 0; 
            color: #475569; 
            font-size: 0.8rem;
            font-weight: 800;
            position: relative;
        }
        .or-divider::before, .or-divider::after {
            content: "";
            position: absolute;
            top: 50%;
            width: 42%;
            height: 1px;
            background: var(--border-low);
        }
        .or-divider::before { left: 0; }
        .or-divider::after { right: 0; }

        .btn-glow { 
            width: 100%; 
            padding: 18px; 
            background: linear-gradient(135deg, var(--neon-primary) 0%, #7e22ce 100%);
            color: white; 
            border: none; 
            border-radius: 18px; 
            cursor: pointer; 
            font-size: 1.2rem;
            font-weight: 600;
            font-family: 'Outfit', sans-serif;
            text-transform: uppercase;
            letter-spacing: 1px;
            box-shadow: 0 0 20px rgba(168, 85, 247, 0.4);
            position: relative;
            overflow: hidden;
        }

        .btn-glow:hover { 
            transform: scale(1.02);
            box-shadow: 0 0 35px rgba(168, 85, 247, 0.6);
            filter: brightness(1.2);
        }

        .btn-glow:active { transform: scale(0.98); }
        
        .btn-glow:disabled { 
            background: #334155; 
            box-shadow: none;
            cursor: not-allowed;
            animation: none !important;
            opacity: 0.5;
        }

        /* ENERGY PULSE ANIMATION */
        @keyframes energy-pulse {
            0% { box-shadow: 0 0 15px rgba(168, 85, 247, 0.4); }
            50% { box-shadow: 0 0 30px rgba(168, 85, 247, 0.7); }
            100% { box-shadow: 0 0 15px rgba(168, 85, 247, 0.4); }
        }

        .pulse-active:not(:disabled) {
            animation: energy-pulse 2s infinite ease-in-out;
        }

        #result { 
            margin-top: 30px; 
            padding: 20px; 
            border-radius: 20px; 
            display: none; 
            white-space: pre-wrap; 
            word-break: break-all; 
            max-height: 250px; 
            overflow-y: auto;
            font-family: 'Google Sans Code', monospace;
            font-size: 0.85rem;
            border: 1px solid transparent;
        }

        .success { 
            background: rgba(20, 83, 45, 0.2); 
            color: #4ade80; 
            border-color: rgba(74, 222, 128, 0.2) !important;
            box-shadow: 0 0 20px rgba(74, 222, 128, 0.1);
        }
        .error { 
            background: rgba(127, 29, 29, 0.2); 
            color: #f87171; 
            border-color: rgba(248, 113, 113, 0.2) !important;
        }
        
        #debug { 
            margin-top: 20px; 
            font-size: 0.8rem; 
            color: #64748b; 
            text-align: center;
        }

        .grid-half { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }

        /* Custom Scrollbar for Neon */
        #result::-webkit-scrollbar { width: 4px; }
        #result::-webkit-scrollbar-thumb { background: var(--neon-secondary); border-radius: 10px; }

        /* PREVIEW CARD */
        .preview-card {
            display: flex;
            flex-direction: column; /* Stack vertically for bigger image */
            gap: 20px;
            background: rgba(0, 0, 0, 0.4);
            padding: 20px;
            border-radius: 16px;
            margin-bottom: 28px;
            border: 1px solid var(--neon-primary);
            box-shadow: 0 0 20px rgba(168, 85, 247, 0.15);
            align-items: center; /* Center everything */
            text-align: center;
            animation: fadeIn 0.5s ease;
        }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
        
        .preview-poster {
            width: 160px; /* 200% Bigger */
            height: 240px;
            border-radius: 12px;
            object-fit: cover;
            box-shadow: 0 5px 15px rgba(0,0,0,0.5);
            border: 1px solid rgba(255,255,255,0.1);
        }
        .preview-info { flex: 1; width: 100%; }
        .preview-info h3 { margin: 0 0 8px 0; font-size: 1.4rem; color: white; font-family: 'Outfit', sans-serif; }
        .preview-info p { margin: 0; color: #cbd5e1; font-size: 0.95rem; line-height: 1.5; }
        .preview-tag { 
            display: inline-block; 
            background: var(--neon-secondary); 
            color: #000; 
            padding: 4px 10px; 
            border-radius: 4px; 
            font-size: 0.85rem; 
            font-weight: bold; 
            margin-top: 10px;
        }

        .check-btn {
            position: absolute;
            right: 8px;
            top: 50%; /* Adjusted via JS or layout */
            transform: translateY(-50%); /* If possible */
            background: rgba(168, 85, 247, 0.2);
            color: #a855f7;
            border: 1px solid rgba(168, 85, 247, 0.5);
            padding: 8px 12px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 0.8rem;
            font-weight: 600;
            transition: all 0.2s;
        }
        .check-btn:hover { background: rgba(168, 85, 247, 0.4); }

        .mapping-section {
            margin-top: 30px;
            padding: 20px;
            border-radius: 18px;
            border: 1px solid rgba(6, 182, 212, 0.25);
            background: rgba(2, 6, 23, 0.6);
            box-shadow: 0 0 25px rgba(6, 182, 212, 0.08);
        }

        .mapping-title {
            font-family: 'Outfit', sans-serif;
            font-size: 1.1rem;
            letter-spacing: 0.5px;
            margin-bottom: 14px;
            color: #e2e8f0;
        }

        .mapping-controls {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            align-items: center;
            margin-bottom: 16px;
        }

        .mapping-controls select {
            flex: 1;
            min-width: 140px;
        }

        .mapping-status {
            font-size: 0.85rem;
            color: #94a3b8;
        }

        .mapping-table {
            width: 100%;
            display: grid;
            gap: 8px;
            margin-bottom: 16px;
        }

        .mapping-row {
            display: grid;
            grid-template-columns: 70px 1fr 1.2fr;
            gap: 10px;
            align-items: center;
            padding: 10px 12px;
            border-radius: 12px;
            background: rgba(15, 23, 42, 0.55);
            border: 1px solid rgba(255, 255, 255, 0.06);
        }

        .mapping-row strong {
            color: #f8fafc;
            font-size: 0.9rem;
        }

        .mapping-row span {
            color: #cbd5e1;
            font-size: 0.85rem;
        }

        .mapping-select {
            width: 100%;
            padding: 10px 12px;
            border-radius: 10px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: rgba(2, 6, 23, 0.6);
            color: #f8fafc;
            font-size: 0.85rem;
        }

        .btn-small {
            width: auto;
            padding: 12px 16px;
            font-size: 0.85rem;
            border-radius: 12px;
        }

        /* Responsive: schermi piccoli */
        @media (max-width: 640px) {
            .container {
                margin: 10px;
                padding: 24px;
                border-radius: 20px;
            }
            h1 { font-size: 2rem; }
        }

        @media (min-width: 641px) and (max-width: 1024px) {
            .container {
                max-width: 90%;
                padding: 36px;
            }
        }
    </style>
</head>
<body>
    <canvas id="bg-canvas"></canvas>

    <div class="container">
        <div class="header-section">
            <h1>ICV Scrape</h1>
            <div class="subtitle">Importazione Torrent</div>
        </div>
        
        <div class="form-group">
            <label>Metodo di Importazione</label>
            <select id="modeSelector">
                <option value="debrid">Debrid Search (VELOCE)</option>
                <option value="nodebrid">No Debrid (LENTO)</option>
            </select>
        </div>

        <div class="form-group" id="magnetGroup">
            <label>Magnet Link o Info Hash</label>
            <input type="text" id="magnetLink" placeholder="magnet:?xt=urn:btih:...">
        </div>

        <div class="or-divider">OPPURE</div>

        <div class="form-group" id="fileGroup">
            <label>Carica File .torrent</label>
            <input type="file" id="torrentFile" accept=".torrent">
        </div>

        <div class="grid-half">
            <div class="form-group" style="position: relative;">
                <!-- TABS: ID vs Search -->
                <div style="display:flex; gap:15px; margin-bottom:12px; font-size:0.85rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 5px;">
                    <span id="tabId" style="cursor:pointer; color:var(--neon-secondary); font-weight:bold; border-bottom:2px solid var(--neon-secondary); padding-bottom: 5px;">🆔 ID Diretto</span>
                    <span id="tabSearch" style="cursor:pointer; color:#94a3b8; padding-bottom: 5px; transition: color 0.3s;">🔍 Cerca Titolo</span>
                </div>

                <label id="labelId">ID IMDb o TMDB</label>
                
                <!-- ID INPUT MODE -->
                <div id="idInputContainer" style="position: relative; display: flex; align-items: center;">
                    <input type="text" id="imdbId" placeholder="Es: tt1234567 o 550" style="padding-right: 90px;">
                    <button id="checkBtn" type="button" class="check-btn" style="top: 50%; right: 5px;">🔍 Verifica</button>
                </div>

                <!-- SEARCH INPUT MODE -->
                <div id="searchInputContainer" style="display:none;">
                    <div style="display: flex; gap: 10px;">
                        <input type="text" id="searchTerm" placeholder="Nome Film o Serie..." style="flex:1;">
                        <button id="searchBtn" type="button" class="btn-glow" style="width: auto; padding: 12px 20px; font-size: 0.9rem; border-radius: 12px;">Cerca</button>
                    </div>
                    <!-- Results Dropdown -->
                    <div id="searchResults" style="
                        margin-top: 10px; 
                        max-height: 250px; 
                        overflow-y: auto; 
                        background: rgba(15, 23, 42, 0.95); 
                        border: 1px solid var(--border-low);
                        border-radius: 12px; 
                        display:none;
                        position: absolute;
                        width: 100%;
                        z-index: 100;
                        box-shadow: 0 10px 25px rgba(0,0,0,0.5);
                    "></div>
                </div>
            </div>
            <div class="form-group">
                <label>Tipo Contenuto</label>
                <select id="type">
                    <option value="series">Serie TV / Stagione</option>
                    <option value="movie">Film</option>
                    <option value="pack" style="color: #4EC9B0; font-weight: bold;">📦 Pack Multi-Film (No ID)</option>
                </select>
                <!-- Checkbox replaced by Dropdown Option -->
            </div>
        </div>

        <div id="metaPreview" style="display: none;"></div>

        <div id="debridKeys">
            <div class="grid-half">
                <div class="form-group">
                    <label>Real-Debrid <a href="https://real-debrid.com/apitoken" target="_blank" style="text-decoration:none; cursor:pointer;" title="Recupera API Key">API 🔑</a></label>
                    <input type="password" id="rdKey" placeholder="Opzionale se impostata">
                </div>
                <div class="form-group">
                    <label>Chiave Torbox <a href="https://torbox.app/settings" target="_blank" style="text-decoration:none; cursor:pointer;" title="Recupera API Key">API 🔑</a></label>
                    <input type="password" id="tbKey" placeholder="Opzionale se impostata">
                </div>
            </div>
        </div>

        <div class="form-group">
            <label>Seeders (Opzionale)</label>
            <input type="number" id="seeders" placeholder="Lascia vuoto per auto-check">
        </div>

        <div style="display: flex; align-items: center; gap: 12px;">
            <button id="submitBtn" class="btn-glow pulse-active" disabled style="opacity: 0.5; cursor: not-allowed;">Avvia Importazione</button>
            <label style="display: flex; align-items: center; gap: 8px; margin: 0; font-size: 0.75rem; letter-spacing: 0.5px; text-transform: uppercase; color: #cbd5e1;">
                <input type="checkbox" id="manualMapToggle" style="width: 18px; height: 18px;"> Mappatura Manuale Serie
            </label>
        </div>
        <div id="result"></div>
        <div id="mappingSection" class="mapping-section" style="display: none;">
            <div class="mapping-title">Mappatura Episodi (TMDB)</div>
            <div class="mapping-controls">
                <button id="autoMatchBtn" type="button" class="btn-glow btn-small">AutoMatch</button>
                <select id="seasonSelect"></select>
                <select id="episodeSelect"></select>
                <div id="mappingStatus" class="mapping-status">Seleziona una stagione per iniziare.</div>
            </div>
            <div id="episodesTable" class="mapping-table"></div>
            <button id="saveMappingBtn" class="btn-glow" disabled>Salva Mappatura</button>
        </div>
        <div id="debug">In attesa...</div>
    </div>

    <script>
        // --- ADVANCED NEURAL PARTICLES ---
        const canvas = document.getElementById('bg-canvas');
        const ctx = canvas.getContext('2d');
        let particles = [];

        function initCanvas() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }

        window.addEventListener('resize', initCanvas);
        initCanvas();

        class Node {
            constructor() {
                this.x = Math.random() * canvas.width;
                this.y = Math.random() * canvas.height;
                this.vx = (Math.random() - 0.5) * 0.8;
                this.vy = (Math.random() - 0.5) * 0.8;
                this.radius = Math.random() * 2 + 1;
                this.color = Math.random() > 0.5 ? '#a855f7' : '#06b6d4';
            }
            update() {
                this.x += this.vx;
                this.y += this.vy;
                if (this.x < 0 || this.x > canvas.width) this.vx *= -1;
                if (this.y < 0 || this.y > canvas.height) this.vy *= -1;
            }
            draw() {
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
                ctx.fillStyle = this.color;
                ctx.fill();
                // Glow
                ctx.shadowBlur = 15;
                ctx.shadowColor = this.color;
            }
        }

        for (let i = 0; i < 70; i++) particles.push(new Node());

        function drawScene() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.shadowBlur = 0; // Reset for lines
            
            for (let i = 0; i < particles.length; i++) {
                const p1 = particles[i];
                p1.update();
                p1.draw();

                for (let j = i + 1; j < particles.length; j++) {
                    const p2 = particles[j];
                    const dx = p1.x - p2.x;
                    const dy = p1.y - p2.y;
                    const dist = Math.sqrt(dx*dx + dy*dy);

                    if (dist < 180) {
                        ctx.beginPath();
                        ctx.strokeStyle = 'rgba(148, 163, 184, ' + (1 - dist / 180 * 0.5) + ')';
                        ctx.lineWidth = 0.5;
                        ctx.moveTo(p1.x, p1.y);
                        ctx.lineTo(p2.x, p2.y);
                        ctx.stroke();
                    }
                }
            }
            requestAnimationFrame(drawScene);
        }
        drawScene();

        // --- CORE LOGIC ---
        const modeSelector = document.getElementById('modeSelector');
        const debridKeys = document.getElementById('debridKeys');
        const imdbInput = document.getElementById('imdbId');
        const typeSelect = document.getElementById('type');
        const previewDiv = document.getElementById('metaPreview');
        const submitBtn = document.getElementById('submitBtn');
        const checkBtn = document.getElementById('checkBtn');
        const mappingSection = document.getElementById('mappingSection');
        const seasonSelect = document.getElementById('seasonSelect');
        const episodeSelect = document.getElementById('episodeSelect');
        const episodesTable = document.getElementById('episodesTable');
        const mappingStatus = document.getElementById('mappingStatus');
        const autoMatchBtn = document.getElementById('autoMatchBtn');
        const saveMappingBtn = document.getElementById('saveMappingBtn');
        const manualMapToggle = document.getElementById('manualMapToggle');

        // Initial validation state
        let isValidated = false;
        let currentTmdbId = null; // Store detected TMDB ID
        let lastImport = null;
        let currentEpisodes = [];
        let pendingPreview = null; // ✅ Stores preview data when manual mapping (torrent NOT yet imported)
        let mappingSelections = new Map(); // key: "season-episode" -> fileId

        // ✅ Update button text based on manual mapping toggle
        function updateSubmitButtonText() {
            if (manualMapToggle.checked && typeSelect.value === 'series') {
                submitBtn.innerText = 'Inizia Collegamento Puntate';
            } else {
                submitBtn.innerText = 'Avvia Importazione';
            }
        }

        // Reset validation on input change
        imdbInput.addEventListener('input', () => {
            isValidated = false;
            currentTmdbId = null; // Reset
            submitBtn.disabled = true;
            submitBtn.style.opacity = '0.5';
            submitBtn.style.cursor = 'not-allowed';
            previewDiv.style.display = 'none';
        });

        // ✅ NEW: Handle Pack Mode (No ID required)
        function checkPackMode() {
            const isPack = typeSelect.value === 'pack';
            const imdbGroup = document.getElementById('imdbId').parentNode.parentNode; // Form group
            
                if (isPack) {
                // Disable ID, look for magnet/file
                imdbInput.disabled = true;
                checkBtn.disabled = true;
                imdbInput.placeholder = "NON RICHIESTO per Pack (Match su Titoli)";
                imdbInput.style.opacity = '0.5';
                
                // Disable Search Tabs in Pack Mode
                document.getElementById('tabSearch').style.pointerEvents = 'none';
                document.getElementById('tabSearch').style.opacity = '0.3';
                document.getElementById('tabId').click(); // Force ID tab

                // Enable Submit if file/magnet exists
                const hasFile = document.getElementById('magnetLink').value.trim() || document.getElementById('torrentFile').files.length > 0;
                if (hasFile) {
                    submitBtn.disabled = false;
                    submitBtn.style.opacity = '1';
                    submitBtn.style.cursor = 'pointer';
                } else {
                    submitBtn.disabled = true;
                    submitBtn.style.opacity = '0.5';
                    submitBtn.style.cursor = 'not-allowed';
                }
            } else {
                // Restore Normal Mode
                imdbInput.disabled = false;
                checkBtn.disabled = false;
                imdbInput.placeholder = "Es: tt1234567 o 550";
                imdbInput.style.opacity = '1';
                
                // Re-enable tabs
                document.getElementById('tabSearch').style.pointerEvents = 'auto';
                document.getElementById('tabSearch').style.opacity = '1';

                // Reset submit unless validated
                if (!isValidated) {
                    submitBtn.disabled = true;
                    submitBtn.style.opacity = '0.5';
                    submitBtn.style.cursor = 'not-allowed';
                }
            }
        }
        
        // --- SEARCH LOGIC ---
        const tabId = document.getElementById('tabId');
        const tabSearch = document.getElementById('tabSearch');
        const idContainer = document.getElementById('idInputContainer');
        const searchContainer = document.getElementById('searchInputContainer');
        const labelId = document.getElementById('labelId');

        tabId.addEventListener('click', () => {
            idContainer.style.display = 'flex';
            searchContainer.style.display = 'none';
            tabId.style.color = 'var(--neon-secondary)'; tabId.style.borderBottom = '2px solid var(--neon-secondary)';
            tabSearch.style.color = '#94a3b8'; tabSearch.style.borderBottom = 'transparent';
            labelId.innerText = 'ID IMDb o TMDB';
        });

        tabSearch.addEventListener('click', () => {
            idContainer.style.display = 'none';
            searchContainer.style.display = 'block';
            tabSearch.style.color = 'var(--neon-secondary)'; tabSearch.style.borderBottom = '2px solid var(--neon-secondary)';
            tabId.style.color = '#94a3b8'; tabId.style.borderBottom = 'transparent';
            labelId.innerText = 'Cerca Titolo (Cinemeta)';
        });

        document.getElementById('searchBtn').addEventListener('click', async () => {
            const q = document.getElementById('searchTerm').value.trim();
            const typeRaw = typeSelect.value;
            const type = typeRaw === 'pack' ? 'movie' : typeRaw; // Search as movie for packs
            
            if(q.length < 2) return;
            
            const resDiv = document.getElementById('searchResults');
            resDiv.style.display = 'block';
            resDiv.innerHTML = '<div style="padding:15px; text-align:center; color:#94a3b8;">⏳ Ricerca in corso...</div>';

            try {
                // Use absolute path /scrape/search because relative 'search' might hit root /search if trailing slash missing
                const res = await fetch(\`/scrape/search?q=\${encodeURIComponent(q)}&type=\${type}\`);
                const data = await res.json();
                
                if(data.results && data.results.length > 0) {
                    resDiv.innerHTML = data.results.map(r => \`
                        <div class="search-item" onclick="selectResult('\${r.imdb_id || r.id}')" style="
                            padding:12px; 
                            border-bottom:1px solid rgba(255,255,255,0.05); 
                            cursor:pointer; 
                            display:flex; 
                            align-items:center; 
                            gap:15px; 
                            transition: background 0.2s;
                        " onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
                            <img src="\${r.poster}" style="width:35px; height:52px; object-fit:cover; border-radius:4px; background:#1e293b;" onerror="this.style.display='none'">
                            <div style="flex:1;">
                                <div style="font-weight:bold; color:white; font-size:0.95rem;">\${r.name}</div>
                                <div style="font-size:0.8rem; color:#94a3b8;">\${r.releaseInfo || r.year || 'N/A'} • \${r.type === 'movie' ? 'Film' : 'Serie'}</div>
                            </div>
                        </div>
                    \`).join('');
                } else {
                     resDiv.innerHTML = '<div style="padding:15px; text-align:center; color:#f87171;">⚠️ Nessun risultato trovato.</div>';
                }

            } catch(e) {
                resDiv.innerHTML = '<div style="padding:15px; text-align:center; color:#f87171;">❌ Errore durante la ricerca.</div>';
            }
        });

        // Enter key for search
        document.getElementById('searchTerm').addEventListener('keypress', (e) => { 
            if (e.key === 'Enter') document.getElementById('searchBtn').click(); 
        });

        window.selectResult = (id) => {
            imdbInput.value = id;
            document.getElementById('searchResults').style.display = 'none';
            // Switch to ID tab
            tabId.click();
            // Trigger verify
            fetchMetadata();
        };

        typeSelect.addEventListener('change', () => {
             // Reset validation logic when switching types
             if(typeSelect.value !== 'pack') {
                 if(imdbInput.value) { isValidated = false; submitBtn.disabled = true; }
             }
             checkPackMode();
             validateDebridKeys(); // Validate keys on type change too
             updateSubmitButtonText();
        });

        // Validation for Debrid Keys
        function validateDebridKeys() {
            const mode = modeSelector.value;
            const rd = document.getElementById('rdKey').value.trim();
            const tb = document.getElementById('tbKey').value.trim();
            
            if (mode === 'debrid' && !rd && !tb) {
                submitBtn.disabled = true;
                submitBtn.title = "Inserisci almeno una chiave API (RD o TorBox)";
                return false;
            }
            
            // Only re-enable if other validations pass (checked by checkPackMode or metadata check)
            // But strict check: if debrid & no keys -> BLOCK
            // If keys ok, we don't automatically enable, we let other checks decide or we enable if already validated
            if (isValidated) {
                 submitBtn.disabled = false;
                 submitBtn.title = "";
                 
                 // ✅ FORCE VISUAL ENABLE
                 submitBtn.style.opacity = '1';
                 submitBtn.style.cursor = 'pointer';
                 submitBtn.classList.add('pulse-active');
            }
            return true;
        }

        function escapeHtml(value) {
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function formatBytes(bytes) {
            if (!bytes || bytes <= 0) return '0 B';
            const units = ['B', 'KB', 'MB', 'GB'];
            const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
            const value = bytes / Math.pow(1024, index);
            return \`\${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} \${units[index]}\`;
        }

        function setMappingStatus(text, isError = false) {
            mappingStatus.textContent = text;
            mappingStatus.style.color = isError ? '#fca5a5' : '#94a3b8';
        }

        function updateSaveButtonState() {
            const hasSelection = [...mappingSelections.values()].some(value => value);
            saveMappingBtn.disabled = !hasSelection;
            saveMappingBtn.style.opacity = hasSelection ? '1' : '0.5';
            saveMappingBtn.style.cursor = hasSelection ? 'pointer' : 'not-allowed';
        }

        function getMappingKey(seasonNumber, episodeNumber) {
            return \`\${seasonNumber}-\${episodeNumber}\`;
        }

        function buildFileOptions(selectedId) {
            const files = lastImport?.videoFiles || [];
            const sorted = [...files].sort((a, b) => (a.filename || '').localeCompare(b.filename || ''));
            const options = ['<option value="">-- Non assegnato --</option>'];
            const usedFileIds = new Set(
                [...mappingSelections.values()]
                    .filter(value => value !== null && value !== undefined && value !== '')
                    .map(value => String(value))
            );

            for (const file of sorted) {
                const label = \`\${file.filename} (\${formatBytes(file.bytes || 0)})\`;
                const fileId = String(file.id);
                if (usedFileIds.has(fileId) && String(selectedId) !== fileId) continue;
                const selected = fileId === String(selectedId) ? ' selected' : '';
                options.push(\`<option value="\${file.id}"\${selected}>\${escapeHtml(label)}<\/option>\`);
            }

            return options.join('');
        }

        function renderEpisodes(episodes, seasonNumber) {
            if (!episodes || episodes.length === 0) {
                episodesTable.innerHTML = '<div style="color:#94a3b8; padding:10px 0;">Nessun episodio trovato.</div>';
                updateSaveButtonState();
                return;
            }

            const parsedMap = new Map();
            for (const file of lastImport?.videoFiles || []) {
                if (file.parsedSeason && file.parsedEpisode) {
                    const key = \`\${file.parsedSeason}-\${file.parsedEpisode}\`;
                    if (!parsedMap.has(key)) parsedMap.set(key, file.id);
                }
            }

            const sNum = String(seasonNumber).padStart(2, '0');
            episodesTable.innerHTML = episodes.map(ep => {
                const key = getMappingKey(seasonNumber, ep.episode_number);
                let preselected = mappingSelections.get(key);
                if (!preselected) {
                    preselected = parsedMap.get(key) || '';
                    if (preselected) {
                        mappingSelections.set(key, String(preselected));
                    }
                }
                return \`
                    <div class="mapping-row" data-episode="\${ep.episode_number}">
                        <strong>S\${sNum}E\${String(ep.episode_number).padStart(2, '0')}</strong>
                        <span>\${escapeHtml(ep.name || '')}</span>
                        <select class="mapping-select">\${buildFileOptions(preselected)}</select>
                    </div>
                \`;
            }).join('');

            updateSaveButtonState();
        }

        function updateEpisodeSelect() {
            const sNum = String(seasonSelect.value).padStart(2, '0');
            const options = ['<option value="">Tutti gli episodi</option>'];
            for (const ep of currentEpisodes) {
                options.push(\`<option value="\${ep.episode_number}">S\${sNum}E\${String(ep.episode_number).padStart(2, '0')}</option>\`);
            }
            episodeSelect.innerHTML = options.join('');
        }

        async function loadSeasons(tmdbId) {
            seasonSelect.innerHTML = '<option>Caricamento stagioni...</option>';
            try {
                const res = await fetch(\`/scrape/tmdb/seasons?tmdbId=\${tmdbId}\`);
                const data = await res.json();
                const seasons = (data.seasons || []).filter(s => s.season_number !== null && s.season_number !== undefined);

                if (!seasons.length) {
                    seasonSelect.innerHTML = '<option>Nessuna stagione</option>';
                    setMappingStatus('Nessuna stagione disponibile su TMDB.', true);
                    return;
                }

                seasonSelect.innerHTML = seasons.map(s =>
                    \`<option value="\${s.season_number}">Stagione \${s.season_number} \u2014 \${escapeHtml(s.name)} (\${s.episode_count || 0} ep)</option>\`
                ).join('');

                await loadSeasonEpisodes(seasonSelect.value, tmdbId);
            } catch (e) {
                seasonSelect.innerHTML = '<option>Errore TMDB</option>';
                setMappingStatus('Errore durante il caricamento stagioni.', true);
            }
        }

        async function loadSeasonEpisodes(seasonNumber, tmdbId) {
            setMappingStatus('Caricamento episodi...');
            episodesTable.innerHTML = '';
            try {
                const res = await fetch(\`/scrape/tmdb/season?tmdbId=\${tmdbId}&season=\${seasonNumber}\`);
                const data = await res.json();
                currentEpisodes = data.episodes || [];
                renderEpisodes(currentEpisodes, parseInt(seasonNumber, 10));
                updateEpisodeSelect();
                setMappingStatus(\`Stagione \${seasonNumber} caricata. Seleziona i file.\`);
            } catch (e) {
                setMappingStatus('Errore durante il caricamento episodi.', true);
            }
        }

        async function initMappingUI(payload) {
            if (!payload || !payload.infoHash || !payload.videoFiles) return;

            const tmdbId = payload.tmdbId;
            if (!tmdbId) {
                mappingSection.style.display = 'block';
                setMappingStatus('TMDB ID non disponibile. Verifica la scheda metadata.', true);
                return;
            }

            lastImport = payload;
            mappingSection.style.display = 'block';
            await loadSeasons(tmdbId);
        }

        // Add listeners for keys
        document.getElementById('rdKey').addEventListener('input', validateDebridKeys);
        document.getElementById('tbKey').addEventListener('input', validateDebridKeys);
        modeSelector.addEventListener('change', validateDebridKeys);

        episodesTable.addEventListener('change', (event) => {
            if (event.target && event.target.classList.contains('mapping-select')) {
                const row = event.target.closest('.mapping-row');
                const episodeNumber = parseInt(row?.dataset?.episode, 10);
                const seasonNumber = parseInt(seasonSelect.value, 10);
                if (!Number.isNaN(seasonNumber) && !Number.isNaN(episodeNumber)) {
                    const key = getMappingKey(seasonNumber, episodeNumber);
                    if (event.target.value) {
                        mappingSelections.set(key, String(event.target.value));
                    } else {
                        mappingSelections.delete(key);
                    }
                    renderEpisodes(currentEpisodes, seasonNumber);
                }
                updateSaveButtonState();
            }
        });

        manualMapToggle.addEventListener('change', () => {
            if (!manualMapToggle.checked) {
                mappingSection.style.display = 'none';
                lastImport = null;
                pendingPreview = null;
                mappingSelections = new Map();
            }
            updateSubmitButtonText();
        });

        seasonSelect.addEventListener('change', async () => {
            if (!lastImport || !lastImport.tmdbId) return;
            await loadSeasonEpisodes(seasonSelect.value, lastImport.tmdbId);
        });

        episodeSelect.addEventListener('change', () => {
            const targetEpisode = episodeSelect.value;
            if (!targetEpisode) return;
            const row = episodesTable.querySelector(\`[data-episode="\${targetEpisode}"]\`);
            if (row) {
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                row.style.boxShadow = '0 0 0 2px rgba(168, 85, 247, 0.5)';
                setTimeout(() => { row.style.boxShadow = ''; }, 1200);
            }
        });

        autoMatchBtn.addEventListener('click', async () => {
            if (!lastImport) return;
            autoMatchBtn.disabled = true;
            setMappingStatus('AutoMatch in corso...');

            try {
                const res = await fetch('/scrape/automatch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        infoHash: lastImport.infoHash,
                        imdbId: lastImport.imdbId,
                        type: 'series',
                        files: lastImport.videoFiles,
                        manualMapping: manualMapToggle.checked
                    })
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'AutoMatch fallito');

                setMappingStatus(\`AutoMatch completato: \${data.matched} trovati, \${data.unmatched} da mappare.\`);
            } catch (e) {
                setMappingStatus(e.message, true);
            } finally {
                autoMatchBtn.disabled = false;
            }
        });

        saveMappingBtn.addEventListener('click', async () => {
            if (!lastImport) return;

            const mappings = [];
            for (const [key, fileId] of mappingSelections.entries()) {
                if (!fileId) continue;
                const [seasonStr, episodeStr] = key.split('-');
                const seasonNumber = parseInt(seasonStr, 10);
                const episodeNumber = parseInt(episodeStr, 10);
                if (Number.isNaN(seasonNumber) || Number.isNaN(episodeNumber)) continue;

                const file = lastImport.videoFiles.find(f => String(f.id) === String(fileId));
                if (!file) continue;

                mappings.push({
                    season: seasonNumber,
                    episode: episodeNumber,
                    file_index: file.id,
                    file_path: file.path,
                    file_size: file.bytes || 0
                });
            }

            if (mappings.length === 0) {
                setMappingStatus('Seleziona almeno un file per salvare.', true);
                return;
            }

            saveMappingBtn.disabled = true;
            const resDiv = document.getElementById('result');
            const dbg = document.getElementById('debug');

            try {
                // ✅ If pendingPreview exists, import torrent FIRST, then save mappings
                if (pendingPreview) {
                    setMappingStatus('Importazione torrent in corso...');
                    dbg.innerText = 'Importazione torrent + mappatura...';

                    const formData = new FormData();
                    formData.append('method', pendingPreview.mode);
                    formData.append('imdbId', pendingPreview.imdbId);
                    if (pendingPreview.tmdbId) formData.append('tmdbId', pendingPreview.tmdbId);
                    formData.append('type', pendingPreview.typeVal);
                    formData.append('manualMapping', 'true');
                    if (pendingPreview.seedersVal) formData.append('seeders', pendingPreview.seedersVal);
                    if (pendingPreview.rdKey) formData.append('rdKey', pendingPreview.rdKey);
                    if (pendingPreview.tbKey) formData.append('tbKey', pendingPreview.tbKey);

                    if (pendingPreview.torrentBase64) {
                        formData.append('torrentFileBase64', pendingPreview.torrentBase64);
                    } else {
                        formData.append('magnetLink', pendingPreview.magnetLink);
                    }

                    const importRes = await fetch('/scrape/add', {
                        method: 'POST',
                        body: formData
                    });

                    const importData = await importRes.json();
                    if (!importRes.ok) {
                        throw new Error(importData.error || 'Importazione torrent fallita');
                    }

                    setMappingStatus('Torrent importato. Salvataggio mappatura...');
                }

                // Save mappings
                setMappingStatus('Salvataggio mappatura...');
                const mapRes = await fetch('/scrape/map', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        infoHash: lastImport.infoHash,
                        imdbId: lastImport.imdbId,
                        mappings
                    })
                });

                const mapData = await mapRes.json();
                if (!mapRes.ok) throw new Error(mapData.error || 'Salvataggio fallito');

                if (pendingPreview) {
                    resDiv.style.display = 'block';
                    resDiv.className = 'success';
                    resDiv.innerHTML = \`⚡ <b>Importazione + Mappatura Completata</b><br><small>\${mapData.updated} episodi collegati con successo.</small>\`;
                    dbg.innerText = 'Operazione completata.';
                    pendingPreview = null;
                }

                setMappingStatus(\`✅ Mappatura salvata: \${mapData.updated} collegati, \${mapData.failed} falliti.\`);
            } catch (e) {
                setMappingStatus('❌ ' + e.message, true);
                if (pendingPreview) {
                    resDiv.style.display = 'block';
                    resDiv.className = 'error';
                    resDiv.innerText = 'Errore: ' + e.message;
                    dbg.innerText = 'Problema riscontrato.';
                }
            } finally {
                saveMappingBtn.disabled = false;
                updateSaveButtonState();
            }
        });

        // Add listeners to Inputs to trigger Pack check (to enable button)
        document.getElementById('magnetLink').addEventListener('input', checkPackMode);
        document.getElementById('torrentFile').addEventListener('change', checkPackMode);

        // METADATA CHECK LOGIC
        async function fetchMetadata() {
            const id = imdbInput.value.trim();
            const type = typeSelect.value;
            
            if (id.length < 3) return;

            checkBtn.innerText = '⏳';
            checkBtn.disabled = true;

            previewDiv.style.display = 'block';
            previewDiv.innerHTML = '<div style="text-align:center; color:#94a3b8;">🔍 Verifica in corso...</div>';
            previewDiv.className = 'preview-card';

            try {
                const res = await fetch(\`/scrape/meta?id=\${id}&type=\${type}\`);
                const data = await res.json();

                if (data.found) {
                    // Auto-Correct Type if needed
                    if (data.detected_type && data.detected_type !== type) {
                        typeSelect.value = data.detected_type;
                        // flash effect?
                    }

                    previewDiv.innerHTML = \`
                        <img src="\${data.poster}" class="preview-poster" onerror="this.onerror=null; this.src='https://via.placeholder.com/80x120?text=No+Img'">
                        <div class="preview-info">
                            <h3>\${data.title} (\${data.year ? data.year.split('–')[0] : 'N/A'})</h3>
                            <p>\${data.description ? data.description.substring(0, 100) + '...' : 'Nessuna descrizione.'}</p>
                            <span class="preview-tag">\${data.imdb_id}</span>
                            \${data.original_id !== data.imdb_id ? '<span class="preview-tag" style="background:#a855f7; color:white;">TMDB Converted</span>' : ''}
                            \${data.warning ? '<div style="color: #fca5a5; font-size: 0.8rem; margin-top:5px;">⚠️ ' + data.warning + '</div>' : ''}
                        </div>
                    \`;
                    
                    if (data.imdb_id !== id) {
                        imdbInput.value = data.imdb_id;
                    }

                    // Save TMDB ID if present
                    if (data.tmdb_id) {
                        currentTmdbId = data.tmdb_id;
                    }

                    // ENABLE IMPORT - Check Debrid Keys First!
                    isValidated = true;
                    
                    if (validateDebridKeys()) {
                        submitBtn.disabled = false;
                        submitBtn.style.opacity = '1';
                        submitBtn.style.cursor = 'pointer';
                    } else {
                         // validateDebridKeys will disable it and set title
                    }

                } else {
                    previewDiv.innerHTML = '<div style="color:#f87171;">⚠️ Nessun risultato trovato. Verifica ID.</div>';
                    isValidated = false;
                }
            } catch (e) {
                previewDiv.style.display = 'none';
                alert('Errore di connessione verifica');
            } finally {
                checkBtn.innerText = '🔍 Verifica';
                checkBtn.disabled = false;
            }
        }

        checkBtn.addEventListener('click', fetchMetadata);
        // Also trigger on Enter in input
        imdbInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') fetchMetadata(); });

        modeSelector.addEventListener('change', () => {
            debridKeys.style.display = (modeSelector.value === 'nodebrid') ? 'none' : 'block';
        });

        document.getElementById('submitBtn').addEventListener('click', async function() {
            const btn = this;
            const resDiv = document.getElementById('result');
            const dbg = document.getElementById('debug');

            const isManualMappingMode = manualMapToggle.checked && typeSelect.value === 'series';

            dbg.innerText = 'Inizializzazione in corso...';
            btn.disabled = true;
            btn.innerText = 'Elaborazione...';
            resDiv.style.display = 'none';
            mappingSection.style.display = 'none';
            lastImport = null;
            pendingPreview = null;
            mappingSelections = new Map();

            const magnetLink = document.getElementById('magnetLink').value.trim();
            const torrentFile = document.getElementById('torrentFile').files[0];
            const imdbId = document.getElementById('imdbId').value.trim();
            const typeVal = document.getElementById('type').value;
            const seedersVal = document.getElementById('seeders').value.trim();
            const rdKey = document.getElementById('rdKey').value.trim();
            const tbKey = document.getElementById('tbKey').value.trim();
            const mode = modeSelector.value;

            const btnLabel = isManualMappingMode ? 'Inizia Collegamento Puntate' : 'Avvia Importazione';

            if (!imdbId && typeVal !== 'pack') { alert('Inserisci un ID IMDb valido'); btn.disabled = false; btn.innerText = btnLabel; return; }
            if (!torrentFile && !magnetLink) { alert('Inserisci un Magnet Link o carica un file .torrent'); btn.disabled = false; btn.innerText = btnLabel; return; }

            // ✅ Prepare base64 once (used by both preview and import paths)
            let torrentBase64 = null;
            if (torrentFile) {
                dbg.innerText = 'Caricamento file torrent...';
                torrentBase64 = await new Promise((res, rej) => {
                    const r = new FileReader();
                    r.onload = () => res(r.result.split(',')[1]);
                    r.onerror = rej;
                    r.readAsDataURL(torrentFile);
                });
            }

            try {
                if (isManualMappingMode) {
                    // ✅ MANUAL MAPPING: Preview files only (NO DB import)
                    dbg.innerText = 'Recupero file dal torrent...';
                    const formData = new FormData();
                    formData.append('method', mode);
                    if (rdKey) formData.append('rdKey', rdKey);
                    if (tbKey) formData.append('tbKey', tbKey);
                    if (torrentBase64) {
                        formData.append('torrentFileBase64', torrentBase64);
                    } else {
                        formData.append('magnetLink', magnetLink);
                    }

                    const response = await fetch('/scrape/preview-files', {
                        method: 'POST',
                        body: formData
                    });

                    const data = await response.json();
                    resDiv.style.display = 'block';

                    if (response.ok && data.videoFiles && data.videoFiles.length > 0) {
                        resDiv.className = 'success';
                        resDiv.innerHTML = \`📁 <b>Trovati \${data.videoFiles.length} file video</b><br><small>\${data.torrentName} — Seleziona la stagione e collega le puntate, poi clicca <b>Salva Mappatura</b> per importare.</small>\`;
                        dbg.innerText = 'File recuperati. Collega le puntate e salva.';

                        // ✅ Store preview for later import by saveMappingBtn
                        pendingPreview = {
                            infoHash: data.infoHash,
                            torrentName: data.torrentName,
                            totalSize: data.totalSize,
                            magnetLink,
                            torrentBase64,
                            imdbId,
                            tmdbId: currentTmdbId,
                            typeVal,
                            seedersVal,
                            rdKey,
                            tbKey,
                            mode
                        };

                        await initMappingUI({
                            infoHash: data.infoHash,
                            imdbId: imdbId,
                            tmdbId: currentTmdbId,
                            videoFiles: data.videoFiles
                        });
                    } else {
                        resDiv.className = 'error';
                        resDiv.innerText = 'Errore: ' + (data.error || 'Nessun file video trovato nel torrent');
                        dbg.innerText = 'Problema riscontrato.';
                    }
                } else {
                    // ✅ NORMAL FLOW: Import directly
                    const formData = new FormData();
                    formData.append('method', mode);
                    formData.append('imdbId', imdbId);
                    if (currentTmdbId) formData.append('tmdbId', currentTmdbId);
                    formData.append('type', typeVal);
                    formData.append('manualMapping', 'false');
                    if (seedersVal) formData.append('seeders', seedersVal);
                    if (rdKey) formData.append('rdKey', rdKey);
                    if (tbKey) formData.append('tbKey', tbKey);
                    if (typeVal === 'pack') formData.append('forcePackMode', 'true');

                    if (torrentBase64) {
                        formData.append('torrentFileBase64', torrentBase64);
                    } else {
                        formData.append('magnetLink', magnetLink);
                    }

                    dbg.innerText = 'Invio dati al server...';
                    const response = await fetch('/scrape/add', {
                        method: 'POST',
                        body: formData
                    });

                    const data = await response.json();
                    resDiv.style.display = 'block';

                    if (response.ok) {
                        resDiv.className = 'success';
                        resDiv.innerHTML = '⚡ <b>Importazione Completata</b><br><small>' + data.torrent.title + ' è stato aggiunto con successo.</small>';
                        dbg.innerText = 'Operazione terminata.';
                    } else {
                        resDiv.className = 'error';
                        resDiv.innerText = 'Errore: ' + (data.error || 'Si è verificato un errore imprevisto');
                        dbg.innerText = 'Problema riscontrato.';
                    }
                }
            } catch (err) {
                resDiv.style.display = 'block';
                resDiv.className = 'error';
                resDiv.innerText = 'Errore di rete: ' + err.message;
                dbg.innerText = 'Connessione fallita.';
            } finally {
                btn.disabled = false;
                updateSubmitButtonText();
            }
        });
    </script>
</body>
</html>`);
});

// GET /manual/search (TMDB Proxy)
const TMDB_SEARCH_KEY = '5462f78469f3d80bf5201645294c16e4'; // User provided / code context

async function fetchTmdbSeasons(tmdbId) {
    const url = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_SEARCH_KEY}&language=it-IT`;
    const resp = await axios.get(url, { timeout: 5000 });
    const seasons = resp.data?.seasons || [];
    return seasons
        .filter(s => typeof s.season_number === 'number')
        .map(s => ({
            season_number: s.season_number,
            name: s.name || `Stagione ${s.season_number}`,
            episode_count: s.episode_count || 0
        }))
        .sort((a, b) => a.season_number - b.season_number);
}

async function fetchTmdbSeasonEpisodes(tmdbId, seasonNumber) {
    const url = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}?api_key=${TMDB_SEARCH_KEY}&language=it-IT`;
    const resp = await axios.get(url, { timeout: 5000 });
    const episodes = resp.data?.episodes || [];
    return episodes
        .filter(e => typeof e.episode_number === 'number')
        .map(e => ({
            episode_number: e.episode_number,
            name: e.name || `Episodio ${e.episode_number}`,
            overview: e.overview || '',
            air_date: e.air_date || null
        }))
        .sort((a, b) => a.episode_number - b.episode_number);
}

router.get('/search', async (req, res) => {
    const { q, type } = req.query;
    if (!q) return res.json({ results: [] });

    // TMDB uses 'tv' or 'movie'
    const tmdbType = (type === 'serie' || type === 'series' || type === 'tv') ? 'tv' : 'movie';

    try {
        console.log(`🔍 [MANUAL] Searching TMDB for: "${q}" (${tmdbType})`);
        const url = `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${TMDB_SEARCH_KEY}&query=${encodeURIComponent(q)}&language=it-IT&include_adult=false`;

        const resp = await axios.get(url, { timeout: 5000 });

        if (resp.data && resp.data.results) {
            // Map TMDB results to common format
            const results = resp.data.results.map(r => ({
                id: 'tmdb:' + r.id, // Prefix to ensure it is treated as TMDB ID
                name: r.title || r.name,
                year: r.release_date ? r.release_date.split('-')[0] : (r.first_air_date ? r.first_air_date.split('-')[0] : 'N/A'),
                poster: r.poster_path ? `https://image.tmdb.org/t/p/w92${r.poster_path}` : 'https://via.placeholder.com/92x138?text=No+Img',
                type: tmdbType === 'tv' ? 'series' : 'movie'
            })).slice(0, 10); // Limit to 10 results

            return res.json({ results });
        }
        res.json({ results: [] });
    } catch (e) {
        console.error("❌ [MANUAL] Search Error:", e.message);
        res.status(500).json({ error: "Search failed" });
    }
});

// GET /scrape/tmdb/seasons - TMDB seasons list
router.get('/tmdb/seasons', async (req, res) => {
    const { tmdbId } = req.query;
    if (!tmdbId) return res.status(400).json({ error: 'Missing tmdbId' });

    try {
        const seasons = await fetchTmdbSeasons(tmdbId);
        return res.json({ seasons });
    } catch (e) {
        console.error('❌ [MANUAL] TMDB seasons error:', e.message);
        return res.status(500).json({ error: 'TMDB seasons fetch failed' });
    }
});

// GET /scrape/tmdb/season - TMDB episode list for a season
router.get('/tmdb/season', async (req, res) => {
    const { tmdbId, season } = req.query;
    if (!tmdbId || season === undefined) return res.status(400).json({ error: 'Missing tmdbId or season' });

    const seasonNumber = parseInt(season, 10);
    if (Number.isNaN(seasonNumber)) return res.status(400).json({ error: 'Invalid season number' });

    try {
        const episodes = await fetchTmdbSeasonEpisodes(tmdbId, seasonNumber);
        return res.json({ episodes });
    } catch (e) {
        console.error('❌ [MANUAL] TMDB season error:', e.message);
        return res.status(500).json({ error: 'TMDB season fetch failed' });
    }
});

// POST /scrape/automatch - Try existing logic to auto-map episodes
router.post('/automatch', async (req, res) => {
    try {
        const { infoHash, imdbId, type, files, manualMapping } = req.body || {};

        if (!infoHash || !imdbId || type !== 'series' || !Array.isArray(files)) {
            return res.status(400).json({ error: 'Missing or invalid infoHash, imdbId, type, or files' });
        }

        const filesToInsert = [];
        const unmatchedFiles = [];
        const processed = [];

        for (const file of files) {
            if (!file || !file.path) continue;
            if (!packFilesHandler.isVideoFile(file.path) || (file.bytes || 0) < 50 * 1024 * 1024) continue;

            const filename = file.path.split('/').pop();
            let parsed = packFilesHandler.parseSeasonEpisode(filename);
            const folderSeason = parseSeasonFromPath(file.path);

            if (folderSeason) {
                parsed = packFilesHandler.parseSeasonEpisode(filename, folderSeason);
            }

            let season = null;
            let episode = null;

            if (parsed) {
                season = parsed.season;
                episode = parsed.episode;
            } else {
                const simpleEpMatch = filename.match(/(?:\s-\s|Ep[\s.]*|E)(\d{1,3})(?![0-9])/i);
                if (simpleEpMatch && folderSeason) {
                    season = folderSeason;
                    episode = parseInt(simpleEpMatch[1], 10);
                }
            }

            if (!season || !episode) {
                unmatchedFiles.push({
                    id: file.id,
                    path: file.path,
                    bytes: file.bytes || 0,
                    filename
                });
                continue;
            }

            filesToInsert.push({
                info_hash: infoHash.toLowerCase(),
                file_index: file.id,
                title: filename,
                size: file.bytes || 0,
                imdb_id: imdbId,
                imdb_season: season,
                imdb_episode: episode
            });

            processed.push(filename);
        }

        if (filesToInsert.length > 0) {
            await dbHelper.insertEpisodeFiles(filesToInsert);
        }

        if (String(manualMapping).toLowerCase() === 'true') {
            await dbHelper.updateTorrentProvider(infoHash, 'Custom Manual');
        }

        return res.json({
            status: 'ok',
            matched: filesToInsert.length,
            unmatched: unmatchedFiles.length,
            unmatchedFiles,
            processed
        });
    } catch (err) {
        console.error('❌ [MANUAL] AutoMatch error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// POST /scrape/preview-files - Fetch file list WITHOUT importing to DB
// Used by "Inizia Collegamento Puntate" to show files before actual import
router.post('/preview-files', upload.any(), async (req, res) => {
    console.log("📥 [MANUAL] POST /preview-files called");
    try {
        let {
            magnetLink,
            torrentFileBase64,
            rdKey: bodyRdKey,
            tbKey: bodyTbKey,
            method
        } = req.body;

        const userRdKey = bodyRdKey || DEFAULT_RD_KEY;
        const userTbKey = bodyTbKey || DEFAULT_TB_KEY;

        if (!magnetLink && !torrentFileBase64) {
            return res.status(400).json({ error: "Inserisci un Magnet Link o carica un file .torrent" });
        }

        let infoHash = null;
        let localFiles = null;
        let torrentName = null;

        // 1. Extract InfoHash
        if (torrentFileBase64) {
            try {
                const parsed = parseTorrentFile(torrentFileBase64);
                infoHash = parsed.infoHash.toLowerCase();
                localFiles = parsed.files;
                torrentName = parsed.filename;
            } catch (parseErr) {
                return res.status(400).json({ error: "File torrent corrotto: " + parseErr.message });
            }
        } else {
            const match = magnetLink.match(/xt=urn:btih:([a-zA-Z0-9]+)/);
            infoHash = match ? match[1].toLowerCase() : magnetLink.toLowerCase();
        }

        if (!infoHash || infoHash.length < 40) {
            return res.status(400).json({ error: "Hash non valido" });
        }

        // 2. Check if already in DB
        const existingTorrent = await dbHelper.getTorrent(infoHash);
        if (existingTorrent) {
            return res.status(409).json({
                error: 'Torrent già presente nel database!',
                detail: `Questo torrent (${infoHash}) è già stato importato.`
            });
        }

        // 3. Fetch files (NO DB save)
        let data = null;
        let providerUsed = "";

        if (localFiles && localFiles.length > 0) {
            data = { files: localFiles, filename: torrentName };
            providerUsed = "Local .torrent";
        } else {
            if (!userRdKey && !userTbKey) {
                const cachedTorrent = await fetchTorrentFromCaches(infoHash);
                if (cachedTorrent) {
                    data = { files: cachedTorrent.files, filename: cachedTorrent.filename };
                    providerUsed = "Torrent Cache";
                }
            }
            if (!data && userRdKey) {
                try {
                    data = await fetchFilesFromRealDebrid(infoHash, userRdKey);
                    providerUsed = "Real-Debrid";
                } catch (e) { console.warn("RD preview failed:", e.message); }
            }
            if (!data && userTbKey) {
                try {
                    data = await fetchFilesFromTorbox(infoHash, userTbKey);
                    providerUsed = "Torbox";
                } catch (e) { console.warn("TB preview failed:", e.message); }
            }
        }

        if (!data || !data.files || data.files.length === 0) {
            return res.status(400).json({ error: "Impossibile recuperare la lista file. Verifica il magnet/torrent e le chiavi API." });
        }

        // 4. Filter video files (same logic as /add)
        const videoFiles = [];
        for (const file of data.files) {
            if (!packFilesHandler.isVideoFile(file.path) || file.bytes < 50 * 1024 * 1024) continue;
            const filename = file.path.split('/').pop();
            let parsed = packFilesHandler.parseSeasonEpisode(filename);
            const folderSeason = parseSeasonFromPath(file.path);
            if (folderSeason) {
                parsed = packFilesHandler.parseSeasonEpisode(filename, folderSeason);
            }
            videoFiles.push({
                id: file.id,
                path: file.path,
                bytes: file.bytes || 0,
                filename,
                parsedSeason: parsed?.season || null,
                parsedEpisode: parsed?.episode || null
            });
        }

        if (videoFiles.length === 0) {
            return res.status(400).json({ error: "Nessun file video trovato nel torrent. Non è possibile procedere con il collegamento puntate." });
        }

        console.log(`✅ [MANUAL] Preview: ${videoFiles.length} video files found via ${providerUsed}`);

        return res.json({
            status: 'preview',
            infoHash,
            torrentName: data.filename || torrentName || `Torrent-${infoHash.substr(0, 8)}`,
            videoFiles,
            totalSize: data.files.reduce((acc, f) => acc + (f.bytes || 0), 0),
            provider: providerUsed
        });

    } catch (err) {
        console.error("❌ [MANUAL] Preview error:", err);
        return res.status(500).json({ error: err.message });
    }
});

// POST /scrape/map - Save manual episode mapping
router.post('/map', async (req, res) => {
    try {
        const { infoHash, imdbId, mappings } = req.body || {};
        if (!infoHash || !imdbId || !Array.isArray(mappings)) {
            return res.status(400).json({ error: 'Missing infoHash, imdbId, or mappings' });
        }

        let updated = 0;
        let failed = 0;

        for (const mapping of mappings) {
            const season = parseInt(mapping.season, 10);
            const episode = parseInt(mapping.episode, 10);
            const fileIndex = parseInt(mapping.file_index, 10);
            const filePath = mapping.file_path || '';
            const fileSize = mapping.file_size || null;

            if (!season || !episode || isNaN(fileIndex) || fileIndex < 0 || !filePath) {
                failed++;
                continue;
            }

            const ok = await dbHelper.updateTorrentFileInfo(
                infoHash,
                fileIndex,
                filePath,
                fileSize,
                { imdbId, season, episode }
            );

            if (ok) updated++;
            else failed++;
        }

        if (updated > 0) {
            await dbHelper.updateTorrentProvider(infoHash, 'Custom Manual');
        }

        return res.json({ status: 'ok', updated, failed });
    } catch (err) {
        console.error('❌ [MANUAL] Mapping error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// POST /scrape/add
router.post('/add', upload.any(), async (req, res) => {
    console.log("📥 [MANUAL] POST /add called");
    try {
        let { // ✅ Using let for modification
            method, // 'debrid' or 'nodebrid'
            magnetLink,
            torrentFileBase64,
            imdbId,
            tmdbId, // ✅ Capture TMDB ID
            type,
            rdKey: bodyRdKey,
            tbKey: bodyTbKey,
            seeders: bodySeeders,
            forcePackMode,
            manualMapping
        } = req.body;

        // ✅ HANDLE PACK MODE:
        // If type is 'pack', we treat it as 'movie' but enforce Force Pack Mode and allow NULL ID.
        if (type === 'pack') {
            console.log("📦 [MANUAL] Pack Mode selected. Forcing 'movie' type + forcePackMode=true");
            type = 'movie';
            forcePackMode = true;
            if (!imdbId) imdbId = null; // Normalize empty to null
        }

        // Ensure TMDB ID for catalog mapping when possible
        if (!tmdbId && imdbId && idConverter && typeof idConverter.imdbToTmdb === 'function') {
            try {
                const resolved = await idConverter.imdbToTmdb(imdbId);
                if (resolved && resolved.tmdbId) {
                    tmdbId = resolved.tmdbId;
                }
            } catch (e) {
                console.warn('⚠️ [MANUAL] TMDB resolve failed:', e.message);
            }
        }

        const userRdKey = bodyRdKey || DEFAULT_RD_KEY;
        const userTbKey = bodyTbKey || DEFAULT_TB_KEY;

        if ((!imdbId && !forcePackMode) || !type) {
            return res.status(400).json({ error: "Missing required fields: imdbId, type" });
        }

        if (!magnetLink && !torrentFileBase64) {
            return res.status(400).json({ error: "Either magnetLink or torrentFileBase64 is required" });
        }

        let infoHash = null;
        let localFiles = null; // Files parsed directly from .torrent file
        let torrentName = null;

        // 1. Extract InfoHash (from magnet OR from torrent file)
        if (torrentFileBase64) {
            console.log("📁 [MANUAL] Parsing uploaded .torrent file...");
            try {
                const parsed = parseTorrentFile(torrentFileBase64);
                infoHash = parsed.infoHash.toLowerCase();
                localFiles = parsed.files;
                torrentName = parsed.filename;
                console.log(`✅[MANUAL] Parsed torrent: ${torrentName}, hash: ${infoHash}, files: ${localFiles.length} `);
            } catch (parseErr) {
                return res.status(400).json({ error: "Failed to parse torrent file: " + parseErr.message });
            }
        } else {
            const infoHashMatch = magnetLink.match(/xt=urn:btih:([a-zA-Z0-9]+)/);
            infoHash = infoHashMatch ? infoHashMatch[1].toLowerCase() : magnetLink.toLowerCase();
        }

        if (!infoHash || infoHash.length < 40) {
            return res.status(400).json({ error: "Invalid magnet/hash or corrupt torrent file" });
        }

        console.log(`🛠️ [MANUAL] Step 1: Checking DB for hash ${infoHash}...`);

        // ✅ DUPLICATE CHECK: moved here to cover ALL methods (cache, debrid, local)
        const existingTorrent = await dbHelper.getTorrent(infoHash);
        if (existingTorrent) {
            console.warn(`⚠️ [MANUAL] Torrent ${infoHash} already exists in DB. Skipping.`);
            return res.status(409).json({
                error: 'Torrent già presente nel database!',
                detail: `Questo torrent (${infoHash}) è già stato importato.`
            });
        }

        console.log(`🛠️ [MANUAL] Step 2: Fetching files (Local/Cache/Debrid)...`);

        // 2. Get Files (from local torrent parse OR from Cache OR from Debrid)
        let data = null;
        let providerUsed = "";

        if (localFiles && localFiles.length > 0) {
            // Use files parsed from uploaded .torrent file
            data = { files: localFiles, filename: torrentName };
            providerUsed = "Local .torrent";
            console.log(`📁[MANUAL] Using ${localFiles.length} files from uploaded torrent.`);
        } else {
            // Try Torrent Cache first if no Debrid keys provided
            if (!userRdKey && !userTbKey) {
                console.log(`🌐[MANUAL] No Debrid keys provided. Attempting Torrent Cache for magnet ${infoHash}...`);
                const cachedTorrent = await fetchTorrentFromCaches(infoHash);
                if (cachedTorrent) {
                    data = { files: cachedTorrent.files, filename: cachedTorrent.filename };
                    providerUsed = "Torrent Cache (P2P)";
                } else {
                    console.log(`⚠️[MANUAL] Cache fetch returned null.`);
                }
            }

            // If still no data, try Debrid providers
            if (!data && userRdKey) {
                try {
                    console.log(`🛠️ [MANUAL] Trying Real-Debrid fetch...`);
                    data = await fetchFilesFromRealDebrid(infoHash, userRdKey);
                    providerUsed = "Real-Debrid";
                    console.log(`✅ [MANUAL] RD success.`);
                } catch (e) { console.warn("RD Fetch failed:", e.message); }
            }

            if (!data && userTbKey) {
                try {
                    console.log(`🛠️ [MANUAL] Trying Torbox fetch...`);
                    data = await fetchFilesFromTorbox(infoHash, userTbKey);
                    providerUsed = "Torbox";
                    console.log(`✅ [MANUAL] Torbox success.`);
                } catch (e) { console.warn("TB Fetch failed:", e.message); }
            }
        }

        console.log(`🛠️ [MANUAL] Step 3: Checking data result...`);

        if (!data || !data.files || data.files.length === 0) {
            if (torrentFileBase64) {
                return res.status(500).json({ error: "Torrent file empty or invalid." });
            } else {
                return res.status(400).json({ error: "Could not get file list. If you don't have RD/Torbox, please upload a .torrent file or ensure the magnet is in public caches." });
            }
        }

        console.log(`✅[MANUAL] Files from ${providerUsed}. Found ${data.files.length} files.`);

        // 3. Prepare Torrent Entry
        const totalSize = data.files.reduce((acc, f) => acc + (f.bytes || 0), 0);
        let torrentTitle = data.filename || torrentName || `Imported - ${infoHash.substr(0, 8)} `;

        // ✅ Using raw title because dbHelper.sanitizeTorrentTitle is not defined
        // torrentTitle = dbHelper.sanitizeTorrentTitle(torrentTitle);

        let finalSeeders = 100;
        if (bodySeeders !== undefined && bodySeeders !== '') {
            finalSeeders = parseInt(bodySeeders);
        } else {
            // ✅ AUTO-SEEDER CHECK: If no manual seeders provided, try to scrape DHT
            // This happens automatically on backend now
            try {
                console.log(`🔍[MANUAL] Auto - scraping seeders for ${infoHash}...`);
                const scrapedSeeders = await getSeedersFromDHT(infoHash, 3000); // 3s timeout for auto check
                console.log(`✅[MANUAL] Auto - scrape result: ${scrapedSeeders} seeders`);
                // If DHT returns 0, we fallback to 10? Or keep 0? User can override if they want.
                // Let's use scrape result if > 0, otherwise default to 10 to avoid "dead" look
                finalSeeders = scrapedSeeders > 0 ? scrapedSeeders : 10;
            } catch (e) {
                console.warn(`⚠️[MANUAL] Auto - scrape failed: ${e.message}, defaulting to 10`);
                finalSeeders = 10;
            }
        }

        const isManualMapping = String(manualMapping).toLowerCase() === 'true';
        const providerLabel = isManualMapping ? 'Custom Manual' : 'Custom';

        const torrentEntry = {
            info_hash: infoHash,  // snake_case required for batchInsertTorrents
            provider: providerLabel,
            title: torrentTitle,
            size: totalSize,
            type: type,
            seeders: finalSeeders,
            imdb_id: imdbId,
            tmdb_id: tmdbId || null, // ✅ Save to DB
            upload_date: new Date(),
            cached_rd: !!userRdKey,
            cached_tb: !!userTbKey,
            last_cached_check: new Date()
        };

        // 4. Insert Main Torrent
        await dbHelper.batchInsertTorrents([torrentEntry]);

        // 5. Process Files & Episodes
        let processedFiles = [];
        let filesToInsert = [];
        let unmatchedFiles = [];
        let videoFiles = [];

        for (const file of data.files) {
            if (!packFilesHandler.isVideoFile(file.path) || file.bytes < 50 * 1024 * 1024) continue;

            const filename = file.path.split('/').pop();
            const videoMeta = {
                id: file.id,
                path: file.path,
                bytes: file.bytes || 0,
                filename,
                parsedSeason: null,
                parsedEpisode: null
            };
            videoFiles.push(videoMeta);

            // Try to parse S/E from FILENAME first
            let parsed = packFilesHandler.parseSeasonEpisode(filename);

            // If parsed season is missing or default (1), try to find real season in FOLDER path
            const folderSeason = parseSeasonFromPath(file.path);
            if (folderSeason) {
                // Rerun parse with confirmed folder season as default
                // or if raw parse failed, use folder season
                parsed = packFilesHandler.parseSeasonEpisode(filename, folderSeason);
            }

            // If series, require parsing. If movie, take valid video files.
            let season = null;
            let episode = null;

            if (type === 'series') {
                if (parsed) {
                    season = parsed.season;
                    episode = parsed.episode;
                } else {
                    // 🚀 EXTRA PARSE: Try matching " - 01" directly if season is known from folder
                    const simpleEpMatch = filename.match(/(?:\s-\s|Ep[\s.]*|E)(\d{1,3})(?![0-9])/i);
                    if (simpleEpMatch && folderSeason) {
                        season = folderSeason;
                        episode = parseInt(simpleEpMatch[1]);
                        console.log(`✅[MANUAL] Recovered S${season}E${episode} from folder ${folderSeason} + filename ${filename}`);
                    } else {
                        // Skip unparsable files for series
                        console.log(`⚠️[MANUAL] Skipping series file (no S/E found): ${file.path}`);
                        unmatchedFiles.push(videoMeta);
                        continue;
                    }
                }
            }

            videoMeta.parsedSeason = season;
            videoMeta.parsedEpisode = episode;

            // 📦 For movie packs: imdb_id will be null, matching happens later
            // For series: imdbId is the series ID, applied to all episodes
            const fileImdbId = (type === 'movie' && (data.files.length > 1 || forcePackMode === 'true')) ? null : imdbId;

            filesToInsert.push({
                info_hash: infoHash,
                file_index: file.id,
                title: filename,
                size: file.bytes,
                imdb_id: fileImdbId,
                imdb_season: season,
                imdb_episode: episode
            });

            processedFiles.push(filename);
        }

        // 6. Insert Files
        // ✅ ALIGNED WITH NORMAL FLOW: 
        // - Series/pack serie → files table (insertEpisodeFiles)
        // - Pack film (multi-movie) → pack_files table (insertPackFiles) 
        const isMultiMoviePack = (type === 'movie' && (data.files.length > 1 || forcePackMode === 'true'));

        if (filesToInsert.length > 0) {
            if (isMultiMoviePack) {
                // 📦 PACK FILM: Use pack_files table (same as normal enrichment flow)
                const packFilesData = filesToInsert.map(f => ({
                    pack_hash: infoHash.toLowerCase(),
                    imdb_id: null, // Will be matched later when user searches specific movie
                    file_index: f.file_index,
                    file_path: f.title,
                    file_size: f.size || 0
                }));
                await dbHelper.insertPackFiles(packFilesData);
                console.log(`📦 [MANUAL] Saved ${packFilesData.length} files to pack_files table`);
            } else {
                // 📺 SERIES or SINGLE MOVIE: Use files table
                await dbHelper.insertEpisodeFiles(filesToInsert);
                console.log(`📺 [MANUAL] Saved ${filesToInsert.length} files to files table`);
            }
        }

        return res.json({
            status: "success",
            message: `Imported ${filesToInsert.length} files for ${imdbId || 'pack'}`,
            torrent: torrentEntry,
            files: processedFiles,
            infoHash: infoHash,
            videoFiles,
            unmatchedFiles
        });

    } catch (err) {
        console.error("❌ Manual Import Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// DHT Scraper Helper
async function getSeedersFromDHT(infoHash, timeoutMs = 5000) {
    // Dynamic import for ESM module support in CJS
    const { default: DHT } = await import('bittorrent-dht');

    return new Promise((resolve) => {
        const dht = new DHT();
        const peers = new Set();

        dht.on('peer', (peer, hash) => {
            peers.add(`${peer.host}:${peer.port} `);
        });

        dht.listen(() => {
            const hashBuffer = Buffer.from(infoHash, 'hex');
            dht.lookup(hashBuffer);
        });

        setTimeout(() => {
            const count = peers.size;
            dht.destroy();
            resolve(count);
        }, timeoutMs);
    });
}

// POST /manual/scrape - Get seeders
router.post('/scrape', async (req, res) => {
    const { magnetLink, torrentFileBase64 } = req.body;
    let infoHash = null;

    try {
        if (torrentFileBase64) {
            const parsed = parseTorrentFile(torrentFileBase64);
            infoHash = parsed.infoHash;
        } else if (magnetLink) {
            const match = magnetLink.match(/xt=urn:btih:([a-zA-Z0-9]+)/);
            infoHash = match ? match[1] : null;
        }

        if (!infoHash) return res.status(400).json({ error: "Invalid magnet or torrent file" });

        const seeders = await getSeedersFromDHT(infoHash);
        res.json({ seeders });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
