// =====================================================
// RD CACHE CHECKER - Leviathan Style
// =====================================================
// Verifica proattiva della cache RealDebrid usando il metodo
// Add → Status → Delete. Funziona anche con instantAvailability disabilitata.

const RD_BASE_URL = 'https://api.real-debrid.com/rest/1.0';
const RD_TIMEOUT = 30000;

/**
 * Sleep helper
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generic RD API request with retry logic
 */
async function rdRequest(method, url, token, data = null) {
    let attempt = 0;
    while (attempt < 3) {
        try {
            const config = {
                method,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            };

            if (data) {
                config.body = data;
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), RD_TIMEOUT);
            config.signal = controller.signal;

            const response = await fetch(url, config);
            clearTimeout(timeoutId);

            if (response.status === 204) {
                return { success: true };
            }

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                if (response.status === 403) return null;
                if (response.status === 429 || response.status >= 500) {
                    await sleep(1000 + Math.random() * 1000);
                    attempt++;
                    continue;
                }
                console.error(`RD API Error: ${response.status}`, errorData);
                return null;
            }

            return await response.json();
        } catch (error) {
            if (error.name === 'AbortError') {
                console.error('RD API Timeout');
            }
            attempt++;
            if (attempt < 3) {
                await sleep(500);
            }
        }
    }
    return null;
}

/**
 * Delete a torrent from RD account
 */
async function deleteTorrent(token, torrentId) {
    try {
        const result = await rdRequest('DELETE', `${RD_BASE_URL}/torrents/delete/${torrentId}`, token);
        if (result && result.success) {
            console.log(`🗑️ [RD Delete] Successfully deleted torrent ${torrentId}`);
        } else {
            console.log(`🗑️ [RD Delete] Delete request sent for ${torrentId} (no confirmation)`);
        }
    } catch (e) {
        console.error(`⚠️ [RD Delete] FAILED to delete torrent ${torrentId}:`, e.message);
    }
}

/**
 * Check if a single hash is cached in RealDebrid
 * Uses the Add → Status → Delete method (Leviathan style)
 * 
 * @param {string} infoHash - The torrent info hash
 * @param {string} magnet - Full magnet link
 * @param {string} token - RealDebrid API token
 * @returns {Object} { hash, cached: boolean, error?: string }
 */
