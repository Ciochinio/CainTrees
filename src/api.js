// YouTube Data API v3 client: batching, localStorage cache, quota accounting.

const VIDEOS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos';
const CHANNELS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/channels';
const PLAYLIST_ITEMS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/playlistItems';
const PLAYLISTS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/playlists';

const CACHE_PREFIX = 'ytree:v1:';
const VIDEO_PREFIX = `${CACHE_PREFIX}v:`;
const CHANNEL_PREFIX = `${CACHE_PREFIX}c:`;
const ITEMS_PREFIX = `${CACHE_PREFIX}pi:`;
const PLAYLISTS_PREFIX = `${CACHE_PREFIX}pl:`;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const LIST_TTL_MS = 12 * 60 * 60 * 1000; // a channel gains videos; don't hold this long

const BATCH_SIZE = 50; // API maximum for videos.list, and still only 1 quota unit
const CONCURRENCY = 2;
const REQUEST_TIMEOUT_MS = 25000;

export class ApiError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
  }
}

export const stats = { requests: 0, cacheHits: 0 };

export function resetStats() {
  stats.requests = 0;
  stats.cacheHits = 0;
}

function readCache(key, ttl = WEEK_MS) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.fetchedAt > ttl) {
      localStorage.removeItem(key);
      return null;
    }
    return entry.value;
  } catch {
    return null;
  }
}

function writeCache(key, value) {
  const payload = JSON.stringify({ fetchedAt: Date.now(), value });
  try {
    localStorage.setItem(key, payload);
  } catch {
    // Storage full — drop the oldest half of our entries and try once more.
    pruneCache(0.5);
    try {
      localStorage.setItem(key, payload);
    } catch {
      /* give up; the cache is an optimisation, not a requirement */
    }
  }
}

function cacheKeys(prefix = CACHE_PREFIX) {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

function pruneCache(fraction) {
  const entries = cacheKeys()
    .map((key) => {
      let fetchedAt = 0;
      try {
        fetchedAt = JSON.parse(localStorage.getItem(key)).fetchedAt || 0;
      } catch {
        /* malformed entry sorts first and gets dropped */
      }
      return { key, fetchedAt };
    })
    .sort((a, b) => a.fetchedAt - b.fetchedAt);
  const count = Math.max(1, Math.floor(entries.length * fraction));
  for (const entry of entries.slice(0, count)) localStorage.removeItem(entry.key);
}

export function clearCache() {
  const keys = cacheKeys();
  for (const key of keys) localStorage.removeItem(key);
  return keys.length;
}

export function cacheSize() {
  return cacheKeys(VIDEO_PREFIX).length;
}

function toVideo(item) {
  const snippet = item.snippet || {};
  const thumbs = snippet.thumbnails || {};
  return {
    id: item.id,
    title: snippet.title || '(untitled)',
    channelTitle: snippet.channelTitle || '',
    description: snippet.description || '',
    publishedAt: snippet.publishedAt || '',
    tags: snippet.tags || [], // free with the snippet part; feeds topic facets
    thumb: (thumbs.medium || thumbs.default || {}).url || '',
  };
}

/**
 * A request that never settles is indistinguishable from a hung app, so every
 * call carries its own deadline alongside the caller's cancel signal.
 */
function withDeadline(signal) {
  const timeout = AbortSignal.timeout?.(REQUEST_TIMEOUT_MS);
  if (!timeout) return { signal, timedOut: () => false };
  const timedOut = () => timeout.aborted;
  if (!signal) return { signal: timeout, timedOut };
  if (AbortSignal.any) return { signal: AbortSignal.any([signal, timeout]), timedOut };
  return { signal, timedOut: () => false };
}

async function apiGet(endpoint, params, signal) {
  const url = `${endpoint}?${new URLSearchParams(params)}`;
  const deadline = withDeadline(signal);

  let response;
  try {
    response = await fetch(url, { signal: deadline.signal });
  } catch (err) {
    if (signal?.aborted) throw err; // the user cancelled
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      if (deadline.timedOut()) {
        throw new ApiError(
          `No reply from the YouTube API after ${REQUEST_TIMEOUT_MS / 1000}s. Check your connection and try again.`,
          'network',
        );
      }
      throw err;
    }
    throw new ApiError('Network request failed — are you offline?', 'network');
  }

  if (!response.ok) {
    let reason = '';
    let message = '';
    try {
      const body = await response.json();
      reason = body.error?.errors?.[0]?.reason || '';
      message = body.error?.message || '';
    } catch {
      /* non-JSON error body */
    }
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
      throw new ApiError(
        'Daily API quota exhausted. It resets at midnight Pacific time.',
        'quota',
      );
    }
    if (response.status === 400 || reason === 'keyInvalid') {
      throw new ApiError('That API key was rejected as invalid.', 'key');
    }
    if (response.status === 403) {
      throw new ApiError(
        message ||
          'API key refused: check that the YouTube Data API v3 is enabled and any referrer restriction allows this page.',
        'key',
      );
    }
    throw new ApiError(message || `API error ${response.status}.`, 'http');
  }

  stats.requests++;
  return response.json();
}

async function fetchBatch(ids, key, signal) {
  const body = await apiGet(
    VIDEOS_ENDPOINT,
    { part: 'snippet', maxResults: BATCH_SIZE, id: ids.join(','), key },
    signal,
  );
  return (body.items || []).map(toVideo);
}

/**
 * Resolve a channel reference from parseChannelInput() to its id, title, and
 * uploads playlist. 1 quota unit, cached for a week.
 */
