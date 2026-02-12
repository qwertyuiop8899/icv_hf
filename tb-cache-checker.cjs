const fetch = require('node-fetch');

// =====================================================
// TORBOX CACHE CHECKER - v2 con Batch Support
// =====================================================

const TB_BASE_URL = 'https://api.torbox.app/v1/api';
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

// Video extensions for filtering
const VIDEO_EXTENSIONS = /\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v|ts|m2ts|mpg|mpeg)$/i;

/**
 * Sleep helper
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Estrai pack name dal path Torbox
 * Torbox ritorna: "PackName/FileName.mkv" nel campo files[].name
 * @param {Object} info - Torbox cache info object
 * @returns {string|null} Pack name or null if single file
 */
function extractPackName(info) {
    if (!info || !info.files || info.files.length === 0) return null;

    // Se c'è solo 1 file, non è un pack
    if (info.files.length === 1) return null;

    // Prendi il primo segmento del path (prima di /)
    const firstFile = info.files[0];
    if (firstFile.name && firstFile.name.includes('/')) {
        return firstFile.name.split('/')[0];
    }

    return null;
}

/**
 * Verifica se un nome torrent è un nome pack VALIDO
 * Ritorna FALSE se sembra essere un nome di singolo episodio/file
 */
function isValidPackName(name) {
    if (!name) return false;

    // 1. Troppo corto
    if (name.length < 10) return false;

    // 2. Nomi generici invalidi — MA solo se NON contengono anche contenuti validi
    // Es: "Invalid Magnet" → invalido (solo parole generiche)
    // Es: "[Torrent911.my] Friends.S05.MULTi.1080p..." → valido (ha tracker name ma anche release info)
    const INVALID_KEYWORDS = ['magnet', 'invalid', 'torrent', 'download', 'error', '404', 'unavailable'];
    const lowerName = name.toLowerCase();
    const hasInvalidKeyword = INVALID_KEYWORDS.some(n => lowerName.includes(n));
    if (hasInvalidKeyword) {
        // Check if name also has real release content (season/episode patterns, resolution, codecs, etc.)
        const hasReleaseContent = /(?:s\d{1,2}|season|stagion|\d{3,4}p|bluray|blu-ray|web-?dl|web-?rip|hdtv|dvdrip|bdrip|remux|x\.?26[45]|h\.?26[45]|hevc|avc|xvid|mkv|mp4|aac|ac3|dts|dd[p+]?|multi|dual|ita|eng|complete|completa)/i.test(name);
        if (!hasReleaseContent) {
            return false; // Solo parole generiche, nessun contenuto release → invalido
        }
        // Ha contenuto release → il keyword invalido è probabilmente un tracker name, continua validazione
    }

    // 3. È l'hash stesso
    if (/^[a-f0-9]{32,40}$/i.test(name)) return false;

    // 4. Ha estensione video → è un filename, non pack name
    if (VIDEO_EXTENSIONS.test(name)) return false;

    // ✅ 5. SEASON PACK → S05 senza episodio specifico = SEMPRE VALIDO!
    // Match: S05, S5, S01 ma NON S05E01
    if (/S\d{1,2}(?![Ee]\d)/i.test(name) && !/S\d{1,2}[Ee]\d{1,3}/i.test(name)) {
        return true;  // Season pack senza episodio = valido!
    }

    // ✅ 6. EPISODE RANGE → È un pack valido! (S05e01-04, S01E01-E08, ecc.)
    const EPISODE_RANGE_PATTERNS = [
        /S\d{1,2}[Ee]\d{1,3}[-–]\d{1,3}/i,           // S05e01-04, S01E01-08
        /S\d{1,2}[Ee]\d{1,3}[-–][Ee]\d{1,3}/i,       // S01E01-E08
        /S\d{1,2}[-–][Ee][Pp]?\d{1,3}[-–]\d{1,3}/i,  // S05-E5-8, S05-EP5-8
        /S\d{1,2}[Ee][Pp]\d{1,3}[-–]\d{1,3}/i,       // S5EP5-8, S05EP01-04
        /[Ee][Pp]?\d{1,3}[-–][Ee]?[Pp]?\d{1,3}/i,    // E01-E08, EP1-EP8, E01-08
        /\d{1,2}x\d{1,3}[-–]\d{1,3}/i,               // 1x01-04
    ];
    if (EPISODE_RANGE_PATTERNS.some(pattern => pattern.test(name))) {
        return true;  // Range di episodi = pack valido!
    }

    // 7. Contiene riferimento a singolo episodio SENZA range → è nome file, non pack
    // Solo se NON contiene un range (già controllato sopra)
    const hasSingleEpisode = /S\d{1,2}[Ee]\d{1,3}/i.test(name);
    const hasRange = /[-–]\d{1,3}|[-–][Ee]\d{1,3}/i.test(name);
    if (hasSingleEpisode && !hasRange) {
        return false;  // Singolo episodio senza range = filename
    }

    // ✅ Sembra un nome pack valido
    return true;
}

