/**
 * PACK FILES HANDLER
 * Gestisce l'estrazione dei file da pack (stagioni serie, trilogie film)
 * usando le API Debrid per ottenere la lista file e salvarla nel DB
 * 
 * Flusso:
 * 1. Cerca file nel DB (tabella files per serie, pack_files per film)
 * 2. Se non trovato, chiama API Debrid per ottenere file list
 * 3. Parsa nomi file per estrarre stagione/episodio
 * 4. Salva nel DB per usi futuri
 * 5. Ritorna file specifico richiesto con dimensione singola
 */

const axios = require('axios');
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

// Video file extensions
const VIDEO_EXTENSIONS = /\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v|ts|m2ts|mpg|mpeg)$/i;

// Season/Episode parsing patterns (inspired by MediaFusion)
const SEASON_EPISODE_PATTERNS = [
    // S01 - E01, S01-E01 (Explicit E with dash)
    { pattern: /[sS](\d{1,2})\s*[-–—]\s*[eE][pP]?(\d{1,3})(?![0-9])/, extract: (m) => ({ season: parseInt(m[1]), episode: parseInt(m[2]) }) },
    // S01 - 01, S1 - 1, S01-1 (Common Italian format)
    { pattern: /[sS](\d{1,2})\s*[-–—]\s*(\d{1,3})(?![0-9])/, extract: (m) => ({ season: parseInt(m[1]), episode: parseInt(m[2]) }) },
    // S01 - 09, S1 - 9 (User Request) - Fallback for variants without word boundary
    { pattern: /[sS](\d{1,2})\s*[-–—]\s*(\d{1,3})/, extract: (m) => ({ season: parseInt(m[1]), episode: parseInt(m[2]) }) },
    // S01E04, s01e04, S1E04
    { pattern: /[sS](\d{1,2})[eE](\d{1,3})/, extract: (m) => ({ season: parseInt(m[1]), episode: parseInt(m[2]) }) },
    // S01EP04 (Common in Italian releases)
    { pattern: /[sS](\d{1,2})[eE][pP](\d{1,3})/, extract: (m) => ({ season: parseInt(m[1]), episode: parseInt(m[2]) }) },
    // 1x04, 01x04
    { pattern: /(?<!\w)(\d{1,2})[xX](\d{1,3})(?!\w)/, extract: (m) => ({ season: parseInt(m[1]), episode: parseInt(m[2]) }) },
    // Season 1 Episode 04
    { pattern: /[sS]eason\s*(\d{1,2}).*?[eE]pisode\s*(\d{1,3})/i, extract: (m) => ({ season: parseInt(m[1]), episode: parseInt(m[2]) }) },
    // Stagione 1 Episodio 04
    { pattern: /[sS]tagione\s*(\d{1,2}).*?[eE]pisodio\s*(\d{1,3})/i, extract: (m) => ({ season: parseInt(m[1]), episode: parseInt(m[2]) }) },
    // E04 (episode only, season from context)
    { pattern: /[^a-z]E(\d{1,3})[^0-9]/i, extract: (m, defaultSeason) => ({ season: defaultSeason, episode: parseInt(m[1]) }) },
    // - 04 - (episode in filename with dashes)
    { pattern: /[-–—]\s*(\d{1,3})\s*[-–—]/, extract: (m, defaultSeason) => ({ season: defaultSeason, episode: parseInt(m[1]) }) },
    // Ep04, Ep.04, Ep 04
    { pattern: /[eE]p\.?\s*(\d{1,3})(?!\d)/, extract: (m, defaultSeason) => ({ season: defaultSeason, episode: parseInt(m[1]) }) },
];

/**
 * Parsa stagione e episodio da un nome file
 * @param {string} filename - Nome del file (es: "Stranger.Things.S05E05.mkv")
 * @param {number} defaultSeason - Stagione di default se non trovata nel filename
 * @returns {{season: number, episode: number}|null}
 */
function parseSeasonEpisode(filename, defaultSeason = 1) {
    for (const { pattern, extract } of SEASON_EPISODE_PATTERNS) {
        const match = filename.match(pattern);
        if (match) {
            return extract(match, defaultSeason);
        }
    }
    return null;
}

/**
 * Estrae la stagione dal titolo del torrent pack
 * @param {string} torrentTitle - Titolo del torrent
 * @returns {number|null}
 */
