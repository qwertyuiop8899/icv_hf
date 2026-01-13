/**
 * HLS Proxy for IntroSkip
 * Generates M3U8 manifest that skips intro sections
 * Based on IntroHater approach
 */

const { spawn, execSync } = require('child_process');

// ==================== Configuration ====================
const PROBE_TIMEOUT_MS = 30000; // 30 seconds timeout for ffprobe
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours cache

// Check if ffprobe is available at startup
let FFPROBE_AVAILABLE = false;
try {
    execSync('which ffprobe', { stdio: 'ignore' });
    FFPROBE_AVAILABLE = true;
    console.log('✅ [HLS] ffprobe found - IntroSkip with precise seeking enabled');
} catch {
    console.warn('⚠️ [HLS] ffprobe not found - IntroSkip will use time-based seeking (less precise)');
}

// Simple in-memory cache for byte offsets
const offsetCache = new Map();

// ==================== Helpers ====================

/**
 * SSRF Protection: Block internal/private IP ranges
 */
function isSafeUrl(urlStr) {
    try {
        const url = new URL(urlStr);
        const host = url.hostname.toLowerCase();

        if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') return false;
        if (host.startsWith('10.') || host.startsWith('192.168.')) return false;
        if (host.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) return false;
        if (host === '169.254.169.254') return false;

        return ['http:', 'https:'].includes(url.protocol);
    } catch {
        return false;
    }
}

/**
 * Get stream details (final URL after redirects and content-length)
 */
async function getStreamDetails(url) {
    if (!isSafeUrl(url)) return { finalUrl: url, contentLength: null };

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(url, {
            method: 'HEAD',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        clearTimeout(timeout);

        return {
            finalUrl: response.url || url,
            contentLength: response.headers.get('content-length')
                ? parseInt(response.headers.get('content-length'))
                : null
        };
    } catch (e) {
        console.warn(`⏩ [HLS] HEAD request failed: ${e.message}`);
        return { finalUrl: url, contentLength: null };
    }
}

/**
 * Get byte offset for a given timestamp using ffprobe
 */
async function getByteOffset(url, startTime) {
    // If ffprobe not available, return 0 (will use time-based seeking)
    if (!FFPROBE_AVAILABLE) {
        console.log(`⏩ [HLS] ffprobe not available, skipping byte offset calculation`);
        return { offset: 0, duration: 0 };
    }

    const cacheKey = `offset:${url}:${startTime}`;

    // Check cache
    const cached = offsetCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        console.log(`⏩ [HLS] Using cached byte offset for ${startTime}s`);
        return cached.value;
    }

    return new Promise((resolve) => {
        // Updated args: include format=duration
        const args = [
            '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            '-read_intervals', `${startTime}%+10`,
            '-select_streams', 'v:0',
            '-show_entries', 'packet=pos,pts_time,flags:format=duration',
            '-show_packets',
            '-analyzeduration', '20000000',
            '-probesize', '20000000',
            '-v', 'error',
            '-of', 'json',
            url
        ];

        console.log(`⏩ [HLS] Spawning ffprobe for ${startTime}s offset with UA (fetching duration)`);
        
        let proc;
        try {
            proc = spawn('ffprobe', args);
        } catch (e) {
            console.warn(`⏩ [HLS] Failed to spawn ffprobe: ${e.message}`);
            FFPROBE_AVAILABLE = false; // Disable for future calls
            return resolve({ offset: 0, duration: 0 });
        }
        
        // Handle spawn error (ffprobe not found)
        proc.on('error', (err) => {
            console.warn(`⏩ [HLS] ffprobe error: ${err.message}`);
            FFPROBE_AVAILABLE = false; // Disable for future calls
            resolve({ offset: 0, duration: 0 });
        });

        const timeout = setTimeout(() => {
            console.warn(`⏩ [HLS] FFprobe timeout for ${startTime}s`);
            proc.kill('SIGKILL');
            resolve({ offset: 0, duration: 0 });
        }, PROBE_TIMEOUT_MS);

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => stdout += data);
        proc.stderr.on('data', (data) => stderr += data);

        proc.on('close', (code) => {
            clearTimeout(timeout);

            if (code !== 0) {
                console.warn(`⏩ [HLS] FFprobe exited with code ${code}: ${stderr}`);
                return resolve({ offset: 0, duration: 0 });
            }

            try {
                const data = JSON.parse(stdout);

                let duration = 0;
                if (data.format && data.format.duration) {
                    duration = parseFloat(data.format.duration);
                    // console.log(`⏩ [HLS] Duration found: ${duration}`);
                }

                if (!data.packets || data.packets.length === 0) {
                    console.warn(`⏩ [HLS] No packets found`);
                    return resolve({ offset: 0, duration });
                }

                // Filter for packets with valid pos
                const validPackets = data.packets.filter(p => p.pos && parseInt(p.pos) > 0);

                const selectedPacket = validPackets[0];

                if (selectedPacket) {
                    const offset = parseInt(selectedPacket.pos);
                    console.log(`⏩ [HLS] Found offset ${offset} at ${selectedPacket.pts_time}s (Keyframe: ${selectedPacket.flags && selectedPacket.flags.includes('K')}) - Duration: ${duration}`);

                    // Cache the result
                    offsetCache.set(cacheKey, { value: { offset, duration }, timestamp: Date.now() });
                    return resolve({ offset, duration });
                }

                return resolve({ offset: 0, duration });

            } catch (e) {
                console.warn(`⏩ [HLS] Failed to parse ffprobe output: ${e.message}`);
                return resolve({ offset: 0, duration: 0 });
            }
        });
    });
}

