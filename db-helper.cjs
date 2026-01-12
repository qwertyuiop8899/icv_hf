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
  
  // Run migrations
  runMigrations().catch(err => console.error('❌ Migration error:', err.message));
  
  return pool;
}

/**
 * Run database migrations (add missing columns)
 */
async function runMigrations() {
  if (!pool) return;
  
  try {
    // Add rd_link_index column to pack_files if not exists
    await pool.query(`
      ALTER TABLE pack_files 
      ADD COLUMN IF NOT EXISTS rd_link_index INTEGER DEFAULT NULL
    `);
    console.log('✅ DB Migration: pack_files.rd_link_index column ensured');
  } catch (error) {
    // Ignore if table doesn't exist yet
    if (!error.message.includes('does not exist')) {
      console.error('⚠️ Migration warning:', error.message);
    }
  }
  
  // 🔧 FIX: Create unique index on (pack_hash, file_index) for proper bulk insert
  try {
    // First drop the old constraint if it exists (on pack_hash, imdb_id)
    await pool.query(`
      ALTER TABLE pack_files DROP CONSTRAINT IF EXISTS pack_files_pack_hash_imdb_id_key
    `);
    
    // Create new unique index on (pack_hash, file_index)
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS pack_files_hash_fileindex_idx 
      ON pack_files (pack_hash, file_index)
    `);
    console.log('✅ DB Migration: pack_files unique index on (pack_hash, file_index) ensured');
  } catch (error) {
    // Ignore errors - constraint might not exist or index might already exist
    if (!error.message.includes('already exists')) {
      console.error('⚠️ Migration warning (pack_files index):', error.message);
    }
  }
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
        f.rd_link_index,
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
async function updateRdCacheStatus(cacheResults, mediaType = null) {
  if (!pool) throw new Error('Database not initialized');
  if (!cacheResults || cacheResults.length === 0) return 0;

  try {
    let updated = 0;
    let skipped = 0;

    for (const result of cacheResults) {
      if (!result.hash) continue;

      const hashLower = result.hash.toLowerCase();
      
      // ✅ Get real title (not placeholder)
      const realTitle = result.torrent_title || result.file_title || null;
      const cachedValue = result.cached === true ? true : (result.cached === false ? false : true);
      const torrentSize = result.size || result.file_size || null;

      // ✅ SMART SAVE: Check if hash already exists in DB
      const existsCheck = await pool.query(
        'SELECT info_hash, provider FROM torrents WHERE info_hash = $1',
        [hashLower]
      );
      const existsInDb = existsCheck.rows.length > 0;
      const existingProvider = existsInDb ? existsCheck.rows[0].provider : null;

      // ✅ SKIP useless placeholders:
      // - Hash NOT in DB (orphan from user's RD library)
      // - cached = false (not useful)
      // - No real title or file_title
      if (!existsInDb && cachedValue === false) {
        skipped++;
        continue; // Don't create garbage record
      }
      
      if (!existsInDb && !realTitle) {
        // Only create new record if cached=true (might be useful later)
        if (cachedValue !== true) {
          skipped++;
          continue;
        }
        // Even if cached=true, skip if no useful info at all
        if (!torrentSize) {
          skipped++;
          continue;
        }
      }

      // Use real title or minimal fallback (only for truly cached items)
      const titleToSave = realTitle || `RD-${hashLower.substring(0, 8)}`;

      // ✅ UPSERT: Insert if not exists, then update cache status and size
      const upsertQuery = `
        INSERT INTO torrents (
          info_hash, provider, title, type, upload_date, 
          cached_rd, last_cached_check, file_title, size
        )
        VALUES ($1, 'rd_cache', $2, $6, NOW(), $3, NOW(), $4, $5)
        ON CONFLICT (info_hash) DO UPDATE SET
          cached_rd = EXCLUDED.cached_rd,
          last_cached_check = NOW(),
          file_title = COALESCE(NULLIF(EXCLUDED.file_title, ''), torrents.file_title),
          size = COALESCE(EXCLUDED.size, torrents.size),
          title = CASE WHEN torrents.provider = 'rd_cache' THEN COALESCE(EXCLUDED.title, torrents.title) ELSE torrents.title END,
          type = CASE WHEN torrents.type = 'unknown' THEN COALESCE(EXCLUDED.type, torrents.type) ELSE torrents.type END
      `;

      const params = [
        hashLower,                           // $1 info_hash
        titleToSave,                         // $2 title  
        cachedValue,                         // $3 cached_rd
        result.file_title || null,           // $4 file_title
        torrentSize,                         // $5 size
        mediaType || 'unknown'               // $6 type
      ];

      const res = await pool.query(upsertQuery, params);
      updated += res.rowCount;
    }

    if (skipped > 0) {
      console.log(`⏭️  [DB] Skipped ${skipped} useless placeholder(s)`);
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
async function updateTorrentFileInfo(infoHash, fileIndex, filePath, fileSize = null, episodeInfo = null) {
  if (!pool) throw new Error('Database not initialized');

  try {
    console.log(`💾 [DB updateTorrentFileInfo] Input: hash=${infoHash}, fileIndex=${fileIndex}, size=${fileSize}, filePath=${filePath}, episodeInfo=`, episodeInfo);

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
      console.log(`✅ [DB] Saved rd_link_index=${rdLinkIndex} for ${infoHash.substring(0,8)}... file_index=${fileIndex}`);
      return true;
    } else {
      console.warn(`⚠️ [DB] No file found to update rd_link_index for ${infoHash.substring(0,8)}... file_index=${fileIndex}`);
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
      console.log(`✅ [DB] Pack: Saved rd_link_index=${rdLinkIndex} for file_id=${fileId} (${filename})`);
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
        console.log(`✅ [DB] Pack: Saved rd_link_index=${rdLinkIndex} for ${filename} (by filename match)`);
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
        pf.file_path as file_title,
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
    console.log(`💾 [DB] Searching packs by title: "${title}" (${year || 'no year'})`);

    // Build search pattern - clean title for ILIKE matching
    const cleanTitle = title.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')  // Remove special chars
      .replace(/\s+/g, '%')          // Replace spaces with wildcards
      .trim();
    
    const searchPattern = `%${cleanTitle}%`;
    const yearPattern = year ? `%${year}%` : null;

    // Search pack_files for matching file_path
    // This finds files like "(1986) Basil L'Investigatopo.mkv"
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
        pf.imdb_id as film_imdb_id
      FROM torrents t
      INNER JOIN pack_files pf ON t.info_hash = pf.pack_hash
      WHERE LOWER(pf.file_path) LIKE $1
        ${yearPattern ? 'AND pf.file_path LIKE $2' : ''}
      ORDER BY t.seeders DESC, t.size DESC
      LIMIT 20
    `;

    const params = yearPattern ? [searchPattern, yearPattern] : [searchPattern];
    const result = await pool.query(query, params);
    
    console.log(`   ✅ Found ${result.rows.length} pack file(s) matching "${title}"`);

    // If we found matches and have an imdbId, update pack_files to add the mapping
    if (result.rows.length > 0 && imdbId) {
      for (const row of result.rows) {
        try {
          await pool.query(`
            UPDATE pack_files 
            SET imdb_id = $1 
            WHERE pack_hash = $2 AND file_index = $3 AND (imdb_id IS NULL OR imdb_id = '')
          `, [imdbId, row.info_hash, row.file_index]);
          
          // Also update all_imdb_ids on torrents table
          await pool.query(`
            UPDATE torrents 
            SET all_imdb_ids = COALESCE(all_imdb_ids, '[]'::jsonb) || $1::jsonb
            WHERE info_hash = $2 
              AND NOT (COALESCE(all_imdb_ids, '[]'::jsonb) @> $1::jsonb)
          `, [JSON.stringify(imdbId), row.info_hash]);
          
          console.log(`   📝 [DB] Auto-indexed ${imdbId} -> pack ${row.info_hash.substring(0,8)}... file_idx=${row.file_index}`);
        } catch (updateErr) {
          // Ignore update errors (e.g., constraint violations)
        }
      }
    }

    return result.rows;
  } catch (error) {
    console.error(`❌ Error searching packs by title "${title}":`, error.message);
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
      ON CONFLICT (pack_hash, file_index) DO UPDATE SET
        imdb_id = COALESCE(EXCLUDED.imdb_id, pack_files.imdb_id),
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
      console.log(`💾 [DB] Found ${packResult.rows.length} files in pack_files for ${infoHash.substring(0, 8)}`);
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
      console.log(`💾 [DB] Found ${filesResult.rows.length} files in files table for ${infoHash.substring(0, 8)}`);
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

  try {
    // Basic sanitation
    const cleanQuery = titleQuery.replace(/[^\w\s]/g, ' ').trim().replace(/\s+/g, ' & ');
    console.log(`💾 [DB] Searching FILES by title: "${titleQuery}"${year ? ` (${year})` : ''} (FTS: ${cleanQuery})${movieImdbId ? ` [filter: imdb=${movieImdbId}]` : ''}${excludeSeries ? ' [exclude series]' : ''}`);

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
    console.log(`💾 [DB] Found ${result.rows.length} file-matches for "${titleQuery}"`);
    return result.rows;

  } catch (error) {
    // Fallback if FTS syntax error (e.g. strict chars)
    console.warn(`⚠️ [DB] FTS File Search failed, trying simple ILIKE. Error: ${error.message}`);
    try {
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
          WHERE f.title ILIKE $1
        `;
      const params = [`%${titleQuery}%`];
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
      console.log(`💾 [DB] Found ${result.rows.length} file-matches (ILIKE) for "${titleQuery}"`);
      return result.rows;
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
  updateRdLinkIndex,
  updateRdLinkIndexForPack,
  getImdbIdByHash,
  updateTorrentsWithIds,
  searchPacksByImdbId,
  searchPacksByTitle,
  insertPackFiles,
  getPackFiles,
  getSeriesPackFiles,
  updatePackAllImdbIds,
  insertEpisodeFiles,
  closeDatabase,
  searchFilesByTitle,
  deletePackFilesCache
};
