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

// Video file extensions
const VIDEO_EXTENSIONS = /\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v|ts|m2ts|mpg|mpeg)$/i;

// Season/Episode parsing patterns (inspired by MediaFusion)
const SEASON_EPISODE_PATTERNS = [
    // S01E04, s01e04, S1E04
    { pattern: /[sS](\d{1,2})[eE](\d{1,3})/, extract: (m) => ({ season: parseInt(m[1]), episode: parseInt(m[2]) }) },
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
 * Ottiene la lista file da Real-Debrid
 * @param {string} infoHash - Hash del torrent
 * @param {string} rdKey - API key Real-Debrid
 * @returns {Promise<{torrentId: string, files: Array}|null>}
 */
async function fetchFilesFromRealDebrid(infoHash, rdKey) {
    const baseUrl = 'https://api.real-debrid.com/rest/1.0';
    const headers = { 'Authorization': `Bearer ${rdKey}` };

    try {
        // 1. Aggiungi magnet link
        console.log(`📦 [PACK-HANDLER] Adding magnet to RD for file list: ${infoHash.substring(0, 8)}...`);
        const magnetLink = `magnet:?xt=urn:btih:${infoHash}`;

        const addResponse = await axios.post(
            `${baseUrl}/torrents/addMagnet`,
            `magnet=${encodeURIComponent(magnetLink)}`,
            { headers, timeout: 30000 }
        );

        if (!addResponse.data || !addResponse.data.id) {
            console.error('❌ [PACK-HANDLER] Failed to add magnet to RD');
            return null;
        }

        const torrentId = addResponse.data.id;

        // 2. Ottieni info torrent con file list
        const infoResponse = await axios.get(
            `${baseUrl}/torrents/info/${torrentId}`,
            { headers, timeout: 30000 }
        );

        if (!infoResponse.data || !infoResponse.data.files) {
            console.error('❌ [PACK-HANDLER] No files in torrent info');
            // Cancella torrent
            await axios.delete(`${baseUrl}/torrents/delete/${torrentId}`, { headers }).catch(() => { });
            return null;
        }

        const files = infoResponse.data.files.map(f => ({
            id: f.id,
            path: f.path,
            bytes: f.bytes,
            selected: f.selected
        }));

        // 3. Cancella torrent (era solo per leggere file list)
        console.log(`🗑️ [PACK-HANDLER] Deleting temporary torrent ${torrentId}`);
        await axios.delete(`${baseUrl}/torrents/delete/${torrentId}`, { headers }).catch(err => {
            console.warn(`⚠️ [PACK-HANDLER] Failed to delete torrent: ${err.message}`);
        });

        console.log(`✅ [PACK-HANDLER] Got ${files.length} files from RD`);
        return { torrentId, files };

    } catch (error) {
        console.error(`❌ [PACK-HANDLER] RD API error: ${error.message}`);
        return null;
    }
}

/**
 * Ottiene la lista file da Torbox
 * @param {string} infoHash - Hash del torrent
 * @param {string} torboxKey - API key Torbox
 * @returns {Promise<{torrentId: string, files: Array}|null>}
 */
async function fetchFilesFromTorbox(infoHash, torboxKey) {
    const baseUrl = 'https://api.torbox.app/v1/api';
    const headers = { 'Authorization': `Bearer ${torboxKey}` };

    try {
        console.log(`📦 [PACK-HANDLER] Adding magnet to Torbox for file list: ${infoHash.substring(0, 8)}...`);
        const magnetLink = `magnet:?xt=urn:btih:${infoHash}`;

        // 1. Crea torrent
        const addResponse = await axios.post(
            `${baseUrl}/torrents/createtorrent`,
            { magnet: magnetLink },
            { headers, timeout: 30000 }
        );

        if (!addResponse.data || !addResponse.data.data || !addResponse.data.data.torrent_id) {
            console.error('❌ [PACK-HANDLER] Failed to add magnet to Torbox');
            return null;
        }

        const torrentId = addResponse.data.data.torrent_id;

        // 2. Aspetta un po' per permettere a Torbox di processare
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 3. Ottieni info torrent
        const infoResponse = await axios.get(
            `${baseUrl}/torrents/mylist`,
            { headers, params: { id: torrentId }, timeout: 30000 }
        );

        const torrent = infoResponse.data?.data?.find(t => t.id === torrentId);
        if (!torrent || !torrent.files) {
            console.error('❌ [PACK-HANDLER] No files in Torbox torrent info');
            // Cancella torrent
            await axios.get(`${baseUrl}/torrents/controltorrent`, {
                headers,
                params: { torrent_id: torrentId, operation: 'delete' }
            }).catch(() => { });
            return null;
        }

        const files = torrent.files.map((f, idx) => ({
            id: idx,
            path: f.name,
            bytes: f.size,
            selected: 1
        }));

        // 4. Cancella torrent
        console.log(`🗑️ [PACK-HANDLER] Deleting temporary Torbox torrent ${torrentId}`);
        await axios.get(`${baseUrl}/torrents/controltorrent`, {
            headers,
            params: { torrent_id: torrentId, operation: 'delete' }
        }).catch(err => {
            console.warn(`⚠️ [PACK-HANDLER] Failed to delete Torbox torrent: ${err.message}`);
        });

        console.log(`✅ [PACK-HANDLER] Got ${files.length} files from Torbox`);
        return { torrentId, files };

    } catch (error) {
        console.error(`❌ [PACK-HANDLER] Torbox API error: ${error.message}`);
        return null;
    }
}

/**
 * Processa i file di un pack serie e li salva nel DB
 * @param {Array} files - Lista file dal Debrid
 * @param {string} infoHash - Hash del torrent
 * @param {string} seriesImdbId - IMDb ID della serie
 * @param {number} targetSeason - Stagione target
 * @param {Object} dbHelper - Modulo db-helper
 * @returns {Promise<Array>} File processati
 */
async function processSeriesPackFiles(files, infoHash, seriesImdbId, targetSeason, dbHelper) {
    const videoFiles = files.filter(f => isVideoFile(f.path));
    const processedFiles = [];

    console.log(`🔍 [PACK-HANDLER] Processing ${videoFiles.length} video files from pack`);

    for (const file of videoFiles) {
        const filename = file.path.split('/').pop();
        const parsed = parseSeasonEpisode(filename, targetSeason);

        if (parsed && parsed.season === targetSeason) {
            processedFiles.push({
                info_hash: infoHash,
                file_index: file.id,
                title: filename,
                size: file.bytes,
                imdb_id: seriesImdbId,
                imdb_season: parsed.season,
                imdb_episode: parsed.episode
            });

            console.log(`   📄 ${filename} → S${parsed.season}E${parsed.episode} (${(file.bytes / 1024 / 1024 / 1024).toFixed(2)} GB)`);
        }
    }

    // Salva nel DB
    if (processedFiles.length > 0 && dbHelper && typeof dbHelper.insertEpisodeFiles === 'function') {
        try {
            const inserted = await dbHelper.insertEpisodeFiles(processedFiles);
            console.log(`💾 [PACK-HANDLER] Saved ${inserted} episode files to DB`);
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
    console.log(`🎬 [PACK-HANDLER] Resolving S${season}E${episode} from pack ${infoHash.substring(0, 8)}...`);

    // Variable to track total pack size
    let totalPackSize = 0;

    // 1. Prima cerca nel DB
    if (dbHelper && typeof dbHelper.searchEpisodeFiles === 'function') {
        try {
            const dbFiles = await dbHelper.searchEpisodeFiles(seriesImdbId, season, episode);

            // Cerca specificamente per questo infoHash
            const matchingFile = dbFiles.find(f => f.info_hash === infoHash);
            if (matchingFile) {
                console.log(`✅ [PACK-HANDLER] Found in DB: ${matchingFile.file_title} (${(matchingFile.file_size / 1024 / 1024 / 1024).toFixed(2)} GB)`);
                // Get total pack size from torrents table
                totalPackSize = matchingFile.torrent_size || 0;
                return {
                    fileIndex: matchingFile.file_index,
                    fileName: matchingFile.file_title,
                    fileSize: matchingFile.file_size,
                    totalPackSize: totalPackSize,
                    source: 'database'
                };
            }
        } catch (error) {
            console.warn(`⚠️ [PACK-HANDLER] DB search failed: ${error.message}`);
        }
    }

    // 2. Non nel DB → Chiama API Debrid
    let filesResult = null;

    if (config.rd_key) {
        filesResult = await fetchFilesFromRealDebrid(infoHash, config.rd_key);
    } else if (config.torbox_key) {
        filesResult = await fetchFilesFromTorbox(infoHash, config.torbox_key);
    } else {
        console.error('❌ [PACK-HANDLER] No debrid key provided');
        return null;
    }

    if (!filesResult || !filesResult.files || filesResult.files.length === 0) {
        console.error('❌ [PACK-HANDLER] Failed to get files from Debrid');
        return null;
    }

    // Calculate total pack size from all video files
    const allVideoFiles = filesResult.files.filter(f => isVideoFile(f.path));
    totalPackSize = allVideoFiles.reduce((sum, f) => sum + (f.bytes || 0), 0);

    // 3. Processa file e salva nel DB
    const processedFiles = await processSeriesPackFiles(
        filesResult.files,
        infoHash,
        seriesImdbId,
        season,
        dbHelper
    );

    // 4. Cerca l'episodio richiesto
    const targetFile = findEpisodeFile(processedFiles, episode);

    if (!targetFile) {
        console.log(`❌ [PACK-HANDLER] Episode ${episode} NOT FOUND in pack (pack has ${processedFiles.length} episodes)`);
        return null;  // ❌ Episodio non esiste nel pack - NESSUN FALLBACK
    }

    console.log(`✅ [PACK-HANDLER] Found E${episode}: ${targetFile.title} (${(targetFile.size / 1024 / 1024 / 1024).toFixed(2)} GB), pack total: ${(totalPackSize / 1024 / 1024 / 1024).toFixed(2)} GB`);

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
        /\b(?:complete|completa|full)\b/i,          // Complete, Full
        /\[?(?:S\d+)?\s*(?:E\d+-E?\d+|\d+-\d+)\]?/, // Range episodi: E01-E08, 01-08
    ];

    // Verifica che NON sia un singolo episodio
    const singleEpisodePattern = /[sS]\d{1,2}[eExX]\d{1,3}(?!\s*[-–—]\s*[eExX]?\d)/;

    if (singleEpisodePattern.test(torrentTitle)) {
        return false; // È un singolo episodio
    }

    return packPatterns.some(pattern => pattern.test(torrentTitle));
}

module.exports = {
    parseSeasonEpisode,
    extractSeasonFromPackTitle,
    isVideoFile,
    isSeasonPack,
    fetchFilesFromRealDebrid,
    fetchFilesFromTorbox,
    processSeriesPackFiles,
    findEpisodeFile,
    resolveSeriesPackFile
};
