/**
 * ICV Custom Formatter Module
 * 
 * Template parser per personalizzare nome e descrizione degli stream.
 * 
 * ============================================================================
 * CREDITS & LICENSE
 * ============================================================================
 * 
 * The custom formatter code in this file was adapted from:
 * https://github.com/Viren070/AIOStreams
 * 
 * AIOStreams - One addon to rule them all
 * Copyright (c) 2024 Viren070
 * Licensed under the MIT License
 * 
 * The original template parsing logic was adapted from:
 * https://github.com/diced/zipline/blob/trunk/src/lib/parser/index.ts
 * 
 * Copyright (c) 2023 dicedtomato
 * Licensed under the MIT License
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * ============================================================================
 */

// ============================================
// UTILITY FUNCTIONS
// ============================================

function formatBytes(bytes, base = 1000, round = false) {
    if (!bytes || bytes === 0) return '0 B';
    const sizes = base === 1024 ? ['B', 'KiB', 'MiB', 'GiB', 'TiB'] : ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(base));
    const value = bytes / Math.pow(base, i);
    return (round ? Math.round(value) : value.toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '0:00';
    seconds = Math.floor(seconds);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatHours(hours) {
    if (!hours) return null;
    if (hours < 1) return `${Math.round(hours * 60)}m`;
    if (hours < 24) return `${Math.round(hours)}h`;
    if (hours < 24 * 7) return `${Math.round(hours / 24)}d`;
    if (hours < 24 * 30) return `${Math.round(hours / (24 * 7))}w`;
    if (hours < 24 * 365) return `${Math.round(hours / (24 * 30))}mo`;
    return `${Math.round(hours / (24 * 365))}y`;
}

// Small caps mapping (from AIOStreams) - Uses mathematical monospace digits
const SMALL_CAPS_MAP = {
    A: 'ᴀ', B: 'ʙ', C: 'ᴄ', D: 'ᴅ', E: 'ᴇ', F: 'ꜰ', G: 'ɢ', H: 'ʜ', I: 'ɪ',
    J: 'ᴊ', K: 'ᴋ', L: 'ʟ', M: 'ᴍ', N: 'ɴ', O: 'ᴏ', P: 'ᴘ', Q: 'ǫ', R: 'ʀ',
    S: 'ꜱ', T: 'ᴛ', U: 'ᴜ', V: 'ᴠ', W: 'ᴡ', X: '𝘅', Y: 'ʏ', Z: 'ᴢ',
    // Mathematical Monospace Digits (same as AIOStreams)
    '0': '𝟢', '1': '𝟣', '2': '𝟤', '3': '𝟥', '4': '𝟦',
    '5': '𝟧', '6': '𝟨', '7': '𝟩', '8': '𝟪', '9': '𝟫'
};

function makeSmall(str) {
    return String(str).split('').map(char => SMALL_CAPS_MAP[char.toUpperCase()] || char).join('');
}

// Language to emoji mapping (from AIOStreams, adapted from g0ldy/comet)
const languageEmojiMap = {
    multi: '🌎', english: '🇬🇧', japanese: '🇯🇵', chinese: '🇨🇳', russian: '🇷🇺',
    arabic: '🇸🇦', portuguese: '🇵🇹', spanish: '🇪🇸', french: '🇫🇷', german: '🇩🇪',
    italian: '🇮🇹', korean: '🇰🇷', hindi: '🇮🇳', bengali: '🇧🇩', punjabi: '🇵🇰',
    marathi: '🇮🇳', gujarati: '🇮🇳', tamil: '🇮🇳', telugu: '🇮🇳', kannada: '🇮🇳',
    malayalam: '🇮🇳', thai: '🇹🇭', vietnamese: '🇻🇳', indonesian: '🇮🇩', turkish: '🇹🇷',
    hebrew: '🇮🇱', persian: '🇮🇷', ukrainian: '🇺🇦', greek: '🇬🇷', lithuanian: '🇱🇹',
    latvian: '🇱🇻', estonian: '🇪🇪', polish: '🇵🇱', czech: '🇨🇿', slovak: '🇸🇰',
    hungarian: '🇭🇺', romanian: '🇷🇴', bulgarian: '🇧🇬', serbian: '🇷🇸', croatian: '🇭🇷',
    slovenian: '🇸🇮', dutch: '🇳🇱', danish: '🇩🇰', finnish: '🇫🇮', swedish: '🇸🇪',
    norwegian: '🇳🇴', malay: '🇲🇾', latino: '💃🏻', Latino: '🇲🇽',
    // Common abbreviations
    ita: '🇮🇹', eng: '🇬🇧', spa: '🇪🇸', fre: '🇫🇷', ger: '🇩🇪', rus: '🇷🇺',
    por: '🇵🇹', jpn: '🇯🇵', kor: '🇰🇷', chi: '🇨🇳', ara: '🇸🇦', hin: '🇮🇳'
};

function languageToEmoji(language) {
    if (!language) return undefined;
    return languageEmojiMap[language.toLowerCase()];
}

// ============================================
// STRING MODIFIERS (from AIOStreams)
// ============================================

const stringModifiers = {
    upper: (value) => String(value).toUpperCase(),
    lower: (value) => String(value).toLowerCase(),
    title: (value) => String(value).split(' ')
        .map(word => word.toLowerCase())
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' '),
    small: (value) => makeSmall(String(value)),
    length: (value) => String(value).length.toString(),
    reverse: (value) => String(value).split('').reverse().join(''),
    base64: (value) => Buffer.from(String(value)).toString('base64'),
    string: (value) => String(value),
};

