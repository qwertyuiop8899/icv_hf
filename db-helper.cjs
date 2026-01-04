const { Pool } = require('pg');

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
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000, // Vercel timeout-friendly
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
    console.log(`💾 [DB] Searching by IMDb: ${imdbId}${type ? ` (${type})` : ''}${providers ? ` [providers: ${providers.join(',')}]` : ''}`);

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
        all_imdb_ids,
        cached_rd,
        last_cached_check,
        file_index,
        file_title
      FROM torrents 
      WHERE (imdb_id = $1 OR all_imdb_ids @> $2)
    `;

    const params = [imdbId, JSON.stringify([imdbId])];
    let paramIndex = 3;

    if (type) {
      query += ` AND type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    // ✅ PROVIDER FILTER: Only return torrents from selected providers
    // Use ILIKE patterns for case-insensitive matching and variants (e.g., 'Knaben (1337x)')
    if (providers && Array.isArray(providers) && providers.length > 0) {
      const patterns = providers.map((p, i) => `provider ILIKE $${paramIndex + i}`).join(' OR ');
      query += ` AND (${patterns})`;
      // Add % wildcards for partial matching (e.g., 'knaben' matches 'Knaben (1337x)')
      params.push(...providers.map(p => `%${p}%`));
    }

    query += ' ORDER BY cached_rd DESC NULLS LAST, seeders DESC LIMIT 50';

    const result = await pool.query(query, params);
    console.log(`💾 [DB] Found ${result.rows.length} torrents for IMDb ${imdbId}`);

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
    console.log(`💾 [DB] Searching by TMDb: ${tmdbId}${type ? ` (${type})` : ''}${providers ? ` [providers: ${providers.join(',')}]` : ''}`);

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
        all_imdb_ids,
        cached_rd,
        last_cached_check,
        file_index,
        file_title
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
      query += ` AND (${patterns})`;
      params.push(...providers.map(p => `%${p}%`));
    }

    query += ' ORDER BY cached_rd DESC NULLS LAST, seeders DESC LIMIT 50';

    const result = await pool.query(query, params);
    console.log(`💾 [DB] Found ${result.rows.length} torrents for TMDb ${tmdbId}`);

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
    console.log(`💾 [DB] Searching episode: ${imdbId} S${season}E${episode}${providers ? ` [providers: ${providers.join(',')}]` : ''}`);

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
        t.tmdb_id,
        t.cached_rd,
        t.last_cached_check
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
      query += ` AND (${patterns})`;
      params.push(...providers.map(p => `%${p}%`));
    }

    query += `
      ORDER BY t.cached_rd DESC NULLS LAST, t.seeders DESC
      LIMIT 50
    `;

    const result = await pool.query(query, params);
    console.log(`💾 [DB] Found ${result.rows.length} files for S${season}E${episode}`);

    return result.rows;
  } catch (error) {
    console.error(`❌ [DB] Error searching episode files:`, error.message);
    return [];
  }
}

/**
 * Insert new torrent into database
 * @param {Object} torrent - Torrent data
 * @returns {Promise<boolean>} Success status
 */