/**
 * Check cache status for ALL hashes in ONE batch call
 * This is the main function for Torbox - much more efficient than RD
 * 
 * @param {string[]} hashes - Array of info hashes
 * @param {string} token - Torbox API token
 * @returns {Promise<Object>} Map of hash -> { cached, torrent_title, pack_name, files[], ... }
 */
async function checkCacheBatch(hashes, token) {
    if (!hashes || hashes.length === 0) return {};

    // Torbox allows comma separated hashes - process in chunks of 50
    const CHUNK_SIZE = 50;
    const results = {};

    for (let i = 0; i < hashes.length; i += CHUNK_SIZE) {
        const chunk = hashes.slice(i, i + CHUNK_SIZE);
        const hashStr = chunk.join(',');

        try {
            const url = `${TB_BASE_URL}/torrents/checkcached?hash=${hashStr}&format=object&list_files=true`;

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                timeout: 30000
            });

            if (!response.ok) {
                console.error(`❌ [TB Batch] Error ${response.status}: ${response.statusText}`);
                // Mark all as uncached for this chunk
                for (const hash of chunk) {
                    results[hash.toLowerCase()] = { cached: false };
                }
                continue;
            }

            const data = await response.json();

            if (data.success && data.data) {
                // Process cached hashes
                for (const [hash, info] of Object.entries(data.data)) {
                    const hashLower = hash.toLowerCase();
                    const isCached = !!info && Object.keys(info).length > 0;

                    if (isCached) {
                        // Extract pack name from file paths
                        const packName = extractPackName(info);
                        const isPack = info.files && info.files.length > 1;

                        // Find largest video file for main file info
                        let mainFile = null;
                        let videoFiles = [];

                        if (info.files && info.files.length > 0) {
                            videoFiles = info.files
                                .filter(f => VIDEO_EXTENSIONS.test(f.name || f.short_name))
                                .map((f, idx) => ({
                                    index: idx,
                                    path: f.name,
                                    filename: f.short_name || f.name.split('/').pop(),
                                    size: f.size
                                }));

                            // Largest video file
                            mainFile = videoFiles.sort((a, b) => b.size - a.size)[0];
                        }

                        results[hashLower] = {
                            cached: true,
                            torrent_title: info.name,
                            size: info.size,
                            pack_name: packName,
                            is_pack: isPack,
                            file_title: mainFile ? mainFile.filename : info.name,
                            file_size: mainFile ? mainFile.size : info.size,
                            files: videoFiles, // All video files for pack processing
                            fromBatch: true
                        };
                    } else {
                        results[hashLower] = { cached: false };
                    }
                }

                // Mark missing hashes as uncached
                for (const hash of chunk) {
                    const hashLower = hash.toLowerCase();
                    if (!results[hashLower]) {
                        results[hashLower] = { cached: false };
                    }
                }
            }

            // Small delay between chunks
            if (i + CHUNK_SIZE < hashes.length) {
                await sleep(300);
            }

        } catch (error) {
            console.error(`❌ [TB Batch] Request failed:`, error.message);
            // Mark all as uncached for this chunk
            for (const hash of chunk) {
                results[hash.toLowerCase()] = { cached: false };
            }
        }
    }

    if (DEBUG_MODE) {
        const cachedCount = Object.values(results).filter(r => r.cached).length;
        const packCount = Object.values(results).filter(r => r.is_pack).length;
        console.log(`✅ [TB Batch] Checked ${hashes.length} hashes: ${cachedCount} cached, ${packCount} packs`);
    }

    return results;
}

