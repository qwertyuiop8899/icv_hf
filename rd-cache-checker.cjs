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

        // 5. Clean up - Always delete the torrent we just added
        await deleteTorrent(token, torrentId);

        console.log(`🔍 [RD Cache Check] ${infoHash.substring(0, 8)}... → ${isCached ? '⚡ CACHED' : '⏬ NOT CACHED'} (status: ${info?.status})`);

        return {
            hash: infoHash,
            cached: isCached
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
 * 
 * @param {Array<{hash: string, magnet: string}>} items - Array of {hash, magnet} objects
 * @param {string} token - RealDebrid API token
 * @param {Object} dbHelper - Database helper module with updateRdCacheStatus function
 */
async function enrichCacheBackground(items, token, dbHelper) {
    if (!items || items.length === 0) return;

    console.log(`🔄 [RD Cache Background] Starting enrichment for ${items.length} hashes...`);

    // Process in background - don't await from caller
    (async () => {
        try {
            const results = [];

            for (const item of items) {
                const result = await checkSingleHash(item.hash, item.magnet, token);
                results.push(result);

                // Longer delay for background processing to be extra gentle on API
                await sleep(500);
            }

            // Save all results to DB
            if (dbHelper && typeof dbHelper.updateRdCacheStatus === 'function') {
                const cacheUpdates = results.map(r => ({
                    hash: r.hash,
                    cached: r.cached
                }));

                await dbHelper.updateRdCacheStatus(cacheUpdates);
                console.log(`✅ [RD Cache Background] Enriched ${results.length} hashes in DB`);
            }
        } catch (error) {
            console.error(`❌ [RD Cache Background] Error:`, error.message);
        }
    })();
}

// Export for Node.js
module.exports = {
    checkSingleHash,
    checkCacheSync,
    enrichCacheBackground
};
