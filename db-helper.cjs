const { Pool } = require('pg');

// ✅ VERBOSE LOGGING - configurabile via ENV
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

// =====================================================
// PROVIDER PRIORITY (single source of truth)
// Lower number = higher priority
// =====================================================
const PROVIDER_PRIORITY_MAP = {
  custom: 0,  // ✅ Never overwrite manual imports (Custom)
  torrentio: 1,
  mediafusion: 2,
  corsaro: 3,
  comet: 4,
  'pack-handler': 50,  // ✅ Very low priority - any real provider should overwrite
  rd_cache: 99,
  tb_cache: 99
};
const PROVIDER_PRIORITY_DEFAULT = 10;

/**
 * Get priority number for a provider string.
 * Lower = better. Used in JS code (insertTorrent, dedup, etc.)
 * @param {string} provider
 * @returns {number}
 */
function getProviderPriority(provider) {
  if (!provider) return PROVIDER_PRIORITY_DEFAULT;
  const lp = provider.toLowerCase();
  for (const [key, priority] of Object.entries(PROVIDER_PRIORITY_MAP)) {
    if (lp.includes(key) || lp === key) return priority;
  }
  return PROVIDER_PRIORITY_DEFAULT;
}

/**
 * Generate SQL CASE WHEN expression for provider priority.
 * @param {string} columnRef - e.g. 'EXCLUDED.provider' or 'torrents.provider'
 * @returns {string} SQL CASE expression
 */
function providerPrioritySQL(columnRef) {
  return `CASE
                WHEN ${columnRef} ILIKE '%Custom%' THEN 0
                WHEN ${columnRef} ILIKE '%torrentio%' THEN 1
                WHEN ${columnRef} ILIKE '%mediafusion%' THEN 2
                WHEN ${columnRef} ILIKE '%corsaro%' THEN 3
                WHEN ${columnRef} ILIKE '%comet%' THEN 4
                WHEN ${columnRef} = 'pack-handler' THEN 50
                WHEN ${columnRef} IN ('rd_cache', 'tb_cache') THEN 99
                ELSE 10
              END`;
}

// Database connection pool
let pool = null;

/**
 * Initialize PostgreSQL connection pool
 * @param {Object} config - Database configuration
 * @returns {Pool} PostgreSQL pool instance
 */
function initDatabase(config = {}) {
  if (pool) return pool;

  // ✅ Support both DATABASE_URL and separate environment variables
  const poolConfig = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
      host: config.host || process.env.DB_HOST,
      port: config.port || process.env.DB_PORT,
      database: config.database || process.env.DB_NAME,
      user: config.user || process.env.DB_USER,
      password: config.password || process.env.DB_PASSWORD,
    };

  pool = new Pool({
    ...poolConfig,
    max: 10,                        // ✅ Reduced from 20 to 10 (multiple addons share this DB)
    idleTimeoutMillis: 15000,       // ✅ Reduced from 30s to 15s (free connections faster)
    connectionTimeoutMillis: 5000,  // Vercel timeout-friendly
  });

  pool.on('error', (err) => {
    console.error('❌ Unexpected PostgreSQL error:', err);
  });

  console.log('✅ PostgreSQL Pool initialized');

  return pool;
}

/**
 * Search torrents by IMDb ID
 * @param {string} imdbId - IMDb ID (e.g., "tt0111161")
 * @param {string} type - Media type: 'movie' or 'series'
 * @param {Array<string>} providers - Optional array of provider names to filter by
 * @returns {Promise<Array>} Array of torrent objects
 */
async function searchByImdbId(imdbId, type = null, providers = null) {
  if (!pool) throw new Error('Database not initialized');

  try {
    if (DEBUG_MODE) console.log(`💾 [DB] Searching by IMDb: ${imdbId}${type ? ` (${type})` : ''}${providers ? ` [providers: ${providers.join(',')}]` : ''}`);

    let query = `
      SELECT
        info_hash,
        provider,
        title,
        size,
        type,
        seeders,
        imdb_id,
        tmdb_id,
        cached_rd,
        last_cached_check,
        cached_tb,
        last_cached_check_tb,
        file_index,
        file_title,
        is_torrent_pack
      FROM torrents
      WHERE imdb_id = $1
    `;

    const params = [imdbId];
    let paramIndex = 2;

    // ✅ FIX: Include 'unknown' type to catch RD cache torrents that don't have type set
    if (type) {
      query += ` AND (type = $${paramIndex} OR type = 'unknown')`;
      params.push(type);
      paramIndex++;
    }

    // ✅ PROVIDER FILTER: Only return torrents from selected providers
    // Use ILIKE patterns for case-insensitive matching and variants (e.g., 'Knaben (1337x)')
    if (providers && Array.isArray(providers) && providers.length > 0) {
      const patterns = providers.map((p, i) => `provider ILIKE $${paramIndex + i}`).join(' OR ');
      // 🚀 CUSTOM, CUSTOM MANUAL & VIP: Always include these providers regardless of filter
      query += ` AND (${patterns} OR provider = 'Custom' OR provider = 'Custom Manual' OR provider = 'vip')`;
      // Add % wildcards for partial matching (e.g., 'knaben' matches 'Knaben (1337x)')
      params.push(...providers.map(p => `%${p}%`));
    }

    query += ' ORDER BY cached_rd DESC NULLS LAST, seeders DESC LIMIT 50';

    const result = await pool.query(query, params);
    if (DEBUG_MODE) console.log(`💾 [DB] Found ${result.rows.length} torrents for IMDb ${imdbId}`);

    return result.rows;
  } catch (error) {
    console.error(`❌ [DB] Error searching by IMDb:`, error.message);
    return [];
  }
}

/**
 * Search torrents by TMDb ID
 * @param {number} tmdbId - TMDb ID (e.g., 550)
 * @param {string} type - Media type: 'movie' or 'series'
 * @param {Array<string>} providers - Optional array of provider names to filter by
 * @returns {Promise<Array>} Array of torrent objects
 */
