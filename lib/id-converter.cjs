const fetch = require('node-fetch');

// TMDb API Configuration
const TMDB_API_KEY = '5462f78469f3d80bf5201645294c16e4';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

/**
 * Convert IMDb ID to TMDb ID
 * @param {string} imdbId - IMDb ID (e.g., "tt0111161")
 * @returns {Promise<{tmdbId: number|null, type: string|null}>}
 */
async function imdbToTmdb(imdbId) {
  if (!imdbId || !imdbId.startsWith('tt')) {
    console.log(`⚠️  Invalid IMDb ID: ${imdbId}`);
    return { tmdbId: null, type: null };
  }

  try {
    console.log(`🔄 Converting IMDb→TMDb: ${imdbId}`);
    
    const url = `${TMDB_BASE_URL}/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
    const response = await fetch(url, { timeout: 10000 });
    
    if (!response.ok) {
      console.log(`❌ TMDb API error: ${response.status}`);
      return { tmdbId: null, type: null };
    }
    
    const data = await response.json();
    
    // Check movie results
    if (data.movie_results && data.movie_results.length > 0) {
      const tmdbId = data.movie_results[0].id;
      console.log(`✅ IMDb ${imdbId} → TMDb ${tmdbId} (movie)`);
      return { tmdbId, type: 'movie' };
    }
    
    // Check TV results
    if (data.tv_results && data.tv_results.length > 0) {
      const tmdbId = data.tv_results[0].id;
      console.log(`✅ IMDb ${imdbId} → TMDb ${tmdbId} (series)`);
      return { tmdbId, type: 'series' };
    }
    
    // Check TV episode results (some IMDb IDs point to episodes, extract show_id)
    if (data.tv_episode_results && data.tv_episode_results.length > 0) {
      const tmdbId = data.tv_episode_results[0].show_id;
      console.log(`✅ IMDb ${imdbId} → TMDb ${tmdbId} (series - from episode)`);
      return { tmdbId, type: 'series' };
    }
    
    console.log(`⚠️  No TMDb match found for IMDb ${imdbId}`);
    return { tmdbId: null, type: null };
    
  } catch (error) {
    console.error(`❌ Error converting IMDb→TMDb:`, error.message);
    return { tmdbId: null, type: null };
  }
}

/**
 * Convert TMDb ID to IMDb ID
 * @param {number} tmdbId - TMDb ID (e.g., 550)
 * @param {string} type - Media type: 'movie' or 'series'
 * @returns {Promise<string|null>} - IMDb ID or null
 */
async function tmdbToImdb(tmdbId, type) {
  if (!tmdbId || !type) {
    console.log(`⚠️  Invalid parameters: tmdbId=${tmdbId}, type=${type}`);
    return null;
  }

  // Normalize type
  const mediaType = type === 'series' ? 'tv' : 'movie';

  try {
    console.log(`🔄 Converting TMDb→IMDb: ${tmdbId} (${mediaType})`);
    
    const url = `${TMDB_BASE_URL}/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
    const response = await fetch(url, { timeout: 10000 });
    
    if (!response.ok) {
      console.log(`❌ TMDb API error: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    
    if (data.external_ids && data.external_ids.imdb_id) {
      const imdbId = data.external_ids.imdb_id;
      console.log(`✅ TMDb ${tmdbId} → IMDb ${imdbId}`);
      return imdbId;
    }
    
    console.log(`⚠️  No IMDb ID found for TMDb ${tmdbId}`);
    return null;
    
  } catch (error) {
    console.error(`❌ Error converting TMDb→IMDb:`, error.message);
    return null;
  }
}

/**
 * Get both IDs if only one is available
 * @param {string|null} imdbId - IMDb ID
 * @param {number|null} tmdbId - TMDb ID
 * @param {string} type - Media type: 'movie' or 'series'
 * @returns {Promise<{imdbId: string|null, tmdbId: number|null}>}
 */
async function completeIds(imdbId, tmdbId, type) {
  // If both IDs exist, return as-is
  if (imdbId && tmdbId) {
    console.log(`✅ Both IDs already present: IMDb=${imdbId}, TMDb=${tmdbId}`);
    return { imdbId, tmdbId };
  }

  // If only IMDb exists, convert to TMDb
  if (imdbId && !tmdbId) {
    console.log(`🔄 Only IMDb present (${imdbId}), converting to TMDb...`);
    const result = await imdbToTmdb(imdbId);
    return { imdbId, tmdbId: result.tmdbId };
  }

  // If only TMDb exists, convert to IMDb
  if (!imdbId && tmdbId) {
    console.log(`🔄 Only TMDb present (${tmdbId}), converting to IMDb...`);
    const convertedImdbId = await tmdbToImdb(tmdbId, type);
    return { imdbId: convertedImdbId, tmdbId };
  }

  // Neither ID exists
  console.log(`⚠️  No IDs available to convert`);
  return { imdbId: null, tmdbId: null };
}

module.exports = {
  imdbToTmdb,
  tmdbToImdb,
  completeIds
};