async function checkSingleHash(infoHash, magnet, token) {
    let torrentId = null;

    try {
        // 1. Add Magnet
        const addBody = new URLSearchParams();
        addBody.append('magnet', magnet);

        const addRes = await rdRequest('POST', `${RD_BASE_URL}/torrents/addMagnet`, token, addBody);
        if (!addRes || !addRes.id) {
            return { hash: infoHash, cached: false, error: 'Failed to add magnet' };
        }
        torrentId = addRes.id;

        // 2. Get Torrent Info
        let info = await rdRequest('GET', `${RD_BASE_URL}/torrents/info/${torrentId}`, token);
        if (!info) {
            await deleteTorrent(token, torrentId);
            return { hash: infoHash, cached: false, error: 'Failed to get torrent info' };
        }

        // 3. If waiting for file selection, select all files (like Leviathan)
        // This is REQUIRED - RD won't show 'downloaded' status until files are selected
        if (info.status === 'waiting_files_selection') {
            const selBody = new URLSearchParams();
            selBody.append('files', 'all');
            await rdRequest('POST', `${RD_BASE_URL}/torrents/selectFiles/${torrentId}`, token, selBody);

            // Re-fetch info after selection
            info = await rdRequest('GET', `${RD_BASE_URL}/torrents/info/${torrentId}`, token);
        }

        // 4. Check status - If 'downloaded', it's fully cached
        const isCached = info?.status === 'downloaded';

        // 5. ✅ NEW: Extract main video file name for deduplication
        let mainFileName = '';
        let mainFileSize = 0;
        let torrentTitle = info.filename || ''; // Get torrent title
        let torrentSize = info.bytes || 0;     // Get total torrent size
        
        // 🚀 SPEEDUP: Extract ALL video files for pack support
        let allVideoFiles = [];

        if (info?.files && Array.isArray(info.files)) {
            // Video extensions to look for
            const videoExtensions = /\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v|ts|m2ts|mpg|mpeg)$/i;

            // Find video files and sort by size (largest is usually the main file)
            const videoFiles = info.files
                .filter(f => videoExtensions.test(f.path))
                .sort((a, b) => (b.bytes || 0) - (a.bytes || 0));
            
            // 🚀 SPEEDUP: Save all video files (>25MB) for pack resolution
            allVideoFiles = info.files
                .filter(f => videoExtensions.test(f.path) && f.bytes > 25 * 1024 * 1024)
                .map(f => ({
                    id: f.id,
                    path: f.path,
                    bytes: f.bytes
                }));

            if (videoFiles.length > 0) {
                // Get filename from path (remove leading slashes/folders)
                const fullPath = videoFiles[0].path;
                mainFileName = fullPath.split('/').pop() || fullPath;
                mainFileSize = videoFiles[0].bytes || 0; // ✅ Capture file size
                console.log(`📄 [RD Cache] Main file: ${mainFileName.substring(0, 50)}... (${(mainFileSize / 1024 / 1024).toFixed(2)} MB)`);
            }
            
            // 🚀 SPEEDUP: Log pack info
            if (allVideoFiles.length > 1) {
                console.log(`📦 [RD Cache] Pack detected: ${allVideoFiles.length} video files`);
            }
        }

        // 6. Clean up - Always delete the torrent we just added
        await deleteTorrent(token, torrentId);

        console.log(`🔍 [RD Cache Check] ${infoHash.substring(0, 8)}... → ${isCached ? '⚡ CACHED' : '⏬ NOT CACHED'} (status: ${info?.status})`);

        return {
            hash: infoHash,
            cached: isCached,
            torrent_title: torrentTitle, // ✅ Return torrent title
            size: torrentSize,           // ✅ Return total size
            file_title: mainFileName || null,
            file_size: mainFileSize || null,
            files: allVideoFiles         // 🚀 SPEEDUP: Return all video files for pack resolution
        };

    } catch (error) {
        console.error(`❌ [RD Cache Check] Error for ${infoHash}:`, error.message);
        if (torrentId) {
            await deleteTorrent(token, torrentId);
        }
        return { hash: infoHash, cached: false, error: error.message };
    }
}

/**
 * Check cache status for multiple hashes synchronously (blocks until complete)
 * Used for the top N torrents that the user will see immediately
 * 
 * @param {Array<{hash: string, magnet: string}>} items - Array of {hash, magnet} objects
 * @param {string} token - RealDebrid API token
 * @param {number} limit - Maximum number of hashes to check (default: 5)
 * @returns {Object} Map of hash -> { cached: boolean }
 */
async function checkCacheSync(items, token, limit = 5) {
    const results = {};
    const toCheck = items.slice(0, limit);

    console.log(`🔄 [RD Cache] Checking ${toCheck.length} hashes synchronously...`);

    // Check sequentially to avoid rate limiting issues
    for (const item of toCheck) {
        const result = await checkSingleHash(item.hash, item.magnet, token);
        results[result.hash.toLowerCase()] = {
            cached: result.cached,
            file_title: result.file_title,
            file_size: result.file_size,
            torrent_title: result.torrent_title, // ✅ Pass torrent title
            size: result.size,                   // ✅ Pass total size
            fromLiveCheck: true
        };

        // Small delay between checks to be nice to RD API
        if (toCheck.indexOf(item) < toCheck.length - 1) {
            await sleep(200);
        }
    }

    console.log(`✅ [RD Cache] Sync check complete. ${Object.values(results).filter(r => r.cached).length}/${toCheck.length} cached`);

    return results;
}