/**
 * Generate HLS manifest that skips intro bytes
 * Uses EXT-X-BYTERANGE to skip the intro section
 */
function generateSkipManifest(videoUrl, totalLength, skipEndOffset) {
    // Skip from 0 to skipEndOffset (the intro part)
    // Play from skipEndOffset to end
    const playLength = totalLength ? (totalLength - skipEndOffset) : 999999999999;

    return `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:7200
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:7200.0,
#EXT-X-BYTERANGE:${playLength}@${skipEndOffset}
${videoUrl}
#EXT-X-ENDLIST`;
}

/**
 * Generate HLS manifest that splices out the intro (keeps pre-intro if any)
 * Segment 1: 0 to intro start
 * Segment 2: intro end to file end
 */
function generateSpliceManifest(videoUrl, duration, introStartOffset, introEndOffset, totalLength, introEnd) {
    const prePart = introStartOffset > 0 ? `#EXTINF:${(introStartOffset / 1024 / 1024 * 5).toFixed(6)},\n#EXT-X-BYTERANGE:${introStartOffset}@0\n${videoUrl}\n` : '';

    // Calculate length 2
    const postLength = totalLength ? (totalLength - introEndOffset) : 999999999999;

    // Calculate exact duration for second part using total duration from metadata
    let duration2 = 7200.0;

    if (duration > 0 && introEnd > 0) {
        // If we have total duration and intro end time, simple subtraction
        duration2 = Math.max(0, duration - introEnd);
    } else if (totalLength && introEndOffset > introStartOffset) {
        // Fallback: Estimate using bitrate if metadata duration is missing
        // This is a rough fallback if duration is 0
        const introDuration = 90; // Assume 90s average intro if unknown
        const byteRate = (introEndOffset - introStartOffset) / introDuration;
        const remainingBytes = totalLength - introEndOffset;
        duration2 = remainingBytes / byteRate;
    } else if (duration) {
        duration2 = duration / 2; // Last resort fallback
    }

    return `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:7200
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
${prePart}
#EXT-X-DISCONTINUITY
#EXTINF:${duration2.toFixed(6)},
#EXT-X-BYTERANGE:${postLength}@${introEndOffset}
${videoUrl}
#EXT-X-ENDLIST`;
}

/**
 * Main handler for HLS proxy endpoint
 */