async function searchByTmdbId(tmdbId, type = null, providers = null) {
  if (!pool) throw new Error('Database not initialized');

  try {
    if (DEBUG_MODE) console.log(`💾 [DB] Searching by TMDb: ${tmdbId}${type ? ` (${type})` : ''}${providers ? ` [providers: ${providers.join(',')}]` : ''}`);

    let query = `
      SELECT
        info_hash,
        provider,
        title,
        size,
        type,
        seeders,
        imdb_id,
        tmdb_id,
        cached_rd,
        last_cached_check,
        cached_tb,
        last_cached_check_tb,
        file_index,
        file_title,
        is_torrent_pack
      FROM torrents
      WHERE tmdb_id = $1
    `;

    const params = [tmdbId];
    let paramIndex = 2;

    if (type) {
      query += ` AND type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    // ✅ PROVIDER FILTER: Only return torrents from selected providers
    // Use ILIKE patterns for case-insensitive matching and variants (e.g., 'Knaben (1337x)')
    if (providers && Array.isArray(providers) && providers.length > 0) {
      const patterns = providers.map((p, i) => `provider ILIKE $${paramIndex + i}`).join(' OR ');
      // 🚀 CUSTOM, CUSTOM MANUAL & VIP: Always include these providers regardless of filter
      query += ` AND (${patterns} OR provider = 'Custom' OR provider = 'Custom Manual' OR provider = 'vip')`;
      params.push(...providers.map(p => `%${p}%`));
    }

    query += ' ORDER BY cached_rd DESC NULLS LAST, seeders DESC LIMIT 50';

    const result = await pool.query(query, params);
    if (DEBUG_MODE) console.log(`💾 [DB] Found ${result.rows.length} torrents for TMDb ${tmdbId}`);

    return result.rows;
  } catch (error) {
    console.error(`❌ [DB] Error searching by TMDb:`, error.message);
    return [];
  }
}

/**
 * Search episode files by IMDb ID, season, and episode
 * @param {string} imdbId - IMDb ID of the series
 * @param {number} season - Season number
 * @param {number} episode - Episode number
 * @param {Array<string>} providers - Optional array of provider names to filter by
 * @returns {Promise<Array>} Array of file objects with torrent info
 */
async function searchEpisodeFiles(imdbId, season, episode, providers = null) {
  if (!pool) throw new Error('Database not initialized');

  try {
    if (DEBUG_MODE) console.log(`💾 [DB] Searching episode: ${imdbId} S${season}E${episode}${providers ? ` [providers: ${providers.join(',')}]` : ''}`);

    let query = `
      SELECT
        f.file_index,
        f.title as file_title,
        f.size as file_size,
        f.rd_link_index,
        t.info_hash,
        t.provider,
        t.title as torrent_title,
        t.size as torrent_size,
        t.seeders,
        t.imdb_id,
        t.tmdb_id,
        t.cached_rd,
        t.last_cached_check,
        t.cached_tb,
        t.last_cached_check_tb,
        t.is_torrent_pack
      FROM files f
      JOIN torrents t ON f.info_hash = t.info_hash
      WHERE f.imdb_id = $1
        AND f.imdb_season = $2
        AND f.imdb_episode = $3
    `;

    const params = [imdbId, season, episode];

    // ✅ PROVIDER FILTER: Only return torrents from selected providers
    // Use ILIKE patterns for case-insensitive matching and variants (e.g., 'Knaben (1337x)')
    if (providers && Array.isArray(providers) && providers.length > 0) {
      const patterns = providers.map((p, i) => `t.provider ILIKE $${4 + i}`).join(' OR ');
      // 🚀 CUSTOM, CUSTOM MANUAL & VIP: Always include these providers regardless of filter
      query += ` AND (${patterns} OR t.provider = 'Custom' OR t.provider = 'Custom Manual' OR t.provider = 'vip')`;
      params.push(...providers.map(p => `%${p}%`));
    }

    query += `
      ORDER BY t.cached_rd DESC NULLS LAST, t.seeders DESC
      LIMIT 50
    `;

    const result = await pool.query(query, params);
    if (DEBUG_MODE) console.log(`💾 [DB] Found ${result.rows.length} files for S${season}E${episode}`);

    return result.rows;
  } catch (error) {
    console.error(`❌ [DB] Error searching episode files:`, error.message);
    return [];
  }
}

/**
 * Insert new torrent into database (or update size if exists with size=0)
 * @param {Object} torrent - Torrent data
 * @returns {Promise<boolean>} Success status
 */
async function insertTorrent(torrent) {
  if (!pool) throw new Error('Database not initialized');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if torrent exists (and get current size + provider)
    const checkResult = await client.query(
      'SELECT info_hash, size, title, provider FROM torrents WHERE info_hash = $1',
      [torrent.infoHash]
    );

    if (checkResult.rows.length > 0) {
      const existingSize = checkResult.rows[0].size;
      const existingTitle = checkResult.rows[0].title;
      const existingProvider = checkResult.rows[0].provider;
      const newSize = torrent.size || 0;

      // ✅ PROVIDER PRIORITY (uses shared getProviderPriority function)
      const existingPriority = getProviderPriority(existingProvider);
      const newPriority = getProviderPriority(torrent.provider);

      let updated = false;

      // Update title + provider if new provider has higher priority (lower number)
      if (newPriority < existingPriority) {
        await client.query(
          'UPDATE torrents SET title = $1, provider = $2 WHERE info_hash = $3',
          [torrent.title, torrent.provider, torrent.infoHash]
        );
        updated = true;
        if (DEBUG_MODE) console.log(`📦 [DB] Updated title by priority: "${existingTitle?.substring(0, 30)}..." -> "${torrent.title?.substring(0, 30)}..." (${existingProvider} -> ${torrent.provider})`);
      }

      // ✅ UPSERT: Update size if current is 0/NULL and new size is provided
      if ((!existingSize || existingSize === 0) && newSize > 0) {
        await client.query(
          'UPDATE torrents SET size = $1 WHERE info_hash = $2',
          [newSize, torrent.infoHash]
        );
        updated = true;
        console.log(`📏 [DB] Updated size for ${torrent.infoHash.substring(0, 8)}...: 0 -> ${(newSize / 1024 / 1024 / 1024).toFixed(2)} GB`);
      }

      if (updated) {
        await client.query('COMMIT');
        return true;
      }

      if (DEBUG_MODE) console.log(`💾 [DB] Torrent ${torrent.infoHash.substring(0, 8)}... already exists (size: ${(existingSize / 1024 / 1024 / 1024).toFixed(2)} GB), skipping`);
      await client.query('ROLLBACK');
      return false;
    }

    // Insert torrent
    await client.query(
      `INSERT INTO torrents (
        info_hash, provider, title, size, type,
        upload_date, seeders, imdb_id, tmdb_id, cached_tb, last_cached_check_tb
      ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9, $10)`,
      [
        torrent.infoHash,
        torrent.provider || 'ilcorsaronero',
        torrent.title,
        torrent.size || null,
        torrent.type,
        torrent.seeders || 0,
        torrent.imdbId || null,
        torrent.tmdbId || null,
        torrent.cached_tb || null,
        torrent.last_cached_check_tb || null
      ]
    );

    await client.query('COMMIT');
    if (DEBUG_MODE) console.log(`✅ [DB] Inserted torrent: ${torrent.title.substring(0, 60)}...`);
    return true;

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`❌ [DB] Error inserting torrent:`, error.message);
    return false;
  } finally {
    client.release();
  }
}

/**
 * Update RD cache status for multiple hashes
 * @param {Array} cacheResults - Array of {hash, cached} objects
 * @returns {Promise<number>} Number of updated records
 */
async function updateRdCacheStatus(cacheResults, mediaType = null) {
  if (!pool) throw new Error('Database not initialized');
  if (!cacheResults || cacheResults.length === 0) return 0;

  try {
    let updated = 0;
    let skipped = 0;

    // ✅ PRE-FILTER: Skip uncached items not in DB in a single batch query
    const allHashes = cacheResults.filter(r => r.hash).map(r => r.hash.toLowerCase());
    const existsResult = await pool.query(
      `SELECT info_hash FROM torrents WHERE info_hash = ANY($1)`,
      [allHashes]
    );
    const existingHashes = new Set(existsResult.rows.map(r => r.info_hash));

    // ✅ Filter items to process
    const itemsToProcess = [];
    for (const result of cacheResults) {
      if (!result.hash) continue;
      const hashLower = result.hash.toLowerCase();
      const cachedValue = result.cached === true ? true : (result.cached === false ? false : true);

      // Skip uncached items not in DB
      if (!existingHashes.has(hashLower) && cachedValue === false) {
        skipped++;
        continue;
      }

      itemsToProcess.push(result);
    }

    // ✅ BATCHED UPSERT: Process all items in a single query
    if (itemsToProcess.length > 0) {
      const values = [];
      const params = [];
      let paramIndex = 1;

      for (const result of itemsToProcess) {
        const hashLower = result.hash.toLowerCase();
        const realTitle = result.torrent_title || result.file_title || null;
        const cachedValue = result.cached === true ? true : (result.cached === false ? false : true);
        const torrentSize = result.size || result.file_size || null;
        const titleToSave = realTitle || 'PLACEHOLDER';

        values.push(`($${paramIndex}, 'rd_cache', $${paramIndex + 1}, $${paramIndex + 2}, NOW(), $${paramIndex + 3}, NOW(), $${paramIndex + 4}, $${paramIndex + 5})`);
        params.push(
          hashLower,                           // info_hash
          titleToSave,                         // title
          mediaType || 'unknown',              // type
          cachedValue,                         // cached_rd
          result.file_title || null,           // file_title
          torrentSize                          // size
        );
        paramIndex += 6;
      }

      const upsertQuery = `
        INSERT INTO torrents (
          info_hash, provider, title, type, upload_date,
          cached_rd, last_cached_check, file_title, size
        )
        VALUES ${values.join(', ')}
        ON CONFLICT (info_hash) DO UPDATE SET
          cached_rd = EXCLUDED.cached_rd,
          last_cached_check = NOW(),
          file_title = COALESCE(NULLIF(EXCLUDED.file_title, ''), torrents.file_title),
          size = COALESCE(EXCLUDED.size, torrents.size),
          title = CASE WHEN torrents.provider = 'rd_cache' THEN COALESCE(EXCLUDED.title, torrents.title) ELSE torrents.title END,
          type = CASE WHEN torrents.type = 'unknown' THEN COALESCE(EXCLUDED.type, torrents.type) ELSE torrents.type END
      `;

      const res = await pool.query(upsertQuery, params);
      updated = res.rowCount;
    }

    if (skipped > 0) {
      if (DEBUG_MODE) console.log(`⏭️  [DB] Skipped ${skipped} useless placeholder(s)`);
    }
    if (DEBUG_MODE) console.log(`✅ [DB] Updated RD cache status for ${updated} torrents`);
    return updated;

  } catch (error) {
    console.error(`❌ [DB] Error updating RD cache:`, error.message);
    return 0;
  }
}

/**
 * Update TB cache status for multiple hashes
 * @param {Array} cacheResults - Array of {hash, cached} objects
 * @returns {Promise<number>} Number of updated records
 */
async function updateTbCacheStatus(cacheResults, mediaType = null) {
  if (!pool) throw new Error('Database not initialized');
  if (!cacheResults || cacheResults.length === 0) return 0;

  try {
    let updated = 0;
    let skipped = 0;

    // ✅ PRE-FILTER: Batch check which hashes exist in DB
    const allHashes = cacheResults.filter(r => r.hash).map(r => r.hash.toLowerCase());
    const existsResult = await pool.query(
      `SELECT info_hash FROM torrents WHERE info_hash = ANY($1)`,
      [allHashes]
    );
    const existingHashes = new Set(existsResult.rows.map(r => r.info_hash));

    // ✅ Filter items to process
    const itemsToProcess = [];
    for (const result of cacheResults) {
      if (!result.hash) continue;
      const hashLower = result.hash.toLowerCase();
      const cachedValue = result.cached === true ? true : (result.cached === false ? false : true);

      if (!existingHashes.has(hashLower) && cachedValue === false) {
        skipped++;
        continue;
      }

      itemsToProcess.push(result);
    }

    // ✅ BATCHED UPSERT
    if (itemsToProcess.length > 0) {
      const values = [];
      const params = [];
      let paramIndex = 1;

      for (const result of itemsToProcess) {
        const hashLower = result.hash.toLowerCase();
        const realTitle = result.torrent_title || result.file_title || null;
        const cachedValue = result.cached === true ? true : (result.cached === false ? false : true);
        const torrentSize = result.size || result.file_size || null;
        const titleToSave = realTitle || 'PLACEHOLDER';

        values.push(`($${paramIndex}, 'tb_cache', $${paramIndex + 1}, $${paramIndex + 2}, NOW(), $${paramIndex + 3}, NOW(), $${paramIndex + 4}, $${paramIndex + 5})`);
        params.push(
          hashLower,                           // info_hash
          titleToSave,                         // title
          mediaType || 'unknown',              // type
          cachedValue,                         // cached_tb
          result.file_title || null,           // file_title
          torrentSize                          // size
        );
        paramIndex += 6;
      }

      const upsertQuery = `
        INSERT INTO torrents (
          info_hash, provider, title, type, upload_date,
          cached_tb, last_cached_check_tb, file_title, size
        )
        VALUES ${values.join(', ')}
        ON CONFLICT (info_hash) DO UPDATE SET
          cached_tb = EXCLUDED.cached_tb,
          last_cached_check_tb = NOW(),
          file_title = COALESCE(NULLIF(EXCLUDED.file_title, ''), torrents.file_title),
          size = COALESCE(EXCLUDED.size, torrents.size),
          title = CASE WHEN torrents.provider = 'tb_cache' THEN COALESCE(EXCLUDED.title, torrents.title) ELSE torrents.title END,
          type = CASE WHEN torrents.type = 'unknown' THEN COALESCE(EXCLUDED.type, torrents.type) ELSE torrents.type END
      `;

      const res = await pool.query(upsertQuery, params);
      updated = res.rowCount;
    }

    if (DEBUG_MODE) console.log(`✅ [DB] Updated TB cache status for ${updated} torrents`);
    return updated;

  } catch (error) {
    console.error(`❌ [DB] Error updating TB cache:`, error.message);
    return 0;
  }
}

/**
 * Get cached RD availability for hashes (within 10 days)
 * @param {Array} hashes - Array of info hashes
 * @returns {Promise<Object>} Map of hash -> {cached: boolean, lastCheck: Date}
 */
async function getRdCachedAvailability(hashes) {
  if (!pool) throw new Error('Database not initialized');
  if (!hashes || hashes.length === 0) return {};

  try {
    const lowerHashes = hashes.map(h => h.toLowerCase());

    // Get cached results that are less than 10 days old
    // ✅ NEW: Also fetch file_title for deduplication
    const query = `
      SELECT info_hash, cached_rd, last_cached_check, file_title, size
      FROM torrents
      WHERE info_hash = ANY($1)
        AND cached_rd IS NOT NULL
        AND last_cached_check IS NOT NULL
        AND last_cached_check > NOW() - INTERVAL '10 days'
    `;

    const result = await pool.query(query, [lowerHashes]);

    const cachedMap = {};
    result.rows.forEach(row => {
      cachedMap[row.info_hash] = {
        cached: row.cached_rd,
        lastCheck: row.last_cached_check,
        fromCache: true,
        file_title: row.file_title || null, // ✅ Include file_title
        size: row.size ? parseInt(row.size) : null
      };
    });

    if (DEBUG_MODE) console.log(`💾 [DB] Found ${result.rows.length}/${hashes.length} hashes with valid RD cache (< 10 days)`);

    // Debug: Show which hashes are cached
    const cachedTrue = result.rows.filter(r => r.cached_rd === true).length;
    const cachedFalse = result.rows.filter(r => r.cached_rd === false).length;
    if (DEBUG_MODE) console.log(`   📊 cached_rd=true: ${cachedTrue}, cached_rd=false: ${cachedFalse}`);

    return cachedMap;

  } catch (error) {
    console.error(`❌ [DB] Error getting RD cached availability:`, error.message);
    return {};
  }
}

/**
 * Get cached TB availability for hashes (within 10 days)
 * @param {Array} hashes - Array of info hashes
 * @returns {Promise<Object>} Map of hash -> {cached: boolean, lastCheck: Date}
 */
async function getTbCachedAvailability(hashes) {
  if (!pool) throw new Error('Database not initialized');
  if (!hashes || hashes.length === 0) return {};

  try {
    const lowerHashes = hashes.map(h => h.toLowerCase());

    const query = `
      SELECT info_hash, cached_tb, last_cached_check_tb, file_title, size
      FROM torrents
      WHERE info_hash = ANY($1)
        AND cached_tb IS NOT NULL
        AND last_cached_check_tb IS NOT NULL
        AND last_cached_check_tb > NOW() - INTERVAL '7 days'
    `;

    const result = await pool.query(query, [lowerHashes]);

    const cachedMap = {};
    result.rows.forEach(row => {
      cachedMap[row.info_hash] = {
        cached: row.cached_tb,
        lastCheck: row.last_cached_check_tb,
        fromCache: true,
        file_title: row.file_title || null,
        size: row.size ? parseInt(row.size) : null
      };
    });

    if (DEBUG_MODE) console.log(`💾 [DB] Found ${result.rows.length}/${hashes.length} hashes with valid TB cache (< 7 days)`);


    return cachedMap;

  } catch (error) {
    console.error(`❌ [DB] Error getting TB cached availability:`, error.message);
    return {};
  }
}

/**
 * Refresh RD cache timestamp when user plays a cached file
 * This extends the cache validity to 25 days total (NOW + 18 days + 7 day validity)
 * @param {string} infoHash - The torrent hash to refresh
 * @returns {Promise<boolean>} Success status
 */
async function refreshRdCacheTimestamp(infoHash) {
  if (!pool) return false;
  if (!infoHash) return false;

  try {
    const query = `
      UPDATE torrents
      SET last_cached_check = NOW() + INTERVAL '18 days'
      WHERE info_hash = $1 AND cached_rd = true
    `;
    const result = await pool.query(query, [infoHash.toLowerCase()]);

    if (result.rowCount > 0) {
      if (DEBUG_MODE) console.log(`🔄 [DB] Refreshed RD cache timestamp for ${infoHash.substring(0, 8)}... (+25 days total)`);
    }
    return result.rowCount > 0;
  } catch (error) {
    console.error(`❌ [DB] Error refreshing RD cache timestamp:`, error.message);
    return false;
  }
}

/**
 * Refresh TB cache timestamp when user plays a cached file
 * This extends the cache validity to 25 days total (NOW + 18 days + 7 day validity)
 * @param {string} infoHash - The torrent hash to refresh
 * @returns {Promise<boolean>} Success status
 */
async function refreshTbCacheTimestamp(infoHash) {
  if (!pool) return false;
  if (!infoHash) return false;

  try {
    const query = `
      UPDATE torrents
      SET last_cached_check_tb = NOW() + INTERVAL '18 days'
      WHERE info_hash = $1 AND cached_tb = true
    `;
    const result = await pool.query(query, [infoHash.toLowerCase()]);

    if (result.rowCount > 0) {
      if (DEBUG_MODE) console.log(`🔄 [DB] Refreshed TB cache timestamp for ${infoHash.substring(0, 8)}... (+25 days total)`);
    }
    return result.rowCount > 0;
  } catch (error) {
    console.error(`❌ [DB] Error refreshing TB cache timestamp:`, error.message);
    return false;
  }
}

/**
 * Close database connection
 */
async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('✅ PostgreSQL Pool closed');
  }
}

/**
 * Batch insert torrents into DB (skip duplicates)
 * @param {Array} torrents - Array of torrent objects
 * @returns {Promise<number>} Number of inserted torrents
 */
async function batchInsertTorrents(torrents) {
  if (!pool) throw new Error('Database not initialized');
  if (!torrents || torrents.length === 0) return 0;

  try {
    let inserted = 0;
    const BATCH_SIZE = 25; // 25 rows × 14 params = 350 params per query (well within PG limit)

    for (let i = 0; i < torrents.length; i += BATCH_SIZE) {
      const batch = torrents.slice(i, i + BATCH_SIZE);

      try {
        const COLS_PER_ROW = 14;
        const valuePlaceholders = [];
        const values = [];

        for (let j = 0; j < batch.length; j++) {
          const offset = j * COLS_PER_ROW;
          valuePlaceholders.push(
            `($${offset+1}, $${offset+2}, $${offset+3}, $${offset+4}, $${offset+5}, $${offset+6}, $${offset+7}, $${offset+8}, $${offset+9}, $${offset+10}, $${offset+11}, $${offset+12}, $${offset+13}, $${offset+14})`
          );
          const t = batch[j];
          values.push(
            t.info_hash, t.provider, t.title, t.size, t.type, t.upload_date,
            t.seeders, t.imdb_id, t.tmdb_id, t.cached_rd, t.last_cached_check,
            t.file_index, t.cached_tb || null, t.last_cached_check_tb || null
          );
        }

        const query = `
          INSERT INTO torrents (
            info_hash, provider, title, size, type, upload_date,
            seeders, imdb_id, tmdb_id, cached_rd, last_cached_check, file_index,
            cached_tb, last_cached_check_tb
          )
          VALUES ${valuePlaceholders.join(', ')}
          ON CONFLICT (info_hash) DO UPDATE SET
            imdb_id = COALESCE(torrents.imdb_id, EXCLUDED.imdb_id),
            tmdb_id = COALESCE(torrents.tmdb_id, EXCLUDED.tmdb_id),
            size = CASE WHEN torrents.size = 0 OR torrents.size IS NULL THEN EXCLUDED.size ELSE torrents.size END,
            seeders = GREATEST(EXCLUDED.seeders, torrents.seeders),
            title = CASE WHEN (${providerPrioritySQL('EXCLUDED.provider')}) < (${providerPrioritySQL('torrents.provider')}) THEN EXCLUDED.title
            ELSE torrents.title END,
            provider = CASE WHEN (${providerPrioritySQL('EXCLUDED.provider')}) < (${providerPrioritySQL('torrents.provider')}) THEN EXCLUDED.provider
            ELSE torrents.provider END,
            cached_rd = CASE
              WHEN torrents.cached_rd = true THEN true
              WHEN EXCLUDED.cached_rd = true THEN true
              ELSE COALESCE(torrents.cached_rd, EXCLUDED.cached_rd)
            END,
            last_cached_check = CASE
              WHEN EXCLUDED.last_cached_check IS NOT NULL
              THEN GREATEST(EXCLUDED.last_cached_check, COALESCE(torrents.last_cached_check, EXCLUDED.last_cached_check))
              ELSE torrents.last_cached_check
            END,
            file_index = COALESCE(EXCLUDED.file_index, torrents.file_index),
            cached_tb = CASE
              WHEN torrents.cached_tb = true THEN true
              WHEN EXCLUDED.cached_tb = true THEN true
              ELSE COALESCE(torrents.cached_tb, EXCLUDED.cached_tb)
            END,
            last_cached_check_tb = CASE
              WHEN EXCLUDED.last_cached_check_tb IS NOT NULL
              THEN GREATEST(EXCLUDED.last_cached_check_tb, COALESCE(torrents.last_cached_check_tb, EXCLUDED.last_cached_check_tb))
              ELSE torrents.last_cached_check_tb
            END
        `;

        const res = await pool.query(query, values);
        inserted += res.rowCount || 0;

      } catch (error) {
        // If batch fails, fall back to individual inserts for this batch
        console.warn(`⚠️ [DB] Batch of ${batch.length} failed (${error.message}), falling back to individual inserts`);
        for (const torrent of batch) {
          try {
            const res = await pool.query(`
              INSERT INTO torrents (
                info_hash, provider, title, size, type, upload_date,
                seeders, imdb_id, tmdb_id, cached_rd, last_cached_check, file_index,
                cached_tb, last_cached_check_tb
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
              ON CONFLICT (info_hash) DO UPDATE SET
                imdb_id = COALESCE(torrents.imdb_id, EXCLUDED.imdb_id),
                tmdb_id = COALESCE(torrents.tmdb_id, EXCLUDED.tmdb_id),
                size = CASE WHEN torrents.size = 0 OR torrents.size IS NULL THEN EXCLUDED.size ELSE torrents.size END,
                seeders = GREATEST(EXCLUDED.seeders, torrents.seeders),
                title = CASE WHEN (${providerPrioritySQL('EXCLUDED.provider')}) < (${providerPrioritySQL('torrents.provider')}) THEN EXCLUDED.title
                ELSE torrents.title END,
                provider = CASE WHEN (${providerPrioritySQL('EXCLUDED.provider')}) < (${providerPrioritySQL('torrents.provider')}) THEN EXCLUDED.provider
                ELSE torrents.provider END,
                cached_rd = CASE
                  WHEN torrents.cached_rd = true THEN true
                  WHEN EXCLUDED.cached_rd = true THEN true
                  ELSE COALESCE(torrents.cached_rd, EXCLUDED.cached_rd)
                END,
                last_cached_check = CASE
                  WHEN EXCLUDED.last_cached_check IS NOT NULL
                  THEN GREATEST(EXCLUDED.last_cached_check, COALESCE(torrents.last_cached_check, EXCLUDED.last_cached_check))
                  ELSE torrents.last_cached_check
                END,
                file_index = COALESCE(EXCLUDED.file_index, torrents.file_index),
                cached_tb = CASE
                  WHEN torrents.cached_tb = true THEN true
                  WHEN EXCLUDED.cached_tb = true THEN true
                  ELSE COALESCE(torrents.cached_tb, EXCLUDED.cached_tb)
                END,
                last_cached_check_tb = CASE
                  WHEN EXCLUDED.last_cached_check_tb IS NOT NULL
                  THEN GREATEST(EXCLUDED.last_cached_check_tb, COALESCE(torrents.last_cached_check_tb, EXCLUDED.last_cached_check_tb))
                  ELSE torrents.last_cached_check_tb
                END
            `, [
              torrent.info_hash, torrent.provider, torrent.title, torrent.size, torrent.type, torrent.upload_date,
              torrent.seeders, torrent.imdb_id, torrent.tmdb_id, torrent.cached_rd, torrent.last_cached_check,
              torrent.file_index, torrent.cached_tb || null, torrent.last_cached_check_tb || null
            ]);
            if (res.rowCount > 0) inserted++;
          } catch (innerErr) {
            console.warn(`⚠️ [DB] Failed to insert/update torrent ${torrent.info_hash}:`, innerErr.message);
          }
        }
      }
    }

    if (DEBUG_MODE) console.log(`✅ [DB] Batch upsert: ${inserted}/${torrents.length} torrents inserted/updated`);
    return inserted;

  } catch (error) {
    console.error(`❌ [DB] Batch insert error:`, error.message);
    return 0;
  }
}

/**
 * Update torrent file info (file_index and file_title) after playing
 * @param {string} infoHash - Torrent info hash
 * @param {number} fileIndex - RealDebrid file.id (1-based)
 * @param {string} filePath - Full file path (will extract filename)
 * @param {Object} episodeInfo - Optional: {imdbId, season, episode} for series
 * @returns {Promise<boolean>} Success status
 */
async function updateTorrentFileInfo(infoHash, fileIndex, filePath, fileSize = null, episodeInfo = null) {
  if (!pool) throw new Error('Database not initialized');

  try {
    if (DEBUG_MODE) console.log(`💾 [DB updateTorrentFileInfo] Input: hash=${infoHash}, fileIndex=${fileIndex}, size=${fileSize}, filePath=${filePath}, episodeInfo=`, episodeInfo);

    // Extract just the filename from path
    const fileName = filePath.split('/').pop().split('\\').pop();
    if (DEBUG_MODE) console.log(`💾 [DB updateTorrentFileInfo] Extracted filename: ${fileName}`);

    // If episodeInfo is provided, save to 'files' table (for series episodes)
    if (episodeInfo && episodeInfo.imdbId && episodeInfo.season && episodeInfo.episode) {
      if (DEBUG_MODE) console.log(`💾 [DB] Saving episode file: ${episodeInfo.imdbId} S${episodeInfo.season}E${episodeInfo.episode}`);

      // Check if file already exists
      const checkQuery = `
        SELECT file_index FROM files
        WHERE info_hash = $1
          AND imdb_id = $2
          AND imdb_season = $3
          AND imdb_episode = $4
      `;
      const checkRes = await pool.query(checkQuery, [
        infoHash.toLowerCase(),
        episodeInfo.imdbId,
        episodeInfo.season,
        episodeInfo.episode
      ]);

      if (checkRes.rowCount > 0) {
        // Record already exists for this episode - just update the title and size if needed
        const updateQuery = `
          UPDATE files
          SET file_index = $1,
              title = $2,
              size = COALESCE($7, size)
          WHERE info_hash = $3
            AND imdb_id = $4
            AND imdb_season = $5
            AND imdb_episode = $6
        `;
        const res = await pool.query(updateQuery, [
          fileIndex,
          fileName,
          infoHash.toLowerCase(),
          episodeInfo.imdbId,
          episodeInfo.season,
          episodeInfo.episode,
          fileSize // $7
        ]);
        if (DEBUG_MODE) console.log(`✅ [DB] Updated file in 'files' table: ${fileName} (rowCount=${res.rowCount})`);
        return res.rowCount > 0;
      } else {
        // Check if this (hash, fileIndex) combo exists for a DIFFERENT episode
        const conflictCheck = await pool.query(
          'SELECT imdb_season, imdb_episode FROM files WHERE info_hash = $1 AND file_index = $2',
          [infoHash.toLowerCase(), fileIndex]
        );

        if (conflictCheck.rowCount > 0) {
          // This fileIndex is already used for a different episode - skip to avoid conflict
          const existing = conflictCheck.rows[0];
          if (DEBUG_MODE) console.log(`⚠️ [DB] FileIndex ${fileIndex} already used for S${existing.imdb_season}E${existing.imdb_episode}, skipping S${episodeInfo.season}E${episodeInfo.episode}`);
          return false;
        }

        // Insert new file (UPSERT - update if exists)
        const insertQuery = `
          INSERT INTO files (info_hash, file_index, title, imdb_id, imdb_season, imdb_episode, size)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (info_hash, file_index) DO UPDATE SET
            title = EXCLUDED.title,
            imdb_id = EXCLUDED.imdb_id,
            imdb_season = EXCLUDED.imdb_season,
            imdb_episode = EXCLUDED.imdb_episode,
            size = EXCLUDED.size
        `;
        const res = await pool.query(insertQuery, [
          infoHash.toLowerCase(),
          fileIndex,
          fileName,
          episodeInfo.imdbId,
          episodeInfo.season,
          episodeInfo.episode,
          fileSize // $7
        ]);

        if (DEBUG_MODE) console.log(`✅ [DB] Upserted file into 'files' table: ${fileName}`);
        return true;
      }
    } else {
      // Fallback: update torrents table (for movies or when episode info not available)
      const query = `
        UPDATE torrents
        SET file_index = $1,
            file_title = $2
        WHERE info_hash = $3
      `;

      const res = await pool.query(query, [fileIndex, fileName, infoHash.toLowerCase()]);
      if (DEBUG_MODE) console.log(`✅ [DB] Updated torrents table: ${fileName} (rowCount=${res.rowCount})`);

      return res.rowCount > 0;
    }

  } catch (error) {
    console.error(`❌ [DB] Error updating file info:`, error.message, error);
    return false;
  }
}

/**
 * Delete all file entries for a specific torrent hash
 * Used when re-adding a torrent to clean up old file selections
 */
async function deleteFileInfo(infoHash) {
  try {
    const query = `DELETE FROM files WHERE info_hash = $1`;
    const res = await pool.query(query, [infoHash.toLowerCase()]);
    if (DEBUG_MODE) console.log(`✅ [DB] Deleted ${res.rowCount} file entries for hash ${infoHash}`);
    return res.rowCount;
  } catch (error) {
    console.error(`❌ [DB] Error deleting file info:`, error.message);
    return 0;
  }
}

/**
 * Update rd_link_index for a specific file
 * This saves the verified RD link index to avoid repeated API calls
 * @param {string} infoHash - Torrent info hash
 * @param {number} fileIndex - File index in the pack (alphabetical order)
 * @param {number} rdLinkIndex - Verified RD unrestrict link index
 * @returns {Promise<boolean>} Success status
 */
async function updateRdLinkIndex(infoHash, fileIndex, rdLinkIndex) {
  if (!pool) throw new Error('Database not initialized');

  try {
    const query = `
      UPDATE files
      SET rd_link_index = $3
      WHERE info_hash = $1 AND file_index = $2
    `;
    const res = await pool.query(query, [infoHash.toLowerCase(), fileIndex, rdLinkIndex]);

    if (res.rowCount > 0) {
      if (DEBUG_MODE) console.log(`✅ [DB] Saved rd_link_index=${rdLinkIndex} for ${infoHash.substring(0, 8)}... file_index=${fileIndex}`);
      return true;
    } else {
      if (DEBUG_MODE) console.warn(`⚠️ [DB] No file found to update rd_link_index for ${infoHash.substring(0, 8)}... file_index=${fileIndex}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ [DB] Error updating rd_link_index:`, error.message);
    return false;
  }
}

/**
 * Update rd_link_index for movie pack files
 * Used by background job to map RD link indices to files
 * @param {string} infoHash - Torrent info hash (pack hash)
 * @param {number} fileId - RD file.id
 * @param {number} rdLinkIndex - RD link array index
 * @param {string} filename - Filename from unrestricted link
 * @returns {Promise<boolean>} Success status
 */
async function updateRdLinkIndexForPack(infoHash, fileId, rdLinkIndex, filename) {
  if (!pool) throw new Error('Database not initialized');

  try {
    // Update pack_files table with rd_link_index
    const query = `
      UPDATE pack_files
      SET rd_link_index = $3
      WHERE pack_hash = $1 AND file_index = $2
    `;
    const res = await pool.query(query, [infoHash.toLowerCase(), fileId, rdLinkIndex]);

    if (res.rowCount > 0) {
      if (DEBUG_MODE) console.log(`✅ [DB] Pack: Saved rd_link_index=${rdLinkIndex} for file_id=${fileId} (${filename})`);
      return true;
    } else {
      // Try to match by filename if file_index doesn't match
      const filenameQuery = `
        UPDATE pack_files
        SET rd_link_index = $2
        WHERE pack_hash = $1 AND file_path ILIKE '%' || $3
      `;
      const filenameRes = await pool.query(filenameQuery, [infoHash.toLowerCase(), rdLinkIndex, filename]);
      if (filenameRes.rowCount > 0) {
        if (DEBUG_MODE) console.log(`✅ [DB] Pack: Saved rd_link_index=${rdLinkIndex} for ${filename} (by filename match)`);
        return true;
      }
      return false;
    }
  } catch (error) {
    console.error(`❌ [DB] Error updating pack rd_link_index:`, error.message);
    return false;
  }
}

/**
 * Get IMDb ID for a torrent by its info hash
 * @param {string} infoHash - Torrent info hash
 * @returns {Promise<string|null>} IMDb ID or null if not found
 */
async function getImdbIdByHash(infoHash) {
  if (!pool) throw new Error('Database not initialized');

  try {
    const query = 'SELECT imdb_id FROM torrents WHERE info_hash = $1 LIMIT 1';
    const result = await pool.query(query, [infoHash.toLowerCase()]);

    if (result.rows.length > 0 && result.rows[0].imdb_id) {
      if (DEBUG_MODE) console.log(`✅ [DB] Found imdb_id ${result.rows[0].imdb_id} for hash ${infoHash}`);
      return result.rows[0].imdb_id;
    }

    if (DEBUG_MODE) console.log(`⚠️ [DB] No imdb_id found for hash ${infoHash}`);
    return null;
  } catch (error) {
    console.error(`❌ [DB] Error fetching imdb_id:`, error.message);
    return null;
  }
}

// ✅ ADDED: getTorrent by hash
/**
 * Get full torrent data by its info hash
 * @param {string} infoHash - Torrent info hash
 * @returns {Promise<Object|null>} Torrent object or null if not found
 */
async function getTorrent(infoHash) {
  if (!pool) throw new Error('Database not initialized');

  try {
    const query = 'SELECT * FROM torrents WHERE info_hash = $1 LIMIT 1';
    const result = await pool.query(query, [infoHash.toLowerCase()]);

    if (result.rows.length > 0) {
      if (DEBUG_MODE) console.log(`✅ [DB] Found torrent data for hash ${infoHash}`);
      return result.rows[0];
    }

    return null;
  } catch (error) {
    console.error(`❌ [DB] Error fetching torrent by hash:`, error.message);
    return null;
  }
}

/**
 * Get is_torrent_pack flag for a torrent
 * @param {string} infoHash - Torrent info hash
 * @returns {Promise<boolean|null>} true if pack, false if not pack, null if unknown
 */
async function getIsTorrentPack(infoHash) {
  if (!pool) return null;
  if (!infoHash) return null;

  try {
    const query = 'SELECT is_torrent_pack FROM torrents WHERE info_hash = $1 LIMIT 1';
    const result = await pool.query(query, [infoHash.toLowerCase()]);

    if (result.rows.length > 0) {
      return result.rows[0].is_torrent_pack; // true, false, or null
    }
    return null; // Torrent not in DB
  } catch (error) {
    console.error(`❌ [DB] Error getting is_torrent_pack:`, error.message);
    return null;
  }
}

/**
 * Batch check is_torrent_pack for multiple hashes in a single query
 * @param {Array<string>} infoHashes - Array of info hashes
 * @returns {Promise<Map<string, boolean|null>>} Map of hash -> is_torrent_pack value
 */
async function batchGetIsTorrentPack(infoHashes) {
  if (!pool) return new Map();
  if (!infoHashes || infoHashes.length === 0) return new Map();

  try {
    const lowerHashes = infoHashes.map(h => h.toLowerCase());
    const query = 'SELECT info_hash, is_torrent_pack FROM torrents WHERE info_hash = ANY($1)';
    const result = await pool.query(query, [lowerHashes]);

    const map = new Map();
    for (const row of result.rows) {
      map.set(row.info_hash, row.is_torrent_pack);
    }
    return map;
  } catch (error) {
    console.error(`❌ [DB] Error batch getting is_torrent_pack:`, error.message);
    return new Map();
  }
}

/**
 * Update is_torrent_pack flag for a torrent (ONLY this field)
 * @param {string} infoHash - Torrent info hash
 * @param {boolean} isPack - true if confirmed pack, false if confirmed NOT pack
 * @returns {Promise<boolean>} Success status
 */
async function updateIsTorrentPack(infoHash, isPack) {
  if (!pool) return false;
  if (!infoHash) return false;
  if (typeof isPack !== 'boolean') return false;

  try {
    const query = `
      UPDATE torrents
      SET is_torrent_pack = $2
      WHERE info_hash = $1
    `;
    const result = await pool.query(query, [infoHash.toLowerCase(), isPack]);

    if (result.rowCount > 0) {
      if (DEBUG_MODE) console.log(`✅ [DB] Updated is_torrent_pack = ${isPack} for ${infoHash.substring(0, 8)}`);
      return true;
    }
    return false; // Torrent not found in DB
  } catch (error) {
    console.error(`❌ [DB] Error updating is_torrent_pack:`, error.message);
    return false;
  }
}


/**
 * Search torrents by title using PostgreSQL Full-Text Search (FTS)
 * This is a fallback when ID-based search returns no results
 * @param {string} cleanedTitle - Cleaned title for search (from cleanTitleForSearch)
 * @param {string} type - Media type: 'movie' or 'series'
 * @param {number} year - Optional year for filtering (±1 tolerance)
 * @returns {Promise<Array>} Array of torrent objects ordered by relevance
 */
async function searchByTitleFTS(cleanedTitle, type = null, year = null) {
  if (!pool) throw new Error('Database not initialized');

  try {
    console.log(`💾 [DB FTS] Searching: "${cleanedTitle}"${type ? ` (${type})` : ''}${year ? ` year=${year}` : ''}`);

    let query = `
      SELECT
        info_hash,
        provider,
        title,
        size,
        type,
        seeders,
        imdb_id,
        tmdb_id,
        cached_rd,
        last_cached_check,
        file_index,
        file_title,
        ts_rank(title_vector, plainto_tsquery('italian', $1)) as rank
      FROM torrents
      WHERE title_vector @@ plainto_tsquery('italian', $1)
    `;

    const params = [cleanedTitle];
    let paramIndex = 2;

    // Filter by type if provided
    if (type) {
      query += ` AND type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    // Filter by year with ±1 tolerance if provided
    if (year) {
      query += ` AND (
        title ~* '\\m${year}\\M' OR
        title ~* '\\m${year - 1}\\M' OR
        title ~* '\\m${year + 1}\\M'
      )`;
    }

    // Order by relevance (rank) and seeders
    query += ' ORDER BY rank DESC, cached_rd DESC NULLS LAST, seeders DESC LIMIT 50';

    const result = await pool.query(query, params);
    console.log(`💾 [DB FTS] Found ${result.rows.length} torrents (rank threshold applied)`);

    // Log top 3 results with rank for debugging
    if (result.rows.length > 0) {
      console.log(`💾 [DB FTS] Top 3 results:`);
      result.rows.slice(0, 3).forEach((row, i) => {
        console.log(`   ${i + 1}. ${row.title} (rank: ${row.rank.toFixed(4)}, seeders: ${row.seeders})`);
      });
    }

    return result.rows;
  } catch (error) {
    console.error(`❌ [DB FTS] Error:`, error.message);
    // If FTS column doesn't exist yet, return empty array (migration not run)
    if (error.message.includes('title_vector')) {
      console.warn(`⚠️ [DB FTS] title_vector column not found. Run migration: migrations/001_add_fts_support.sql`);
    }
    return [];
  }
}

/**
 * Update torrents with completed IDs (auto-repair)
 * @param {string|Array<string>} infoHashes - Info hash(es) of torrents to update
 * @param {string|null} imdbId - IMDb ID to set (if missing)
 * @param {number|null} tmdbId - TMDb ID to set (if missing)
 * @returns {Promise<number>} Number of updated torrents
 */
async function updateTorrentsWithIds(infoHashes, imdbId, tmdbId) {
  if (!pool) throw new Error('Database not initialized');

  try {
    // Convert single hash to array
    const hashArray = Array.isArray(infoHashes) ? infoHashes : [infoHashes];

    if (hashArray.length === 0) {
      console.log(`💾 [DB] No hashes to update`);
      return 0;
    }

    const updates = [];
    const params = [];
    let paramIndex = 1;

    // Build SET clause
    if (imdbId) {
      updates.push(`imdb_id = $${paramIndex++}`);
      params.push(imdbId);
    }

    if (tmdbId) {
      updates.push(`tmdb_id = $${paramIndex++}`);
      params.push(tmdbId);
    }

    if (updates.length === 0) {
      console.log(`💾 [DB] No IDs to update`);
      return 0;
    }

    // Build WHERE clause: update all torrents in the hash array
    params.push(hashArray.map(h => h.toLowerCase()));

    const query = `
      UPDATE torrents
      SET ${updates.join(', ')}
      WHERE info_hash = ANY($${paramIndex})
      AND (imdb_id IS NULL OR tmdb_id IS NULL)
    `;

    const result = await pool.query(query, params);
    console.log(`💾 [DB] Auto-repaired ${result.rowCount} torrent(s) with completed IDs`);
    return result.rowCount;
  } catch (error) {
    console.error(`❌ [DB] Error updating IDs:`, error.message);
    return 0;
  }
}

/**
 * Search pack files by IMDb ID
 * Returns all packs that contain the specified film
 * @param {string} imdbId - IMDb ID of the film
 * @returns {Promise<Array>} Array of pack torrents with file info
 */
async function searchPacksByImdbId(imdbId) {
  if (!pool) throw new Error('Database not initialized');

  try {
    if (DEBUG_MODE) console.log(`💾 [DB] Searching packs containing film: ${imdbId}`);

    const query = `
      SELECT
        t.info_hash,
        t.provider,
        t.title,
        t.size,
        t.type,
        t.seeders,
        t.cached_rd,
        t.last_cached_check,
        pf.file_index,
        pf.file_path,
        pf.file_path as file_title,
        pf.file_size,
        pf.imdb_id as film_imdb_id,
        pf.imdb_id as imdb_id
      FROM torrents t
      INNER JOIN pack_files pf ON t.info_hash = pf.pack_hash
      WHERE pf.imdb_id = $1
      ORDER BY t.seeders DESC, t.size DESC
    `;

    const result = await pool.query(query, [imdbId]);
    if (DEBUG_MODE) console.log(`   ✅ Found ${result.rows.length} pack(s) containing ${imdbId}`);

    return result.rows;
  } catch (error) {
    console.error(`❌ Error searching packs by IMDb ${imdbId}:`, error.message);
    return [];
  }
}

/**
 * Search pack files by movie title (for movies only)
 * This enables finding movies in packs without pre-indexing all IMDb IDs
 * @param {string} title - Movie title to search for
 * @param {string} year - Release year (optional)
 * @param {string} imdbId - IMDb ID to update pack_files if match found
 * @returns {Promise<Array>} Array of pack torrents with file info
 */
async function searchPacksByTitle(title, year = null, imdbId = null) {
  if (!pool) throw new Error('Database not initialized');
  if (!title || title.length < 3) return [];

  try {
    if (DEBUG_MODE) console.log(`💾 [DB] Searching packs by title: "${title}" (${year || 'no year'})`);

    // ✅ FIX: Extract sequel number and search by BASE TITLE to find files like "Movie 2" when searching "Movie Part II"
    // This helps find "Back to the Future 2" when searching "Back to the Future Part II"
    const extractSequelInfo = (str) => {
      // Match patterns: "Part II", "Parte II", "Part 2", "2" at end, ": Subtitle" etc.
      const patterns = [
        /\s*[-:]\s*part(?:e)?\s*(?:ii+|iii+|iv|v|vi|vii|viii|ix|x|\d+)\s*$/i, // "- Part II" or ": Parte III"
        /\s+part(?:e)?\s*(?:ii+|iii+|iv|v|vi|vii|viii|ix|x|\d+)\s*$/i,        // "Part II" at end
        /\s+(?:ii+|iii+|iv|v|vi|vii|viii|ix|x)\s*$/i,                          // Roman numeral at end
        /\s+(\d)\s*$/                                                          // Single digit at end "Movie 2"
      ];

      for (const pattern of patterns) {
        if (pattern.test(str)) {
          return str.replace(pattern, '').trim();
        }
      }
      return null; // No sequel suffix found
    };

    const baseTitle = extractSequelInfo(title);

    // Build search pattern - clean title for ILIKE matching
    const cleanTitle = title.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')  // Remove special chars
      .replace(/\s+/g, '%')          // Replace spaces with wildcards
      .trim();

    // Also build a base title pattern for broader search
    const cleanBaseTitle = baseTitle ? baseTitle.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, '%')
      .trim() : null;

    const searchPattern = `%${cleanTitle}%`;
    const baseSearchPattern = cleanBaseTitle ? `%${cleanBaseTitle}%` : null;

    // ✅ FIX: Search with BOTH patterns - exact title AND base title (without sequel suffix)
    // This finds "Back to the Future 2" when searching "Back to the Future Part II"
    let query;
    let params;

    if (baseSearchPattern && baseSearchPattern !== searchPattern) {
      // Search with both patterns using OR
      query = `
        SELECT
          t.info_hash,
          t.provider,
          t.title,
          t.size,
          t.type,
          t.seeders,
          t.cached_rd,
          t.last_cached_check,
          pf.file_index,
          pf.file_path,
          pf.file_path as file_title,
          pf.file_size,
          pf.imdb_id as film_imdb_id
        FROM torrents t
        INNER JOIN pack_files pf ON t.info_hash = pf.pack_hash
        WHERE pf.file_path ~* ('\\m' || $1 || '\\M') OR pf.file_path ~* ('\\m' || $2 || '\\M')
        ORDER BY t.seeders DESC, t.size DESC
        LIMIT 50
      `;
      params = [title.toLowerCase(), baseTitle.toLowerCase()];
    } else {
      // Search with just the exact pattern
      query = `
        SELECT
          t.info_hash,
          t.provider,
          t.title,
          t.size,
          t.type,
          t.seeders,
          t.cached_rd,
          t.last_cached_check,
          pf.file_index,
          pf.file_path,
          pf.file_path as file_title,
          pf.file_size,
          pf.imdb_id as film_imdb_id,
          pf.imdb_id as imdb_id
        FROM torrents t
        INNER JOIN pack_files pf ON t.info_hash = pf.pack_hash
        WHERE pf.file_path ~* ('\\m' || $1 || '\\M')
        ORDER BY t.seeders DESC, t.size DESC
        LIMIT 30
      `;
      params = [title.toLowerCase()];
    }

    const result = await pool.query(query, params);
    console.log(`   ✅ Found ${result.rows.length} pack file(s) matching "${title}"${baseSearchPattern ? ` (also searched base: "${baseTitle}")` : ''}`);

    // 🔧 SMART FILTERING: Filter by year if provided (prefer exact match, but accept no-year files)
    let filteredResults = result.rows;
    if (year && result.rows.length > 0) {
      const yearStr = String(year);

      // Separate files: with matching year, with wrong year, without year
      const withMatchingYear = [];
      const withoutYear = [];
      const withWrongYear = [];

      for (const row of result.rows) {
        const filePath = row.file_path || '';
        // Extract year from filename - various formats: (1985), .1985., _1985_, -1985-
        const fileYearMatch = filePath.match(/[\(\.\-_](\d{4})[\)\.\-_]/);
        const fileYear = fileYearMatch ? fileYearMatch[1] : null;

        if (fileYear === yearStr) {
          withMatchingYear.push(row);
        } else if (!fileYear) {
          withoutYear.push(row);
        } else {
          withWrongYear.push(row);
        }
      }

      // Prioritize: matching year first, then no-year, exclude wrong year
      // (wrong year files are likely different movies, e.g., "Frozen 2" vs "Frozen")
      filteredResults = [...withMatchingYear, ...withoutYear];

      if (DEBUG_MODE && withWrongYear.length > 0) {
        console.log(`   ⏭️  [DB] Excluded ${withWrongYear.length} file(s) with wrong year (not ${yearStr})`);
      }
    }

    // 🔧 SMART AUTO-INDEX: Assign IMDb ID to matching files
    if (filteredResults.length > 0 && imdbId) {
      const yearStr = year ? String(year) : null;
      let indexedCount = 0;

      // ✅ FIX: Unified sequel number extraction
      // ALL these are equivalent: "Part 2" = "Part II" = "Parte 2" = "Parte II" = "2" = "II"
      const extractTitleNumber = (str) => {
        if (!str) return null;
        const s = str.toLowerCase();

        // Pattern 1: "part 2", "part ii", "parte 2", "parte ii", "part. 2", etc.
        let match = s.match(/\bpart[ae]?\.?\s*(\d+|i{1,3}|iv|v|vi{0,3}|ix|x{1,3})\b/);
        if (match) return romanOrDigitToNumber(match[1]);

        // Pattern 2: Standalone roman numerals (ii, iii, iv, etc.) but NOT single "i"
        match = s.match(/\b(ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii)\b/);
        if (match) return romanOrDigitToNumber(match[1]);

        // Pattern 3: Number after title, before tech specs: "movie 2 ", "movie 2-", "movie 2 (", "movie 2 1080p"
        match = s.match(/[\s\-\.]\s*(\d)\s*(?:[\s\-\.\(\[]|1080|720|2160|4k|hdr|ac3|dts|bluray|bdrip|webrip|mkv|mp4|avi|$)/);
        if (match) return parseInt(match[1]);

        // Pattern 4: Number at very end: "...futuro 2"
        match = s.match(/\s(\d)\s*$/);
        if (match) return parseInt(match[1]);

        return null;
      };

      // Helper: convert roman numeral or digit string to number
      const romanOrDigitToNumber = (s) => {
        const map = { 'i': 1, 'ii': 2, 'iii': 3, 'iv': 4, 'v': 5, 'vi': 6, 'vii': 7, 'viii': 8, 'ix': 9, 'x': 10, 'xi': 11, 'xii': 12 };
        const lower = s.toLowerCase();
        if (map[lower]) return map[lower];
        const n = parseInt(s);
        return (n >= 1 && n <= 99) ? n : null;
      };

      const requestedTitleNumber = extractTitleNumber(title);
      if (DEBUG_MODE) console.log(`   🔢 Requested sequel number: ${requestedTitleNumber} (from "${title}")`);

      for (const row of filteredResults) {
        const filePath = row.file_path || row.file_title || '';
        const fileName = filePath.split('/').pop() || filePath;

        // Extract year from filename
        const fileYearMatch = filePath.match(/[\(\.\-_](\d{4})[\)\.\-_]/);
        const fileYear = fileYearMatch ? fileYearMatch[1] : null;

        // Check for sequel number mismatch (e.g., searching "Titanic" but file is "Titanic 2")
        const fileTitleNumber = extractTitleNumber(fileName);

        // ✅ Sequel matching logic:
        // - "Part 2" matches file with "2", "II", "Part II", "Parte 2", etc. (all = 2)
        // - Searching without number (null) matches files with no number OR number 1
        const isSequelMismatch = () => {
          if (requestedTitleNumber === null) {
            // Searching without number: allow files with number 1 or no number, reject 2, 3, etc.
            return fileTitleNumber !== null && fileTitleNumber !== 1;
          }
          if (fileTitleNumber === null) {
            // File has no number: match if we're searching for 1, reject otherwise
            return requestedTitleNumber !== 1;
          }
          // Both have numbers: must match exactly
          return fileTitleNumber !== requestedTitleNumber;
        };

        if (isSequelMismatch()) {
          if (DEBUG_MODE) console.log(`   ⏭️  [DB] Skipping "${fileName}" - sequel number mismatch (file: ${fileTitleNumber}, want: ${requestedTitleNumber || 'none/1'})`);
          continue;
        }

        // Decide if we should assign IMDb ID:
        // 1. File has matching year → YES
        // 2. File has no year AND title matches well → YES
        // 3. File has wrong year → NO (already filtered out)
        const shouldUpdate = (fileYear === yearStr) || (!fileYear && yearStr) || (!yearStr);

        if (!shouldUpdate) {
          continue;
        }

        // Skip if already has an IMDb ID
        if (row.film_imdb_id && row.film_imdb_id !== '' && row.film_imdb_id !== imdbId) {
          if (DEBUG_MODE) console.log(`   ⏭️  [DB] Skipping ${row.info_hash.substring(0, 8)}... already has IMDb ${row.film_imdb_id}`);
          continue;
        }

        try {
          await pool.query(`
            UPDATE pack_files
            SET imdb_id = $1
            WHERE pack_hash = $2 AND file_index = $3 AND (imdb_id IS NULL OR imdb_id = '')
          `, [imdbId, row.info_hash, row.file_index]);
          indexedCount++;

          if (DEBUG_MODE) console.log(`   📝 [DB] Auto-indexed ${imdbId} -> pack ${row.info_hash.substring(0, 8)}... file="${fileName.substring(0, 40)}"`);
        } catch (updateErr) {
          // Ignore update errors (e.g., constraint violations)
        }
      }

      if (indexedCount > 0) {
        console.log(`   🏷️  Auto-indexed ${indexedCount}/${filteredResults.length} file(s) with ${imdbId}${year ? ` (${year})` : ''}`);
      }
    }

    if (imdbId) {
      filteredResults = filteredResults.filter(row => {
      if (row.film_imdb_id && imdbId && row.film_imdb_id !== imdbId) {
        return false;
      }
      return true;
      });
    }
    return filteredResults;
  } catch (error) {
    console.error(`❌ Error searching packs by title "${title}":`, error.message);
    return [];
  }
}

/**
 * Insert pack files mapping
 * ✅ FIX: Use UPSERT - update existing, insert new, preserve imdb_id if already set
 * @param {Array} packFiles - Array of {pack_hash, imdb_id, file_index, file_path, file_size}
 * @returns {Promise<number>} Number of inserted/updated records
 */
async function insertPackFiles(packFiles) {
  if (!pool) throw new Error('Database not initialized');
  if (!packFiles || packFiles.length === 0) return 0;

  try {
    const values = [];
    const params = [];
    let paramIndex = 1;

    packFiles.forEach(pf => {
      values.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4})`);
      params.push(pf.pack_hash, pf.imdb_id, pf.file_index, pf.file_path, pf.file_size);
      paramIndex += 5;
    });

    // ✅ FIX: UPSERT - update file_path/file_size, but PRESERVE imdb_id if already set
    // This prevents losing imdb_id when re-processing the same pack for a different movie
    const query = `
      INSERT INTO pack_files (pack_hash, imdb_id, file_index, file_path, file_size)
      VALUES ${values.join(', ')}
      ON CONFLICT (pack_hash, file_index) DO UPDATE SET
        imdb_id = COALESCE(pack_files.imdb_id, EXCLUDED.imdb_id),
        file_path = EXCLUDED.file_path,
        file_size = EXCLUDED.file_size
    `;

    const result = await pool.query(query, params);
    console.log(`   ✅ Upserted ${result.rowCount} pack file mappings`);

    return result.rowCount;
  } catch (error) {
    console.error('❌ Error inserting pack files:', error.message);
    throw error;
  }
}

/**
 * Get pack files for a specific pack with TTL check
 * @param {string} packHash - InfoHash of the pack
 * @param {number} ttlDays - TTL in days (default: 10, same as torrents)
 * @returns {Promise<{files: Array, expired: boolean}>} Files and expiration status
 */
async function getPackFiles(packHash, ttlDays = 10) {
  if (!pool) throw new Error('Database not initialized');

  try {
    const query = `
      SELECT imdb_id, file_index, file_path, file_size, created_at
      FROM pack_files
      WHERE pack_hash = $1
      ORDER BY file_index ASC
    `;

    const result = await pool.query(query, [packHash]);

    if (result.rows.length === 0) {
      return { files: [], expired: false };
    }

    // Check TTL using first row's created_at
    const createdAt = result.rows[0].created_at;
    const ageMs = createdAt ? Date.now() - new Date(createdAt).getTime() : 0;
    const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
    const expired = ageMs > ttlMs;

    if (expired) {
      console.log(`⏰ [DB] Pack files for ${packHash.substring(0, 8)} expired (${Math.floor(ageMs / 86400000)} days > ${ttlDays})`);
    }

    return {
      files: result.rows,
      expired,
      ageInDays: Math.floor(ageMs / 86400000)
    };
  } catch (error) {
    console.error(`❌ Error getting pack files for ${packHash}:`, error.message);
    return { files: [], expired: false };
  }
}

// ✅ REMOVED: updatePackAllImdbIds - column all_imdb_ids no longer exists, pack films use pack_files table

/**
 * Insert episode files from pack processing
 * @param {Array} episodeFiles - Array of {info_hash, file_index, title, size, imdb_id, imdb_season, imdb_episode}
 * @returns {Promise<number>} Number of inserted records
 */
async function insertEpisodeFiles(episodeFiles) {
  if (!pool) throw new Error('Database not initialized');
  if (!episodeFiles || episodeFiles.length === 0) return 0;

  try {
    // ✅ SKIP CHECK: if files already exist for this hash with same count, skip entirely
    // Torrent file lists are immutable (defined by info_hash), so count match = all files present
    const infoHash = episodeFiles[0].info_hash.toLowerCase();
    const countResult = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM files WHERE info_hash = $1',
      [infoHash]
    );
    const existingCount = countResult.rows[0]?.cnt || 0;
    if (existingCount === episodeFiles.length) {
      if (DEBUG_MODE) console.log(`⏩ [DB] Skip insertEpisodeFiles for ${infoHash.substring(0,8)}… — ${existingCount} files already in DB`);
      return 0; // nothing to do
    }

    // ✅ BATCHED INSERT: Build single multi-value INSERT instead of 1 query per file
    const BATCH_SIZE = 100; // PostgreSQL parameter limit safety
    let totalInserted = 0;

    for (let batchStart = 0; batchStart < episodeFiles.length; batchStart += BATCH_SIZE) {
      const batch = episodeFiles.slice(batchStart, batchStart + BATCH_SIZE);
      const values = [];
      const params = [];
      let paramIndex = 1;

      for (const file of batch) {
        values.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6})`);
        params.push(
          file.info_hash.toLowerCase(),
          file.file_index,
          file.title,
          file.size,
          file.imdb_id,
          file.imdb_season,
          file.imdb_episode
        );
        paramIndex += 7;
      }

      const query = `
        INSERT INTO files (info_hash, file_index, title, size, imdb_id, imdb_season, imdb_episode)
        VALUES ${values.join(', ')}
        ON CONFLICT (info_hash, file_index) DO UPDATE SET
          title = EXCLUDED.title,
          size = EXCLUDED.size,
          imdb_id = EXCLUDED.imdb_id,
          imdb_season = EXCLUDED.imdb_season,
          imdb_episode = EXCLUDED.imdb_episode
      `;

      try {
        const res = await pool.query(query, params);
        totalInserted += res.rowCount;
      } catch (batchErr) {
        console.warn(`⚠️ [DB] Batch insert failed (${batch.length} files), falling back to individual: ${batchErr.message}`);
        // Fallback: individual inserts for this batch only
        for (const file of batch) {
          try {
            const res = await pool.query(
              `INSERT INTO files (info_hash, file_index, title, size, imdb_id, imdb_season, imdb_episode)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (info_hash, file_index) DO UPDATE SET
                 title = EXCLUDED.title, size = EXCLUDED.size, imdb_id = EXCLUDED.imdb_id,
                 imdb_season = EXCLUDED.imdb_season, imdb_episode = EXCLUDED.imdb_episode`,
              [file.info_hash.toLowerCase(), file.file_index, file.title, file.size, file.imdb_id, file.imdb_season, file.imdb_episode]
            );
            if (res.rowCount > 0) totalInserted++;
          } catch (e) { /* skip individual errors */ }
        }
      }
    }

    if (DEBUG_MODE) console.log(`✅ [DB] Inserted ${totalInserted}/${episodeFiles.length} episode files`);
    return totalInserted;

  } catch (error) {
    console.error(`❌ [DB] Batch insert episode files error:`, error.message);
    return 0;
  }
}