/**
 * Enrich cache in background (non-blocking)
 * Checks remaining hashes and saves results to DB for future queries
 * 🚀 SPEEDUP: Also saves pack files to DB for instant pack resolution
 * 
 * @param {Array<{hash: string, magnet: string}>} items - Array of {hash, magnet} objects
 * @param {string} token - RealDebrid API token
 * @param {Object} dbHelper - Database helper module with updateRdCacheStatus function
 */
// Helper to check if title indicates a pack (trilogia, collection, etc.)
function isPackTitle(title) {
    if (!title) return false;
    return /\b(trilog|saga|collection|collezione|pack|completa|integrale|filmografia)\b/i.test(title);
}

async function enrichCacheBackground(items, token, dbHelper) {
    if (!items || items.length === 0) return;

    console.log(`🔄 [RD Cache Background] Queued ${items.length} hashes for background enrichment...`);

    // ⚠️ TRUE BACKGROUND: Runs 5s AFTER response is sent
    // This gives time for the HTTP response to complete
    setTimeout(() => {
        (async () => {
            console.log(`🔄 [RD Cache Background] Starting enrichment (delayed 5s)...`);
            try {
                const results = [];
                let skippedAlreadyCached = 0;

                // 🚀 SPEEDUP: Check ALL hashes at once in DB, not one by one
                let alreadyCachedHashes = {};
                if (dbHelper && typeof dbHelper.getRdCachedAvailability === 'function') {
                    const allHashes = items.map(i => i.hash);
                    alreadyCachedHashes = await dbHelper.getRdCachedAvailability(allHashes);
                }

                for (const item of items) {
                    // ✅ CHECK from pre-fetched map: Skip if already checked
                    if (alreadyCachedHashes[item.hash] !== undefined) {
                        skippedAlreadyCached++;
                        continue;
                    }
                    
                    // 1 second delay BEFORE each call (RD allows 200/min = 1 every 300ms, but be safe)
                    await sleep(1000);
                    
                    const result = await checkSingleHash(item.hash, item.magnet, token);
                    results.push(result);
                }

            // Save all results to DB
            if (dbHelper && typeof dbHelper.updateRdCacheStatus === 'function') {
                const cacheUpdates = results.map(r => ({
                    hash: r.hash,
                    cached: r.cached,
                    torrent_title: r.torrent_title || null,
                    size: r.size || null,
                    file_title: r.file_title || null,
                    file_size: r.file_size || null
                }));

                await dbHelper.updateRdCacheStatus(cacheUpdates);
                console.log(`✅ [RD Cache Background] Enriched ${results.length} hashes (skipped ${skippedAlreadyCached} already in DB)`);
            }
            
            // 🚀 SPEEDUP: Save pack files ONLY if title indicates a pack
            if (dbHelper && typeof dbHelper.insertPackFiles === 'function') {
                for (const result of results) {
                    // ✅ FIXED: Only save if TITLE indicates pack (trilogia, collection, etc.)
                    // NOT just because it has >1 file (single movies can have .nfo, .srt files)
                    const isPack = isPackTitle(result.torrent_title) && result.files && result.files.length > 1;
                    
                    if (result.cached && isPack) {
                        try {
                            const packFilesData = result.files.map(f => ({
                                pack_hash: result.hash.toLowerCase(),
                                imdb_id: null,
                                file_index: f.id,
                                file_path: f.path,
                                file_size: f.bytes || 0
                            }));
                            await dbHelper.insertPackFiles(packFilesData);
                            console.log(`📦 [RD Cache Background] Saved ${result.files.length} pack files for ${result.hash.substring(0, 8)}`);
                        } catch (packErr) {
                            console.warn(`⚠️ [RD Cache Background] Failed to save pack files: ${packErr.message}`);
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`❌ [RD Cache Background] Error:`, error.message);
        }
        })();
    }, 5000); // 5 second delay - runs AFTER response is already sent
}

// Export for Node.js
module.exports = {
    checkSingleHash,
    checkCacheSync,
    enrichCacheBackground
};
