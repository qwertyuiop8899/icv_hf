/**
 * RARBG Scraper Module
 * =====================
 * Modulo standalone per la ricerca torrent su RARBG con supporto multi-mirror e failover automatico.
 * 
 * Utilizzo:
 *   const { searchRARBG } = require('./rarbg');
 *   const results = await searchRARBG('Breaking Bad', '2008', 'tv', null, null, { allowEng: true });
 * 
 * @author CorsaroViola Integration
 * @version 1.0.0
 */

const axios = require("axios");
const cheerio = require("cheerio");
const https = require("https");

// ============================================
// CONFIGURAZIONE
// ============================================

const RARBG_CONFIG = {
    // Mirror ordinati per priorità (il primo è il primario)
    MIRRORS: [
        "https://rargb.to",
        "https://www2.rarbggo.to",
        "https://www.rarbgproxy.to",
        "https://www.proxyrarbg.to"
    ],

    // Timeout per le richieste
    TIMEOUT: 8000,
    DETAIL_TIMEOUT: 5000,

    // Massimo numero di risultati da processare per i dettagli (per evitare rate limiting)
    MAX_DETAIL_REQUESTS: 15,

    // Concorrenza massima per le richieste ai dettagli
    CONCURRENCY: 5,

    // Trackers da aggiungere ai magnet
    TRACKERS: [
        "udp://tracker.opentrackr.org:1337/announce",
        "udp://open.demonoid.ch:6969/announce",
        "udp://open.stealth.si:80/announce",
        "udp://tracker.torrent.eu.org:451/announce",
        "udp://exodus.desync.com:6969/announce",
        "udp://tracker.moeking.me:6969/announce"
    ]
};

// Agent HTTPS con SSL flessibile
const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true
});

// ============================================
// PROFILI BROWSER (Anti-Detection)
// ============================================

const BROWSER_PROFILES = [
    {
        name: "Chrome Win",
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        headers: {
            'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'accept-language': 'en-US,en;q=0.9,it;q=0.8',
            'upgrade-insecure-requests': '1'
        }
    },
    {
        name: "Firefox Win",
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
        headers: {
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'accept-language': 'en-US,en;q=0.5',
            'upgrade-insecure-requests': '1',
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'none'
        }
    },
    {
        name: "Chrome Mac",
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        headers: {
            'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"macOS"',
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-language': 'en-US,en;q=0.9'
        }
    }
];

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Seleziona un profilo browser casuale
 */
function getRandomProfile() {
    return BROWSER_PROFILES[Math.floor(Math.random() * BROWSER_PROFILES.length)];
}

/**
 * Genera headers stealth per una richiesta
 */
function getStealthHeaders(url) {
    const profile = getRandomProfile();
    const urlObj = new URL(url);

    return {
        'User-Agent': profile.userAgent,
        'Referer': urlObj.origin + '/',
        'Origin': urlObj.origin,
        'Host': urlObj.host,
        'Connection': 'keep-alive',
        'Cache-Control': 'max-age=0',
        ...profile.headers
    };
}

/**
 * Pulisce il titolo per la ricerca
 */