// ============================================
// ARRAY MODIFIERS (from AIOStreams)
// ============================================

const arrayModifiers = {
    join: (value) => Array.isArray(value) ? value.join(', ') : value,
    length: (value) => Array.isArray(value) ? value.length.toString() : '0',
    first: (value) => Array.isArray(value) && value.length > 0 ? String(value[0]) : '',
    last: (value) => Array.isArray(value) && value.length > 0 ? String(value[value.length - 1]) : '',
    random: (value) => Array.isArray(value) && value.length > 0 ? String(value[Math.floor(Math.random() * value.length)]) : '',
    sort: (value) => Array.isArray(value) ? [...value].sort() : value,
    reverse: (value) => Array.isArray(value) ? [...value].reverse() : value,
};

// ============================================
// NUMBER MODIFIERS (from AIOStreams)
// ============================================

const numberModifiers = {
    comma: (value) => Number(value).toLocaleString(),
    hex: (value) => Number(value).toString(16),
    octal: (value) => Number(value).toString(8),
    binary: (value) => Number(value).toString(2),
    bytes: (value) => formatBytes(Number(value), 1000, false),
    rbytes: (value) => formatBytes(Number(value), 1000, true),
    bytes10: (value) => formatBytes(Number(value), 1000, false),
    rbytes10: (value) => formatBytes(Number(value), 1000, true),
    bytes2: (value) => formatBytes(Number(value), 1024, false),
    rbytes2: (value) => formatBytes(Number(value), 1024, true),
    string: (value) => String(value),
    time: (value) => formatDuration(Number(value)),
};

// ============================================
// CONDITIONAL MODIFIERS (from AIOStreams)
// ============================================

const conditionalModifiers = {
    exact: {
        istrue: (value) => value === true,
        isfalse: (value) => value === false,
        exists: (value) => {
            if (value === undefined || value === null) return false;
            if (typeof value === 'string') return /\S/.test(value);
            if (Array.isArray(value)) return value.length > 0;
            return true;
        },
    },
    prefix: {
        '$': (value, check) => String(value).toLowerCase().startsWith(check.toLowerCase()),
        '^': (value, check) => String(value).toLowerCase().endsWith(check.toLowerCase()),
        '~': (value, check) => String(value).toLowerCase().includes(check.toLowerCase()),
        '=': (value, check) => String(value).toLowerCase() === check.toLowerCase(),
        '>=': (value, check) => Number(value) >= Number(check),
        '>': (value, check) => Number(value) > Number(check),
        '<=': (value, check) => Number(value) <= Number(check),
        '<': (value, check) => Number(value) < Number(check),
    },
};

// ============================================
// COMPARATORS (from AIOStreams)
// ============================================

