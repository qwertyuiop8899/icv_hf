/**
 * HLS Proxy for IntroSkip
 * Generates M3U8 manifest that skips intro sections
 * Based on IntroHater approach
 */

const { spawn } = require('child_process');

// ==================== Configuration ====================
const PROBE_TIMEOUT_MS = 30000; // 30 seconds timeout for ffprobe
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours cache

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
        const proc = spawn('ffprobe', args);

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
 * Extract chapters from video using ffprobe
 * @param {string} url - Video URL
 * @returns {Promise<Array<{startTime: number, endTime: number, title: string}>>}
 */
async function getChapters(url) {
    return new Promise((resolve) => {
        const args = [
            '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            '-show_chapters',
            '-v', 'error',
            '-of', 'json',
            url
        ];

        console.log(`⏩ [HLS] Probing chapters...`);
        const proc = spawn('ffprobe', args);

        const timeout = setTimeout(() => {
            console.warn('⏩ [HLS] Chapter probe timeout');
            proc.kill('SIGKILL');
            resolve([]);
        }, 15000);

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => stdout += data);
        proc.stderr.on('data', (data) => stderr += data);

        proc.on('close', (code) => {
            clearTimeout(timeout);
            if (code !== 0) {
                console.warn(`⏩ [HLS] Chapter probe failed: ${stderr}`);
                return resolve([]);
            }

            try {
                const data = JSON.parse(stdout);
                if (!data.chapters || data.chapters.length === 0) return resolve([]);

                const chapters = data.chapters.map(c => ({
                    startTime: parseFloat(c.start_time),
                    endTime: parseFloat(c.end_time),
                    title: c.tags ? (c.tags.title || c.tags.TITLE || 'Chapter') : 'Chapter'
                }));

                console.log(`⏩ [HLS] Found ${chapters.length} chapters`);
                resolve(chapters);
            } catch (e) {
                console.error(`⏩ [HLS] Chapter parse error: ${e.message}`);
                resolve([]);
            }
        });
    });
}

/**
 * Generate fragmented HLS manifest with multiple segments
 * Better compatibility than single-segment manifest
 * @param {string} videoUrl - Video URL
 * @param {number} duration - Total video duration
 * @param {number} totalLength - Total file size in bytes
 * @param {Object|null} skipPoints - {startTime, endTime, endOffset} or null
 * @returns {string} M3U8 manifest
 */
function generateFragmentedManifest(videoUrl, duration, totalLength, skipPoints = null) {
    const SEGMENT_DURATION = 10;
    const headerSize = 5000000; // 5MB header
    const realDuration = duration || 7200;
    const avgBitrate = totalLength ? (totalLength / realDuration) : (2500000 / 8); // Fallback 2.5Mbps

    let m3u8 = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:${SEGMENT_DURATION}
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:1.0,
#EXT-X-BYTERANGE:${headerSize}@0
${videoUrl}
`;

    let currentTime = 0;
    let currentByte = headerSize;
    const skipStart = skipPoints ? skipPoints.startTime : -1;
    const skipEnd = skipPoints ? skipPoints.endTime : -1;
    const skipEndByte = skipPoints ? skipPoints.endOffset : -1;

    let segmentsAdded = 0;

    while (currentTime < realDuration) {
        // Handle Skip zone
        if (skipPoints && currentTime >= skipStart && currentTime < skipEnd) {
            // Jump to end of skip zone
            currentTime = skipEnd;
            currentByte = skipEndByte !== -1 ? skipEndByte : Math.floor(skipEnd * avgBitrate);
            m3u8 += `#EXT-X-DISCONTINUITY\n`;
            continue;
        }

        let segDur = Math.min(SEGMENT_DURATION, realDuration - currentTime);
        let segLen = Math.floor(segDur * avgBitrate);

        // Don't go past totalLength
        if (totalLength && (currentByte + segLen) > totalLength) {
            segLen = totalLength - currentByte;
        }

        if (segLen <= 0 && segmentsAdded > 0) break;

        m3u8 += `#EXTINF:${segDur.toFixed(3)},
#EXT-X-BYTERANGE:${segLen}@${currentByte}
${videoUrl}
`;

        currentTime += segDur;
        currentByte += segLen;
        segmentsAdded++;

        if (segmentsAdded > 2000) break; // Safety limit
    }

    m3u8 += `#EXT-X-ENDLIST`;
    return m3u8;
}

/**
 * Process and patch an external HLS playlist to skip intro
 * Works with existing M3U8 playlists (not direct video files)
 * @param {string} playlistUrl - External M3U8 URL
 * @param {number|null} skipStart - Intro start time in seconds
 * @param {number|null} skipEnd - Intro end time in seconds
 * @returns {Promise<string>} Patched M3U8 content
 */
async function processExternalPlaylist(playlistUrl, skipStart = null, skipEnd = null) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(playlistUrl, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const originalM3u8 = await response.text();
        const lines = originalM3u8.split('\n');

        // Base URL for resolving relative segments
        const urlObj = new URL(playlistUrl);
        const pathDir = urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1);
        const baseUrl = `${urlObj.origin}${pathDir}`;
        const queryParams = urlObj.search;

        let patchedM3u8 = '';
        let currentTime = 0;
        let discontinuityPending = false;

        const isMaster = originalM3u8.includes('#EXT-X-STREAM-INF');

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            if (!line) continue;

            if (line.startsWith('#')) {
                if (line.startsWith('#EXTINF:')) {
                    const durationStr = line.substring(8).split(',')[0];
                    const duration = parseFloat(durationStr);

                    // Skip logic (only for media playlists)
                    if (!isMaster && skipStart !== null && skipEnd !== null) {
                        const segmentStart = currentTime;
                        const segmentEnd = currentTime + duration;

                        const isBefore = segmentEnd <= skipStart;
                        const isAfter = segmentStart >= skipEnd;

                        if (!isBefore && !isAfter) {
                            // Drop this segment (it's in the intro zone)
                            currentTime += duration;
                            discontinuityPending = true;
                            i++; // Skip next line (URL)
                            continue;
                        }
                    }

                    currentTime += duration;
                }

                patchedM3u8 += line + '\n';
            } else {
                // This is a URL line
                if (discontinuityPending) {
                    patchedM3u8 += '#EXT-X-DISCONTINUITY\n';
                    discontinuityPending = false;
                }

                let segmentUrl = line;
                // Rewrite to absolute if relative
                if (!segmentUrl.startsWith('http')) {
                    segmentUrl = baseUrl + segmentUrl;
                }

                // Append original query params (token) if present
                if (queryParams && !segmentUrl.includes('?')) {
                    segmentUrl += queryParams;
                } else if (queryParams) {
                    segmentUrl += '&' + queryParams.substring(1);
                }

                patchedM3u8 += segmentUrl + '\n';
            }
        }

        console.log(`⏩ [HLS] Patched external playlist, removed intro segments`);
        return patchedM3u8;

    } catch (e) {
        console.error(`⏩ [HLS] Failed to process external playlist: ${e.message}`);
        throw e;
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
    generateFragmentedManifest,
    processExternalPlaylist,
    getChapters,
    clearCache,
    getCacheStats,
    isSafeUrl
};
