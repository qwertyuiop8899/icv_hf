/**
 * IntroSkip Module - Skip TV show intros using IntroDB API
 * 
 * Uses the public IntroDB API (https://introdb.app) to fetch intro timestamps
 * and automatically skip intros for TV series episodes.
 * 
 * Only works with Debrid services (Real-Debrid, Torbox, AllDebrid) as P2P
 * streams use magnet links which cannot be time-offset.
 */

const INTRODB_BASE_URL = 'https://api.introdb.app';
const INTRODB_TIMEOUT = 3000; // 3 seconds timeout
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in ms
const CACHE_MAX_SIZE = 500; // Max cached entries

// Simple LRU-like cache
const introCache = new Map();

/**
 * Clean old cache entries
 */
function cleanCache() {
    const now = Date.now();
    for (const [key, entry] of introCache.entries()) {
        if (now - entry.timestamp > CACHE_TTL) {
            introCache.delete(key);
        }
    }

    // If still too large, remove oldest entries
    if (introCache.size > CACHE_MAX_SIZE) {
        const entries = Array.from(introCache.entries())
            .sort((a, b) => a[1].timestamp - b[1].timestamp);

        const toRemove = entries.slice(0, entries.length - CACHE_MAX_SIZE);
        toRemove.forEach(([key]) => introCache.delete(key));
    }
}

/**
 * Lookup intro data from IntroDB API
 * 
 * @param {string} imdbId - IMDB ID (e.g., "tt0903747")
 * @param {number} season - Season number (1-indexed)
 * @param {number} episode - Episode number (1-indexed)
 * @returns {Promise<{start_sec: number, end_sec: number, confidence: number}|null>}
 */
async function lookupIntro(imdbId, season, episode) {
    if (!imdbId || !season || !episode) {
        return null;
    }

    // Ensure imdbId starts with "tt"
    if (!imdbId.startsWith('tt')) {
        return null;
    }

    const cacheKey = `${imdbId}:${season}:${episode}`;

    // Check cache first
    const cached = introCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        if (cached.data) {
            console.log(`⏩ [IntroSkip] Cache HIT: ${cacheKey}`);
        }
        return cached.data;
    }

    try {
        const url = `${INTRODB_BASE_URL}/intro?imdb_id=${imdbId}&season=${season}&episode=${episode}`;
        console.log(`⏩ [IntroSkip] Querying: ${url}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), INTRODB_TIMEOUT);

        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'IlCorsaroViola/1.0'
            }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            if (response.status === 404) {
                // No intro data for this episode - cache as null
                console.log(`⏩ [IntroSkip] No intro found for ${cacheKey}`);
                introCache.set(cacheKey, { data: null, timestamp: Date.now() });
                cleanCache();
                return null;
            }
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data && typeof data.start_sec === 'number' && typeof data.end_sec === 'number') {
            const introData = {
                start_sec: data.start_sec,
                end_sec: data.end_sec,
                confidence: data.confidence || 0
            };

            console.log(`⏩ [IntroSkip] Found intro: ${introData.start_sec}s - ${introData.end_sec}s (confidence: ${introData.confidence})`);

            // Cache the result
            introCache.set(cacheKey, { data: introData, timestamp: Date.now() });
            cleanCache();

            return introData;
        }

        // Invalid response format
        introCache.set(cacheKey, { data: null, timestamp: Date.now() });
        cleanCache();
        return null;

    } catch (error) {
        if (error.name === 'AbortError') {
            console.warn(`⏩ [IntroSkip] Timeout for ${cacheKey}`);
        } else {
            console.warn(`⏩ [IntroSkip] Error for ${cacheKey}: ${error.message}`);
        }

        // Cache error as null for shorter period (5 minutes)
        introCache.set(cacheKey, { data: null, timestamp: Date.now() - CACHE_TTL + 5 * 60 * 1000 });
        return null;
    }
}

/**
 * Append time offset to a stream URL using HTML5 Media Fragment
 * This makes the video start at the specified time, effectively skipping the intro
 * 
 * @param {string} url - Original stream URL
 * @param {number} endSeconds - Intro end time in seconds
 * @returns {string} URL with time fragment appended
 */
function appendTimeOffset(url, endSeconds) {
    if (!url || !endSeconds || endSeconds <= 0) {
        return url;
    }

    // Round to 1 decimal place
    const seconds = Math.round(endSeconds * 10) / 10;

    // Remove any existing fragment
    const baseUrl = url.split('#')[0];

    // Append HTML5 Media Fragment time offset
    // Format: #t={seconds} - this tells the player to start at this time
    return `${baseUrl}#t=${seconds}`;
}

/**
 * Get the intro skip indicator emoji
 * @returns {string}
 */
function getIntroIndicator() {
    return '⏩';
}

/**
 * Check if intro skip should be applied
 * Only works with Debrid services, not P2P
 * 
 * @param {boolean} useDebrid - Whether a debrid service is enabled
 * @param {boolean} introskipEnabled - Whether introskip is enabled in config
 * @param {string} type - Content type ('movie' or 'series')
 * @returns {boolean}
 */
function shouldApplyIntroSkip(useDebrid, introskipEnabled, type) {
    return useDebrid && introskipEnabled && type === 'series';
}

/**
 * Get cache statistics
 * @returns {{size: number, maxSize: number}}
 */
function getCacheStats() {
    return {
        size: introCache.size,
        maxSize: CACHE_MAX_SIZE
    };
}

/**
 * Clear the intro cache
 */
function clearCache() {
    introCache.clear();
    console.log('⏩ [IntroSkip] Cache cleared');
}

module.exports = {
    lookupIntro,
    appendTimeOffset,
    getIntroIndicator,
    shouldApplyIntroSkip,
    getCacheStats,
    clearCache
};