async function handleHlsProxy(req, res) {
    const { stream, start, end } = req.query;

    // Always set CORS headers
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Range');

    if (!stream) {
        return res.status(400).send('Missing stream parameter');
    }

    const streamUrl = decodeURIComponent(stream);

    if (!isSafeUrl(streamUrl)) {
        return res.status(400).send('Invalid or unsafe stream URL');
    }

    const introStart = parseFloat(start) || 0;
    const introEnd = parseFloat(end) || 0;

    console.log(`⏩ [HLS] Request: intro ${introStart}s - ${introEnd}s`);

    // If no intro times, just redirect to original
    if (introEnd <= 0 || introEnd <= introStart) {
        console.log(`⏩ [HLS] No valid intro times, redirecting to original`);
        return res.redirect(302, streamUrl);
    }

    try {
        // Get stream details (final URL and content-length)
        console.log(`⏩ [HLS] Probing stream...`);
        const details = await getStreamDetails(streamUrl);
        const finalUrl = details.finalUrl;
        const totalLength = details.contentLength;

        console.log(`⏩ [HLS] Stream: ${finalUrl.slice(-40)}, Length: ${totalLength || 'Unknown'}`);

        // Get byte offset for intro end
        console.log(`⏩ [HLS] Calculating byte offset for ${introEnd}s...`);
        const endResult = await getByteOffset(finalUrl, introEnd);
        const introEndOffset = endResult.offset;
        const realDuration = endResult.duration;

        if (introEndOffset <= 0) {
            console.warn(`⏩ [HLS] Failed to get byte offset`);

            // Soft Fallback
            if (totalLength > 0) {
                console.log(`⏩ [HLS] Soft fallback: Generating full-file manifest (no skip)`);
                manifest = generateSkipManifest(finalUrl, totalLength, 0);
                res.set('Content-Type', 'application/x-mpegURL');
                return res.send(manifest);
            }

            console.warn(`⏩ [HLS] No length, redirecting to original`);
            return res.redirect(302, streamUrl);
        }

        let manifest;

        // If intro starts at 0, just skip to intro end
        if (introStart <= 0) {
            console.log(`⏩ [HLS] Generating skip manifest (skip 0 to ${introEndOffset} bytes)`);
            manifest = generateSkipManifest(finalUrl, totalLength, introEndOffset);
        } else {
            // Intro starts after 0, need splice manifest
            console.log(`⏩ [HLS] Calculating byte offset for intro start ${introStart}s...`);
            const startResult = await getByteOffset(finalUrl, introStart);
            const introStartOffset = startResult.offset;
            // Note: startResult.duration should be the same as endResult.duration

            if (introStartOffset > 0) {
                console.log(`⏩ [HLS] Generating splice manifest (keep 0-${introStartOffset}, skip to ${introEndOffset})`);
                // Use real duration if found, otherwise 0 to fall back to generic
                manifest = generateSpliceManifest(finalUrl, realDuration || 0, introStartOffset, introEndOffset, totalLength, introEnd);
            } else {
                // Fallback to simple skip
                console.log(`⏩ [HLS] Fallback to skip manifest`);
                manifest = generateSkipManifest(finalUrl, totalLength, introEndOffset);
            }
        }

        console.log(`⏩ [HLS] Manifest generated successfully`);
        res.set('Content-Type', 'application/x-mpegURL');
        res.send(manifest);

    } catch (error) {
        console.error(`⏩ [HLS] Error: ${error.message}`);
        // Fallback: redirect to original stream
        res.redirect(302, streamUrl);
    }
}

/**
 * Clear offset cache
 */
function clearCache() {
    offsetCache.clear();
    console.log('⏩ [HLS] Cache cleared');
}

/**
 * Get cache stats
 */
function getCacheStats() {
    return {
        size: offsetCache.size,
        entries: Array.from(offsetCache.keys())
    };
}

module.exports = {
    handleHlsProxy,
    getStreamDetails,
    getByteOffset,
    generateSkipManifest,
    generateSpliceManifest,
    clearCache,
    getCacheStats,
    isSafeUrl
};