async function insertTorrent(torrent) {
  if (!pool) throw new Error('Database not initialized');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if torrent exists
    const checkResult = await client.query(
      'SELECT info_hash FROM torrents WHERE info_hash = $1',
      [torrent.infoHash]
    );

    if (checkResult.rows.length > 0) {
      console.log(`💾 [DB] Torrent ${torrent.infoHash} already exists, skipping`);
      await client.query('ROLLBACK');
      return false;
    }

    // Insert torrent
    await client.query(
      `INSERT INTO torrents (
        info_hash, provider, title, size, type, 
        upload_date, seeders, imdb_id, tmdb_id
      ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8)`,
      [
        torrent.infoHash,
        torrent.provider || 'ilcorsaronero',
        torrent.title,
        torrent.size || null,
        torrent.type,
        torrent.seeders || 0,
        torrent.imdbId || null,
        torrent.tmdbId || null
      ]
    );

    await client.query('COMMIT');
    console.log(`✅ [DB] Inserted torrent: ${torrent.title.substring(0, 60)}...`);
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
async function updateRdCacheStatus(cacheResults) {
  if (!pool) throw new Error('Database not initialized');
  if (!cacheResults || cacheResults.length === 0) return 0;

  try {
    let updated = 0;

    for (const result of cacheResults) {
      if (!result.hash) continue;

      const hashLower = result.hash.toLowerCase();

      // ✅ UPSERT: Insert if not exists, then update cache status and size
      // Required NOT NULL columns: info_hash, provider, title, type, upload_date
      const upsertQuery = `
        INSERT INTO torrents (
          info_hash, provider, title, type, upload_date, 
          cached_rd, last_cached_check, file_title, size
        )
        VALUES ($1, 'rd_cache', $2, 'unknown', NOW(), $3, NOW(), $4, $5)
        ON CONFLICT (info_hash) DO UPDATE SET
          cached_rd = EXCLUDED.cached_rd,
          last_cached_check = NOW(),
          file_title = COALESCE(NULLIF(EXCLUDED.file_title, ''), torrents.file_title),
          size = COALESCE(EXCLUDED.size, torrents.size),
          title = CASE WHEN torrents.provider = 'rd_cache' AND EXCLUDED.file_title IS NOT NULL THEN EXCLUDED.file_title ELSE torrents.title END
      `;

      // Use file_title as fallback title, or generate one from hash
      const fallbackTitle = result.file_title || `RD-${hashLower.substring(0, 8)}`;

      // ✅ FIX: Force cached_rd to true (we only call this for cached items)
      // Previously result.cached could be undefined which would insert NULL
      const cachedValue = result.cached === true ? true : (result.cached === false ? false : true);

      const params = [
        hashLower,                           // $1 info_hash
        fallbackTitle,                       // $2 title  
        cachedValue,                         // $3 cached_rd (forced to true if undefined)
        result.file_title || null,           // $4 file_title
        result.size || null                  // $5 size
      ];

      const res = await pool.query(upsertQuery, params);
      updated += res.rowCount;
    }

    console.log(`✅ [DB] Updated RD cache status for ${updated} torrents`);
    return updated;

  } catch (error) {
    console.error(`❌ [DB] Error updating RD cache:`, error.message);
    return 0;
  }
}

/**
 * Get cached RD availability for hashes (within 20 days)
 * @param {Array} hashes - Array of info hashes
 * @returns {Promise<Object>} Map of hash -> {cached: boolean, lastCheck: Date}
 */
async function getRdCachedAvailability(hashes) {
  if (!pool) throw new Error('Database not initialized');
  if (!hashes || hashes.length === 0) return {};

  try {
    const lowerHashes = hashes.map(h => h.toLowerCase());

    // Get cached results that are less than 20 days old
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

    console.log(`💾 [DB] Found ${result.rows.length}/${hashes.length} hashes with valid RD cache (< 10 days)`);

    // Debug: Show which hashes are cached
    const cachedTrue = result.rows.filter(r => r.cached_rd === true).length;
    const cachedFalse = result.rows.filter(r => r.cached_rd === false).length;
    console.log(`   📊 cached_rd=true: ${cachedTrue}, cached_rd=false: ${cachedFalse}`);

    return cachedMap;

  } catch (error) {
    console.error(`❌ [DB] Error getting RD cached availability:`, error.message);
    return {};
  }
}

/**
 * Refresh RD cache timestamp when user plays a cached file
 * This extends the cache validity to 10 more days
 * @param {string} infoHash - The torrent hash to refresh
 * @returns {Promise<boolean>} Success status
 */
async function refreshRdCacheTimestamp(infoHash) {
  if (!pool) return false;
  if (!infoHash) return false;

  try {
    const query = `
      UPDATE torrents 
      SET last_cached_check = NOW()
      WHERE info_hash = $1 AND cached_rd = true
    `;
    const result = await pool.query(query, [infoHash.toLowerCase()]);

    if (result.rowCount > 0) {
      console.log(`🔄 [DB] Refreshed RD cache timestamp for ${infoHash.substring(0, 8)}... (+10 days)`);
    }
    return result.rowCount > 0;
  } catch (error) {
    console.error(`❌ [DB] Error refreshing RD cache timestamp:`, error.message);
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

    for (const torrent of torrents) {
      try {
        const query = `
          INSERT INTO torrents (
            info_hash, provider, title, size, type, upload_date, 
            seeders, imdb_id, tmdb_id, cached_rd, last_cached_check, file_index
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (info_hash) DO UPDATE SET
            imdb_id = COALESCE(torrents.imdb_id, EXCLUDED.imdb_id),
            tmdb_id = COALESCE(torrents.tmdb_id, EXCLUDED.tmdb_id),
            size = CASE WHEN torrents.size = 0 OR torrents.size IS NULL THEN EXCLUDED.size ELSE torrents.size END,
            seeders = GREATEST(EXCLUDED.seeders, torrents.seeders),
            cached_rd = CASE 
              WHEN torrents.cached_rd = true THEN true  -- Never overwrite true with false
              WHEN EXCLUDED.cached_rd = true THEN true  -- Allow updating to true
              ELSE COALESCE(torrents.cached_rd, EXCLUDED.cached_rd)
            END,
            last_cached_check = CASE 
              WHEN EXCLUDED.last_cached_check IS NOT NULL 
              THEN GREATEST(EXCLUDED.last_cached_check, COALESCE(torrents.last_cached_check, EXCLUDED.last_cached_check))
              ELSE torrents.last_cached_check
            END,
            file_index = COALESCE(EXCLUDED.file_index, torrents.file_index)
        `;

        const values = [
          torrent.info_hash,
          torrent.provider,
          torrent.title,
          torrent.size,
          torrent.type,
          torrent.upload_date,
          torrent.seeders,
          torrent.imdb_id,
          torrent.tmdb_id,
          torrent.cached_rd,
          torrent.last_cached_check,
          torrent.file_index
        ];

        const res = await pool.query(query, values);
        if (res.rowCount > 0) inserted++;

      } catch (error) {
        // Log all errors (even duplicates now get updated)
        console.warn(`⚠️ [DB] Failed to insert/update torrent ${torrent.info_hash}:`, error.message);
      }
    }

    console.log(`✅ [DB] Batch upsert: ${inserted}/${torrents.length} torrents inserted/updated`);
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
async function updateTorrentFileInfo(infoHash, fileIndex, filePath, episodeInfo = null) {
  if (!pool) throw new Error('Database not initialized');

  try {
    console.log(`💾 [DB updateTorrentFileInfo] Input: hash=${infoHash}, fileIndex=${fileIndex}, filePath=${filePath}, episodeInfo=`, episodeInfo);

    // Extract just the filename from path
    const fileName = filePath.split('/').pop().split('\\').pop();
    console.log(`💾 [DB updateTorrentFileInfo] Extracted filename: ${fileName}`);

    // If episodeInfo is provided, save to 'files' table (for series episodes)
    if (episodeInfo && episodeInfo.imdbId && episodeInfo.season && episodeInfo.episode) {
      console.log(`💾 [DB] Saving episode file: ${episodeInfo.imdbId} S${episodeInfo.season}E${episodeInfo.episode}`);

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
        // Record already exists for this episode - just update the title if needed
        const updateQuery = `
          UPDATE files
          SET file_index = $1,
              title = $2
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
          episodeInfo.episode
        ]);
        console.log(`✅ [DB] Updated file in 'files' table: ${fileName} (rowCount=${res.rowCount})`);
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
          console.log(`⚠️ [DB] FileIndex ${fileIndex} already used for S${existing.imdb_season}E${existing.imdb_episode}, skipping S${episodeInfo.season}E${episodeInfo.episode}`);
          return false;
        }

        // Insert new file (UPSERT - update if exists)
        const insertQuery = `
          INSERT INTO files (info_hash, file_index, title, imdb_id, imdb_season, imdb_episode)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (info_hash, file_index) DO UPDATE SET
            title = EXCLUDED.title,
            imdb_id = EXCLUDED.imdb_id,
            imdb_season = EXCLUDED.imdb_season,
            imdb_episode = EXCLUDED.imdb_episode
        `;
        const res = await pool.query(insertQuery, [
          infoHash.toLowerCase(),
          fileIndex,
          fileName,
          episodeInfo.imdbId,
          episodeInfo.season,
          episodeInfo.episode
        ]);

        console.log(`✅ [DB] Upserted file into 'files' table: ${fileName}`);
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
      console.log(`✅ [DB] Updated torrents table: ${fileName} (rowCount=${res.rowCount})`);

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
    console.log(`✅ [DB] Deleted ${res.rowCount} file entries for hash ${infoHash}`);
    return res.rowCount;
  } catch (error) {
    console.error(`❌ [DB] Error deleting file info:`, error.message);
    return 0;
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
      console.log(`✅ [DB] Found imdb_id ${result.rows[0].imdb_id} for hash ${infoHash}`);
      return result.rows[0].imdb_id;
    }

    console.log(`⚠️ [DB] No imdb_id found for hash ${infoHash}`);
    return null;
  } catch (error) {
    console.error(`❌ [DB] Error fetching imdb_id:`, error.message);
    return null;
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
    console.log(`💾 [DB] Searching packs containing film: ${imdbId}`);

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
        pf.file_size,
        pf.imdb_id as film_imdb_id
      FROM torrents t
      INNER JOIN pack_files pf ON t.info_hash = pf.pack_hash
      WHERE pf.imdb_id = $1
      ORDER BY t.seeders DESC, t.size DESC
    `;

    const result = await pool.query(query, [imdbId]);
    console.log(`   ✅ Found ${result.rows.length} pack(s) containing ${imdbId}`);

    return result.rows;
  } catch (error) {
    console.error(`❌ Error searching packs by IMDb ${imdbId}:`, error.message);
    return [];
  }
}

/**
 * Insert pack files mapping
 * @param {Array} packFiles - Array of {pack_hash, imdb_id, file_index, file_path, file_size}
 * @returns {Promise<number>} Number of inserted records
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

    const query = `
      INSERT INTO pack_files (pack_hash, imdb_id, file_index, file_path, file_size)
      VALUES ${values.join(', ')}
      ON CONFLICT (pack_hash, imdb_id) DO UPDATE SET
        file_path = EXCLUDED.file_path,
        file_size = EXCLUDED.file_size
    `;

    const result = await pool.query(query, params);
    console.log(`   ✅ Inserted/updated ${result.rowCount} pack file mappings`);

    return result.rowCount;
  } catch (error) {
    console.error('❌ Error inserting pack files:', error.message);
    throw error;
  }
}

/**
 * Get pack files for a specific pack
 * @param {string} packHash - InfoHash of the pack
 * @returns {Promise<Array>} Array of file mappings
 */
async function getPackFiles(packHash) {
  if (!pool) throw new Error('Database not initialized');

  try {
    const query = `
      SELECT imdb_id, file_index, file_path, file_size
      FROM pack_files
      WHERE pack_hash = $1
      ORDER BY file_index ASC
    `;

    const result = await pool.query(query, [packHash]);
    return result.rows;
  } catch (error) {
    console.error(`❌ Error getting pack files for ${packHash}:`, error.message);
    return [];
  }
}

/**
 * Update all_imdb_ids of a pack torrent with all IMDb IDs found in pack_files
 * @param {string} packHash - InfoHash of the pack
 * @returns {Promise<boolean>} Success status
 */
async function updatePackAllImdbIds(packHash) {
  if (!pool) throw new Error('Database not initialized');

  try {
    // Get all IMDb IDs for this pack
    const filesQuery = `
      SELECT DISTINCT imdb_id 
      FROM pack_files 
      WHERE pack_hash = $1
      ORDER BY imdb_id
    `;

    const filesResult = await pool.query(filesQuery, [packHash]);

    if (filesResult.rows.length === 0) {
      console.log(`   ⚠️  No IMDb IDs found in pack_files for ${packHash}`);
      return false;
    }

    const imdbIds = filesResult.rows.map(row => row.imdb_id);
    console.log(`   📝 Updating pack ${packHash} with IMDb IDs: ${imdbIds.join(', ')}`);

    // Update torrents table with all_imdb_ids
    const updateQuery = `
      UPDATE torrents 
      SET all_imdb_ids = $1
      WHERE info_hash = $2
    `;

    const result = await pool.query(updateQuery, [JSON.stringify(imdbIds), packHash]);

    if (result.rowCount > 0) {
      console.log(`   ✅ Updated all_imdb_ids for pack ${packHash}`);
      return true;
    } else {
      console.log(`   ⚠️  Pack ${packHash} not found in torrents table`);
      return false;
    }

  } catch (error) {
    console.error(`❌ Error updating pack all_imdb_ids:`, error.message);
    return false;
  }
}

/**
 * Insert episode files from pack processing
 * @param {Array} episodeFiles - Array of {info_hash, file_index, title, size, imdb_id, imdb_season, imdb_episode}
 * @returns {Promise<number>} Number of inserted records
 */
async function insertEpisodeFiles(episodeFiles) {
  if (!pool) throw new Error('Database not initialized');
  if (!episodeFiles || episodeFiles.length === 0) return 0;

  try {
    let inserted = 0;

    for (const file of episodeFiles) {
      try {
        const query = `
          INSERT INTO files (info_hash, file_index, title, size, imdb_id, imdb_season, imdb_episode)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (info_hash, file_index) DO UPDATE SET
            title = EXCLUDED.title,
            size = EXCLUDED.size,
            imdb_id = EXCLUDED.imdb_id,
            imdb_season = EXCLUDED.imdb_season,
            imdb_episode = EXCLUDED.imdb_episode
        `;

        const res = await pool.query(query, [
          file.info_hash.toLowerCase(),
          file.file_index,
          file.title,
          file.size,
          file.imdb_id,
          file.imdb_season,
          file.imdb_episode
        ]);

        if (res.rowCount > 0) inserted++;

      } catch (error) {
        console.warn(`⚠️ [DB] Failed to insert episode file: ${error.message}`);
      }
    }

    console.log(`✅ [DB] Inserted ${inserted}/${episodeFiles.length} episode files`);
    return inserted;

  } catch (error) {
    console.error(`❌ [DB] Batch insert episode files error:`, error.message);
    return 0;
  }
}

/**
 * Get all files for a series pack from the DB
 * @param {string} infoHash - InfoHash of the torrent
 * @returns {Promise<Array>} Array of cached files
 */
async function getSeriesPackFiles(infoHash) {
  if (!pool) throw new Error('Database not initialized');

  try {
    const query = `
            SELECT file_index as id, title as path, size as bytes
            FROM files 
            WHERE info_hash = $1
            ORDER BY file_index ASC
        `;

    const result = await pool.query(query, [infoHash.toLowerCase()]);
    return result.rows.map(row => ({
      id: row.id,
      path: row.path,
      bytes: parseInt(row.bytes),
      selected: 1
    }));
  } catch (error) {
    console.error(`❌ [DB] Error getting series pack files: ${error.message}`);
    return [];
  }
}

module.exports = {
  initDatabase,
  searchByImdbId,
  searchByTmdbId,
  searchEpisodeFiles,
  searchByTitleFTS,
  insertTorrent,
  updateRdCacheStatus,
  getRdCachedAvailability,
  refreshRdCacheTimestamp,
  batchInsertTorrents,
  updateTorrentFileInfo,
  deleteFileInfo,
  getImdbIdByHash,
  updateTorrentsWithIds,
  searchPacksByImdbId,
  insertPackFiles,
  getPackFiles,
  getSeriesPackFiles,
  updatePackAllImdbIds,
  insertEpisodeFiles,
  closeDatabase
};