function extractSeasonFromPackTitle(torrentTitle) {
    // S05, Season 5, Stagione 5
    const patterns = [
        /[sS](\d{1,2})(?![eExX\d])/,
        /[sS]eason\s*(\d{1,2})/i,
        /[sS]tagione\s*(\d{1,2})/i,
    ];

    for (const pattern of patterns) {
        const match = torrentTitle.match(pattern);
        if (match) {
            return parseInt(match[1]);
        }
    }
    return null;
}

/**
 * Verifica se un file è un video
 * @param {string} filename 
 * @returns {boolean}
 */
function isVideoFile(filename) {
    return VIDEO_EXTENSIONS.test(filename);
}

/**
 * Ottiene la lista file da Real-Debrid con retry su 429
 * @param {string} infoHash - Hash del torrent
 * @param {string} rdKey - API key Real-Debrid
 * @param {number} retryCount - Current retry attempt (default 0)
 * @returns {Promise<{torrentId: string, files: Array}|null>}
 */
async function fetchFilesFromRealDebrid(infoHash, rdKey, retryCount = 0) {
    const MAX_RETRIES = 3;
    const baseUrl = 'https://api.real-debrid.com/rest/1.0';
    const headers = { 'Authorization': `Bearer ${rdKey}` };

    try {
        // 1. Aggiungi magnet link
        if (DEBUG_MODE) console.log(`📦 [PACK-HANDLER] Adding magnet to RD for file list: ${infoHash.substring(0, 8)}...`);
        const magnetLink = `magnet:?xt=urn:btih:${infoHash}`;

        const addResponse = await axios.post(
            `${baseUrl}/torrents/addMagnet`,
            `magnet=${encodeURIComponent(magnetLink)}`,
            { headers, timeout: 30000 }
        );

        if (!addResponse.data || !addResponse.data.id) {
            throw new Error('Failed to add magnet to RD');
        }

        const torrentId = addResponse.data.id;

        // 2. Ottieni info torrent con file list
        const infoResponse = await axios.get(
            `${baseUrl}/torrents/info/${torrentId}`,
            { headers, timeout: 30000 }
        );

        if (!infoResponse.data || !infoResponse.data.files) {
            // Cancella torrent
            await axios.delete(`${baseUrl}/torrents/delete/${torrentId}`, { headers }).catch(() => { });
            throw new Error('No files in torrent info');
        }

        // ✅ FIX: Use ORIGINAL RD file ID directly
        // RD API returns 1-based IDs, we keep them as-is to match what we search for later
        // The rd-stream handler also receives the same ID from the URL
        const rawFiles = infoResponse.data.files;

        const files = rawFiles.map((f) => ({
            id: f.id, // Keep original RD ID (1-based)
            path: f.path,
            bytes: f.bytes,
            selected: f.selected
        }));

        if (DEBUG_MODE) console.log(`📊 [PACK-HANDLER] RD file order: ${files.slice(0, 5).map(f => `id=${f.id}:${f.path.split('/').pop().substring(0, 30)}`).join(', ')}...`);

        // 3. Cancella torrent (era solo per leggere file list)
        if (DEBUG_MODE) console.log(`🗑️ [PACK-HANDLER] Deleting temporary torrent ${torrentId}`);
        await axios.delete(`${baseUrl}/torrents/delete/${torrentId}`, { headers }).catch(err => {
            console.warn(`⚠️ [PACK-HANDLER] Failed to delete torrent: ${err.message}`);
        });

        if (DEBUG_MODE) console.log(`✅ [PACK-HANDLER] Got ${files.length} files from RD`);

        // ✅ SMART FILENAME SELECTION (Simplified via User Request)
        // Always prefer original_filename. Only fallback to filename if original is missing.
        // If original is missing (empty), filename is likely "Magnet" (waiting selection), 
        // which will be filtered by api/index.js validation anyway.
        const finalFilename = infoResponse.data.original_filename || infoResponse.data.filename;

        if (DEBUG_MODE) {
            if (finalFilename !== infoResponse.data.filename) {
                console.log(`✨ [PACK-HANDLER] Using original_filename: "${finalFilename}" (was "${infoResponse.data.filename}")`);
            }
        }

        return {
            torrentId,
            files,
            filename: finalFilename
        };

    } catch (error) {
        // ✅ RETRY on 429 Rate Limit with exponential backoff
        const is429 = error.response?.status === 429 || error.message?.includes('429');
        if (is429 && retryCount < MAX_RETRIES) {
            const waitTime = Math.pow(2, retryCount + 1) * 5000; // 10s, 20s, 40s
            console.log(`⏳ [PACK-HANDLER] Rate limited (429), waiting ${waitTime/1000}s before retry ${retryCount + 1}/${MAX_RETRIES}...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            return fetchFilesFromRealDebrid(infoHash, rdKey, retryCount + 1);
        }
        
        if (DEBUG_MODE) console.error(`❌ [PACK-HANDLER] RD API error: ${error.message}`);
        throw error;
    }
}

/**
 * Ottiene la lista file da Torbox
 * OPTIMIZED: Uses checkcached with list_files=true (1 API call)
 * ✅ NO LONGER falls back to createtorrent - if not in cache, skip (user can't play anyway)
 * @param {string} infoHash - Hash del torrent
 * @param {string} torboxKey - API key Torbox
 * @returns {Promise<{torrentId: string, files: Array}|null>}
 */
async function fetchFilesFromTorbox(infoHash, torboxKey) {
    const baseUrl = 'https://api.torbox.app/v1/api';
    const headers = { 'Authorization': `Bearer ${torboxKey}` };

    try {
        // ✅ ONLY USE checkcached with list_files=true (FAST PATH - 1 API call)
        // If not in cache, return null - no point processing packs user can't play
        if (DEBUG_MODE) console.log(`📦 [PACK-HANDLER] Checking Torbox cache for file list: ${infoHash.substring(0, 8)}...`);

        const cacheResponse = await axios.get(
            `${baseUrl}/torrents/checkcached`,
            {
                headers,
                params: {
                    hash: infoHash.toUpperCase(),
                    format: 'object',
                    list_files: true
                },
                timeout: 10000
            }
        );

        // Check if we got files from cache
        const cacheData = cacheResponse.data?.data;
        if (cacheData && typeof cacheData === 'object') {
            const hashKey = Object.keys(cacheData).find(k => k.toLowerCase() === infoHash.toLowerCase());
            if (hashKey && cacheData[hashKey]?.files && cacheData[hashKey].files.length > 0) {
                const rawFiles = cacheData[hashKey].files;

                // ✅ FIX: Torbox cache doesn't provide original index, so we sort alphabetically
                // This is a best-effort approach for file ordering
                const sortedFiles = [...rawFiles].sort((a, b) => (a.name || a.path || '').localeCompare(b.name || b.path || ''));

                const files = sortedFiles.map((f, idx) => ({
                    id: idx,
                    path: f.name || f.path || `file_${idx}`,
                    bytes: f.size || 0,
                    selected: 1
                }));
                if (DEBUG_MODE) console.log(`✅ [PACK-HANDLER] Got ${files.length} files from Torbox CACHE`);
                return { torrentId: 'cached', files };
            }
        }
        
        // ✅ NOT IN CACHE = Skip (no createtorrent to avoid rate limits)
        // User can't play this pack anyway if it's not cached
        if (DEBUG_MODE) console.log(`⏭️ [PACK-HANDLER] TB: Not in cache, skipping (no createtorrent to avoid rate limit)`);
        return null;

    } catch (error) {
        // ✅ Handle 429 gracefully - just skip, don't throw
        const is429 = error.response?.status === 429 || error.message?.includes('429');
        if (is429) {
            console.log(`⏳ [PACK-HANDLER] TB Rate limited (429), skipping pack ${infoHash.substring(0, 8)}...`);
            return null;
        }
        
        if (DEBUG_MODE) console.error(`❌ [PACK-HANDLER] Torbox API error: ${error.message}`);
        return null; // Return null instead of throwing - graceful degradation
    }
}

/**
 * Processa i file di un pack serie e li salva nel DB
 * @param {Array} files - Lista file dal Debrid
 * @param {string} infoHash - Hash del torrent
 * @param {string} seriesImdbId - IMDb ID della serie
 * @param {number} targetSeason - Stagione target
 * @param {Object} dbHelper - Modulo db-helper
 * @param {string} torrentTitle - Titolo del torrent (per inserire nella tabella torrents)
 * @param {number} totalPackSize - Dimensione totale del pack
 * @returns {Promise<Array>} File processati
 */
async function processSeriesPackFiles(files, infoHash, seriesImdbId, targetSeason, dbHelper, torrentTitle = null, totalPackSize = 0) {
    const videoFiles = files.filter(f => isVideoFile(f.path));
    const processedFiles = [];

    if (DEBUG_MODE) console.log(`🔍 [PACK-HANDLER] Processing ${videoFiles.length} video files from pack`);

    // ✅ FIX: Use the file.id directly - it's already the correct torrent index
    // The fetch functions (fetchFilesFromRealDebrid, fetchFilesFromTorbox) now return
    // the original torrent file index in file.id
    if (DEBUG_MODE) console.log(`📊 [PACK-HANDLER] Using ORIGINAL file indices from API`);

    for (const file of videoFiles) {
        // 🗑️ FILTER: Ignore small files (samples, extras) < 25MB
        if (file.bytes < 25 * 1024 * 1024) continue;

        const filename = file.path.split('/').pop();
        const parsed = parseSeasonEpisode(filename, targetSeason);

        if (parsed && parsed.season === targetSeason) {
            // ✅ Use the original file.id directly - this IS the torrent index
            const torrentIndex = file.id;

            processedFiles.push({
                info_hash: infoHash,
                file_index: torrentIndex,
                title: filename,
                size: file.bytes,
                imdb_id: seriesImdbId,
                imdb_season: parsed.season,
                imdb_episode: parsed.episode
            });

            if (DEBUG_MODE) console.log(`   📄 ${filename} → S${parsed.season}E${parsed.episode} (idx=${torrentIndex}, ${(file.bytes / 1024 / 1024 / 1024).toFixed(2)} GB)`);
        }
    }

    // 🔧 FIX: Insert parent torrent FIRST to satisfy FK constraint
    if (processedFiles.length > 0 && dbHelper && typeof dbHelper.insertTorrent === 'function' && torrentTitle) {
        try {
            await dbHelper.insertTorrent({
                infoHash: infoHash.toLowerCase(),
                title: torrentTitle,
                provider: 'pack-handler',
                size: totalPackSize || null,
                type: 'series',
                seeders: 0,
                imdbId: seriesImdbId
            });
        } catch (error) {
            // Ignore if already exists - that's fine, FK should work
            if (!error.message.includes('already exists')) {
                console.warn(`⚠️ [PACK-HANDLER] Parent torrent insert warning: ${error.message}`);
            }
        }
    }

    // Salva i file nel DB
    if (processedFiles.length > 0 && dbHelper && typeof dbHelper.insertEpisodeFiles === 'function') {
        try {
            const inserted = await dbHelper.insertEpisodeFiles(processedFiles);
            if (DEBUG_MODE) console.log(`💾 [PACK-HANDLER] Saved ${inserted} episode files to DB`);
        } catch (error) {
            console.error(`❌ [PACK-HANDLER] Failed to save to DB: ${error.message}`);
        }
    }

    return processedFiles;
}

/**
 * Trova l'episodio richiesto nella lista file
 * @param {Array} files - Lista file processati
 * @param {number} targetEpisode - Episodio richiesto
 * @returns {Object|null}
 */
function findEpisodeFile(files, targetEpisode) {
    return files.find(f => f.imdb_episode === targetEpisode) || null;
}

/**
 * Risolve un file da un pack serie
 * @param {string} infoHash - Hash del torrent pack
 * @param {Object} config - Config con rd_key o torbox_key
 * @param {string} seriesImdbId - IMDb ID della serie
 * @param {number} season - Stagione richiesta
 * @param {number} episode - Episodio richiesto
 * @param {Object} dbHelper - Modulo db-helper
 * @returns {Promise<{fileIndex: number, fileName: string, fileSize: number, source: string}|null>}
 */
async function resolveSeriesPackFile(infoHash, config, seriesImdbId, season, episode, dbHelper) {
    if (DEBUG_MODE) console.log(`🎬 [PACK-HANDLER] Resolving S${season}E${episode} from pack ${infoHash.substring(0, 8)}...`);

    // Variable to track total pack size
    let totalPackSize = 0;

    // 1️⃣ CHECK DB CACHE for Index (Fastest, FREE)
    // Check if we already have the file structure for this pack in local DB
    if (dbHelper && typeof dbHelper.getSeriesPackFiles === 'function') {
        try {
            const cachedFiles = await dbHelper.getSeriesPackFiles(infoHash);
            if (cachedFiles && cachedFiles.length > 0) {
                if (DEBUG_MODE) console.log(`💾 [PACK-HANDLER] Found ${cachedFiles.length} files in DB CACHE for ${infoHash.substring(0, 8)}`);

                // Calculate total pack size from cached files (approximate)
                totalPackSize = cachedFiles.reduce((acc, f) => acc + f.bytes, 0);

                // Process cached files to find our target
                // We use processSeriesPackFiles even though they are already in DB, 
                // mainly to parse season/ep and find exact match consistently
                const processed = await processSeriesPackFiles(cachedFiles, infoHash, seriesImdbId, season, dbHelper, null, totalPackSize);
                const match = findEpisodeFile(processed, episode);

                if (match) {
                    if (DEBUG_MODE) console.log(`✅ [PACK-HANDLER] Cache Hit! Found matching file: ${match.title}`);
                    return {
                        fileIndex: match.file_index,
                        fileName: match.title,
                        fileSize: match.size,
                        source: "DB_CACHE",
                        totalPackSize
                    };
                } else {
                    if (DEBUG_MODE) console.log(`⚠️ [PACK-HANDLER] Cache Miss: Pack is indexed but S${season}E${episode} not found. Skipping external lookup.`);
                    // If we have index but no file, assume pack doesn't contain it. 
                    // Do NOT fall back to RD to avoid rate limits on incomplete packs.
                    return null;
                }
            }
        } catch (err) {
            console.warn(`⚠️ [PACK-HANDLER] DB Cache check failed: ${err.message}`);
        }
    }

    // 2️⃣ EXTERNAL PROVIDER (Slow, Expensive)
    let fetchedData = null;

    try {
        if (config.rd_key) {
            fetchedData = await fetchFilesFromRealDebrid(infoHash, config.rd_key);
        } else if (config.torbox_key) {
            fetchedData = await fetchFilesFromTorbox(infoHash, config.torbox_key);
        }
    } catch (e) {
        if (DEBUG_MODE) console.warn(`⚠️ [PACK-HANDLER] Failed to fetch files from provider: ${e.message}`);
        // ✅ FIX: If rate limited (429), rethrow so caller keeps the pack instead of excluding
        if (e.message?.includes('429') || e.response?.status === 429) {
            throw new Error(`RATE_LIMITED: ${e.message}`);
        }
        return null;
    }

    if (!fetchedData || !fetchedData.files) {
        return null;
    }

    // Calculate total pack size from fresh fetch
    totalPackSize = fetchedData.files.reduce((acc, f) => acc + f.bytes, 0);

    // Generate torrent title from first video file or hash
    const allVideoFiles = fetchedData.files.filter(f => isVideoFile(f.path));
    const firstVideoFile = allVideoFiles[0];

    // ✅ FIX: Clean path and prefer RD filename
    let generatedTitle = `Pack-${infoHash.substring(0, 16)}`;

    if (fetchedData.filename) {
        generatedTitle = fetchedData.filename;
    } else if (firstVideoFile) {
        // Remove leading slashes and take the first segment
        const cleanPath = firstVideoFile.path.replace(/^[\\/]+/, '');
        generatedTitle = cleanPath.split('/')[0] || firstVideoFile.path;
    }

    const processedFiles = await processSeriesPackFiles(
        fetchedData.files,
        infoHash,
        seriesImdbId,
        season,
        dbHelper,
        generatedTitle,  // torrentTitle
        totalPackSize    // totalPackSize
    );

    // 4. Cerca l'episodio richiesto
    const targetFile = findEpisodeFile(processedFiles, episode);

    if (!targetFile) {
        if (DEBUG_MODE) console.log(`❌ [PACK-HANDLER] Episode ${episode} NOT FOUND in pack (pack has ${processedFiles.length} episodes)`);
        return null;  // ❌ Episodio non esiste nel pack - NESSUN FALLBACK
    }

    if (DEBUG_MODE) console.log(`✅ [PACK-HANDLER] Found E${episode}: ${targetFile.title} (${(targetFile.size / 1024 / 1024 / 1024).toFixed(2)} GB), pack total: ${(totalPackSize / 1024 / 1024 / 1024).toFixed(2)} GB`);

    return {
        fileIndex: targetFile.file_index,
        fileName: targetFile.title,
        fileSize: targetFile.size,
        totalPackSize: totalPackSize,
        source: 'debrid_api'
    };
}

/**
 * Verifica se un torrent è un pack stagione (e non singolo episodio)
 * @param {string} torrentTitle - Titolo del torrent
 * @returns {boolean}
 */
function isSeasonPack(torrentTitle) {
    // Cerca pattern che indicano un pack completo
    const packPatterns = [
        /[sS]\d{1,2}(?![eExX])/,                    // S05 senza E
        /[sS]eason\s*\d+(?!\s*[eE]pisode)/i,        // Season 5 senza Episode
        /[sS]tagione\s*\d+(?!\s*[eE]pisodio)/i,     // Stagione 5 senza Episodio
        /\b(?:part|parte|vol|volume)\s*\d+/i,       // Part 1, Parte 2, Vol 1
        /\b(?:complete|completa|full)\b/i,          // Complete, Full
        /\[?(?:S\d+)?\s*(?:E\d+-E?\d+|\d+-\d+)\]?/, // Range episodi: E01-E08, 01-08
    ];

    // Verifica che NON sia un singolo episodio
    // Fix: Added (?!\d) to prevent backtracking matching partial numbers (e.g. S01E0 in S01E01-10)
    const singleEpisodePattern = /[sS]\d{1,2}[eExX]\d{1,3}(?!\d)(?!\s*[-–—]\s*[eExX]?\d)/;

    if (singleEpisodePattern.test(torrentTitle)) {
        return false; // È un singolo episodio
    }

    return packPatterns.some(pattern => pattern.test(torrentTitle));
}

/**
 * Calculates similarity between two strings (0-1)
 * @param {string} str1 
 * @param {string} str2 
 */
function calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, '');
    const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (s1 === s2) return 1;
    if (s1.includes(s2) || s2.includes(s1)) return 0.8;
    return 0;
}

/**
 * Risolve un file da un pack film (Collection/Trilogy)
 * @param {string} infoHash 
 * @param {Object} config 
 * @param {string} movieImdbId 
 * @param {string|Array<string>} targetTitles 
 * @param {number} year 
 * @param {Object} dbHelper 
 * @param {boolean} forceRefresh - If true, skip DB cache and fetch fresh from debrid (used when cache is corrupted)
 */
async function resolveMoviePackFile(infoHash, config, movieImdbId, targetTitles, year, dbHelper, forceRefresh = false) {
    console.log(`🎬 [PACK-HANDLER] Resolving Movie "${JSON.stringify(targetTitles)}" (${year}) from pack ${infoHash.substring(0, 8)}${forceRefresh ? ' (FORCE REFRESH)' : ''}...`);

    let totalPackSize = 0;
    let videoFiles = [];
    let dbCacheCorrupted = forceRefresh; // If forceRefresh, treat cache as corrupted
    const PACK_TTL_DAYS = 10; // TTL for pack files cache (same as torrents: 10 days base)

    // 1️⃣ CHECK DB CACHE Logic with TTL - SKIP if forceRefresh
    // 🚀 SPEEDUP: First try getPackFiles (with TTL check), then fallback to getSeriesPackFiles
    if (!forceRefresh && dbHelper) {
        try {
            // 🚀 SPEEDUP: Try new getPackFiles with TTL first
            if (typeof dbHelper.getPackFiles === 'function') {
                const { files: cachedFiles, expired } = await dbHelper.getPackFiles(infoHash.toLowerCase(), PACK_TTL_DAYS);

                if (cachedFiles && cachedFiles.length > 0 && !expired) {
                    console.log(`💾 [PACK-HANDLER] 🚀 SPEEDUP: Using ${cachedFiles.length} cached pack files (TTL OK)`);

                    // Convert to expected format
                    const cachedVideoFiles = cachedFiles
                        .filter(f => isVideoFile(f.file_path) && f.file_size > 25 * 1024 * 1024)
                        .map(f => ({
                            id: f.file_index,
                            path: f.file_path,
                            bytes: parseInt(f.file_size) || 0
                        }));

                    // ✅ FIX: Accept 1+ files (single movie in pack is valid)
                    if (cachedVideoFiles.length >= 1) {
                        videoFiles = cachedVideoFiles;
                        totalPackSize = cachedFiles.reduce((acc, f) => acc + (parseInt(f.file_size) || 0), 0);
                        console.log(`🚀 [PACK-HANDLER] SPEEDUP: Skipped RD API call! Using ${videoFiles.length} files from DB`);
                    } else {
                        console.log(`⚠️ [PACK-HANDLER] DB cache empty (0 video files). Fetching from debrid...`);
                        dbCacheCorrupted = true;
                    }
                } else if (expired) {
                    console.log(`⏰ [PACK-HANDLER] Pack files TTL expired (>${PACK_TTL_DAYS} days). Re-fetching...`);
                    dbCacheCorrupted = true;
                }
            }

            // 🚫 REMOVED: Fallback to getSeriesPackFiles is BAD for movie packs!
            // The `files` table doesn't have correct RD file IDs for movie packs.
            // Movie packs MUST use pack_files table which stores correct RD file.id values.
            // Series packs use the `files` table (handled by resolveSeriesPackFile, not here).
        } catch (err) {
            console.warn(`⚠️ [PACK-HANDLER] DB Cache check failed: ${err.message}`);
        }
    }

    // 2️⃣ EXTERNAL PROVIDER (If no cache, empty cache, or corrupted cache)
    if (videoFiles.length === 0) {
        let fetchedData = null;
        try {
            if (config.rd_key) {
                fetchedData = await fetchFilesFromRealDebrid(infoHash, config.rd_key);
            } else if (config.torbox_key) {
                fetchedData = await fetchFilesFromTorbox(infoHash, config.torbox_key);
            }
        } catch (e) {
            console.warn(`⚠️ [PACK-HANDLER] Failed to fetch files: ${e.message}`);
            // ✅ FIX: If rate limited (429), rethrow so caller keeps the pack instead of excluding
            if (e.message?.includes('429') || e.response?.status === 429) {
                throw new Error(`RATE_LIMITED: ${e.message}`);
            }
            return null;
        }

        if (fetchedData && fetchedData.files) {
            videoFiles = fetchedData.files.filter(f => isVideoFile(f.path) && f.bytes > 25 * 1024 * 1024);
            totalPackSize = fetchedData.files.reduce((acc, f) => acc + f.bytes, 0);

            // 🔧 FIX: Save ALL pack files to DB for future lookups (fixes corrupted cache)
            if (dbHelper && typeof dbHelper.insertPackFiles === 'function' && videoFiles.length > 1) {
                try {
                    console.log(`📦 [PACK-HANDLER] Saving ${videoFiles.length} pack files to DB...`);
                    const packFilesData = videoFiles.map(f => ({
                        pack_hash: infoHash.toLowerCase(),
                        imdb_id: null, // Will be filled when matched
                        file_index: f.id,
                        file_path: f.path,
                        file_size: f.bytes || 0
                    }));
                    await dbHelper.insertPackFiles(packFilesData);
                    console.log(`✅ [PACK-HANDLER] Saved ${videoFiles.length} pack files to DB`);
                } catch (dbErr) {
                    console.warn(`⚠️ [PACK-HANDLER] DB save error (non-critical): ${dbErr.message}`);
                }
            }
        }
    }

    if (videoFiles.length === 0) return null;

    // ✅ FIX: Use the file.id directly - it's already the correct torrent index
    // No need to reorder - the fetch functions return correct indices
    console.log(`📊 [PACK-HANDLER] Using ORIGINAL file indices for movie pack`);

    // If <= 1 video file, it's not really a pack to filter, but we return it as "verified"
    if (videoFiles.length === 1) {
        console.log(`ℹ️ [PACK-HANDLER] Single video file found. Assuming it's the movie.`);
        const f = videoFiles[0];
        const correctIndex = f.id; // Use original index directly
        // Save to DB
        if (dbHelper && movieImdbId) {
            await dbHelper.insertEpisodeFiles([{
                info_hash: infoHash,
                file_index: correctIndex,
                title: f.path.split('/').pop(),
                size: f.bytes,
                imdb_id: movieImdbId,
                imdb_season: null,
                imdb_episode: null
            }]);
        }
        return {
            fileIndex: correctIndex,
            fileName: f.path.split('/').pop(),
            fileSize: f.bytes,
            source: "debrid_api",
            totalPackSize
        };
    }

    // Fuzzy Match Logic (using multi-title support)
    const match = findMovieFile(videoFiles, targetTitles, year);

    if (match) {
        console.log(`✅ [PACK-HANDLER] Found Movie: ${match.path} (${(match.bytes / 1024 / 1024 / 1024).toFixed(2)} GB)`);

        // Save to DB
        if (dbHelper && movieImdbId) {
            // ✅ INDEX ALL FILES IN PACK (for P2P reverse search)
            // Use original file.id as torrent index
            const allFilesToSave = videoFiles.map(f => ({
                info_hash: infoHash,
                file_index: f.id, // Use original index directly
                title: f.path.split('/').pop(),
                size: f.bytes,
                imdb_id: (f.id === match.id) ? movieImdbId : null,
                imdb_season: null,
                imdb_episode: null
            }));

            await dbHelper.insertEpisodeFiles(allFilesToSave);
            console.log(`💾 [PACK-HANDLER] Indexed ${allFilesToSave.length} files from movie pack.`);

            // 🔧 FIX: Also update pack_files with the IMDb ID for direct lookups
            if (typeof dbHelper.insertPackFiles === 'function') {
                try {
                    await dbHelper.insertPackFiles([{
                        pack_hash: infoHash.toLowerCase(),
                        imdb_id: movieImdbId,
                        file_index: match.id,
                        file_path: match.path,
                        file_size: match.bytes || 0
                    }]);
                    console.log(`💾 [PACK-HANDLER] Updated pack_files with IMDb ${movieImdbId} for file idx=${match.id}`);
                } catch (e) {
                    console.warn(`⚠️ [PACK-HANDLER] pack_files update failed (non-critical): ${e.message}`);
                }
            }
        }

        // Use original match.id as torrent index
        return {
            fileIndex: match.id,
            fileName: match.path.split('/').pop(),
            fileSize: match.bytes,
            source: 'debrid_api',
            totalPackSize
        };
    } else {
        console.log(`❌ [PACK-HANDLER] Movie "${JSON.stringify(targetTitles)}" not found in pack.`);
        return null;
    }
}

/**
 * Find the best matching movie file using fuzzy logic against MULTIPLE titles
 * @param {Array} files - List of files in pack
 * @param {string|Array<string>} targetTitles - Title(s) to match against (e.g. ["The Great Mouse Detective", "Basil l'investigatopo"])
 * @param {string} targetYear - Year string (e.g. "1986")
 */
function findMovieFile(files, targetTitles, targetYear) {
    if (!files || files.length === 0) return null;

    // Normalize input to array
    const titles = Array.isArray(targetTitles) ? targetTitles : [targetTitles];

    // Clean function
    const cleanTitle = (t) => t.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);

    let bestMatch = null;
    let maxScore = 0;

    // Debug logging for titles
    console.log(`🔍 [FUZZY MATCH] Checking against ${titles.length} titles: ${JSON.stringify(titles)}`);

    for (const file of files) {
        const filename = file.path.split('/').pop().toLowerCase();
        let bestTitleScoreForFile = 0;

        // Check against EACH title variant
        for (const title of titles) {
            if (!title) continue;

            let score = 0;
            const targetWords = cleanTitle(title);

            // 1. Year Check (Strong Signal)
            if (targetYear && filename.includes(targetYear)) {
                score += 50;
            }

            // 2. Title Word Match
            let matchedWords = 0;
            for (const word of targetWords) {
                if (filename.includes(word)) matchedWords++;
            }

            // Normalize word score (0-50)
            if (targetWords.length > 0) {
                score += (matchedWords / targetWords.length) * 50;
            }

            // Keep best score among all title variants for this file
            if (score > bestTitleScoreForFile) bestTitleScoreForFile = score;
        }

        // 3. Negative keywords (apply once per file)
        if (filename.includes('trailer') || filename.includes('sample')) bestTitleScoreForFile -= 50;

        console.log(`🔍 [FUZZY DEBUG] Comparing "${filename}" -> Max Score: ${bestTitleScoreForFile}`);

        if (bestTitleScoreForFile > maxScore && bestTitleScoreForFile > 60) { // Threshold 60 
            maxScore = bestTitleScoreForFile;
            bestMatch = file;
        }
    }

    return bestMatch;
}



module.exports = {
    resolveSeriesPackFile,
    processSeriesPackFiles,
    isSeasonPack,
    isVideoFile,
    parseSeasonEpisode,
    resolveMoviePackFile,
    fetchFilesFromRealDebrid
};