const comparatorFuncs = {
    and: (v1, v2) => v1 && v2,
    or: (v1, v2) => v1 || v2,
    xor: (v1, v2) => (v1 || v2) && !(v1 && v2),
    neq: (v1, v2) => v1 !== v2,
    equal: (v1, v2) => v1 === v2,
    left: (v1, _) => v1,
    right: (_, v2) => v2,
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function getNestedValue(data, path) {
    if (!path) return undefined;
    const [namespace, property] = path.split('.');
    if (!namespace || !property) return undefined;
    const section = data[namespace];
    if (!section || typeof section !== 'object') return undefined;
    return section[property];
}

function applySingleModifier(value, mod, originalMod) {
    if (value === undefined || value === null) return undefined;

    const modLower = mod.toLowerCase();

    // Check conditional modifiers first
    const isExact = Object.keys(conditionalModifiers.exact).includes(modLower);
    const prefixMatch = Object.keys(conditionalModifiers.prefix)
        .sort((a, b) => b.length - a.length)
        .find(key => modLower.startsWith(key));

    if (isExact) {
        if (!conditionalModifiers.exact.exists(value)) return false;
        return conditionalModifiers.exact[modLower](value);
    }

    if (prefixMatch) {
        if (!conditionalModifiers.exact.exists(value)) return false;
        const checkValue = mod.substring(prefixMatch.length);
        const stringValue = String(value).toLowerCase();
        let stringCheck = checkValue.toLowerCase();
        if (!/\s/.test(stringValue)) stringCheck = stringCheck.replace(/\s/g, '');

        // Numeric comparison for >, <, >=, <=, =
        if (['<', '<=', '>', '>=', '='].includes(prefixMatch)) {
            const numValue = Number(String(value).replace(/,\s/g, ''));
            const numCheck = Number(stringCheck.replace(/,\s/g, ''));
            if (!isNaN(numValue) && !isNaN(numCheck)) {
                return conditionalModifiers.prefix[prefixMatch](numValue, numCheck);
            }
        }
        return conditionalModifiers.prefix[prefixMatch](stringValue, stringCheck);
    }

    // String modifiers
    if (typeof value === 'string') {
        if (modLower in stringModifiers) return stringModifiers[modLower](value);

        // replace('find', 'replace')
        if (modLower.startsWith('replace(') && modLower.endsWith(')')) {
            const content = originalMod.substring(8, originalMod.length - 1);
            const quoteChar = content.charAt(0);
            const parts = content.split(new RegExp(`${quoteChar}\\s*,\\s*${quoteChar}`));
            if (parts.length === 2) {
                const find = parts[0].substring(1);
                const replace = parts[1].substring(0, parts[1].length - 1);
                return value.split(find).join(replace);
            }
        }

        // truncate(N)
        if (modLower.startsWith('truncate(') && modLower.endsWith(')')) {
            const n = parseInt(originalMod.substring(9, originalMod.length - 1));
            if (!isNaN(n) && n >= 0) {
                if (value.length > n) return value.slice(0, n).replace(/\s+$/, '') + '…';
                return value;
            }
        }
    }

    // Array modifiers
    if (Array.isArray(value)) {
        if (modLower in arrayModifiers) return arrayModifiers[modLower](value);

        // join('separator')
        if (modLower.startsWith('join(') && modLower.endsWith(')')) {
            const separator = originalMod.substring(6, originalMod.length - 2);
            return value.join(separator);
        }
    }

    // Number modifiers
    if (typeof value === 'number') {
        if (modLower in numberModifiers) return numberModifiers[modLower](value);
    }

    return undefined;
}

// ============================================
// MAIN PARSER (AIOStreams-compatible)
// ============================================

function parseTemplate(template, data, maxDepth = 10) {
    if (!template || maxDepth <= 0) return template || '';

    // Handle {tools.*}
    template = template.replace(/\{tools\.newLine\}/g, '\n');

    let result = template;
    let lastResult = null;
    let iterations = 0;

    while (result !== lastResult && iterations < maxDepth) {
        lastResult = result;
        iterations++;

        // Match: {var.prop::mod1::mod2...["true"||"false"]}
        const regex = /\{([a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*)([^[\]{}]*?)(?:\["([^"]*)"\|\|"([^"]*)"\])?\}/g;

        let match;
        const replacements = [];

        while ((match = regex.exec(result)) !== null) {
            const fullMatch = match[0];
            const varPath = match[1];
            const modifierString = match[2] || '';
            const trueValue = match[3];
            const falseValue = match[4];

            const replacement = resolveVariable(varPath, modifierString, trueValue, falseValue, data, maxDepth - 1);
            replacements.push({ fullMatch, replacement, index: match.index });
        }

        // Apply replacements in reverse order
        for (let i = replacements.length - 1; i >= 0; i--) {
            const { fullMatch, replacement, index } = replacements[i];
            result = result.slice(0, index) + replacement + result.slice(index + fullMatch.length);
        }
    }

    // Final cleanup
    result = result.split('\n')
        .filter(line => line.trim() !== '' && !line.includes('{tools.removeLine}'))
        .join('\n')
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim();

    return result;
}

function resolveVariable(varPath, modifierString, trueValue, falseValue, data, maxDepth) {
    // Split modifiers, handling comparators (::and::, ::or::, etc.)
    const comparatorRegex = /::(and|or|xor|neq|equal|left|right)::/gi;
    const segments = modifierString.split(comparatorRegex).filter(s => s);

    // Build list of variable+modifiers and comparators
    const variableExpressions = [];
    const comparators = [];

    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i].toLowerCase();
        if (Object.keys(comparatorFuncs).includes(seg)) {
            comparators.push(seg);
        } else {
            variableExpressions.push(segments[i]);
        }
    }

    // If no expressions, use the main variable path
    if (variableExpressions.length === 0) {
        variableExpressions.push('');
    }

    // Resolve each variable expression
    const resolvedValues = variableExpressions.map((expr, idx) => {
        let currentVarPath = varPath;
        let mods = expr;

        // Check if expression starts with a new variable path
        if (idx > 0 && expr.match(/^[a-zA-Z_]+\.[a-zA-Z_]+/)) {
            const pathMatch = expr.match(/^([a-zA-Z_]+\.[a-zA-Z_]+)(.*)/);
            if (pathMatch) {
                currentVarPath = pathMatch[1];
                mods = pathMatch[2];
            }
        }

        let value = getNestedValue(data, currentVarPath);

        // Apply modifiers
        const modList = mods.split('::').filter(m => m);
        for (const mod of modList) {
            const newValue = applySingleModifier(value, mod, mod);
            if (newValue === undefined) {
                // If modifier failed but we need a boolean, treat as error
                if (typeof value === 'boolean') return value;
                return undefined;
            }
            value = newValue;
        }

        return value;
    });

    // Apply comparators between resolved values
    let finalResult = resolvedValues[0];
    for (let i = 0; i < comparators.length; i++) {
        const comparator = comparators[i];
        const nextValue = resolvedValues[i + 1];

        if (comparatorFuncs[comparator]) {
            finalResult = comparatorFuncs[comparator](finalResult, nextValue);
        }
    }

    // Handle check ["true"||"false"]
    if (trueValue !== undefined) {
        const boolResult = Boolean(finalResult);
        const output = boolResult ? trueValue : (falseValue || '');
        return parseTemplate(output, data, maxDepth);
    }

    // Return value as string
    if (Array.isArray(finalResult)) return finalResult.join(', ');
    return finalResult ?? '';
}

