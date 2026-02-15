const STREAMING_COMMUNITY_BASE_URL = 'https://streamvix.hayd.uk/eyJtZWRpYWZsb3dNYXN0ZXIiOmZhbHNlLCJkdnJFbmFibGVkIjpmYWxzZSwiZGlzYWJsZUxpdmVUdiI6dHJ1ZSwidmF2b29Ob01mcEVuYWJsZWQiOnRydWUsInRyYWlsZXJFbmFibGVkIjpmYWxzZSwiZGlzYWJsZVZpeHNyYyI6ZmFsc2UsInZpeERpcmVjdCI6ZmFsc2UsInZpeERpcmVjdEZoZCI6dHJ1ZSwiY2IwMUVuYWJsZWQiOmZhbHNlLCJndWFyZGFoZEVuYWJsZWQiOmZhbHNlLCJndWFyZGFzZXJpZUVuYWJsZWQiOmZhbHNlLCJndWFyZG9zZXJpZUVuYWJsZWQiOmZhbHNlLCJndWFyZGFmbGl4RW5hYmxlZCI6ZmFsc2UsImV1cm9zdHJlYW1pbmdFbmFibGVkIjpmYWxzZSwibG9vbmV4RW5hYmxlZCI6ZmFsc2UsInRvb25pdGFsaWFFbmFibGVkIjpmYWxzZSwiYW5pbWVzYXR1cm5FbmFibGVkIjpmYWxzZSwiYW5pbWV3b3JsZEVuYWJsZWQiOmZhbHNlLCJhbmltZXVuaXR5RW5hYmxlZCI6ZmFsc2UsImFuaW1ldW5pdHlBdXRvIjpmYWxzZSwiYW5pbWV1bml0eUZoZCI6dHJ1ZSwidml4UHJveHkiOmZhbHNlLCJ2aXhQcm94eUZoZCI6ZmFsc2V9';
const STREAMING_COMMUNITY_TIMEOUT_MS = 180000;

const buildStreamPath = (type, imdbId, tmdbId, season, episode) => {
  if (type !== 'movie' && type !== 'series') return null;

  const useImdb = imdbId && imdbId.startsWith('tt');
  const idPart = useImdb ? imdbId : (tmdbId ? `tmdb:${tmdbId}` : null);
  if (!idPart) return null;

  if (type === 'series') {
    if (!season || !episode) return null;
    return `/stream/series/${idPart}:${season}:${episode}.json`;
  }

  return `/stream/movie/${idPart}.json`;
};

export const fetchStreamingCommunityStreams = async ({ type, imdbId, tmdbId, season, episode }) => {
  const path = buildStreamPath(type, imdbId, tmdbId, season, episode);
  if (!path) return [];

  const url = `${STREAMING_COMMUNITY_BASE_URL}${path}`;

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0'
    },
    signal: AbortSignal.timeout(STREAMING_COMMUNITY_TIMEOUT_MS)
  });

  if (!response.ok) return [];
  const data = await response.json();
  return data?.streams || [];
};