/**
 * Check cache status for multiple hashes synchronously (blocks until complete)
 * Used for the top N torrents that the user will see immediately
 * NOW uses batch API for efficiency
 */
async function checkCacheSync(items, token, limit = 5) {
    const toCheck = items.slice(0, limit);
    const hashes = toCheck.map(i => i.hash);

    if (DEBUG_MODE) console.log(`🔄 [TB Cache] Checking ${hashes.length} hashes (batch mode)...`);

    // Use batch API
    const batchResults = await checkCacheBatch(hashes, token);

    // Convert to expected format
    const results = {};
    for (const item of toCheck) {
        const hash = item.hash.toLowerCase();
        const apiRes = batchResults[hash];

        results[hash] = {
            cached: apiRes ? apiRes.cached : false,
            file_title: apiRes?.file_title || null,
            file_size: apiRes?.file_size || null,
            torrent_title: apiRes?.torrent_title || null,
            pack_name: apiRes?.pack_name || null,
            is_pack: apiRes?.is_pack || false,
            size: apiRes?.size || null,
            files: apiRes?.files || [],
            fromLiveCheck: true
        };
    }

    if (DEBUG_MODE) console.log(`✅ [TB Cache] Sync check complete. ${Object.values(results).filter(r => r.cached).length}/${hashes.length} cached`);
    return results;
}

/**
 * Check ALL hashes in batch - used for background enrichment
 * Returns full pack info including files list
 */
async function checkAllHashesBatch(hashes, token) {
    if (!hashes || hashes.length === 0) return {};

    if (DEBUG_MODE) console.log(`🔄 [TB Batch] Checking ALL ${hashes.length} hashes...`);

    return await checkCacheBatch(hashes, token);
}

/**
 * Enrich cache in background (non-blocking)
 * NOTE: With batch API, this is now mostly for DB saving
 */
async function enrichCacheBackground(items, token, dbHelper) {
    if (!items || items.length === 0) return;

    // ⚠️ TRUE BACKGROUND: delayed start
    setTimeout(() => {
        (async () => {
            if (DEBUG_MODE) console.log(`🔄 [TB Cache Background] Starting enrichment for ${items.length} hashes...`);

            try {
                const hashes = items.map(i => i.hash);

                // Check if already recently checked in DB
                let alreadyChecked = {};
                if (dbHelper && typeof dbHelper.getTbCachedAvailability === 'function') {
                    alreadyChecked = await dbHelper.getTbCachedAvailability(hashes);
                }

                // Filter out those recently checked
                const hashesToCheck = hashes.filter(h => !alreadyChecked[h.toLowerCase()]);

                if (hashesToCheck.length === 0) {
                    if (DEBUG_MODE) console.log(`⏭️  [TB Cache Background] All items already checked recently.`);
                    return;
                }

                // Use batch API
                const batchResults = await checkCacheBatch(hashesToCheck, token);

                // Save to DB
                if (dbHelper && typeof dbHelper.updateTbCacheStatus === 'function') {
                    const cacheUpdates = Object.entries(batchResults).map(([hash, data]) => ({
                        hash,
                        cached: data.cached,
                        torrent_title: data.pack_name || data.torrent_title || null,
                        size: data.size || null,
                        file_title: data.file_title || null,
                        file_size: data.file_size || null
                    }));

                    await dbHelper.updateTbCacheStatus(cacheUpdates);
                    if (DEBUG_MODE) console.log(`✅ [TB Cache Background] Updated ${cacheUpdates.length} items`);
                }

            } catch (error) {
                console.error(`❌ [TB Cache Background] Error:`, error.message);
            }
        })();
    }, 5000);
}

module.exports = {
    checkCacheSync,
    checkCacheBatch,
    checkAllHashesBatch,
    enrichCacheBackground,
    isValidPackName,
    extractPackName
};