export async function fetchChannel(ref, { key, signal } = {}) {
  const cacheKey = `${CHANNEL_PREFIX}${ref.kind}:${ref.value.toLowerCase()}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const params = { part: 'snippet,contentDetails', key };
  if (ref.kind === 'id') params.id = ref.value;
  else if (ref.kind === 'handle') params.forHandle = ref.value;
  else params.forUsername = ref.value;

  const body = await apiGet(CHANNELS_ENDPOINT, params, signal);
  const item = (body.items || [])[0];
  if (!item) {
    throw new ApiError(
      `No channel found for "${ref.value}". Try the /@handle or /channel/UC… form of the URL.`,
      'notfound',
    );
  }

  const snippet = item.snippet || {};
  const thumbs = snippet.thumbnails || {};
  const channel = {
    id: item.id,
    title: snippet.title || ref.value,
    thumb: (thumbs.default || thumbs.medium || {}).url || '',
    uploads: item.contentDetails?.relatedPlaylists?.uploads || '',
  };
  if (!channel.uploads) throw new ApiError('That channel exposes no uploads playlist.', 'notfound');
  writeCache(cacheKey, channel);
  return channel;
}

/**
 * Every playlist the channel publishes, in the order YouTube returns them.
 * One request per 50 playlists, 1 unit each, cached for 12 hours.
 *
 * These are the author's own groupings — the counterpart to the topics mined
 * from titles, and usually the more deliberate of the two.
 */
export async function fetchPlaylists(channelId, { key, signal, max = 200, onPage = () => {} } = {}) {
  const cacheKey = PLAYLISTS_PREFIX + channelId;
  const cached = readCache(cacheKey, LIST_TTL_MS);
  if (cached) return cached.slice(0, max);

  const playlists = [];
  const seenTokens = new Set();
  let pageToken;

  do {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const body = await apiGet(
      PLAYLISTS_ENDPOINT,
      {
        part: 'snippet,contentDetails',
        maxResults: BATCH_SIZE,
        channelId,
        key,
        ...(pageToken ? { pageToken } : {}),
      },
      signal,
    );

    const before = playlists.length;
    for (const item of body.items || []) {
      const snippet = item.snippet || {};
      playlists.push({
        id: item.id,
        title: snippet.title || '(untitled playlist)',
        publishedAt: snippet.publishedAt || '',
        itemCount: item.contentDetails?.itemCount ?? 0,
      });
    }
    pageToken = body.nextPageToken;
    onPage(playlists.length);

    // Same cursor guard as the item walk: never let a stuck token spin here.
    if (playlists.length === before || (pageToken && seenTokens.has(pageToken))) break;
    if (pageToken) seenTokens.add(pageToken);
  } while (pageToken && playlists.length < max);

  if (!pageToken) writeCache(cacheKey, playlists);
  return playlists.slice(0, max);
}

/**
 * Every video id in a playlist, in playlist order. One request per 50 ids,
 * 1 unit each. Cached for 12 hours since the channel keeps publishing.
 *
 * Used for the uploads playlist that defines a channel's catalogue, and for
 * each of the author's own playlists.
 *
 * Returns { ids, complete } — `complete` is false only when `max` cut the walk
 * short, which is different from a playlist that happens to hold exactly `max`
 * videos.
 */
export async function fetchPlaylistIds(playlistId, { key, signal, max = 1000, onPage = () => {} } = {}) {
  const cacheKey = ITEMS_PREFIX + playlistId;
  const cached = readCache(cacheKey, LIST_TTL_MS);
  if (cached) return { ids: cached.slice(0, max), complete: cached.length <= max };

  const ids = [];
  const seenTokens = new Set();
  let pageToken;
  let stalled = false;

  do {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const body = await apiGet(
      PLAYLIST_ITEMS_ENDPOINT,
      { part: 'contentDetails', maxResults: BATCH_SIZE, playlistId, key, ...(pageToken ? { pageToken } : {}) },
      signal,
    );

    const before = ids.length;
    for (const item of body.items || []) {
      const id = item.contentDetails?.videoId;
      if (id) ids.push(id);
    }
    pageToken = body.nextPageToken;
    onPage(ids.length);

    // Never trust the cursor to advance: a page that adds nothing, or a repeated
    // token, would otherwise spin here forever burning quota.
    if (ids.length === before || (pageToken && seenTokens.has(pageToken))) {
      stalled = true;
      break;
    }
    if (pageToken) seenTokens.add(pageToken);
  } while (pageToken && ids.length < max);

  // Only cache a list we walked to the end — a run cut short by `max` would
  // otherwise masquerade as the channel's full catalogue on the next run.
  if (!pageToken && !stalled) writeCache(cacheKey, ids);
  return { ids: ids.slice(0, max), complete: !pageToken && !stalled };
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Look up many videos at once. Returns a Map of id -> video for everything that
 * resolved; ids missing from the map are private, deleted, or never existed.
 * Cached videos cost no request. Rejects with ApiError, or AbortError on cancel.
 */
export async function fetchVideos(ids, { key, signal, onProgress = () => {} } = {}) {
  const found = new Map();
  const misses = [];

  for (const id of ids) {
    const cached = readCache(VIDEO_PREFIX + id);
    if (cached) {
      stats.cacheHits++;
      found.set(id, cached);
    } else {
      misses.push(id);
    }
  }

  if (misses.length) {
    if (!key) throw new ApiError('No API key set.', 'key');
    const batches = chunk(misses, BATCH_SIZE);
    let next = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, batches.length) }, async () => {
      while (next < batches.length) {
        if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        const batch = batches[next++];
        for (const video of await fetchBatch(batch, key, signal)) {
          writeCache(VIDEO_PREFIX + video.id, video);
          found.set(video.id, video);
        }
        onProgress(found.size, ids.length);
      }
    });
    await Promise.all(workers);
  }

  return found;
}