// ============================================
// PRESET TEMPLATES
// ============================================

const PRESET_TEMPLATES = {
    default: {
        name: `{service.shortName::exists["[{service.shortName}] "||""]}📺 {stream.title}`,
        description: `{stream.quality} | 💾 {stream.size::bytes} | 👤 {stream.seeders} seeders`
    },
    torrentio: {
        name: `{service.shortName::exists["[{service.shortName}"||""]}{service.cached::istrue["+]"||"]"]} ICV {stream.quality}`,
        description: `{stream.filename}
💾 {stream.size::bytes} {stream.packSize::>0["/ 📦 {stream.packSize::bytes}"||""]} 👤 {stream.seeders}
{stream.languageEmojis::join(' ')}`
    },
    minimal: {
        name: `{stream.quality} {stream.codec}`,
        description: `{stream.size::bytes} • {stream.seeders} seeds`
    },
    verbose: {
        name: `{service.cached::istrue["⚡"||"⏳"]} [{service.shortName}] {stream.quality} {stream.codec}`,
        description: `📁 {stream.filename}
💾 Ep: {stream.size::bytes}{stream.packSize::>0[" / Pack: {stream.packSize::bytes}"||""]}
👤 {stream.seeders} • 🎬 {stream.source} • 🔊 {stream.audio}
🌍 {stream.languages::join(' | ')}`
    },
    italiano: {
        name: `{service.cached::istrue["⚡"||"⏳"]} {service.shortName::exists["[{service.shortName}]"||""]} {stream.quality} {stream.codec}`,
        description: `📺 {stream.title}
📁 {stream.filename}
💾 {stream.size::bytes}{stream.isPack::istrue[" (Pack: {stream.packSize::bytes})"||""]}
🌍 {stream.languageEmojis::join(' ')} | 👤 {stream.seeders} | ⏰ {stream.age}
🎬 {stream.source} | 🔊 {stream.audio} | 🏷️ {stream.releaseGroup::exists["{stream.releaseGroup}"||"N/A"]}`
    },
    fra: {
        name: `{service.cached::istrue["⚡️"||"⏳"]} {addon.name} {stream.quality::=1080p["FHD"||""]}{stream.quality::=720p["HD"||""]}{stream.quality::=2160p["4K"||""]}{stream.quality::exists[""||"UNK"]}`,
        description: `📄 ❯ {stream.filename}
{stream.languages::exists["🌎 ❯ {stream.languages::join(' • ')}"||""]}
✨ ❯ {service.shortName::exists["{service.shortName}"||""]}{stream.releaseGroup::exists[" • {stream.releaseGroup}"||""]}{stream.indexer::exists[" • {stream.indexer}"||""]}
{stream.quality::exists["🔥 ❯ {stream.quality}"||""]}{stream.visualTags::exists[" • {stream.visualTags::join(' • ')}"||""]}
{stream.size::>0["💾 ❯ {stream.size::bytes}"||""]}{service.cached::isfalse[" / 👥 ❯ {stream.seeders}"||""]}
{stream.audioTags::exists["🔉 ❯ {stream.audioTags::join(' • ')}"||""]}`
    },
    dav: {
        name: `{stream.resolution::~2160::or::stream.resolution::~4k::or::stream.resolution::~uhd["🔥4K UHD"||""]}{stream.resolution::~1080::or::stream.resolution::~fhd["🚀 FHD"||""]}{stream.resolution::~720::or::stream.resolution::~hd["💿 HD"||""]}{stream.resolution::exists::isfalse["💩 Unknown"||""]}`,
        description: `{stream.quality::exists["🎥 {stream.quality} "||""]}{stream.visualTags::exists["📺 {stream.visualTags::join(' | ')} "||""]}{stream.codec::exists["🎞️ {stream.codec} "||""]}
{stream.audioTags::exists["🎧 {stream.audioTags::join(' | ')} "||""]}{stream.languageEmojis::exists["🗣️ {stream.languageEmojis::join(' / ')}"||""]}
{stream.size::>0["📦 {stream.size::bytes} "||""]}{stream.packSize::>0["/ 📦 {stream.packSize::bytes} "||""]}{stream.seeders::>0["👥 {stream.seeders} "||""]}{stream.releaseGroup::exists["🏷️ {stream.releaseGroup} "||""]}
{service.cached::istrue["⚡"||"⏳"]}{service.shortName::exists["{service.shortName} "||""]}🔍{addon.name}
📄 {stream.folderName::exists["{stream.folderName}/"||""]}{stream.filename}`
    },
    and: {
        name: `{stream.title::exists["🎬 {stream.title}"||""]} S{stream.season}E{stream.episode}`,
        description: `{stream.quality} {service.cached::istrue["/⚡"||"/⏳"]}
─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
{stream.languageEmojis::exists["Lingue: {stream.languageEmojis::join(' | ')}"||""]}
Specifiche: {stream.quality}{stream.visualTags::exists[" | 📺 {stream.visualTags::join(' ')}"||""]}{stream.audioTags::exists[" | 🔊 {stream.audioTags::join(', ')}"||""]}
─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
📂 {stream.size::>0["{stream.size::bytes}"||""]}{service.name::exists[" | ☁️ {service.name}"||""]}{addon.name::exists[" | 🛰️ {addon.name}"||""]}`
    },
    lad: {
        name: `{stream.resolution::~2160::or::stream.resolution::~4k::or::stream.resolution::~uhd["🖥️ 4K"||""]}{stream.resolution::~1080::or::stream.resolution::~fhd["🖥️ 1080p"||""]}{stream.resolution::~720::or::stream.resolution::~hd["🖥️ 720p"||""]}{stream.resolution::exists::isfalse["🖥️ Unknown"||""]}`,
        description: `{stream.title::exists["🎟️ {stream.title}"||""]}
📜 S{stream.season}E{stream.episode}
{stream.quality::exists["🎥 {stream.quality} "||""]}{stream.codec::exists["🎞️ {stream.codec} "||""]}{stream.audioTags::exists["🎧 {stream.audioTags::join(' | ')}"||""]}
{stream.size::>0["📦 {stream.size::bytes}"||""]}
🔗 {addon.name}
{stream.languageEmojis::exists["🌐 {stream.languageEmojis::join(' ')}"||""]}`
    },
    pri: {
        name: `{service.shortName::exists["[{service.shortName}"||""]}{service.cached::istrue["⚡️"||"❌️"]}{service.shortName::exists["☁️]"||""]}
{stream.resolution::~2160::or::stream.resolution::~4k::or::stream.resolution::~uhd["4K🔥UHD"||""]}{stream.resolution::~1440::or::stream.resolution::~2k::or::stream.resolution::~qhd["2K✨QHD"||""]}{stream.resolution::~1080::or::stream.resolution::~fhd["FHD🚀1080p"||""]}{stream.resolution::~720::or::stream.resolution::~hd["HD💿720p"||""]}{stream.resolution::~480::or::stream.resolution::~sd["SD📺"||""]}{stream.resolution::exists::isfalse["Unknown💩"||""]}
[{addon.name}]`,
        description: `🎬 {stream.title::title} {stream.year::exists["({stream.year}) "||""]}{stream.formattedSeasons::exists["{stream.formattedSeasons}"||""]}{stream.formattedEpisodes::exists["{stream.formattedEpisodes}"||""]}
{stream.quality::~Remux["💎 ʀᴇᴍᴜx"||""]}{stream.quality::~BluRay["📀 ʙʟᴜʀᴀʏ"||""]}{stream.quality::~WEB-DL["🖥 ᴡᴇʙ-ᴅʟ"||""]}{stream.quality::~WEBRip["💻 ᴡᴇʙʀɪᴘ"||""]}{stream.quality::~HDTV["📺 ʜᴅᴛᴠ"||""]}{stream.quality::~DVDRip["💿 ᴅᴠᴅʀɪᴘ"||""]}{stream.encode::exists[" | 🎞️ {stream.encode::small}"||""]}{stream.visualTags::exists[" | 🔆 {stream.visualTags::join(' | ')}"||""]}
{stream.audioTags::exists["🎧 {stream.audioTags::join(' | ')}"||""]}{stream.audioChannels::exists[" | 🔊{stream.audioChannels::first}"||""]}{stream.languageEmojis::exists[" | 🗣️ {stream.languageEmojis::join(' / ')}"||""]}
{stream.size::>0["📁 {stream.size::bytes}"||""]}{stream.releaseGroup::exists["  | 🏷️ {stream.releaseGroup}"||""]}{stream.duration::>0[" | ⏱️ {stream.duration::time}"||""]}
📄 ▶️{stream.filename::replace('.',' ')::small}◀️`
    }
};

// ============================================
// EXPORTS
// ============================================

module.exports = {
    parseTemplate,
    formatBytes,
    formatDuration,
    formatHours,
    makeSmall,
    languageToEmoji,
    languageEmojiMap,
    SMALL_CAPS_MAP,
    PRESET_TEMPLATES,
    // Export for testing/advanced use
    stringModifiers,
    arrayModifiers,
    numberModifiers,
    conditionalModifiers,
    comparatorFuncs,
};
