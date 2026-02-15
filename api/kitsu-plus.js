const KITSU_PLUS_BASE_URL = 'https://0f693ad7dcba-kitsu-search.baby-beamup.club';

const KITSU_PLUS_SEARCH_CATALOGS = [
  'kitsu-anime-search-tv',
  'kitsu-anime-search-movie',
  'kitsu-anime-search-ova',
  'kitsu-anime-search-ona',
  'kitsu-anime-search-special'
];

const KITSU_PLUS_TIMEOUT_MS = 15000;

const buildSearchUrl = (catalogId, query) => {
  const encodedQuery = encodeURIComponent(query);
  return `${KITSU_PLUS_BASE_URL}/catalog/anime/${catalogId}/search=${encodedQuery}.json`;
};

const fetchCatalog = async (url) => {
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0'
    },
    signal: AbortSignal.timeout(KITSU_PLUS_TIMEOUT_MS)
  });

  if (!response.ok) {
    return { metas: [] };
  }

  return response.json();
};

export const isKitsuPlusSearchCatalog = (catalogId) =>
  KITSU_PLUS_SEARCH_CATALOGS.includes(catalogId);

export const fetchKitsuPlusCatalog = async (catalogId, query) => {
  if (!query || !query.trim()) return [];
  if (!isKitsuPlusSearchCatalog(catalogId)) return [];

  const url = buildSearchUrl(catalogId, query);
  const data = await fetchCatalog(url);
  const metas = data?.metas || [];

  return metas.map((meta) => {
    if (!meta || !meta.id) return meta;
    const id = meta.id.startsWith('kitsu:') ? meta.id : `kitsu:${meta.id}`;
    return { ...meta, id };
  }).filter(Boolean);
};

export const fetchKitsuPlusSearch = async (query) => {
  if (!query || !query.trim()) return [];

  const urls = KITSU_PLUS_SEARCH_CATALOGS.map((catalogId) => buildSearchUrl(catalogId, query));

  const results = await Promise.allSettled(urls.map((url) => fetchCatalog(url)));
  const metaMap = new Map();

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const metas = result.value?.metas || [];
    for (const meta of metas) {
      if (!meta || !meta.id) continue;
      // Ensure kitsu id prefix
      const id = meta.id.startsWith('kitsu:') ? meta.id : `kitsu:${meta.id}`;
      if (!metaMap.has(id)) {
        metaMap.set(id, { ...meta, id });
      }
    }
  }

  return Array.from(metaMap.values());
};