/**
 * Get all files for a pack from the DB
 * Searches pack_files first (movie packs with correct file.id), then files table as fallback
 * @param {string} infoHash - InfoHash of the torrent
 * @returns {Promise<Array>} Array of cached files
 */
async function getSeriesPackFiles(infoHash) {
  if (!pool) throw new Error('Database not initialized');

  try {
    const hashLower = infoHash.toLowerCase();

    // 1️⃣ PRIORITY: Check pack_files first (has correct RD file.id indices)
    const packFilesQuery = `
      SELECT file_index as id, file_path as path, file_size as bytes
      FROM pack_files
      WHERE pack_hash = $1
      ORDER BY file_path ASC
    `;
    const packResult = await pool.query(packFilesQuery, [hashLower]);

    if (packResult.rows.length > 0) {
      if (DEBUG_MODE) console.log(`💾 [DB] Found ${packResult.rows.length} files in pack_files for ${infoHash.substring(0, 8)}`);
      return packResult.rows.map(row => ({
        id: row.id,
        path: row.path,
        bytes: parseInt(row.bytes) || 0,
        selected: 1
      }));
    }

    // 2️⃣ FALLBACK: Check files table (for series packs)
    const filesQuery = `
      SELECT file_index as id, title as path, size as bytes
      FROM files
      WHERE info_hash = $1
      ORDER BY file_index ASC
    `;
    const filesResult = await pool.query(filesQuery, [hashLower]);

    if (filesResult.rows.length > 0) {
      if (DEBUG_MODE) console.log(`💾 [DB] Found ${filesResult.rows.length} files in files table for ${infoHash.substring(0, 8)}`);
    }

    return filesResult.rows.map(row => ({
      id: row.id,
      path: row.path,
      bytes: parseInt(row.bytes) || 0,
      selected: 1
    }));
  } catch (error) {
    console.error(`❌ [DB] Error getting pack files: ${error.message}`);
    return [];
  }
}

