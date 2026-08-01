// Pulling YouTube video ids out of free-form description text.

// The trailing lookahead matters: without it, a longer token like a playlist id
// would match on its first 11 characters and produce a bogus video id.
const YT_LINK =
  /(?:youtube\.com\/(?:watch\?(?:[\w%.+=&-]*&)?v=|shorts\/|embed\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/g;

const BARE_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Every YouTube video id linked from a description, in the order it appears,
 * de-duplicated. `selfId` (the video the description belongs to) is dropped so a
 * video never becomes its own child.
 */
export function extractVideoIds(description, selfId) {
  const ids = [];
  const seen = new Set(selfId ? [selfId] : []);
  for (const match of String(description || '').matchAll(YT_LINK)) {
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * Accepts a pasted URL in any of the supported shapes, or a bare 11-char id.
 * Returns the video id, or null if nothing usable is in there.
 */
export function parseVideoInput(input) {
  const str = String(input || '').trim();
  if (!str) return null;
  if (BARE_ID.test(str)) return str;
  const match = str.match(new RegExp(YT_LINK.source));
  return match ? match[1] : null;
}

export function watchUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}

const CHANNEL_URL =
  /youtube\.com\/(?:(channel)\/(UC[A-Za-z0-9_-]{22})|(user)\/([A-Za-z0-9_.-]+)|(@[A-Za-z0-9_.-]+))/i;

/**
 * Recognises the channel forms the API can resolve directly:
 * `/@handle`, `/channel/UC…`, `/user/legacyName`, or a bare `@handle` / `UC…` id.
 *
 * Returns { kind: 'handle' | 'id' | 'user', value } or null. `/c/vanityName` is
 * deliberately not handled — there's no API lookup for it that doesn't cost a
 * 100-unit search, and the @handle always exists as an alternative.
 */
export function parseChannelInput(input) {
  const str = String(input || '').trim();
  if (!str) return null;

  if (/^@[A-Za-z0-9_.-]+$/.test(str)) return { kind: 'handle', value: str };
  if (/^UC[A-Za-z0-9_-]{22}$/.test(str)) return { kind: 'id', value: str };

  const match = str.match(CHANNEL_URL);
  if (!match) return null;
  if (match[1]) return { kind: 'id', value: match[2] };
  if (match[3]) return { kind: 'user', value: match[4] };
  return { kind: 'handle', value: match[5] };
}

export function channelUrl(ref) {
  if (!ref) return 'https://www.youtube.com';
  if (ref.kind === 'handle') return `https://www.youtube.com/${ref.value}`;
  if (ref.kind === 'user') return `https://www.youtube.com/user/${ref.value}`;
  return `https://www.youtube.com/channel/${ref.value}`;
}
