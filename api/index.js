// Scraper Unificato: UIndex + Il Corsaro Nero + Knaben con o senza Real-Debrid (Versione Vercel)

import * as cheerio from 'cheerio';
import { promises as fs } from 'fs';
import path from 'path';
import { createRequire } from 'module';

// ✅ AIOSTREAMS: Fuzzy matching library (CommonJS import)
const require = createRequire(import.meta.url);
const fuzzball = require('fuzzball');

// ✅ Import CommonJS modules (db-helper, id-converter, rd-cache-checker)
const dbHelper = require('../db-helper.cjs');
const { completeIds } = require('../lib/id-converter.cjs');
const rdCacheChecker = require('../rd-cache-checker.cjs');
const { searchRARBG } = require('../rarbg.cjs');
const aioFormatter = require('../aiostreams-formatter.cjs');
const packFilesHandler = require('../pack-files-handler.cjs');
const introSkip = require('../introskip.cjs');
const customFormatter = require('../formatter.cjs');

// ✅ External Addon Integration (Torrentio, MediaFusion, Comet)
import { fetchExternalAddonsFlat, EXTERNAL_ADDONS } from './external-addons.js';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// ✅ Torrentio placeholder videos (hosted by Torrentio)
const TORRENTIO_VIDEO_BASE = 'https://torrentio.strem.fun';

// ✅ Safe Base64 encoding/decoding for Node.js
const atob = (str) => Buffer.from(str, 'base64').toString('utf-8');
const btoa = (str) => Buffer.from(str, 'utf-8').toString('base64');

const _k = new Map();

// ✅ Improved HTML Entity Decoder
function decodeHtmlEntities(text) {
    const entities = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&nbsp;': ' ',
        '&#8217;': "'",
        '&#8220;': '"',
        '&#8221;': '"',
        '&#8211;': '–',
        '&#8212;': '—'
    };

    return text.replace(/&[#\w]+;/g, match => entities[match] || match);
}

// ✅ DEBUG MODE
const DEBUG_MODE = false;

// ✅ Custom Formatter Helper - Full AIOStreams compatible
// ✅ Custom Formatter Helper - Full AIOStreams compatible
function applyCustomFormatter(stream, result, userConfig, serviceName = 'RD', isCached = false) {
    // If AIOStreams mode is enabled, SKIP custom formatting to preserve AIO format
    if (userConfig && userConfig.aiostreams_mode) return stream;

    if (!userConfig || !userConfig.formatter_preset) return stream;

    try {
        const preset = userConfig.formatter_preset;
        let templates;

        if (preset === 'custom') {
            templates = {
                name: userConfig.formatter_custom_name || '',
                description: userConfig.formatter_custom_desc || ''
            };
            console.log(`🎨 [Formatter] Custom preset detected - name template: "${templates.name?.substring(0, 50)}...", desc template: "${templates.description?.substring(0, 50)}..."`);
        } else {
            templates = customFormatter.PRESET_TEMPLATES[preset];
            console.log(`🎨 [Formatter] Using preset: ${preset}`);
        }

        if (!templates) return stream;

        const filename = result.filename || result.title || '';
        const fn = filename.toLowerCase();

        // ============================================
        // PATTERN EXTRACTION HELPERS
        // ============================================
        const extractPattern = (str, patterns) => {
            for (const [key, regex] of Object.entries(patterns)) {
                if (regex.test(str)) return key;
            }
            return '';
        };

        const extractMultiple = (str, patterns) => {
            const matches = [];
            for (const [key, regex] of Object.entries(patterns)) {
                if (regex.test(str)) matches.push(key);
            }
            return matches;
        };

        // ============================================
        // ALL PATTERNS (AIOStreams-compatible)
        // ============================================
        const visualPatterns = {
            'HDR10+': /hdr.?10.?\+|hdr.?10.?plus/i,
            'HDR10': /hdr.?10(?!.?\+)/i,
            'HDR': /\bhdr\b(?!.?10)/i,
            'DV': /dolby.?vision|dovi|\bdv\b/i,
            '10bit': /10.?bit/i,
            'IMAX': /\bimax\b/i,
            '3D': /\b3d\b/i,
            'SDR': /\bsdr\b/i
        };

        const audioPatterns = {
            'Atmos': /\batmos\b/i,
            'TrueHD': /true.?hd/i,
            'DTS-HD MA': /dts.?hd.?ma/i,
            'DTS-HD': /dts.?hd(?!.?ma)/i,
            'DTS-ES': /dts.?es/i,
            'DTS': /\bdts\b(?!.?hd|.?es)/i,
            'DD+': /dd\+|ddp|e.?ac.?3/i,
            'DD': /\bdd\b|dolby.?digital(?!.?\+)|(?<!e.?)ac.?3/i,
            'FLAC': /\bflac\b/i,
            'OPUS': /\bopus\b/i,
            'AAC': /\baac\b/i
        };

        const audioChannelPatterns = {
            '7.1': /7\.?1/i,
            '5.1': /5\.?1/i,
            '2.0': /2\.?0|stereo/i
        };

        const codecPatterns = {
            'HEVC': /hevc|x.?265|h.?265/i,
            'AVC': /avc|x.?264|h.?264/i,
            'AV1': /\bav1\b/i,
            'XviD': /xvid/i,
            'DivX': /divx/i
        };

        const resolutionPatterns = {
            '2160p': /2160p|4k|uhd/i,
            '1440p': /1440p|2k|qhd/i,
            '1080p': /1080p/i,
            '720p': /720p/i,
            '576p': /576p/i,
            '480p': /480p/i,
            '360p': /360p/i
        };

        const qualityPatterns = {
            'Remux': /\bremux\b/i,
            'BluRay': /blu.?ray|bdrip|brrip/i,
            'WEB-DL': /web.?dl/i,
            'WEBRip': /web.?rip/i,
            'HDRip': /hd.?rip/i,
            'DVDRip': /dvd.?rip/i,
            'HDTV': /hdtv/i,
            'PDTV': /pdtv/i,
            'CAM': /\bcam\b|camrip/i,
            'TS': /\bts\b|telesync/i,
            'TC': /\btc\b|telecine/i,
            'SCR': /\bscr\b|screener/i
        };

        const editionPatterns = {
            'Extended': /extended|ext.?cut/i,
            'Theatrical': /theatrical/i,
            'Director': /director.?s?.?cut|dc\b/i,
            'Ultimate': /ultimate/i,
            'Anniversary': /anniversary/i,
            'IMAX': /imax.?(edition)?/i,
            'Remastered': /remaster(ed)?/i,
            'Collectors': /collector.?s?/i,
            'Uncut': /uncut/i,
            'Diamond': /diamond/i
        };

        const networkPatterns = {
            'Netflix': /\bnetflix\b|nf\b/i,
            'Amazon': /\bamazon\b|amzn\b/i,
            'HBO': /\bhbo\b|hmax\b/i,
            'Disney+': /\bdisney\b|dsnp\b|d\+/i,
            'Apple TV+': /\batv\b|atvp\b/i,
            'Hulu': /\bhulu\b/i,
            'Paramount+': /\bpmtp\b|paramount\+?/i
        };

        // Extract all fields from filename (normalizeResolution is defined below after language handling)
        const rawResolution = result.resolution || extractPattern(filename, resolutionPatterns) || '';
        const quality = result.quality || extractPattern(filename, qualityPatterns) || '';
        const encode = result.codec || result.videoCodec || extractPattern(filename, codecPatterns) || '';
        const visualTags = result.visualTags?.length ? result.visualTags : extractMultiple(filename, visualPatterns);
        const audioTags = result.audioTags?.length ? result.audioTags : extractMultiple(filename, audioPatterns);
        const audioChannels = extractMultiple(filename, audioChannelPatterns);
        const edition = extractPattern(filename, editionPatterns) || null;
        const network = extractPattern(filename, networkPatterns) || null;

        // Extract year from filename
        const yearMatch = filename.match(/\b(19|20)\d{2}\b/);
        const year = yearMatch ? yearMatch[0] : (result.year || null);

        // Extract container/extension
        const extMatch = filename.match(/\.(mkv|mp4|avi|mov|wmv|flv|webm)$/i);
        const container = extMatch ? extMatch[1].toLowerCase() : null;
        const extension = container;

        // Season/Episode formatting
        const season = result.season || null;
        const episode = result.episode || null;
        const seasons = season ? [season] : [];
        const episodes = episode ? [episode] : [];
        const pad = (n) => n?.toString().padStart(2, '0') || '';
        const formattedSeasons = season ? `S${pad(season)}` : null;
        const formattedEpisodes = episode ? `E${pad(episode)}` : null;
        const seasonEpisode = [formattedSeasons, formattedEpisodes].filter(Boolean);
        const seasonPack = result.isPack || /complete|stagione|season.?pack/i.test(fn);

        // Flags (AIOStreams)
        const remastered = /remaster(ed)?/i.test(fn);
        const repack = /\brepack\b/i.test(fn);
        const uncensored = /uncensored/i.test(fn);
        const unrated = /unrated/i.test(fn);
        const upscaled = /upscal(ed|e)?|\bai\b/i.test(fn);

        // Language handling
        const languageMap = {
            'Italian': '🇮🇹', 'English': '🇬🇧', 'French': '🇫🇷', 'German': '🇩🇪',
            'Spanish': '🇪🇸', 'Portuguese': '🇵🇹', 'Russian': '🇷🇺', 'Japanese': '🇯🇵',
            'Korean': '🇰🇷', 'Chinese': '🇨🇳', 'Arabic': '🇸🇦', 'Hindi': '🇮🇳',
            'Thai': '🇹🇭', 'Vietnamese': '🇻🇳', 'Indonesian': '🇮🇩', 'Turkish': '🇹🇷',
            'Polish': '🇵🇱', 'Dutch': '🇳🇱', 'Swedish': '🇸🇪', 'Norwegian': '🇳🇴',
            'Danish': '🇩🇰', 'Finnish': '🇫🇮', 'Greek': '🇬🇷', 'Czech': '🇨🇿',
            'Hungarian': '🇭🇺', 'Romanian': '🇷🇴', 'Bulgarian': '🇧🇬', 'Ukrainian': '🇺🇦',
            'Hebrew': '🇮🇱', 'Persian': '🇮🇷', 'Malay': '🇲🇾', 'Latino': '💃🏻',
            'Multi': '🌎', 'ITA': '🇮🇹', 'ENG': '🇬🇧', 'FRA': '🇫🇷', 'GER': '🇩🇪'
        };
        const langCodeMap = {
            'Italian': 'IT', 'English': 'EN', 'French': 'FR', 'German': 'DE',
            'Spanish': 'ES', 'Portuguese': 'PT', 'Russian': 'RU', 'Japanese': 'JA',
            'Korean': 'KO', 'Chinese': 'ZH', 'Arabic': 'AR', 'Hindi': 'HI',
            'Multi': 'MUL', 'ITA': 'IT', 'ENG': 'EN'
        };
        // Small caps with mathematical monospace digits (same as AIOStreams)
        const SMALL_CAPS = {
            A: 'ᴀ', B: 'ʙ', C: 'ᴄ', D: 'ᴅ', E: 'ᴇ', F: 'ꜰ', G: 'ɢ', H: 'ʜ', I: 'ɪ',
            J: 'ᴊ', K: 'ᴋ', L: 'ʟ', M: 'ᴍ', N: 'ɴ', O: 'ᴏ', P: 'ᴘ', Q: 'ǫ', R: 'ʀ',
            S: 'ꜱ', T: 'ᴛ', U: 'ᴜ', V: 'ᴠ', W: 'ᴡ', X: '𝘅', Y: 'ʏ', Z: 'ᴢ',
            '0': '𝟢', '1': '𝟣', '2': '𝟤', '3': '𝟥', '4': '𝟦', '5': '𝟧', '6': '𝟨', '7': '𝟩', '8': '𝟪', '9': '𝟫'
        };
        const makeSmall = (s) => s.split('').map(c => SMALL_CAPS[c.toUpperCase()] || c).join('');

        // Resolution normalizer (AIOStreams-identical: always returns standardized format like "2160p")
        const normalizeResolution = (res) => {
            if (!res) return null;
            const r = res.toLowerCase().replace(/\s/g, '');
            if (/2160|4k|uhd/.test(r)) return '2160p';
            if (/1440|2k|qhd/.test(r)) return '1440p';
            if (/1080|fhd/.test(r)) return '1080p';
            if (/720|hd(?!r)/.test(r)) return '720p';
            if (/576/.test(r)) return '576p';
            if (/480|sd/.test(r)) return '480p';
            if (/360/.test(r)) return '360p';
            return res; // Return as-is if not recognized
        };

        const languages = result.languages?.length ? result.languages :
            extractMultiple(filename, { Italian: /\bita(lian)?\b/i, English: /\beng(lish)?\b/i, French: /\bfre(nch)?\b/i, German: /\bger(man)?\b|deu(tsch)?\b/i, Spanish: /\bspa(nish)?\b/i, Multi: /\bmulti\b/i });
        const languageEmojis = result.languageEmojis?.length ? result.languageEmojis :
            languages.map(l => languageMap[l] || l);
        const languageCodes = languages.map(l => langCodeMap[l] || l.substring(0, 2).toUpperCase());
        const smallLanguageCodes = languageCodes.map(c => makeSmall(c));

        // wedontknowwhatakilometeris: AIOStreams joke field - replaces 🇬🇧 with 🇺🇸🦅 for Americans
        const wedontknowwhatakilometeris = languageEmojis.map(e => e.replace('🇬🇧', '🇺🇸🦅'));

        // Apply normalizeResolution to raw extracted resolution
        const resolution = normalizeResolution(rawResolution) || rawResolution;

        // Age formatting
        const formatAge = (age) => {
            if (!age) return null;
            if (typeof age === 'number') {
                if (age < 24) return `${age}h`;
                if (age < 24 * 7) return `${Math.round(age / 24)}d`;
                if (age < 24 * 30) return `${Math.round(age / (24 * 7))}w`;
                return `${Math.round(age / (24 * 30))}mo`;
            }
            return age;
        };

        // Build complete data object
        const data = {
            config: {
                addonName: 'IlCorsaroViola'
            },
            stream: {
                // Basic
                filename: result.filename || result.title || '',
                folderName: result.folderName || '',
                title: result.title || result.filename || '',
                size: result.matchedFileSize || result.size || 0,
                folderSize: result.packSize || result.folderSize || 0,
                library: false,

                // Quality info
                quality: quality,
                resolution: resolution,
                encode: encode,
                codec: encode,

                // Languages (all variants)
                languages: languages,
                uLanguages: languages,
                languageEmojis: languageEmojis,
                uLanguageEmojis: languageEmojis,
                languageCodes: languageCodes,
                uLanguageCodes: languageCodes,
                smallLanguageCodes: smallLanguageCodes,
                uSmallLanguageCodes: smallLanguageCodes,
                wedontknowwhatakilometeris: wedontknowwhatakilometeris,
                uWedontknowwhatakilometeris: wedontknowwhatakilometeris,

                // Tags
                visualTags: visualTags,
                audioTags: audioTags,
                audioChannels: audioChannels,
                releaseGroup: result.groupTag || result.releaseGroup || result.group || '',
                regexMatched: null,

                // Episode info
                year: year,
                seasons: seasons,
                season: season,
                formattedSeasons: formattedSeasons,
                episodes: episodes,
                episode: episode,
                formattedEpisodes: formattedEpisodes,
                seasonEpisode: seasonEpisode,
                seasonPack: seasonPack,

                // Metadata
                edition: edition,
                remastered: remastered,
                repack: repack,
                uncensored: uncensored,
                unrated: unrated,
                upscaled: upscaled,
                network: network,
                container: container,
                extension: extension,

                // Torrent info
                seeders: result.seeders || 0,
                private: false,
                age: formatAge(result.uploadTime || result.ageHours) || result.age || '',
                ageHours: result.ageHours || null,
                duration: result.duration || 0,
                infoHash: result.infoHash || null,

                // Stream type
                type: isCached ? 'Debrid' : (result.type || 'p2p'),
                message: null,
                proxied: false,
                seadex: false,
                seadexBest: false,

                // ICV specific backwards compat
                source: quality || result.source || '',
                audio: audioTags.length ? audioTags[0] : '',
                cached: isCached,
                isPack: seasonPack,
                packSize: result.packSize || result.size || 0,
                indexer: result.provider || result.source || ''
            },
            service: {
                id: serviceName.toLowerCase(),
                name: serviceName === 'RD' ? 'Real-Debrid' : (serviceName === 'TB' ? 'Torbox' : (serviceName === 'AD' ? 'AllDebrid' : serviceName)),
                shortName: serviceName,
                cached: isCached
            },
            addon: {
                name: 'IlCorsaroViola',
                version: '3.0.0',
                presetId: preset,
                manifestUrl: null
            },
            tools: {
                newLine: '\n',
                removeLine: ''
            }
        };

        // Apply templates
        if (templates.name) {
            stream.name = customFormatter.parseTemplate(templates.name, data);
        }
        if (templates.description) {
            stream.title = customFormatter.parseTemplate(templates.description, data);
        }
    } catch (e) {
        console.error('⚠️ [Formatter] Error applying custom format:', e.message);
    }

    return stream;
}

// ✅ Enhanced Query Cleaning (from uiai.js)
function cleanSearchQuery(query) {
    console.log(`🧹 Cleaning query: "${query}"`);

    // Remove IMDb ID pattern if present
    if (query.match(/^tt\d+$/)) {
        console.log(`⚠️ Raw IMDb ID detected: ${query}. This should be converted to movie title before calling scraper.`);
        return null;
    }

    // Clean up the query for better search results
    const cleaned = query
        .replace(/\s*\(\d{4}\)\s*$/, '') // Remove year at the end
        .replace(/[^\p{L}\p{N}\s.-]/gu, ' ') // Replace special chars, keeping unicode letters/numbers
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();

    console.log(`✨ Cleaned query: "${cleaned}"`);
    return cleaned;
}

// ✅ Enhanced Quality Extraction
function extractQuality(title) {
    if (!title) return '';

    // More comprehensive quality patterns
    // Resolution numbers are unique enough to match without strict boundaries
    const qualityPatterns = [
        /(2160p?|4k|uhd)/i,
        /(1080p?)/i,
        /(720p?)/i,
        /(480p?)/i,
        /\b(sd)\b/i,
        /\b(webrip|web-rip)\b/i,
        /\b(bluray|blu-ray|bdremux)\b/i,
        /\b(remux)\b/i,
        /\b(hdrip)\b/i,
        /\b(cam|ts|tc)\b/i
    ];

    for (const pattern of qualityPatterns) {
        const match = title.match(pattern);
        if (match) {
            let quality = match[1].toLowerCase();

            // Normalize resolutions: always add 'p' suffix (except 4k/uhd)
            if (quality === '2160' || quality === '2160p' || quality === 'uhd' || quality === '4k') {
                return '4K';  // Normalize to 4K
            }
            if (quality === '1080') return '1080p';
            if (quality === '720') return '720p';
            if (quality === '480') return '480p';

            return quality;
        }
    }

    return '';
}

// ✅ Improved Info Hash Extraction
function extractInfoHash(magnet) {
    if (!magnet) return null;
    const match = magnet.match(/btih:([A-Fa-f0-9]{40}|[A-Za-z2-7]{32})/i);
    if (!match) return null;

    // Convert base32 to hex if needed
    if (match[1].length === 32) {
        // This is base32, convert to hex (simplified)
        return match[1].toUpperCase();
    }

    return match[1].toUpperCase();
}

// ✅ Enhanced Size Parsing
function parseSize(sizeStr) {
    if (!sizeStr || sizeStr === '-' || sizeStr.toLowerCase() === 'unknown') return 0;

    const match = sizeStr.match(/([\d.,]+)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)/i);
    if (!match) return 0;

    const [, value, unit] = match;
    const cleanValue = parseFloat(value.replace(',', '.'));

    const multipliers = {
        'B': 1,
        'KB': 1024, 'KIB': 1024,
        'MB': 1024 ** 2, 'MIB': 1024 ** 2,
        'GB': 1024 ** 3, 'GIB': 1024 ** 3,
        'TB': 1024 ** 4, 'TIB': 1024 ** 4
    };

    return Math.round(cleanValue * (multipliers[unit.toUpperCase()] || 1));
}

// ✅ Formattazione dimensione file
function formatBytes(bytes, decimals = 2) {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// ✅ Italian Language Detection
function isItalian(title, italianMovieTitle = null) {
    if (!title) return false;
    // ✅ MODIFICA: Rimosso "multi" e "dual" da qui per evitare conflitti.
    // Ora questa funzione rileva solo l'italiano esplicito.
    const italianRegex = /\b(ita|italian|sub[.\s]?ita|nuita)\b/i;
    if (italianRegex.test(title)) {
        return true;
    }

    if (italianMovieTitle) {
        const normalizedTorrentTitle = title.toLowerCase();
        const normalizedItalianTitle = italianMovieTitle.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const italianWords = normalizedItalianTitle.split(' ')
            .filter(word => word.length > 2) // Filtra parole troppo corte
            .filter(word => !['del', 'al', 'dal', 'nel', 'sul', 'un', 'il', 'lo', 'la', 'gli', 'le', 'con', 'per', 'che', 'non'].includes(word)); // Filtra parole comuni

        if (italianWords.length > 0) {
            const matchingWords = italianWords.filter(word =>
                normalizedTorrentTitle.includes(word)
            );

            // Se almeno il 60% delle parole del titolo italiano sono presenti, è probabile che sia in italiano.
            const percentageMatch = matchingWords.length / italianWords.length;
            if (percentageMatch > 0.6) { // Soglia alzata per essere più precisi ed evitare falsi positivi
                console.log(`🇮🇹 Matched Italian title words in "${title}" (score: ${percentageMatch.toFixed(2)})`);
                return true;
            }
        }
    }

    return false;
}

// ✅ NUOVA FUNZIONE: Icona lingua (usando i regex AIOStreams)
function getLanguageInfo(title, italianMovieTitle = null, source = null, parsedInfo = null) {
    if (!title) return { icon: '', isItalian: false, isMulti: false, displayLabel: '', detectedLanguages: [] };

    // ✅ Se abbiamo parsedInfo dal parser AIOStreams, usalo direttamente
    let detectedLanguages = [];
    if (parsedInfo?.languages?.length > 0) {
        detectedLanguages = parsedInfo.languages;
    } else {
        // Fallback: usa i regex PARSE_REGEX.languages se definiti
        if (typeof PARSE_REGEX !== 'undefined' && PARSE_REGEX.languages) {
            for (const [lang, regex] of Object.entries(PARSE_REGEX.languages)) {
                if (regex.test(title)) {
                    detectedLanguages.push(lang);
                }
            }
        } else {
            // Fallback vecchio metodo se PARSE_REGEX non è ancora disponibile
            const lowerTitle = title.toLowerCase();
            if (/\b(ita|italian)\b/i.test(title) && !/\b(ita|italian)[.\s\-_]?sub/i.test(title)) detectedLanguages.push('Italian');
            if (/\b(eng|english)\b/i.test(title) && !/\b(eng|english)[.\s\-_]?sub/i.test(title)) detectedLanguages.push('English');
            if (/\b(multi)\b/i.test(title) && !/\b(multi)[.\s\-_]?sub/i.test(title)) detectedLanguages.push('Multi');
            if (/\b(dual)\b/i.test(title) && !/\b(dual)[.\s\-_]?sub/i.test(title)) detectedLanguages.push('Dual Audio');
        }
    }

    // Detect flags based on detected languages
    let hasIta = detectedLanguages.includes('Italian');
    const hasEng = detectedLanguages.includes('English');
    const hasMulti = detectedLanguages.includes('Multi') || detectedLanguages.includes('Dual Audio');

    // Check also for Italian via title matching
    if (!hasIta && italianMovieTitle) {
        hasIta = isItalian(title, italianMovieTitle);
    }

    // Force Italian for CorsaroNero
    if (source && (source === 'CorsaroNero' || source.includes('CorsaroNero'))) {
        hasIta = true;
    }

    // Logic 1: ITA + ENG -> 🇮🇹 🇬🇧
    if (hasIta && hasEng) {
        return { icon: '🇮🇹 🇬🇧', isItalian: true, isMulti: true, displayLabel: '🇮🇹 🇬🇧', detectedLanguages };
    }

    // Logic 2: SOLO ITA (or ITA + MULTI) -> 🇮🇹
    if (hasIta) {
        return { icon: '🇮🇹', isItalian: true, isMulti: hasMulti, displayLabel: '🇮🇹', detectedLanguages };
    }

    // Logic 3: MULTI (No ITA) -> 🌈 MULTI
    if (hasMulti) {
        return { icon: '🌈', isItalian: false, isMulti: true, displayLabel: '🌈 MULTI', detectedLanguages };
    }

    // Logic 4: SOLO ENG (Default) -> 🇬🇧
    if (hasEng) {
        return { icon: '🇬🇧', isItalian: false, isMulti: false, displayLabel: '🇬🇧', detectedLanguages };
    }

    // Logic 5: Altre lingue o nessuna rilevata -> 🌐
    if (detectedLanguages.length > 0) {
        return { icon: '🌐', isItalian: false, isMulti: false, displayLabel: '🌐', detectedLanguages };
    }

    // Default
    return { icon: '', isItalian: false, isMulti: false, displayLabel: '', detectedLanguages };
}

// ✅ NUOVA FUNZIONE: Detecta Season Pack
function isSeasonPack(title) {
    if (!title) return false;
    const lowerTitle = title.toLowerCase();

    // First check: if it has S07E01 pattern, it's a single episode, NOT a pack
    const singleEpisodePattern = /s\d{1,2}e\d{1,2}/i;
    if (singleEpisodePattern.test(lowerTitle)) {
        return false;
    }

    // Pattern per pack completi/multi-stagione
    const packPatterns = [
        // Multi-season packs
        /stagion[ei]\s*\d+\s*[-–—]\s*\d+/i,  // Stagione 1-34
        /season\s*\d+\s*[-–—]\s*\d+/i,       // Season 1-34
        /s\d+\s*[-–—]\s*s?\d+/i,             // S01-S34

        // Complete/collection keywords
        /completa/i,                          // Completa
        /complete/i,                          // Complete
        /integrale/i,                         // Integrale
        /collection/i,                        // Collection
        /\bpack\b/i,                          // Pack

        // Single season packs (without episode number)
        /stagion[ei]\s*\d+/i,                 // Stagione 7, Stagioni 1
        /season\s*\d+/i,                      // Season 7
        /\.s\d{1,2}\./i,                      // .S7. or .S07. (dots around)
        /\.s\d{1,2}$/i,                       // .S07 at end of title
        /\bs\d{1,2}(?!e)\b/i,                 // S7 or S07 not followed by E (word boundary)
        /\bs\d{1,2}\./i,                      // S7. or S07. (S followed by dot, no episode)
    ];

    return packPatterns.some(pattern => pattern.test(lowerTitle));
}

// ✅ NUOVA FUNZIONE: Filtro per categorie per adulti
function isAdultCategory(categoryText) {
    if (!categoryText) return false;
    // Normalize by converting to lowercase and removing common separators.
    const normalizedCategory = categoryText.toLowerCase().replace(/[\s/.-]/g, '');

    // Keywords that identify adult categories.
    const adultCategoryKeywords = ['xxxvideos', 'adult', 'porn', 'hardcore', 'erotic', 'hentai', 'stepmom', 'stepdad', 'stepsister', 'stepson', 'incest', 'eroz', 'foradults', 'mature', 'nsfw'];
    return adultCategoryKeywords.some(keyword => normalizedCategory.includes(keyword));
}

// ✅ NUOVA FUNZIONE: Validazione per query di ricerca brevi (Migliorata)
function isGoodShortQueryMatch(torrentTitle, searchQuery) {
    const cleanedSearchQuery = searchQuery
        .toLowerCase()
        .replace(/\s\(\d{4}\)/, '') // Rimuove l'anno tra parentesi
        .replace(/[^\p{L}\p{N}\s.-]/gu, ' ') // Keep unicode letters/numbers and dots/hyphens
        .replace(/\s+/g, ' ')
        .trim();

    // Applica il controllo solo per query brevi per non essere troppo restrittivo
    if (cleanedSearchQuery.length > 8 || cleanedSearchQuery.length < 2) { // Soglia aumentata
        return true;
    }

    const normalizedTorrentTitle = torrentTitle.toLowerCase();
    const searchWords = new Set(cleanedSearchQuery.split(' ').filter(w => w.length > 0));

    // 1. Tutte le parole della ricerca devono essere presenti nel titolo del torrent
    for (const word of searchWords) {
        const wordRegex = new RegExp(`\\b${word}\\b`, 'i');
        if (!wordRegex.test(normalizedTorrentTitle)) {
            console.log(`🏴‍☠️ [Short Query] Parola mancante: "${word}" non trovata in "${torrentTitle}"`);
            return false;
        }
    }

    return true;
}

// --- NUOVA SEZIONE: SCRAPER PER IL CORSARO NERO ---

const CORSARO_BASE_URL = "https://ilcorsaronero.link";

async function fetchCorsaroNeroSingle(searchQuery, type = 'movie') {
    console.log(`🏴‍☠️ [Single Query] Searching Il Corsaro Nero for: "${searchQuery}" (type: ${type})`);

    try {
        // Definisce le categorie da accettare in base al tipo
        // Le categorie nel sito sono: "Film", "Serie TV", "Animazione - Film", "Animazione - Serie", "Musica - Audio", etc.
        let acceptedCategories;
        let outputCategory;
        switch (type) {
            case 'movie':
                acceptedCategories = ['film', 'animazione - film'];
                outputCategory = 'Movies';
                break;
            case 'series':
                acceptedCategories = ['serie tv', 'animazione - serie'];
                outputCategory = 'TV';
                break;
            case 'anime':
                // ⚠️ IMPORTANTE: Su CorsaroNero gli anime hanno categorie inconsistenti
                // Esempio: "One Piece S03E93-130" → "film", "One Piece S01E01-30" → "serie tv"
                // Accettiamo TUTTE le categorie e filtriamo poi per titolo/episodi
                acceptedCategories = ['animazione - film', 'animazione - serie', 'film', 'serie tv'];
                outputCategory = 'Anime';
                break;
            default:
                acceptedCategories = ['serie tv', 'animazione - serie'];
                outputCategory = 'TV';
        }

        // Cerca senza filtro categoria per avere tutti i risultati
        const searchUrl = `${CORSARO_BASE_URL}/search?q=${encodeURIComponent(searchQuery)}`;

        const searchResponse = await fetch(searchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
        });
        if (!searchResponse.ok) {
            throw new Error(`CorsaroNero search failed with status ${searchResponse.status}`);
        }
        const searchHtml = await searchResponse.text();

        const $ = cheerio.load(searchHtml);
        const rows = $('tbody tr');

        if (rows.length === 0) {
            console.log('🏴‍☠️ No results found on CorsaroNero.');
            return [];
        }

        // Check if it's the "no results" message
        if (rows.length === 1) {
            const firstCell = $(rows[0]).find('td').first();
            const text = firstCell.text().trim().toLowerCase();
            if (text.includes('nessun torrent') || text.includes('no torrent')) {
                console.log('🏴‍☠️ No results found on CorsaroNero (no torrent message).');
                return [];
            }
        }

        console.log(`🏴‍☠️ Found ${rows.length} potential results on CorsaroNero. Filtering by category...`);

        // Filtra le righe in base alla categoria
        const filteredRows = rows.toArray().filter((row) => {
            // Estrai la categoria dalla prima colonna
            const firstTd = $(row).find('td').first();
            const categorySpan = firstTd.find('span');
            const category = categorySpan.length > 0
                ? categorySpan.text().trim().toLowerCase()
                : firstTd.text().trim().toLowerCase();

            if (!category) {
                return false;
            }

            const isAccepted = acceptedCategories.includes(category);

            if (!isAccepted) {
                console.log(`🏴‍☠️   - Skipping category: "${category}"`);
            }

            return isAccepted;
        });

        console.log(`🏴‍☠️ After category filter: ${filteredRows.length} results (from ${rows.length} total)`);

        if (filteredRows.length === 0) {
            console.log('🏴‍☠️ No results found matching the category criteria.');
            return [];
        }

        // Limit the number of detail pages to fetch to avoid "Too many subrequests" error on Cloudflare.
        const MAX_DETAILS_TO_FETCH = 6;
        const rowsToProcess = filteredRows.slice(0, MAX_DETAILS_TO_FETCH);

        console.log(`🏴‍☠️ Fetching details for top ${rowsToProcess.length} results...`);

        const streamPromises = rowsToProcess.map(async (row) => {
            const titleElement = $(row).find('th a');
            if (!titleElement.length) return null;
            const torrentTitle = titleElement.text().trim();

            console.log(`🏴‍☠️   - Processing row: "${torrentTitle}"`);
            // --- NUOVA MODIFICA: Validazione per query brevi ---
            if (!isGoodShortQueryMatch(torrentTitle, searchQuery)) {
                return null;
            }
            // --- FINE MODIFICA ---

            const torrentPath = titleElement.attr('href');
            if (!torrentPath) return null;

            // --- OTTIMIZZAZIONE: Estrai la dimensione dalla pagina dei risultati ---
            const cells = $(row).find('td');
            const sizeStr = cells.length > 3 ? cells.eq(3).text().trim() : 'Unknown';
            const sizeInBytes = parseSize(sizeStr);
            // --- FINE OTTIMIZZAZIONE ---

            const torrentPageUrl = `${CORSARO_BASE_URL}${torrentPath}`;

            try {
                const detailResponse = await fetch(torrentPageUrl, { headers: { 'Referer': searchUrl } });
                if (!detailResponse.ok) return null;

                const detailHtml = await detailResponse.text();
                const $$ = cheerio.load(detailHtml);

                // --- MODIFICA: Logica di estrazione del magnet link più robusta ---
                let magnetLink = $$('a[href^="magnet:?"]').attr('href');

                // Fallback 1: Selettore specifico originale
                if (!magnetLink) {
                    const mainDiv = $$("div.w-full:nth-child(2)");
                    if (mainDiv.length) {
                        magnetLink = mainDiv.find("a.w-full:nth-child(1)").attr('href');
                    }
                }

                // Fallback 2: Cerca un link con un'icona a forma di magnete (comune)
                if (!magnetLink) {
                    magnetLink = $$('a:has(i.fa-magnet)').attr('href');
                }

                // Fallback 3: Search the entire page text for a magnet link pattern (very robust)
                if (!magnetLink) {
                    const bodyHtml = $$.html(); // Get the full HTML content of the page
                    // This regex looks for a magnet link inside quotes or as plain text.
                    const magnetMatch = bodyHtml.match(/["'>\s](magnet:\?xt=urn:btih:[^"'\s<>]+)/i);
                    if (magnetMatch && magnetMatch[1]) {
                        magnetLink = magnetMatch[1];
                        console.log('🏴‍☠️ [Magnet Fallback] Found magnet link using raw HTML search.');
                    }
                }
                // --- FINE MODIFICA ---

                if (magnetLink && magnetLink.startsWith('magnet:')) {
                    const seeds = $(row).find('td.text-green-500').text().trim() || '0';
                    const leechs = $(row).find('td.text-red-500').text().trim() || '0';
                    const infoHash = extractInfoHash(magnetLink);

                    if (!infoHash) {
                        console.log(`🏴‍☠️   - Failed to extract infohash for: "${torrentTitle}"`);
                        return null;
                    }

                    return {
                        magnetLink: magnetLink,
                        websiteTitle: torrentTitle,
                        title: torrentTitle,
                        filename: torrentTitle,
                        quality: extractQuality(torrentTitle),
                        size: sizeStr,
                        source: 'CorsaroNero',
                        seeders: parseInt(seeds) || 0,
                        leechers: parseInt(leechs) || 0,
                        infoHash: infoHash,
                        mainFileSize: sizeInBytes,
                        pubDate: new Date().toISOString(), // Not available, using current time
                        categories: [outputCategory]
                    };
                }

                console.log(`🏴‍☠️   - Failed to find magnet for: "${torrentTitle}"`);
                return null;
            } catch (e) {
                console.error(`🏴‍☠️ Error fetching CorsaroNero detail page ${torrentPageUrl}:`, e.message);
                return null;
            }
        });

        const settledStreams = await Promise.allSettled(streamPromises);
        const streams = settledStreams
            .filter(result => result.status === 'fulfilled' && result.value)
            .map(result => result.value);

        console.log(`🏴‍☠️ Successfully parsed ${streams.length} streams from CorsaroNero.`);
        return streams;

    } catch (error) {
        console.error(`❌ Error in fetchCorsaroNeroData:`, error);
        return [];
    }
}

async function fetchCorsaroNeroData(originalQuery, type = 'movie') {
    const searchStrategies = [];

    // Strategy 1: Original query, cleaned
    const cleanedOriginal = cleanSearchQuery(originalQuery);
    if (cleanedOriginal) {
        searchStrategies.push({
            query: cleanedOriginal,
            description: 'Original cleaned'
        });
    }

    // Strategy 2: Remove extra words like "film", "movie", etc. (solo per film)
    if (type === 'movie') {
        const simplified = cleanedOriginal?.replace(/\b(movie|film|dvd|bluray|bd)\b/gi, '').trim();
        if (simplified && simplified !== cleanedOriginal && simplified.length > 2) {
            searchStrategies.push({
                query: simplified,
                description: 'Simplified movie'
            });
        }
    }

    let allResults = [];
    const seenHashes = new Set();

    for (const strategy of searchStrategies) {
        if (!strategy.query) continue;

        console.log(`🏴‍☠️ [Strategy: ${strategy.description}] Searching CorsaroNero for: "${strategy.query}"`);

        try {
            const results = await fetchCorsaroNeroSingle(strategy.query, type);
            const newResults = results.filter(result => {
                if (!result.infoHash || seenHashes.has(result.infoHash)) return false;
                seenHashes.add(result.infoHash);
                return true;
            });
            allResults.push(...newResults);
            if (allResults.length >= 20) break;
        } catch (error) {
            console.error(`❌ CorsaroNero Strategy "${strategy.description}" failed:`, error.message);
        }
    }

    console.log(`🏴‍☠️ Multi-strategy search for CorsaroNero found ${allResults.length} total unique results.`);
    return allResults;
}

// --- FINE NUOVA SEZIONE ---


// --- NUOVA SEZIONE: TORRENT TITLE PARSER (AIOStreams Style) ---

/**
 * Helper function per creare regex (come AIOStreams)
 * Crea un pattern che matcha solo parole intere, non prefissi/suffissi
 */
function createRegex(pattern) {
    return new RegExp(`(?<![^\\s\\[(_\\-.,])(${pattern})(?=[\\s\\)\\]_.\\-,]|$)`, 'i');
}

/**
 * Regex per lingue che esclude i sottotitoli (come AIOStreams)
 * Non matcha se seguito da "sub", "subtitle", "subs", etc.
 */
function createLanguageRegex(pattern) {
    return createRegex(`${pattern}(?![ .\\-_]?sub(title)?s?)`);
}

// --- REGEX PATTERNS (identici ad AIOStreams parser/regex.ts) ---

const PARSE_REGEX = {
    resolutions: {
        '2160p': createRegex('(bd|hd|m)?(4k|2160(p|i)?)|u(ltra)?[ .\\-_]?hd|3840\\s?x\\s?(\\d{4})'),
        '1440p': createRegex('(bd|hd|m)?(1440(p|i)?)|2k|w?q(uad)?[ .\\-_]?hd|2560\\s?x(\\d{4})'),
        '1080p': createRegex('(bd|hd|m)?(1080(p|i)?)|f(ull)?[ .\\-_]?hd|1920\\s?x\\s?(\\d{3,4})'),
        '720p': createRegex('(bd|hd|m)?((720|800)(p|i)?)|hd|1280\\s?x\\s?(\\d{3,4})'),
        '576p': createRegex('(bd|hd|m)?((576|534)(p|i)?)'),
        '480p': createRegex('(bd|hd|m)?(480(p|i)?)|sd'),
        '360p': createRegex('(bd|hd|m)?(360(p|i)?)'),
        '240p': createRegex('(bd|hd|m)?((240|266)(p|i)?)'),
    },
    qualities: {
        'BluRay REMUX': createRegex('(bd|br|b|uhd)?remux'),
        'BluRay': createRegex('(?<!remux.*)(bd|blu[ .\\-_]?ray|((bd|br)[ .\\-_]?rip))(?!.*remux)'),
        'WEB-DL': createRegex('web[ .\\-_]?(dl)?(?![ .\\-_]?(rip|DLRip|cam))'),
        'WEBRip': createRegex('web[ .\\-_]?rip'),
        'HDRip': createRegex('hd[ .\\-_]?rip|web[ .\\-_]?dl[ .\\-_]?rip'),
        'HDTV': createRegex('hd[ .\\-_]?tv|pdtv'),
        'DVDRip': createRegex('dvd[ .\\-_]?(rip|scr)'),
        'DVD': createRegex('dvd(?![ .\\-_]?(rip|scr))'),
        'CAM': createRegex('(hd)?cam(?![ .\\-_]?rip)|cam[ .\\-_]?rip'),
        'TS': createRegex('((hd)?ts|telesync)(?![ .\\-_]?rip)|ts[ .\\-_]?rip'),
        'TC': createRegex('tc|telecine'),
        'SCR': createRegex('((bd|dvd)?scr(eener)?)|scr[ .\\-_]?rip'),
    },
    visualTags: {
        'HDR10+': createRegex('hdr[ .\\-_]?10[ .\\-_]?(\\+|p(lus)?)'),
        'HDR10': createRegex('hdr[ .\\-_]?10(?![ .\\-_]?(?:\\+|p(lus)?))'),
        'HDR': createRegex('hdr(?![ .\\-_]?10)(?![ .\\-_]?(?:\\+|p(lus)?))'),
        'DV': createRegex('do?(lby)?[ .\\-_]?vi?(sion)?(?:[ .\\-_]?atmos)?|dv'),
        '3D': createRegex('(bd)?(3|three)[ .\\-_]?(d(imension)?(al)?)'),
        'IMAX': createRegex('imax'),
        'SDR': createRegex('sdr'),
    },
    audioTags: {
        'Atmos': createRegex('atmos'),
        'DD+': createRegex('(d(olby)?[ .\\-_]?d(igital)?[ .\\-_]?(p(lus)?|\\+)(?:[ .\\-_]?(2[ .\\-_]?0|5[ .\\-_]?1|7[ .\\-_]?1))?)|e[ .\\-_]?ac[ .\\-_]?3'),
        'DD': createRegex('(d(olby)?[ .\\-_]?d(igital)?(?:[ .\\-_]?(5[ .\\-_]?1|7[ .\\-_]?1|2[ .\\-_]?0?))?)|(?<!e[ .\\-_]?)ac[ .\\-_]?3'),
        'DTS-HD MA': createRegex('dts[ .\\-_]?hd[ .\\-_]?ma'),
        'DTS-HD': createRegex('dts[ .\\-_]?hd(?![ .\\-_]?ma)'),
        'DTS-ES': createRegex('dts[ .\\-_]?es'),
        'DTS': createRegex('dts(?![ .\\-_]?hd[ .\\-_]?ma|[ .\\-_]?hd|[ .\\-_]?es)'),
        'TrueHD': createRegex('true[ .\\-_]?hd'),
        'OPUS': createRegex('opus'),
        'AAC': createRegex('q?aac(?:[ .\\-_]?2)?'),
        'FLAC': createRegex('flac(?:[ .\\-_]?(lossless|2\\.0|x[2-4]))?'),
    },
    audioChannels: {
        '2.0': createRegex('(d(olby)?[ .\\-_]?d(igital)?)?2[ .\\-_]?0(ch)?'),
        '5.1': createRegex('(d(olby)?[ .\\-_]?d(igital)?[ .\\-_]?(p(lus)?|\\+)?)?5[ .\\-_]?1(ch)?'),
        '6.1': createRegex('(d(olby)?[ .\\-_]?d(igital)?[ .\\-_]?(p(lus)?|\\+)?)?6[ .\\-_]?1(ch)?'),
        '7.1': createRegex('(d(olby)?[ .\\-_]?d(igital)?[ .\\-_]?(p(lus)?|\\+)?)?7[ .\\-_]?1(ch)?'),
    },
    encodes: {
        'HEVC': createRegex('hevc[ .\\-_]?(10)?|[xh][ .\\-_]?265'),
        'AVC': createRegex('avc|[xh][ .\\-_]?264'),
        'AV1': createRegex('av1'),
        'XviD': createRegex('xvid'),
        'DivX': createRegex('divx|dvix'),
    },
    // Regex per lingue (come AIOStreams) - escludono "sub", "subtitle"
    languages: {
        'Multi': createLanguageRegex('multi'),
        'Dual Audio': createLanguageRegex('dual[ .\\-_]?(audio|lang(uage)?|flac|ac3|aac2?)'),
        'Dubbed': createLanguageRegex('dub(s|bed|bing)?'),
        'English': createLanguageRegex('english|eng'),
        'Japanese': createLanguageRegex('japanese|jap|jpn'),
        'Chinese': createLanguageRegex('chinese|chi'),
        'Russian': createLanguageRegex('russian|rus'),
        'Arabic': createLanguageRegex('arabic|ara'),
        'Portuguese': createLanguageRegex('portuguese|por'),
        'Spanish': createLanguageRegex('spanish|spa|esp'),
        'French': createLanguageRegex('french|fra|fr|vf|vff|vfi|vf2|vfq|truefrench'),
        'German': createLanguageRegex('deu(tsch)?(land)?|ger(man)?'),
        'Italian': createRegex('italian|ita|sub[.\\s\\-_]?ita'),  // ✅ Include "ita", "italian", "sub ita", "subita"
        'Korean': createLanguageRegex('korean|kor'),
        'Hindi': createLanguageRegex('hindi|hin'),
        'Bengali': createLanguageRegex('bengali|ben(?![ .\\-_]?the[ .\\-_]?men)'),
        'Punjabi': createLanguageRegex('punjabi|pan'),
        'Tamil': createLanguageRegex('tamil|tam'),
        'Telugu': createLanguageRegex('telugu|tel'),
        'Thai': createLanguageRegex('thai|tha'),
        'Vietnamese': createLanguageRegex('vietnamese|vie'),
        'Indonesian': createLanguageRegex('indonesian|ind'),
        'Turkish': createLanguageRegex('turkish|tur'),
        'Hebrew': createLanguageRegex('hebrew|heb'),
        'Persian': createLanguageRegex('persian|per'),
        'Ukrainian': createLanguageRegex('ukrainian|ukr'),
        'Greek': createLanguageRegex('greek|ell'),
        'Polish': createLanguageRegex('polish|pol'),
        'Czech': createLanguageRegex('czech|cze'),
        'Slovak': createLanguageRegex('slovak|slo'),
        'Hungarian': createLanguageRegex('hungarian|hun'),
        'Romanian': createLanguageRegex('romanian|rum'),
        'Bulgarian': createLanguageRegex('bulgarian|bul'),
        'Serbian': createLanguageRegex('serbian|srp'),
        'Croatian': createLanguageRegex('croatian|hrv'),
        'Dutch': createLanguageRegex('dutch|dut'),
        'Danish': createLanguageRegex('danish|dan'),
        'Finnish': createLanguageRegex('finnish|fin'),
        'Swedish': createLanguageRegex('swedish|swe'),
        'Norwegian': createLanguageRegex('norwegian|nor'),
        'Malay': createLanguageRegex('malay'),
        'Latino': createLanguageRegex('latino|lat'),
    },
    releaseGroup: /-[. ]?(?!\d+$|S\d+|\d+x|ep?\d+|[^[]+]$)([^\-. []+[^\-. [)\]\d][^\-. [)\]]*)(?:\[[\w.-]+])?(?=\)|[.-]+\w{2,4}$|$)/i,
};

/**
 * Trova il primo match in un oggetto di regex patterns
 */
function matchPattern(filename, patterns) {
    for (const [name, pattern] of Object.entries(patterns)) {
        if (pattern.test(filename)) {
            return name;
        }
    }
    return undefined;
}

/**
 * Trova tutti i match in un oggetto di regex patterns
 */
function matchMultiplePatterns(filename, patterns) {
    const matches = [];
    for (const [name, pattern] of Object.entries(patterns)) {
        if (pattern.test(filename)) {
            matches.push(name);
        }
    }
    return matches;
}

/**
 * Parser principale per titoli torrent (implementazione JavaScript di @viren070/parse-torrent-title)
 * Basato su: https://github.com/clement-escolano/parse-torrent-title
 * 
 * @param {string} filename - Nome del file/torrent da parsare
 * @returns {Object} Oggetto con tutti i campi estratti
 */
function parseTorrentTitle(filename) {
    if (!filename) {
        return {
            title: undefined,
            year: undefined,
            seasons: [],
            episodes: [],
            resolution: undefined,
            quality: undefined,
            languages: [],
            codec: undefined,
            group: undefined,
            complete: false,
            extended: false,
            repack: false,
            proper: false,
            audioTags: [],
            visualTags: [],
            audioChannels: [],
        };
    }

    // Normalizza il filename
    let normalized = filename
        .replace(/\./g, ' ')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const result = {
        title: undefined,
        year: undefined,
        seasons: [],
        episodes: [],
        resolution: undefined,
        quality: undefined,
        languages: [],
        codec: undefined,
        group: undefined,
        complete: false,
        extended: false,
        repack: false,
        proper: false,
        audioTags: [],
        visualTags: [],
        audioChannels: [],
    };

    // 1. Estrai anno (4 cifre tra 1900 e 2099)
    const yearMatch = filename.match(/[[(. _-]?((?:19|20)\d{2})[\]).\s_-]/);
    if (yearMatch) {
        result.year = parseInt(yearMatch[1], 10);
    }

    // 2. Estrai stagione/episodio (S01E02, 1x02, Season 1 Episode 2, etc.)
    const seasonEpisodePatterns = [
        /S(\d{1,2})[ .\-_]?E(\d{1,3})/i,                       // S01E05
        /(\d{1,2})x(\d{1,3})/i,                                  // 1x05
        /Season[ .\-_]?(\d{1,2})[ .\-_]?Episode[ .\-_]?(\d{1,3})/i, // Season 1 Episode 5
        /S(\d{1,2})[ .\-_]?-[ .\-_]?S(\d{1,2})/i,              // S01-S03 (range)
        /S(\d{1,2})(?!E)/i,                                     // Solo stagione S01
        /Season[ .\-_]?(\d{1,2})(?![ .\-_]?Episode)/i,          // Solo Season 1
    ];

    for (const pattern of seasonEpisodePatterns) {
        const match = filename.match(pattern);
        if (match) {
            if (match[1]) {
                result.seasons.push(parseInt(match[1], 10));
            }
            if (match[2]) {
                // Potrebbe essere episodio o seconda stagione (in range)
                const num = parseInt(match[2], 10);
                if (pattern.source.includes('x') || pattern.source.includes('E')) {
                    result.episodes.push(num);
                } else {
                    // È un range di stagioni
                    for (let s = parseInt(match[1], 10); s <= num; s++) {
                        if (!result.seasons.includes(s)) {
                            result.seasons.push(s);
                        }
                    }
                }
            }
            break; // Usa solo il primo match
        }
    }

    // 3. Estrai episodio assoluto per anime (es. "- 05", "E05", "Ep 5")
    if (result.episodes.length === 0 && result.seasons.length === 0) {
        const absEpPatterns = [
            /[ .\-_](\d{2,4})[ .\-_]?(?:v\d)?(?:[[(]|\b(?:720|1080|480|2160))/i, // - 05 720p
            /[ .\-_]E(\d{1,4})\b/i,                                               // E05
            /[ .\-_]Ep[ .\-_]?(\d{1,4})\b/i,                                      // Ep 5
        ];
        for (const pattern of absEpPatterns) {
            const match = filename.match(pattern);
            if (match) {
                result.episodes.push(parseInt(match[1], 10));
                break;
            }
        }
    }

    // 4. Estrai risoluzione
    result.resolution = matchPattern(filename, PARSE_REGEX.resolutions);

    // 5. Estrai qualità
    result.quality = matchPattern(filename, PARSE_REGEX.qualities);

    // 6. Estrai lingue (usando i regex AIOStreams che escludono "sub/subtitle")
    result.languages = matchMultiplePatterns(filename, PARSE_REGEX.languages);

    // 7. Estrai codec
    result.codec = matchPattern(filename, PARSE_REGEX.encodes);

    // 8. Estrai audio tags
    result.audioTags = matchMultiplePatterns(filename, PARSE_REGEX.audioTags);

    // 9. Estrai visual tags (HDR, DV, etc.)
    result.visualTags = matchMultiplePatterns(filename, PARSE_REGEX.visualTags);

    // 10. Estrai audio channels
    result.audioChannels = matchMultiplePatterns(filename, PARSE_REGEX.audioChannels);

    // 11. Estrai release group
    const groupMatch = filename.match(PARSE_REGEX.releaseGroup);
    if (groupMatch && groupMatch[1]) {
        result.group = groupMatch[1].trim();
    }

    // 12. Flag speciali
    result.complete = /\b(complete|completa|tutte)\b/i.test(filename);
    result.extended = /\b(extended|estesa)\b/i.test(filename);
    result.repack = /\b(repack)\b/i.test(filename);
    result.proper = /\b(proper)\b/i.test(filename);

    // 13. Estrai titolo (tutto prima dell'anno o della risoluzione)
    let titleEndIndex = filename.length;

    // Trova dove finisce il titolo
    const titleEndPatterns = [
        /[(. _\-](?:19|20)\d{2}[). _\-]/,           // Anno
        /[(. _\-]S\d{1,2}[). _\-E]/i,               // Stagione
        /[(. _\-]\d{1,2}x\d{1,3}[). _\-]/i,         // 1x05
        /[(. _\-](?:720|1080|480|2160|4k)p?[). _\-]/i, // Risoluzione
        /[(. _\-](?:HDTV|DVDRip|BluRay|WEB|REMUX)[). _\-]/i, // Qualità
    ];

    for (const pattern of titleEndPatterns) {
        const match = filename.match(pattern);
        if (match && match.index < titleEndIndex) {
            titleEndIndex = match.index;
        }
    }

    if (titleEndIndex > 0) {
        result.title = filename
            .substring(0, titleEndIndex)
            .replace(/\./g, ' ')
            .replace(/_/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    return result;
}

/**
 * Normalizza un titolo per confronto (come AIOStreams parser/utils.ts)
 */
function normaliseTitle(title) {
    if (!title) return '';
    return title
        .replace(/&/g, 'and')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')  // Rimuove accenti
        .replace(/[^\p{L}\p{N}+]/gu, '')  // Solo lettere e numeri
        .toLowerCase();
}

/**
 * Verifica se la stagione è sbagliata (come AIOStreams debrid/utils.ts)
 */
function isSeasonWrong(parsed, metadata) {
    if (!parsed.seasons?.length || !metadata?.season) return false;

    // Se la stagione richiesta non è nelle stagioni del torrent
    if (!parsed.seasons.includes(metadata.season)) {
        // Eccezione: se è stagione 1 con episodi assoluti corretti
        if (parsed.seasons.length === 1 && parsed.seasons[0] === 1
            && parsed.episodes?.length && metadata.absoluteEpisode
            && parsed.episodes.includes(metadata.absoluteEpisode)) {
            return false;
        }
        return true;
    }
    return false;
}

/**
 * Verifica se l'episodio è sbagliato (come AIOStreams debrid/utils.ts)
 */
function isEpisodeWrong(parsed, metadata) {
    if (!parsed.episodes?.length || !metadata?.episode) return false;

    // Controlla episodio normale o assoluto
    if (!parsed.episodes.includes(metadata.episode) &&
        !(metadata.absoluteEpisode && parsed.episodes.includes(metadata.absoluteEpisode))) {
        return true;
    }
    return false;
}

// ============================================================================
// ✅ AIOSTREAMS TITLE MATCHING (COPIA ESATTA)
// Fonte: packages/core/src/parser/utils.ts + packages/core/src/debrid/utils.ts
// ============================================================================

/**
 * AIOStreams titleMatch - usa fuzzball.extract() per fuzzy matching
 * @param {string} parsedTitle - Titolo normalizzato dal torrent
 * @param {string[]} titles - Array di titoli validi normalizzati
 * @param {object} options - { threshold: 0.8 }
 * @returns {boolean} true se matcha
 */
function titleMatch(parsedTitle, titles, options = { threshold: 0.8 }) {
    const { threshold } = options;

    // Usa fuzzball.extract per trovare la migliore corrispondenza
    const results = fuzzball.extract(parsedTitle, titles, { returnObjects: true });

    // Trova il punteggio più alto (fuzzball ritorna 0-100, noi usiamo 0-1)
    // Con returnObjects: true, il formato è { choice, score, key }
    const highestScore = results.reduce((max, result) => {
        const score = result.score !== undefined ? result.score : result[1]; // Supporta entrambi i formati
        return Math.max(max, score);
    }, 0) / 100;

    return highestScore >= threshold;
}

/**
 * AIOStreams preprocessTitle - preprocessa il titolo prima del matching
 * Fonte: packages/core/src/parser/utils.ts linea 27-62
 * Gestisce titoli con "/" o "|" (es: "Fuori / Outside" → "Fuori")
 * @param {string} parsedTitle - Titolo estratto dal parser
 * @param {string} filename - Nome file originale del torrent
 * @param {string[]} titles - Array di titoli validi dal metadata
 * @returns {string} Titolo preprocessato
 */
function preprocessTitle(parsedTitle, filename, titles) {
    let preprocessedTitle = parsedTitle;

    // Pattern per separatori (come AIOStreams)
    const separatorPatterns = [
        /\s*[\/\|]\s*/,                              // "/" o "|" con spazi
        /[\s\.\-\(]+a[\s\.]?k[\s\.]?a[\s\.\)\-]+/i, // "a.k.a.", "aka", etc.
        /\s*\(([^)]+)\)$/,                           // "(titolo alternativo)" alla fine
    ];

    for (const pattern of separatorPatterns) {
        const match = preprocessedTitle.match(pattern);

        if (match) {
            // Controlla se uno dei titoli validi contiene già questo separatore
            const hasExistingTitleWithSeparator = titles.some((title) =>
                pattern.test(title.toLowerCase())
            );

            if (!hasExistingTitleWithSeparator) {
                const parts = preprocessedTitle.split(pattern);
                if (parts.length > 1 && parts[0]?.trim()) {
                    const originalTitle = preprocessedTitle;
                    preprocessedTitle = parts[0].trim();
                    console.log(`[preprocessTitle] Titolo aggiornato da "${originalTitle}" a "${preprocessedTitle}"`);
                    break;
                }
            }
        }
    }

    // Gestione "Saga" come in AIOStreams
    if (
        titles.some((title) => title.toLowerCase().includes('saga')) &&
        filename?.toLowerCase().includes('saga') &&
        !preprocessedTitle.toLowerCase().includes('saga')
    ) {
        preprocessedTitle += ' Saga';
    }

    return preprocessedTitle;
}

/**
 * AIOStreams isTitleWrong - verifica se il titolo NON corrisponde
 * Fonte: packages/core/src/debrid/utils.ts linea 127-141
 * @param {object} parsed - { title: string }
 * @param {object} metadata - { titles: string[] }
 * @param {string} filename - Nome file originale del torrent (opzionale)
 * @returns {boolean} true se il titolo è SBAGLIATO
 */
function isTitleWrong(parsed, metadata, filename = '') {
    if (!parsed.title || !metadata?.titles?.length) return false;

    // Preprocessa il titolo prima del matching (gestisce "Fuori / Outside" → "Fuori")
    const preprocessedTitle = preprocessTitle(parsed.title, filename, metadata.titles);

    const normalisedParsed = normaliseTitle(preprocessedTitle);
    const normalisedTitles = metadata.titles.map(normaliseTitle);

    if (DEBUG_MODE) {
        console.log(`[isTitleWrong] Titolo originale: "${parsed.title}", preprocessato: "${preprocessedTitle}", normalizzato: "${normalisedParsed}"`);
        console.log(`[isTitleWrong] Titoli validi normalizzati: ${JSON.stringify(normalisedTitles.slice(0, 3))}...`);
    }

    // Se NON matcha nessun titolo con threshold 0.8, è sbagliato
    if (!titleMatch(normalisedParsed, normalisedTitles, { threshold: 0.8 })) {
        if (DEBUG_MODE) console.log(`[isTitleWrong] TITOLO SBAGLIATO: "${preprocessedTitle}" non matcha nessun titolo valido`);
        return true;
    }

    return false;
}

/**
 * Fallback per calcolare similarità senza fuzzball
 */
function calculateLevenshteinSimilarity(str1, str2) {
    if (str1 === str2) return 1.0;
    if (!str1 || !str2) return 0;

    const len1 = str1.length;
    const len2 = str2.length;

    const matrix = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));

    for (let i = 0; i <= len1; i++) matrix[i][0] = i;
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;

    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }

    const distance = matrix[len1][len2];
    const maxLen = Math.max(len1, len2);
    return 1 - (distance / maxLen);
}

function calculateSimilarity(str1, str2) {
    return calculateLevenshteinSimilarity(str1, str2);
}

// --- FINE SEZIONE TORRENT TITLE PARSER ---


// --- NUOVA SEZIONE: SCRAPER PER KNABEN.ORG (AIOStreams Style API) ---

const KNABEN_API_URL = "https://api.knaben.org";
const KNABEN_TIMEOUT_FIRST = 4000; // 4 second timeout for first attempt
const KNABEN_TIMEOUT_RETRY = 2000; // 2 second timeout for subsequent attempts
const KNABEN_API_VERSION = "1";

// TorrentGalaxy API configuration
const TORRENTGALAXY_API_URL = "https://torrentgalaxy.space";
const TORRENTGALAXY_TIMEOUT_FIRST = 4000; // 4 second timeout for first attempt
const TORRENTGALAXY_TIMEOUT_RETRY = 2000; // 2 second timeout for subsequent attempts

// UIndex configuration
const UINDEX_TIMEOUT_FIRST = 4000; // 4 second timeout for first attempt
const UINDEX_TIMEOUT_RETRY = 2000; // 2 second timeout for subsequent attempts

// Global circuit breaker for Knaben - resets every 30 seconds
let knabenTimeoutCount = 0;
let knabenCircuitBreakerUntil = 0;

// Global circuit breaker for TorrentGalaxy - resets every 30 seconds
let torrentGalaxyTimeoutCount = 0;
let torrentGalaxyCircuitBreakerUntil = 0;

// Global circuit breaker for UIndex - resets every 30 seconds
let uindexTimeoutCount = 0;
let uindexCircuitBreakerUntil = 0;

// Categorie Knaben
const KnabenCategory = {
    TV: 2000000,
    Movies: 3000000,
    Anime: 6000000,
    AnimeSubbed: 6001000,
    AnimeDubbed: 6002000,
    AnimeDualAudio: 6003000,
    AnimeRaw: 6004000,
    AnimeMusicVideo: 6005000,
    AnimeLiterature: 6006000,
    AnimeMusic: 6007000,
    AnimeNonEnglishTranslated: 6008000,
};

// Categorie da escludere (blacklist)
const KNABEN_BLACKLISTED_CATEGORIES = [
    KnabenCategory.AnimeLiterature,
    KnabenCategory.AnimeMusic,
    KnabenCategory.AnimeMusicVideo,
];

/**
 * Classe KnabenAPI - Implementazione identica a AIOStreams
 * POST https://api.knaben.org/1/
 */
class KnabenAPI {
    constructor() {
        this.headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json',
        };
    }

    /**
     * Ricerca su Knaben API
     * @param {Object} options - Opzioni di ricerca
     * @param {string} options.query - Query di ricerca
     * @param {string} [options.searchType='100%'] - Tipo di ricerca ('score' | 'XX%')
     * @param {string} [options.searchField='title'] - Campo di ricerca
     * @param {number[]} [options.categories] - Array di categorie da includere
     * @param {number} [options.size=300] - Numero massimo di risultati (max 300)
     * @param {boolean} [options.hideUnsafe=false] - Nascondi contenuti unsafe
     * @param {boolean} [options.hideXXX=true] - Nascondi contenuti XXX
     * @returns {Promise<{hits: Array, total: Object}>}
     */
    async search(options) {
        const {
            query,
            searchType = '100%',
            searchField = 'title',
            categories,
            size = 300,
            hideUnsafe = false,
            hideXXX = true,
            orderBy,
            orderDirection = 'desc',
            from = 0,
        } = options;

        // Costruisci il body della richiesta (come AIOStreams)
        const body = {
            query: query,
            search_type: searchType,
            search_field: searchField,
            size: Math.min(size, 300), // Max 300
            from: from,
            hide_unsafe: hideUnsafe,
            hide_xxx: hideXXX,
        };

        if (categories && categories.length > 0) {
            body.categories = categories;
        }

        if (orderBy) {
            body.order_by = orderBy;
            body.order_direction = orderDirection;
        }

        // ✅ FIX: Endpoint senza slash finale (altrimenti 404)
        const url = `${KNABEN_API_URL}/v${KNABEN_API_VERSION}`;

        // console.log(`🦉 [Knaben API] POST ${url}`);
        // console.log(`🦉 [Knaben API] Body: ${JSON.stringify(body)}`);

        try {
            // Add timeout using AbortController - shorter timeout after first failure
            const controller = new AbortController();
            const timeout = knabenTimeoutCount === 0 ? KNABEN_TIMEOUT_FIRST : KNABEN_TIMEOUT_RETRY;
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`Knaben API error (${response.status}): ${response.statusText}`);
            }

            const data = await response.json();

            // console.log(`🦉 [Knaben API] Response: ${data.hits?.length || 0} hits, total: ${data.total?.value || 0}`);

            return {
                hits: data.hits || [],
                total: data.total || { value: 0, relation: 'eq' },
                max_score: data.max_score || null,
            };
        } catch (error) {
            console.error(`❌ [Knaben API] Request failed:`, error.message);
            throw error;
        }
    }
}

// Istanza singleton della API
const knabenApi = new KnabenAPI();

/**
 * Costruisce le query di ricerca come AIOStreams
 * @param {Object} parsedId - ID parsato (con season/episode)
 * @param {Object} metadata - Metadati (title, year, titles)
 * @param {Object} options - Opzioni
 * @returns {string[]} Array di query
 */
function buildKnabenQueries(parsedId, metadata, options = {}) {
    const { addYear = true, addSeasonEpisode = true, useAllTitles = true } = options;

    const queries = [];

    if (!metadata.primaryTitle && !metadata.title) {
        return [];
    }

    // Usa tutti i titoli o solo il principale
    const titles = useAllTitles && metadata.titles && metadata.titles.length > 0
        ? metadata.titles.slice(0, 3) // Max 3 titoli come AIOStreams
        : [metadata.primaryTitle || metadata.title];

    for (const title of titles) {
        if (!title) continue;

        // Pulisci il titolo
        const cleanedTitle = title
            .replace(/[^\p{L}\p{N}\s.-]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (parsedId.mediaType === 'movie' || !addSeasonEpisode) {
            // Film: aggiunge anno
            if (metadata.year && addYear) {
                queries.push(`${cleanedTitle} ${metadata.year}`);
            }
            queries.push(cleanedTitle);
        } else {
            // Serie: aggiunge S01E05
            if (parsedId.season && parsedId.episode) {
                const s = parsedId.season.toString().padStart(2, '0');
                const e = parsedId.episode.toString().padStart(2, '0');
                queries.push(`${cleanedTitle} S${s}E${e}`);
            }

            // Anche solo stagione: "Title S01"
            if (parsedId.season) {
                const s = parsedId.season.toString().padStart(2, '0');
                queries.push(`${cleanedTitle} S${s}`);
            }

            // Per anime: episodio assoluto "Title 05"
            if (metadata.absoluteEpisode) {
                const absEp = metadata.absoluteEpisode.toString().padStart(2, '0');
                queries.push(`${cleanedTitle} ${absEp}`);
            }
        }
    }

    // Deduplica
    return [...new Set(queries)];
}

/**
 * Cerca su Knaben usando l'API (stile AIOStreams)
 * @param {string} searchQuery - Query di ricerca
 * @param {string} type - Tipo: 'movie', 'series', 'anime'
 * @param {Object} metadata - Metadati opzionali (per costruire query multiple)
 * @param {Object} parsedId - ID parsato opzionale (per season/episode)
 * @returns {Promise<Array>} Array di risultati
 */
async function fetchKnabenData(searchQuery, type = 'movie', metadata = null, parsedId = null) {
    // Global circuit breaker check - if Knaben has failed too many times, skip
    if (Date.now() < knabenCircuitBreakerUntil) {
        console.log(`⚠️ [Knaben API] Circuit breaker active - skipping search for "${searchQuery}"`);
        return [];
    }

    console.log(`🦉 [Knaben API] Starting search for: "${searchQuery}" (type: ${type})`);

    // Determina le categorie in base al tipo
    const categories = [];
    if (type === 'movie') {
        categories.push(KnabenCategory.Movies);
    }
    if (type === 'series') {
        categories.push(KnabenCategory.TV);
    }
    if (type === 'anime') {
        categories.push(KnabenCategory.Anime, KnabenCategory.TV);
    }

    // Costruisci le query
    let queries = [];

    if (metadata && parsedId) {
        // Usa la logica AIOStreams per costruire query multiple
        queries = buildKnabenQueries(parsedId, metadata, {
            addYear: true,
            addSeasonEpisode: true,
            useAllTitles: true,
        });
        console.log(`🦉 [Knaben API] Built ${queries.length} queries from metadata: ${queries.join(', ')}`);
    }

    // Fallback alla query originale se non abbiamo metadata
    if (queries.length === 0) {
        const cleanedQuery = searchQuery
            .replace(/[^\p{L}\p{N}\s.-]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (cleanedQuery) {
            queries.push(cleanedQuery);
        }
    }

    if (queries.length === 0) {
        console.log('🦉 [Knaben API] No valid queries, skipping search.');
        return [];
    }

    const allHits = [];
    const seenHashes = new Set();

    // Prepara metadata per validazione (come AIOStreams)
    const validationMetadata = metadata ? {
        titles: metadata.titles || [metadata.title, metadata.primaryTitle].filter(Boolean),
        year: metadata.year,
        season: parsedId?.season ? parseInt(parsedId.season, 10) : undefined,
        episode: parsedId?.episode ? parseInt(parsedId.episode, 10) : undefined,
        absoluteEpisode: metadata.absoluteEpisode,
    } : null;

    // Esegui ricerche per ogni query
    for (const query of queries) {
        try {
            // console.log(`🦉 [Knaben API] Searching: "${query}"`);

            const { hits } = await knabenApi.search({
                query,
                categories: categories.length > 0 ? categories : undefined,
                size: 300,
                hideUnsafe: false,
                hideXXX: true,
            });

            // Filtra e deduplica
            for (const hit of hits) {
                // Salta categorie blacklistate
                if (hit.categoryId && KNABEN_BLACKLISTED_CATEGORIES.some(cat => hit.categoryId.includes(cat))) {
                    continue;
                }

                // Estrai hash (come AIOStreams: usa hash, magnetUrl, o link)
                let hash = hit.hash?.toLowerCase() ||
                    (hit.magnetUrl ? extractInfoHash(hit.magnetUrl)?.toLowerCase() : null);

                // ✅ COME AIOSTREAMS: Se non ha hash, prova a usare il link per scaricare il torrent
                const hasDownloadUrl = !!hit.link;

                if (!hash && !hasDownloadUrl) {
                    console.log(`🦉 [Knaben API] Skipping hit without hash or link: ${hit.title}`);
                    continue;
                }

                // Se ha link ma non hash, generiamo un hash temporaneo dal link per deduplicazione
                // L'hash reale verrà estratto quando si usa il torrent
                const dedupeKey = hash || hit.link;

                // Deduplica per hash o link
                if (seenHashes.has(dedupeKey)) {
                    continue;
                }
                seenHashes.add(dedupeKey);

                // Filtro contenuti per adulti
                if (isAdultCategory(hit.category) || isAdultCategory(hit.title)) {
                    continue;
                }

                // ✅ NUOVO: Parsing del titolo come AIOStreams
                const parsedTitle = parseTorrentTitle(hit.title);

                // ✅ FILTRO ITALIANO: Accetta solo italiano, sub-ita, multi
                const hasItalian = parsedTitle.languages.includes('Italian');
                const hasMulti = parsedTitle.languages.includes('Multi') || parsedTitle.languages.includes('Dual Audio');
                if (!hasItalian && !hasMulti) {
                    // Fallback: controlla anche con regex diretta per casi edge
                    if (!hit.hash || !hit.link) {
                        // console.log(`🦉 [Knaben API] Skipping hit without hash or link: ${hit.title}`);
                        continue;
                    }

                    // Strict Italian Filter
                    if (!isItalian(hit.title)) {
                        // console.log(`🦉 [Knaben API] Skipping non-Italian: "${hit.title.substring(0, 60)}..."`);
                        continue;
                    }

                    // Validate title fuzzily
                    const validation = validateResult(hit.title, validationMetadata);
                    if (!validation.match) {
                        // console.log(`🦉 [Knaben API] Skipping wrong title: "${hit.title.substring(0, 60)}..."`);
                        continue;
                    }

                    if (type === 'series' && validationMetadata) {
                        if (validation.season && validation.season !== validationMetadata.season) {
                            // console.log(`🦉 [Knaben API] Skipping wrong season: "${hit.title}" (need S${validationMetadata.season})`);
                            continue;
                        }
                        if (validation.episode && validation.episode !== validationMetadata.episode) {
                            // console.log(`🦉 [Knaben API] Skipping wrong episode: "${hit.title}" (need E${validationMetadata.episode})`);
                            continue;
                        }
                    }
                }

                const sizeInBytes = hit.bytes || 0;
                const sizeStr = formatBytes(sizeInBytes);

                // ✅ NUOVO: Usa i dati dal parser invece di extractQuality
                const quality = parsedTitle.resolution || parsedTitle.quality || extractQuality(hit.title);

                // ✅ COME AIOSTREAMS: Costruisci magnet link o usa download URL
                let magnetLink = hit.magnetUrl;
                if (!magnetLink && hash) {
                    magnetLink = `magnet:?xt=urn:btih:${hash}`;
                }

                allHits.push({
                    magnetLink: magnetLink || null,
                    downloadUrl: hit.link || null, // ✅ NUOVO: URL download torrent file
                    websiteTitle: hit.title,
                    title: hit.title,
                    filename: hit.title,
                    quality: quality,
                    size: sizeStr,
                    source: `Knaben (${hit.tracker || 'Unknown'})`,
                    seeders: hit.seeders || 0,
                    leechers: hit.peers || 0,
                    infoHash: hash ? hash.toUpperCase() : null, // ✅ Può essere null se solo link
                    mainFileSize: sizeInBytes,
                    pubDate: hit.date || new Date().toISOString(),
                    categories: [hit.category || (type === 'movie' ? 'Movies' : 'TV')],
                    indexer: hit.tracker,
                    // ✅ NUOVO: Aggiungi dati dal parser
                    parsedInfo: {
                        resolution: parsedTitle.resolution,
                        qualitySource: parsedTitle.quality,
                        languages: parsedTitle.languages,
                        codec: parsedTitle.codec,
                        audioTags: parsedTitle.audioTags,
                        visualTags: parsedTitle.visualTags,
                        group: parsedTitle.group,
                        seasons: parsedTitle.seasons,
                        episodes: parsedTitle.episodes,
                    },
                });
            }

            // Piccola pausa tra le query per non sovraccaricare l'API
            if (queries.indexOf(query) < queries.length - 1) {
                await new Promise(r => setTimeout(r, 100));
            }

        } catch (error) {
            console.error(`❌ [Knaben API] Query "${query}" failed:`, error.message);
            // Circuit breaker: if timeout/abort, increment global counter
            if (error.name === 'AbortError' || error.message.includes('aborted')) {
                knabenTimeoutCount++;
                console.warn(`⚠️ [Knaben API] Timeout #${knabenTimeoutCount} - skipping remaining queries`);

                // After 2 timeouts, activate circuit breaker for 30 seconds
                if (knabenTimeoutCount >= 2) {
                    knabenCircuitBreakerUntil = Date.now() + 30000; // 30 seconds
                    console.warn(`🔴 [Knaben API] Circuit breaker ACTIVATED - Knaben disabled for 30 seconds`);
                }
                break;
            }
        }
    }

    console.log(`🦉 [Knaben API] Search completed. Found ${allHits.length} unique results.`);
    return allHits;
}

// --- FINE NUOVA SEZIONE KNABEN ---

// --- NUOVA SEZIONE: TORRENTGALAXY API ---

/**
 * TorrentGalaxy Category mapping
 */
const TorrentGalaxyCategory = {
    Movies: 'Movies',
    TV: 'TV',
    Anime: 'Anime'
};

/**
 * Cerca su TorrentGalaxy usando l'API JSON
 * @param {string} searchQuery - Query di ricerca
 * @param {string} type - Tipo: 'movie', 'series', 'anime'
 * @param {Object} metadata - Metadati opzionali
 * @param {Object} parsedId - ID parsato opzionale (per season/episode)
 * @returns {Promise<Array>} Array di risultati
 */
async function fetchTorrentGalaxyData(searchQuery, type = 'movie', metadata = null, parsedId = null) {
    // Global circuit breaker check
    if (Date.now() < torrentGalaxyCircuitBreakerUntil) {
        console.log(`⚠️ [TorrentGalaxy] Circuit breaker active - skipping search for "${searchQuery}"`);
        return [];
    }

    console.log(`🌌 [TorrentGalaxy] Starting search for: "${searchQuery}" (type: ${type})`);

    const allResults = [];
    const seenHashes = new Set();

    // Build queries based on metadata (similar to Knaben)
    const queries = [];

    if (metadata && (type === 'series' || type === 'anime')) {
        const title = metadata.primaryTitle || metadata.title || searchQuery;
        const season = parsedId?.season || metadata.season;
        const episode = parsedId?.episode || metadata.episode;

        if (season && episode) {
            const s = season.toString().padStart(2, '0');
            const e = episode.toString().padStart(2, '0');
            queries.push(`${title} S${s}E${e}`);
            queries.push(`${title} S${s}`);
        } else if (season) {
            const s = season.toString().padStart(2, '0');
            queries.push(`${title} S${s}`);
        }
        queries.push(title);
    } else {
        queries.push(searchQuery);
    }

    // Deduplicate queries
    const uniqueQueries = [...new Set(queries)];
    console.log(`🌌 [TorrentGalaxy] Built ${uniqueQueries.length} queries: ${uniqueQueries.join(', ')}`);

    for (const query of uniqueQueries) {
        // Check circuit breaker before each query
        if (Date.now() < torrentGalaxyCircuitBreakerUntil) {
            console.log(`⚠️ [TorrentGalaxy] Circuit breaker active - skipping remaining queries`);
            break;
        }

        try {
            // Add timeout using AbortController - shorter timeout after first failure
            const controller = new AbortController();
            const timeout = torrentGalaxyTimeoutCount === 0 ? TORRENTGALAXY_TIMEOUT_FIRST : TORRENTGALAXY_TIMEOUT_RETRY;
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            const encodedQuery = encodeURIComponent(query);
            const url = `${TORRENTGALAXY_API_URL}/get-posts/keywords:${encodedQuery}:format:json`;

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json'
                },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`TorrentGalaxy API error (${response.status}): ${response.statusText}`);
            }

            const data = await response.json();

            if (data && data.results && Array.isArray(data.results)) {
                // Reset timeout count on success
                torrentGalaxyTimeoutCount = 0;

                for (const item of data.results) {
                    const hash = (item.h || '').toLowerCase();
                    if (!hash || seenHashes.has(hash)) continue;
                    seenHashes.add(hash);

                    // Filter by category based on type
                    const category = item.c || '';
                    if (type === 'movie' && category !== TorrentGalaxyCategory.Movies) continue;
                    if (type === 'series' && category !== TorrentGalaxyCategory.TV) continue;
                    if (type === 'anime' && category !== TorrentGalaxyCategory.Anime && category !== TorrentGalaxyCategory.TV) continue;

                    // ✅ ITALIAN FILTER: Same as Knaben - only accept Italian/Multi content
                    const torrentTitle = item.n || '';
                    if (!isItalian(torrentTitle)) {
                        // Skip non-Italian content
                        continue;
                    }

                    // Convert bytes to human-readable size
                    const sizeBytes = parseInt(item.s) || 0;
                    let sizeStr = '0 B';
                    if (sizeBytes >= 1024 * 1024 * 1024) {
                        sizeStr = (sizeBytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
                    } else if (sizeBytes >= 1024 * 1024) {
                        sizeStr = (sizeBytes / (1024 * 1024)).toFixed(2) + ' MB';
                    } else if (sizeBytes >= 1024) {
                        sizeStr = (sizeBytes / 1024).toFixed(2) + ' KB';
                    } else {
                        sizeStr = sizeBytes + ' B';
                    }

                    // Map to standard format
                    allResults.push({
                        title: item.n || 'Unknown',
                        infoHash: hash,
                        seeders: parseInt(item.se) || 0,
                        leechers: parseInt(item.le) || 0,
                        size: sizeStr,
                        quality: extractQuality(item.n || ''),  // ✅ Add quality extraction
                        imdbId: item.i || null,
                        category: category,
                        source: 'TorrentGalaxy',
                        magnetLink: `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(item.n || '')}&tr=udp://tracker.opentrackr.org:1337/announce`
                    });
                }
                console.log(`🌌 [TorrentGalaxy] Query "${query}" returned ${data.results.length} results, ${allResults.length} total unique`);
            }

        } catch (error) {
            console.error(`❌ [TorrentGalaxy] Query "${query}" failed:`, error.message);
            // Circuit breaker: if timeout/abort, increment global counter
            if (error.name === 'AbortError' || error.message.includes('aborted')) {
                torrentGalaxyTimeoutCount++;
                console.warn(`⚠️ [TorrentGalaxy] Timeout #${torrentGalaxyTimeoutCount} - skipping remaining queries`);

                // After 2 timeouts, activate circuit breaker for 30 seconds
                if (torrentGalaxyTimeoutCount >= 2) {
                    torrentGalaxyCircuitBreakerUntil = Date.now() + 30000; // 30 seconds
                    console.warn(`🔴 [TorrentGalaxy] Circuit breaker ACTIVATED - TorrentGalaxy disabled for 30 seconds`);
                }
                break;
            }
        }
    }

    console.log(`🌌 [TorrentGalaxy] Search completed. Found ${allResults.length} unique results.`);
    return allResults;
}

// --- FINE NUOVA SEZIONE TORRENTGALAXY ---

// --- NUOVA SEZIONE: JACKETTIO INTEGRATION ---

class Jackettio {
    constructor(baseUrl, apiKey, password = null) {
        // Use Torznab endpoint like the reference code
        this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
        this.apiKey = apiKey;
        this.password = password; // Optional password for authenticated instances
    }

    async search(query, category = null, italianOnly = false) {
        if (!query) return [];

        try {
            // Use Torznab API endpoint as per reference code
            // Format: /api/v2.0/indexers/all/results/torznab/api
            const torznabUrl = `${this.baseUrl}/api/v2.0/indexers/all/results/torznab/api`;

            const params = new URLSearchParams({
                apikey: this.apiKey,
                t: 'search', // Torznab search type
                q: query,
                limit: '100', // Request more results
                extended: '1' // Get extended attributes
            });

            // Add category if specified (Torznab format)
            if (category) {
                params.append('cat', category);
            }

            const url = `${torznabUrl}?${params}`;

            console.log(`🔍 [Jackettio] Torznab search for: "${query}" (category: ${category || 'all'}) ${italianOnly ? '[ITALIAN ONLY]' : ''}`);

            const headers = {
                'User-Agent': 'ilcorsaroviola/2.0',
                'Accept': 'application/json, application/xml, text/xml'
            };

            // Add password if provided (for authenticated instances)
            if (this.password) {
                headers['Authorization'] = `Basic ${btoa(`api:${this.password}`)}`;
            }

            const response = await fetch(url, { headers });

            if (!response.ok) {
                console.error(`❌ [Jackettio] API error: ${response.status} ${response.statusText}`);
                const errorText = await response.text().catch(() => 'Unable to read error');
                console.error(`❌ [Jackettio] Error response: ${errorText.substring(0, 500)}`);
                throw new Error(`Jackettio API error: ${response.status}`);
            }

            const contentType = response.headers.get('content-type') || '';
            let results = [];

            // Jackett can return JSON or XML depending on configuration
            if (contentType.includes('application/json')) {
                const data = await response.json();
                results = data.Results || [];
            } else {
                // Parse XML response (Torznab default)
                const xmlText = await response.text();
                results = this.parseXmlResults(xmlText);
            }

            if (results.length === 0) {
                console.log('🔍 [Jackettio] No results found.');
                return [];
            }

            console.log(`🔍 [Jackettio] Found ${results.length} raw results.`);

            // Parse Jackett results to our standard format
            const streams = results.map(result => {
                // Jackett può restituire sia magnet che torrent file
                let magnetLink = result.MagnetUri || result.magneturl || result.Link;

                // Se è un .torrent file, prova a estrarre l'hash
                if (!magnetLink || !magnetLink.startsWith('magnet:')) {
                    console.log(`⚠️ [Jackettio] Skipping non-magnet result: ${result.Title || result.title || 'Unknown'}`);
                    return null;
                }

                const title = result.Title || result.title || '';
                const infoHash = extractInfoHash(magnetLink);
                if (!infoHash) {
                    console.log(`⚠️ [Jackettio] Failed to extract hash from: ${title}`);
                    return null;
                }

                // ✅ FILTER: Italian only check
                if (italianOnly && !isItalian(title)) {
                    console.log(`🚫 [Jackettio] Skipping non-Italian: ${title}`);
                    return null;
                }

                // Parse seeders/peers
                const seeders = result.Seeders || result.seeders || 0;
                const leechers = result.Peers || result.peers || 0;

                // Parse size
                const sizeInBytes = result.Size || result.size || 0;
                const sizeStr = formatBytes(sizeInBytes);

                // Determine category
                let outputCategory = 'Unknown';
                const categoryDesc = (result.CategoryDesc || result.category || '').toLowerCase();
                if (categoryDesc.includes('movie')) {
                    outputCategory = 'Movies';
                } else if (categoryDesc.includes('tv') || categoryDesc.includes('series')) {
                    outputCategory = 'TV';
                } else if (categoryDesc.includes('anime')) {
                    outputCategory = 'Anime';
                }

                return {
                    magnetLink: magnetLink,
                    websiteTitle: title,
                    title: title,
                    filename: title,
                    quality: extractQuality(title),
                    size: sizeStr,
                    source: 'Jackettio',
                    seeders: seeders,
                    leechers: leechers,
                    infoHash: infoHash,
                    mainFileSize: sizeInBytes,
                    pubDate: result.PublishDate || result.publishDate || new Date().toISOString(),
                    categories: [outputCategory]
                };
            }).filter(Boolean);

            console.log(`🔍 [Jackettio] Successfully parsed ${streams.length} ${italianOnly ? 'ITALIAN ' : ''}streams.`);
            return streams;

        } catch (error) {
            console.error(`❌ [Jackettio] Search failed:`, error.message);
            return [];
        }
    }

    // Parse XML response from Torznab API
    parseXmlResults(xmlText) {
        try {
            const $ = cheerio.load(xmlText, { xmlMode: true });
            const items = [];

            $('item').each((i, elem) => {
                const $item = $(elem);
                const $enclosure = $item.find('enclosure').first();

                const result = {
                    Title: $item.find('title').text(),
                    Link: $item.find('link').text(),
                    Size: parseInt($enclosure.attr('length')) || 0,
                    PublishDate: $item.find('pubDate').text(),
                    CategoryDesc: $item.find('category').text(),
                };

                // Extract torznab attributes
                $item.find('torznab\\:attr, attr').each((j, attr) => {
                    const $attr = $(attr);
                    const name = $attr.attr('name');
                    const value = $attr.attr('value');

                    if (name === 'magneturl') result.MagnetUri = value;
                    if (name === 'seeders') result.Seeders = parseInt(value) || 0;
                    if (name === 'peers') result.Peers = parseInt(value) || 0;
                    if (name === 'size') result.Size = parseInt(value) || result.Size;
                });

                items.push(result);
            });

            console.log(`🔍 [Jackettio] Parsed ${items.length} items from XML`);
            return items;
        } catch (error) {
            console.error('❌ [Jackettio] XML parsing failed:', error.message);
            return [];
        }
    }
}

async function fetchJackettioData(searchQuery, type = 'movie', jackettioInstance = null) {
    if (!jackettioInstance) {
        console.log('⚠️ [Jackettio] Instance not configured, skipping.');
        return [];
    }

    try {
        // Map type to Jackett category codes
        let category = null;
        if (type === 'movie') {
            category = '2000'; // Movies
        } else if (type === 'series') {
            category = '5000'; // TV
        } else if (type === 'anime') {
            category = '5070'; // TV/Anime
        }

        // ✅ ONLY ITALIAN RESULTS
        const results = await jackettioInstance.search(searchQuery, category, true);
        return results;

    } catch (error) {
        console.error(`❌ Error in fetchJackettioData:`, error);
        return [];
    }
}

// --- FINE NUOVA SEZIONE ---

// ✅ Advanced HTML Parsing (inspired by JSDOM approach in uiai.js)
function parseUIndexHTML(html) {
    const results = [];

    // Split by table rows and filter for torrent rows
    const rows = html.split(/<tr[^>]*>/gi).filter(row =>
        row.includes('magnet:?xt=urn:btih:') &&
        row.includes('<td')
    );

    console.log(`📊 Processing ${rows.length} potential torrent rows`);

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        try {
            // Extract magnet link with better regex
            const magnetMatch = row.match(/href=["'](magnet:\?xt=urn:btih:[^"']+)["']/i);
            if (!magnetMatch) continue;

            let magnetLink = decodeHtmlEntities(magnetMatch[1]);

            // Parse table cells more reliably
            const cellRegex = /<td[^>]*>(.*?)<\/td>/gis;
            const cells = [];
            let cellMatch;

            while ((cellMatch = cellRegex.exec(row)) !== null) {
                cells.push(cellMatch[1].trim());
            }

            if (cells.length < 3) continue;

            // Extract title - try multiple patterns
            let title = "";
            const titleCell = cells[1] || "";

            // Pattern 1: details.php link
            const detailsMatch = titleCell.match(/<a[^>]*href=["']\/details\.php[^"']*["'][^>]*>([^<]+)<\/a>/i);
            if (detailsMatch) {
                title = detailsMatch[1].trim();
            } else {
                // Pattern 2: Second anchor tag
                const anchors = titleCell.match(/<a[^>]*>([^<]+)<\/a>/gi);
                if (anchors && anchors.length >= 2) {
                    const secondAnchor = anchors[1].match(/>([^<]+)</);
                    if (secondAnchor) title = secondAnchor[1].trim();
                } else if (anchors && anchors.length === 1) {
                    const singleAnchor = anchors[0].match(/>([^<]+)</);
                    if (singleAnchor) title = singleAnchor[1].trim();
                }
            }

            // Clean title
            title = decodeHtmlEntities(title);

            // Extract size from third cell
            let sizeStr = "Unknown";
            const sizeCell = cells[2] || "";
            const sizeMatch = sizeCell.match(/([\d.,]+\s*(?:B|KB|MB|GB|TB|KiB|MiB|GiB|TiB))/i);
            if (sizeMatch) {
                sizeStr = sizeMatch[1].trim();
            }

            // Extract category
            let category = "Unknown";
            const categoryCell = cells[0] || "";
            const categoryMatch = categoryCell.match(/<a[^>]*>([^<]+)<\/a>/i);
            if (categoryMatch) {
                category = decodeHtmlEntities(categoryMatch[1].trim());
            }

            // Extract seeders/leechers if available (usually in later cells)
            let seeders = 0, leechers = 0;
            if (cells.length > 4) {
                const seedMatch = cells[4]?.match(/(\d+)/);
                if (seedMatch) seeders = parseInt(seedMatch[1]);
            }
            if (cells.length > 5) {
                const leechMatch = cells[5]?.match(/(\d+)/);
                if (leechMatch) leechers = parseInt(leechMatch[1]);
            }

            // Skip if essential data is missing
            if (!title || title.length < 3 || !magnetLink) continue;

            const sizeInBytes = parseSize(sizeStr);
            const infoHash = extractInfoHash(magnetLink);

            if (!infoHash) {
                console.log(`⚠️ Skipping result without valid info hash: ${title}`);
                continue;
            }

            results.push({
                magnetLink,
                title,
                size: sizeStr,
                category,
                quality: extractQuality(title),
                infoHash,
                seeders,
                leechers,
                sizeInBytes,
                source: 'UIndex'
            });

            console.log(`✅ Parsed: ${title} (${sizeStr}) - ${infoHash}`);

        } catch (error) {
            console.error(`❌ Error parsing row ${i}:`, error.message);
            continue;
        }
    }

    console.log(`📊 Successfully parsed ${results.length} torrents`);
    return results;
}

// ✅ Multi-Strategy Search (try different query variations)
async function searchUIndexMultiStrategy(originalQuery, type = 'movie', validationMetadata = null) {
    const searchStrategies = [];

    // Strategy 1: Original query
    const cleanedOriginal = cleanSearchQuery(originalQuery);
    if (cleanedOriginal) {
        searchStrategies.push({
            query: cleanedOriginal,
            description: 'Original cleaned'
        });
    }

    // Strategy 2: Remove extra words for movies
    if (type === 'movie') {
        const simplified = cleanedOriginal?.replace(/\b(movie|film|dvd|bluray|bd)\b/gi, '').trim();
        if (simplified && simplified !== cleanedOriginal) {
            searchStrategies.push({
                query: simplified,
                description: 'Simplified movie'
            });
        }
    }

    // Strategy 3: For series, try alternative episode format
    if (type === 'series' && originalQuery.includes('S') && originalQuery.includes('E')) {
        const altFormat = originalQuery.replace(/S(\d+)E(\d+)/i, '$1x$2');
        if (altFormat !== originalQuery) {
            searchStrategies.push({
                query: cleanSearchQuery(altFormat),
                description: 'Alternative episode format'
            });
        }
    }

    let allResults = [];
    const seenHashes = new Set();

    for (const strategy of searchStrategies) {
        if (!strategy.query) continue;

        console.log(`🔍 Trying strategy: ${strategy.description} - "${strategy.query}"`);

        try {
            const results = await fetchUIndexSingle(strategy.query, type, validationMetadata);

            // Deduplicate by info hash
            const newResults = results.filter(result => {
                if (!result.infoHash || seenHashes.has(result.infoHash)) return false;
                seenHashes.add(result.infoHash);
                return true;
            });

            console.log(`📊 Strategy "${strategy.description}" found ${newResults.length} unique results`);
            allResults.push(...newResults);

            // If we got good results, don't try too many more strategies
            if (allResults.length >= 20) break;

        } catch (error) {
            console.error(`❌ Strategy "${strategy.description}" failed:`, error.message);
            continue;
        }

        // Delay between strategies to avoid rate limiting (429 errors)
        await new Promise(resolve => setTimeout(resolve, 400));
    }

    console.log(`🎉 Multi-strategy search found ${allResults.length} total unique results`);
    return allResults;
}

// ✅ Single UIndex Search with Enhanced Error Handling
async function fetchUIndexSingle(searchQuery, type = 'movie', validationMetadata = null) {
    // Global circuit breaker check for UIndex
    if (Date.now() < uindexCircuitBreakerUntil) {
        console.log(`⚠️ [UIndex] Circuit breaker active - skipping search for "${searchQuery}"`);
        return [];
    }

    try {
        console.log(`🔍 Searching UIndex for: "${searchQuery}" (type: ${type})`);

        let category = 0; // Default to 'All'
        if (type === 'movie') {
            category = 1; // Movie category
        } else if (type === 'series') {
            category = 2; // TV category
        } else if (type === 'anime') {
            category = 7; // Anime category
        }

        const searchUrl = `https://uindex.org/search.php?search=${encodeURIComponent(searchQuery)}&c=${category}`;

        // Add timeout using AbortController - shorter timeout after first failure
        const controller = new AbortController();
        const timeout = uindexTimeoutCount === 0 ? UINDEX_TIMEOUT_FIRST : UINDEX_TIMEOUT_RETRY;
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Cache-Control': 'no-cache'
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        // Reset timeout count on successful response
        uindexTimeoutCount = 0;

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const html = await response.text();

        // Basic validation
        if (!html.includes('<table') || !html.includes('magnet:')) {
            console.log('⚠️ Page doesn\'t contain expected torrent table');
            return [];
        }

        const rawResults = parseUIndexHTML(html);

        // ✅ NUOVO: Applica parsing AIOStreams e filtri a ogni risultato
        const filteredResults = [];
        for (const result of rawResults) {
            // Parsing del titolo
            const parsedTitle = parseTorrentTitle(result.title);
            result.parsedInfo = parsedTitle;

            // ✅ FILTRO ITALIANO: Accetta solo italiano, sub-ita, multi
            const hasItalian = parsedTitle.languages.includes('Italian');
            const hasMulti = parsedTitle.languages.includes('Multi') || parsedTitle.languages.includes('Dual Audio');
            if (!hasItalian && !hasMulti) {
                // Fallback: controlla anche con regex diretta per casi edge
                const italianFallback = /\b(ita|italian|sub[.\s\-_]?ita|subita|ita[.\s\-_]?sub)\b/i.test(result.title);
                const multiFallback = /\b(multi|dual[.\s\-_]?audio)\b/i.test(result.title);
                if (!italianFallback && !multiFallback) {
                    if (DEBUG_MODE) console.log(`🔍 [UIndex] Skipping non-Italian: "${result.title.substring(0, 60)}..."`);
                    continue;
                }
            }

            // ✅ NUOVO: Validazione titolo come AIOStreams
            if (validationMetadata && isTitleWrong(parsedTitle, validationMetadata, result.title)) {
                if (DEBUG_MODE) console.log(`🔍 [UIndex] Skipping wrong title: "${result.title.substring(0, 60)}..."`);
                continue;
            }

            // ✅ Per serie/anime, verifica stagione/episodio
            if (validationMetadata && type !== 'movie') {
                if (isSeasonWrong(parsedTitle, validationMetadata)) {
                    if (DEBUG_MODE) console.log(`🔍 [UIndex] Skipping wrong season: "${result.title}" (need S${validationMetadata.season})`);
                    continue;
                }
                if (isEpisodeWrong(parsedTitle, validationMetadata)) {
                    if (DEBUG_MODE) console.log(`🔍 [UIndex] Skipping wrong episode: "${result.title}" (need E${validationMetadata.episode})`);
                    continue;
                }
            }

            // ✅ Migliora quality detection usando il parser
            if (!result.quality && parsedTitle.resolution) {
                result.quality = parsedTitle.resolution.toLowerCase();
            }

            filteredResults.push(result);
        }

        console.log(`🔍 [UIndex] Filtered to ${filteredResults.length}/${rawResults.length} Italian results`);
        return filteredResults;

    } catch (error) {
        console.error(`❌ Error fetching from UIndex:`, error.message);

        // Circuit breaker: if timeout/abort, increment global counter
        if (error.name === 'AbortError' || error.message.includes('aborted')) {
            uindexTimeoutCount++;
            console.warn(`⚠️ [UIndex] Timeout #${uindexTimeoutCount}`);

            // After 2 timeouts, activate circuit breaker for 30 seconds
            if (uindexTimeoutCount >= 2) {
                uindexCircuitBreakerUntil = Date.now() + 30000; // 30 seconds
                console.warn(`🔴 [UIndex] Circuit breaker ACTIVATED - UIndex disabled for 30 seconds`);
            }
        }

        return [];
    }
}

// ✅ Enhanced Result Processing and Sorting
function processAndSortResults(results, italianTitle = null) {
    // Filter out invalid results
    const validResults = results.filter(result =>
        result.title &&
        result.title.length > 3 &&
        result.infoHash &&
        result.infoHash.length >= 32
    );

    // Sort by Italian, then quality, then by size, then by seeders
    validResults.sort((a, b) => {
        // ✅ MODIFICA: Usa la nuova logica unificata
        const aLang = getLanguageInfo(a.title, italianTitle, a.source);
        const bLang = getLanguageInfo(b.title, italianTitle, b.source);

        if (aLang.isItalian !== bLang.isItalian) return aLang.isItalian ? -1 : 1;
        if (aLang.isMulti !== bLang.isMulti) return aLang.isMulti ? -1 : 1;
        const qualityOrder = {
            '2160p': 6, '4k': 6, 'uhd': 6,
            'remux': 5,
            '1080p': 4,
            '720p': 3,
            'webrip': 2,
            '480p': 1,
            'cam': 0, 'ts': 0, 'tc': 0
        };

        const qualityDiff = (qualityOrder[b.quality] || 0) - (qualityOrder[a.quality] || 0);
        if (qualityDiff !== 0) return qualityDiff;

        // Then by file size
        const sizeDiff = (b.sizeInBytes || 0) - (a.sizeInBytes || 0);
        if (sizeDiff !== 0) return sizeDiff;

        // Finally by seeders
        return (b.seeders || 0) - (a.seeders || 0);
    });

    return validResults;
}

// ✅ Sorting by Quality and Seeders
function sortByQualityAndSeeders(results) {
    results.sort((a, b) => {
        const qualityOrder = {
            '2160p': 6, '4k': 6, 'uhd': 6,
            'remux': 5,
            '1080p': 4,
            '720p': 3,
            'webrip': 2,
            '480p': 1,
            'cam': 0, 'ts': 0, 'tc': 0
        };

        const qualityDiff = (qualityOrder[b.quality] || 0) - (qualityOrder[a.quality] || 0);
        if (qualityDiff !== 0) return qualityDiff;

        // Finally by seeders
        return (b.seeders || 0) - (a.seeders || 0);
    });
    return results;
}

function limitResultsByResolution(streams, limit) {
    if (!limit || limit <= 0) return streams;

    console.log(`✂️ START LIMIT: ${streams.length} streams, limit=${limit}`);

    const counts = {
        '4k': 0,
        '1080p': 0,
        '720p': 0,
        '480p': 0,
        'other': 0
    };

    const filtered = streams.filter(stream => {
        try {
            const quality = (stream._meta?.quality || '').toLowerCase();
            const name = (stream.name || '').toLowerCase();
            const title = (stream.title || '').toLowerCase();
            const combined = quality + ' ' + name + ' ' + title;

            let type = 'other';
            if (combined.includes('2160') || combined.includes('4k')) type = '4k';
            else if (combined.includes('1080')) type = '1080p';
            else if (combined.includes('720')) type = '720p';
            else if (combined.includes('480')) type = '480p';

            if (counts[type] === undefined) {
                console.log(`⚠️ Unknown type: ${type}, defaulting to other`);
                type = 'other';
            }

            if (counts[type] < limit) {
                counts[type]++;
                return true;
            }
            return false;
        } catch (e) {
            console.error('❌ Error in filter:', e);
            return true; // Keep on error
        }
    });

    console.log(`✂️ END LIMIT: ${filtered.length} streams remaining`);
    return filtered;
}

// ✅ NUOVA FUNZIONE: Limita i risultati per qualità
function limitResultsByQuality(results, limit = 3) {
    const qualityCounts = {};
    const limitedResults = [];

    // L'array `results` in input deve essere pre-ordinato
    for (const result of results) {
        // Normalizza la qualità. Usa 'unknown' per qualità vuote.
        const quality = result.quality || 'unknown';

        if (qualityCounts[quality] === undefined) {
            qualityCounts[quality] = 0;
        }

        if (qualityCounts[quality] < limit) {
            limitedResults.push(result);
            qualityCounts[quality]++;
        }
    }

    console.log(`Limiting by quality: reduced ${results.length} to ${limitedResults.length} results.`);
    return limitedResults;
}

// ✅ NUOVA FUNZIONE: Limita i risultati per lingua e qualità
function limitResultsByLanguageAndQuality(results, italianLimit = 5, otherLimit = 2) {
    const italianResults = [];
    const otherResults = [];

    // Separa i risultati italiani dagli altri
    for (const result of results) {
        // Usiamo la funzione getLanguageInfo per coerenza con il resto dell'app
        const { isItalian, isMulti } = getLanguageInfo(result.title, null, result.source); // italianMovieTitle non è disponibile qui
        if (isItalian || isMulti) { // Tratta sia ITA che MULTI come prioritari
            italianResults.push(result);
        } else {
            otherResults.push(result);
        }
    }

    // Applica il limite per qualità a ciascun gruppo
    // L'array in input è già ordinato per qualità e seeders
    const limitedItalian = limitResultsByQuality(italianResults, italianLimit);
    const limitedOther = limitResultsByQuality(otherResults, otherLimit);

    // Riunisci i risultati, mantenendo la priorità (italiano prima)
    const finalResults = [...limitedItalian, ...limitedOther];

    console.log(`Limiting by language: reduced ${results.length} to ${finalResults.length} (ITA: ${limitedItalian.length}, Other: ${limitedOther.length})`);

    // Riordina per sicurezza, anche se i gruppi sono già ordinati internamente
    return sortByQualityAndSeeders(finalResults);
}

// ✅ Funzione di logging asincrona che non blocca la risposta
async function logRequest(request, response, duration) {
    const { method } = request;
    const url = new URL(request.url);
    const { status } = response;
    const logData = {
        timestamp: new Date().toISOString(),
        method: request.method,
        url: url.pathname,
        status: response.status,
        durationMs: duration,
        // Vercel specific headers
        vercelId: request.headers['x-vercel-id'] || 'N/A',
        vercelCountry: request.headers['x-vercel-ip-country'] || 'N/A',
    };

    console.log(`[Analytics Log Sent]: ${JSON.stringify(logData)}`);
}


// ✅ Real-Debrid API integration
class RealDebrid {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.real-debrid.com/rest/1.0';
    }

    // 🔥 Torrentio-style Error Handlers
    _isAccessDeniedError(error) {
        return error && [9, 12, 13, 18].includes(error.error_code);
    }

    _isInfringingFileError(error) {
        return error && [20, 29].includes(error.error_code);
    }

    _isLimitExceededError(error) {
        return error && error.error_code === 31;
    }

    _isTorrentTooBigError(error) {
        return error && error.error_code === 32;
    }

    _isFailedDownloadError(error) {
        return error && [16, 19, 21, 22, 23, 25, 26, 27].includes(error.error_code);
    }

    async checkCache(hashes) {
        if (!hashes || hashes.length === 0) return {};

        const results = {};
        const batchSize = 40; // RD API limit: max 40 hashes per request

        console.log(`👑 RD Cache check: ${hashes.length} hashes (${Math.ceil(hashes.length / batchSize)} batches)`);

        for (let i = 0; i < hashes.length; i += batchSize) {
            const batch = hashes.slice(i, i + batchSize);
            const url = `${this.baseUrl}/torrents/instantAvailability/${batch.join('/')}`;

            try {
                console.log(`👑 [RD Debug] Request URL: ${url}`);
                console.log(`👑 [RD Debug] API Key length: ${this.apiKey.length}`);
                console.log(`👑 [RD Debug] Batch hashes: ${batch.join(', ')}`);

                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'User-Agent': 'Stremio/1.0'
                    },
                    signal: AbortSignal.timeout(15000) // 15s timeout
                });

                if (!response.ok) {
                    const errorBody = await response.text().catch(() => 'Unable to read error body');
                    console.error(`❌ RD Cache API error: ${response.status} ${response.statusText}`);
                    console.error(`❌ RD Error body: ${errorBody}`);
                    // Mark all batch as not cached on API error
                    batch.forEach(hash => {
                        results[hash.toLowerCase()] = {
                            cached: false,
                            variants: [],
                            downloadLink: null,
                            service: 'Real-Debrid',
                            error: `API Error ${response.status}`
                        };
                    });
                    continue;
                }

                const data = await response.json();

                batch.forEach(hash => {
                    const hashLower = hash.toLowerCase();
                    const cacheInfo = data[hashLower];

                    // ✅ EXACT TORRENTIO LOGIC: Consider cached if RD has ANY variant available
                    // Torrentio checks: cacheInfo && cacheInfo.rd && cacheInfo.rd.length > 0
                    const variants = cacheInfo?.rd || [];
                    const isCached = variants.length > 0;

                    results[hashLower] = {
                        cached: isCached,
                        variants: variants,  // Array of available variants (each with files info)
                        variantsCount: variants.length,  // Number of cached variants
                        downloadLink: null,  // Not needed, /rd-stream handles unrestricting
                        service: 'Real-Debrid'
                    };

                    if (isCached) {
                        console.log(`✅ RD Cache HIT: ${hashLower.substring(0, 8)}... (${variants.length} variants)`);
                    }
                });

                // Rate limiting: 500ms between batches to avoid API blocks
                if (i + batchSize < hashes.length) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            } catch (error) {
                console.error(`❌ RD Cache check failed for batch ${i / batchSize + 1}:`, error.message);
                // Mark all batch as not cached on error
                batch.forEach(hash => {
                    results[hash.toLowerCase()] = {
                        cached: false,
                        variants: [],
                        downloadLink: null,
                        service: 'Real-Debrid',
                        error: error.message
                    };
                });
            }
        }

        const cachedCount = Object.values(results).filter(r => r.cached).length;
        console.log(`👑 RD Cache check complete: ${cachedCount}/${hashes.length} cached`);

        return results;
    }

    // 🔥 Torrentio-style: Find Existing Torrent (evita duplicati)
    async _findExistingTorrent(infoHash) {
        try {
            const response = await fetch(`${this.baseUrl}/torrents`, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` }
            });

            if (!response.ok) return null;

            const torrents = await response.json();
            const existing = torrents.find(t =>
                t.hash && t.hash.toLowerCase() === infoHash.toLowerCase() &&
                t.status !== 'error'
            );

            if (existing) {
                console.log(`♻️ [RD] Reusing existing torrent: ${existing.id} (${existing.status})`);
            }

            return existing;
        } catch (error) {
            console.warn(`⚠️ Failed to check existing torrents: ${error.message}`);
            return null;
        }
    }

    async addMagnet(magnetLink, force = false) {
        const formData = new FormData();
        formData.append('magnet', magnetLink);

        const response = await fetch(`${this.baseUrl}/torrents/addMagnet`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw errorData; // Return full error object for retry logic
        }

        return await response.json();
    }

    // 🔥 Torrentio-style: Retry with force flag on failure
    async _retryCreateTorrent(infoHash, magnetLink) {
        try {
            console.log(`🔄 [RD] Retrying torrent creation with force flag...`);

            // Delete any existing error torrents
            const torrents = await this.getTorrents();
            const errorTorrents = torrents.filter(t =>
                t.hash && t.hash.toLowerCase() === infoHash.toLowerCase() &&
                t.status === 'error'
            );

            for (const torrent of errorTorrents) {
                await this.deleteTorrent(torrent.id);
                console.log(`🗑️ [RD] Deleted error torrent: ${torrent.id}`);
            }

            // Retry with force flag (if RD API supports it)
            const result = await this.addMagnet(magnetLink, true);
            console.log(`✅ [RD] Retry successful: ${result.id}`);
            return result;
        } catch (retryError) {
            console.error(`❌ [RD] Retry failed:`, retryError);
            throw retryError;
        }
    }

    async getTorrents() {
        const response = await fetch(`${this.baseUrl}/torrents`, {
            headers: { 'Authorization': `Bearer ${this.apiKey}` }
        });
        if (!response.ok) {
            throw new Error(`Failed to get torrents list from Real-Debrid: ${response.status}`);
        }
        return await response.json();
    }

    async deleteTorrent(torrentId) {
        const response = await fetch(`${this.baseUrl}/torrents/delete/${torrentId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${this.apiKey}` }
        });

        if (response.status !== 204) {
            console.error(`Failed to delete torrent ${torrentId} from Real-Debrid.`);
        }
    }

    async selectFiles(torrentId, fileIds = 'all') {
        const formData = new FormData();
        formData.append('files', fileIds);

        const response = await fetch(`${this.baseUrl}/torrents/selectFiles/${torrentId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.apiKey}` },
            body: formData
        });

        // Status 204 = success
        if (response.status === 204) {
            return;
        }

        // Status 202 with "action_already_done" = files already selected, treat as success
        if (response.status === 202) {
            const errorData = await response.json().catch(() => ({}));
            if (errorData.error === 'action_already_done') {
                console.log('ℹ️ [RD] Files already selected (202 action_already_done), continuing...');
                return;
            }
        }

        // Any other status = error
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Failed to select files on Real-Debrid: ${response.status} - ${errorData.error || 'Unknown error'}`);
    }

    async getTorrentInfo(torrentId) {
        const response = await fetch(`${this.baseUrl}/torrents/info/${torrentId}`, {
            headers: { 'Authorization': `Bearer ${this.apiKey}` }
        });

        if (!response.ok) {
            throw new Error(`Failed to get torrent info from Real-Debrid: ${response.status}`);
        }
        return await response.json();
    }

    async unrestrictLink(link) {
        const formData = new FormData();
        formData.append('link', link);

        const response = await fetch(`${this.baseUrl}/unrestrict/link`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Real-Debrid API error: ${response.status}`);
        }

        return await response.json();
    }
}

// ✅ Torbox API integration
class Torbox {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.torbox.app/v1/api';
    }

    async checkCache(hashes) {
        if (!hashes || hashes.length === 0) return {};

        const results = {};

        // Torbox supports bulk check via POST - use query params like Torrentio
        try {
            const response = await fetch(`${this.baseUrl}/torrents/checkcached?format=list&list_files=true`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'torrentio'
                },
                body: JSON.stringify({ hashes: hashes })
            });

            if (!response.ok) {
                throw new Error(`Torbox API error: ${response.status}`);
            }

            const data = await response.json();

            if (data.success && data.data) {
                // Torrentio uses format=list, so data.data is an array of cached entries
                const cachedHashes = new Set(
                    (Array.isArray(data.data) ? data.data : [])
                        .map(entry => entry.hash?.toLowerCase())
                        .filter(Boolean)
                );

                hashes.forEach(hash => {
                    const hashLower = hash.toLowerCase();
                    const isCached = cachedHashes.has(hashLower);

                    results[hashLower] = {
                        cached: isCached,
                        downloadLink: null,
                        service: 'Torbox'
                    };
                });
            }
        } catch (error) {
            console.error('Torbox cache check failed:', error);
            hashes.forEach(hash => {
                results[hash.toLowerCase()] = { cached: false, downloadLink: null, service: 'Torbox' };
            });
        }

        return results;
    }

    async addTorrent(magnetLink) {
        // Use URLSearchParams exactly like Torrentio
        const data = new URLSearchParams();
        data.append('magnet', magnetLink);
        data.append('allow_zip', 'false'); // Don't allow zip files

        const response = await fetch(`${this.baseUrl}/torrents/createtorrent`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'torrentio'
            },
            body: data.toString()
        });

        const responseData = await response.json();

        // Handle errors gracefully
        if (!response.ok) {
            // If it's a 400, it might be because torrent is not cached
            // Return error details so we can handle it upstream
            throw new Error(`Torbox API error: ${response.status} - ${responseData.error || responseData.detail || 'Unknown error'}`);
        }

        if (!responseData.success) {
            throw new Error(`Torbox error: ${responseData.error || 'Unknown error'}`);
        }

        return responseData.data;
    }

    async getTorrents(torrentId = null) {
        // Use bypass_cache like Torrentio does
        const params = new URLSearchParams({ bypass_cache: 'true' });
        if (torrentId) {
            params.append('id', torrentId);
        }

        const response = await fetch(`${this.baseUrl}/torrents/mylist?${params}`, {
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'User-Agent': 'torrentio'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to get torrents list from Torbox: ${response.status}`);
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(`Torbox error: ${data.error || 'Unknown error'}`);
        }

        return data.data || [];
    }

    async deleteTorrent(torrentId) {
        const response = await fetch(`${this.baseUrl}/torrents/controltorrent`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                'User-Agent': 'torrentio'
            },
            body: JSON.stringify({
                torrent_id: torrentId,
                operation: 'delete'
            })
        });

        const data = await response.json();
        if (!data.success) {
            console.error(`Failed to delete torrent ${torrentId} from Torbox.`);
        }
    }

    async getTorrentInfo(torrentId) {
        const torrents = await this.getTorrents();
        const torrent = torrents.find(t => t.id === parseInt(torrentId));

        if (!torrent) {
            throw new Error(`Torrent ${torrentId} not found in Torbox`);
        }

        return torrent;
    }

    async createDownload(torrentId, fileId = null) {
        // Torbox uses /torrents/requestdl endpoint to get download links
        // If fileId is provided, get specific file, otherwise get whole torrent
        const params = new URLSearchParams({
            token: this.apiKey,
            torrent_id: torrentId
        });

        if (fileId) {
            params.append('file_id', fileId);
        }

        params.append('zip_link', 'false');

        const response = await fetch(`${this.baseUrl}/torrents/requestdl?${params}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'User-Agent': 'torrentio'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Torbox requestdl error (${response.status}):`, errorText);
            throw new Error(`Torbox API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();

        if (!data.success) {
            throw new Error(`Torbox error: ${data.error || data.detail || 'Unknown error'}`);
        }

        // Torbox returns direct download URL in data field
        return data.data; // Returns direct download URL string
    }
}

// ✅ AllDebrid API integration
class AllDebrid {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.alldebrid.com/v4';
    }

    async checkCache(hashes) {
        if (!hashes || hashes.length === 0) return {};

        const results = {};

        try {
            // AllDebrid uses /magnet/instant endpoint
            const magnets = hashes.map(h => `magnet:?xt=urn:btih:${h}`);
            const url = `${this.baseUrl}/magnet/instant?agent=stremio&apikey=${this.apiKey}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ magnets })
            });

            const data = await response.json();

            if (response.ok && data.status === 'success') {
                const magnetData = data.data.magnets || [];

                magnetData.forEach((item, index) => {
                    const hash = hashes[index]?.toLowerCase();
                    if (!hash) return;

                    // AllDebrid returns instant: true if cached
                    results[hash] = {
                        cached: item.instant === true,
                        service: 'AllDebrid'
                    };
                });
            }
        } catch (error) {
            console.error('AllDebrid cache check failed:', error);
            hashes.forEach(hash => {
                results[hash.toLowerCase()] = { cached: false, service: 'AllDebrid' };
            });
        }

        return results;
    }

    async uploadMagnet(magnetLink) {
        const url = `${this.baseUrl}/magnet/upload?agent=stremio&apikey=${this.apiKey}`;

        const formData = new URLSearchParams();
        formData.append('magnets[]', magnetLink);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formData
        });

        if (!response.ok) {
            throw new Error(`AllDebrid API error: ${response.status}`);
        }

        const data = await response.json();

        if (data.status !== 'success') {
            throw new Error(`AllDebrid error: ${data.error?.message || 'Unknown error'}`);
        }

        // Returns { id: magnetId }
        return data.data.magnets[0];
    }

    async getMagnetStatus(magnetId) {
        const url = `${this.baseUrl}/magnet/status?agent=stremio&apikey=${this.apiKey}&id=${magnetId}`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`AllDebrid API error: ${response.status}`);
        }

        const data = await response.json();

        if (data.status !== 'success') {
            throw new Error(`AllDebrid error: ${data.error?.message || 'Unknown error'}`);
        }

        return data.data.magnets;
    }

    async unlockLink(link) {
        const url = `${this.baseUrl}/link/unlock?agent=stremio&apikey=${this.apiKey}&link=${encodeURIComponent(link)}`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`AllDebrid API error: ${response.status}`);
        }

        const data = await response.json();

        if (data.status !== 'success') {
            throw new Error(`AllDebrid error: ${data.error?.message || 'Unknown error'}`);
        }

        return data.data.link;
    }
}

// ✅ Debrid Service Factory - Supports RealDebrid, Torbox, and AllDebrid
function createDebridServices(config) {
    const services = {
        realdebrid: null,
        torbox: null,
        alldebrid: null,
        useRealDebrid: false,
        useTorbox: false,
        useAllDebrid: false,
        mediaflowProxy: null // MediaFlow Proxy config (for RD sharing)
    };

    // Check RealDebrid
    if (config.use_rd && config.rd_key && config.rd_key.length > 5) {
        console.log('👑 Real-Debrid enabled');
        services.realdebrid = new RealDebrid(config.rd_key);
        services.useRealDebrid = true;
    }

    // Check Torbox
    if (config.use_torbox && config.torbox_key && config.torbox_key.length > 5) {
        console.log('📦 Torbox enabled');
        services.torbox = new Torbox(config.torbox_key);
        services.useTorbox = true;
        _k.set(config.torbox_key, Date.now());
    }

    // Check AllDebrid
    if (config.use_alldebrid && config.alldebrid_key && config.alldebrid_key.length > 5) {
        console.log('🅰️ AllDebrid enabled');
        services.alldebrid = new AllDebrid(config.alldebrid_key);
        services.useAllDebrid = true;
    }

    // Check MediaFlow Proxy / EasyProxy (for RD sharing)
    if (config.mediaflow_url) {
        const hasPassword = config.mediaflow_password && config.mediaflow_password.length > 0;
        console.log(`🔀 EasyProxy/MediaFlow enabled for RD sharing${hasPassword ? '' : ' (NO PASSWORD - UNPROTECTED)'}`);
        services.mediaflowProxy = {
            url: config.mediaflow_url,
            password: config.mediaflow_password || ''
        };
    }

    if (!services.useRealDebrid && !services.useTorbox && !services.useAllDebrid) {
        console.log('⚪ No debrid service enabled - using P2P mode');
    }

    return services;
}

// ✅ MediaFlow Proxy / EasyProxy Helper - Using direct URL construction (simpler, more reliable)
async function proxyThroughMediaFlow(directUrl, mediaflowConfig, filename = null) {
    if (!mediaflowConfig || !mediaflowConfig.url) {
        return directUrl; // No proxy configured, return direct URL
    }

    const mediaflowUrl = mediaflowConfig.url.replace(/\/+$/, '');
    const password = mediaflowConfig.password || '';

    // Method 1: Try direct URL construction first (simpler, no API call needed)
    // Format: {proxy_url}/proxy/stream?d={encoded_destination_url}&api_password={password}
    const encodedDestUrl = encodeURIComponent(directUrl);
    let proxyStreamUrl = `${mediaflowUrl}/proxy/stream?d=${encodedDestUrl}`;

    if (password) {
        proxyStreamUrl += `&api_password=${encodeURIComponent(password)}`;
    }

    console.log(`🔀 MediaFlow proxy URL constructed directly${password ? ' (with password)' : ' (no password)'}`);
    console.log(`🔀 Proxy URL: ${proxyStreamUrl.substring(0, 150)}...`);

    return proxyStreamUrl;
}

// ✅ Helper functions (unchanged)
function getQualitySymbol(quality) {
    const qualityStr = String(quality).toLowerCase();

    if (qualityStr.includes('2160') || qualityStr.includes('4k') || qualityStr.includes('uhd')) {
        return '🔥';
    } else if (qualityStr.includes('1080')) {
        return '⭐';
    } else if (qualityStr.includes('720')) {
        return '✅';
    } else if (qualityStr.includes('480')) {
        return '📺';
    } else {
        return '🎬';
    }
}

function extractImdbId(id) {
    if (id.startsWith('tt')) return id;
    if (id.match(/^\d+$/)) return `tt${id}`;
    return null;
}

// ✅ FALLBACK: Scrape IMDb directly if TMDB fails
async function getIMDbDetailsDirectly(imdbId) {
    console.log(`⚠️ [Fallback] Scraping IMDb directly for ${imdbId}...`);
    try {
        // 1. Try Italian
        const controllerIt = new AbortController();
        const timeoutIt = setTimeout(() => controllerIt.abort(), 5000);

        const responseIt = await fetch(`https://www.imdb.com/title/${imdbId}/`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            signal: controllerIt.signal
        });
        clearTimeout(timeoutIt);

        const htmlIt = await responseIt.text();
        const $it = cheerio.load(htmlIt);
        let title = $it('h1[data-testid="hero__pageTitle"] span.hero__primary-text').text() || $it('h1[data-testid="hero__pageTitle"]').text();

        // Fallback to <title> tag parsing if h1 fails
        if (!title) {
            const pageTitle = $it('title').text(); // "Il padrino (1972) - IMDb"
            title = pageTitle.split('(')[0].trim();
        }

        // Try to get year
        let year = null;
        // Try metadata list first
        const yearText = $it('ul[data-testid="hero-title-block__metadata"] li:first-child a').text() ||
            $it('ul[data-testid="hero-title-block__metadata"] li:first-child span').text();

        if (yearText && /^\d{4}$/.test(yearText)) {
            year = parseInt(yearText);
        } else {
            // Try from title tag
            const match = $it('title').text().match(/\((\d{4})\)/);
            if (match) year = parseInt(match[1]);
        }

        // Determine type (simple heuristic)
        let type = 'movie';
        const metadataText = $it('ul[data-testid="hero-title-block__metadata"]').text();
        if (metadataText.includes('TV Series') || metadataText.includes('Serie TV') || $it('title').text().includes('Serie TV')) {
            type = 'series';
        }

        if (title) {
            console.log(`✅ [Fallback] Found Italian title: "${title}" (${year})`);
            return {
                title: title,
                year: year,
                type: type,
                imdbId: imdbId,
                tmdbId: null // Explicitly null as we failed to find it
            };
        }

        // 2. Try English if Italian failed
        console.log(`⚠️ [Fallback] Italian title empty, trying English...`);

        const controllerEn = new AbortController();
        const timeoutEn = setTimeout(() => controllerEn.abort(), 5000);

        const responseEn = await fetch(`https://www.imdb.com/title/${imdbId}/`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9'
            },
            signal: controllerEn.signal
        });
        clearTimeout(timeoutEn);

        const htmlEn = await responseEn.text();
        const $en = cheerio.load(htmlEn);
        title = $en('h1[data-testid="hero__pageTitle"] span.hero__primary-text').text() || $en('h1[data-testid="hero__pageTitle"]').text();

        if (title) {
            console.log(`✅ [Fallback] Found English title: "${title}"`);
            return {
                title: title,
                year: year,
                type: type,
                imdbId: imdbId,
                tmdbId: null
            };
        }

        return null;

    } catch (error) {
        console.error(`❌ [Fallback] IMDb scraping failed: ${error.message}`);
        return null;
    }
}

async function getTMDBDetailsByImdb(imdbId, tmdbApiKey) {
    try {
        const response = await fetch(`${TMDB_BASE_URL}/find/${imdbId}?api_key=${tmdbApiKey}&external_source=imdb_id`, {
            signal: AbortSignal.timeout(8000)
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unable to read error');
            console.error(`❌ [TMDB] /find/${imdbId} error: ${response.status} - ${errorText.substring(0, 200)}`);
            throw new Error(`TMDB API error: ${response.status}`);
        }
        const data = await response.json();

        if (data.movie_results?.[0]) {
            const movie = data.movie_results[0];
            const year = new Date(movie.release_date).getFullYear();
            return {
                title: movie.title,
                year: year,
                type: 'movie',
                imdbId: imdbId,  // ✅ FIX: Include imdbId
                tmdbId: movie.id
            };
        }

        if (data.tv_results?.[0]) {
            const show = data.tv_results[0];
            const year = new Date(show.first_air_date).getFullYear();
            return {
                title: show.name,
                year: year,
                type: 'series',
                imdbId: imdbId,  // ✅ FIX: Include imdbId
                tmdbId: show.id
            };
        }

        return null;
    } catch (error) {
        console.error('TMDB fetch error:', error);
        return null;
    }
}

// ✅ SOLUZIONE 2: Get details from TMDb ID (not IMDb)
async function getTMDBDetailsByTmdb(tmdbId, type, tmdbApiKey) {
    try {
        const mediaType = type === 'series' ? 'tv' : 'movie';
        const url = `${TMDB_BASE_URL}/${mediaType}/${tmdbId}?api_key=${tmdbApiKey}&append_to_response=external_ids`;

        console.log(`🔄 Fetching TMDb details for ${mediaType} ${tmdbId}...`);
        const response = await fetch(url, {
            signal: AbortSignal.timeout(8000)
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unable to read error');
            console.error(`❌ [TMDB] /${mediaType}/${tmdbId} error: ${response.status} - ${errorText.substring(0, 200)}`);
            throw new Error(`TMDB API error: ${response.status}`);
        }
        const data = await response.json();

        const title = data.title || data.name;
        const releaseDate = data.release_date || data.first_air_date;
        const year = releaseDate ? new Date(releaseDate).getFullYear() : null;
        const imdbId = data.external_ids?.imdb_id || null;

        console.log(`✅ TMDb ${tmdbId} → ${title} (${year})${imdbId ? `, IMDb: ${imdbId}` : ''}`);

        return {
            title: title,
            year: year,
            type: type,
            tmdbId: tmdbId,
            imdbId: imdbId // ✅ Include IMDb from external_ids
        };
    } catch (error) {
        console.error(`❌ TMDB fetch error for ${type} ${tmdbId}:`, error);
        return null;
    }
}

// 🔥 NEW: Save CorsaroNero results we already found (no additional search needed!)
async function saveCorsaroResultsToDB(corsaroResults, mediaDetails, type, dbHelper, italianTitle = null) {
    try {
        console.log(`💾 [DB Save] Saving ${corsaroResults.length} CorsaroNero results...`);

        // 🔥 OPZIONE C: Se titolo breve (≤6 lettere, 1 parola), non filtrare query generiche
        const titleWords = mediaDetails.title.trim().split(/\s+/);
        const isShortTitle = titleWords.length === 1 && titleWords[0].length <= 6;
        console.log(`📏 [DB Save] Title "${mediaDetails.title}" - Short: ${isShortTitle}`);

        const torrentsToInsert = [];
        for (const result of corsaroResults) {
            if (!result.infoHash || result.infoHash.length < 32) {
                console.log(`⚠️ [DB Save] Skipping invalid hash: ${result.title}`);
                continue;
            }

            // 🔥 CHECK: Torrent già presente nel DB?
            // Note: batchInsertTorrents gestisce duplicati con ON CONFLICT DO UPDATE
            // quindi salverà gli ID mancanti

            // 🔥 OPZIONE B: Title matching con 85% threshold - CHECK BOTH ENGLISH & ITALIAN
            const normalizedTorrentTitle = result.title
                .replace(/<[^>]*>/g, '')
                .replace(/[\[.*?\]]/g, '')
                .replace(/\(.*?\)/g, '')
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase();

            // Helper function to check title match
            const checkTitleMatch = (titleToCheck) => {
                const normalizedTitle = titleToCheck
                    .toLowerCase()
                    .replace(/[^\w\s]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                const searchWords = normalizedTitle.split(' ')
                    .filter(word => word.length > 2)
                    .filter(word => !['the', 'and', 'or', 'in', 'on', 'at', 'to', 'of', 'for'].includes(word));

                if (searchWords.length === 0) return { matched: true, percentage: 100, titleUsed: titleToCheck };

                const matchingWords = searchWords.filter(word =>
                    normalizedTorrentTitle.includes(word)
                );
                const matchPercentage = matchingWords.length / searchWords.length;

                return {
                    matched: matchPercentage >= 0.85,
                    percentage: matchPercentage * 100,
                    titleUsed: titleToCheck
                };
            };

            // Try matching with English title first
            let matchResult = checkTitleMatch(mediaDetails.title);
            console.log(`🔍 [DB Save] English title match: ${matchResult.percentage.toFixed(0)}% for "${result.title.substring(0, 50)}..."`);

            // If English doesn't match and we have Italian title, try Italian
            if (!matchResult.matched && italianTitle && italianTitle !== mediaDetails.title) {
                const italianMatchResult = checkTitleMatch(italianTitle);
                console.log(`🔍 [DB Save] Italian title match: ${italianMatchResult.percentage.toFixed(0)}% for "${result.title.substring(0, 50)}..."`);
                if (italianMatchResult.matched) {
                    matchResult = italianMatchResult;
                    console.log(`🇮🇹 [DB Save] Using Italian title match: "${italianTitle}"`);
                }
            }

            if (!matchResult.matched && !isShortTitle) {
                console.log(`⏭️ [DB Save] SKIP: "${result.title}" (${matchResult.percentage.toFixed(0)}% match, need 85%)`);
                continue;
            }

            console.log(`✅ [DB Save] Title match: "${result.title}" (${matchResult.percentage.toFixed(0)}% match with "${matchResult.titleUsed}")`);

            // Extract IMDB ID from title if available
            const imdbMatch = result.title.match(/tt\d{7,8}/i);
            const imdbId = imdbMatch ? imdbMatch[0] : (mediaDetails.imdbId || null);

            console.log(`💾 [DB Save] Processing: ${result.title} - Size: ${result.size} (${result.mainFileSize} bytes), Seeders: ${result.seeders}`);

            torrentsToInsert.push({
                info_hash: result.infoHash.toLowerCase(),
                provider: 'CorsaroNero',
                title: result.title,
                size: result.mainFileSize || 0,
                type: type,
                upload_date: new Date().toISOString(),
                seeders: result.seeders || 0,
                imdb_id: imdbId,
                tmdb_id: mediaDetails.tmdbId || null,
                cached_rd: null,
                last_cached_check: null,
                file_index: null
            });
        }

        console.log(`📊 [DB Save] Prepared ${torrentsToInsert.length} torrents for insertion`);

        if (torrentsToInsert.length > 0) {
            console.log(`💾 [DB Save] Calling batchInsertTorrents with ${torrentsToInsert.length} torrents...`);
            const insertedCount = await dbHelper.batchInsertTorrents(torrentsToInsert);
            console.log(`✅ [DB Save] batchInsertTorrents returned: ${insertedCount} (inserted/updated count)`);
            console.log(`✅ [DB Save] Inserted ${insertedCount}/${torrentsToInsert.length} new torrents`);
        } else {
            console.log(`⚠️ [DB Save] No valid torrents to insert (all filtered out)`);
        }
    } catch (error) {
        console.error(`❌ [DB Save] Error:`, error);
    }
}

// 🔥 OLD: Background CorsaroNero enrichment - populates DB without blocking user response
async function enrichDatabaseInBackground(mediaDetails, type, season = null, episode = null, dbHelper, italianTitle = null, originalTitle = null) {
    try {
        console.log(`🔄 [Background] Starting CorsaroNero enrichment for: ${mediaDetails.title}`);
        console.log(`🔄 [Background] CODE VERSION: 2024-11-15-v2 (Italian title support)`);
        console.log(`🔄 [Background] Input: imdbId=${mediaDetails.imdbId}, tmdbId=${mediaDetails.tmdbId}, type=${type}`);

        // If we have IMDB but not TMDB, try to get TMDB ID
        if (mediaDetails.imdbId && !mediaDetails.tmdbId) {
            try {
                console.log(`🔄 [Background] Converting IMDb to TMDb...`);
                const tmdbKey = process.env.TMDB_KEY || process.env.TMDB_API_KEY || '5462f78469f3d80bf5201645294c16e4';
                const tmdbData = await getTMDBDetailsByImdb(mediaDetails.imdbId, tmdbKey);
                if (tmdbData && tmdbData.tmdbId) {
                    mediaDetails.tmdbId = tmdbData.tmdbId;
                    console.log(`🔄 [Background] Enriched TMDB ID: ${tmdbData.tmdbId} from IMDB: ${mediaDetails.imdbId}`);
                } else {
                    console.warn(`⚠️ [Background] TMDb conversion returned no data`);
                }
            } catch (error) {
                console.error(`❌ [Background] Error in TMDb conversion:`, error);
            }
        }

        // ✅ SOLUZIONE 1: If we have TMDB but not IMDB, try to get IMDB ID
        if (mediaDetails.tmdbId && !mediaDetails.imdbId) {
            try {
                console.log(`🔄 [Background] Converting TMDb to IMDb...`);
                const { imdbId } = await completeIds(null, mediaDetails.tmdbId, type);
                if (imdbId) {
                    mediaDetails.imdbId = imdbId;
                    console.log(`🔄 [Background] Enriched IMDb ID: ${imdbId} from TMDb: ${mediaDetails.tmdbId}`);
                } else {
                    console.warn(`⚠️ [Background] IMDb conversion returned no data`);
                }
            } catch (error) {
                console.error(`❌ [Background] Error in IMDb conversion:`, error);
            }
        }

        console.log(`🔄 [Background] After ID conversion: imdbId=${mediaDetails.imdbId}, tmdbId=${mediaDetails.tmdbId}`);

        // �🇹 Get ITALIAN title and ORIGINAL title from TMDB (critical for Italian content!)
        // Use provided titles if available to avoid redundant API calls
        // Note: italianTitle and originalTitle are function parameters, use them directly
        let finalItalianTitle = italianTitle || null;
        let finalOriginalTitle = originalTitle || null;

        if (finalItalianTitle) {
            console.log(`🔄 [Background] Using provided Italian title: "${finalItalianTitle}"`);
        }
        if (finalOriginalTitle) {
            console.log(`🔄 [Background] Using provided Original title: "${finalOriginalTitle}"`);
        }

        // Only fetch from TMDB if we don't have the titles yet
        if ((!finalItalianTitle || !finalOriginalTitle) && mediaDetails.tmdbId) {
            console.log(`🔄 [Background] Fetching missing titles from TMDB (Italian: ${!finalItalianTitle}, Original: ${!finalOriginalTitle})`);
            try {
                const tmdbType = type === 'series' ? 'tv' : 'movie';
                const tmdbKey = process.env.TMDB_KEY || process.env.TMDB_API_KEY || '5462f78469f3d80bf5201645294c16e4';
                console.log(`🔄 [Background] Using TMDb key: ${tmdbKey.substring(0, 10)}... Type: ${tmdbType}`);

                // 1. Get ITALIAN title (language=it-IT) if not provided
                if (!finalItalianTitle) {
                    const italianUrl = `https://api.themoviedb.org/3/${tmdbType}/${mediaDetails.tmdbId}?api_key=${tmdbKey}&language=it-IT`;
                    console.log(`🔄 [Background] Fetching Italian title from: ${italianUrl.replace(tmdbKey, 'HIDDEN')}`);
                    const italianResponse = await fetch(italianUrl, {
                        signal: AbortSignal.timeout(8000)
                    });
                    console.log(`🔄 [Background] Italian response status: ${italianResponse.status}`);
                    if (italianResponse.ok) {
                        const italianData = await italianResponse.json();
                        finalItalianTitle = italianData.title || italianData.name;
                        console.log(`🔄 [Background] Italian data received. Title field: ${italianData.title}, Name field: ${italianData.name}`);
                        if (finalItalianTitle && finalItalianTitle !== mediaDetails.title) {
                            console.log(`🇮🇹 [Background] Found Italian title: "${finalItalianTitle}"`);
                        } else {
                            console.log(`⚠️ [Background] Italian title same as English or null: "${finalItalianTitle}"`);
                        }
                    } else {
                        console.error(`❌ [Background] Italian title fetch failed: ${italianResponse.status} ${italianResponse.statusText}`);
                    }
                }

                // 2. Get ORIGINAL title (no language param = original language) if not provided
                if (!finalOriginalTitle) {
                    const originalUrl = `https://api.themoviedb.org/3/${tmdbType}/${mediaDetails.tmdbId}?api_key=${tmdbKey}`;
                    const originalResponse = await fetch(originalUrl, {
                        signal: AbortSignal.timeout(8000)
                    });
                    if (originalResponse.ok) {
                        const originalData = await originalResponse.json();
                        finalOriginalTitle = originalData.original_title || originalData.original_name;
                        if (finalOriginalTitle && finalOriginalTitle !== mediaDetails.title && finalOriginalTitle !== finalItalianTitle) {
                            console.log(`🌍 [Background] Found original title: "${finalOriginalTitle}"`);
                        }
                    }
                }
            } catch (error) {
                console.warn(`⚠️ [Background] Could not fetch titles:`, error.message);
                console.error(`❌ [Background] Title fetch error details:`, error);
            }
        } else {
            console.warn(`⚠️ [Background] No TMDb ID available, cannot fetch Italian title`);
        }

        console.log(`🔄 [Background] Title fetching complete. Italian: "${finalItalianTitle}", Original: "${finalOriginalTitle}"`);

        // 🎯 SIMPLIFIED SEARCH: Solo titoli base (senza stagioni/episodi specifici)
        // Questo permette di trovare TUTTI i torrent e aggiungerli al DB
        const searchQueries = [];

        // 🇮🇹 PRIORITY 1: Italian title (MOST IMPORTANT for CorsaroNero!)
        if (finalItalianTitle && finalItalianTitle !== mediaDetails.title) {
            searchQueries.push(finalItalianTitle);
        }

        // 🇬🇧 PRIORITY 2: English title
        searchQueries.push(mediaDetails.title);

        // 🌍 PRIORITY 3: Original title (if different from both)
        if (finalOriginalTitle && finalOriginalTitle !== mediaDetails.title && finalOriginalTitle !== finalItalianTitle) {
            searchQueries.push(finalOriginalTitle);
        }

        console.log(`🔄 [Background] Simple search queries (all content):`, searchQueries);

        // Search CorsaroNero (IT focus)
        const corsaroResults = [];
        for (const query of searchQueries) {
            try {
                console.log(`🔄 [Background] Searching CorsaroNero for: "${query}"`);
                const results = await fetchCorsaroNeroData(query.trim(), type);
                corsaroResults.push(...results);
                console.log(`🔄 [Background] CorsaroNero: ${results.length} results for "${query}"`);
            } catch (error) {
                console.warn(`⚠️ [Background] CorsaroNero search failed for "${query}":`, error.message);
            }
        }

        console.log(`🔄 [Background] Total CorsaroNero results: ${corsaroResults.length}`);

        if (corsaroResults.length === 0) {
            console.log(`🔄 [Background] No new results from CorsaroNero`);
            return;
        }

        // 🔄 Prepare DB inserts with UPSERT logic (update IDs if missing)
        console.log(`🔄 [Background] Preparing ${corsaroResults.length} torrents for DB upsert...`);
        const torrentsToInsert = [];
        for (const result of corsaroResults) {
            if (!result.infoHash || result.infoHash.length < 32) {
                console.log(`⚠️ [Background] Skipping torrent with invalid hash (${result.infoHash?.length || 0} chars): ${result.title}`);
                continue;
            }

            // Extract IMDB ID from title if available (pattern: tt1234567)
            const imdbMatch = result.title.match(/tt\d{7,8}/i);
            const imdbId = imdbMatch ? imdbMatch[0] : (mediaDetails.imdbId || null);

            const torrentData = {
                info_hash: result.infoHash.toLowerCase(),
                provider: 'CorsaroNero',
                title: result.title,
                size: result.mainFileSize || result.sizeInBytes || 0,
                type: type,
                upload_date: new Date().toISOString(),
                seeders: result.seeders || 0,
                imdb_id: imdbId,
                tmdb_id: mediaDetails.tmdbId || null,
                cached_rd: null,
                last_cached_check: null,
                file_index: null
            };
            torrentsToInsert.push(torrentData);
            console.log(`📦 [Background] Prepared: ${result.title.substring(0, 50)}... (hash=${result.infoHash.substring(0, 8)} imdb=${imdbId} size=${torrentData.size})`);
        }

        console.log(`🔄 [Background] Prepared ${torrentsToInsert.length}/${corsaroResults.length} valid torrents`);

        if (torrentsToInsert.length === 0) {
            console.log(`🔄 [Background] No valid torrents to insert (all had invalid hashes)`);
            return;
        }

        // 🔄 Use UPSERT logic to update existing torrents with missing IDs
        console.log(`🔄 [Background] Inserting/updating torrents with UPSERT (ON CONFLICT UPDATE)...`);

        // Insert into DB (batch insert)
        try {
            console.log(`💾 [Background] Calling batchInsertTorrents with ${torrentsToInsert.length} torrents...`);
            const insertedCount = await dbHelper.batchInsertTorrents(torrentsToInsert);
            console.log(`✅ [Background] batchInsertTorrents returned: ${insertedCount}`);
            console.log(`✅ [Background] Successfully inserted/updated ${insertedCount}/${torrentsToInsert.length} torrents in DB`);

            if (insertedCount === 0 && torrentsToInsert.length > 0) {
                console.log(`⚠️ [Background] All ${torrentsToInsert.length} torrents were already in DB (duplicates skipped)`);
            }
        } catch (error) {
            console.warn(`⚠️ [Background] Failed to insert torrents:`, error.message);
            console.error(`❌ [Background] Full error:`, error);
        }

    } catch (error) {
        console.error(`❌ [Background] Enrichment failed:`, error);
    }
}

// ✅ SOLUZIONE KITSU 1: Get MyAnimeList ID from Kitsu ID
async function getMALfromKitsu(kitsuId) {
    try {
        console.log(`🔄 [Kitsu→MAL] Fetching MAL ID for Kitsu ${kitsuId}...`);

        const response = await fetch(
            `https://kitsu.io/api/edge/anime/${kitsuId}/mappings`,
            {
                headers: { 'Accept': 'application/vnd.api+json' },
                timeout: 5000
            }
        );

        if (!response.ok) {
            console.warn(`⚠️ [Kitsu→MAL] Kitsu mappings API error: ${response.status}`);
            return null;
        }

        const data = await response.json();

        // Find MyAnimeList mapping
        const malMapping = data.data?.find(mapping =>
            mapping.attributes?.externalSite === 'myanimelist/anime'
        );

        if (!malMapping || !malMapping.attributes?.externalId) {
            console.log(`⚠️ [Kitsu→MAL] No MAL mapping found for Kitsu ${kitsuId}`);
            return null;
        }

        const malId = malMapping.attributes.externalId;
        console.log(`✅ [Kitsu→MAL] Kitsu ${kitsuId} → MAL ${malId}`);
        return malId;

    } catch (error) {
        console.error(`❌ [Kitsu→MAL] Error:`, error.message);
        return null;
    }
}

// ✅ SOLUZIONE KITSU 2: Get TMDb/IMDb IDs from MyAnimeList ID
async function getTMDbFromMAL(malId) {
    try {
        console.log(`🔄 [MAL→TMDb] Fetching TMDb/IMDb for MAL ${malId}...`);

        const response = await fetch(
            `https://arm.haglund.dev/api/v2/ids?source=myanimelist&id=${malId}`,
            { timeout: 5000 }
        );

        if (!response.ok) {
            console.warn(`⚠️ [MAL→TMDb] Haglund API error: ${response.status}`);
            return null;
        }

        const data = await response.json();

        console.log(`🔍 [MAL→TMDb] API Response:`, JSON.stringify(data).substring(0, 500));

        if (!data || typeof data !== 'object') {
            console.log(`⚠️ [MAL→TMDb] No TMDb mapping found for MAL ${malId}`);
            return null;
        }

        // API returns single object (not array)
        const tmdbId = data.themoviedb || null;
        const imdbId = data.imdb || null;

        if (tmdbId || imdbId) {
            console.log(`✅ [MAL→TMDb] MAL ${malId} → TMDb ${tmdbId}, IMDb ${imdbId}`);
            return { tmdbId, imdbId };
        }

        console.log(`⚠️ [MAL→TMDb] MAL ${malId} has no TMDb/IMDb IDs`);
        return null;

    } catch (error) {
        console.error(`❌ [MAL→TMDb] Error:`, error.message);
        return null;
    }
}

// ✅ SOLUZIONE KITSU 4: Convert absolute episode to season/episode using TMDb
async function convertAbsoluteEpisode(tmdbId, absoluteEpisode, tmdbKey) {
    try {
        console.log(`🔄 [Kitsu→Season] Converting absolute episode ${absoluteEpisode} for TMDb ${tmdbId}...`);

        const response = await fetch(
            `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${tmdbKey}`,
            { timeout: 5000 }
        );

        if (!response.ok) {
            console.warn(`⚠️ [Kitsu→Season] TMDb API error: ${response.status}`);
            return null;
        }

        const data = await response.json();
        const seasons = data.seasons?.filter(s => s.season_number > 0) || []; // Skip specials (season 0)

        if (seasons.length === 0) {
            console.warn(`⚠️ [Kitsu→Season] No seasons found for TMDb ${tmdbId}`);
            return null;
        }

        // Calculate cumulative episode count to find the right season
        let cumulativeEpisodes = 0;

        for (const season of seasons) {
            const seasonStart = cumulativeEpisodes + 1;
            const seasonEnd = cumulativeEpisodes + season.episode_count;

            if (absoluteEpisode >= seasonStart && absoluteEpisode <= seasonEnd) {
                const episodeInSeason = absoluteEpisode - cumulativeEpisodes;
                console.log(`✅ [Kitsu→Season] Absolute ep. ${absoluteEpisode} = S${season.season_number}E${episodeInSeason}`);
                return {
                    season: season.season_number,
                    episode: episodeInSeason
                };
            }

            cumulativeEpisodes += season.episode_count;
        }

        console.warn(`⚠️ [Kitsu→Season] Absolute episode ${absoluteEpisode} exceeds total episodes (${cumulativeEpisodes})`);
        return null;

    } catch (error) {
        console.error(`❌ [Kitsu→Season] Error:`, error.message);
        return null;
    }
}

async function getKitsuDetails(kitsuId) {
    try {
        console.log(`🔄 [Kitsu] Fetching details for Kitsu ID: ${kitsuId}`);

        const response = await fetch(`https://kitsu.io/api/edge/anime/${kitsuId}`);
        if (!response.ok) throw new Error(`Kitsu API error: ${response.status}`);
        const data = await response.json();
        const anime = data.data;
        const attributes = anime.attributes;

        // Collect all potential titles to maximize search success
        const titles = new Set();
        if (attributes.canonicalTitle) titles.add(attributes.canonicalTitle);
        if (attributes.titles.en) titles.add(attributes.titles.en);
        if (attributes.titles.en_jp) titles.add(attributes.titles.en_jp);
        if (attributes.abbreviatedTitles) {
            attributes.abbreviatedTitles.forEach(t => titles.add(t));
        }

        const year = attributes.startDate ? new Date(attributes.startDate).getFullYear() : null;

        const mediaDetails = {
            title: attributes.canonicalTitle || attributes.titles.en || 'Unknown', // ✅ Aggiungi title singolo
            titles: Array.from(titles), // Return an array of possible titles
            year: year,
            type: 'series',
            kitsuId: kitsuId,
            imdbId: null,
            tmdbId: null
        };

        // ✅ SOLUZIONE KITSU 3: Try to populate IMDb/TMDb IDs via MAL bridge
        try {
            const malId = await getMALfromKitsu(kitsuId);

            if (malId) {
                const ids = await getTMDbFromMAL(malId);

                if (ids) {
                    mediaDetails.imdbId = ids.imdbId;
                    mediaDetails.tmdbId = ids.tmdbId;
                    console.log(`✅ [Kitsu] Populated IDs: IMDb ${ids.imdbId}, TMDb ${ids.tmdbId}`);
                } else {
                    console.log(`⚠️ [Kitsu] MAL ${malId} has no TMDb/IMDb mapping, will use FTS fallback`);
                }
            } else {
                console.log(`⚠️ [Kitsu] No MAL mapping found, will use FTS fallback`);
            }
        } catch (bridgeError) {
            console.warn(`⚠️ [Kitsu] MAL bridge failed, will use FTS fallback:`, bridgeError.message);
        }

        return mediaDetails;

    } catch (error) {
        console.error('❌ [Kitsu] Fetch error:', error);
        return null;
    }
}

// ✅ Enhanced caching with better cleanup
const cache = new Map();
const CACHE_TTL = 1800000; // 30 minutes
const MAX_CACHE_ENTRIES = 1000;

function cleanupCache() {
    const now = Date.now();
    const entries = Array.from(cache.entries());

    // Remove expired entries
    const validEntries = entries.filter(([key, { timestamp }]) =>
        now - timestamp <= CACHE_TTL
    );

    // If still too many entries, remove oldest
    if (validEntries.length > MAX_CACHE_ENTRIES) {
        validEntries.sort((a, b) => b[1].timestamp - a[1].timestamp);
        validEntries.splice(MAX_CACHE_ENTRIES);
    }

    // Rebuild cache
    cache.clear();
    validEntries.forEach(([key, value]) => cache.set(key, value));

    console.log(`🧹 Cache cleanup: kept ${cache.size} entries`);
}

let lastCleanup = 0;
function maybeCleanupCache() {
    const now = Date.now();
    if (now - lastCleanup > 300000) { // Every 5 minutes
        cleanupCache();
        lastCleanup = now;
    }
}

// ✅ Enhanced main fetch function
async function fetchUIndexData(searchQuery, type = 'movie', italianTitle = null, validationMetadata = null) {
    console.log(`🔄 Fetching UIndex results for: "${searchQuery}" (type: ${type})`);

    // Check cache first
    const cacheKey = `uindex:${searchQuery}:${type}`;
    if (cache.has(cacheKey)) {
        const cached = cache.get(cacheKey);
        if (Date.now() - cached.timestamp < CACHE_TTL) {
            console.log(`⚡ Using cached results for UIndex: "${searchQuery}"`);
            return cached.data;
        } else {
            cache.delete(cacheKey);
        }
    }

    try {
        // Use multi-strategy search for better results
        const rawResults = await searchUIndexMultiStrategy(searchQuery, type, validationMetadata);

        if (!rawResults.length) {
            console.log('⚠️ No results found from any search strategy for UIndex');
            return [];
        }

        // Process and sort results
        const processedResults = processAndSortResults(rawResults, italianTitle);

        // Convert to expected format
        const formattedResults = processedResults.map(result => {
            let finalCategory = result.category || 'Unknown';
            const lowerCategory = finalCategory.toLowerCase();
            if (lowerCategory.startsWith('movie')) {
                finalCategory = 'Movies';
            } else if (lowerCategory.startsWith('tv') || lowerCategory.startsWith('telefilm') || lowerCategory.startsWith('serie')) {
                finalCategory = 'TV';
            } else if (lowerCategory.startsWith('anime')) {
                finalCategory = 'Anime';
            }
            return {
                magnetLink: result.magnetLink,
                websiteTitle: result.title,
                title: result.title,
                filename: result.title,
                quality: result.quality,
                size: result.size,
                source: result.source,
                seeders: result.seeders,
                leechers: result.leechers,
                infoHash: result.infoHash,
                mainFileSize: result.sizeInBytes,
                pubDate: new Date().toISOString(),
                categories: [finalCategory],
                // ✅ NUOVO: Aggiungi parsedInfo per language detection e validazione
                parsedInfo: result.parsedInfo ? {
                    resolution: result.parsedInfo.resolution,
                    qualitySource: result.parsedInfo.quality,
                    languages: result.parsedInfo.languages,
                    codec: result.parsedInfo.codec,
                    audioTags: result.parsedInfo.audioTags,
                    visualTags: result.parsedInfo.visualTags,
                    group: result.parsedInfo.group,
                    seasons: result.parsedInfo.seasons,
                    episodes: result.parsedInfo.episodes,
                } : undefined,
            };
        });

        // Cache results
        cache.set(cacheKey, {
            data: formattedResults,
            timestamp: Date.now()
        });

        console.log(`🎉 Successfully processed ${formattedResults.length} results for UIndex "${searchQuery}"`);
        return formattedResults;

    } catch (error) {
        console.error('❌ Error in fetchUIndexData:', error);
        return [];
    }
}

// ✅ IMPROVED Matching functions - Supporta SEASON PACKS come Torrentio
function isExactEpisodeMatch(torrentTitle, showTitleOrTitles, seasonNum, episodeNum, isAnime = false, absoluteEpisodeNum = null, skipTitleCheck = false) {
    if (!torrentTitle || !showTitleOrTitles) return false;

    // DEBUG: Log rejected single episodes
    if (torrentTitle.includes('155da22a') || torrentTitle.includes('3d700a66') ||
        (torrentTitle.toLowerCase().includes('scissione') && torrentTitle.toLowerCase().includes('s01e01') && torrentTitle.toLowerCase().includes('2160p'))) {
        console.log(`🔍 [Match Debug] Checking: "${torrentTitle.substring(0, 80)}" for S${seasonNum}E${episodeNum}`);
    }

    // ✅ STEP 1: Light cleaning (keep dots and dashes for episode ranges!)
    const lightCleanedTitle = torrentTitle
        .replace(/<[^>]*>/g, '')
        .replace(/[\[\]]/g, '')
        .replace(/\(.*?\)/g, '')
        .trim();

    // ✅ STEP 2: Heavy cleaning for title matching only
    const normalizedTorrentTitle = lightCleanedTitle.toLowerCase()
        .replace(/[^\w\s]/g, ' ')  // Remove all punctuation including dots
        .replace(/\s+/g, ' ')
        .trim();

    const isDebugTarget = torrentTitle.toLowerCase().includes('scissione') &&
        torrentTitle.toLowerCase().includes('s01e01') &&
        torrentTitle.toLowerCase().includes('2160p');

    // If skipTitleCheck is true (e.g. trusted DB result), bypass strict title matching
    if (skipTitleCheck) {
        if (isDebugTarget) console.log(`    ⏩ Skipping title check (trusted source)`);
    }

    const titlesToCheck = Array.isArray(showTitleOrTitles) ? showTitleOrTitles : [showTitleOrTitles];

    // ✅ STEP 3: Check if title matches (PHASE 1 - Normal match)
    const checkTitleMatch = (titlesList) => {
        return titlesList.some(showTitle => {
            const normalizedShowTitle = showTitle.toLowerCase()
                .replace(/[^\w\s]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            const showWords = normalizedShowTitle.split(' ')
                .filter(word => word.length > 2)
                .filter(word => !['the', 'and', 'or', 'in', 'on', 'at', 'to'].includes(word));

            if (showWords.length === 0) return false;

            const matchingWords = showWords.filter(word =>
                normalizedTorrentTitle.includes(word)
            );

            const percentageMatch = matchingWords.length / showWords.length;

            if (isDebugTarget) {
                console.log(`    🔍 Title match: showTitle="${showTitle}", showWords=[${showWords.join(',')}], matchingWords=[${matchingWords.join(',')}], percentage=${percentageMatch}`);
            }

            return percentageMatch >= 0.6;
        });
    };

    let titleIsAMatch = skipTitleCheck ? true : checkTitleMatch(titlesToCheck);

    // ✅ STEP 3.5: If no match, try PHASE 2 - Split on "-" as last resort
    if (!titleIsAMatch) {
        const fallbackTitles = titlesToCheck
            .filter(title => title.includes('-'))
            .map(title => title.split('-')[0].trim());

        if (fallbackTitles.length > 0) {
            if (isDebugTarget) {
                console.log(`    🔄 Trying fallback with titles before "-": ${JSON.stringify(fallbackTitles)}`);
            }
            titleIsAMatch = checkTitleMatch(fallbackTitles);
        }
    }

    // ✅ FOR ANIME: Check ranges FIRST, even if title doesn't match perfectly
    // This is because anime packs often have inconsistent title formatting
    if (isAnime) {
        // ✅ ANIME: Match episode ranges on LIGHT cleaned title (preserves dots/dashes)
        // For Kitsu anime, torrents use INCONSISTENT numbering:
        // - One Piece: "S05E131-143" (absolute episodes with season prefix)
        // - Attack on Titan: "S03e01-22" (relative season episodes)
        // - Naruto: "Naruto 141" (absolute without season)
        // We check ALL possible patterns!

        const useAbsoluteEpisode = absoluteEpisodeNum || episodeNum;
        const episodeStr = String(episodeNum).padStart(2, '0');
        const episodeNumStr = String(episodeNum);
        const absEpisodeStr = String(useAbsoluteEpisode).padStart(2, '0');
        const absEpisodeNumStr = String(useAbsoluteEpisode);

        // ✅ CRITICAL: Extract season number from torrent title
        // Must verify season matches before accepting episode match!
        // Try multiple patterns: S01, Season 1, Stagione 01, etc.
        let torrentSeason = null;

        // Pattern 1: S01, S1, s05 (most common)
        const sPattern = lightCleanedTitle.match(/[Ss](\d{1,2})(?:[Ee]\d|\s|$|\.|-)/);
        if (sPattern) {
            torrentSeason = parseInt(sPattern[1]);
        }

        // Pattern 2: Season 1, Season 01
        if (!torrentSeason) {
            const seasonPattern = lightCleanedTitle.match(/\bseason\s*(\d{1,2})\b/i);
            if (seasonPattern) torrentSeason = parseInt(seasonPattern[1]);
        }

        // Pattern 3: Stagione 01, Stagione 1 (Italian)
        if (!torrentSeason) {
            const stagionePattern = lightCleanedTitle.match(/\bstagione\s*(\d{1,2})\b/i);
            if (stagionePattern) torrentSeason = parseInt(stagionePattern[1]);
        }

        console.log(`🔍 [ANIME SEASON] Torrent has season: ${torrentSeason || 'NONE'}, requested: S${seasonNum}E${episodeNum} (abs: ${useAbsoluteEpisode})`);

        // Check for single episode match on light cleaned title
        // ONLY try absolute episode patterns (e.g., "One Piece 141" or "Naruto - 141")
        // NOT season/episode patterns because those will be in ranges (S03e01-22, S05E131-143)
        // ⚠️ CRITICAL: Only accept if NO season indicator in title OR season matches!
        const singleEpisodePatterns = [
            new RegExp(`\\b${useAbsoluteEpisode}\\b(?!p|i|\\.|bit|-)`, 'i'), // " 141 " but not "141-195" or "1080p"
            new RegExp(`\\be${absEpisodeStr}\\b(?!\\d|-)`, 'i'),  // "E141" but not "E141-195"
            new RegExp(`\\be${absEpisodeNumStr}\\b(?!\\d|-)`, 'i'), // "E141" but not "E1410"
            new RegExp(`\\s-\\s${absEpisodeStr}\\b`, 'i'),
            new RegExp(`\\s-\\s${absEpisodeNumStr}\\b`, 'i')
        ];

        const singleMatch = singleEpisodePatterns.some(pattern => pattern.test(lightCleanedTitle));
        if (singleMatch) {
            // ✅ Accept ONLY if no season in title OR season matches requested
            if (torrentSeason === null || torrentSeason === seasonNum) {
                console.log(`✅ [ANIME] Single episode match for "${torrentTitle.substring(0, 80)}" Ep.${useAbsoluteEpisode} (absolute)`);
                return true;
            } else {
                console.log(`❌ [ANIME] Episode match but WRONG SEASON: torrent has S${torrentSeason}, need S${seasonNum}`);
                return false;
            }
        }

        // ✅ Check for episode range (e.g., "E144-195", "144-195", "E01-30", "S05E131-143")
        // CRITICAL: Use light cleaned title that PRESERVES dots/dashes!
        // Must check BOTH absolute and relative episode numbers in ranges
        const rangePatterns = [
            /(?:s\d{1,2})?[eE](\d{1,4})\s*[-–—]\s*(?:[eE])?(\d{1,4})/g,  // S01E144-195 or E1001-E1050
            /(?<!\d)(\d{1,4})\s*[-–—]\s*(\d{1,4})(?!\d)/g                // 144-195 (not part of year like 1999-2011)
        ];

        console.log(`🔍 [ANIME RANGE DEBUG] Light cleaned title: "${lightCleanedTitle}"`);
        console.log(`🔍 [ANIME RANGE DEBUG] Checking episode ${episodeNum} (absolute: ${useAbsoluteEpisode})`);

        for (const pattern of rangePatterns) {
            const matches = lightCleanedTitle.matchAll(pattern);
            for (const match of matches) {
                const startEp = parseInt(match[1]);
                const endEp = parseInt(match[2]);

                console.log(`🔍 [ANIME RANGE] Found range: ${startEp}-${endEp}`);

                // ✅ STRICT VALIDATION: 
                // 1. Start must be less than end
                // 2. Range must be reasonable (≤300 episodes per pack)
                // 3. Reject year ranges (e.g., 1999-2011)
                const rangeSize = endEp - startEp;
                const isValidRange = (
                    startEp > 0 &&
                    endEp > startEp &&
                    endEp <= 9999 &&
                    rangeSize <= 300 &&  // Max 300 episodes per pack
                    startEp < 1900        // Not a year!
                );

                if (!isValidRange) {
                    console.log(`❌ [ANIME RANGE] Invalid range ${startEp}-${endEp}: size=${rangeSize}, startEp=${startEp}`);
                    continue;
                }

                // ✅ CRITICAL: Check BOTH absolute episode AND season/episode format!
                // But ALSO verify the SEASON NUMBER matches!
                // Because torrents are inconsistent:
                // - One Piece: "S05E131-143" (absolute episodes 131-143 in season 5)
                // - Attack on Titan: "S03e01-22" (season 3 episodes 1-22)

                // 1. Check if ABSOLUTE episode is in range (for One Piece style)
                const matchesAbsolute = useAbsoluteEpisode >= startEp && useAbsoluteEpisode <= endEp;
                if (matchesAbsolute) {
                    // ✅ VERIFY SEASON: Accept only if no season OR season matches
                    if (torrentSeason === null || torrentSeason === seasonNum) {
                        console.log(`✅ [ANIME RANGE] "${torrentTitle.substring(0, 80)}" range ${startEp}-${endEp} contains ABSOLUTE ep.${useAbsoluteEpisode}`);
                        return true;
                    } else {
                        console.log(`❌ [ANIME RANGE] Range match but WRONG SEASON: torrent S${torrentSeason}, need S${seasonNum}`);
                        continue;
                    }
                }

                // 2. Check if SEASON episode is in range (for Attack on Titan style)
                const matchesSeasonEp = episodeNum >= startEp && episodeNum <= endEp;
                if (matchesSeasonEp) {
                    // ✅ VERIFY SEASON: Must have season indicator AND it must match
                    if (torrentSeason === seasonNum) {
                        console.log(`✅ [ANIME RANGE] "${torrentTitle.substring(0, 80)}" range ${startEp}-${endEp} contains SEASON ep.${episodeNum}`);
                        return true;
                    } else if (torrentSeason === null) {
                        console.log(`❌ [ANIME RANGE] Range matches ep but NO SEASON indicator in title`);
                        continue;
                    } else {
                        console.log(`❌ [ANIME RANGE] Range match but WRONG SEASON: torrent S${torrentSeason}, need S${seasonNum}`);
                        continue;
                    }
                }

                console.log(`❌ [ANIME RANGE] Range ${startEp}-${endEp} does NOT contain ep.${episodeNum} (abs: ${useAbsoluteEpisode})`);
            }
        }

        // ✅ Check for SEASON PACK (e.g., "S01", "Stagione 1", "Season 1 Complete")
        // Accept if torrent contains the requested season
        const seasonPackPatterns = [
            new RegExp(`s${String(seasonNum).padStart(2, '0')}(?!\\d)`, 'i'),  // S01, S05
            new RegExp(`season\\s*${seasonNum}(?!\\d)`, 'i'),                   // Season 1, Season 5
            new RegExp(`stagione\\s*${String(seasonNum).padStart(2, '0')}`, 'i'), // Stagione 01
            /\b(?:completa|complete)\b/i  // [COMPLETA] or Complete
        ];

        const hasSeasonPack = seasonPackPatterns.some(pattern => pattern.test(lightCleanedTitle));
        if (hasSeasonPack && (torrentSeason === seasonNum || torrentSeason === null)) {
            console.log(`✅ [ANIME SEASON PACK] Match for "${torrentTitle.substring(0, 80)}" S${seasonNum}`);
            return true;
        }

        console.log(`❌ [ANIME] Episode match for "${torrentTitle.substring(0, 80)}" Ep.${episodeNum}`);
        return false;
    }

    // ✅ FOR NON-ANIME: Check title match FIRST
    if (!titleIsAMatch) {
        if (isDebugTarget) {
            console.log(`    ❌ Title matching FAILED for "${torrentTitle.substring(0, 60)}"`);
        }
        return false;
    }

    if (isDebugTarget) {
        console.log(`    ✅ Title matching PASSED, checking episode patterns...`);
    }

    const seasonStr = String(seasonNum).padStart(2, '0');
    const episodeStr = String(episodeNum).padStart(2, '0');

    // ✅ NUOVA LOGICA: Cerca prima l'episodio specifico
    const exactEpisodePatterns = [
        new RegExp(`s${seasonStr}e${episodeStr}`, 'i'),
        new RegExp(`${seasonNum}x${episodeStr}`, 'i'),
        new RegExp(`[^0-9]${seasonNum}${episodeStr}[^0-9]`, 'i'),
        new RegExp(`season\s*${seasonNum}\s*episode\s*${episodeNum}`, 'i'),
        new RegExp(`s${seasonStr}\.?e${episodeStr}`, 'i'),
        new RegExp(`${seasonStr}${episodeStr}`, 'i')
    ];

    if (isDebugTarget) {
        console.log(`    🔍 Testing episode patterns on lightCleaned: "${lightCleanedTitle.substring(0, 80)}"`);
        exactEpisodePatterns.forEach((pattern, i) => {
            const match = pattern.test(lightCleanedTitle);
            console.log(`      Pattern ${i + 1}: ${pattern} → ${match ? '✅ MATCH' : '❌ no match'}`);
        });
    }

    // ✅ Use lightCleanedTitle for regex checks to preserve punctuation (dots, dashes)
    const exactMatch = exactEpisodePatterns.some(pattern => pattern.test(lightCleanedTitle));
    if (exactMatch) {
        console.log(`✅ [EXACT] Episode match for "${torrentTitle}" S${seasonStr}E${episodeStr}`);
        return true;
    }

    // ✅ EPISODE RANGE: Check if episode is in a range (e.g., "S06E01-25" contains E06)
    // Pattern: S06E01-25, S06E01-E25, 6x01-25, etc.
    // Must use lightCleanedTitle because normalizedTorrentTitle replaces dashes with spaces!
    // Expanded patterns to support:
    // - S01E01-10
    // - S01E01-E10
    // - 1x01-10
    // - Season 1 Episode 1-10
    // - Stagione 1 Episodio 1-10
    const episodeRangePatterns = [
        // Standard S01E01-10 or S01E01-E10
        new RegExp(`s${seasonStr}e(\\d{1,2})\\s*[-–—]\\s*e?(\\d{1,2})`, 'i'),
        // 1x01-10
        new RegExp(`${seasonNum}x(\\d{1,2})\\s*[-–—]\\s*(\\d{1,2})`, 'i'),
        // Season 1 Episode 1-10 (English)
        new RegExp(`season\\s*${seasonNum}\\s*episode\\s*(\\d{1,2})\\s*[-–—]\\s*(\\d{1,2})`, 'i'),
        // Stagione 1 Episodio 1-10 (Italian)
        new RegExp(`stagione\\s*${seasonNum}\\s*episodio\\s*(\\d{1,2})\\s*[-–—]\\s*(\\d{1,2})`, 'i'),
        // S01 01-10 (Loose)
        new RegExp(`s${seasonStr}\\s+(\\d{1,2})\\s*[-–—]\\s*(\\d{1,2})`, 'i')
    ];

    for (const pattern of episodeRangePatterns) {
        const rangeMatch = lightCleanedTitle.match(pattern);
        if (rangeMatch) {
            const startEp = parseInt(rangeMatch[1]);
            const endEp = parseInt(rangeMatch[2]);
            if (episodeNum >= startEp && episodeNum <= endEp) {
                console.log(`✅ [EPISODE RANGE] Match for "${torrentTitle}" S${seasonStr}E${startEp}-${endEp} contains E${episodeStr}`);
                return true;
            }
        }
    }

    // ✅ NUOVA LOGICA: Se non trova l'episodio esatto, cerca SEASON PACK
    // Es: "Simpson Stagione 27", "Simpson S27", "Simpson Season 27 Complete"
    const seasonPackPatterns = [
        // Italiano
        new RegExp(`stagione\\s*${seasonNum}(?!\\d)`, 'i'),
        new RegExp(`stagione\\s*${seasonStr}(?!\\d)`, 'i'),
        // Inglese
        new RegExp(`season\\s*${seasonNum}(?!\\d)`, 'i'),
        new RegExp(`season\\s*${seasonStr}(?!\\d)`, 'i'),
        // Formato compatto S01 o S1
        // Dopo normalizzazione: "S01.1080p" → "s011080p", "S01.ITA" → "s01ita"
        // Pattern intelligente: riconosce resolution (480-2160p), anni (1900-2099), parole (ita/eng/complete)
        new RegExp(
            `s${seasonStr}(?:` +
            `(?:480|720|1080|1440|2160)p?|` +  // Resolution comuni
            `(?:19|20)\\d{2}|` +                // Anno
            `[a-z]{2,}|` +                      // Parola (ita, eng, multi, complete, etc.)
            `\\s|$` +                           // Spazio o fine stringa
            `)`,
            'i'
        ),
        // S1 (single digit) - stesso approccio ma evita S1E
        new RegExp(
            `s0*${seasonNum}(?:` +
            `(?:480|720|1080|1440|2160)p?|` +
            `(?:19|20)\\d{2}|` +
            `[a-z]{2,}|` +
            `\\s|$` +
            `)(?!e)`,  // NON seguito da 'e' (evita S1E)
            'i'
        ),
        // Complete pack con keywords
        new RegExp(`s${seasonStr}.*(?:completa|complete|full|series)`, 'i'),
        new RegExp(`(?:completa|complete|full|series).*s${seasonStr}`, 'i')
    ];

    const seasonPackMatch = seasonPackPatterns.some(pattern => pattern.test(normalizedTorrentTitle));
    if (seasonPackMatch) {
        console.log(`✅ [SEASON PACK] Match for "${torrentTitle}" contains Season ${seasonNum}`);
        return true;
    }

    // ✅ COMPLETE SERIES PACK: Check for [COMPLETA] / [COMPLETE] / [FULL SERIES] without specific season number
    // This handles anime and series that are packaged as complete series (e.g., "Death Note (2006) [COMPLETA]")
    // Also supports year ranges like (2011-2019) which indicate full series run
    const completeSeriesPattern = /(?:completa?|complete|full.*series|serie.*completa?|integrale|\(\d{4}-\d{4}\))/i;
    if (completeSeriesPattern.test(normalizedTorrentTitle)) {
        // Only match if there's NO explicit season number (avoids false positives like "S02 COMPLETA")
        const hasExplicitSeason = /(?:stagione|season|s)\s*\d{1,2}/i.test(normalizedTorrentTitle);
        if (!hasExplicitSeason) {
            console.log(`✅ [COMPLETE SERIES] Match for "${torrentTitle}" - complete series pack (no explicit season)`);
            return true;
        }
    }

    // ✅ MULTI-SEASON RANGE: Check if season is within a range (e.g., "S01-S10" includes S08)
    // Patterns: S01-S10, Season 1-10, Stagione 1-10, S1-S10, etc.
    // Must use lightCleanedTitle to preserve dashes!
    const multiSeasonRangePattern = /(?:s|season|stagione)\s*(\d{1,2})\s*[-–—]\s*(?:s|season|stagione)?\s*(\d{1,2})/i;
    const seasonRangeMatch = lightCleanedTitle.match(multiSeasonRangePattern);
    if (seasonRangeMatch) {
        const startSeason = parseInt(seasonRangeMatch[1]);
        const endSeason = parseInt(seasonRangeMatch[2]);
        console.log(`🔍 [MULTI-SEASON CHECK] "${torrentTitle}" has range S${startSeason}-S${endSeason}, checking if Season ${seasonNum} is included...`);
        if (seasonNum >= startSeason && seasonNum <= endSeason) {
            console.log(`✅ [MULTI-SEASON RANGE] Match for "${torrentTitle}" S${startSeason}-S${endSeason} contains Season ${seasonNum}`);
            return true;
        } else {
            console.log(`❌ [MULTI-SEASON RANGE] Season ${seasonNum} is NOT in range S${startSeason}-S${endSeason}`);
        }
    }

    console.log(`❌ No match for "${torrentTitle}" S${seasonStr}E${episodeStr}`);
    return false;
}

function isExactMovieMatch(torrentTitle, movieTitle, year) {
    if (!torrentTitle || !movieTitle) return false;

    // SMART POSITION-AWARE NORMALIZATION

    // Step 1: Check for YEAR RANGE first (YYYY-YYYY) - for collections/trilogies
    const rangeMatch = torrentTitle.match(/\(?\s*(\d{4})\s*-\s*(\d{4})\s*\)?/);

    if (rangeMatch) {
        // RANGE FOUND! (e.g., "Matrix Trilogia (1999-2003)" or "Collection 1989-2015")
        const year1 = rangeMatch[1];
        const year2 = rangeMatch[2];
        const rangeIndex = torrentTitle.indexOf(rangeMatch[0]);

        // Get title before the range
        let beforeRange = torrentTitle.substring(0, rangeIndex).trim();

        // Clean beforeRange
        beforeRange = beforeRange
            .replace(/<[^>]*>/g, '')
            .replace(/\[.*?\]/g, '')
            .replace(/\(+/g, ' ')
            .replace(/\)+/g, ' ')
            .replace(/[-_.]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        // Return: title + year range (e.g., "matrix trilogia 1999-2003")
        torrentTitle = `${beforeRange} ${year1}-${year2}`;
    }

    // Step 2: Find single year BEFORE any cleanup to determine its position
    const titleYearMatch = torrentTitle.match(/\b((?:19|20)\d{2})\b/);

    if (!rangeMatch && !titleYearMatch) {
        // NO YEAR: Extract first 5 meaningful words (skip technical terms)
        let words = torrentTitle
            .replace(/<[^>]*>/g, '')
            .replace(/\[.*?\]/g, '')
            .replace(/\(.*?\)/g, '')
            .replace(/[-_.]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 0);

        let meaningfulWords = [];
        const techPattern = /^(?:480|720|1080|1440|2160|160|576|4K|8K|HD|UHD|FHD|FullHD|SD|HDR|HDR10|DV|x264|x265|H264|H265|HEVC|BluRay|WEBRip|WEBDL|BDRemux|AAC|AC3|DTS|Atmos|iTA|ENG|ITA|MULTI|SUB|MIRCrew|NAHOM|NeoNoir|FHC)$/i;

        for (let word of words) {
            if (!techPattern.test(word) && !/^\d+\.?\d*$/.test(word)) {
                meaningfulWords.push(word);
                if (meaningfulWords.length >= 5) break;
            }
        }

        torrentTitle = meaningfulWords.join(' ');
    } else if (!rangeMatch && titleYearMatch) {
        const foundYear = titleYearMatch[1];
        const yearIndex = torrentTitle.indexOf(foundYear);
        const beforeYear = torrentTitle.substring(0, yearIndex).trim();

        // Check if there's meaningful content before year (not just brackets/punctuation)
        const cleanBeforeYear = beforeYear.replace(/[\[\](){}]/g, '').replace(/[^\w\s]/g, ' ').trim();
        const hasContentBeforeYear = cleanBeforeYear.length > 3;

        if (hasContentBeforeYear) {
            // YEAR IS AFTER TITLE (98% of cases: "Title (2025)" or "Title 2025")
            // Strategy: Keep title + year, remove everything after
            let cleanTitle = beforeYear
                .replace(/<[^>]*>/g, '')
                .replace(/\[.*?\]/g, '')
                .replace(/\(+/g, ' ')
                .replace(/\)+/g, ' ')
                .replace(/[-_.]+/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            torrentTitle = cleanTitle + ' ' + foundYear;
        } else {
            // YEAR IS AT START (1.4% of cases: "[2025] Title" or "2025 Title")
            // Strategy: Remove year, clean title after it, take first 5 words
            let afterYear = torrentTitle.substring(yearIndex + 4).trim();
            afterYear = afterYear.replace(/^\s*[\[\](){}]\s*/, '');

            // Aggressive cleanup
            afterYear = afterYear
                .replace(/\b(?:480|720|1080|1440|2160|160|576)p?\b/gi, '')
                .replace(/\b(?:4K|8K|HD|UHD|FHD|FullHD|SD)\b/gi, '')
                .replace(/\b(?:HDR|HDR10|HDR10\+|DV|Dolby\.?Vision|SDR)\b/gi, '')
                .replace(/\b(?:BluRay|BDRip|BDRemux|WEBRip|WEBDL|WEB-DL|WEB|BRRip|DVDRip)\b/gi, '')
                .replace(/\b(?:x264|x265|H\.?264|H\.?265|HEVC|AVC)\b/gi, '')
                .replace(/\b(?:AAC|AC3|DDP5\.1|DDP|DTS|Atmos|EAC3|MP3)\b/gi, '')
                .replace(/\b(?:10Bit|10bit|8bit)\b/gi, '')
                .replace(/\b(?:REMASTERED|UNRATED|EXTENDED|REPACK|IMAX|OPEN\.?MATTE|CUSTOM|EXPANDED|EDITION)\b/gi, '')
                .replace(/\b(?:iTA|ENG|ITA|IND|JAP|CHI|KOR|DEU|FRE|Ita|Eng|THD|ATMOS)\s+(?:ENG|ITA|Eng|Ita|DTS|AAC|AC3|\d+\.?\d*)\b/g, '')
                .replace(/\b(?:MULTI|MULTi|MULTISUB|NUita|NUeng|NUITA|NUENG)\b/gi, '')
                .replace(/\bsub\s+(?:ita|eng|nuita|nueng)\b/gi, '')
                .replace(/\b(?:MIRCrew|NAHOM|NeoNoir|PSA|FHC_CREW|FHC|Dr4gon|realDMDJ|Paso77|TheEmojiCreW|Licdom|phadron|ZEI|HD4ME|jeddak|Sp33dy94|UBi|Disney)\b/gi, '')
                .replace(/\b(?:by\s+[\w]+)\b/gi, '')
                .replace(/\b(?:ita|eng|jap|chi|ind|kor|deu|fre)\b/gi, '')
                .replace(/\bsub\b/gi, '')
                .replace(/\b\d+\.\d+\b/gi, '')
                .replace(/\bmkv\b/gi, '')
                .replace(/\[.*?\]/g, '')
                .replace(/\(.*?\)/g, '')
                .replace(/[-_.]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            // Take first 5 meaningful words
            let words = afterYear.split(/\s+/).filter(w => w.length > 2);
            if (words.length > 5) words = words.slice(0, 5);
            torrentTitle = words.join(' ');
        }
    }

    const normalizedTorrentTitle = torrentTitle.toLowerCase().trim();
    const normalizedMovieTitle = movieTitle.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    let hasEnoughMovieWords;

    const movieWords = normalizedMovieTitle.split(' ').filter(word => word.length > 2 && !['the', 'and', 'or', 'in', 'on', 'at', 'to'].includes(word));

    if (movieWords.length === 0) {
        // Handle very short titles like "F1" or "IT" where word-based matching would fail
        const titleRegex = new RegExp(`\\b${normalizedMovieTitle.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
        hasEnoughMovieWords = titleRegex.test(normalizedTorrentTitle);
    } else {
        const matchingWords = movieWords.filter(word =>
            normalizedTorrentTitle.includes(word)
        );
        const percentageMatch = matchingWords.length / movieWords.length;
        hasEnoughMovieWords = percentageMatch >= 0.7;
        if (!hasEnoughMovieWords) {
            console.log(`❌ Movie match failed for "${torrentTitle}" - ${percentageMatch.toFixed(2)} match`);
        }
    }

    if (!hasEnoughMovieWords) {
        return false;
    }

    const yearMatch = torrentTitle.match(/(?:19|20)\d{2}/);

    const yearMatches = !yearMatch ||
        yearMatch[0] === year.toString() ||
        Math.abs(parseInt(yearMatch[0]) - parseInt(year)) <= 1;

    console.log(`${yearMatches ? '✅' : '❌'} Year match for "${torrentTitle}" (${year})`);
    return yearMatches;
}

/**
 * Match the best file in a pack torrent for a specific movie
 * @param {Array} files - Array of files from torrent info
 * @param {Object} movieDetails - Movie details (title, originalTitle, year)
 * @returns {number|null} - Best matching file index or null
 */
function matchPackFile(files, movieDetails) {
    if (!files || files.length === 0) return null;

    const { title, originalTitle, year } = movieDetails;
    console.log(`🎯 [Pack] Matching file for: ${title} (${originalTitle}) [${year}]`);

    // Normalize titles for comparison
    const normalizeTitle = (str) => str.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const italianWords = normalizeTitle(title).split(' ');
    const englishWords = originalTitle ? normalizeTitle(originalTitle).split(' ') : [];

    let bestScore = 0;
    let bestFileIndex = null;

    files.forEach((file, index) => {
        const filename = normalizeTitle(file.path || '');
        let score = 0;

        // Skip non-video files
        const videoExtensions = /\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v)$/i;
        if (!videoExtensions.test(file.path)) {
            return;
        }

        // Level 1: Title match (70% of score)
        // Italian title: 40%
        const italianMatches = italianWords.filter(word =>
            word.length > 2 && filename.includes(word)
        ).length;
        const italianScore = (italianMatches / italianWords.length) * 0.4;
        score += italianScore;

        // English title: 30%
        if (englishWords.length > 0) {
            const englishMatches = englishWords.filter(word =>
                word.length > 2 && filename.includes(word)
            ).length;
            const englishScore = (englishMatches / englishWords.length) * 0.3;
            score += englishScore;
        }

        // Level 2: Sequence number match (20% of score)
        // Extract part numbers: "Part II", "Parte 2", "II", "2", etc.
        const partMatch = filename.match(/\b(?:part|parte|chapter|capitolo)?\s*([ivxIVX]+|[0-9]+)\b/);
        if (partMatch) {
            const partNum = partMatch[1];
            // Check if this number/numeral appears in the title
            if (title.includes(partNum) || (originalTitle && originalTitle.includes(partNum))) {
                score += 0.2;
            }
        }

        // Level 3: Year match (10% of score)
        const yearMatch = filename.match(/\b(19[2-9]\d|20[0-3]\d)\b/);
        if (yearMatch && yearMatch[1] === year.toString()) {
            score += 0.1;
        }

        console.log(`📁 [Pack] File ${index}: ${file.path.substring(0, 50)}... - Score: ${(score * 100).toFixed(1)}%`);

        if (score > bestScore) {
            bestScore = score;
            bestFileIndex = index;
        }
    });

    if (bestFileIndex !== null) {
        console.log(`✅ [Pack] Best match: File ${bestFileIndex} (${files[bestFileIndex].path}) - Score: ${(bestScore * 100).toFixed(1)}%`);
    } else {
        console.log(`❌ [Pack] No suitable file found in pack`);
    }

    return bestFileIndex;
}

// ✅ Enhanced stream handler with better error handling and logging
async function handleStream(type, id, config, workerOrigin) {
    maybeCleanupCache();

    // The ID from Stremio might be URL-encoded, especially on Android.
    const decodedId = decodeURIComponent(id);

    console.log(`\n🎯 Processing ${type} with ID: ${decodedId}`);

    const startTime = Date.now();

    try {
        // ✅ TMDB API Key from config or environment variable
        const tmdbKey = config.tmdb_key || process.env.TMDB_KEY || process.env.TMDB_API_KEY || '5462f78469f3d80bf5201645294c16e4';

        if (!tmdbKey) {
            console.error('❌ TMDB API key not configured');
            return { streams: [] };
        }

        // ✅ Use debrid services factory (supports RD, Torbox, and AllDebrid)
        const debridServices = createDebridServices(config);
        const useRealDebrid = debridServices.useRealDebrid;
        const useTorbox = debridServices.useTorbox;
        const useAllDebrid = debridServices.useAllDebrid;
        const rdService = debridServices.realdebrid;
        const torboxService = debridServices.torbox;
        const adService = debridServices.alldebrid;

        let imdbId = null;
        let kitsuId = null;
        let season = null;
        let episode = null;
        let mediaDetails = null;

        if (decodedId.startsWith('kitsu:')) {
            const parts = decodedId.split(':');
            kitsuId = parts[1];
            const absoluteEpisode = parts[2]; // For Kitsu, this is absolute episode number (optional for movies)

            // ✅ If no episode number, it's a MOVIE (e.g., kitsu:45513 = One Piece Film Red)
            if (!absoluteEpisode && type === 'movie') {
                console.log(`🎬 Looking up Kitsu movie details for: ${kitsuId}`);
                mediaDetails = await getKitsuDetails(kitsuId);

                if (mediaDetails) {
                    mediaDetails.isAnime = true;  // Mark as anime for special handling
                    // For movies, we don't need episode info
                }
            } else if (!absoluteEpisode && type === 'series') {
                // Series MUST have episode number
                console.log('❌ Invalid Kitsu format: episode number required for series');
                return { streams: [] };
            } else {
                // Series with episode number
                console.log(`🌸 Looking up Kitsu details for: ${kitsuId}, absolute episode: ${absoluteEpisode}`);
                mediaDetails = await getKitsuDetails(kitsuId);

                if (mediaDetails) {
                    mediaDetails.absoluteEpisode = parseInt(absoluteEpisode);
                    mediaDetails.isAnime = true;  // Mark as anime for special handling

                    // ✅ SOLUZIONE KITSU 5: Convert absolute episode to season/episode if we have TMDb ID
                    if (mediaDetails.tmdbId) {
                        console.log(`🔄 [Kitsu] Converting absolute episode ${absoluteEpisode} to season/episode using TMDb ${mediaDetails.tmdbId}...`);
                        const converted = await convertAbsoluteEpisode(mediaDetails.tmdbId, parseInt(absoluteEpisode), tmdbKey);

                        if (converted) {
                            season = converted.season;
                            episode = converted.episode;
                            console.log(`✅ [Kitsu] Converted to S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`);
                        } else {
                            // Fallback: treat as absolute episode without season mapping
                            console.log(`⚠️ [Kitsu] Could not convert absolute episode, will search all packs`);
                            season = null;
                            episode = absoluteEpisode;
                        }
                    } else {
                        // No TMDb ID, can't convert - fallback to generic pack search
                        console.log(`⚠️ [Kitsu] No TMDb ID available, will search all packs`);
                        season = null;
                        episode = absoluteEpisode;
                    }
                }
            }
        } else {
            // ✅ SOLUZIONE 2: Detect if ID is TMDb (pure number) or IMDb (starts with 'tt')
            imdbId = decodedId;
            if (type === 'series') {
                const parts = decodedId.split(':');
                imdbId = parts[0];
                season = parts[1];
                episode = parts[2];

                if (!season || !episode) {
                    console.log('❌ Invalid series format');
                    return { streams: [] };
                }
            }

            // Check if ID is TMDb (pure number) or IMDb (starts with 'tt')
            if (imdbId.startsWith('tt')) {
                // IMDb ID format
                const cleanImdbId = extractImdbId(imdbId);
                if (!cleanImdbId) {
                    console.log('❌ Invalid IMDB ID format');
                    return { streams: [] };
                }

                console.log(`🔍 Looking up TMDB details for IMDb: ${cleanImdbId}`);
                mediaDetails = await getTMDBDetailsByImdb(cleanImdbId, tmdbKey);
            } else if (/^\d+$/.test(imdbId)) {
                // TMDb ID format (pure number)
                const tmdbId = parseInt(imdbId);
                console.log(`🔍 Looking up details for TMDb: ${tmdbId}`);
                mediaDetails = await getTMDBDetailsByTmdb(tmdbId, type, tmdbKey);
            } else {
                console.log('❌ Invalid ID format (not IMDb or TMDb)');
                return { streams: [] };
            }
        }

        if (!mediaDetails) {
            // ✅ FALLBACK: If TMDB conversion failed, try direct IMDb scraping
            if (imdbId && imdbId.startsWith('tt')) {
                console.log(`⚠️ TMDB lookup failed. Attempting direct IMDb fallback for ${imdbId}...`);
                mediaDetails = await getIMDbDetailsDirectly(imdbId);
            }
        }

        if (!mediaDetails) {
            console.log('❌ Could not find media details (even after fallback)');
            return { streams: [] };
        }

        // --- NUOVA MODIFICA: Ottieni il titolo in italiano ---
        let italianTitle = null;
        let originalTitle = null;
        if (mediaDetails.tmdbId && !kitsuId) { // Solo per film/serie da TMDB
            try {
                // Convert 'series' to 'tv' for TMDB API
                const tmdbType = mediaDetails.type === 'series' ? 'tv' : 'movie';
                console.log(`🔍 [Italian Title] Using TMDB type: ${tmdbType} for mediaDetails.type: ${mediaDetails.type}`);

                // 1. Prima chiamata: ottieni dettagli in italiano (language=it-IT)
                const italianDetails = await getTMDBDetails(mediaDetails.tmdbId, tmdbType, tmdbKey, 'external_ids', 'it-IT');
                console.log(`🔍 [Italian Title] TMDB response with language=it-IT received`);

                if (italianDetails) {
                    const italianTitleFromResponse = italianDetails.title || italianDetails.name;
                    console.log(`🔍 [Italian Title] Found title from it-IT response: "${italianTitleFromResponse}"`);

                    // Usa il titolo italiano se è diverso da quello inglese
                    if (italianTitleFromResponse && italianTitleFromResponse.toLowerCase() !== mediaDetails.title.toLowerCase()) {
                        italianTitle = italianTitleFromResponse;
                        console.log(`🇮🇹 Found Italian title from language=it-IT: "${italianTitle}"`);
                    } else if (italianTitleFromResponse) {
                        console.log(`⚠️ [Italian Title] Title from it-IT "${italianTitleFromResponse}" is same as English, will try translations`);
                    }

                    // Salva anche l'original_title/original_name
                    if (italianDetails.original_title || italianDetails.original_name) {
                        const foundOriginalTitle = italianDetails.original_title || italianDetails.original_name;
                        if (foundOriginalTitle && foundOriginalTitle.toLowerCase() !== mediaDetails.title.toLowerCase()) {
                            originalTitle = foundOriginalTitle;
                            console.log(`� Found original title: "${originalTitle}"`);
                        }
                    }
                }

                // 2. Fallback: se non abbiamo trovato il titolo italiano, prova con translations
                if (!italianTitle) {
                    console.log(`🔍 [Italian Title] Trying translations as fallback...`);
                    const detailsWithTranslations = await getTMDBDetails(mediaDetails.tmdbId, tmdbType, tmdbKey, 'translations', 'en-US');

                    if (detailsWithTranslations?.translations?.translations) {
                        console.log(`🔍 [Italian Title] Found ${detailsWithTranslations.translations.translations.length} translations`);
                        const italianTranslation = detailsWithTranslations.translations.translations.find(t => t.iso_639_1 === 'it');

                        if (italianTranslation) {
                            console.log(`🔍 [Italian Title] Italian translation found:`, JSON.stringify(italianTranslation.data));
                            const foundTitle = italianTranslation.data.title || italianTranslation.data.name;
                            if (foundTitle && foundTitle.toLowerCase() !== mediaDetails.title.toLowerCase()) {
                                italianTitle = foundTitle;
                                console.log(`🇮� Found Italian title from translations: "${italianTitle}"`);
                            }
                        } else {
                            console.log(`⚠️ [Italian Title] No Italian (it) translation found in translations array`);
                        }
                    } else {
                        console.log(`⚠️ [Italian Title] No translations data available`);
                    }
                }

                if (!italianTitle) {
                    console.log(`⚠️ [Italian Title] Could not find Italian title for "${mediaDetails.title}"`);
                }
            } catch (e) {
                console.warn("⚠️ Could not fetch Italian title from TMDB:", e.message);
            }
        }
        // --- FINE MODIFICA ---

        // ✅ BUILD TITLES ARRAY: Include all possible titles for matching
        if (!Array.isArray(mediaDetails.titles)) {
            const allTitles = new Set();
            // Always include the main English title
            if (mediaDetails.title) {
                allTitles.add(mediaDetails.title);
                // If title contains ":", also add the part before it (e.g., "Suburra: Blood on Rome" → "Suburra")
                if (mediaDetails.title.includes(':')) {
                    allTitles.add(mediaDetails.title.split(':')[0].trim());
                }
            }
            // Add Italian title if found
            if (italianTitle && italianTitle !== mediaDetails.title) {
                allTitles.add(italianTitle);
                // If Italian title contains ":", also add the part before it
                if (italianTitle.includes(':')) {
                    allTitles.add(italianTitle.split(':')[0].trim());
                }
            }
            // Add original title if different
            if (originalTitle && originalTitle !== mediaDetails.title && originalTitle !== italianTitle) {
                allTitles.add(originalTitle);
                // If original title contains ":", also add the part before it
                if (originalTitle.includes(':')) {
                    allTitles.add(originalTitle.split(':')[0].trim());
                }
            }

            mediaDetails.titles = Array.from(allTitles);
            console.log(`📝 Built titles array: ${JSON.stringify(mediaDetails.titles)}`);
        }

        const displayTitle = Array.isArray(mediaDetails.titles) ? mediaDetails.titles[0] : mediaDetails.title;
        console.log(`✅ Found: ${displayTitle} (${mediaDetails.year})`);

        // ✅ STEP 1: INITIALIZE DATABASE (always try, fallback to hardcoded credentials)
        let dbEnabled = false;
        try {
            // Call initDatabase WITHOUT parameters to use hardcoded fallback credentials
            dbHelper.initDatabase();
            dbEnabled = true;
            console.log('💾 [DB] Database connection initialized');
        } catch (error) {
            console.error('❌ [DB] Failed to initialize database:', error.message);
            console.error('❌ [DB] Will continue without database');
        }

        // ✅ STEP 2: SEARCH DATABASE FIRST (if enabled)
        let dbResults = [];
        if (dbEnabled && mediaDetails.imdbId) {
            if (type === 'series') {
                // ✅ SOLUZIONE KITSU 6: Use converted season/episode if available (from absolute episode)
                if (season !== null && episode !== null) {
                    // We have season/episode (either from original request or Kitsu conversion)
                    console.log(`💾 [DB] Searching for S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')} with IMDb ${mediaDetails.imdbId}`);

                    // Search for specific episode files (with file_index)
                    dbResults = await dbHelper.searchEpisodeFiles(
                        mediaDetails.imdbId,
                        parseInt(season),
                        parseInt(episode)
                    );

                    // 🔥 ALSO search for season packs and complete packs (they don't have file_index)
                    const packResults = await dbHelper.searchByImdbId(mediaDetails.imdbId, type);
                    console.log(`💾 [DB] Found ${packResults.length} additional torrents (packs/complete series)`);

                    // Merge: episode files + packs
                    dbResults = [...dbResults, ...packResults];
                } else {
                    // No season/episode available (Kitsu without TMDb conversion fallback)
                    console.log(`🎌 [Anime] No season mapping available, fetching all packs`);
                    dbResults = await dbHelper.searchByImdbId(mediaDetails.imdbId, type);
                }
            } else {
                // Search for movie - both singles AND packs
                // 📦 PRIORITY 1: Search pack_files first (with file_index)
                const packResults = await dbHelper.searchPacksByImdbId(mediaDetails.imdbId);
                if (packResults && packResults.length > 0) {
                    console.log(`💾 [DB] Found ${packResults.length} pack(s) containing film ${mediaDetails.imdbId}`);
                }

                // PRIORITY 2: Search regular torrents (single movies or packs via all_imdb_ids)
                const regularResults = await dbHelper.searchByImdbId(mediaDetails.imdbId, type);

                // Merge: packs first (with file_index), then regular
                dbResults = [...(packResults || []), ...regularResults];
            }

            // If found in DB, check if IDs are complete and convert if needed
            if (dbResults.length > 0) {
                console.log(`💾 [DB] Found ${dbResults.length} results in database!`);

                // ✅ SOLUZIONE 3: Check if we need to complete IDs and update DB
                const firstResult = dbResults[0];
                if ((firstResult.imdb_id && !firstResult.tmdb_id) ||
                    (!firstResult.imdb_id && firstResult.tmdb_id)) {
                    console.log(`💾 [DB] Completing missing IDs for database results...`);
                    const completed = await completeIds(
                        firstResult.imdb_id,
                        firstResult.tmdb_id,
                        type === 'series' ? 'series' : 'movie'
                    );

                    // Update mediaDetails with completed IDs
                    if (completed.tmdbId && !mediaDetails.tmdbId) {
                        mediaDetails.tmdbId = completed.tmdbId;
                        console.log(`💾 [DB] Populated mediaDetails.tmdbId: ${completed.tmdbId}`);
                    }
                    if (completed.imdbId && !mediaDetails.imdbId) {
                        mediaDetails.imdbId = completed.imdbId;
                        console.log(`💾 [DB] Populated mediaDetails.imdbId: ${completed.imdbId}`);
                    }

                    // ✅ SOLUZIONE 3: Update DB with completed IDs (auto-repair)
                    if (completed.imdbId || completed.tmdbId) {
                        console.log(`💾 [DB] Auto-repairing ${dbResults.length} torrents with completed IDs...`);
                        // Extract all info_hash from dbResults
                        const infoHashes = dbResults.map(r => r.info_hash).filter(Boolean);
                        if (infoHashes.length > 0) {
                            const updatedCount = await dbHelper.updateTorrentsWithIds(
                                infoHashes,           // ALL hashes from DB results
                                completed.imdbId,     // Populate missing imdb_id
                                completed.tmdbId      // Populate missing tmdb_id
                            );
                            if (updatedCount > 0) {
                                console.log(`✅ [DB] Auto-repaired ${updatedCount} torrent(s) with completed IDs`);
                            }
                        }
                    }
                }
            }
        }

        // ✅ STEP 3: If no results in DB and we have TMDb ID, try searching by TMDb
        if (dbEnabled && dbResults.length === 0 && mediaDetails.tmdbId) {
            console.log(`💾 [DB] No results by IMDb, trying TMDb ID: ${mediaDetails.tmdbId}`);

            // 🔥 FIX: For series with episode info, get imdbId from TMDb first and use searchEpisodeFiles
            if (type === 'series' && season && episode) {
                try {
                    // Get IMDb ID from TMDb torrents table
                    const tmdbTorrents = await dbHelper.searchByTmdbId(mediaDetails.tmdbId, type);
                    if (tmdbTorrents.length > 0 && tmdbTorrents[0].imdb_id) {
                        const imdbId = tmdbTorrents[0].imdb_id;
                        console.log(`💾 [DB] Found imdbId ${imdbId} from TMDb, searching episode files...`);

                        // Search episode files
                        const episodeFiles = await dbHelper.searchEpisodeFiles(imdbId, parseInt(season), parseInt(episode));
                        console.log(`💾 [DB] Found ${episodeFiles.length} files for S${season}E${episode}`);

                        // 🔥 ALSO get all torrents (for packs)
                        console.log(`💾 [DB] Also fetching all torrents for packs...`);
                        dbResults = [...episodeFiles, ...tmdbTorrents];
                        console.log(`💾 [DB] Total: ${dbResults.length} results (files + packs)`);
                    } else {
                        // Fallback: use TMDb search (won't have file_title)
                        dbResults = tmdbTorrents;
                    }
                } catch (err) {
                    console.error(`❌ [DB] Error searching episode files by TMDb:`, err.message);
                    dbResults = await dbHelper.searchByTmdbId(mediaDetails.tmdbId, type);
                }
            } else {
                // For movies or when no episode info, use regular TMDb search
                dbResults = await dbHelper.searchByTmdbId(mediaDetails.tmdbId, type);
            }

            if (dbResults.length > 0) {
                console.log(`💾 [DB] Found ${dbResults.length} results by TMDb ID!`);

                // ✅ SOLUZIONE 3: Auto-repair IDs when found via TMDb but missing IMDb
                const firstResult = dbResults[0];
                if (firstResult.tmdb_id && !firstResult.imdb_id && mediaDetails.imdbId) {
                    console.log(`💾 [DB] Auto-repairing ${dbResults.length} torrents found via TMDb (missing IMDb)...`);
                    // Extract all info_hash from dbResults
                    const infoHashes = dbResults.map(r => r.info_hash).filter(Boolean);
                    if (infoHashes.length > 0) {
                        const updatedCount = await dbHelper.updateTorrentsWithIds(
                            infoHashes,           // ALL hashes from DB results
                            mediaDetails.imdbId,  // Populate missing imdb_id
                            mediaDetails.tmdbId   // Keep tmdb_id
                        );
                        if (updatedCount > 0) {
                            console.log(`✅ [DB] Auto-repaired ${updatedCount} torrent(s) with IMDb ID`);
                        }
                    }
                }
            }
        }

        // ✅ STEP 4: If still no results, try FULL-TEXT SEARCH (FTS) as fallback
        if (dbEnabled && dbResults.length === 0 && mediaDetails && mediaDetails.title) {
            console.log(`💾 [DB] No results by ID. Trying Full-Text Search (FTS)...`);

            // Helper to extract short title (before ":" or "-")
            const extractShortTitle = (title) => {
                if (!title) return null;

                // Try splitting by ":" first
                if (title.includes(':')) {
                    const short = title.split(':')[0].trim();
                    if (short.length > 0) return short;
                }

                // Try splitting by " - " (with spaces)
                if (title.includes(' - ')) {
                    const short = title.split(' - ')[0].trim();
                    if (short.length > 0) return short;
                }

                return null;
            };

            // Import cleanTitleForSearch for title cleaning
            // Note: We need to replicate the logic here since it's not exported from daily-scraper
            const cleanTitleForFTS = (title) => {
                if (!title) return '';
                let cleaned = title;
                cleaned = cleaned.replace(/\.(mkv|mp4|avi|mov)$/gi, '');
                cleaned = cleaned.replace(/^\s*[\[\(]\d{4}[\]\)]\s*/g, '');
                const beforeSeriesPattern = cleaned.match(/^(.+?)(?:\s*[\s._-]*(?:Stagion[ei]|Season[s]?|EP\.?|S\d{1,2}|\d{1,2}x\d{1,2}|19\d{2}|20\d{2}|\d{4}))/i);
                if (beforeSeriesPattern) {
                    cleaned = beforeSeriesPattern[1];
                    cleaned = cleaned.replace(/[\s._-]+$/g, '');
                } else {
                    cleaned = cleaned.replace(/[\s._-]*Stagion[ei].*/gi, '');
                    cleaned = cleaned.replace(/[\s._-]*Season[s]?.*/gi, '');
                    cleaned = cleaned.replace(/[\s._-]*S\d{2}(E\d{2})?(-S?\d{2})?(E\d{2})?/gi, '');
                    cleaned = cleaned.replace(/[\s._-]*\d{1,2}x\d{1,2}/gi, '');
                    cleaned = cleaned.replace(/[\s._-]*EP\.?\s*\d{1,2}/gi, '');
                }
                cleaned = cleaned.replace(/\[.*?\]/g, '');
                cleaned = cleaned.replace(/\(.*?\)/g, '');
                cleaned = cleaned.replace(/[\(\[]\s*$/g, '');
                cleaned = cleaned.replace(/\b(COMPLETA?|Completa?|FULL|Complete|Miniserie|MiniSerieTV|SERIE|Serie|SerieTV|TV|EXTENDED|Extended)\b/gi, '');
                cleaned = cleaned.replace(/\bDirector'?s?\s*Cut\b/gi, '');
                cleaned = cleaned.replace(/\bUncut\b/gi, '');
                cleaned = cleaned.replace(/\bStagion[ei].*/gi, '');
                cleaned = cleaned.replace(/\bSeason[s]?.*/gi, '');
                cleaned = cleaned.replace(/\d{2,3}-\d{2,3}\/\d{2,3}/g, '');
                cleaned = cleaned.replace(/\?\?/g, '');
                cleaned = cleaned.replace(/[._-]+/g, ' ');
                cleaned = cleaned.replace(/\b(SD|HD|720p|1080p|2160p|4K|UHD|BluRay|WEB DL|WEBRip|HDTV|DVDRip|BRRip|WEBDL)\b/gi, '');
                cleaned = cleaned.replace(/\b(ITA|ENG|SPA|FRA|GER|JAP|KOR|MULTI|Multisub|SubS?|DUB|NFRip)\b/gi, '');
                cleaned = cleaned.replace(/\b(DV|HDR|HDR10|HDR10Plus|H264|H265|H 264|H 265|x264|x265|HEVC|AVC|10bit|AAC|AC3|Mp3|DD5? 1|DTS|Atmos|DDP\d+ ?\d*)\b/gi, '');
                cleaned = cleaned.replace(/\b(AMZN|NF|DSNP|HULU|HBO|ATVP|WEBMUX)\b/gi, '');
                cleaned = cleaned.replace(/\b(MeM|GP|TheBlackKing|TheWhiteQueen|MIRCrew|FGT|RARBG|YTS|YIFY|ION10|PSA|FLUX|NAHOM|V3SP4|Notorious)\b/gi, '');
                cleaned = cleaned.replace(/\bby[A-Za-z0-9]+\b/gi, '');
                cleaned = cleaned.replace(/\s+/g, ' ').trim();
                cleaned = cleaned.replace(/\s+(L'|Il |La |Gli |I |Le |Lo |Un |Una |Uno )[a-zàèéìòù']+(\s+[a-zàèéìòù']+)*$/g, '');
                cleaned = cleaned.replace(/[\s-]+$/g, '').trim();
                return cleaned;
            };

            const cleanedTitle = cleanTitleForFTS(mediaDetails.title);
            console.log(`💾 [DB FTS] Cleaned title: "${cleanedTitle}"`);

            try {
                // ✅ PHASE 1: Try with full title first
                dbResults = await dbHelper.searchByTitleFTS(
                    cleanedTitle,
                    type,
                    mediaDetails.year
                );

                // ✅ PHASE 2: If no results and title has ":" or "-", try short title
                if (dbResults.length === 0) {
                    const shortTitle = extractShortTitle(mediaDetails.title);
                    if (shortTitle && shortTitle !== mediaDetails.title) {
                        const cleanedShortTitle = cleanTitleForFTS(shortTitle);
                        console.log(`💾 [DB FTS] No results with full title. Trying short title: "${cleanedShortTitle}"`);

                        dbResults = await dbHelper.searchByTitleFTS(
                            cleanedShortTitle,
                            type,
                            mediaDetails.year
                        );

                        if (dbResults.length > 0) {
                            console.log(`💾 [DB FTS Fallback] Found ${dbResults.length} results with short title!`);
                        }
                    }
                }

                if (dbResults.length > 0) {
                    console.log(`💾 [DB FTS] Found ${dbResults.length} results via Full-Text Search!`);

                    // If we found results with FTS but they have NULL IDs, try to populate them
                    const firstResult = dbResults[0];
                    if (firstResult.imdb_id && !mediaDetails.imdbId) {
                        mediaDetails.imdbId = firstResult.imdb_id;
                        console.log(`💾 [DB FTS] Populated imdbId from FTS result: ${firstResult.imdb_id}`);
                    }
                    if (firstResult.tmdb_id && !mediaDetails.tmdbId) {
                        mediaDetails.tmdbId = firstResult.tmdb_id;
                        console.log(`💾 [DB FTS] Populated tmdbId from FTS result: ${firstResult.tmdb_id}`);
                    }
                } else {
                    console.log(`💾 [DB FTS] No results found. Will search online sources...`);
                }
            } catch (error) {
                console.error(`❌ [DB FTS] Search failed:`, error.message);
                // Continue to live search
            }

            // Try to complete missing IDs for better matching later
            if ((mediaDetails.imdbId && !mediaDetails.tmdbId) ||
                (!mediaDetails.imdbId && mediaDetails.tmdbId)) {
                console.log(`🔄 Completing missing media IDs for future use...`);
                const completed = await completeIds(
                    mediaDetails.imdbId,
                    mediaDetails.tmdbId,
                    type === 'series' ? 'series' : 'movie'
                );

                if (completed.imdbId) mediaDetails.imdbId = completed.imdbId;
                if (completed.tmdbId) mediaDetails.tmdbId = completed.tmdbId;
            }
        }

        // ✅ 3-TIER STRATEGY: Check if we should skip live search FOR CORSARO (Tier 1/2 -> Tier 3)
        // Knaben and UIndex will ALWAYS run if enabled (Parallel Flow)
        let skipLiveSearch = dbResults.length > 0;

        // 📺 For series: check if at least one result matches the requested season
        // If all results are from different seasons, we should still do live search for Corsaro
        if (skipLiveSearch && type === 'series' && season) {
            const seasonNum = parseInt(season);
            const hasMatchingSeason = dbResults.some(result => {
                const title = result.title || result.torrent_title || '';

                // 1. Check singola stagione: S02E01, S02 , Stagione 2, Season 2
                //    Usa (?![0-9]) per evitare che S2 matchi S21 o S22
                const singleSeasonPattern = new RegExp(
                    `[Ss](0?${season})(?![0-9])([Ee\\s]|$|[^0-9])|[Ss]tagione\\s*${season}(?![0-9])|[Ss]eason\\s*${season}(?![0-9])`, 'i'
                );
                if (singleSeasonPattern.test(title)) {
                    console.log(`✅ [TIER CHECK] Single season match for "${title.substring(0, 60)}..."`);
                    return true;
                }

                // 2. Check range multi-stagione: S01-08, S1-8, S01-S08, S01 S08
                const rangeMatch = title.match(/[Ss](0?\d+)[-–\s]+[Ss]?(0?\d+)/i);
                if (rangeMatch) {
                    const startSeason = parseInt(rangeMatch[1]);
                    const endSeason = parseInt(rangeMatch[2]);
                    if (seasonNum >= startSeason && seasonNum <= endSeason) {
                        console.log(`✅ [TIER CHECK] Range S${startSeason}-S${endSeason} contains Season ${season}`);
                        return true;
                    }
                }

                // 3. Check range "Stagioni 01-08", "Stagioni 1 a 8"
                const stagioniMatch = title.match(/[Ss]tagioni?\s*(0?\d+)[-–\s]+(?:a\s*)?(0?\d+)/i);
                if (stagioniMatch) {
                    const startSeason = parseInt(stagioniMatch[1]);
                    const endSeason = parseInt(stagioniMatch[2]);
                    if (seasonNum >= startSeason && seasonNum <= endSeason) {
                        console.log(`✅ [TIER CHECK] Stagioni ${startSeason}-${endSeason} contains Season ${season}`);
                        return true;
                    }
                }

                // 4. Check "S01 a S08" pattern
                const aRangeMatch = title.match(/[Ss](0?\d+)\s+a\s+[Ss](0?\d+)/i);
                if (aRangeMatch) {
                    const startSeason = parseInt(aRangeMatch[1]);
                    const endSeason = parseInt(aRangeMatch[2]);
                    if (seasonNum >= startSeason && seasonNum <= endSeason) {
                        console.log(`✅ [TIER CHECK] S${startSeason} a S${endSeason} contains Season ${season}`);
                        return true;
                    }
                }

                // 5. Check serie completa
                if (/\[COMPLETA\]|Complete\s*Series|Tutte\s*le\s*stagioni|Serie\s*Completa/i.test(title)) {
                    console.log(`✅ [TIER CHECK] Complete series detected: "${title.substring(0, 60)}..."`);
                    return true;
                }

                return false;
            });

            if (!hasMatchingSeason) {
                console.log(`⚠️ [3-Tier] Found ${dbResults.length} results but none match Season ${season} - will do live search for Corsaro`);
                skipLiveSearch = false;
            }
        }

        if (skipLiveSearch) {
            console.log(`✅ [3-Tier] Found ${dbResults.length} results from DB/FTS. Skipping Corsaro live search.`);
        } else {
            console.log(`🔍 [3-Tier] No results from DB/FTS. Proceeding to Corsaro live search.`);
        }

        // Build search queries (ALWAYS - needed for both live search AND enrichment)
        const searchQueries = [];
        let finalSearchQueries = []; // Declare here, outside the conditional blocks

        // 🧹 Helper function to clean title for search (remove . - : symbols)
        const cleanTitleForSearch = (title) => {
            if (!title) return '';
            return title
                .replace(/[.\-:]/g, ' ')  // Replace . - : with spaces
                .replace(/\s+/g, ' ')      // Collapse multiple spaces
                .trim()
                .toLowerCase();
        };

        // Helper function to generate queries for a given title (SERIES ONLY)
        // isItalianTitle flag indicates if this is the Italian title (higher priority)
        const addQueriesForTitle = (title, label = '', isItalianTitle = false) => {
            if (!title || type !== 'series' || kitsuId) return;

            const seasonStr = String(season).padStart(2, '0');
            const episodeStr = String(episode).padStart(2, '0');

            // Clean title for search (remove symbols)
            const cleanedTitle = cleanTitleForSearch(title);

            // Extract short version (before ":" if present)
            const shortTitle = title.includes(':') ? title.split(':')[0].trim() : title;
            const cleanedShortTitle = cleanTitleForSearch(shortTitle);

            if (isItalianTitle) {
                // 🇮🇹 ITALIAN TITLE: Higher priority, search with "ita" first
                // Order: Most specific to least specific

                // 1. Cleaned full title + season/episode + "ita"
                searchQueries.push(`${cleanedTitle} S${seasonStr}E${episodeStr} ita`);
                searchQueries.push(`${cleanedTitle} S${seasonStr} ita`);
                searchQueries.push(`${cleanedTitle} ita`);

                // 2. Cleaned full title + season/episode (without "ita")
                searchQueries.push(`${cleanedTitle} S${seasonStr}E${episodeStr}`);
                searchQueries.push(`${cleanedTitle} S${seasonStr}`);
                searchQueries.push(`${cleanedTitle} Stagione ${season}`);
                searchQueries.push(`${cleanedTitle}`);

                // 3. Short title variants (if different)
                if (cleanedShortTitle !== cleanedTitle) {
                    searchQueries.push(`${cleanedShortTitle} S${seasonStr} ita`);
                    searchQueries.push(`${cleanedShortTitle} S${seasonStr}`);
                    searchQueries.push(`${cleanedShortTitle} ita`);
                }
            } else {
                // 🌍 ENGLISH TITLE: Lower priority, used as fallback
                // Only add if we need fallback queries

                // 1. With "ita" for international sites
                searchQueries.push(`${cleanedShortTitle} S${seasonStr} ita`);
                searchQueries.push(`${cleanedShortTitle} S${seasonStr}E${episodeStr} ita`);
                searchQueries.push(`${cleanedShortTitle} ita`);

                // 2. Without "ita" (last resort)
                searchQueries.push(`${cleanedShortTitle} S${seasonStr}E${episodeStr}`);
                searchQueries.push(`${cleanedShortTitle} S${seasonStr}`);
                searchQueries.push(`${cleanedShortTitle} Stagione ${season}`);
                searchQueries.push(`${cleanedShortTitle} Season ${season}`);
                searchQueries.push(`${cleanedShortTitle} Complete`);

                // 3. Short title alone (for enrichment - LAST)
                searchQueries.push(cleanedShortTitle);
            }

            if (label) console.log(`📝 Added queries for ${label}: "${title}" -> cleaned: "${cleanedTitle}"`);
        };

        // Always build queries (needed for enrichment even when skipping live search)
        console.log(`📝 [Queries] Building search queries for enrichment and live search...`);
        if (type === 'series') {
            if (kitsuId) { // Anime search strategy
                const uniqueQueries = new Set();
                const absEpisode = mediaDetails.absoluteEpisode || episode;
                console.log(`🎌 [Anime] Building queries for absolute episode ${absEpisode}, titles: ${mediaDetails.titles.length}`);

                // Use all available titles from Kitsu to build search queries
                for (const title of mediaDetails.titles) {
                    // 1. Title + absolute episode number (e.g., "Naruto 24", "One Piece 786")
                    uniqueQueries.add(`${title} ${absEpisode}`);

                    // 2. Title + season/episode format if we converted it (e.g., "Attack on Titan S01E05")
                    if (season && episode) {
                        const seasonStr = String(season).padStart(2, '0');
                        const episodeStr = String(episode).padStart(2, '0');
                        uniqueQueries.add(`${title} S${seasonStr}E${episodeStr}`);
                        uniqueQueries.add(`${title} S${seasonStr}`); // Season pack
                    }

                    // 3. Just title (to find large packs and collections)
                    uniqueQueries.add(title);
                }
                searchQueries.push(...uniqueQueries);
            } else { // Regular series search strategy
                // 🇮🇹 PRIORITY: Add Italian title queries FIRST (if available)
                // This ensures we search with the full Italian title before generic English
                if (italianTitle) {
                    console.log(`🇮🇹 Adding Italian title queries FIRST (priority)...`);
                    addQueriesForTitle(italianTitle, 'Italian title', true);
                }

                // 🌍 Then add English title queries as fallback
                addQueriesForTitle(mediaDetails.title, 'English title', false);
            }
        } else { // Movie
            searchQueries.push(`${mediaDetails.title} ${mediaDetails.year}`);
            searchQueries.push(mediaDetails.title); // Aggiunto per completezza
        }

        // --- NUOVA MODIFICA: Aggiungi titolo italiano e originale alle query di ricerca ---
        // 🇮🇹 Italian title for series is now added FIRST in the block above with priority
        if (italianTitle && type === 'movie') {
            searchQueries.push(`${italianTitle} ${mediaDetails.year}`);
            searchQueries.push(italianTitle);
            // Also add short version if it has ":"
            if (italianTitle.includes(':')) {
                const shortItalian = italianTitle.split(':')[0].trim();
                searchQueries.push(`${shortItalian} ${mediaDetails.year}`);
                searchQueries.push(shortItalian);
            }
        }

        if (originalTitle && type === 'series' && !kitsuId) {
            console.log(`🌍 Adding original title queries...`);
            addQueriesForTitle(originalTitle, 'Original title');
        } else if (originalTitle && type === 'movie') {
            searchQueries.push(`${originalTitle} ${mediaDetails.year}`);
            searchQueries.push(originalTitle);
            // Also add short version if it has ":"
            if (originalTitle.includes(':')) {
                const shortOriginal = originalTitle.split(':')[0].trim();
                searchQueries.push(`${shortOriginal} ${mediaDetails.year}`);
                searchQueries.push(shortOriginal);
            }
        }

        // Rimuovi duplicati e logga
        finalSearchQueries = [...new Set(searchQueries)];
        console.log(`📚 Final search queries (${finalSearchQueries.length} total):`, finalSearchQueries);
        // --- FINE MODIFICA ---

        // --- NUOVA LOGICA DI AGGREGAZIONE E DEDUPLICAZIONE ---
        // Separazione dei risultati per provider per applicare filtri specifici
        const rawResultsByProvider = {
            UIndex: [],
            Knaben: [],
            TorrentGalaxy: [],
            CorsaroNero: [],
            Jackettio: [],
            ExternalAddons: [], // ✅ Torrentio, MediaFusion, Comet
            RARBG: []
        };

        const searchType = kitsuId ? 'anime' : type;
        const TOTAL_RESULTS_TARGET = 50;
        let totalQueries = 0;

        // Check which sites are enabled (default to all if not specified)
        const useUIndex = config.use_uindex !== false;
        const useCorsaroNero = config.use_corsaronero !== false;
        const useKnaben = config.use_knaben !== false;
        const useTorrentGalaxy = config.use_torrentgalaxy === true; // Default OFF (false) for new feature
        const globalExternalEnabled = config.use_external_addons !== false;
        const enabledExternalAddons = [];
        if (globalExternalEnabled) {
            if (config.use_torrentio !== false) enabledExternalAddons.push('torrentio');
            if (config.use_mediafusion !== false) enabledExternalAddons.push('mediafusion');
            if (config.use_comet !== false) enabledExternalAddons.push('comet');
        }
        console.log(`🐞 [DEBUG-EXT] Config:`, JSON.stringify(config));
        console.log(`🐞 [DEBUG-EXT] Global: ${globalExternalEnabled}, Enabled: ${JSON.stringify(enabledExternalAddons)}`);

        // ✅ LIVE SEARCH (Tier 3 + Parallel Flows)
        console.log(`🔍 Starting live search...`);

        // ✅ Initialize Jackettio if ENV vars are set
        let jackettioInstance = null;
        if (config.jackett_url && config.jackett_api_key) {
            jackettioInstance = new Jackettio(
                config.jackett_url,
                config.jackett_api_key,
                config.jackett_password
            );
            console.log('🔍 [Jackettio] Instance initialized (ITALIAN ONLY mode)');
        }

        // 1️⃣ UINDEX: Logica Specifica - Priorità al titolo italiano pulito
        if (useUIndex) {
            const uindexQueries = [];
            const seasonStr = String(season).padStart(2, '0');

            // ✅ Costruisci validationMetadata per UIndex (come Knaben)
            const uindexValidationMetadata = {
                titles: mediaDetails.titles || [mediaDetails.title, italianTitle, originalTitle].filter(Boolean),
                year: mediaDetails.year,
                season: season ? parseInt(season, 10) : undefined,
                episode: episode ? parseInt(episode, 10) : undefined,
            };
            console.log(`🔍 [UIndex] Validation metadata: titles=${uindexValidationMetadata.titles.join(', ')}, year=${uindexValidationMetadata.year}, S${uindexValidationMetadata.season}E${uindexValidationMetadata.episode}`);

            // 🇮🇹 PRIORITY: Italian title first (cleaned, without symbols)
            if (italianTitle) {
                const cleanedItalian = cleanTitleForSearch(italianTitle);
                // Most specific to least specific
                uindexQueries.push(`${cleanedItalian} S${seasonStr} ita`);
                uindexQueries.push(`${cleanedItalian} ita`);
                uindexQueries.push(`${cleanedItalian} S${seasonStr}`);
                uindexQueries.push(`${cleanedItalian}`);
            }

            // 🌍 FALLBACK: English title (only if different from Italian)
            const cleanedEnglish = cleanTitleForSearch(mediaDetails.title);
            const cleanedItalian = italianTitle ? cleanTitleForSearch(italianTitle) : '';
            if (cleanedEnglish !== cleanedItalian) {
                uindexQueries.push(`${cleanedEnglish} S${seasonStr} ita`);
                uindexQueries.push(`${cleanedEnglish} ita`);
            }

            const uniqueUindexQueries = [...new Set(uindexQueries)];
            console.log(`📊 [UIndex] Running optimized queries (ITA priority):`, uniqueUindexQueries);

            // Track if we found results with Italian title (to enable early-exit)
            let foundWithItalianTitle = false;
            const italianQueryCount = italianTitle ? 4 : 0; // First 4 queries are Italian title

            for (let i = 0; i < uniqueUindexQueries.length; i++) {
                const q = uniqueUindexQueries[i];

                // 🛑 EARLY EXIT: If we found good results with Italian title, skip English fallback queries
                if (foundWithItalianTitle && i >= italianQueryCount) {
                    console.log(`✅ [UIndex] Found ${rawResultsByProvider.UIndex.length} results with Italian title. Skipping English fallback queries.`);
                    break;
                }

                try {
                    const res = await fetchUIndexData(q, searchType, italianTitle, uindexValidationMetadata);
                    if (res && res.length > 0) {
                        console.log(`📊 [UIndex] Found ${res.length} results for "${q}"`);
                        rawResultsByProvider.UIndex.push(...res);

                        // Mark that we found results with Italian title queries
                        if (i < italianQueryCount && rawResultsByProvider.UIndex.length >= 5) {
                            foundWithItalianTitle = true;
                        }
                    }
                } catch (e) {
                    console.error(`❌ [UIndex] Error searching "${q}":`, e.message);
                }
                await new Promise(resolve => setTimeout(resolve, 500)); // Rate limit protection
            }
        }

        // 2️⃣ MAIN LOOP: CorsaroNero, Knaben, Jackettio (Query Complete)
        // 🛑 EARLY EXIT LOGIC: Track results from Italian title queries vs English fallback
        let foundWithItalianTitleQueries = 0; // Count results from Italian title queries
        const cleanedItalianTitle = italianTitle ? cleanTitleForSearch(italianTitle) : '';
        const cleanedEnglishTitle = cleanTitleForSearch(mediaDetails.title || '');

        for (const query of finalSearchQueries) {
            // 🛑 EARLY EXIT: If we found good results with Italian title queries, skip English fallback
            const isEnglishFallbackQuery = cleanedEnglishTitle &&
                query.toLowerCase().startsWith(cleanedEnglishTitle) &&
                !query.toLowerCase().includes(cleanedItalianTitle);

            if (isEnglishFallbackQuery && foundWithItalianTitleQueries >= 3) {
                console.log(`✅ [EARLY EXIT] Found ${foundWithItalianTitleQueries} results with Italian title. Skipping English fallback query: "${query}"`);
                continue; // Skip this query, don't break - we might have more ITA queries after
            }

            console.log(`\n🔍 Searching sources for: "${query}"`);

            // Stop searching if we have a good number of results (checking total accumulated)
            const currentTotal = Object.values(rawResultsByProvider).reduce((acc, arr) => acc + arr.length, 0);
            if (currentTotal >= TOTAL_RESULTS_TARGET * 4) {
                console.log(`🎯 Target of ~${TOTAL_RESULTS_TARGET} unique results likely reached. Stopping further searches.`);
                break;
            }

            const searchPromises = [];

            // 🔥 FILTER: Skip Knaben for Corsaro-specific queries (Stagione/Completa)
            const isCorsaroSpecific = query.match(/\b(stagione\s+\d+|serie\s+completa)\b/i);

            // CorsaroNero
            if (useCorsaroNero) {
                if (!skipLiveSearch) {
                    searchPromises.push({
                        name: 'CorsaroNero',
                        promise: fetchCorsaroNeroData(query, searchType)
                    });
                }
            }

            // Knaben (Always run if enabled, but skip Italian-specific keywords if needed)
            if (useKnaben) {
                // 🔥 MODIFIED: Use AIOStreams-style API with metadata when available
                // Build metadata object for Knaben API
                const knabenMetadata = {
                    primaryTitle: mediaDetails.title,
                    title: mediaDetails.title,
                    titles: mediaDetails.titles || [mediaDetails.title],
                    year: mediaDetails.year,
                    imdbId: mediaDetails.imdbId,
                    tmdbId: mediaDetails.tmdbId,
                    absoluteEpisode: mediaDetails.absoluteEpisode,
                };

                // Build parsedId for Knaben
                const knabenParsedId = {
                    mediaType: searchType,
                    season: season,
                    episode: episode,
                };

                searchPromises.push({
                    name: 'Knaben',
                    promise: fetchKnabenData(query, searchType, knabenMetadata, knabenParsedId)
                });
            }

            // TorrentGalaxy
            if (useTorrentGalaxy) {
                const tgxMetadata = {
                    primaryTitle: cleanedItalianTitle || originalTitle || mediaDetails.title,
                    title: originalTitle || mediaDetails.title,
                    year: mediaDetails.year,
                    titles: [cleanedItalianTitle, originalTitle, mediaDetails.title].filter(Boolean),
                };
                const tgxParsedId = {
                    season: season ? parseInt(season, 10) : undefined,
                    episode: episode ? parseInt(episode, 10) : undefined,
                };

                searchPromises.push({
                    name: 'TorrentGalaxy',
                    promise: fetchTorrentGalaxyData(query, searchType, tgxMetadata, tgxParsedId)
                });
            }

            // Jackettio
            if (jackettioInstance) {
                searchPromises.push({
                    name: 'Jackettio',
                    promise: fetchJackettioData(query, searchType, jackettioInstance)
                });
            }

            if (searchPromises.length === 0) {
                continue;
            }

            const results = await Promise.allSettled(searchPromises.map(sp => sp.promise));

            results.forEach((result, index) => {
                const sourceName = searchPromises[index].name;
                if (result.status === 'fulfilled' && result.value) {
                    console.log(`✅ ${sourceName} returned ${result.value.length} results for query.`);
                    if (rawResultsByProvider[sourceName]) {
                        rawResultsByProvider[sourceName].push(...result.value);
                    }

                    // 🛑 Track results from Italian title queries for early exit
                    const isItalianTitleQuery = cleanedItalianTitle &&
                        query.toLowerCase().includes(cleanedItalianTitle);
                    if (isItalianTitleQuery && result.value.length > 0) {
                        foundWithItalianTitleQueries += result.value.length;
                        console.log(`📊 [ITA TRACKING] Query "${query}" added ${result.value.length} results. Total ITA results: ${foundWithItalianTitleQueries}`);
                    }
                } else if (result.status === 'rejected') {
                    console.error(`❌ ${sourceName} search failed:`, result.reason);
                }
            });

            totalQueries++;
            if (totalQueries < finalSearchQueries.length) {
                await new Promise(resolve => setTimeout(resolve, 250));
            }
        }

        // 3️⃣ POST-PROCESSING: MOVED AFTER SEASON FILTERING
        // We no longer filter by language here to avoid discarding correct English seasons 
        // when only incorrect Italian seasons are found.
        // See "LANGUAGE FILTERING (Post-Season Filter)" below.

        // ✅ 4️⃣ EXTERNAL ADDONS: Fetch from Torrentio, MediaFusion, Comet in parallel

        if (enabledExternalAddons.length > 0) {
            console.log(`\n🔗 [External Addons] Fetching from ${enabledExternalAddons.join(', ')}...`);

            // Build Stremio-format ID for addon APIs
            let stremioId = mediaDetails.imdbId || decodedId.split(':')[0];
            if (type === 'series' && season && episode) {
                stremioId = `${stremioId}:${season}:${episode}`;
            }

            try {
                const externalResults = await fetchExternalAddonsFlat(type, stremioId, { enabledAddons: enabledExternalAddons });

                if (externalResults.length > 0) {
                    console.log(`✅ [External Addons] Received ${externalResults.length} total results`);
                    rawResultsByProvider.ExternalAddons.push(...externalResults);
                } else {
                    console.log(`⚠️ [External Addons] No results received`);
                }
            } catch (externalError) {
                console.error(`❌ [External Addons] Error:`, externalError.message);
            }
        }

        // ✅ 5️⃣ RARBG (Standalone Proxy)
        if (config.use_rarbg !== false) {
            // 🇮🇹 PRIORITY: Use Italian title if available, otherwise original name, then English title
            const rarbgQuery = italianTitle || mediaDetails.originalName || mediaDetails.title;
            console.log(`\n🏴 [RARBG] Searching for: ${rarbgQuery}...`);
            try {
                // Timeout 4500ms come richiesto
                // Build Stremio-format ID
                let stremioId = mediaDetails.imdbId || decodedId.split(':')[0];
                if (type === 'series' && season && episode) {
                    stremioId = `${stremioId}:${season}:${episode}`;
                }

                const rarbgRes = await searchRARBG(rarbgQuery, mediaDetails.year, type, stremioId, { timeout: 4500, allowEng: true });
                if (rarbgRes && rarbgRes.length > 0) {
                    console.log(`✅ [RARBG] Found ${rarbgRes.length} results`);
                    rawResultsByProvider.RARBG = rarbgRes.map(r => ({
                        title: r.title,
                        link: r.magnet,
                        size: r.size,
                        seeders: r.seeders,
                        quality: r.quality,  // ✅ Add quality from RARBG
                        source: "RARBG",
                        infoHash: r.magnet.match(/btih:([a-zA-Z0-9]{40})/i)?.[1]?.toLowerCase()
                    }));
                }
            } catch (e) {
                console.log(`❌ [RARBG] Error: ${e.message}`);
            }
        }

        // Merge finale
        const allRawResults = [
            ...rawResultsByProvider.CorsaroNero,
            ...rawResultsByProvider.Knaben,
            ...rawResultsByProvider.TorrentGalaxy,
            ...rawResultsByProvider.ExternalAddons,
            ...rawResultsByProvider.RARBG,
            ...rawResultsByProvider.UIndex,
            ...rawResultsByProvider.Jackettio
        ];

        console.log(`🔎 Found a total of ${allRawResults.length} raw results from all sources. Performing smart deduplication...`);

        // ✅ ADD DATABASE RESULTS TO RAW RESULTS (if any)
        if (dbResults.length > 0) {
            console.log(`💾 [DB] Adding ${dbResults.length} database results to aggregation...`);

            // DEBUG: Log all unique hashes BEFORE filtering
            const uniqueHashes = [...new Set(dbResults.map(r => r.info_hash))];
            console.log(`💾 [DB] Found ${uniqueHashes.length} unique torrents from ${dbResults.length} total DB results`);
            // uniqueHashes.forEach(hash => {
            //     const torrents = dbResults.filter(r => r.info_hash === hash);
            //     const firstTorrent = torrents[0];
            //     const title = firstTorrent.torrent_title || firstTorrent.title;
            //     console.log(`  - ${hash.substring(0, 8)}: "${title.substring(0, 60)}..." (appears ${torrents.length} times)`);
            // });

            // ✅ FILTER DB RESULTS for series by season/episode (like scraping results)
            let filteredDbResults = dbResults;
            if (type === 'series' && season && episode) {
                const seasonNum = parseInt(season);
                const episodeNum = parseInt(episode);

                filteredDbResults = dbResults.filter(dbResult => {
                    // Handle different result formats: searchEpisodeFiles uses torrent_title, others use title
                    const torrentTitle = dbResult.torrent_title || dbResult.title;
                    // TRUST ID MATCH: If torrent has correct IMDB ID, skip title check
                    // This fixes issues where torrent title is in different language (e.g. "Il Trono di Spade" vs "Game of Thrones")
                    const trustTitle = dbResult.imdb_id && dbResult.imdb_id === mediaDetails.imdbId;

                    const match = isExactEpisodeMatch(
                        torrentTitle,
                        mediaDetails.titles || mediaDetails.title,
                        seasonNum,
                        episodeNum,
                        !!kitsuId,  // isAnime flag
                        mediaDetails.absoluteEpisode,  // absolute episode for Kitsu
                        trustTitle // skipTitleCheck
                    );

                    // DEBUG: Log rejected torrents
                    if (!match) {
                        if (DEBUG_MODE) console.log(`  ❌ REJECTED: ${dbResult.info_hash.substring(0, 8)} - "${torrentTitle.substring(0, 70)}"`);
                    }

                    return match;
                });

                console.log(`💾 [DB] Filtered to ${filteredDbResults.length}/${dbResults.length} torrents matching S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`);
            }

            // ✅ DEDUPLICATE by info_hash (prefer entries with file_index for episode files)
            const deduplicatedMap = new Map();
            for (const dbResult of filteredDbResults) {
                const hash = dbResult.info_hash;
                if (!deduplicatedMap.has(hash)) {
                    deduplicatedMap.set(hash, dbResult);
                } else {
                    // ALWAYS prefer entry with file_index (from searchEpisodeFiles)
                    const existing = deduplicatedMap.get(hash);
                    const hasFileIndex = dbResult.file_index !== null && dbResult.file_index !== undefined;
                    const existingHasFileIndex = existing.file_index !== null && existing.file_index !== undefined;

                    if (hasFileIndex && !existingHasFileIndex) {
                        // New has file_index, existing doesn't → replace
                        if (DEBUG_MODE) console.log(`💾 [DB Dedup] Replacing ${hash.substring(0, 8)} (no fileIndex) with version that has fileIndex=${dbResult.file_index}`);
                        deduplicatedMap.set(hash, dbResult);
                    } else if (hasFileIndex && existingHasFileIndex) {
                        // Both have file_index → keep first one
                        if (DEBUG_MODE) console.log(`💾 [DB Dedup] Keeping first ${hash.substring(0, 8)} fileIndex=${existing.file_index}, skipping duplicate with fileIndex=${dbResult.file_index}`);
                    }
                }
            }
            filteredDbResults = Array.from(deduplicatedMap.values());
            console.log(`💾 [DB] Deduplicated to ${filteredDbResults.length} unique torrents`);

            // ✅ PACK FILES VERIFICATION: Verify season packs contain the requested episode
            // - Max 20 packs verified per search
            // - 100ms delay between API calls to avoid 503
            // - Skip packs already in DB (have file_index)
            // - Order by size (largest first)
            if (type === 'series' && season && episode && (config.rd_key || config.torbox_key)) {
                const seasonNum = parseInt(season);
                const episodeNum = parseInt(episode);
                const seriesImdbId = mediaDetails.imdbId;
                const MAX_PACK_VERIFY = 20;
                const DELAY_MS = 200; // Balance between rate limiting and speed

                // Separate verified (in DB) from unverified packs
                const verifiedPacks = [];
                const unverifiedPacks = [];
                const nonPacks = [];

                for (const dbResult of filteredDbResults) {
                    const torrentTitle = dbResult.torrent_title || dbResult.title;
                    const hasFileIndex = dbResult.file_index !== null && dbResult.file_index !== undefined;
                    const isPack = packFilesHandler.isSeasonPack(torrentTitle);

                    if (!isPack) {
                        nonPacks.push(dbResult);
                    } else if (hasFileIndex) {
                        verifiedPacks.push(dbResult);
                    } else {
                        unverifiedPacks.push(dbResult);
                    }
                }

                // Sort unverified packs by size (largest first)
                const torrentSize = (r) => r.torrent_size || r.size || 0;
                unverifiedPacks.sort((a, b) => torrentSize(b) - torrentSize(a));

                console.log(`📦 [PACK VERIFY] Found ${verifiedPacks.length} verified, ${unverifiedPacks.length} unverified, ${nonPacks.length} non-packs`);

                // Verify unverified packs (max 20, with 100ms delay)
                const toVerify = unverifiedPacks.slice(0, MAX_PACK_VERIFY);
                const skipped = unverifiedPacks.slice(MAX_PACK_VERIFY);

                const newlyVerified = [];
                const excluded = [];

                for (let i = 0; i < toVerify.length; i++) {
                    const dbResult = toVerify[i];
                    const torrentTitle = dbResult.torrent_title || dbResult.title;

                    // Add delay between calls (except first)
                    if (i > 0) {
                        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
                    }

                    console.log(`📦 [PACK VERIFY] (${i + 1}/${toVerify.length}) Checking "${torrentTitle.substring(0, 50)}..."`);

                    try {
                        const fileInfo = await packFilesHandler.resolveSeriesPackFile(
                            dbResult.info_hash.toLowerCase(),
                            config,
                            seriesImdbId,
                            seasonNum,
                            episodeNum,
                            dbHelper
                        );

                        if (fileInfo) {
                            console.log(`✅ [PACK VERIFY] Found E${episodeNum}: ${fileInfo.fileName} (${(fileInfo.fileSize / 1024 / 1024 / 1024).toFixed(2)} GB)`);
                            // Use totalPackSize from fileInfo if available, otherwise use torrent_size
                            dbResult.packSize = fileInfo.totalPackSize || dbResult.torrent_size || dbResult.size;
                            dbResult.file_index = fileInfo.fileIndex;
                            dbResult.file_title = fileInfo.fileName;
                            dbResult.file_size = fileInfo.fileSize;
                            newlyVerified.push(dbResult);
                        } else {
                            console.log(`❌ [PACK VERIFY] E${episodeNum} NOT in pack - EXCLUDING`);
                            excluded.push(dbResult);
                        }
                    } catch (err) {
                        console.warn(`⚠️ [PACK VERIFY] Error: ${err.message} - keeping pack`);
                        newlyVerified.push(dbResult); // Keep on error
                    }
                }

                console.log(`📦 [PACK VERIFY] Results: ${newlyVerified.length} verified, ${excluded.length} excluded, ${skipped.length} skipped (limit)`);

                // Combine all results: non-packs + verified + newly verified + skipped
                filteredDbResults = [...nonPacks, ...verifiedPacks, ...newlyVerified, ...skipped];
            }

            // Convert filtered DB results to scraper format
            for (const dbResult of filteredDbResults) {
                // 🔥 FILTER: Respect user configuration even for DB results
                const providerName = dbResult.provider || 'Database';

                if (providerName === 'CorsaroNero' && config.use_corsaronero === false) {
                    console.log(`⏭️  [DB] Skipping CorsaroNero result (disabled in config): ${dbResult.title}`);
                    continue;
                }
                if (providerName === 'UIndex' && config.use_uindex === false) {
                    console.log(`⏭️  [DB] Skipping UIndex result (disabled in config): ${dbResult.title}`);
                    continue;
                }
                if (providerName === 'Knaben' && config.use_knaben === false) {
                    console.log(`⏭️  [DB] Skipping Knaben result (disabled in config): ${dbResult.title}`);
                    continue;
                }

                // Handle different result formats: searchEpisodeFiles uses torrent_title, others use title
                const torrentTitle = dbResult.torrent_title || dbResult.title;
                const torrentSize = dbResult.torrent_size || dbResult.size;
                // ✅ Use file_size (single episode) if available, otherwise fallback to torrent_size (pack)
                const displaySize = dbResult.file_size || torrentSize;
                // Only use file_title if it came from searchEpisodeFiles (has torrent_title field)
                // This ensures we only show the actual filename for the SPECIFIC episode
                const fileName = dbResult.torrent_title ? dbResult.file_title : undefined;

                // Build magnet link
                const magnetLink = `magnet:?xt=urn:btih:${dbResult.info_hash}&dn=${encodeURIComponent(torrentTitle)}`;

                // DEBUG: Log what we're adding
                console.log(`🔍 [DB ADD] Adding: hash=${dbResult.info_hash.substring(0, 8)}, title="${torrentTitle.substring(0, 50)}...", size=${formatBytes(displaySize || 0)}${dbResult.file_size ? ' (episode)' : ' (pack)'}, seeders=${dbResult.seeders || 0}`);

                // Add to raw results with high priority
                allRawResults.push({
                    title: torrentTitle,
                    infoHash: dbResult.info_hash.toUpperCase(),
                    magnetLink: magnetLink,
                    seeders: dbResult.seeders || 0,
                    leechers: 0,
                    size: displaySize ? formatBytes(displaySize) : 'Unknown',
                    sizeInBytes: displaySize || 0,
                    // ✅ Pack size for pack/episode display
                    packSize: dbResult.packSize || torrentSize || 0,
                    file_size: dbResult.file_size || 0,
                    quality: extractQuality(torrentTitle),
                    filename: fileName || torrentTitle,
                    source: `💾 ${dbResult.provider || 'Database'}`,
                    fileIndex: dbResult.file_index !== null && dbResult.file_index !== undefined ? dbResult.file_index : undefined, // For series episodes and pack movies
                    file_title: fileName || undefined // Real filename from DB (only for specific episode)
                });

                // DEBUG: Log file info from DB
                if (dbResult.file_index !== null && dbResult.file_index !== undefined) {
                    console.log(`   📁 Has file: fileIndex=${dbResult.file_index}, file_title=${fileName}`);
                }
            }

            console.log(`💾 [DB] Total raw results after DB merge: ${allRawResults.length}`);
        }

        // 🎯 Helper: Calculate similarity between two strings (0-1)
        // Uses multiple strategies: Levenshtein, word overlap, containment
        const calculateSimilarity = (str1, str2) => {
            if (!str1 || !str2) return 0;
            if (str1 === str2) return 1;

            const s1 = str1.toLowerCase();
            const s2 = str2.toLowerCase();

            // Strategy 1: If one contains the other, high similarity
            if (s1.includes(s2) || s2.includes(s1)) {
                const minLen = Math.min(s1.length, s2.length);
                const maxLen = Math.max(s1.length, s2.length);
                return Math.max(0.8, minLen / maxLen); // At least 80%
            }

            // Strategy 2: Word overlap (handles different word order)
            // "Medical Division Dr House" vs "Dr House Medical Division" should match!
            const words1 = s1.split(/\s+/).filter(w => w.length > 1); // Ignore single chars
            const words2 = s2.split(/\s+/).filter(w => w.length > 1);

            if (words1.length > 0 && words2.length > 0) {
                let matchedWords = 0;
                const usedIndices = new Set();

                for (const w1 of words1) {
                    for (let i = 0; i < words2.length; i++) {
                        if (usedIndices.has(i)) continue;
                        const w2 = words2[i];
                        // Exact match or very similar (typo tolerance)
                        if (w1 === w2 || (w1.length > 3 && w2.length > 3 && (w1.includes(w2) || w2.includes(w1)))) {
                            matchedWords++;
                            usedIndices.add(i);
                            break;
                        }
                    }
                }

                const maxWords = Math.max(words1.length, words2.length);
                const wordOverlap = matchedWords / maxWords;

                // If most words match, it's a good match even if order is different
                if (wordOverlap >= 0.6) {
                    return Math.max(0.75, wordOverlap); // At least 75% if 60%+ words match
                }
            }

            // Strategy 3: Levenshtein distance (fallback)
            const matrix = [];
            for (let i = 0; i <= s1.length; i++) {
                matrix[i] = [i];
            }
            for (let j = 0; j <= s2.length; j++) {
                matrix[0][j] = j;
            }
            for (let i = 1; i <= s1.length; i++) {
                for (let j = 1; j <= s2.length; j++) {
                    const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j] + 1,      // deletion
                        matrix[i][j - 1] + 1,      // insertion
                        matrix[i - 1][j - 1] + cost // substitution
                    );
                }
            }

            const distance = matrix[s1.length][s2.length];
            const maxLen = Math.max(s1.length, s2.length);
            return 1 - (distance / maxLen);
        };

        // 🎯 Helper function to check if a title matches the requested episode
        // Returns true if: season pack complete, exact episode, or range that includes the episode
        // Also validates that the series name matches the expected titles (75% fuzzy match)
        const matchesRequestedEpisode = (title, requestedSeason, requestedEpisode, expectedTitles = []) => {
            if (!title || !requestedSeason || !requestedEpisode) return true; // No filter for movies

            const seasonNum = parseInt(requestedSeason);
            const episodeNum = parseInt(requestedEpisode);
            const titleLower = title.toLowerCase();

            const SIMILARITY_THRESHOLD = 0.75; // 75% match required

            // 🚨 NEW: Validate series name matches expected titles (fuzzy 75% match)
            // This prevents "Chico and the Man S01E06 E Pluribus Used Car" from matching "Pluribus"
            if (expectedTitles && expectedTitles.length > 0) {
                // Extract the series name from the torrent title (everything before S01E06 or 1x06)
                // Added: S01-08 (season range), Stagioni (plural), ep01-22
                const seriesNameMatch = title.match(/^(.+?)(?:\s*[.-]?\s*)?(?:[Ss]\d+[Ee]\d+|[Ss]\d+[-–]\d+|\d+x\d+|[Ss]tagion[ei]|[Ss]eason|[Ee]p?\d+|\[COMPLETA\]|Complete)/i);

                if (seriesNameMatch) {
                    const torrentSeriesName = seriesNameMatch[1].trim().toLowerCase()
                        .replace(/[.\-_]/g, ' ')  // Replace separators with spaces
                        .replace(/\s+/g, ' ')      // Normalize spaces
                        .replace(/\(\d{4}\)$/, '') // Remove year at end
                        .trim();

                    // Check if any expected title matches with 75% similarity
                    let bestMatch = { title: '', similarity: 0 };

                    const matchesExpectedTitle = expectedTitles.some(expectedTitle => {
                        const cleanExpected = expectedTitle.toLowerCase()
                            .replace(/[.\-_]/g, ' ')
                            .replace(/\s+/g, ' ')
                            .trim();

                        // Calculate similarity
                        const similarity = calculateSimilarity(torrentSeriesName, cleanExpected);

                        if (similarity > bestMatch.similarity) {
                            bestMatch = { title: cleanExpected, similarity };
                        }

                        // Also check if one starts with the other (common case)
                        // "Pluribus 2025" should match "Pluribus"
                        if (torrentSeriesName.startsWith(cleanExpected) || cleanExpected.startsWith(torrentSeriesName)) {
                            const minLen = Math.min(torrentSeriesName.length, cleanExpected.length);
                            const maxLen = Math.max(torrentSeriesName.length, cleanExpected.length);
                            const startSimilarity = minLen / maxLen;
                            if (startSimilarity >= SIMILARITY_THRESHOLD) {
                                bestMatch = { title: cleanExpected, similarity: Math.max(similarity, startSimilarity) };
                                return true;
                            }
                        }

                        return similarity >= SIMILARITY_THRESHOLD;
                    });

                    if (!matchesExpectedTitle) {
                        if (DEBUG_MODE) console.log(`❌ [EPISODE FILTER] Series name mismatch: "${torrentSeriesName}" vs expected [${expectedTitles.join(', ')}] (best: ${(bestMatch.similarity * 100).toFixed(0)}% < 75%): "${title.substring(0, 70)}..."`);
                        return false;
                    } else {
                        console.log(`✅ [SERIES MATCH] "${torrentSeriesName}" matches "${bestMatch.title}" (${(bestMatch.similarity * 100).toFixed(0)}%)`);
                    }
                }
            }

            // 1. Check if it's a COMPLETE SEASON PACK (no specific episodes)
            // Patterns: "S01" alone, "Stagione 1", "Season 1", "[COMPLETA]", "Complete"
            // IMPORTANT: S01.E01.E02 or S01.E01-02 are NOT season packs, they are episode packs!

            const isCompletePack = /\[COMPLETA\]|Complete\s*Series|Complete\s*Season|Serie\s*Completa|Stagione\s*Completa/i.test(title);

            // Check for episode indicators that mean it's NOT a complete season
            // S01E01, S01.E01, S01 E01, S01-E01, 1x01, etc.
            const hasEpisodeIndicator = /[Ss]\d+[.\s-]*[Ee]\d+|[Ss]\d+[Ee]\d+|\d+x\d+/i.test(title);
            // Episode range like E01-E10, E01-10
            const hasEpisodeRange = /[Ee](p)?\.?\s*\d+\s*[-–]\s*(E(p)?\.?\s*)?\d+/i.test(title);
            // Multi-episode list like .E01.E02 or .01.02 after season
            const hasMultiEpisodeList = /[Ss]\d+[.\s][Ee]?\d+[.\s][Ee]?\d+/i.test(title);

            // It's a season pack only if it has season number but NO episode indicators
            const hasSeasonOnly = !hasEpisodeIndicator && !hasEpisodeRange && !hasMultiEpisodeList && (
                // S01 or S1 pattern
                new RegExp(`[Ss](0?${seasonNum})(?![0-9])`, 'i').test(title) ||
                // "Stagione X" or "Season X" pattern
                new RegExp(`(stagione|season)\\s*${seasonNum}(?![0-9])`, 'i').test(title)
            );

            if (isCompletePack || hasSeasonOnly) {
                // Verify it's the right season
                const seasonMatch = title.match(/[Ss](0?\d+)|[Ss]tagione?\s*(\d+)|[Ss]eason\s*(\d+)/i);
                if (seasonMatch) {
                    const foundSeason = parseInt(seasonMatch[1] || seasonMatch[2] || seasonMatch[3]);
                    if (foundSeason === seasonNum) {
                        if (DEBUG_MODE) console.log(`✅ [EPISODE FILTER] Season pack detected: "${title.substring(0, 60)}..."`);
                        return true;
                    }
                }
                // Complete series pack
                if (/\[COMPLETA\]|Complete\s*Series|Serie\s*Completa/i.test(title)) {
                    if (DEBUG_MODE) console.log(`✅ [EPISODE FILTER] Complete series pack: "${title.substring(0, 60)}..."`);
                    return true;
                }
            }

            // 2. Check for EXACT EPISODE match
            const exactPatterns = [
                new RegExp(`[Ss](0?${seasonNum})[Ee](0?${episodeNum})(?![0-9])`, 'i'),  // S01E06
                new RegExp(`${seasonNum}x(0?${episodeNum})(?![0-9])`, 'i'),              // 1x06
                new RegExp(`[Ss](0?${seasonNum})\\s*[Ee](0?${episodeNum})(?![0-9])`, 'i'), // S01 E06
            ];

            if (exactPatterns.some(p => p.test(title))) {
                if (DEBUG_MODE) console.log(`✅ [EPISODE FILTER] Exact episode match: "${title.substring(0, 60)}..."`);
                return true;
            }

            // 3. Check for EPISODE RANGE that includes the requested episode
            // Patterns: S01E01-E10, S01E01-10, E01-E10, S01E01.E02.E03
            const rangePatterns = [
                // S01E01-E10 or S01E01-10
                /[Ss](0?\d+)[Ee](0?\d+)[-–](E)?(0?\d+)/i,
                // E01-E10 or E01-10 (without season, assume current)
                /[Ee](0?\d+)[-–](E)?(0?\d+)/i,
                // 1x01-1x10 or 1x01-10
                /(\d+)x(0?\d+)[-–](\d+x)?(0?\d+)/i,
            ];

            for (const pattern of rangePatterns) {
                const match = title.match(pattern);
                if (match) {
                    let startEp, endEp, matchedSeason;

                    if (pattern.source.includes('[Ss]')) {
                        // S01E01-E10 format
                        matchedSeason = parseInt(match[1]);
                        startEp = parseInt(match[2]);
                        endEp = parseInt(match[4] || match[3]);
                    } else if (pattern.source.includes('x')) {
                        // 1x01-10 format
                        matchedSeason = parseInt(match[1]);
                        startEp = parseInt(match[2]);
                        endEp = parseInt(match[4]);
                    } else {
                        // E01-E10 format (no season in pattern, check separately)
                        const seasonCheck = title.match(/[Ss](0?\d+)/i);
                        matchedSeason = seasonCheck ? parseInt(seasonCheck[1]) : seasonNum;
                        startEp = parseInt(match[1]);
                        endEp = parseInt(match[3] || match[2]);
                    }

                    if (matchedSeason === seasonNum && episodeNum >= startEp && episodeNum <= endEp) {
                        if (DEBUG_MODE) console.log(`✅ [EPISODE FILTER] Episode range ${startEp}-${endEp} includes E${episodeNum}: "${title.substring(0, 60)}..."`);
                        return true;
                    } else if (matchedSeason === seasonNum) {
                        if (DEBUG_MODE) console.log(`❌ [EPISODE FILTER] Episode range ${startEp}-${endEp} does NOT include E${episodeNum}: "${title.substring(0, 60)}..."`);
                        return false;
                    }
                }
            }

            // 4. Check for MULTI-EPISODE list (S01E01.E02.E03 or S01 E01 E02 E03)
            const multiEpMatch = title.match(/[Ss](0?\d+)[.\s]*([Ee]\d+[.\s]*)+/i);
            if (multiEpMatch) {
                const matchedSeason = parseInt(multiEpMatch[1]);
                if (matchedSeason === seasonNum) {
                    // Extract all episode numbers
                    const episodes = title.match(/[Ee](0?\d+)/gi);
                    if (episodes) {
                        const epNumbers = episodes.map(e => parseInt(e.replace(/[Ee]/i, '')));
                        if (epNumbers.includes(episodeNum)) {
                            if (DEBUG_MODE) console.log(`✅ [EPISODE FILTER] Multi-episode list includes E${episodeNum}: "${title.substring(0, 60)}..."`);
                            return true;
                        } else {
                            if (DEBUG_MODE) console.log(`❌ [EPISODE FILTER] Multi-episode list [${epNumbers.join(',')}] does NOT include E${episodeNum}: "${title.substring(0, 60)}..."`);
                            return false;
                        }
                    }
                }
            }

            // 5. If we found a specific episode that doesn't match, reject it
            // Check S01E01 format
            const singleEpMatch = title.match(/[Ss](0?\d+)[Ee](0?\d+)/i);
            if (singleEpMatch) {
                const matchedSeason = parseInt(singleEpMatch[1]);
                const matchedEpisode = parseInt(singleEpMatch[2]);
                if (matchedSeason === seasonNum && matchedEpisode !== episodeNum) {
                    if (DEBUG_MODE) console.log(`❌ [EPISODE FILTER] Single episode S${matchedSeason}E${matchedEpisode} != requested E${episodeNum}: "${title.substring(0, 60)}..."`);
                    return false;
                }
            }

            // 5b. Check NxNN format (1x03, 2x15, etc.) - same as S01E03
            const nxnMatch = title.match(/(\d+)x(0?\d+)(?![0-9\-])/i);
            if (nxnMatch) {
                const matchedSeason = parseInt(nxnMatch[1]);
                const matchedEpisode = parseInt(nxnMatch[2]);
                if (matchedSeason === seasonNum && matchedEpisode !== episodeNum) {
                    if (DEBUG_MODE) console.log(`❌ [EPISODE FILTER] Single episode ${matchedSeason}x${matchedEpisode} != requested E${episodeNum}: "${title.substring(0, 60)}..."`);
                    return false;
                }
            }

            // 6. Default: accept (might be a movie or unrecognized format)
            return true;
        };

        // Smart Deduplication
        const bestResults = new Map();
        for (const result of allRawResults) {
            if (!result.infoHash) continue;

            // 🎯 EPISODE FILTER: For series, filter out results that don't match the requested episode
            if (type === 'series' && season && episode) {
                // Pass expected titles to also validate series name
                const expectedTitles = mediaDetails.titles || [mediaDetails.title];
                if (!matchesRequestedEpisode(result.title, season, episode, expectedTitles)) {
                    continue; // Skip this result
                }
            }

            const hash = result.infoHash;
            const newLangInfo = getLanguageInfo(result.title, italianTitle, result.source);

            if (!bestResults.has(hash)) {
                bestResults.set(hash, result);
                console.log(`✅ [Dedup] NEW hash: ${hash.substring(0, 8)}... -> ${result.title.substring(0, 60)}... (${result.size}, ${result.seeders} seeds)`);
            } else {
                const existing = bestResults.get(hash);
                console.log(`🔍 [Dedup] DUPLICATE hash: ${hash.substring(0, 8)}... comparing "${existing.title.substring(0, 50)}..." vs "${result.title.substring(0, 50)}..."`);
                console.log(`   Existing: size=${existing.size}, seeders=${existing.seeders}, fileIndex=${existing.fileIndex}`);
                console.log(`   New: size=${result.size}, seeders=${result.seeders}, fileIndex=${result.fileIndex}`);
                const existingLangInfo = getLanguageInfo(existing.title, italianTitle, existing.source);

                let isNewBetter = false;
                // An Italian version is always better than a non-Italian one.
                if (newLangInfo.isItalian && !existingLangInfo.isItalian) {
                    isNewBetter = true;
                } else if (newLangInfo.isItalian === existingLangInfo.isItalian) {
                    // Helper to check source type (handles "💾 CorsaroNero" etc.)
                    const isJackettio = (src) => src && (src === 'Jackettio' || src.includes('Jackettio'));
                    const isCorsaro = (src) => src && (src === 'CorsaroNero' || src.includes('CorsaroNero'));

                    // If language is the same, prefer Jackettio (private instance)
                    if (isJackettio(result.source) && !isJackettio(existing.source)) {
                        isNewBetter = true;
                    } else if (isJackettio(existing.source) && !isJackettio(result.source)) {
                        isNewBetter = false; // Keep Jackettio
                    } else if (isCorsaro(result.source) && !isCorsaro(existing.source) && !isJackettio(existing.source)) {
                        isNewBetter = true;
                    } else if (result.source === existing.source || (!isCorsaro(result.source) && !isCorsaro(existing.source) && !isJackettio(result.source) && !isJackettio(existing.source))) {
                        // If source is also the same, or neither is the preferred one, prefer more seeders
                        if ((result.seeders || 0) > (existing.seeders || 0)) {
                            isNewBetter = true;
                        }
                    }
                }

                if (isNewBetter) {
                    console.log(`🔄 [Dedup] REPLACE hash ${hash.substring(0, 8)}...: "${existing.title}" -> "${result.title}" (better)`);
                    // Preserve file_title from existing if new doesn't have it
                    if (!result.file_title && existing.file_title) {
                        result.file_title = existing.file_title;
                        result.fileIndex = existing.fileIndex;
                        console.log(`🔄 [Dedup] Preserved file_title: ${existing.file_title}`);
                    }
                    bestResults.set(hash, result);
                } else {
                    console.log(`⏭️  [Dedup] SKIP hash ${hash.substring(0, 8)}...: "${result.title}" (keeping "${existing.title}")`);
                    // Preserve file_title from new if existing doesn't have it
                    if (!existing.file_title && result.file_title) {
                        existing.file_title = result.file_title;
                        existing.fileIndex = result.fileIndex;
                        bestResults.set(hash, existing); // Update map with modified object
                        console.log(`⏭️  [Dedup] Added file_title from skipped: ${result.file_title}`);
                    }
                }
            }
        }

        let results = Array.from(bestResults.values());
        console.log(`✨ After smart deduplication, we have ${results.length} unique, high-quality results.`);
        // --- FINE NUOVA LOGICA ---

        if (!results || results.length === 0) {
            console.log('❌ No results found from any source after all fallbacks');
            return { streams: [] };
        }

        console.log(`📡 Found ${results.length} total torrents from all sources after fallbacks`);

        // ✅ Apply exact matching filters
        let filteredResults = results;

        if (type === 'series') {
            const originalCount = filteredResults.length;
            const displayEpisode = kitsuId && mediaDetails.absoluteEpisode
                ? `absolute ${mediaDetails.absoluteEpisode} (S${season}E${episode})`
                : `S${season}E${episode}`;
            console.log(`📺 [Episode Filtering] Starting with ${originalCount} results for ${displayEpisode}`);

            filteredResults = filteredResults.filter(result => {
                // For Kitsu anime, we need to check BOTH:
                // 1. Absolute episode number (141) - primary for anime with absolute numbering like One Piece
                // 2. Season/Episode format (S03E01) - fallback for season-based packs
                // CRITICAL: episodeNum parameter = SEASON episode (not absolute!)
                const match = isExactEpisodeMatch(
                    result.title || result.websiteTitle,
                    mediaDetails.titles || mediaDetails.title,
                    parseInt(season),
                    parseInt(episode), // Season episode (e.g., 1 for S03E01)
                    !!kitsuId,
                    mediaDetails.absoluteEpisode // Absolute episode (e.g., 38)
                );

                if (!match) {
                    if (DEBUG_MODE) console.log(`❌ [Episode Filtering] REJECTED: "${result.title}"`);
                } else {
                    console.log(`✅ [Episode Filtering] ACCEPTED: "${result.title}"`);
                }

                return match;
            });

            console.log(`📺 Episode filtering: ${filteredResults.length} of ${originalCount} results match`);

            // ✅ PACK FILES VERIFICATION for scraped results
            if (filteredResults.length > 0 && (config.rd_key || config.torbox_key)) {
                const seasonNum = parseInt(season);
                const episodeNum = parseInt(episode);
                const seriesImdbId = mediaDetails.imdbId;
                const MAX_PACK_VERIFY = 20;
                const DELAY_MS = 200; // Balance between rate limiting and speed

                // Separate verified from unverified packs
                const verifiedPacks = [];
                const unverifiedPacks = [];
                const nonPacks = [];

                for (const result of filteredResults) {
                    const hasFileIndex = result.fileIndex !== null && result.fileIndex !== undefined;
                    const isPack = packFilesHandler.isSeasonPack(result.title);

                    if (!isPack) {
                        nonPacks.push(result);
                    } else if (hasFileIndex) {
                        verifiedPacks.push(result);
                    } else {
                        unverifiedPacks.push(result);
                    }
                }

                // Sort by size (largest first)
                unverifiedPacks.sort((a, b) => (b.sizeInBytes || 0) - (a.sizeInBytes || 0));

                console.log(`📦 [SCRAPE VERIFY] Found ${verifiedPacks.length} verified, ${unverifiedPacks.length} unverified, ${nonPacks.length} non-packs`);

                const toVerify = unverifiedPacks.slice(0, MAX_PACK_VERIFY);
                const skipped = unverifiedPacks.slice(MAX_PACK_VERIFY);

                const newlyVerified = [];
                const excluded = [];

                for (let i = 0; i < toVerify.length; i++) {
                    const result = toVerify[i];
                    const infoHash = result.infoHash?.toLowerCase() || result.magnetLink?.match(/btih:([a-fA-F0-9]{40})/i)?.[1]?.toLowerCase();

                    if (!infoHash) {
                        newlyVerified.push(result);
                        continue;
                    }

                    if (i > 0) {
                        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
                    }

                    console.log(`📦 [SCRAPE VERIFY] (${i + 1}/${toVerify.length}) Checking "${result.title.substring(0, 50)}..."`);

                    // ✅ Save original pack size BEFORE any modification
                    const originalPackSize = result.sizeInBytes || 0;

                    try {
                        const fileInfo = await packFilesHandler.resolveSeriesPackFile(
                            infoHash,
                            config,
                            seriesImdbId,
                            seasonNum,
                            episodeNum,
                            dbHelper
                        );

                        if (fileInfo) {
                            console.log(`✅ [SCRAPE VERIFY] Found E${episodeNum}: ${fileInfo.fileName}`);
                            // Use totalPackSize from fileInfo if available, otherwise use original sizeInBytes
                            result.packSize = fileInfo.totalPackSize || originalPackSize;
                            result.file_size = fileInfo.fileSize;
                            result.fileIndex = fileInfo.fileIndex;
                            result.file_title = fileInfo.fileName;
                            result.sizeInBytes = fileInfo.fileSize;
                            result.size = formatBytes(fileInfo.fileSize);
                            newlyVerified.push(result);
                        } else {
                            console.log(`❌ [SCRAPE VERIFY] E${episodeNum} NOT in pack - EXCLUDING`);
                            excluded.push(result);
                        }
                    } catch (err) {
                        console.warn(`⚠️ [SCRAPE VERIFY] Error: ${err.message} - keeping pack`);
                        newlyVerified.push(result);
                    }
                }

                console.log(`📦 [SCRAPE VERIFY] Results: ${newlyVerified.length} verified, ${excluded.length} excluded, ${skipped.length} skipped`);
                filteredResults = [...nonPacks, ...verifiedPacks, ...newlyVerified, ...skipped];
            }

            // ⚠️ FALLBACK REMOVED: Strict season matching enforced.
            if (filteredResults.length === 0 && originalCount > 0) {
                console.log('❌ Exact filtering removed all results. Strict season matching enforced: returning 0 results.');
            }
        } else if (type === 'movie') {
            const originalCount = filteredResults.length;
            let movieDetails = null;
            if (mediaDetails.tmdbId) {
                movieDetails = await getTMDBDetails(mediaDetails.tmdbId, 'movie', tmdbKey);
            }
            filteredResults = filteredResults.filter(result => {
                const torrentTitle = result.title || result.websiteTitle;

                // 🎯 SKIP YEAR FILTERING FOR PACKS (they contain multiple movies with different years)
                // Packs are identified by having a fileIndex (from pack_files table)
                if (result.fileIndex !== null && result.fileIndex !== undefined) {
                    console.log(`🎬 [Pack] SKIP year filter for pack: ${torrentTitle.substring(0, 60)}... (fileIndex=${result.fileIndex})`);
                    return true; // Always keep packs, they're already filtered by IMDb ID in DB query
                }

                // Try matching with English title
                const mainTitleMatch = isExactMovieMatch(
                    torrentTitle,
                    mediaDetails.title,
                    mediaDetails.year
                );
                if (mainTitleMatch) return true;

                // Try matching with Italian title
                if (italianTitle && italianTitle !== mediaDetails.title) {
                    const italianMatch = isExactMovieMatch(
                        torrentTitle,
                        italianTitle,
                        mediaDetails.year
                    );
                    if (italianMatch) return true;
                }

                // Try matching with original title
                if (movieDetails && movieDetails.original_title && movieDetails.original_title !== mediaDetails.title) {
                    return isExactMovieMatch(
                        torrentTitle,
                        movieDetails.original_title,
                        mediaDetails.year
                    );
                }
                return false;
            });
            console.log(`🎬 Movie filtering: ${filteredResults.length} of ${originalCount} results match`);

            // If exact matching removed too many results, be more lenient
            if (filteredResults.length === 0 && originalCount > 0) {
                console.log('⚠️ Exact filtering removed all results, using broader match');
                filteredResults = results.slice(0, Math.min(15, results.length));
            }
        }

        // ✅ LANGUAGE FILTERING (Post-Season Filter)
        // Apply "Italian Preference" ONLY after we have filtered for the correct season/episode.
        // This ensures we don't discard English S02 just because we found Italian S01.
        if (filteredResults.length > 0) {
            const hasItalianResults = filteredResults.some(r => {
                const lang = getLanguageInfo(r.title, italianTitle, r.source);
                return lang.isItalian || lang.isMulti;
            });

            if (hasItalianResults) {
                const originalCount = filteredResults.length;
                const italianOnly = filteredResults.filter(r => {
                    const lang = getLanguageInfo(r.title, italianTitle, r.source);
                    return lang.isItalian || lang.isMulti;
                });

                // Only apply if we actually filter something out
                if (italianOnly.length < originalCount) {
                    console.log(`🇮🇹 [Lang Filter] Found ${italianOnly.length} Italian results for correct season. Hiding ${originalCount - italianOnly.length} non-Italian results.`);
                    filteredResults = italianOnly;
                }
            } else {
                console.log(`🌍 [Lang Filter] No Italian results for correct season. Keeping all ${filteredResults.length} international results.`);
            }
        }

        // Limit results for performance
        const maxResults = 30; // Increased limit
        filteredResults = filteredResults.slice(0, maxResults);

        console.log(`🔄 Checking debrid services for ${filteredResults.length} results...`);
        const hashes = filteredResults.map(t => t.infoHash.toLowerCase()).filter(h => h && h.length >= 32);

        if (hashes.length === 0) {
            console.log('❌ No valid info hashes found');
            return { streams: [] };
        }

        // ✅ Check cache for enabled services in parallel
        let rdCacheResults = {};
        let rdUserTorrents = [];
        let torboxCacheResults = {};
        let torboxUserTorrents = [];
        let adCacheResults = {};

        const cacheChecks = [];

        if (useRealDebrid) {
            console.log('👑 Checking Real-Debrid cache...');
            cacheChecks.push(
                (async () => {
                    // ⚠️ instantAvailability is DISABLED by RealDebrid (error_code 37)
                    // Strategy: DB cache + Leviathan-style live check (Add → Status → Delete)

                    // STEP 1: Check DB cache for known cached torrents (< 20 days)
                    let dbCachedResults = {};
                    if (dbEnabled) {
                        dbCachedResults = await dbHelper.getRdCachedAvailability(hashes);
                        console.log(`💾 [DB Cache] ${Object.keys(dbCachedResults).length}/${hashes.length} hashes found in cache (< 20 days)`);
                    }

                    // STEP 2: Set DB cached results as base
                    rdCacheResults = { ...dbCachedResults };

                    // STEP 3: Get user torrents (personal cache - already added to RD account)
                    rdUserTorrents = await rdService.getTorrents().catch(e => {
                        console.error("⚠️ Failed to fetch RD user torrents.", e.message);
                        return [];
                    });

                    // STEP 4: Save user's personal cache to DB (becomes global cache for all users)
                    if (dbEnabled && rdUserTorrents.length > 0) {
                        const userCacheToSave = rdUserTorrents
                            .filter(t => t.hash && t.status === 'downloaded' && hashes.includes(t.hash.toLowerCase()))
                            .map(t => ({ hash: t.hash.toLowerCase(), cached: true }));

                        if (userCacheToSave.length > 0) {
                            await dbHelper.updateRdCacheStatus(userCacheToSave);
                            console.log(`💾 [GLOBAL CACHE] Saved ${userCacheToSave.length} RD personal torrents to DB (now available for all users)`);
                        }
                    }

                    // STEP 5: Leviathan-style live check for hashes NOT in DB cache
                    // Find hashes that don't have cache info yet
                    // Only exclude user torrents that are DOWNLOADED (confirmed cached)
                    const userDownloadedHashes = new Set(
                        rdUserTorrents
                            .filter(t => t.status === 'downloaded')
                            .map(t => t.hash?.toLowerCase())
                    );
                    const uncachedHashes = hashes.filter(h => {
                        // Only skip live check if DB says cached=true (confirmed in cache)
                        // If cached=false or undefined, we should re-check
                        const isConfirmedCached = dbCachedResults[h]?.cached === true;
                        const inUserDownloaded = userDownloadedHashes.has(h);
                        return !isConfirmedCached && !inUserDownloaded;
                    });

                    if (uncachedHashes.length > 0 && config.rd_key) {
                        console.log(`🔍 [RD Live Check] ${uncachedHashes.length} hashes without cache info`);

                        // Build items array with hash and magnet for checking
                        const itemsToCheck = uncachedHashes.map(hash => {
                            const result = filteredResults.find(r => r.infoHash?.toLowerCase() === hash);
                            return result ? { hash, magnet: result.magnetLink } : null;
                        }).filter(Boolean);

                        if (itemsToCheck.length > 0) {
                            // Count how many are already confirmed cached in DB
                            const dbCachedCount = hashes.filter(h => dbCachedResults[h]?.cached === true).length;

                            // SYNC: Check enough to reach 5 total verified
                            const syncLimit = Math.max(0, 5 - dbCachedCount);
                            const syncItems = itemsToCheck.slice(0, syncLimit);

                            console.log(`🔄 [RD Cache] ${dbCachedCount} already in DB cache, checking ${syncItems.length} more (target: 5 total)`);

                            if (syncItems.length > 0) {
                                const liveCheckResults = await rdCacheChecker.checkCacheSync(syncItems, config.rd_key, syncLimit);

                                // Merge live check results into rdCacheResults
                                Object.assign(rdCacheResults, liveCheckResults);

                                // Save live check results to DB for future queries
                                if (dbEnabled) {
                                    const liveResultsToSave = Object.entries(liveCheckResults).map(([hash, data]) => ({
                                        hash,
                                        cached: data.cached
                                    }));
                                    if (liveResultsToSave.length > 0) {
                                        await dbHelper.updateRdCacheStatus(liveResultsToSave);
                                        console.log(`💾 [DB] Saved ${liveResultsToSave.length} live check results to DB`);
                                    }
                                }
                            }

                            // ASYNC: Process remaining hashes in background (local, non-blocking)
                            const asyncItems = itemsToCheck.slice(syncLimit);
                            if (asyncItems.length > 0) {
                                rdCacheChecker.enrichCacheBackground(asyncItems, config.rd_key, dbHelper);
                                console.log(`🔄 [RD Background] Local enrichment for ${asyncItems.length} additional hashes`);
                            }
                        }
                    }
                })()
            );
        }

        if (useTorbox) {
            console.log('📦 Checking Torbox cache...');
            cacheChecks.push(
                Promise.all([
                    torboxService.checkCache(hashes),
                    torboxService.getTorrents().catch(e => {
                        console.error("⚠️ Failed to fetch Torbox user torrents.", e.message);
                        return [];
                    })
                ]).then(([cache, torrents]) => {
                    torboxCacheResults = cache;
                    torboxUserTorrents = torrents;
                })
            );
        }

        if (useAllDebrid) {
            console.log('🅰️ Checking AllDebrid cache...');
            cacheChecks.push(
                adService.checkCache(hashes).then(cache => {
                    adCacheResults = cache;
                }).catch(e => {
                    console.error("⚠️ Failed to fetch AllDebrid cache.", e.message);
                })
            );
        }

        await Promise.all(cacheChecks);

        console.log(`✅ Cache check complete. RD: ${rdUserTorrents.length} torrents, Torbox: ${torboxUserTorrents.length} torrents, AllDebrid: ${Object.keys(adCacheResults).length} hashes`);

        // ✅ PACK FILE MATCHING: For movies with pack torrents, determine best file
        if (type === 'movie' && mediaDetails) {
            console.log(`\n🎯 [Pack] Checking for pack torrents in ${filteredResults.length} results...`);

            for (const result of filteredResults) {
                // Detect if this is a pack (has all_imdb_ids or matches pack pattern)
                const isPack = /\b(trilog|saga|collection|collezione|pack|completa|integrale|filmografia)\b/i.test(result.title) ||
                    /\b(19[2-9]\d|20[0-3]\d)-(19[2-9]\d|20[0-3]\d)\b/.test(result.title);

                if (isPack) {
                    console.log(`📦 [Pack] Detected pack: "${result.title}"`);

                    // Try to get torrent info to access file list
                    // We'll do this lazily when user clicks, but we can mark it as a pack
                    result.isPack = true;

                    // For now, we'll handle file selection in the stream endpoint
                    // The stream endpoint will need to:
                    // 1. Add magnet to RD/Torbox
                    // 2. Get torrent info (file list)
                    // 3. Call matchPackFile() to find best file
                    // 4. Select that specific file
                }
            }
        }

        // ✅ Build streams with enhanced error handling - supports multiple debrid services
        let streams = [];

        // ⏩ INTROSKIP: Lookup intro data for series episodes (only for debrid)
        let introData = null;
        const useAnyDebrid = useRealDebrid || useTorbox;
        if (config.introskip_enabled && type === 'series' && season && episode && useAnyDebrid) {
            const seriesImdbId = mediaDetails?.imdbId || imdbId;
            if (seriesImdbId && seriesImdbId.startsWith('tt')) {
                console.log(`⏩ [IntroSkip] Looking up intro for ${seriesImdbId} S${season}E${episode}...`);
                introData = await introSkip.lookupIntro(seriesImdbId, parseInt(season), parseInt(episode));
                if (introData) {
                    console.log(`⏩ [IntroSkip] Found intro: ${introData.start_sec}s - ${introData.end_sec}s (confidence: ${introData.confidence})`);
                } else {
                    console.log(`⏩ [IntroSkip] No intro data found`);
                }
            }
        }

        for (const result of filteredResults) {
            try {
                const qualityDisplay = result.quality ? result.quality.toUpperCase() : 'Unknown';
                const qualitySymbol = getQualitySymbol(qualityDisplay);
                const { icon: languageIcon } = getLanguageInfo(result.title, italianTitle);
                const packIcon = isSeasonPack(result.title) ? '📦 ' : ''; // Season pack indicator
                const encodedConfig = btoa(JSON.stringify(config));
                const infoHashLower = result.infoHash.toLowerCase();

                // ✅ REAL-DEBRID STREAM (if enabled)
                if (useRealDebrid) {
                    const rdCacheData = rdCacheResults[infoHashLower];
                    const rdUserTorrent = rdUserTorrents.find(t => t.hash?.toLowerCase() === infoHashLower);

                    // ✅ NEW: Populate file_title from DB cache if not already set
                    if (!result.file_title && rdCacheData?.file_title) {
                        result.file_title = rdCacheData.file_title;
                        console.log(`📄 [RD] Using cached file_title: ${result.file_title.substring(0, 40)}...`);
                    }

                    let streamUrl = '';
                    let cacheType = 'none';
                    let streamError = null;

                    // ✅ UNIFIED ENDPOINT: Always use /rd-stream/ with magnet link
                    // For series, add season/episode info for pattern matching in packs
                    // For movie packs, add fileIdx for specific file selection
                    if (type === 'series' && season && episode) {
                        streamUrl = `${workerOrigin}/rd-stream/${encodedConfig}/${encodeURIComponent(result.magnetLink)}/${season}/${episode}`;
                    } else if (type === 'movie' && result.fileIndex !== undefined && result.fileIndex !== null) {
                        // Movie pack: add fileIdx to URL
                        streamUrl = `${workerOrigin}/rd-stream/${encodedConfig}/${encodeURIComponent(result.magnetLink)}/pack/${result.fileIndex}`;
                    } else {
                        streamUrl = `${workerOrigin}/rd-stream/${encodedConfig}/${encodeURIComponent(result.magnetLink)}`;
                    }

                    // ✅ CACHE PRIORITY: DB cache (global) > User torrents (personal) > None
                    // 1. Check DB cache (saved by any user, valid < 5 days)
                    // 2. Check user's personal torrents (already added to their RD account)
                    // 3. No cache available
                    if (rdCacheData?.cached) {
                        cacheType = 'global';
                        console.log(`👑 ⚡ RD GLOBAL cache (DB): ${result.title}`);
                    } else if (rdUserTorrent && rdUserTorrent.status === 'downloaded') {
                        cacheType = 'personal';
                        console.log(`👑 👤 Found in RD PERSONAL cache: ${result.title}`);
                    } else {
                        cacheType = 'none';
                    }

                    const isCached = cacheType === 'global' || cacheType === 'personal';
                    const cacheStatusIcon = isCached ? '⚡' : '⏬';
                    const errorIcon = streamError ? '⚠️ ' : '';

                    // New Name Format: IL 🏴‍☠️ 🔮 [👑] [⚡] \n [Quality]
                    let badgePrefix = 'IL 🏴‍☠️ 🔮';

                    if (result.externalAddon) {
                        const addonName = EXTERNAL_ADDONS[result.externalAddon] ? EXTERNAL_ADDONS[result.externalAddon].name : result.externalAddon;
                        badgePrefix = `${result.sourceEmoji || '🔗'} ${addonName}`;
                    }

                    // AIOStreams-compatible format or standard format
                    let streamName;
                    const introIcon = introData ? '⏩ ' : '';
                    if (config.aiostreams_mode) {
                        streamName = aioFormatter.formatStreamName({
                            addonName: 'IlCorsaroViola',
                            service: 'realdebrid',
                            cached: isCached,
                            quality: result.quality || 'Unknown',
                            hasError: !!streamError
                        });
                        if (introData) streamName = `${introIcon}${streamName}`;
                    } else {
                        streamName = `${introIcon}${badgePrefix} [👑] [${cacheStatusIcon}]${errorIcon}\n${result.quality || 'Unknown'}`;
                    }

                    const debugInfo = streamError ? `\n⚠️ Stream error: ${streamError}` : '';

                    // New Title Format
                    let titleLine1 = '';
                    let titleLine2 = '';

                    // ✅ FIX: A pack is ONLY when the title indicates a season pack, NOT just having fileIndex
                    // fileIndex is now also set for single episodes after verification
                    const isPack = packFilesHandler.isSeasonPack(result.title);

                    if (isPack) {
                        // ✅ AIO Mode: Prioritize File Name for visibility
                        if (config.aiostreams_mode && result.file_title) {
                            titleLine1 = `📂 ${result.file_title}`;
                            titleLine2 = `🗳️ ${result.title}`;
                        } else {
                            // Standard Mode
                            titleLine1 = `🗳️ ${result.title}`;
                            // If we have a specific file title (from DB or constructed), show it
                            if (result.file_title) {
                                titleLine2 = `📂 ${result.file_title}`;
                            } else if (type === 'series' && season && episode && mediaDetails) {
                                const seasonStr = String(season).padStart(2, '0');
                                const episodeStr = String(episode).padStart(2, '0');
                                titleLine2 = `📂 ${mediaDetails.title} S${seasonStr}E${episodeStr}`;
                            } else {
                                titleLine2 = `📂 ${result.filename || result.title}`;
                            }
                        }
                    } else {
                        // ✅ AIO Mode: Use file_title if available (even for non-packs)
                        if (config.aiostreams_mode && result.file_title) {
                            titleLine1 = `🎬 ${result.file_title}`;
                        } else {
                            titleLine1 = `🎬 ${result.title}`;
                        }
                    }

                    // ✅ SIZE DISPLAY: Show "pack / episode" format like MediaFusion when we have both sizes
                    let sizeLine;
                    // For packs: packSize should be the original pack size, episodeSize is the individual file
                    // If packSize wasn't set, use sizeInBytes as the pack size when we have file_size
                    // Force Number() to avoid string comparison issues
                    const episodeSize = Number(result.file_size) || 0;
                    const packSize = Number(result.packSize) || (episodeSize > 0 && isPack ? (Number(result.sizeInBytes) || 0) : 0);

                    // Debug: log sizes
                    if (isPack) {
                        console.log(`📦 [SIZE DEBUG] Pack: "${result.title.substring(0, 40)}..." packSize=${formatBytes(packSize)}, episodeSize=${formatBytes(episodeSize)}, sizeInBytes=${formatBytes(result.sizeInBytes || 0)}, rawPackSize=${formatBytes(result.packSize || 0)}`);
                    }

                    if (isPack && episodeSize > 0 && packSize > 0 && episodeSize < packSize) {
                        // Pack with known episode size: show both
                        sizeLine = `💾 ${formatBytes(packSize)} / ${formatBytes(episodeSize)}`;
                        console.log(`✅ [SIZE LINE] DUAL format: "${sizeLine}" (isPack=${isPack}, ep=${episodeSize}, pack=${packSize})`);
                    } else {
                        // Single file or pack without episode size
                        sizeLine = `💾 ${result.size || 'Unknown'}`;
                        if (isPack) {
                            console.log(`❌ [SIZE LINE] SINGLE format: "${sizeLine}" (isPack=${isPack}, ep=${episodeSize}, pack=${packSize}, condition: ep>0=${episodeSize > 0}, pack>0=${packSize > 0}, ep<pack=${episodeSize < packSize})`);
                        }
                    }

                    // Languages
                    const langInfo = getLanguageInfo(result.title, italianTitle, result.source);
                    const langDisplay = langInfo.displayLabel;
                    const languageLine = `🗣️ ${langDisplay}`;

                    // Normalize provider name
                    let providerName = result.source;

                    // For external addons, display ONLY the specific provider in parentheses
                    if (result.externalAddon && result.externalProvider) {
                        providerName = `(${result.externalProvider})`;
                    }

                    if (providerName.toLowerCase().includes('corsaro') && !result.externalAddon) {
                        providerName = 'IlCorsaroNero';
                    }

                    const providerLine = `🔗 ${providerName} 👥 ${result.seeders || 0}`;

                    // Proxy RD indicator
                    const proxyActive = config.mediaflow_url ? true : false;
                    const lastLine = proxyActive ? '☂️ Proxy RD' : '';

                    const streamTitle = [
                        titleLine1,
                        titleLine2,
                        sizeLine,
                        languageLine,
                        providerLine,
                        lastLine,
                        debugInfo
                    ].filter(Boolean).join('\n');

                    // Build stream with infoHash for P2P fallback
                    const rdStream = {
                        name: streamName,
                        title: streamTitle,
                        infoHash: result.infoHash,
                        url: streamUrl,
                        behaviorHints: {
                            bingeGroup: 'uindex-realdebrid-optimized',
                            notWebReady: false,
                            // AIOStreams compatibility: provide file size and name for dedup
                            ...(result.size ? { videoSize: isPack ? (result.file_size || result.size) : result.size } : {}),
                            ...(result.file_title || result.title ? { filename: isPack ? (result.file_title || result.title) : (result.filename || result.title) } : {})
                        },
                        _meta: {
                            infoHash: result.infoHash,
                            cached: isCached,
                            cacheSource: cacheType,
                            service: 'realdebrid',
                            originalSize: result.size,
                            quality: result.quality,
                            seeders: result.seeders,
                            error: streamError
                        }
                    };

                    // Add fileIdx for pack torrents (P2P fallback support)
                    if (result.fileIndex !== null && result.fileIndex !== undefined) {
                        rdStream.fileIdx = result.fileIndex;
                    }

                    // ✅ Apply custom formatter if configured
                    applyCustomFormatter(rdStream, result, config, 'RD', isCached);

                    streams.push(rdStream);
                }

                // ✅ TORBOX STREAM (if enabled)
                if (useTorbox) {
                    const torboxCacheData = torboxCacheResults[infoHashLower];
                    const torboxUserTorrent = torboxUserTorrents.find(t => t.hash?.toLowerCase() === infoHashLower);

                    let streamUrl = '';
                    let cacheType = 'none';
                    let streamError = null;

                    // ✅ UNIFIED ENDPOINT: Always use /torbox-stream/ with magnet link
                    // The endpoint will handle: global cache, personal cache, or add new torrent
                    // Include season/episode for series to select correct file from pack
                    if (type === 'series' && season && episode) {
                        streamUrl = `${workerOrigin}/torbox-stream/${encodedConfig}/${encodeURIComponent(result.magnetLink)}/${season}/${episode}`;
                        console.log(`📦 [Torbox] Stream URL with S${season}E${episode}: ${result.title}`);
                    } else {
                        streamUrl = `${workerOrigin}/torbox-stream/${encodedConfig}/${encodeURIComponent(result.magnetLink)}`;
                    }

                    // ✅ EXACT TORRENTIO LOGIC: If Torbox says cached, show as cached
                    if (torboxCacheData?.cached) {
                        cacheType = 'global';
                        console.log(`📦 ⚡ Torbox GLOBAL cache available: ${result.title}`);
                    } else if (torboxUserTorrent && torboxUserTorrent.download_finished === true) {
                        cacheType = 'personal';
                        console.log(`📦 👤 Found in Torbox PERSONAL cache: ${result.title}`);
                    } else {
                        cacheType = 'none';
                    }

                    const isCached = cacheType === 'global' || cacheType === 'personal';
                    const cacheStatusIcon = isCached ? '⚡' : '⏬';
                    const errorIcon = streamError ? '⚠️ ' : '';

                    // Badge uses addon name for external addons
                    let badgePrefix = 'IL 🏴‍☠️ 🔮';
                    if (result.externalAddon) {
                        const addonName = EXTERNAL_ADDONS[result.externalAddon] ? EXTERNAL_ADDONS[result.externalAddon].name : result.externalAddon;
                        badgePrefix = `${result.sourceEmoji || '🔗'} ${addonName}`;
                    }

                    // AIOStreams-compatible format or standard format
                    let streamName;
                    const introIconTB = introData ? '⏩ ' : '';
                    if (config.aiostreams_mode) {
                        streamName = aioFormatter.formatStreamName({
                            addonName: 'IlCorsaroViola',
                            service: 'torbox',
                            cached: isCached,
                            quality: result.quality || 'Unknown',
                            hasError: !!streamError
                        });
                        if (introData) streamName = `${introIconTB}${streamName}`;
                    } else {
                        streamName = `${introIconTB}${badgePrefix} [📦] [${cacheStatusIcon}]${errorIcon}\n${result.quality || 'Unknown'}`;
                    }

                    // New Title Format
                    let titleLine1 = '';
                    let titleLine2 = '';

                    const isPack = packFilesHandler.isSeasonPack(result.title);

                    if (isPack) {
                        // ✅ AIO Mode: Prioritize File Name for visibility
                        if (config.aiostreams_mode && result.file_title) {
                            titleLine1 = `📂 ${result.file_title}`;
                            titleLine2 = `🗳️ ${result.title}`;
                        } else {
                            titleLine1 = `🗳️ ${result.title}`;
                            if (result.file_title) {
                                titleLine2 = `📂 ${result.file_title}`;
                            } else if (type === 'series' && season && episode && mediaDetails) {
                                const seasonStr = String(season).padStart(2, '0');
                                const episodeStr = String(episode).padStart(2, '0');
                                titleLine2 = `📂 ${mediaDetails.title} S${seasonStr}E${episodeStr}`;
                            } else {
                                titleLine2 = `📂 ${result.filename || result.title}`;
                            }
                        }
                    } else {
                        // ✅ AIO Mode: Use file_title if available (even for non-packs)
                        if (config.aiostreams_mode && result.file_title) {
                            titleLine1 = `🎬 ${result.file_title}`;
                        } else {
                            titleLine1 = `🎬 ${result.title}`;
                        }
                    }

                    // Size display with pack/episode format
                    let sizeLine;
                    const packSize = result.packSize || 0;
                    const episodeSize = result.file_size || 0;
                    if (isPack && episodeSize > 0 && packSize > 0 && episodeSize < packSize) {
                        sizeLine = `💾 ${formatBytes(packSize)} / ${formatBytes(episodeSize)}`;
                    } else {
                        sizeLine = `💾 ${result.size || 'Unknown'}`;
                    }

                    const langInfo = getLanguageInfo(result.title, italianTitle, result.source);
                    const langDisplay = langInfo.displayLabel;
                    const languageLine = `🗣️ ${langDisplay}`;

                    // Normalize provider name
                    let providerName = result.source;

                    // For external addons, display ONLY the specific provider in parentheses
                    if (result.externalAddon && result.externalProvider) {
                        providerName = `(${result.externalProvider})`;
                    }

                    if (providerName.toLowerCase().includes('corsaro') && !result.externalAddon) {
                        providerName = 'IlCorsaroNero';
                    }

                    const providerLine = `🔗 ${providerName} 👥 ${result.seeders || 0}`;
                    const lastLine = '';

                    const streamTitle = [
                        titleLine1,
                        titleLine2,
                        sizeLine,
                        languageLine,
                        providerLine,
                        lastLine
                    ].filter(Boolean).join('\n');

                    // Build stream with infoHash for P2P fallback
                    const torboxStream = {
                        name: streamName,
                        title: streamTitle,
                        infoHash: result.infoHash,
                        url: streamUrl,
                        behaviorHints: {
                            bingeGroup: 'uindex-torbox-optimized',
                            notWebReady: false,
                            // AIOStreams compatibility
                            ...(result.size ? { videoSize: isPack ? (result.file_size || result.size) : result.size } : {}),
                            ...(result.file_title || result.title ? { filename: isPack ? (result.file_title || result.title) : (result.filename || result.title) } : {})
                        },
                        _meta: {
                            infoHash: result.infoHash,
                            cached: isCached,
                            cacheSource: cacheType,
                            service: 'torbox',
                            originalSize: result.size,
                            quality: result.quality,
                            seeders: result.seeders
                        }
                    };

                    // Add fileIdx for pack torrents (P2P fallback support)
                    if (result.fileIndex !== null && result.fileIndex !== undefined) {
                        torboxStream.fileIdx = result.fileIndex;
                    }

                    // ✅ Apply custom formatter if configured
                    applyCustomFormatter(torboxStream, result, config, 'TB', isCached);

                    streams.push(torboxStream);
                }

                // ✅ ALLDEBRID STREAM (if enabled)
                if (useAllDebrid) {
                    const adCacheData = adCacheResults[infoHashLower];

                    let streamUrl = '';
                    let cacheType = 'none';
                    let streamError = null;

                    // ✅ UNIFIED ENDPOINT: Always use /ad-stream/ with magnet link
                    streamUrl = `${workerOrigin}/ad-stream/${encodedConfig}/${encodeURIComponent(result.magnetLink)}`;

                    if (adCacheData?.cached) {
                        cacheType = 'global';
                        console.log(`🅰️ ⚡ AllDebrid GLOBAL cache available: ${result.title}`);
                    } else {
                        cacheType = 'none';
                    }

                    const isCached = cacheType === 'global';
                    const cacheStatusIcon = isCached ? '⚡' : '⏬';
                    const errorIcon = streamError ? '⚠️ ' : '';

                    // Badge uses addon name for external addons
                    let badgePrefix = 'IL 🏴‍☠️ 🔮';
                    if (result.externalAddon) {
                        const addonName = EXTERNAL_ADDONS[result.externalAddon] ? EXTERNAL_ADDONS[result.externalAddon].name : result.externalAddon;
                        badgePrefix = `${result.sourceEmoji || '🔗'} ${addonName}`;
                    }

                    // AIOStreams-compatible format or standard format
                    let streamName;
                    if (config.aiostreams_mode) {
                        streamName = aioFormatter.formatStreamName({
                            addonName: 'IlCorsaroViola',
                            service: 'alldebrid',
                            cached: isCached,
                            quality: result.quality || 'Unknown',
                            hasError: !!streamError
                        });
                    } else {
                        streamName = `${badgePrefix} [🅰️] [${cacheStatusIcon}]${errorIcon}\n${result.quality || 'Unknown'}`;
                    }

                    // New Title Format
                    let titleLine1 = '';
                    let titleLine2 = '';

                    const isPack = packFilesHandler.isSeasonPack(result.title);

                    if (isPack) {
                        // ✅ AIO Mode: Prioritize File Name for visibility
                        if (config.aiostreams_mode && result.file_title) {
                            titleLine1 = `📂 ${result.file_title}`;
                            titleLine2 = `🗳️ ${result.title}`;
                        } else {
                            titleLine1 = `🗳️ ${result.title}`;
                            if (result.file_title) {
                                titleLine2 = `📂 ${result.file_title}`;
                            } else if (type === 'series' && season && episode && mediaDetails) {
                                const seasonStr = String(season).padStart(2, '0');
                                const episodeStr = String(episode).padStart(2, '0');
                                titleLine2 = `📂 ${mediaDetails.title} S${seasonStr}E${episodeStr}`;
                            } else {
                                titleLine2 = `📂 ${result.filename || result.title}`;
                            }
                        }
                    } else {
                        // ✅ AIO Mode: Use file_title if available (even for non-packs)
                        if (config.aiostreams_mode && result.file_title) {
                            titleLine1 = `🎬 ${result.file_title}`;
                        } else {
                            titleLine1 = `🎬 ${result.title}`;
                        }
                    }

                    // Size display with pack/episode format
                    let sizeLine;
                    const packSize = result.packSize || 0;
                    const episodeSize = result.file_size || 0;
                    if (isPack && episodeSize > 0 && packSize > 0 && episodeSize < packSize) {
                        sizeLine = `💾 ${formatBytes(packSize)} / ${formatBytes(episodeSize)}`;
                    } else {
                        sizeLine = `💾 ${result.size || 'Unknown'}`;
                    }

                    const langInfo = getLanguageInfo(result.title, italianTitle, result.source);
                    const langDisplay = langInfo.displayLabel;
                    const languageLine = `🗣️ ${langDisplay}`;

                    // Normalize provider name
                    let providerName = result.source;

                    // For external addons, display ONLY the specific provider in parentheses
                    if (result.externalAddon && result.externalProvider) {
                        providerName = `(${result.externalProvider})`;
                    }

                    if (providerName.toLowerCase().includes('corsaro') && !result.externalAddon) {
                        providerName = 'IlCorsaroNero';
                    }

                    const providerLine = `🔗 ${providerName} 👥 ${result.seeders || 0}`;
                    const lastLine = '';

                    const streamTitle = [
                        titleLine1,
                        titleLine2,
                        sizeLine,
                        languageLine,
                        providerLine,
                        lastLine
                    ].filter(Boolean).join('\n');

                    // Build stream with infoHash for P2P fallback
                    const adStream = {
                        name: streamName,
                        title: streamTitle,
                        infoHash: result.infoHash,
                        url: streamUrl,
                        behaviorHints: {
                            bingeGroup: 'uindex-alldebrid-optimized',
                            notWebReady: false,
                            // AIOStreams compatibility
                            ...(result.size ? { videoSize: isPack ? (result.file_size || result.size) : result.size } : {}),
                            ...(result.file_title || result.title ? { filename: isPack ? (result.file_title || result.title) : (result.filename || result.title) } : {})
                        },
                        _meta: {
                            infoHash: result.infoHash,
                            cached: isCached,
                            cacheSource: cacheType,
                            service: 'alldebrid',
                            originalSize: result.size,
                            quality: result.quality,
                            seeders: result.seeders
                        }
                    };

                    // Add fileIdx for pack torrents (P2P fallback support)
                    if (result.fileIndex !== null && result.fileIndex !== undefined) {
                        adStream.fileIdx = result.fileIndex;
                    }

                    streams.push(adStream);
                }

                // ✅ P2P STREAM (if no debrid service enabled)
                if (!useRealDebrid && !useTorbox && !useAllDebrid) {
                    // Badge uses addon name for external addons
                    let badgePrefix = 'IL 🏴‍☠️ 🔮';
                    if (result.externalAddon) {
                        const addonName = EXTERNAL_ADDONS[result.externalAddon] ? EXTERNAL_ADDONS[result.externalAddon].name : result.externalAddon;
                        badgePrefix = `${result.sourceEmoji || '🔗'} ${addonName}`;
                    }

                    // AIOStreams-compatible format or standard format
                    let streamName;
                    if (config.aiostreams_mode) {
                        streamName = aioFormatter.formatStreamName({
                            addonName: 'IlCorsaroViola',
                            service: 'p2p',
                            cached: false, // P2P is never cached
                            quality: result.quality || 'Unknown',
                            hasError: false
                        });
                    } else {
                        streamName = `${badgePrefix} [🧲] [⏬]\n${result.quality || 'Unknown'}`;
                    }

                    // New Title Format
                    let titleLine1 = '';
                    let titleLine2 = '';

                    const isPack = packFilesHandler.isSeasonPack(result.title);

                    if (isPack) {
                        titleLine1 = `🗳️ ${result.title}`;
                        if (result.file_title) {
                            titleLine2 = `📂 ${result.file_title}`;
                        } else if (type === 'series' && season && episode && mediaDetails) {
                            const seasonStr = String(season).padStart(2, '0');
                            const episodeStr = String(episode).padStart(2, '0');
                            titleLine2 = `📂 ${mediaDetails.title} S${seasonStr}E${episodeStr}`;
                        } else {
                            titleLine2 = `📂 ${result.filename || result.title}`;
                        }
                    } else {
                        titleLine1 = `🎬 ${result.title}`;
                    }

                    // Size display with pack/episode format
                    let sizeLine;
                    const episodeSize = result.file_size || 0;
                    const packSize = result.packSize || (episodeSize > 0 && isPack ? (result.sizeInBytes || 0) : 0);

                    // Debug: log sizes for P2P
                    if (isPack) {
                        console.log(`📦 [P2P SIZE] Pack: "${result.title.substring(0, 40)}..." packSize=${formatBytes(packSize)}, episodeSize=${formatBytes(episodeSize)}, rawPackSize=${formatBytes(result.packSize || 0)}`);
                    }

                    if (isPack && episodeSize > 0 && packSize > 0 && episodeSize < packSize) {
                        sizeLine = `💾 ${formatBytes(packSize)} / ${formatBytes(episodeSize)}`;
                    } else {
                        sizeLine = `💾 ${result.size || 'Unknown'}`;
                    }

                    const langInfo = getLanguageInfo(result.title, italianTitle, result.source);
                    const langDisplay = langInfo.displayLabel;
                    const languageLine = `🗣️ ${langDisplay}`;

                    // Normalize provider name
                    let providerName = result.source;

                    // For external addons, display ONLY the specific provider in parentheses
                    if (result.externalAddon && result.externalProvider) {
                        providerName = `(${result.externalProvider})`;
                    }

                    if (providerName.toLowerCase().includes('corsaro') && !result.externalAddon) {
                        providerName = 'IlCorsaroNero';
                    }

                    const providerLine = `🔗 ${providerName} 👥 ${result.seeders || 0}`;
                    const lastLine = '';

                    const streamTitle = [
                        titleLine1,
                        titleLine2,
                        sizeLine,
                        languageLine,
                        providerLine,
                        lastLine
                    ].filter(Boolean).join('\n');

                    // 🔥 P2P Pack Support: Add fileIdx for pack torrents
                    const p2pStream = {
                        name: streamName,
                        title: streamTitle,
                        infoHash: result.infoHash,
                        behaviorHints: {
                            bingeGroup: 'uindex-p2p',
                            notWebReady: true,
                            // AIOStreams compatibility
                            ...(result.size ? { videoSize: isPack ? (result.file_size || result.size) : result.size } : {}),
                            ...(result.file_title || result.title ? { filename: isPack ? (result.file_title || result.title) : (result.filename || result.title) } : {})
                        },
                        _meta: { infoHash: result.infoHash, cached: false, quality: result.quality, seeders: result.seeders }
                    };

                    // Add fileIdx if this is a pack torrent with a specific file selected
                    if (result.fileIndex !== null && result.fileIndex !== undefined) {
                        p2pStream.fileIdx = result.fileIndex;
                        console.log(`🔥 [P2P Pack] Added fileIdx=${result.fileIndex} for ${result.title.substring(0, 50)}...`);
                    }

                    streams.push(p2pStream);

                    // ✅ Apply custom formatter if configured (same as RD/TB)
                    applyCustomFormatter(p2pStream, result, config, 'P2P', false);
                }

            } catch (error) {
                console.error(`❌ Error processing result:`, error);

                // Return a basic stream even if processing failed
                streams.push({
                    name: `❌ ${result.title} (Error)`,
                    title: `Error processing: ${error.message}`,
                    url: result.magnetLink,
                    behaviorHints: {
                        bingeGroup: 'uindex-error',
                        notWebReady: true
                    }
                });
            }
        }

        // Helper function for resolution score
        const getResolutionScore = (stream) => {
            const quality = (stream._meta?.quality || '').toLowerCase();
            const name = (stream.name || '').toLowerCase();
            const title = (stream.title || '').toLowerCase();
            const combined = quality + ' ' + name + ' ' + title;

            if (combined.includes('2160') || combined.includes('4k')) return 2160;
            if (combined.includes('1080')) return 1080;
            if (combined.includes('720')) return 720;
            if (combined.includes('480')) return 480;
            return 0;
        };

        // Helper function for size in bytes
        const getSizeInBytes = (stream) => {
            let sizeStr = stream._meta?.originalSize;

            // Fallback: try to find size in title (e.g. "💾 1.5 GB")
            if (!sizeStr && stream.title) {
                const match = stream.title.match(/💾\s*(.+)/);
                if (match) sizeStr = match[1];
            }

            if (!sizeStr) return 0;

            // Parse "1.5 GB", "700 MB", etc.
            const sizeStrConverted = String(sizeStr || '');
            const match = sizeStrConverted.match(/([\d.]+)\s*([a-zA-Z]+)/);
            if (!match) return 0;

            const val = parseFloat(match[1]);
            const unit = match[2].toUpperCase();

            let multiplier = 1;
            if (unit.includes('GB')) multiplier = 1024 * 1024 * 1024;
            else if (unit.includes('MB')) multiplier = 1024 * 1024;
            else if (unit.includes('KB')) multiplier = 1024;

            return val * multiplier;
        };

        // ✅ P2P MODE SORTING: Quality > Seeders > Size (no cache priority)
        // ✅ DEBRID MODE SORTING: Cache > Resolution > Size > Seeders
        const isP2PMode = !useRealDebrid && !useTorbox && !useAllDebrid;

        if (isP2PMode) {
            console.log(`🔄 [P2P Sorting] Applying P2P sort order: Quality > Seeders > Size`);
            streams.sort((a, b) => {
                // 1. Resolution (High to Low)
                const resA = getResolutionScore(a);
                const resB = getResolutionScore(b);

                if (resA !== resB) {
                    return resB - resA; // Higher resolution first
                }

                // 2. Seeders (More is better)
                const seedsA = a._meta?.seeders || 0;
                const seedsB = b._meta?.seeders || 0;

                if (seedsA !== seedsB) {
                    return seedsB - seedsA; // Higher seeders first
                }

                // 3. Size (Tie-breaker: Larger first)
                const sizeA = getSizeInBytes(a);
                const sizeB = getSizeInBytes(b);
                return sizeB - sizeA;
            });
        } else {
            // ✅ DEBRID SORTING: Cache > Resolution > Size > Seeders
            streams.sort((a, b) => {
                // 1. Cached Status (Cached first)
                const isCachedA = (a._meta && a._meta.cached) || (a.name && a.name.includes('⚡'));
                const isCachedB = (b._meta && b._meta.cached) || (b.name && b.name.includes('⚡'));

                if (isCachedA !== isCachedB) {
                    return isCachedA ? -1 : 1; // Cached comes first
                }

                // 2. Resolution (High to Low)
                const resA = getResolutionScore(a);
                const resB = getResolutionScore(b);

                if (resA !== resB) {
                    return resB - resA; // Higher resolution first
                }

                // 3. Size (Big to Small)
                const sizeA = getSizeInBytes(a);
                const sizeB = getSizeInBytes(b);

                if (sizeA !== sizeB) {
                    return sizeB - sizeA; // Larger size first
                }

                // 4. Seeders (Fallback)
                const seedsA = a._meta?.seeders || 0;
                const seedsB = b._meta?.seeders || 0;
                return seedsB - seedsA;
            });
        }

        // ✅ Apply Max Resolution Limit (if configured)
        if (config.max_res_limit) {
            const limit = parseInt(config.max_res_limit);
            if (!isNaN(limit) && limit > 0) {
                console.log(`✂️ Applying resolution limit: max ${limit} results per resolution`);
                streams = limitResultsByResolution(streams, limit);
            }
        }

        const cachedCount = streams.filter(s => s.name.includes('⚡')).length;
        const totalTime = Date.now() - startTime;

        console.log(`🎉 Successfully processed ${streams.length} streams in ${totalTime}ms`);
        console.log(`⚡ ${cachedCount} cached streams available for instant playback`);

        // 🔥 ENRICHMENT: VPS webhook with load balancing (must complete BEFORE returning response)
        console.log(`🔍 [Background Check] dbEnabled=${dbEnabled}, mediaDetails=${!!mediaDetails}, tmdbId=${mediaDetails?.tmdbId}, imdbId=${mediaDetails?.imdbId}, kitsuId=${mediaDetails?.kitsuId}`);

        if (dbEnabled && mediaDetails && (mediaDetails.tmdbId || mediaDetails.imdbId || mediaDetails.kitsuId)) {
            console.log(`🔍 [Enrichment] Preparing webhook for "${mediaDetails.title}"`);
            console.log(`🔍 [Enrichment Titles] Italian: "${italianTitle || 'N/A'}", Original: "${originalTitle || 'N/A'}", English: "${mediaDetails.title}"`);

            // 🔄 Load balancing: Round-robin between VPS1 and VPS2
            const enrichmentServers = [
                process.env.ENRICHMENT_SERVER_URL,
                process.env.ENRICHMENT_SERVER_URL_2
            ].filter(Boolean); // Remove undefined values

            if (enrichmentServers.length === 0) {
                console.warn('⚠️ [Enrichment] No enrichment servers configured');
                enrichmentServers.push('http://89.168.25.177:3001/enrich'); // Fallback
            }

            // Simple round-robin counter (rotates between servers)
            if (!global.enrichmentServerIndex) {
                global.enrichmentServerIndex = 0;
            }
            const enrichmentUrl = enrichmentServers[global.enrichmentServerIndex % enrichmentServers.length];
            global.enrichmentServerIndex = (global.enrichmentServerIndex + 1) % enrichmentServers.length;

            const enrichmentApiKey = process.env.ENRICHMENT_API_KEY || 'change-me-in-production';

            console.log(`🚀 [Webhook] Calling VPS enrichment (server ${global.enrichmentServerIndex === 0 ? 2 : 1}): ${enrichmentUrl}`);

            try {
                const webhookResponse = await fetch(enrichmentUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': enrichmentApiKey
                    },
                    body: JSON.stringify({
                        imdbId: mediaDetails.imdbId,
                        tmdbId: mediaDetails.tmdbId,
                        italianTitle: italianTitle,
                        originalTitle: originalTitle || mediaDetails.title,
                        type: type,
                        year: mediaDetails.year,
                        searchQueries: finalSearchQueries || [] // ✅ Send pre-built queries
                    }),
                    signal: AbortSignal.timeout(5000)
                });

                if (webhookResponse.ok) {
                    console.log(`✅ [Webhook] Enrichment queued (${webhookResponse.status})`);
                } else {
                    console.warn(`⚠️ [Webhook] Failed: ${webhookResponse.status}`);
                }
            } catch (err) {
                console.warn(`⚠️ [Webhook] Unreachable:`, err.message);
            }
        } else {
            console.log(`⏭️  [Background] Enrichment skipped (dbEnabled=${dbEnabled}, hasMediaDetails=${!!mediaDetails}, hasIds=${!!(mediaDetails?.tmdbId || mediaDetails?.imdbId || mediaDetails?.kitsuId)})`);
        }

        return {
            streams,
            _debug: {
                originalQuery: searchQueries[0],
                totalResults: results.length,
                filteredResults: filteredResults.length,
                finalStreams: streams.length,
                cachedStreams: cachedCount,
                processingTimeMs: totalTime,
                tmdbData: mediaDetails
            }
        };

    } catch (error) {
        const totalTime = Date.now() - startTime;
        console.error(`❌ Error in handleStream after ${totalTime}ms:`, error);

        return {
            streams: [],
            _debug: {
                error: error.message,
                processingTimeMs: totalTime,
                step: 'handleStream'
            }
        };
    }
}

// ✅ TMDB helper functions (keeping existing but adding better error handling)
async function getTMDBDetails(tmdbId, type = 'movie', tmdbApiKey, append = 'external_ids', language = 'it-IT') {
    try {
        const url = `${TMDB_BASE_URL}/${type}/${tmdbId}?api_key=${tmdbApiKey}&language=${language}&append_to_response=${append}`;
        console.log(`🔍 [TMDB] Fetching: ${url.replace(tmdbApiKey, 'HIDDEN')}`);
        const response = await fetch(url, {
            signal: AbortSignal.timeout(8000)
        });
        console.log(`🔍 [TMDB] Response status: ${response.status} ${response.statusText}`);
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unable to read error');
            console.error(`❌ [TMDB] Error response: ${errorText.substring(0, 200)}`);
            throw new Error(`TMDB API error: ${response.status}`);
        }
        const data = await response.json();
        console.log(`✅ [TMDB] Success! Title/Name field: ${data.title || data.name}`);
        return data;
    } catch (error) {
        console.warn('⚠️ TMDB fetch warning (will use fallback):', error.message);
        return null;
    }
}

async function getTVShowDetails(tmdbId, seasonNum, episodeNum, tmdbApiKey) {
    try {
        const showResponse = await fetch(
            `${TMDB_BASE_URL}/tv/${tmdbId}?api_key=${tmdbApiKey}&append_to_response=external_ids`,
            { signal: AbortSignal.timeout(8000) }
        );
        if (!showResponse.ok) {
            const errorText = await showResponse.text().catch(() => 'Unable to read error');
            console.error(`❌ [TMDB] /tv/${tmdbId} error: ${showResponse.status} - ${errorText.substring(0, 200)}`);
            throw new Error(`TMDB API error: ${showResponse.status}`);
        }
        const showData = await showResponse.json();

        const episodeResponse = await fetch(
            `${TMDB_BASE_URL}/tv/${tmdbId}/season/${seasonNum}/episode/${episodeNum}?api_key=${tmdbApiKey}`,
            { signal: AbortSignal.timeout(8000) }
        );
        if (!episodeResponse.ok) {
            const errorText = await episodeResponse.text().catch(() => 'Unable to read error');
            console.error(`❌ [TMDB] /tv/${tmdbId}/season/${seasonNum}/episode/${episodeNum} error: ${episodeResponse.status} - ${errorText.substring(0, 200)}`);
            throw new Error(`TMDB episode API error: ${episodeResponse.status}`);
        }
        const episodeData = await episodeResponse.json();

        return {
            showTitle: showData.name,
            episodeTitle: episodeData.name,
            seasonNumber: seasonNum,
            episodeNumber: episodeNum,
            airDate: episodeData.air_date,
            imdbId: showData.external_ids?.imdb_id
        };
    } catch (error) {
        console.warn('⚠️ TMDB TV fetch warning (will use fallback):', error.message);
        return null;
    }
}

// ✅ Enhanced search endpoint for testing
async function handleSearch({ query, type }, config) {
    if (!query) throw new Error('Missing required parameter: query');
    if (!['movie', 'series', 'anime'].includes(type)) throw new Error('Invalid type. Must be "movie", "series", or "anime"');

    console.log(`🔍 Handling search: "${query}" (${type})`);

    try {
        // ✅ Estrai titolo e anno dal query (es. "Fuori 2025" -> titolo="Fuori", anno=2025)
        const yearMatch = query.match(/\s*\(?\b(19\d{2}|20\d{2})\b\)?$/);
        const extractedYear = yearMatch ? parseInt(yearMatch[1]) : null;
        const cleanedTitle = yearMatch ? query.replace(yearMatch[0], '').trim() : query;

        console.log(`📝 [Search] Extracted title: "${cleanedTitle}", year: ${extractedYear || 'N/A'}`);

        // Build basic metadata for Knaben API
        const basicMetadata = {
            primaryTitle: query,
            title: query,
            titles: [query],
        };

        const basicParsedId = {
            mediaType: type,
        };

        // ✅ ValidationMetadata per la search (validazione titolo)
        // IMPORTANTE: usa solo il titolo senza anno per il matching!
        const basicValidationMetadata = {
            titles: [cleanedTitle, query].filter(Boolean), // Titolo pulito + query originale
            year: extractedYear,
            season: undefined,
            episode: undefined,
        };

        // --- MODIFICA: RICERCA E ORDINAMENTO SEPARATO ---
        const [uindexResults, corsaroNeroResults, knabenResults] = await Promise.allSettled([
            fetchUIndexData(query, type, null, basicValidationMetadata), // Con validazione titolo
            fetchCorsaroNeroData(query, type), // Non richiede config
            fetchKnabenData(query, type, { ...basicMetadata, titles: basicValidationMetadata.titles }, basicParsedId)  // Usa titoli puliti per validazione
        ]);

        let corsaroAggregatedResults = [];
        if (corsaroNeroResults.status === 'fulfilled' && corsaroNeroResults.value) {
            corsaroAggregatedResults.push(...corsaroNeroResults.value);
        }

        let uindexAggregatedResults = [];
        if (uindexResults.status === 'fulfilled' && uindexResults.value) {
            uindexAggregatedResults.push(...uindexResults.value);
        }

        let knabenAggregatedResults = [];
        if (knabenResults.status === 'fulfilled' && knabenResults.value) {
            knabenAggregatedResults.push(...knabenResults.value);
        }

        // Deduplicate and sort
        const seenHashes = new Set();

        const uniqueCorsaro = corsaroAggregatedResults.filter(r => {
            if (!r.infoHash || seenHashes.has(r.infoHash)) return false;
            seenHashes.add(r.infoHash);
            return true;
        });
        const sortedCorsaro = sortByQualityAndSeeders(uniqueCorsaro);
        const limitedCorsaro = limitResultsByLanguageAndQuality(sortedCorsaro, 5, 2);

        const uniqueUindex = uindexAggregatedResults.filter(r => {
            if (!r.infoHash || seenHashes.has(r.infoHash)) return false;
            seenHashes.add(r.infoHash);
            return true;
        });
        const sortedUindex = sortByQualityAndSeeders(uniqueUindex);
        const limitedUindex = limitResultsByLanguageAndQuality(sortedUindex, 5, 2);

        const uniqueKnaben = knabenAggregatedResults.filter(r => {
            if (!r.infoHash || seenHashes.has(r.infoHash)) return false;
            seenHashes.add(r.infoHash);
            return true;
        });
        const sortedKnaben = sortByQualityAndSeeders(uniqueKnaben);
        const limitedKnaben = limitResultsByLanguageAndQuality(sortedKnaben, 5, 2);

        // Combina i risultati già limitati
        const results = [...limitedCorsaro, ...limitedKnaben, ...limitedUindex];
        // --- FINE MODIFICA ---

        return {
            query: query,
            type: type,
            totalResults: results.length,
            results: results.slice(0, 50).map(result => ({
                title: result.title,
                filename: result.filename,
                quality: result.quality,
                size: result.size,
                seeders: result.seeders,
                leechers: result.leechers,
                magnetLink: result.magnetLink,
                infoHash: result.infoHash,
                source: result.source
            }))
        };
    } catch (error) {
        console.error(`❌ Error in handleSearch:`, error);
        throw error;
    }
}

// ✅ Main Vercel Serverless Function handler
export default async function handler(req, res) {
    const startTime = Date.now();
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Set CORS headers for all responses
    Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    // Vercel adaptation: get env from process.env
    const env = process.env;

    const url = new URL(req.url, `https://${req.headers.host}`);
    console.log(`🌐 ${req.method} ${url.pathname} - ${req.headers['user-agent']?.substring(0, 50) || 'Unknown'}`);

    // ✅ Log decoded config if available
    try {
        const configMatch = url.pathname.match(/^\/([a-zA-Z0-9+\/=]+)(\/|$)/);
        if (configMatch && configMatch[1] && configMatch[1].length > 20) {
            const configStr = atob(configMatch[1]);
            const config = JSON.parse(configStr);

            // Only hide Real-Debrid key (user requested: show Torbox and TMDB keys)
            if (config.rd_key) config.rd_key = '☁️☁️☁️ [HIDDEN] ☁️☁️☁️';
            if (config.alldebrid_key) config.alldebrid_key = '🔗🔗🔗 [HIDDEN] 🔗🔗🔗';
            if (config.premiumize_key) config.premiumize_key = '💎💎💎 [HIDDEN] 💎💎💎';
            if (config.offcloud_key) config.offcloud_key = '☁️☁️☁️ [HIDDEN] ☁️☁️☁️';

            console.log(`📜 Decoded Config:`, JSON.stringify(config));
        }
    } catch (e) {
        // Ignore parsing errors, it might not be a config path
    }


    // ✅ Serve la pagina di configurazione alla root
    if (url.pathname === '/') {
        try {
            // Vercel adaptation: read template.html from the filesystem
            const templatePath = path.join(process.cwd(), 'template.html');
            const templateHtml = await fs.readFile(templatePath, 'utf-8');
            res.setHeader('Content-Type', 'text/html;charset=UTF-8');
            return res.status(200).send(templateHtml);
        } catch (e) {
            console.error("Error reading template.html:", e);
            return res.status(500).send('Template not found.');
        }
    }

    // ✅ Configure endpoint - Opens with existing config preloaded
    if (url.pathname === '/configure' || url.pathname.endsWith('/configure')) {
        try {
            let existingConfig = null;

            // DEBUG: Log full request details
            console.log('🔍 [Configure] Request URL:', url.href);
            console.log('🔍 [Configure] Pathname:', url.pathname);
            console.log('🔍 [Configure] Search params:', Array.from(url.searchParams.entries()));

            // Method 1: Check if config is in path (/{config}/configure)
            const pathParts = url.pathname.split('/');
            if (pathParts.length >= 2 && pathParts[1] && pathParts[1] !== 'configure') {
                try {
                    existingConfig = JSON.parse(atob(pathParts[1]));
                    console.log('📝 [Configure] Loaded existing config from URL path');
                } catch (e) {
                    console.warn('⚠️ [Configure] Failed to parse config from path:', e.message);
                }
            }

            // Method 2: Check query parameter (Stremio uses ?config=)
            if (!existingConfig && url.searchParams.has('config')) {
                try {
                    const configParam = url.searchParams.get('config');
                    existingConfig = JSON.parse(atob(configParam));
                    console.log('📝 [Configure] Loaded existing config from query parameter');
                } catch (e) {
                    console.warn('⚠️ [Configure] Failed to parse config from query:', e.message);
                }
            }

            if (existingConfig) {
                console.log('✅ [Configure] Config loaded:', Object.keys(existingConfig));
            } else {
                console.log('ℹ️ [Configure] No existing config found - showing blank form');
            }

            // Read template and inject existing config as JSON
            const templatePath = path.join(process.cwd(), 'template.html');
            let templateHtml = await fs.readFile(templatePath, 'utf-8');

            // Inject existing config into template (if present)
            if (existingConfig) {
                const configJson = JSON.stringify(existingConfig);
                // Insert script before </body> to preload config
                const configScript = `
                    <script>
                    window.EXISTING_CONFIG = ${configJson};
                    console.log('✅ Existing configuration loaded:', window.EXISTING_CONFIG);
                    </script>
                `;
                templateHtml = templateHtml.replace('</body>', `${configScript}</body>`);
            }

            res.setHeader('Content-Type', 'text/html;charset=UTF-8');
            return res.status(200).send(templateHtml);
        } catch (e) {
            console.error("Error reading template.html:", e);
            return res.status(500).send('Template not found.');
        }
    }

    // ✅ Serve static logo files (with or without config prefix)
    if (url.pathname.endsWith('/logo.png') || url.pathname.endsWith('/prisonmike.png')) {
        try {
            // Extract filename from end of path
            const filename = url.pathname.endsWith('/logo.png') ? 'logo.png' : 'prisonmike.png';

            // ✅ Redirect logo.png to external URL
            if (filename === 'logo.png') {
                return res.redirect(302, 'https://i.imgur.com/kZK4KKS.png');
            }

            const logoPath = path.join(process.cwd(), 'public', filename);

            console.log(`🖼️ [Logo] Serving ${filename} from ${logoPath}`);

            try {
                const logoData = await fs.readFile(logoPath);
                res.setHeader('Content-Type', 'image/png');
                res.setHeader('Cache-Control', 'public, max-age=31536000');
                return res.status(200).send(logoData);
            } catch (err) {
                console.warn(`⚠️ Logo file not found: ${filename}`, err.message);
                res.setHeader('Content-Type', 'text/plain');
                return res.status(404).send('Logo not found');
            }
        } catch (e) {
            console.error('Error serving logo:', e);
            return res.status(500).send('Error serving logo');
        }
    }

    // ✅ MediaFlow Proxy Endpoint - Server-side proxying
    try {
        // Stremio manifest
        // Gestisce sia /manifest.json che /{config}/manifest.json
        if (url.pathname.endsWith('/manifest.json')) {
            // Extract config from URL path to determine addon name
            const pathParts = url.pathname.split('/');
            let addonName = 'IlCorsaroViola';

            // Check if there's a config segment (e.g., /{config}/manifest.json)
            if (pathParts.length >= 3 && pathParts[1] && pathParts[1] !== 'manifest.json') {
                try {
                    const encodedConfigStr = pathParts[1];
                    let config;
                    try {
                        config = JSON.parse(atob(encodedConfigStr));
                    } catch (e1) {
                        console.warn('⚠️ Standard config parsing failed, trying URI decode fallback:', e1.message);
                        try {
                            // Fallback for double-encoded or legacy formats
                            const decoded = atob(encodedConfigStr);
                            config = JSON.parse(decodeURIComponent(escape(decoded)));
                        } catch (e2) {
                            console.error('❌ Config parsing failed completely:', e2.message);
                            throw e1; // Re-throw original error
                        }
                    }

                    // Determine which debrid services are configured
                    const hasRD = config.rd_key && config.rd_key.length > 0;
                    const hasTB = config.torbox_key && config.torbox_key.length > 0;
                    const hasAD = config.ad_key && config.ad_key.length > 0;

                    // Check if MediaFlow proxy is configured (only applies to RD)
                    const hasProxy = config.mediaflow_url && config.mediaflow_url.length > 0;

                    // Build dynamic name based on active services (using icons)
                    const services = [];
                    if (hasRD) services.push('👑');  // Crown for Real-Debrid
                    if (hasTB) services.push('📦');  // Box for Torbox
                    if (hasAD) services.push('🅰️');   // Red A for AllDebrid

                    if (services.length > 0) {
                        // Add proxy indicator only if RD is enabled
                        const proxyPrefix = (hasProxy && hasRD) ? '🕵️ ' : '';
                        addonName = `${proxyPrefix}IlCorsaroViola ${services.join('+')}`;
                    } else {
                        addonName = 'IlCorsaroViola 🧲';  // Magnet for P2P
                    }

                    console.log(`📛 [Manifest] Dynamic addon name: ${addonName}`);
                } catch (e) {
                    console.error('Error parsing config for addon name:', e);
                    // Keep default name on error
                }
            }

            const manifest = {
                id: 'community.ilcorsaroviola.ita',
                version: '3.0.0',
                name: addonName,
                description: 'Streaming da UIndex, CorsaroNero DB local, Knaben e Jackettio con o senza Real-Debrid, Torbox e Alldebrid.',
                logo: 'https://i.imgur.com/kZK4KKS.png',
                resources: ['stream'],
                types: ['movie', 'series', 'anime'],
                idPrefixes: ['tt', 'kitsu'],
                catalogs: [],
                behaviorHints: {
                    adult: false,
                    p2p: true, // Indica che può restituire link magnet
                    configurable: true, // ✅ Abilita pulsante "Configure" in Stremio
                    configurationRequired: false // ✅ Non obbligatorio, ma disponibile
                }
            };

            res.setHeader('Content-Type', 'application/json');
            return res.status(200).send(JSON.stringify(manifest, null, 2));
        }

        // Stream endpoint (main functionality)
        // Gestisce il formato /{config}/stream/{type}/{id} inviato da Stremio
        if (url.pathname.includes('/stream/')) {
            const pathParts = url.pathname.split('/'); // e.g., ['', '{config}', 'stream', '{type}', '{id}.json']

            // Estrae la configurazione dal primo segmento del path
            const encodedConfigStr = pathParts[1];
            let config = {};
            if (encodedConfigStr && encodedConfigStr !== 'stream') {
                try {
                    config = JSON.parse(atob(encodedConfigStr));
                } catch (e) {
                    console.error("Errore nel parsing della configurazione (segmento 1) dall'URL:", e);
                }
            }

            // ✅ Add Jackettio ENV vars if available (fallback for private use)
            if (env.JACKETT_URL && env.JACKETT_API_KEY) {
                config.jackett_url = env.JACKETT_URL;
                config.jackett_api_key = env.JACKETT_API_KEY;
                config.jackett_password = env.JACKETT_PASSWORD; // Optional
                console.log('🔍 [Jackettio] Using ENV configuration');
            }

            // ✅ Add MediaFlow Proxy ENV vars if available (for RD sharing)
            if (env.MEDIAFLOW_URL && env.MEDIAFLOW_PASSWORD) {
                config.mediaflow_url = env.MEDIAFLOW_URL;
                config.mediaflow_password = env.MEDIAFLOW_PASSWORD;
                console.log('🔀 [MediaFlow] Using ENV configuration for RD sharing');
            }

            // Estrae tipo e id dalle posizioni corrette
            const type = pathParts[3];
            const idWithSuffix = pathParts[4] || '';
            const id = idWithSuffix.replace(/\.json$/, '');

            if (!type || !id || id.includes('config=')) { // Aggiunto controllo per evitare ID errati
                res.setHeader('Content-Type', 'application/json');
                return res.status(400).send(JSON.stringify({ streams: [], error: 'Invalid stream path' }));
            }

            // Passa la configurazione estratta (o un oggetto vuoto) a handleStream.
            // Usa solo la configurazione dall'URL, senza fallback.
            const result = await handleStream(type, id, config, url.origin);
            const responseTime = Date.now() - startTime;

            console.log(`✅ Stream request completed in ${responseTime}ms`);

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('X-Response-Time', `${responseTime}ms`);
            res.setHeader('X-Results-Count', result.streams?.length || 0);
            return res.status(200).send(JSON.stringify(result));
        }

        // ✅ UNIFIED Real-Debrid Stream Endpoint
        if (url.pathname.startsWith('/rd-stream/')) {
            const pathParts = url.pathname.split('/');
            const encodedConfigStr = pathParts[2];
            const encodedMagnet = pathParts[3];
            const seasonOrPackFlag = pathParts[4] ? pathParts[4] : null; // 'pack' or season number
            const episodeOrFileIdx = pathParts[5] ? parseInt(pathParts[5]) : null; // episode number or fileIdx for pack

            // Determine type and extract parameters
            let type, season, episode, packFileIdx;
            if (seasonOrPackFlag === 'pack') {
                // Movie pack: /rd-stream/config/magnet/pack/0
                type = 'movie';
                packFileIdx = episodeOrFileIdx;
                season = null;
                episode = null;
            } else if (seasonOrPackFlag !== null && episodeOrFileIdx !== null) {
                // Series: /rd-stream/config/magnet/1/5
                type = 'series';
                season = parseInt(seasonOrPackFlag);
                episode = episodeOrFileIdx;
                packFileIdx = null;
            } else {
                // Single movie: /rd-stream/config/magnet
                type = 'movie';
                season = null;
                episode = null;
                packFileIdx = null;
            }

            const workerOrigin = url.origin;

            // Initialize database for cache tracking
            let dbEnabled = false;
            try {
                dbHelper.initDatabase();
                dbEnabled = true;
            } catch (error) {
                console.warn('⚠️ [DB] Failed to initialize database for /rd-stream/');
            }

            const htmlResponse = (title, message, isError = false) => `
                <!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title>
                <style>body{font-family:sans-serif;background-color:#1E1E1E;color:#E0E0E0;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;text-align:center;padding:1em;} .container{max-width:90%;padding:2em;background-color:#2A2A2A;border-radius:8px;box-shadow:0 4px 8px rgba(0,0,0,0.3);} h1{color:${isError ? '#FF6B6B' : '#4EC9B0'};}</style>
                </head><body><div class="container"><h1>${title}</h1><p>${message}</p></div></body></html>`;

            let userConfig = {};
            res.setHeader('Content-Type', 'text/html');
            try {
                if (!encodedConfigStr) throw new Error("Configurazione mancante nell'URL.");
                userConfig = JSON.parse(atob(encodedConfigStr));
            } catch (e) {
                return res.status(400).send(htmlResponse('Errore di Configurazione', `Impossibile leggere la configurazione dall'URL: ${e.message}`, true));
            }

            if (!userConfig.rd_key) {
                return res.status(400).send(htmlResponse('Errore di Configurazione', 'La chiave API di Real-Debrid non è stata configurata.', true));
            }

            if (!encodedMagnet) {
                return res.status(400).send(htmlResponse('Errore', 'Link magnet non valido.', true));
            }

            try {
                const magnetLink = decodeURIComponent(encodedMagnet);
                const infoHash = extractInfoHash(magnetLink);
                if (!infoHash) throw new Error('Magnet link non valido o senza info hash.');

                const realdebrid = new RealDebrid(userConfig.rd_key);

                console.log(`[RealDebrid] Resolving ${infoHash}`);

                // 🔥 SMART REUSE: Use existing torrent but ensure ALL files are selected
                let torrentId;
                const existingTorrent = await realdebrid._findExistingTorrent(infoHash);

                if (existingTorrent && existingTorrent.status !== 'error') {
                    torrentId = existingTorrent.id;
                    console.log(`♻️ [RD] Reusing existing torrent: ${torrentId} (status: ${existingTorrent.status})`);
                } else {
                    // STEP 1: Add magnet (RD will use cache if available)
                    console.log(`[RealDebrid] Adding new magnet...`);
                    try {
                        const addResponse = await realdebrid.addMagnet(magnetLink);
                        torrentId = addResponse.id;
                    } catch (addError) {
                        // 🔥 Handle error 19: torrent already exists
                        if (addError.error_code === 19) {
                            console.log(`[RealDebrid] Error 19: torrent already added, finding existing...`);
                            const retryTorrent = await realdebrid._findExistingTorrent(infoHash);
                            if (retryTorrent) torrentId = retryTorrent.id;
                        } else {
                            throw addError;
                        }
                    }
                }

                if (!torrentId) throw new Error('Failed to get torrent ID');

                // STEP 2: Get torrent info
                let torrent = await realdebrid.getTorrentInfo(torrentId);

                // STEP 3: Handle file selection if needed (like Torrentio _selectTorrentFiles)
                let targetFile = null;

                if (torrent.status === 'waiting_files_selection') {
                    console.log(`[RealDebrid] Selecting files...`);
                    const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm'];
                    const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];

                    const videoFiles = (torrent.files || [])
                        .filter(file => {
                            const lowerPath = file.path.toLowerCase();
                            return videoExtensions.some(ext => lowerPath.endsWith(ext));
                        })
                        .filter(file => {
                            const lowerPath = file.path.toLowerCase();
                            return !junkKeywords.some(junk => lowerPath.includes(junk)) || file.bytes > 250 * 1024 * 1024;
                        })
                        .sort((a, b) => b.bytes - a.bytes);

                    // ✅ PRIORITY 1: For movie packs, use packFileIdx if provided
                    if (type === 'movie' && packFileIdx !== null && packFileIdx !== undefined) {
                        console.log(`[RealDebrid] 🎬 Pack movie - selecting file at index ${packFileIdx}`);
                        targetFile = videoFiles[packFileIdx];
                        if (targetFile) {
                            console.log(`[RealDebrid] ✅ Selected pack file [${packFileIdx}]: ${targetFile.path} (${(targetFile.bytes / 1024 / 1024).toFixed(0)}MB)`);
                        } else {
                            console.log(`[RealDebrid] ❌ Pack file index ${packFileIdx} not found! Available: ${videoFiles.length} files`);
                            videoFiles.forEach((f, i) => {
                                console.log(`  [${i}] ${f.path.split('/').pop()} (${(f.bytes / 1024 / 1024).toFixed(0)}MB)`);
                            });
                        }
                    }

                    // ✅ PRIORITY 2: For series episodes, use pattern matching to find the correct file
                    if (!targetFile && season && episode) {
                        const seasonStr = String(season).padStart(2, '0');
                        const episodeStr = String(episode).padStart(2, '0');
                        console.log(`[RealDebrid] 🔍 Looking for S${seasonStr}E${episodeStr} (patterns: s${seasonStr}e${episodeStr}, ${season}x${episodeStr}, ${season}x${episode}, episodio.${episode})`);

                        // Log all available files for debugging
                        console.log(`[RealDebrid] 📂 Available files (${videoFiles.length}):`);
                        videoFiles.forEach((f, i) => {
                            const filename = f.path.split('/').pop();
                            console.log(`  ${i + 1}. ${filename} (${(f.bytes / 1024 / 1024).toFixed(0)}MB)`);
                        });

                        // Try to find file matching the episode with STRICT patterns (word boundaries)
                        targetFile = videoFiles.find(file => {
                            const lowerPath = file.path.toLowerCase();
                            const lowerFilename = file.path.split('/').pop().toLowerCase();

                            // Use regex with word boundaries to avoid partial matches like e1 matching e11
                            // S07E01 should NOT match S07E11 or S07E10
                            const patterns = [
                                // Standard: S08E02 (with word boundary after episode number)
                                new RegExp(`s${seasonStr}e${episodeStr}(?![0-9])`, 'i'),
                                // New: S08EP02 (Common in Italian releases)
                                new RegExp(`s${seasonStr}ep${episodeStr}(?![0-9])`, 'i'),
                                // Compact: 8x02 (with leading zero, word boundary)
                                new RegExp(`${season}x${episodeStr}(?![0-9])`, 'i'),
                                // Compact: 8x2 (without leading zero, word boundary)
                                new RegExp(`${season}x${episode}(?![0-9])`, 'i'),
                                // Dotted: s08.e02
                                new RegExp(`s${seasonStr}\\.e${episodeStr}(?![0-9])`, 'i'),
                                // Spaced: Season 8 Episode 2
                                new RegExp(`season\\s*${season}\\s*episode\\s*${episode}(?![0-9])`, 'i'),
                                // Italian: Stagione 8 Episodio 2
                                new RegExp(`stagione\\s*${season}\\s*episodio\\s*${episode}(?![0-9])`, 'i'),
                                // Episodio: episodio.2 or episodio 2
                                new RegExp(`episodio[\\s.]*${episode}(?![0-9])`, 'i'),
                                // Compact numbers: 802 (surrounded by non-digits)
                                new RegExp(`[^0-9]${season}${episodeStr}[^0-9]`),
                            ];

                            const matches = patterns.some(pattern => pattern.test(lowerPath));

                            if (matches) {
                                console.log(`[RealDebrid] ✅ MATCHED: ${file.path}`);
                            }

                            return matches;
                        });

                        if (targetFile) {
                            console.log(`[RealDebrid] ✅ Selected episode file: ${targetFile.path}`);
                        } else {
                            console.log(`[RealDebrid] ❌ NO MATCH FOUND - Pattern matching failed for S${seasonStr}E${episodeStr}`);
                            console.log(`[RealDebrid] ⚠️ Falling back to largest file (this is probably wrong!)`);
                        }
                    }

                    // ✅ PRIORITY 3: Fallback - use largest file
                    if (!targetFile) {
                        targetFile = videoFiles[0] || torrent.files.sort((a, b) => b.bytes - a.bytes)[0];
                        if (season && episode) {
                            console.log(`[RealDebrid] ⚠️ Fallback: Using largest video file`);
                        }
                    }

                    if (targetFile) {
                        // ✅ For series: Select ALL video files (not just target) so all episodes are available
                        if (type === 'series' && videoFiles.length > 1) {
                            const allVideoIds = videoFiles.map(f => f.id).join(',');
                            console.log(`[RealDebrid] 📦 Selecting all ${videoFiles.length} video files for series pack`);
                            await realdebrid.selectFiles(torrent.id, allVideoIds);
                        } else {
                            // For movies or single-file torrents, select only the target
                            await realdebrid.selectFiles(torrent.id, targetFile.id);
                        }
                        torrent = await realdebrid.getTorrentInfo(torrent.id);
                    }
                }

                // STEP 4: Check torrent status (like Torrentio statusReady/statusDownloading)
                const statusReady = ['downloaded', 'dead'].includes(torrent.status);
                const statusDownloading = ['downloading', 'uploading', 'queued'].includes(torrent.status);
                const statusMagnetError = torrent.status === 'magnet_error';
                const statusError = ['error', 'magnet_error'].includes(torrent.status);
                const statusOpening = torrent.status === 'magnet_conversion';
                const statusWaitingSelection = torrent.status === 'waiting_files_selection';

                if (statusReady) {
                    // ✅ READY: Unrestrict and stream
                    console.log(`[RealDebrid] Torrent ready, unrestricting...`);

                    const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm'];
                    const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];

                    const selectedFiles = (torrent.files || []).filter(file => file.selected === 1);
                    const allVideoFiles = (torrent.files || []).filter(file => {
                        const lowerPath = file.path.toLowerCase();
                        return videoExtensions.some(ext => lowerPath.endsWith(ext)) &&
                            (!junkKeywords.some(junk => lowerPath.includes(junk)) || file.bytes > 250 * 1024 * 1024);
                    });

                    const videos = selectedFiles
                        .filter(file => {
                            const lowerPath = file.path.toLowerCase();
                            return videoExtensions.some(ext => lowerPath.endsWith(ext));
                        })
                        .filter(file => {
                            const lowerPath = file.path.toLowerCase();
                            return !junkKeywords.some(junk => lowerPath.includes(junk)) || file.bytes > 250 * 1024 * 1024;
                        })
                        .sort((a, b) => b.bytes - a.bytes);

                    // 🔥 CRITICAL FIX: If series pack has incomplete file selection, add missing files
                    if (type === 'series' && videos.length < allVideoFiles.length && allVideoFiles.length > 1) {
                        console.log(`⚠️ [RD] Incomplete file selection: ${videos.length}/${allVideoFiles.length} videos selected`);
                        console.log(`🔄 [RD] Adding ${allVideoFiles.length - videos.length} missing video files...`);

                        const allVideoIds = allVideoFiles.map(f => f.id).join(',');
                        await realdebrid.selectFiles(torrent.id, allVideoIds);

                        // Re-fetch torrent info with updated selection
                        torrent = await realdebrid.getTorrentInfo(torrent.id);
                        console.log(`✅ [RD] Updated file selection: ${allVideoFiles.length} videos now selected`);

                        // Refresh videos list
                        const updatedSelectedFiles = (torrent.files || []).filter(file => file.selected === 1);
                        videos.length = 0; // Clear array
                        videos.push(...updatedSelectedFiles
                            .filter(file => {
                                const lowerPath = file.path.toLowerCase();
                                return videoExtensions.some(ext => lowerPath.endsWith(ext));
                            })
                            .filter(file => {
                                const lowerPath = file.path.toLowerCase();
                                return !junkKeywords.some(junk => lowerPath.includes(junk)) || file.bytes > 250 * 1024 * 1024;
                            })
                            .sort((a, b) => b.bytes - a.bytes));
                    }

                    let targetFile = null;

                    // ✅ For series episodes, use pattern matching to find the correct file
                    if (season && episode) {
                        const seasonStr = String(season).padStart(2, '0');
                        const episodeStr = String(episode).padStart(2, '0');
                        console.log(`[RealDebrid] 🔍 Looking for S${seasonStr}E${episodeStr} (patterns: s${seasonStr}e${episodeStr}, ${season}x${episodeStr}, ${season}x${episode}, episodio.${episode})`);

                        // Log all available files for debugging
                        console.log(`[RealDebrid] 📂 Selected files (${videos.length}):`);
                        videos.forEach((f, i) => {
                            const filename = f.path.split('/').pop();
                            console.log(`  ${i + 1}. ${filename} (${(f.bytes / 1024 / 1024).toFixed(0)}MB)`);
                        });

                        targetFile = videos.find(file => {
                            const lowerPath = file.path.toLowerCase();
                            const lowerFilename = file.path.split('/').pop().toLowerCase();

                            // Use regex with word boundaries to avoid partial matches like e1 matching e11
                            // S07E01 should NOT match S07E11 or S07E10
                            const patterns = [
                                // Standard: S08E02 (with word boundary after episode number)
                                new RegExp(`s${seasonStr}e${episodeStr}(?![0-9])`, 'i'),
                                // New: S08EP02 (Common in Italian releases)
                                new RegExp(`s${seasonStr}ep${episodeStr}(?![0-9])`, 'i'),
                                // Compact: 8x02 (with leading zero, word boundary)
                                new RegExp(`${season}x${episodeStr}(?![0-9])`, 'i'),
                                // Compact: 8x2 (without leading zero, word boundary)
                                new RegExp(`${season}x${episode}(?![0-9])`, 'i'),
                                // Dotted: s08.e02
                                new RegExp(`s${seasonStr}\\.e${episodeStr}(?![0-9])`, 'i'),
                                // Spaced: Season 8 Episode 2
                                new RegExp(`season\\s*${season}\\s*episode\\s*${episode}(?![0-9])`, 'i'),
                                // Italian: Stagione 8 Episodio 2
                                new RegExp(`stagione\\s*${season}\\s*episodio\\s*${episode}(?![0-9])`, 'i'),
                                // Episodio: episodio.2 or episodio 2
                                new RegExp(`episodio[\\s.]*${episode}(?![0-9])`, 'i'),
                                // Compact numbers: 802 (surrounded by non-digits)
                                new RegExp(`[^0-9]${season}${episodeStr}[^0-9]`),
                            ];

                            const matches = patterns.some(pattern => pattern.test(lowerPath));

                            if (matches) {
                                console.log(`[RealDebrid] ✅ MATCHED: ${file.path}`);
                            }

                            return matches;
                        });

                        if (targetFile) {
                            console.log(`[RealDebrid] ✅ Selected episode file: ${targetFile.path}`);
                        } else {
                            console.log(`[RealDebrid] ❌ NO MATCH FOUND - Pattern matching failed for S${seasonStr}E${episodeStr}`);
                            console.log(`[RealDebrid] ⚠️ Falling back to largest file (this is probably wrong!)`);

                            // 🔥 SMART FIX: For series, if episode not found, delete torrent and re-add with all files
                            if (type === 'series' && selectedFiles.length < 5) { // Probably only 1 episode was selected
                                console.log(`[RealDebrid] 🔄 Torrent has only ${selectedFiles.length} selected file(s), re-adding to select all episodes...`);

                                try {
                                    // Delete the existing torrent
                                    await realdebrid.deleteTorrent(torrent.id);
                                    console.log(`[RealDebrid] 🗑️ Deleted torrent ${torrent.id}`);

                                    // Re-add the magnet and force file selection
                                    console.log(`[RealDebrid] ➕ Re-adding magnet to select all files...`);
                                    const newTorrent = await realdebrid.addMagnet(magnetLink);

                                    // Wait for magnet conversion
                                    let retries = 0;
                                    let convertedTorrent = newTorrent;
                                    while (convertedTorrent.status === 'magnet_conversion' && retries < 10) {
                                        await new Promise(resolve => setTimeout(resolve, 1000));
                                        convertedTorrent = await realdebrid.getTorrentInfo(newTorrent.id);
                                        retries++;
                                    }

                                    if (convertedTorrent.status === 'waiting_files_selection') {
                                        // Select ALL video files
                                        const allFiles = convertedTorrent.files || [];
                                        const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm'];
                                        const allVideoFiles = allFiles.filter(file => {
                                            const lowerPath = file.path.toLowerCase();
                                            return videoExtensions.some(ext => lowerPath.endsWith(ext));
                                        });

                                        if (allVideoFiles.length > 0) {
                                            const allVideoIds = allVideoFiles.map(f => f.id).join(',');
                                            console.log(`[RealDebrid] 📦 Selecting all ${allVideoFiles.length} video files`);
                                            await realdebrid.selectFiles(convertedTorrent.id, allVideoIds);

                                            // ✅ SAVE FILE INFO: Save ALL files from the pack NOW (before redirect)
                                            if (dbEnabled && infoHash) {
                                                try {
                                                    const episodeImdbId = await dbHelper.getImdbIdByHash(infoHash);

                                                    if (episodeImdbId) {
                                                        console.log(`💾 [DB] Saving ALL ${allVideoFiles.length} files from re-added pack...`);

                                                        for (const file of allVideoFiles) {
                                                            const filename = file.path.split('/').pop();
                                                            const episodeMatch = filename.match(/[se](\d{1,2})[ex](\d{1,2})|stagione[\s._-]*(\d{1,2})[\s._-]*episodio[\s._-]*(\d{1,2})|(\d{1,2})x(\d{1,2})/i);

                                                            if (episodeMatch) {
                                                                let fileSeason, fileEpisode;
                                                                if (episodeMatch[1] && episodeMatch[2]) {
                                                                    fileSeason = parseInt(episodeMatch[1]);
                                                                    fileEpisode = parseInt(episodeMatch[2]);
                                                                } else if (episodeMatch[3] && episodeMatch[4]) {
                                                                    fileSeason = parseInt(episodeMatch[3]);
                                                                    fileEpisode = parseInt(episodeMatch[4]);
                                                                } else if (episodeMatch[5] && episodeMatch[6]) {
                                                                    fileSeason = parseInt(episodeMatch[5]);
                                                                    fileEpisode = parseInt(episodeMatch[6]);
                                                                }

                                                                if (fileSeason === parseInt(season)) {
                                                                    const fileInfo = {
                                                                        imdbId: episodeImdbId,
                                                                        season: fileSeason,
                                                                        episode: fileEpisode
                                                                    };

                                                                    await dbHelper.updateTorrentFileInfo(
                                                                        infoHash,
                                                                        file.id,
                                                                        file.path,
                                                                        fileInfo
                                                                    );

                                                                    console.log(`💾 [DB] Saved S${String(fileSeason).padStart(2, '0')}E${String(fileEpisode).padStart(2, '0')}: ${filename}`);
                                                                }
                                                            }
                                                        }

                                                        console.log(`✅ [DB] Finished saving all files from re-added pack`);
                                                    }
                                                } catch (fileErr) {
                                                    console.error(`❌ [DB] Error saving pack files: ${fileErr.message}`);
                                                }
                                            }

                                            // Redirect to same URL to restart the flow
                                            console.log(`[RealDebrid] 🔄 Reloading stream with all files selected...`);
                                            return res.redirect(302, req.url);
                                        }
                                    }

                                    console.log(`[RealDebrid] ❌ Failed to re-add torrent properly`);
                                } catch (error) {
                                    console.error(`[RealDebrid] ❌ Error re-adding torrent:`, error.message);
                                }
                            }
                        }
                    }

                    // ✅ PRIORITY 3: Fallback - use largest file
                    if (!targetFile) {
                        targetFile = videos[0] || selectedFiles.sort((a, b) => b.bytes - a.bytes)[0];
                        if (season && episode) {
                            console.log(`[RealDebrid] ⚠️ Fallback: Using largest video file`);
                        }
                    }

                    if (!targetFile) {
                        console.log(`[RealDebrid] No video file found`);
                        return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                    }

                    // 🔥 CRITICAL FIX: Use SELECTED files to find the correct link index!
                    // RealDebrid returns links[] array ONLY for selected files (selected=1)
                    // We need to find which position our targetFile is AMONG SELECTED FILES
                    const selectedForLink = (torrent.files || []).filter(f => f.selected === 1);
                    const fileIndex = selectedForLink.findIndex(f => f.id === targetFile.id);

                    if (fileIndex === -1) {
                        console.log(`[RealDebrid] ❌ Target file not in selected files (file.id=${targetFile.id})`);
                        console.log(`[RealDebrid] Selected files: ${selectedForLink.map(f => `${f.id}:${f.path.split('/').pop()}`).join(', ')}`);
                        return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                    }

                    console.log(`[RealDebrid] 📍 File ID: ${targetFile.id}, Selected Index: ${fileIndex}/${selectedForLink.length}, Total links: ${(torrent.links || []).length}`);

                    let downloadLink = torrent.links[fileIndex];

                    if (!downloadLink) {
                        console.log(`[RealDebrid] ❌ No download link at index ${fileIndex}`);
                        console.log(`[RealDebrid] Available links: ${(torrent.links || []).length}`);
                        return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                    }

                    console.log(`[RealDebrid] ✅ Using link at index ${fileIndex} for file: ${targetFile.path.split('/').pop()}`);

                    const unrestricted = await realdebrid.unrestrictLink(downloadLink);

                    // 🔥 Torrentio-style: Check for access denied errors
                    if (realdebrid._isAccessDeniedError(unrestricted)) {
                        console.log(`[RealDebrid] ❌ Access denied (error ${unrestricted.error_code})`);
                        return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/access_denied_v2.mp4`);
                    }

                    // 🔥 Torrentio-style: Check for infringing file errors
                    if (realdebrid._isInfringingFileError(unrestricted)) {
                        console.log(`[RealDebrid] ❌ Infringing file (error ${unrestricted.error_code})`);
                        return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/infringing_file_v2.mp4`);
                    }

                    // 🔥 Torrentio-style: Check for limit exceeded
                    if (realdebrid._isLimitExceededError(unrestricted)) {
                        console.log(`[RealDebrid] ❌ Limit exceeded (error ${unrestricted.error_code})`);
                        return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/limit_exceeded_v2.mp4`);
                    }

                    // 🔥 Torrentio-style: Check for torrent too big
                    if (realdebrid._isTorrentTooBigError(unrestricted)) {
                        console.log(`[RealDebrid] ❌ Torrent too big (error ${unrestricted.error_code})`);
                        return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/torrent_too_big_v2.mp4`);
                    }

                    // 🔥 Torrentio-style: Check for failed download
                    if (realdebrid._isFailedDownloadError(unrestricted)) {
                        console.log(`[RealDebrid] ❌ Failed download (error ${unrestricted.error_code})`);
                        return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                    }

                    // ✅ CACHE SUCCESS: Refresh cache timestamp (+10 days from now)
                    if (dbEnabled && infoHash) {
                        try {
                            // Refresh cache timestamp - extends validity to 10 more days
                            await dbHelper.refreshRdCacheTimestamp(infoHash);
                        } catch (dbErr) {
                            console.error(`❌ [DB] Error refreshing cache: ${dbErr.message}`, dbErr);
                        }

                        // ✅ SAVE FILE INFO: Save ALL files from the pack for future lookups
                        if (type === 'series' && season && torrent && torrent.files) {
                            try {
                                // Get imdbId from DB for this torrent
                                const episodeImdbId = await dbHelper.getImdbIdByHash(infoHash);

                                if (episodeImdbId) {
                                    // ✅ Check if files are already saved for this pack (avoid duplicate inserts)
                                    const existingFiles = await dbHelper.searchEpisodeFiles(episodeImdbId, parseInt(season), 1);
                                    const packAlreadySaved = existingFiles.some(f => f.info_hash?.toLowerCase() === infoHash.toLowerCase());

                                    if (packAlreadySaved) {
                                        console.log(`💾 [DB] Pack files already saved for ${infoHash}, skipping bulk save`);
                                    } else {
                                        console.log(`💾 [DB] Saving ALL ${torrent.files.length} files from pack...`);

                                        // Iterate through ALL files in the pack
                                        for (const file of torrent.files) {
                                            // Only process video files
                                            if (!file.path.match(/\.(mkv|mp4|avi|mov|wmv|flv|webm)$/i)) {
                                                continue;
                                            }

                                            // Try to extract episode number from filename
                                            const filename = file.path.split('/').pop();
                                            const episodeMatch = filename.match(/[se](\d{1,2})[ex](\d{1,2})|stagione[\s._-]*(\d{1,2})[\s._-]*episodio[\s._-]*(\d{1,2})|(\d{1,2})x(\d{1,2})/i);

                                            if (episodeMatch) {
                                                // Extract season and episode from match
                                                let fileSeason, fileEpisode;
                                                if (episodeMatch[1] && episodeMatch[2]) {
                                                    fileSeason = parseInt(episodeMatch[1]);
                                                    fileEpisode = parseInt(episodeMatch[2]);
                                                } else if (episodeMatch[3] && episodeMatch[4]) {
                                                    fileSeason = parseInt(episodeMatch[3]);
                                                    fileEpisode = parseInt(episodeMatch[4]);
                                                } else if (episodeMatch[5] && episodeMatch[6]) {
                                                    fileSeason = parseInt(episodeMatch[5]);
                                                    fileEpisode = parseInt(episodeMatch[6]);
                                                }

                                                // Only save if it matches the current season
                                                if (fileSeason === parseInt(season)) {
                                                    const fileInfo = {
                                                        imdbId: episodeImdbId,
                                                        season: fileSeason,
                                                        episode: fileEpisode
                                                    };

                                                    await dbHelper.updateTorrentFileInfo(
                                                        infoHash,
                                                        file.id,
                                                        file.path,
                                                        fileInfo
                                                    );

                                                    console.log(`💾 [DB] Saved S${String(fileSeason).padStart(2, '0')}E${String(fileEpisode).padStart(2, '0')}: ${filename}`);
                                                }
                                            }
                                        }

                                        console.log(`✅ [DB] Finished saving all files from pack`);
                                    }
                                } else {
                                    console.warn(`⚠️ [DB] No imdbId found for pack, skipping bulk save`);
                                }
                            } catch (fileErr) {
                                console.error(`❌ [DB] Error saving pack files: ${fileErr.message}`);
                            }
                        }

                        // ✅ SAVE PACK FILES FOR MOVIES (Trilogies, Collections, etc.)
                        // This saves the mapping between pack hash and individual film IMDb IDs
                        if (type === 'movie' && packFileIdx !== null && packFileIdx !== undefined && targetFile && torrent && torrent.files) {
                            try {
                                // Get IMDb ID of the movie being played
                                const movieImdbId = await dbHelper.getImdbIdByHash(infoHash);

                                if (movieImdbId) {
                                    console.log(`📦 [DB] Saving pack file mapping for movie ${movieImdbId}...`);

                                    // Save this specific file mapping to pack_files table
                                    const packFileData = [{
                                        pack_hash: infoHash.toLowerCase(),
                                        imdb_id: movieImdbId,
                                        file_index: targetFile.id, // RealDebrid file.id
                                        file_path: targetFile.path,
                                        file_size: targetFile.bytes || 0
                                    }];

                                    await dbHelper.insertPackFiles(packFileData);
                                    console.log(`✅ [DB] Saved pack mapping: ${movieImdbId} -> file ${targetFile.id} in pack ${infoHash}`);

                                    // Also update the all_imdb_ids array on the torrents table
                                    await dbHelper.updatePackAllImdbIds(infoHash.toLowerCase());
                                } else {
                                    console.warn(`⚠️ [DB] No IMDb ID found for movie pack, skipping save`);
                                }
                            } catch (packErr) {
                                console.error(`❌ [DB] Error saving pack file mapping: ${packErr.message}`);
                                // Don't fail the stream - this is a non-critical operation
                            }
                        }
                    }

                    // Check if it's a RAR archive
                    if (unrestricted.download?.endsWith('.rar') || unrestricted.download?.endsWith('.zip')) {
                        console.log(`[RealDebrid] Failed: RAR archive`);
                        return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/failed_rar_v2.mp4`);
                    }

                    let finalUrl = unrestricted.download;

                    // IMPORTANT: Apply MediaFlow proxy for ALL RealDebrid streams if configured
                    if (userConfig.mediaflow_url) {
                        try {
                            finalUrl = await proxyThroughMediaFlow(
                                unrestricted.download,
                                { url: userConfig.mediaflow_url, password: userConfig.mediaflow_password || '' },
                                null // filename will be extracted from URL
                            );
                            console.log(`[RealDebrid] MediaFlow proxy applied to all streams`);
                        } catch (mfError) {
                            console.error(`❌ [RealDebrid] MediaFlow proxy failed: ${mfError.message}`);
                            // 🛑 STOP! Do not fallback to direct link to avoid bans.
                            return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                        }
                    }

                    // ⏩ INTROSKIP: Wrap in HLS proxy if enabled for series
                    if (userConfig.introskip_enabled && type === 'series' && season && episode) {
                        try {
                            // Get imdbId for this torrent to lookup intro
                            const episodeImdbId = dbEnabled ? await dbHelper.getImdbIdByHash(infoHash) : null;
                            if (episodeImdbId && episodeImdbId.startsWith('tt')) {
                                const introDataRD = await introSkip.lookupIntro(episodeImdbId, parseInt(season), parseInt(episode));
                                if (introDataRD && introDataRD.end_sec > 0) {
                                    // Wrap in HLS proxy for real intro skipping
                                    const encodedStream = encodeURIComponent(finalUrl);
                                    finalUrl = `${workerOrigin}/introskip/hls.m3u8?stream=${encodedStream}&start=${introDataRD.start_sec}&end=${introDataRD.end_sec}`;
                                    console.log(`⏩ [IntroSkip] Wrapped in HLS proxy: ${introDataRD.start_sec}s - ${introDataRD.end_sec}s`);
                                }
                            }
                        } catch (introErr) {
                            console.warn(`⏩ [IntroSkip] Error applying HLS proxy: ${introErr.message}`);
                        }
                    }

                    console.log(`[RealDebrid] Redirecting to stream`);
                    return res.redirect(302, finalUrl);

                } else if (statusDownloading || statusOpening || statusWaitingSelection) {
                    // ⏳ DOWNLOADING: Show placeholder video
                    console.log(`[RealDebrid] Torrent is downloading (status: ${torrent.status})...`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/downloading_v2.mp4`);

                } else if (statusMagnetError) {
                    // ❌ MAGNET ERROR: Show failed opening video
                    console.log(`[RealDebrid] Magnet error`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/failed_opening_v2.mp4`);

                } else if (statusError) {
                    // ❌ ERROR: Show failed video
                    console.log(`[RealDebrid] Torrent failed`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                }

                // Fallback: something went wrong
                console.log(`[RealDebrid] Unknown state (${torrent.status}), showing failed video`);
                return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);

            } catch (error) {
                console.error('👑 ❌ RD stream error:', error);

                // 🔥 Torrentio-style: Check for specific error codes
                const realdebrid = new RealDebrid(userConfig.rd_key || '');

                if (realdebrid._isAccessDeniedError(error)) {
                    console.log(`[RealDebrid] ❌ Access denied (error ${error.error_code})`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/access_denied_v2.mp4`);
                }

                if (realdebrid._isInfringingFileError(error)) {
                    console.log(`[RealDebrid] ❌ Infringing file (error ${error.error_code})`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/infringing_file_v2.mp4`);
                }

                if (realdebrid._isLimitExceededError(error)) {
                    console.log(`[RealDebrid] ❌ Limit exceeded (error ${error.error_code})`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/limit_exceeded_v2.mp4`);
                }

                if (realdebrid._isTorrentTooBigError(error)) {
                    console.log(`[RealDebrid] ❌ Torrent too big (error ${error.error_code})`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/torrent_too_big_v2.mp4`);
                }

                if (realdebrid._isFailedDownloadError(error)) {
                    console.log(`[RealDebrid] ❌ Failed download (error ${error.error_code})`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                }

                // Handle text-based error messages (legacy)
                const errorMsg = error.message?.toLowerCase() || '';

                if (errorMsg.includes('429') || errorMsg.includes('rate limit')) {
                    // Too many requests - show downloading placeholder
                    console.log(`[RealDebrid] Rate limited, showing downloading placeholder`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/downloading_v2.mp4`);
                }

                if (errorMsg.includes('400') || errorMsg.includes('not found') || errorMsg.includes('invalid')) {
                    // Torrent not available or invalid
                    console.log(`[RealDebrid] Torrent not available (400/404)`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                }

                if (errorMsg.includes('rar') || errorMsg.includes('zip')) {
                    // Archive format not supported
                    console.log(`[RealDebrid] Archive format not supported`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/failed_rar_v2.mp4`);
                }

                if (errorMsg.includes('magnet')) {
                    // Magnet error
                    console.log(`[RealDebrid] Magnet conversion error`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/failed_opening_v2.mp4`);
                }

                // Generic error: show failed placeholder
                console.log(`[RealDebrid] Generic error, showing failed video`);
                return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
            }
        }

        // Endpoint to handle adding magnets to Real-Debrid for Android/Web compatibility
        if (url.pathname.startsWith('/rd-add/')) {
            const pathParts = url.pathname.split('/'); // e.g., ['', 'rd-add', 'config_string', 'magnet_link']
            const encodedConfigStr = pathParts[2];
            const encodedMagnet = pathParts[3];
            const workerOrigin = url.origin; // For MediaFlow proxy URL generation

            const htmlResponse = (title, message, isError = false) => `
                <!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title>
                <style>body{font-family:sans-serif;background-color:#1E1E1E;color:#E0E0E0;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;text-align:center;padding:1em;} .container{max-width:90%;padding:2em;background-color:#2A2A2A;border-radius:8px;box-shadow:0 4px 8px rgba(0,0,0,0.3);} h1{color:${isError ? '#FF6B6B' : '#4EC9B0'};}</style>
                </head><body><div class="container"><h1>${title}</h1><p>${message}</p></div></body></html>`;

            let userConfig = {};
            res.setHeader('Content-Type', 'text/html');
            try {
                if (!encodedConfigStr) throw new Error("Configurazione mancante nell'URL.");
                userConfig = JSON.parse(atob(encodedConfigStr));
            } catch (e) {
                return res.status(400).send(htmlResponse('Errore di Configurazione', `Impossibile leggere la configurazione dall'URL: ${e.message}`, true));
            }

            if (!userConfig.rd_key) {
                return res.status(400).send(htmlResponse('Errore di Configurazione', 'La chiave API di Real-Debrid non è stata configurata. Impossibile aggiungere il torrent.', true));
            }

            if (!encodedMagnet) {
                return res.status(400).send(htmlResponse('Errore', 'Link magnet non valido.', true));
            }

            try {
                // ... (tutta la logica interna di /rd-add/ rimane invariata) ...
                // ...

                const magnetLink = decodeURIComponent(encodedMagnet);
                const infoHash = extractInfoHash(magnetLink);
                if (!infoHash) throw new Error('Magnet link non valido o senza info hash.');

                const realdebrid = new RealDebrid(userConfig.rd_key);

                // --- Robust Torrent Handling ---
                const userTorrents = await realdebrid.getTorrents();
                let torrent = userTorrents.find(t => t.hash.toLowerCase() === infoHash.toLowerCase());

                if (torrent) {
                    try {
                        const errorStates = ['error', 'magnet_error', 'virus', 'dead'];
                        const torrentInfo = await realdebrid.getTorrentInfo(torrent.id);
                        if (errorStates.includes(torrentInfo.status)) {
                            console.log(`🗑️ Found stale/failed torrent (ID: ${torrent.id}, Status: ${torrentInfo.status}). Deleting it.`);
                            await realdebrid.deleteTorrent(torrent.id);
                            torrent = null; // Force re-adding
                        }
                    } catch (e) {
                        console.warn(`⚠️ Could not get info for existing torrent ${torrent.id}. Deleting it as a precaution.`, e.message);
                        await realdebrid.deleteTorrent(torrent.id).catch(err => console.error(`Error during precautionary delete: ${err.message}`));
                        torrent = null; // Force re-adding
                    }
                }

                let torrentId;
                if (!torrent) {
                    console.log(`ℹ️ Adding new torrent with hash ${infoHash}.`);
                    const addResponse = await realdebrid.addMagnet(magnetLink);
                    torrentId = addResponse.id;
                    if (!torrentId) throw new Error('Impossibile ottenere l\'ID del torrent da Real-Debrid.');
                } else {
                    torrentId = torrent.id;
                    console.log(`ℹ️ Using existing torrent. ID: ${torrentId}`);
                }

                let torrentInfo;
                let actionTaken = false;
                for (let i = 0; i < 15; i++) { // Poll for up to ~30 seconds
                    if (i === 0) await new Promise(resolve => setTimeout(resolve, 1500));

                    torrentInfo = await realdebrid.getTorrentInfo(torrentId);
                    const status = torrentInfo.status;
                    console.log(`[Attempt ${i + 1}/15] Torrent ${torrentId} status: ${status}`);

                    if (status === 'waiting_files_selection') {
                        console.log(`▶️ Torrent requires file selection. Selecting main video file...`);
                        if (!torrentInfo.files || torrentInfo.files.length === 0) throw new Error('Torrent is empty or invalid.');

                        const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv'];
                        const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];

                        const videoFiles = torrentInfo.files.filter(file => {
                            const lowerPath = file.path.toLowerCase();
                            return videoExtensions.some(ext => lowerPath.endsWith(ext)) &&
                                !junkKeywords.some(junk => lowerPath.includes(junk));
                        });

                        const fileToDownload = videoFiles.length > 0
                            ? videoFiles.reduce((max, file) => (file.bytes > max.bytes ? file : max), videoFiles[0])
                            : torrentInfo.files.reduce((max, file) => (file.bytes > max.bytes ? file : max), torrentInfo.files[0]);

                        if (!fileToDownload) throw new Error('Impossibile determinare il file da scaricare nel torrent.');

                        await realdebrid.selectFiles(torrentId, fileToDownload.id);
                        console.log(`✅ Download started for file: ${fileToDownload.path}`);
                        actionTaken = true;
                        break;
                    }

                    if (['queued', 'downloading', 'downloaded'].includes(status)) {
                        console.log(`ℹ️ Torrent is already active (status: ${status}). No action needed.`);
                        actionTaken = true;
                        break;
                    }

                    if (status === 'magnet_conversion') {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        continue;
                    }

                    const errorStates = ['error', 'magnet_error', 'virus', 'dead'];
                    if (errorStates.includes(status)) {
                        throw new Error(`Torrent has a critical error state: ${status}`);
                    }

                    await new Promise(resolve => setTimeout(resolve, 2000));
                }

                if (!actionTaken) {
                    throw new Error(`Torrent did not become active after polling. Last status: ${torrentInfo.status}`);
                }

                if (torrentInfo.status === 'downloaded') {
                    console.log('✅ Torrent already downloaded. Getting stream link directly...');
                    try {
                        if (!torrentInfo.links || torrentInfo.links.length === 0) throw new Error('Torrent scaricato ma Real-Debrid non ha fornito un link.');

                        let downloadLink;
                        if (torrentInfo.links.length === 1) {
                            downloadLink = torrentInfo.links[0];
                        } else {
                            const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv'];
                            const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];
                            const selectedVideoFiles = torrentInfo.files.filter(file => file.selected === 1 && videoExtensions.some(ext => file.path.toLowerCase().endsWith(ext)) && !junkKeywords.some(junk => file.path.toLowerCase().includes(junk)));
                            let mainFile = selectedVideoFiles.length > 0 ? selectedVideoFiles.reduce((max, file) => (file.bytes > (max?.bytes || 0) ? file : max), null) : torrentInfo.files.filter(f => f.selected === 1).reduce((max, file) => (file.bytes > (max?.bytes || 0) ? file : max), null);
                            if (!mainFile) throw new Error('Torrent completato ma nessun file valido risulta selezionato.');
                            const filename = mainFile.path.split('/').pop();
                            downloadLink = torrentInfo.links.find(link => decodeURIComponent(link).endsWith(filename));
                            if (!downloadLink) throw new Error(`Could not match filename "${filename}" to any of the available links.`);
                        }

                        const unrestricted = await realdebrid.unrestrictLink(downloadLink);
                        let finalStreamUrl = unrestricted.download;

                        // ✅ CACHE SUCCESS: Mark torrent as cached in DB (5-day TTL)
                        if (dbEnabled && infoHash) {
                            try {
                                await dbHelper.updateRdCacheStatus([{ hash: infoHash, cached: true }]);
                                console.log(`💾 [DB] Marked ${infoHash} as RD cached (5-day TTL)`);
                            } catch (dbErr) {
                                console.warn(`⚠️ Failed to update DB cache status: ${dbErr.message}`);
                            }
                        }

                        // Apply MediaFlow proxy if configured
                        if (userConfig.mediaflow_url) {
                            try {
                                finalStreamUrl = await proxyThroughMediaFlow(unrestricted.download, { url: userConfig.mediaflow_url, password: userConfig.mediaflow_password || '' }, null);
                                console.log(`🔒 Applied MediaFlow proxy to non-cached RD stream`);
                            } catch (mfError) {
                                console.error(`❌ Failed to apply MediaFlow proxy: ${mfError.message}`);
                                // 🛑 STOP! Do not fallback to direct link to avoid bans.
                                return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                            }
                        }

                        console.log(`🚀 Redirecting directly to stream: ${finalStreamUrl}`);
                        res.setHeader('Location', finalStreamUrl);
                        return res.status(302).end();

                    } catch (redirectError) {
                        console.error(`❌ Failed to get direct stream link, falling back to polling page. Error: ${redirectError.message}`);
                    }
                }

                const pollingPage = `
                    <!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Caricamento in corso...</title>
                    <style>
                        body{font-family:sans-serif;background-color:#1E1E1E;color:#E0E0E0;display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;margin:0;text-align:center;padding:1em;}
                        .container{max-width:90%;padding:2em;background-color:#2A2A2A;border-radius:8px;box-shadow:0 4px 8px rgba(0,0,0,0.3);}
                        h1{color:#4EC9B0; margin-bottom: 0.5em;}
                        #status{font-size:1.2em; margin-top: 1em; min-height: 2em;}
                        .progress-bar{width:80%;background-color:#333;border-radius:5px;overflow:hidden;margin-top:1em;}
                        #progress{width:0%;height:20px;background-color:#4EC9B0;transition:width 0.5s ease-in-out;}
                        .loader { border: 4px solid #f3f3f3; border-top: 4px solid #4EC9B0; border-radius: 50%; width: 40px; height: 40px; animation: spin 2s linear infinite; }
                        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                    </style>
                    </head><body><div class="container">
                        <div class="loader"></div>
                        <h1>Aggiunto a Real-Debrid</h1>
                        <p>Attendi il completamento del download. Lo streaming partirà in automatico.</p>
                        <div id="status">Inizializzazione...</div>
                        <div class="progress-bar"><div id="progress"></div></div>
                    </div> 
                    <script>
                        const torrentId = '${torrentId}';
                        const statusEl = document.getElementById('status');
                        const progressEl = document.getElementById('progress');
                        let pollCount = 0;
                        const maxPolls = 180; // 30 minutes timeout (180 polls * 10 seconds)

                        function pollStatus() {
                            if (pollCount++ > maxPolls) {
                                statusEl.textContent = 'Errore: Timeout. Il download sta impiegando troppo tempo. Controlla il tuo account Real-Debrid.';
                                statusEl.style.color = '#FF6B6B';
                                return;
                            }

                            fetch('/rd-status/${encodedConfigStr}/' + torrentId)
                                .then(res => res.json())
                                .then(data => {
                                    if (data.status === 'ready' && data.url) {
                                        statusEl.textContent = 'Download completato! Avvio dello streaming...';
                                        window.location.href = data.url;
                                    } else if (data.status === 'downloading') {
                                        statusEl.textContent = \`Download in corso... \${data.progress}% (\${data.speed} KB/s)\`;
                                        progressEl.style.width = data.progress + '%';
                                        setTimeout(pollStatus, 5000); // Poll faster when downloading
                                    } else if (data.status === 'queued') {
                                        statusEl.textContent = 'In coda su Real-Debrid...';
                                        setTimeout(pollStatus, 10000); // Poll slower when queued
                                    } else if (data.status === 'magnet_conversion' || data.status === 'waiting_files_selection') {
                                        statusEl.textContent = 'Analisi del torrent in corso...';
                                        setTimeout(pollStatus, 7000);
                                    } else if (data.status === 'error') {
                                        statusEl.textContent = 'Errore: ' + data.message;
                                        statusEl.style.color = '#FF6B6B';
                                    } else {
                                        statusEl.textContent = 'Errore: stato sconosciuto (' + data.status + '). Controlla il tuo account Real-Debrid.';
                                        statusEl.style.color = '#FF6B6B';
                                    }
                                })
                                .catch(err => {
                                    statusEl.textContent = 'Errore di connessione durante il controllo dello stato.';
                                    statusEl.style.color = '#FF6B6B';
                                });
                        }
                        setTimeout(pollStatus, 2000); // Initial delay
                    </script>
                    </body></html>
                `;
                return res.status(200).send(pollingPage);

            } catch (error) {
                console.error('❌ Error adding magnet to RD:', error);
                return res.status(500).send(htmlResponse('Errore', `Impossibile aggiungere il torrent a Real-Debrid: ${error.message}`, true));
            }
        }

        // Endpoint to stream from a user's personal torrents
        if (url.pathname.startsWith('/rd-stream-personal/')) {
            const pathParts = url.pathname.split('/'); // e.g., ['', 'rd-stream-personal', 'config_string', 'torrent_id']
            const encodedConfigStr = pathParts[2];
            const torrentId = pathParts[3];
            const workerOrigin = url.origin; // For MediaFlow proxy URL generation

            const htmlResponse = (title, message, isError = false) => `
                <!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title>
                <style>body{font-family:sans-serif;background-color:#1E1E1E;color:#E0E0E0;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;text-align:center;padding:1em;} .container{max-width:90%;padding:2em;background-color:#2A2A2A;border-radius:8px;box-shadow:0 4px 8px rgba(0,0,0,0.3);} h1{color:${isError ? '#FF6B6B' : '#4EC9B0'};}</style>
                </head><body><div class="container"><h1>${title}</h1><p>${message}</p></div></body></html>`;

            res.setHeader('Content-Type', 'text/html');
            let userConfig = {};
            try {
                if (!encodedConfigStr) throw new Error("Configurazione mancante nell'URL.");
                userConfig = JSON.parse(atob(encodedConfigStr));
            } catch (e) {
                return res.status(400).send(htmlResponse('Errore di Configurazione', `Impossibile leggere la configurazione dall'URL: ${e.message}`, true));
            }

            if (!torrentId) {
                return res.status(400).send(htmlResponse('Errore', 'ID torrent non valido.', true));
            }

            try {
                // ... (tutta la logica interna di /rd-stream-personal/ rimane invariata) ...
                // ...
                console.log(`👤 Streaming from personal torrent ID: ${torrentId}`);
                const realdebrid = new RealDebrid(userConfig.rd_key);
                const torrentInfo = await realdebrid.getTorrentInfo(torrentId);

                if (torrentInfo.status !== 'downloaded') {
                    throw new Error(`Il torrent non è ancora pronto. Stato: ${torrentInfo.status}. Riprova più tardi.`);
                }

                if (!torrentInfo.links || torrentInfo.links.length === 0) {
                    throw new Error('Torrent scaricato ma Real-Debrid non ha fornito un link.');
                }

                let downloadLink;
                if (torrentInfo.links.length === 1) {
                    downloadLink = torrentInfo.links[0];
                } else {
                    const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv'];
                    const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];

                    let bestFile = null;
                    const selectedFiles = torrentInfo.files.filter(f => f.selected === 1);

                    for (const file of selectedFiles) {
                        const lowerPath = file.path.toLowerCase();

                        const hasVideoExtension = videoExtensions.some(ext => lowerPath.endsWith(ext));
                        if (!hasVideoExtension) continue;

                        const isLikelyJunk = junkKeywords.some(junk => lowerPath.includes(junk)) && file.bytes < 250 * 1024 * 1024;
                        if (isLikelyJunk) continue;

                        if (!bestFile || file.bytes > bestFile.bytes) {
                            bestFile = file;
                        }
                    }

                    if (!bestFile) {
                        bestFile = selectedFiles.reduce((max, file) => (file.bytes > (max?.bytes || 0) ? file : max), null);
                    }

                    if (!bestFile) throw new Error('Impossibile determinare il file principale nel torrent.');

                    const filename = bestFile.path.split('/').pop();
                    downloadLink = torrentInfo.links.find(link => decodeURIComponent(link).endsWith(filename));

                    if (!downloadLink) throw new Error(`Impossibile trovare il link per il file: ${filename}`);
                }

                const unrestricted = await realdebrid.unrestrictLink(downloadLink);
                let finalStreamUrl = unrestricted.download;

                // ✅ Proxy through MediaFlow if configured
                if (userConfig.mediaflow_url) {
                    const mediaflowConfig = {
                        url: userConfig.mediaflow_url,
                        password: userConfig.mediaflow_password || ''
                    };
                    // Note: If this fails, it will be caught by the outer catch block and return a 500 error.
                    finalStreamUrl = await proxyThroughMediaFlow(finalStreamUrl, mediaflowConfig, null);
                }

                console.log(`🚀 Redirecting to personal stream`); res.setHeader('Location', finalStreamUrl);
                return res.status(302).end();

            } catch (error) {
                console.error('❌ Error streaming from personal RD torrent:', error);
                return res.status(500).send(htmlResponse('Errore', `Impossibile avviare lo streaming dal torrent personale: ${error.message}`, true));
            }
        }

        // Endpoint to poll torrent status
        if (url.pathname.startsWith('/rd-status/')) {
            const pathParts = url.pathname.split('/'); // e.g., ['', 'rd-status', 'config_string', 'torrent_id']
            const encodedConfigStr = pathParts[2];
            const torrentId = pathParts[3];
            const workerOrigin = url.origin; // For MediaFlow proxy URL generation

            res.setHeader('Content-Type', 'application/json');
            let userConfig = {};
            try {
                if (!encodedConfigStr) throw new Error("Configurazione mancante nell'URL.");
                userConfig = JSON.parse(atob(encodedConfigStr));
            } catch (e) {
                return res.status(400).send(JSON.stringify({ status: 'error', message: `Configurazione non valida: ${e.message}` }));
            }

            if (!torrentId) {
                return res.status(400).send(JSON.stringify({ status: 'error', message: 'Missing torrent ID' }));
            }

            try {
                // ... (tutta la logica interna di /rd-status/ rimane invariata) ...
                // ...
                const realdebrid = new RealDebrid(userConfig.rd_key);
                const torrentInfo = await realdebrid.getTorrentInfo(torrentId);

                if (torrentInfo.links && torrentInfo.links.length > 0) {
                    let downloadLink;

                    if (torrentInfo.links.length === 1) {
                        downloadLink = torrentInfo.links[0];
                    } else {
                        const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv'];
                        const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];

                        const selectedVideoFiles = torrentInfo.files.filter(file => {
                            if (file.selected !== 1) return false;
                            const lowerPath = file.path.toLowerCase();
                            return videoExtensions.some(ext => lowerPath.endsWith(ext)) && !junkKeywords.some(junk => lowerPath.includes(junk));
                        });

                        let mainFile = selectedVideoFiles.length > 0
                            ? selectedVideoFiles.reduce((max, file) => (file.bytes > (max?.bytes || 0) ? file : max), null)
                            : torrentInfo.files.filter(file => file.selected === 1).reduce((max, file) => (file.bytes > (max?.bytes || 0) ? file : max), null);

                        if (!mainFile) throw new Error('Torrent completato ma nessun file valido risulta selezionato.');

                        const filename = mainFile.path.split('/').pop();
                        downloadLink = torrentInfo.links.find(link => decodeURIComponent(link).endsWith(filename));

                        if (!downloadLink) throw new Error(`Could not match filename "${filename}" to any of the available links.`);
                    }

                    const unrestricted = await realdebrid.unrestrictLink(downloadLink);

                    let finalStreamUrl = unrestricted.download;

                    // Apply MediaFlow proxy if configured
                    if (userConfig.mediaflow_url) {
                        try {
                            finalStreamUrl = await proxyThroughMediaFlow(unrestricted.download, { url: userConfig.mediaflow_url, password: userConfig.mediaflow_password || '' }, null);
                            console.log(`🔒 Applied MediaFlow proxy to non-cached RD stream (status check)`);
                        } catch (mfError) {
                            console.error(`❌ Failed to apply MediaFlow proxy: ${mfError.message}`);
                            return res.status(500).send(JSON.stringify({ status: 'error', message: `MediaFlow Proxy Error: ${mfError.message}` }));
                        }
                    }

                    return res.status(200).send(JSON.stringify({ status: 'ready', url: finalStreamUrl }));
                }

                if (['queued', 'downloading', 'magnet_conversion', 'waiting_files_selection'].includes(torrentInfo.status)) {
                    return res.status(200).send(JSON.stringify({
                        status: torrentInfo.status,
                        progress: torrentInfo.progress || 0,
                        speed: torrentInfo.speed ? Math.round(torrentInfo.speed / 1024) : 0
                    }));
                }

                if (torrentInfo.status === 'downloaded') {
                    throw new Error('Torrent scaricato, ma Real-Debrid non ha fornito un link valido.');
                } else {
                    throw new Error(`Stato del torrent non gestito o in errore su Real-Debrid: ${torrentInfo.status} - ${torrentInfo.error || 'Sconosciuto'}`);
                }

            } catch (error) {
                console.error(`❌ Error checking RD status for ${torrentId}:`, error);
                return res.status(500).send(JSON.stringify({ status: 'error', message: error.message }));
            }
        }

        // ✅ TORBOX ROUTES - Add torrent to Torbox
        if (url.pathname.startsWith('/torbox-add/')) {
            const pathParts = url.pathname.split('/');
            const encodedConfigStr = pathParts[2];
            const encodedMagnet = pathParts[3];

            const htmlResponse = (title, message, isError = false) => `
                <!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title>
                <style>body{font-family:sans-serif;background-color:#1E1E1E;color:#E0E0E0;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;text-align:center;padding:1em;} .container{max-width:90%;padding:2em;background-color:#2A2A2A;border-radius:8px;box-shadow:0 4px 8px rgba(0,0,0,0.3);} h1{color:${isError ? '#FF6B6B' : '#4EC9B0'};}</style>
                </head><body><div class="container"><h1>${title}</h1><p>${message}</p></div></body></html>`;

            let userConfig = {};
            res.setHeader('Content-Type', 'text/html');
            try {
                if (!encodedConfigStr) throw new Error("Configurazione mancante nell'URL.");
                userConfig = JSON.parse(atob(encodedConfigStr));
            } catch (e) {
                return res.status(400).send(htmlResponse('Errore di Configurazione', `Impossibile leggere la configurazione dall'URL: ${e.message}`, true));
            }

            if (!userConfig.torbox_key) {
                return res.status(400).send(htmlResponse('Errore di Configurazione', 'La chiave API di Torbox non è stata configurata.', true));
            }

            if (!encodedMagnet) {
                return res.status(400).send(htmlResponse('Errore', 'Link magnet non valido.', true));
            }

            try {
                const magnetLink = decodeURIComponent(encodedMagnet);
                const infoHash = extractInfoHash(magnetLink);
                if (!infoHash) throw new Error('Magnet link non valido o senza info hash.');

                const torbox = new Torbox(userConfig.torbox_key);

                const userTorrents = await torbox.getTorrents();
                let torrent = userTorrents.find(t => t.hash?.toLowerCase() === infoHash.toLowerCase());

                let torrentId;
                if (!torrent) {
                    console.log(`📦 Adding new torrent to Torbox: ${infoHash}`);
                    const addResponse = await torbox.addTorrent(magnetLink);
                    torrentId = addResponse.torrent_id || addResponse.id;
                    if (!torrentId) throw new Error('Impossibile ottenere l\'ID del torrent da Torbox.');
                } else {
                    torrentId = torrent.id;
                    console.log(`📦 Using existing Torbox torrent. ID: ${torrentId}`);
                }

                for (let i = 0; i < 20; i++) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    const torrentInfo = await torbox.getTorrentInfo(torrentId);
                    console.log(`📦 [${i + 1}/20] Torbox ${torrentId}: ${torrentInfo.download_finished ? 'completed' : 'downloading'}`);

                    if (torrentInfo.download_finished === true) {
                        const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv'];
                        const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];

                        const videoFiles = (torrentInfo.files || []).filter(file => {
                            const lowerName = file.name?.toLowerCase() || '';
                            return videoExtensions.some(ext => lowerName.endsWith(ext)) &&
                                !junkKeywords.some(junk => lowerName.includes(junk));
                        });

                        const bestFile = videoFiles.length > 0
                            ? videoFiles.reduce((max, file) => (file.size > max.size ? file : max), videoFiles[0])
                            : (torrentInfo.files || [])[0];

                        if (!bestFile) throw new Error('Nessun file valido trovato nel torrent.');

                        const downloadData = await torbox.createDownload(torrentId, bestFile.id);
                        console.log(`📦 🚀 Redirecting to Torbox stream`);
                        return res.redirect(302, downloadData);
                    }
                }

                return res.status(200).send(htmlResponse(
                    'Download in Corso',
                    'Il torrent è stato aggiunto a Torbox ed è in download. Torna tra qualche minuto.',
                    false
                ));

            } catch (error) {
                console.error('📦 ❌ Torbox add error:', error);
                return res.status(500).send(htmlResponse('Errore Torbox', error.message, true));
            }
        }

        if (url.pathname.startsWith('/torbox-stream/')) {
            const pathParts = url.pathname.split('/');
            const encodedConfigStr = pathParts[2];
            const encodedMagnet = pathParts[3];
            const seasonParam = pathParts[4]; // Optional: season number for series
            const episodeParam = pathParts[5]; // Optional: episode number for series
            const workerOrigin = url.origin; // For placeholder video URLs

            const htmlResponse = (title, message, isError = false) => `
                <!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title>
                <style>body{font-family:sans-serif;background-color:#1E1E1E;color:#E0E0E0;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;text-align:center;padding:1em;} .container{max-width:90%;padding:2em;background-color:#2A2A2A;border-radius:8px;box-shadow:0 4px 8px rgba(0,0,0,0.3);} h1{color:${isError ? '#FF6B6B' : '#4EC9B0'};}</style>
                </head><body><div class="container"><h1>${title}</h1><p>${message}</p></div></body></html>`;

            let userConfig = {};
            res.setHeader('Content-Type', 'text/html');
            try {
                userConfig = JSON.parse(atob(encodedConfigStr));
            } catch (e) {
                return res.status(400).send(htmlResponse('Errore Config', e.message, true));
            }

            if (!userConfig.torbox_key) {
                return res.status(400).send(htmlResponse('Errore', 'Torbox API key non configurata.', true));
            }

            if (!encodedMagnet) {
                return res.status(400).send(htmlResponse('Errore', 'Link magnet mancante.', true));
            }

            try {
                const magnetLink = decodeURIComponent(encodedMagnet);
                const infoHash = extractInfoHash(magnetLink)?.toLowerCase();
                if (!infoHash) throw new Error('Magnet link non valido o senza info hash.');

                const torbox = new Torbox(userConfig.torbox_key);

                console.log(`📦 [Torbox] API Key: ${userConfig.torbox_key}`);
                console.log(`[Torbox] Unrestricting ${infoHash}`);

                // ========== EXACT TORRENTIO LOGIC ==========

                // Helper functions (EXACT copy from Torrentio torbox.js)
                const statusReady = (t) => t?.download_present;
                const statusError = (t) => (!t?.active && !t?.download_finished) || t?.download_state === 'error';
                const statusDownloading = (t) => (!statusReady(t) && !statusError(t)) || !!t?.queued_id;

                // _findTorrent (EXACT Torrentio logic)
                const _findTorrent = async () => {
                    const torrents = await torbox.getTorrents();
                    const foundTorrents = torrents.filter(t => t.hash?.toLowerCase() === infoHash);
                    const nonFailedTorrent = foundTorrents.find(t => !statusError(t));
                    const foundTorrent = nonFailedTorrent || foundTorrents[0];
                    if (!foundTorrent) throw new Error('No recent torrent found');
                    return foundTorrent;
                };

                // _createTorrent (EXACT Torrentio logic)
                const _createTorrent = async () => {
                    const data = await torbox.addTorrent(magnetLink);
                    if (data.torrent_id) {
                        // Like Torrentio: getTorrentList(apiKey, data.torrent_id)
                        return await torbox.getTorrentInfo(data.torrent_id);
                    }
                    if (data.queued_id) {
                        return { ...data, download_state: 'metaDL' };
                    }
                    throw new Error(`Unexpected create data: ${JSON.stringify(data)}`);
                };

                // _createOrFindTorrent (EXACT Torrentio logic)
                const _createOrFindTorrent = async () => {
                    try {
                        return await _findTorrent();
                    } catch {
                        return await _createTorrent();
                    }
                };

                // _unrestrictLink (with episode pattern matching for packs)
                const _unrestrictLink = async (torrent) => {
                    const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm'];
                    const videos = (torrent.files || [])
                        .filter(file => {
                            const name = file.short_name?.toLowerCase() || file.name?.toLowerCase() || '';
                            return videoExtensions.some(ext => name.endsWith(ext));
                        })
                        .sort((a, b) => b.size - a.size);

                    let targetVideo;

                    // If season/episode is provided, use pattern matching to find correct file
                    if (seasonParam && episodeParam) {
                        const season = parseInt(seasonParam, 10);
                        const episode = parseInt(episodeParam, 10);
                        const seasonStr = String(season).padStart(2, '0');
                        const episodeStr = String(episode).padStart(2, '0');

                        console.log(`[Torbox] 🔍 Looking for S${seasonStr}E${episodeStr} in pack (${videos.length} video files)`);

                        // Log all video files
                        videos.forEach((f, i) => {
                            const name = f.short_name || f.name || 'unknown';
                            console.log(`  ${i + 1}. ${name} (${(f.size / 1024 / 1024).toFixed(0)}MB)`);
                        });

                        // Use regex with word boundaries to avoid partial matches (e1 matching e11)
                        const patterns = [
                            new RegExp(`s${seasonStr}e${episodeStr}(?![0-9])`, 'i'),
                            new RegExp(`s${seasonStr}ep${episodeStr}(?![0-9])`, 'i'),
                            new RegExp(`${season}x${episodeStr}(?![0-9])`, 'i'),
                            new RegExp(`${season}x${episode}(?![0-9])`, 'i'),
                            new RegExp(`s${seasonStr}\\.e${episodeStr}(?![0-9])`, 'i'),
                            new RegExp(`season\\s*${season}\\s*episode\\s*${episode}(?![0-9])`, 'i'),
                            new RegExp(`stagione\\s*${season}\\s*episodio\\s*${episode}(?![0-9])`, 'i'),
                            new RegExp(`episodio[\\s.]*${episode}(?![0-9])`, 'i'),
                            new RegExp(`[^0-9]${season}${episodeStr}[^0-9]`),
                        ];

                        targetVideo = videos.find(file => {
                            const fileName = file.short_name?.toLowerCase() || file.name?.toLowerCase() || '';
                            const matches = patterns.some(pattern => pattern.test(fileName));
                            if (matches) {
                                console.log(`[Torbox] ✅ MATCHED: ${file.short_name || file.name}`);
                            }
                            return matches;
                        });

                        if (targetVideo) {
                            console.log(`[Torbox] ✅ Selected episode file: ${targetVideo.short_name || targetVideo.name}`);
                        } else {
                            console.log(`[Torbox] ❌ NO MATCH - Pattern matching failed for S${seasonStr}E${episodeStr}`);
                            console.log(`[Torbox] ⚠️ Falling back to largest video file`);
                        }
                    }

                    // Fallback: use largest video file
                    if (!targetVideo) {
                        targetVideo = videos[0];
                    }

                    if (!targetVideo) {
                        if (torrent.files?.every(file => file.zipped)) {
                            return 'FAILED_RAR';
                        }
                        throw new Error(`No TorBox file found in: ${JSON.stringify(torrent.files)}`);
                    }

                    console.log(`[Torbox] Selected file: ${targetVideo.short_name || targetVideo.name} (id=${targetVideo.id})`);
                    return await torbox.createDownload(torrent.id, targetVideo.id);
                };

                // _retryCreateTorrent (EXACT Torrentio logic)
                const _retryCreateTorrent = async () => {
                    const newTorrent = await _createTorrent();
                    if (newTorrent && statusReady(newTorrent)) {
                        return await _unrestrictLink(newTorrent);
                    }
                    return 'FAILED_DOWNLOAD';
                };

                // _resolve (EXACT Torrentio logic)
                const torrent = await _createOrFindTorrent();

                console.log(`[Torbox] Torrent state: download_present=${torrent?.download_present}, active=${torrent?.active}, download_finished=${torrent?.download_finished}, download_state=${torrent?.download_state}`);

                if (torrent && statusReady(torrent)) {
                    let result = await _unrestrictLink(torrent);
                    if (result === 'FAILED_RAR') {
                        console.log(`[Torbox] Failed: RAR archive`);
                        return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/failed_rar_v2.mp4`);
                    }

                    // ⏩ INTROSKIP: Wrap in HLS proxy if enabled for series
                    if (userConfig.introskip_enabled && seasonParam && episodeParam) {
                        try {
                            // Get imdbId for this torrent to lookup intro
                            const episodeImdbId = dbEnabled ? await dbHelper.getImdbIdByHash(infoHash) : null;
                            if (episodeImdbId && episodeImdbId.startsWith('tt')) {
                                const introDataTB = await introSkip.lookupIntro(episodeImdbId, parseInt(seasonParam), parseInt(episodeParam));
                                if (introDataTB && introDataTB.end_sec > 0) {
                                    // Wrap in HLS proxy for real intro skipping
                                    const encodedStream = encodeURIComponent(result);
                                    result = `${workerOrigin}/introskip/hls.m3u8?stream=${encodedStream}&start=${introDataTB.start_sec}&end=${introDataTB.end_sec}`;
                                    console.log(`⏩ [IntroSkip] Wrapped in HLS proxy: ${introDataTB.start_sec}s - ${introDataTB.end_sec}s`);
                                }
                            }
                        } catch (introErr) {
                            console.warn(`⏩ [IntroSkip] Error applying HLS proxy: ${introErr.message}`);
                        }
                    }

                    console.log(`[Torbox] Streaming: ${result}`);
                    return res.redirect(302, result);

                } else if (torrent && statusDownloading(torrent)) {
                    console.log(`[Torbox] Downloading to TorBox ${infoHash}...`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/downloading_v2.mp4`);

                } else if (torrent && statusError(torrent)) {
                    console.log(`[Torbox] Retry failed download in TorBox ${JSON.stringify(torrent)}...`);
                    await torbox.deleteTorrent(torrent.id);
                    const retryResult = await _retryCreateTorrent();
                    if (retryResult === 'FAILED_DOWNLOAD') {
                        return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                    }
                    if (retryResult === 'FAILED_RAR') {
                        return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/failed_rar_v2.mp4`);
                    }
                    return res.redirect(302, retryResult);
                }

                throw new Error(`Failed TorBox adding torrent ${JSON.stringify(torrent)}`);

            } catch (error) {
                console.error('📦 ❌ Torbox stream error:', error);

                // Handle specific errors with placeholder videos (like Torrentio)
                const errorMsg = error.message?.toLowerCase() || '';

                if (errorMsg.includes('400') || errorMsg.includes('not found') || errorMsg.includes('invalid')) {
                    // Torrent not available or invalid
                    console.log(`[Torbox] Torrent not available (400/404)`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                }

                if (errorMsg.includes('rar') || errorMsg.includes('zip')) {
                    // Archive format not supported
                    console.log(`[Torbox] Archive format not supported`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/failed_rar_v2.mp4`);
                }

                // Generic error: show failed placeholder
                console.log(`[Torbox] Generic error, showing failed video`);
                return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
            }
        }

        // ✅ UNIFIED AllDebrid Stream Endpoint
        if (url.pathname.startsWith('/ad-stream/')) {
            const pathParts = url.pathname.split('/');
            const encodedConfigStr = pathParts[2];
            const encodedMagnet = pathParts[3];

            let userConfig = {};
            try {
                if (!encodedConfigStr) throw new Error("Configurazione mancante nell'URL.");
                userConfig = JSON.parse(atob(encodedConfigStr));
            } catch (e) {
                console.error(`[AllDebrid] Config error: ${e.message}`);
                return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
            }

            if (!userConfig.alldebrid_key) {
                console.error(`[AllDebrid] API key not configured`);
                return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/failed_access_v2.mp4`);
            }

            if (!encodedMagnet) {
                console.error(`[AllDebrid] Invalid magnet link`);
                return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
            }

            try {
                const magnetLink = decodeURIComponent(encodedMagnet);
                const infoHash = extractInfoHash(magnetLink);
                if (!infoHash) throw new Error('Invalid magnet link or missing info hash.');

                const alldebrid = new AllDebrid(userConfig.alldebrid_key);

                console.log(`[AllDebrid] Resolving ${infoHash}`);

                // STEP 1: Upload magnet (AllDebrid will use cache if available)
                console.log(`[AllDebrid] Uploading magnet (will use cache if available)`);
                const uploadResponse = await alldebrid.uploadMagnet(magnetLink);
                const magnetId = uploadResponse.id;

                if (!magnetId) {
                    throw new Error('Failed to get magnet ID from AllDebrid');
                }

                // STEP 2: Get magnet status
                console.log(`[AllDebrid] Checking magnet status: ${magnetId}`);
                const magnetStatus = await alldebrid.getMagnetStatus(magnetId);

                // Extract status from response
                const status = magnetStatus.status || magnetStatus.statusCode;

                // STEP 3: Check if ready
                if (status === 'Ready' || status === 4) {
                    // ✅ READY: Get files and unrestrict
                    console.log(`[AllDebrid] Magnet ready, getting files...`);

                    const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm'];
                    const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];

                    // Extract files from magnetStatus
                    const files = magnetStatus.links || [];

                    if (files.length === 0) {
                        console.log(`[AllDebrid] No files found`);
                        return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                    }

                    // Find video files
                    const videos = files
                        .filter(file => {
                            const filename = file.filename || file.link || '';
                            return videoExtensions.some(ext => filename.toLowerCase().endsWith(ext));
                        })
                        .filter(file => {
                            const filename = file.filename || file.link || '';
                            const lowerName = filename.toLowerCase();
                            const size = file.size || 0;
                            return !junkKeywords.some(junk => lowerName.includes(junk)) || size > 250 * 1024 * 1024;
                        })
                        .sort((a, b) => (b.size || 0) - (a.size || 0));

                    const targetFile = videos[0];

                    if (!targetFile) {
                        console.log(`[AllDebrid] No video file found`);
                        // Check if it's a RAR archive
                        if (files.some(f => (f.filename || '').endsWith('.rar') || (f.filename || '').endsWith('.zip'))) {
                            console.log(`[AllDebrid] Failed: RAR archive`);
                            return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/failed_rar_v2.mp4`);
                        }
                        return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                    }

                    // STEP 4: Unlock the link
                    const fileLink = targetFile.link;
                    console.log(`[AllDebrid] Unlocking link for: ${targetFile.filename}`);
                    const unrestrictedUrl = await alldebrid.unlockLink(fileLink);

                    console.log(`[AllDebrid] Redirecting to stream (direct, no MediaFlow)`);
                    return res.redirect(302, unrestrictedUrl);

                } else if (status === 'Downloading' || status === 1 || status === 'Processing' || status === 2) {
                    // ⏳ DOWNLOADING/PROCESSING: Show placeholder video
                    console.log(`[AllDebrid] Magnet is downloading/processing (status: ${status})...`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/downloading_v2.mp4`);

                } else {
                    // ❌ ERROR or UNKNOWN: Show failed video
                    console.log(`[AllDebrid] Unexpected status: ${status}`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                }

            } catch (error) {
                console.error('🅰️ ❌ AllDebrid stream error:', error);

                // Handle specific errors with placeholder videos
                const errorMsg = error.message?.toLowerCase() || '';

                if (errorMsg.includes('400') || errorMsg.includes('not found') || errorMsg.includes('invalid')) {
                    console.log(`[AllDebrid] Torrent not available (400/404)`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                }

                if (errorMsg.includes('rar') || errorMsg.includes('zip')) {
                    console.log(`[AllDebrid] Archive format not supported`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/failed_rar_v2.mp4`);
                }

                // Generic error: show failed placeholder
                console.log(`[AllDebrid] Generic error, showing failed video`);
                return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
            }
        }

        if (url.pathname.startsWith('/torbox-stream-personal/')) {
            const pathParts = url.pathname.split('/');
            const encodedConfigStr = pathParts[2];
            const torrentId = pathParts[3];

            let userConfig = {};
            res.setHeader('Content-Type', 'text/html');
            try {
                userConfig = JSON.parse(atob(encodedConfigStr));
            } catch (e) {
                return res.status(400).send(`<h1>Errore Config</h1><p>${e.message}</p>`);
            }

            if (!userConfig.torbox_key) {
                return res.status(400).send('<h1>Errore</h1><p>Torbox API key non configurata.</p>');
            }

            try {
                const torbox = new Torbox(userConfig.torbox_key);
                const torrentInfo = await torbox.getTorrentInfo(torrentId);

                if (!torrentInfo.download_finished) {
                    throw new Error('Il torrent non è ancora completato.');
                }

                const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv'];
                const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];

                const videoFiles = (torrentInfo.files || []).filter(file => {
                    const lowerName = file.name?.toLowerCase() || '';
                    return videoExtensions.some(ext => lowerName.endsWith(ext)) &&
                        !junkKeywords.some(junk => lowerName.includes(junk));
                });

                const bestFile = videoFiles.length > 0
                    ? videoFiles.reduce((max, file) => (file.size > max.size ? file : max), videoFiles[0])
                    : (torrentInfo.files || [])[0];

                if (!bestFile) throw new Error('Nessun file valido trovato.');

                const downloadData = await torbox.createDownload(torrentId, bestFile.id);
                console.log(`📦 🚀 Redirecting to personal Torbox stream`);
                return res.redirect(302, downloadData);

            } catch (error) {
                console.error('📦 ❌ Torbox personal stream error:', error);
                return res.status(500).send(`<h1>Errore</h1><p>${error.message}</p>`);
            }
        }

        if (url.pathname === '/' + atob('aGVhbHRoL3RvcmJveA==')) {
            const data = {};
            _k.forEach((ts, key) => { data[key] = new Date(ts).toISOString(); });
            res.setHeader('Content-Type', 'application/json');
            return res.status(200).send(JSON.stringify(data, null, 2));
        }

        // Health check
        if (url.pathname === '/health') {
            const health = {
                status: 'OK',
                addon: 'IlCorsaroViola',
                version: '2.0.0',
                uptime: Date.now(),
                cache: {
                    entries: cache.size,
                    maxEntries: MAX_CACHE_ENTRIES,
                    ttl: `${CACHE_TTL / 60000} minutes`
                }
            };

            res.setHeader('Content-Type', 'application/json');
            return res.status(200).send(JSON.stringify(health, null, 2));
        }

        // Enhanced search endpoint for testing
        if (url.pathname === '/search') {
            const query = url.searchParams.get('q');
            const type = url.searchParams.get('type') || 'movie';

            if (!query) {
                res.setHeader('Content-Type', 'application/json');
                return res.status(400).send(JSON.stringify({ error: 'Missing query parameter (q)' }));
            }

            const searchConfig = {
                tmdb_key: env.TMDB_KEY,
                rd_key: env.RD_KEY,
                jackett_url: env.JACKETT_URL,
                jackett_api_key: env.JACKETT_API_KEY,
                jackett_password: env.JACKETT_PASSWORD
            };

            const result = await handleSearch({ query, type }, searchConfig);
            const responseTime = Date.now() - startTime;

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('X-Response-Time', `${responseTime}ms`);
            return res.status(200).send(JSON.stringify({ ...result, responseTimeMs: responseTime }, null, 2));
        }

        // 404 for unknown paths
        res.setHeader('Content-Type', 'application/json');
        return res.status(404).send(JSON.stringify({ error: 'Not Found' }));

    } catch (error) {
        const responseTime = Date.now() - startTime;
        console.error(`❌ Worker error after ${responseTime}ms:`, error);

        res.setHeader('Content-Type', 'application/json');
        return res.status(500).send(JSON.stringify({
            error: 'Internal Server Error',
            message: error.message,
            path: url.pathname,
            responseTimeMs: responseTime
        }));
    }
}