/**
 * Search for specific files inside packs by title (FTS)
 * Used for Movie Packs where we indexed all files
 * [Updated] Added for P2P Pack Support
 * @param {string} titleQuery - Title to search for
 * @param {Array<string>} providers - Optional providers
 * @param {Object} options - Optional filters: { movieImdbId, excludeSeries }
 */
async function searchFilesByTitle(titleQuery, providers = null, options = {}) {
  if (!pool) throw new Error('Database not initialized');

  const { movieImdbId = null, excludeSeries = false, year = null } = options;

  //  Helper function for ILIKE search (fallback)
  const runIlikeSearch = async () => {
    let query = `
      SELECT
        f.file_index,
        f.title as file_title,
        f.size as file_size,
        t.info_hash,
        t.provider,
        t.title as torrent_title,
        t.size as torrent_size,
        t.seeders,
        t.imdb_id,
        t.cached_rd,
        t.type as torrent_type,
        f.imdb_id as file_imdb_id
      FROM files f
      JOIN torrents t ON f.info_hash = t.info_hash
      WHERE f.title ~* ('\\m' || $1 || '\\M')
    `;
    const params = [titleQuery.toLowerCase()];
    let paramIndex = 2;

    // 🎬 FILTER: Year in filename
    if (year) {
      query += ` AND f.title ~ $${paramIndex}`;
      params.push(`(\\(${year}\\)|[^0-9]${year}[^0-9])`);
      paramIndex++;
    }

    // 🎬 FILTER 1: Exclude series torrents when searching for movies
    if (excludeSeries) {
      query += ` AND (t.type IS NULL OR t.type != 'series')`;
    }

    // 🎬 FILTER 2: Only include files with matching IMDb or NULL
    // For multi-movie packs, files start with imdb_id=NULL and get auto-indexed when searched
    if (movieImdbId) {
      query += ` AND (f.imdb_id IS NULL OR f.imdb_id = $${paramIndex})`;
      params.push(movieImdbId);
      paramIndex++;
    }

    if (providers && Array.isArray(providers) && providers.length > 0) {
      const patterns = providers.map((p, i) => `t.provider ILIKE $${paramIndex + i}`).join(' OR ');
      query += ` AND (${patterns})`;
      params.push(...providers.map(p => `%${p}%`));
    }

    query += ' ORDER BY t.cached_rd DESC NULLS LAST, t.seeders DESC LIMIT 20';
    const result = await pool.query(query, params);
    if (DEBUG_MODE) console.log(`💾 [DB] Found ${result.rows.length} file-matches (ILIKE) for "${titleQuery}"`);

    // 🔧 SMART AUTO-INDEX: Only assign IMDb ID to files that match the EXACT year
    // This prevents "Back to the Future Part 2 (1989)" getting tt0088763 (1985)
    if (result.rows.length > 0 && movieImdbId && year) {
      const yearStr = String(year);
      let indexedCount = 0;

      for (const row of result.rows) {
        if (row.file_imdb_id) continue; // Already has IMDb ID

        const fileTitle = row.file_title || '';
        // Extract year from filename
        const fileYearMatch = fileTitle.match(/[\(\._](\d{4})[\)\._]/);
        const fileYear = fileYearMatch ? fileYearMatch[1] : null;

        // Only update if file year matches OR no year and single result
        const shouldUpdate = (fileYear === yearStr) ||
          (!fileYear && result.rows.length === 1);

        if (!shouldUpdate) {
          if (DEBUG_MODE) console.log(`   ⏭️  [DB] Skipping file "${fileTitle}" - year ${fileYear || 'none'} != ${yearStr}`);
          continue;
        }

        try {
          await pool.query(
            'UPDATE files SET imdb_id = $1 WHERE info_hash = $2 AND file_index = $3 AND imdb_id IS NULL',
            [movieImdbId, row.info_hash, row.file_index]
          );
          indexedCount++;
          if (DEBUG_MODE) console.log(`   📝 [DB] Auto-indexed ${movieImdbId} (${yearStr}) -> file "${fileTitle}" in ${row.info_hash.substring(0, 8)}`);
        } catch (updateErr) {
          // Ignore update errors
        }
      }

      if (indexedCount > 0) {
        console.log(`   🏷️  Auto-indexed ${indexedCount}/${result.rows.length} file(s) with ${movieImdbId} (year ${year})`);
      }
    }

    return result.rows;
  };

  try {
    // Basic sanitation
    const cleanQuery = titleQuery.replace(/[^\w\s]/g, ' ').trim().replace(/\s+/g, ' & ');
    if (DEBUG_MODE) console.log(`💾 [DB] Searching FILES by title: "${titleQuery}"${year ? ` (${year})` : ''} (FTS: ${cleanQuery})${movieImdbId ? ` [filter: imdb=${movieImdbId}]` : ''}${excludeSeries ? ' [exclude series]' : ''}`);

    let query = `
      SELECT
        f.file_index,
        f.title as file_title,
        f.size as file_size,
        t.info_hash,
        t.provider,
        t.title as torrent_title,
        t.size as torrent_size,
        t.seeders,
        t.imdb_id,
        t.cached_rd,
        t.type as torrent_type,
        f.imdb_id as file_imdb_id
      FROM files f
      JOIN torrents t ON f.info_hash = t.info_hash
      WHERE to_tsvector('english', f.title) @@ to_tsquery('english', $1)
    `;

    const params = [cleanQuery];
    let paramIndex = 2;

    // 🎬 FILTER: Year in filename (e.g. "(2013)" or ".2013.")
    if (year) {
      query += ` AND f.title ~ $${paramIndex}`;
      params.push(`(\\(${year}\\)|[^0-9]${year}[^0-9])`);
      paramIndex++;
    }

    // 🎬 FILTER 1: Exclude series torrents when searching for movies
    if (excludeSeries) {
      query += ` AND (t.type IS NULL OR t.type != 'series')`;
    }

    // 🎬 FILTER 2: Only include files with matching IMDb or NULL (unknown)
    if (movieImdbId) {
      query += ` AND (f.imdb_id IS NULL OR f.imdb_id = $${paramIndex})`;
      params.push(movieImdbId);
      paramIndex++;
    }

    if (providers && Array.isArray(providers) && providers.length > 0) {
      const patterns = providers.map((p, i) => `t.provider ILIKE $${paramIndex + i}`).join(' OR ');
      query += ` AND (${patterns})`;
      params.push(...providers.map(p => `%${p}%`));
    }

    query += ' ORDER BY t.cached_rd DESC NULLS LAST, t.seeders DESC LIMIT 20';

    const result = await pool.query(query, params);
    if (DEBUG_MODE) console.log(`💾 [DB] Found ${result.rows.length} file-matches (FTS) for "${titleQuery}"`);

    // 🔧 FIX: If FTS returns 0 results, also try ILIKE fallback
    // This is needed for file titles like "(2013) Frozen.mkv" where FTS doesn't index well
    if (result.rows.length > 0) {
      return result.rows;
    }
    if (DEBUG_MODE) console.log(`💾 [DB] FTS returned 0 results, trying ILIKE fallback...`);
    const ilikeResults = await runIlikeSearch();
    return ilikeResults;

  } catch (error) {
    // Fallback if FTS syntax error (e.g. strict chars)
    console.warn(`⚠️ [DB] FTS File Search failed, trying simple ILIKE. Error: ${error.message}`);
    try {
      const ilikeResults = await runIlikeSearch();
      return ilikeResults;
    } catch (err2) {
      console.error(`❌ [DB] Error searching files by title:`, err2.message);
      return [];
    }
  }
}