function cleanTitle(title) {
    if (!title) return "";
    return title
        .replace(/[:\"'']/g, "")
        .replace(/[^a-zA-Z0-9\s\-.\[\]()]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Converte bytes in stringa leggibile
 */
function bytesToSize(bytes) {
    if (!bytes || isNaN(bytes)) return "??";
    const gb = bytes / (1024 ** 3);
    if (gb >= 1) return gb.toFixed(2) + " GB";
    const mb = bytes / (1024 ** 2);
    return mb.toFixed(1) + " MB";
}

/**
 * Parsa la stringa dimensione in bytes
 */
function parseSize(sizeStr) {
    if (!sizeStr) return 0;
    const match = sizeStr.toString().match(/([\d.,]+)\s*(TB|GB|MB|KB|GiB|MiB|KiB|B)/i);
    if (!match) return 0;
    let val = parseFloat(match[1].replace(',', '.'));
    const unit = match[2].toUpperCase();
    if (unit.includes('T')) val *= 1024 ** 4;
    else if (unit.includes('G')) val *= 1024 ** 3;
    else if (unit.includes('M')) val *= 1024 ** 2;
    else if (unit.includes('K')) val *= 1024;
    return Math.round(val);
}

/**
 * Limiter per concorrenza
 */
function pLimitSimple(concurrency) {
    let active = 0;
    const queue = [];

    const next = () => {
        if (active < concurrency && queue.length > 0) {
            active++;
            const { fn, resolve, reject } = queue.shift();
            fn().then(resolve).catch(reject).finally(() => {
                active--;
                next();
            });
        }
    };

    return (fn) => new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        next();
    });
}

/**
 * Valida se il risultato è italiano o inglese accettabile
 */
function isValidResult(name, allowEng = false) {
    if (!name) return false;
    const nameUpper = name.toUpperCase();

    // Regex per contenuti italiani
    const ITA_REGEX = /\b(ITA(LIANO)?|MULTI|DUAL|MD|SUB\.?ITA|SUB-?ITA|ITALUB|AC3\.?ITA|DTS\.?ITA|AUDIO\.?ITA|ITA\.?AC3|ITA\.?HD|BDMUX|DVDRIP\.?ITA)\b/i;

    if (ITA_REGEX.test(nameUpper)) return true;
    if (!allowEng) return false;

    // Se allowEng, accetta tutto tranne lingue specifiche
    const FOREIGN_REGEX = /\b(FRENCH|GERMAN|SPANISH|LATINO|RUSSIAN|HINDI|TAMIL|TELUGU|KOREAN)\b/i;
    if (FOREIGN_REGEX.test(nameUpper) && !/MULTI/i.test(nameUpper)) return false;

    return true;
}

/**
 * Verifica anno del contenuto
 */
function checkYear(name, year, type) {
    if (!year) return true;
    if (type === 'tv' || type === 'series') return true;
    const y = parseInt(year);
    if (isNaN(y)) return true;
    const yearsToCheck = [y - 1, y, y + 1].map(String);
    return yearsToCheck.some(yStr => name.includes(yStr));
}

/**
 * Verifica stagione/episodio
 */
function isCorrectFormat(name, reqSeason, reqEpisode) {
    if (!reqSeason && !reqEpisode) return true;

    // Cerca pattern S01E01
    const seMatch = name.match(/S(\d{1,2})[\s._-]?E(\d{1,3})/i);
    const sMatch = name.match(/S(\d{1,2})(?![E\d])/i) || name.match(/Season\s*(\d{1,2})/i);

    let season = null, episode = null;

    if (seMatch) {
        season = parseInt(seMatch[1]);
        episode = parseInt(seMatch[2]);
    } else if (sMatch) {
        season = parseInt(sMatch[1]);
    }

    // Pack di stagione completa
    const isPack = /PACK|COMPLET|TUTTE|STAGIONE\s\d+(?!.*E\d)|COMPLETE|SEASON\s*\d+\s*(COMPLETE)?$/i.test(name);

    if (reqSeason && season !== null && season !== reqSeason) return false;
    if (reqEpisode && !isPack) {
        if (episode !== null && episode !== reqEpisode) return false;
    }

    return true;
}

/**
 * Parsa imdbId per estrarre stagione/episodio
 */
function parseImdbId(imdbId) {
    if (!imdbId || typeof imdbId !== 'string') return { season: null, episode: null };
    const parts = imdbId.split(':');
    if (parts.length >= 3) {
        return {
            season: parseInt(parts[parts.length - 2]) || null,
            episode: parseInt(parts[parts.length - 1]) || null
        };
    }
    return { season: null, episode: null };
}

// ============================================
// HTTP REQUEST ENGINE
// ============================================

/**
 * Effettua una richiesta HTTP con headers stealth
 */
async function stealthRequest(url, options = {}) {
    const headers = {
        ...getStealthHeaders(url),
        ...options.headers
    };

    try {
        const response = await axios({
            url,
            method: options.method || 'GET',
            headers,
            httpsAgent,
            timeout: options.timeout || RARBG_CONFIG.TIMEOUT,
            validateStatus: status => status < 500,
            maxRedirects: 5
        });

        // Controllo Cloudflare
        if (typeof response.data === 'string' &&
            (response.data.includes("Cloudflare") ||
                response.data.includes("Verify you are human") ||
                response.data.includes("Just a moment"))) {
            throw new Error("Cloudflare Detected");
        }

        return response;
    } catch (err) {
        // Tentativo con cloudscraper se disponibile
        try {
            const cloudscraper = require('cloudscraper');
            const html = await cloudscraper.get(url, {
                headers,
                timeout: (options.timeout || RARBG_CONFIG.TIMEOUT) + 2000
            });
            return { data: html };
        } catch (err2) {
            return { data: "", error: err.message };
        }
    }
}

// ============================================
// RARBG SCRAPER CORE
// ============================================

/**
 * Prova la ricerca su un singolo mirror
 */
async function tryMirror(mirror, query, options = {}) {
    // 🔥 FIX: Use /search/ endpoint instead of /torrents.php (which returns popular spam on some mirrors)
    // Also removed order params temporarily to match browser behavior that works
    const searchUrl = `${mirror}/search/?search=${encodeURIComponent(query)}`;

    console.log(`[RARBG] 🔍 Trying: ${mirror}`);

    const response = await stealthRequest(searchUrl, { timeout: options.timeout || RARBG_CONFIG.TIMEOUT });

    if (!response.data || response.error) {
        throw new Error(response.error || "Empty response");
    }

    const $ = cheerio.load(response.data);
    const candidates = [];

    // Parsing tabella risultati - Pattern 1: table.lista2
    $('table.lista2 tr, tr.lista2').each((i, row) => {
        try {
            const tds = $(row).find('td');
            if (tds.length < 5) return;

            // Colonna 2: titolo e link
            const titleCell = tds.eq(1);
            const titleLink = titleCell.find('a').first();
            const name = titleLink.attr('title') || titleLink.text().trim();
            let detailHref = titleLink.attr('href');

            if (!name || name.length < 5 || !detailHref) return;

            // Costruisci URL completo
            if (!detailHref.startsWith('http')) {
                detailHref = mirror + (detailHref.startsWith('/') ? '' : '/') + detailHref;
            }

            // Colonna 4: size, Colonna 5: seeders
            const sizeStr = tds.eq(3).text().trim() || tds.eq(4).text().trim();
            const seedersStr = tds.eq(4).text().trim() || tds.eq(5).text().trim();
            const seeders = parseInt(seedersStr.replace(/,/g, '')) || 0;

            candidates.push({
                name,
                detailUrl: detailHref,
                size: sizeStr,
                sizeBytes: parseSize(sizeStr),
                seeders
            });
        } catch (e) { /* skip errori parsing */ }
    });

    // Pattern 2: div o struttura alternativa (per alcuni mirror)
    if (candidates.length === 0) {
        $('a[href*="/torrent/"]').each((i, el) => {
            try {
                const href = $(el).attr('href');
                const name = $(el).text().trim();

                if (!name || name.length < 10 || !href) return;
                if (href.includes('magnet:')) return;

                let fullUrl = href;
                if (!href.startsWith('http')) {
                    fullUrl = mirror + (href.startsWith('/') ? '' : '/') + href;
                }

                // Cerca size e seeders nel contesto
                const parent = $(el).closest('tr, div, li');
                const parentText = parent.text();

                const sizeMatch = parentText.match(/([\d.,]+)\s*(GB|MB|GiB|MiB)/i);
                const sizeStr = sizeMatch ? sizeMatch[0] : "??";

                // Cerca seeders (numero verde o in posizione specifica)
                let seeders = 0;
                const greenNum = parent.find('[color="green"], .green, .text-success').first().text();
                if (greenNum && /^\d+$/.test(greenNum.trim())) {
                    seeders = parseInt(greenNum);
                } else {
                    const seedMatch = parentText.match(/(\d+)\s*seed/i);
                    if (seedMatch) seeders = parseInt(seedMatch[1]);
                }

                candidates.push({
                    name,
                    detailUrl: fullUrl,
                    size: sizeStr,
                    sizeBytes: parseSize(sizeStr),
                    seeders
                });
            } catch (e) { /* skip */ }
        });
    }

    if (candidates.length === 0) {
        throw new Error("No results found");
    }

    console.log(`[RARBG] ✅ Found ${candidates.length} candidates on ${mirror}`);
    return { mirror, candidates };
}

/**
 * Estrae il magnet link dalla pagina dettagli
 */
async function extractMagnet(detailUrl, mirror, timeout = RARBG_CONFIG.DETAIL_TIMEOUT) {
    try {
        const response = await stealthRequest(detailUrl, {
            timeout: timeout,
            headers: { 'Referer': mirror + '/' }
        });

        if (!response.data) return null;

        const $ = cheerio.load(response.data);

        // Cerca magnet link
        let magnet = $('a[href^="magnet:?"]').first().attr('href');

        // Pattern alternativi
        if (!magnet) {
            const magnetMatch = response.data.match(/magnet:\?xt=urn:btih:[a-zA-Z0-9]+[^"'\s]*/);
            if (magnetMatch) magnet = magnetMatch[0];
        }

        return magnet || null;
    } catch (e) {
        return null;
    }
}

/**
 * Aggiunge trackers al magnet link
 */
function enrichMagnet(magnet) {
    if (!magnet) return magnet;
    if (!magnet.includes('&tr=')) {
        RARBG_CONFIG.TRACKERS.forEach(tr => {
            magnet += `&tr=${encodeURIComponent(tr)}`;
        });
    }
    return magnet;
}

// ============================================
// MAIN SEARCH FUNCTION
// ============================================

/**
 * Ricerca torrent su RARBG con failover automatico tra i mirrors
 * 
 * @param {string} title - Titolo da cercare
 * @param {string} year - Anno (opzionale)
 * @param {string} type - Tipo: 'movie', 'tv', 'series'
 * @param {string} imdbId - ID IMDB con formato tt1234567:S:E (opzionale)
 * @param {object} options - Opzioni: { allowEng: false }
 * @returns {Promise<Array>} Array di risultati con { title, magnet, size, sizeBytes, seeders, source }
 */
async function searchRARBG(title, year, type, imdbId = null, options = {}) {
    const { season: reqSeason, episode: reqEpisode } = parseImdbId(imdbId);
    const allowEng = options.allowEng || false;

    // Costruisci query
    let query = cleanTitle(title);
    if (!allowEng && !query.toUpperCase().includes("ITA")) {
        query += " ITA";
    }

    console.log(`[RARBG] 🎬 Searching: "${query}" (${type}, ${year || 'N/A'})`);

    let workingMirror = null;
    let filtered = [];
    let allDiscarded = []; // Per debug

    // Prova ogni mirror in ordine
    for (const mirror of RARBG_CONFIG.MIRRORS) {
        try {
            const result = await tryMirror(mirror, query, options);
            const candidates = result.candidates;

            // Filtra candidati immediatamente
            const currentFiltered = candidates.filter(c => {
                const valid = isValidResult(c.name, allowEng);
                const yearOk = checkYear(c.name, year, type);
                const formatOk = isCorrectFormat(c.name, reqSeason, reqEpisode);
                return valid && yearOk && formatOk;
            });

            if (currentFiltered.length > 0) {
                workingMirror = result.mirror;
                filtered = currentFiltered;
                console.log(`[RARBG] ✅ Mirror ${mirror} provided ${filtered.length} valid results.`);
                break; // Successo, esci dal loop
            }

            console.log(`[RARBG] ⚠️ Mirror ${mirror} returned ${candidates.length} results but all were filtered (junk/spam). Trying next...`);

            // Salva campioni di scartati per debug finale
            if (allDiscarded.length < 10) {
                allDiscarded.push(...candidates.slice(0, 5));
            }

        } catch (err) {
            console.log(`[RARBG] ❌ ${mirror} failed: ${err.message}`);
            continue;
        }
    }

    if (!workingMirror || filtered.length === 0) {
        console.log(`[RARBG] ⚠️ All mirrors failed or no valid results found.`);
        if (allDiscarded.length > 0) {
            console.log(`[RARBG] Examples of discarded (Junk/Mismatch):`);
            allDiscarded.forEach(c => {
                const valid = isValidResult(c.name, allowEng);
                const yearOk = checkYear(c.name, year, type);
                console.log(`   - ${c.name} (Valid: ${valid}, Year: ${yearOk})`);
            });
        }
        return [];
    }

    console.log(`[RARBG] 📋 Outputting ${filtered.length} valid results`);

    // Ordina per seeders e limita
    const toProcess = filtered
        .sort((a, b) => b.seeders - a.seeders)
        .slice(0, RARBG_CONFIG.MAX_DETAIL_REQUESTS);

    // Estrai magnet links in parallelo (con limite concorrenza)
    const limit = pLimitSimple(RARBG_CONFIG.CONCURRENCY);

    const results = await Promise.all(
        toProcess.map(candidate => limit(async () => {
            const magnet = await extractMagnet(candidate.detailUrl, workingMirror, options.timeout);

            if (!magnet) {
                console.log(`[RARBG] ⚠️ No magnet for: ${candidate.name.substring(0, 50)}...`);
                return null;
            }

            return {
                title: candidate.name,
                magnet: enrichMagnet(magnet),
                size: candidate.size,
                sizeBytes: candidate.sizeBytes,
                seeders: candidate.seeders,
                source: "RARBG"
            };
        }))
    );

    const finalResults = results.filter(Boolean);

    // Deduplicazione per hash
    const seenHashes = new Set();
    const uniqueResults = finalResults.filter(r => {
        const hashMatch = r.magnet.match(/btih:([a-f0-9]{40})/i);
        const hash = hashMatch ? hashMatch[1].toLowerCase() : null;
        if (hash && seenHashes.has(hash)) return false;
        if (hash) seenHashes.add(hash);
        return true;
    });

    console.log(`[RARBG] ✅ Final: ${uniqueResults.length} unique torrents`);

    // Log dettagliato
    uniqueResults.slice(0, 10).forEach((r, i) => {
        console.log(`   ${i + 1}. [${r.size}] S:${r.seeders} | ${r.title.substring(0, 60)}...`);
    });

    return uniqueResults;
}

// ============================================
// UTILITY EXPORTS
// ============================================

/**
 * Aggiorna la lista dei mirrors (per uso futuro)
 */
function setMirrors(mirrors) {
    if (Array.isArray(mirrors) && mirrors.length > 0) {
        RARBG_CONFIG.MIRRORS = mirrors;
    }
}

/**
 * Ottieni configurazione corrente
 */
function getConfig() {
    return { ...RARBG_CONFIG };
}

/**
 * Testa quale mirror è attualmente funzionante
 */
async function testMirrors() {
    const results = [];

    for (const mirror of RARBG_CONFIG.MIRRORS) {
        const start = Date.now();
        try {
            const response = await stealthRequest(mirror, { timeout: 5000 });
            const elapsed = Date.now() - start;
            const working = response.data && response.data.length > 1000 && !response.error;
            results.push({
                mirror,
                status: working ? 'OK' : 'FAIL',
                time: elapsed + 'ms'
            });
        } catch (e) {
            results.push({ mirror, status: 'ERROR', error: e.message });
        }
    }

    return results;
}

// ============================================
// MODULE EXPORTS
// ============================================

module.exports = {
    searchRARBG,
    setMirrors,
    getConfig,
    testMirrors,
    RARBG_CONFIG,

    // Export utilities per uso esterno
    utils: {
        cleanTitle,
        parseSize,
        bytesToSize,
        isValidResult,
        checkYear,
        isCorrectFormat,
        parseImdbId,
        stealthRequest
    }
};