/**
 * Delete all pack files cache for a specific infoHash
 * Used to clear corrupted cache entries
 * @param {string} infoHash - InfoHash of the pack
 * @returns {Promise<number>} Number of deleted rows
 */
async function deletePackFilesCache(infoHash) {
  if (!pool) throw new Error('Database not initialized');

  try {
    const hashLower = infoHash.toLowerCase();
    const result = await pool.query(
      'DELETE FROM pack_files WHERE pack_hash = $1',
      [hashLower]
    );
    console.log(`🗑️ [DB] Deleted ${result.rowCount} cached files for pack ${infoHash.substring(0, 8)}`);
    return result.rowCount;
  } catch (error) {
    console.error(`❌ [DB] Error deleting pack cache: ${error.message}`);
    return 0;
  }
}

// ============================================================================
// 🌐 GLOBAL TORRENT SEARCH CACHE - Persistent cache shared across all users
// ============================================================================

/**
 * Get cached torrent search results from DB
 * @param {string} cacheKey - Cache key (format: torrent:type:id:db=boolean)
 * @param {number} ttlHours - TTL in hours (default 6)
 * @returns {Promise<Object|null>} Cached data or null if not found/expired
 */
async function getTorrentSearchCache(cacheKey, ttlHours = 6) {
  if (!pool) return null;

  try {
    const result = await pool.query(`
      SELECT filtered_results, media_details, season, episode, imdb_id, created_at
      FROM torrent_search_cache
      WHERE cache_key = $1
        AND created_at > NOW() - INTERVAL '${ttlHours} hours'
    `, [cacheKey]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const ageMinutes = Math.round((Date.now() - new Date(row.created_at).getTime()) / 60000);
    console.log(`💾 [DB CACHE HIT] Key: ${cacheKey.substring(0, 50)}... | Age: ${ageMinutes}m`);

    return {
      filteredResults: row.filtered_results,
      mediaDetails: row.media_details,
      season: row.season,
      episode: row.episode,
      imdbId: row.imdb_id,
      createdAt: row.created_at
    };
  } catch (error) {
    console.error(`❌ [DB Cache] Error getting cache: ${error.message}`);
    return null;
  }
}

/**
 * Save torrent search results to DB cache
 * @param {string} cacheKey - Cache key
 * @param {Object} data - Data to cache (filteredResults, mediaDetails, etc.)
 * @returns {Promise<boolean>} Success status
 */
async function setTorrentSearchCache(cacheKey, data) {
  if (!pool) return false;

  try {
    await pool.query(`
      INSERT INTO torrent_search_cache
        (cache_key, filtered_results, media_details, season, episode, imdb_id, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (cache_key)
      DO UPDATE SET
        filtered_results = EXCLUDED.filtered_results,
        media_details = EXCLUDED.media_details,
        season = EXCLUDED.season,
        episode = EXCLUDED.episode,
        imdb_id = EXCLUDED.imdb_id,
        created_at = NOW()
    `, [
      cacheKey,
      JSON.stringify(data.filteredResults || []),
      JSON.stringify(data.mediaDetails || null),
      data.season || null,
      data.episode || null,
      data.imdbId || null
    ]);

    console.log(`💾 [DB CACHE SAVE] Key: ${cacheKey.substring(0, 50)}... | Results: ${data.filteredResults?.length || 0}`);
    return true;
  } catch (error) {
    console.error(`❌ [DB Cache] Error saving cache: ${error.message}`);
    return false;
  }
}

/**
 * Cleanup expired torrent search cache entries
 * @param {number} ttlHours - TTL in hours (default 6)
 * @returns {Promise<number>} Number of deleted entries
 */
async function cleanupTorrentSearchCache(ttlHours = 6) {
  if (!pool) return 0;

  try {
    const result = await pool.query(`
      DELETE FROM torrent_search_cache
      WHERE created_at < NOW() - INTERVAL '${ttlHours} hours'
    `);

    if (result.rowCount > 0) {
      console.log(`🧹 [DB Cache] Cleaned up ${result.rowCount} expired entries`);
    }
    return result.rowCount;
  } catch (error) {
    console.error(`❌ [DB Cache] Error cleaning cache: ${error.message}`);
    return 0;
  }
}

// ✅ ADDED: Update torrent title (for fixing pack names)
/**
 * Update the title of a torrent in the database
 * Used to fix pack names after resolving from RD/TB
 * @param {string} infoHash - Torrent info hash
 * @param {string} newTitle - New title to set
 * @returns {Promise<boolean>} True if updated, false otherwise
 */
async function updateTorrentTitle(infoHash, newTitle) {
  if (!pool) throw new Error('Database not initialized');

  try {
    const query = 'UPDATE torrents SET title = $1 WHERE info_hash = $2';
    const result = await pool.query(query, [newTitle, infoHash.toLowerCase()]);

    if (result.rowCount > 0) {
      console.log(`✅ [DB] Updated title for ${infoHash.substring(0, 8)}... -> "${newTitle.substring(0, 50)}..."`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`❌ [DB] Error updating torrent title:`, error.message);
    return false;
  }
}

/**
 * Update the provider label of a torrent in the database.
 * @param {string} infoHash - Torrent info hash
 * @param {string} provider - Provider label to set
 * @returns {Promise<boolean>} True if updated, false otherwise
 */
async function updateTorrentProvider(infoHash, provider) {
  if (!pool) throw new Error('Database not initialized');

  try {
    const query = 'UPDATE torrents SET provider = $1 WHERE info_hash = $2';
    const result = await pool.query(query, [provider, infoHash.toLowerCase()]);
    return result.rowCount > 0;
  } catch (error) {
    console.error(`❌ [DB] Error updating provider:`, error.message);
    return false;
  }
}

/**
 * Get the title (filename) for a specific episode from the files table
 * Used by rd-stream as fallback when pattern matching fails (e.g. "HNK 001...mkv" not recognized)
 * The DB already has imdb_season/imdb_episode from manual imports, so we just look up the filename
 * @param {string} infoHash
 * @param {number} season
 * @param {number} episode
 * @returns {Promise<string|null>}
 */
async function getEpisodeTitle(infoHash, season, episode) {
  if (!pool) return null;
  try {
    const result = await pool.query(
      'SELECT title FROM files WHERE info_hash = $1 AND imdb_season = $2 AND imdb_episode = $3 LIMIT 1',
      [infoHash.toLowerCase(), season, episode]
    );
    return result.rows.length > 0 ? result.rows[0].title : null;
  } catch (e) {
    return null;
  }
}

module.exports = {
  initDatabase,
  getTorrent,
  updateTorrentTitle,
  updateTorrentProvider,
  searchByImdbId,
  searchByTmdbId,
  searchEpisodeFiles,
  searchByTitleFTS,
  insertTorrent,
  updateRdCacheStatus,
  getRdCachedAvailability,
  refreshRdCacheTimestamp,
  updateTbCacheStatus,
  getTbCachedAvailability,
  refreshTbCacheTimestamp,
  batchInsertTorrents,
  updateTorrentFileInfo,
  deleteFileInfo,
  updateRdLinkIndex,
  updateRdLinkIndexForPack,
  getImdbIdByHash,
  updateTorrentsWithIds,
  searchPacksByImdbId,
  searchPacksByTitle,
  insertPackFiles,
  getPackFiles,
  getSeriesPackFiles,
  insertEpisodeFiles,
  getEpisodeTitle,
  closeDatabase,
  searchFilesByTitle,
  deletePackFilesCache,
  // 🚀 Pack optimization
  getIsTorrentPack,
  batchGetIsTorrentPack,
  updateIsTorrentPack,
  // 🌐 Global Torrent Search Cache
  getTorrentSearchCache,
  setTorrentSearchCache,
  cleanupTorrentSearchCache,
  // 🏷️ Provider Priority (shared)
  getProviderPriority
};
