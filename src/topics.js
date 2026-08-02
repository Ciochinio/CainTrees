// Mining topic facets out of video titles, so the catalogue can be browsed by
// subject rather than only by who-links-whom.

const STOPWORDS = new Set(
  `a an the and or but if then than that this these those of in on at to for from by with without
   is are was were be been being am do does did doing done have has had having will would shall
   should can could may might must not no nor so as it its it's i i'm i've me my mine you your
   yours we our ours they them their there here what when where which who whom why how all any
   both each few more most other some such only own same too very just about into over under
   again further once more new old first last one two three part vs versus my me let lets get
   got make makes made go goes going come comes came take takes took use uses used
   video videos channel talk talks talking thing things stuff way ways thoughts thought
   today tomorrow yesterday week month year years day days time times`
    .split(/\s+/)
    .filter(Boolean),
);

// Kept despite being short — they're real subjects on a game-dev channel.
const SHORT_ALLOW = new Set(['ai', 'qa', 'ui', 'vo', 'rpg', 'npc', 'dev', 'bug', 'fun', 'job']);

const MIN_VIDEOS = 3; // below this a term is noise
const MAX_SHARE = 0.35; // above this a term describes the whole channel, not a topic

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function usable(token) {
  if (STOPWORDS.has(token)) return false;
  if (token.length >= 3) return true;
  return SHORT_ALLOW.has(token);
}

/** Crude singular form — enough to merge "stories"/"story" and "games"/"game". */
function singular(token) {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith('es') && /(s|x|z|ch|sh)es$/.test(token)) {
    return token.slice(0, -2);
  }
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function addHit(map, term, id, surface) {
  let entry = map.get(term);
  if (!entry) {
    entry = { term, ids: new Set(), surfaces: new Map() };
    map.set(term, entry);
  }
  entry.ids.add(id);
  // Remember how the word was actually written so the chip can read
  // "analytics" rather than the stemmed "analytic".
  const form = surface || term;
  entry.surfaces.set(form, (entry.surfaces.get(form) || 0) + 1);
}

function bestLabel(entry) {
  let label = entry.term;
  let best = -1;
  for (const [form, count] of entry.surfaces) {
    if (count > best) {
      best = count;
      label = form;
    }
  }
  return label;
}

/**
 * Build topic facets from the channel's own videos.
 *
 * Terms are counted per video, not per occurrence, and anything appearing in
 * more than a third of the catalogue is dropped — "game" on a game-dev channel
 * is not a topic. Two-word phrases are kept where they carry the meaning, and
 * the uploader's own tags are folded in when present since they cost nothing.
 *
 * Returns facets sorted by video count, descending.
 */
export function extractTopics(tree) {
  const videos = [];
  for (const node of tree.nodes.values()) {
    if (node.isChannel || node.offChannel || !node.video) continue;
    videos.push(node);
  }
  if (!videos.length) return [];

  const unigrams = new Map();
  const bigrams = new Map();
  const tags = new Map();

  for (const node of videos) {
    const raw = tokenize(node.video.title);
    const tokens = raw.map(singular);
    const seen = new Set();
    tokens.forEach((token, index) => {
      if (!usable(token) || seen.has(token)) return;
      seen.add(token);
      addHit(unigrams, token, node.id, raw[index]);
    });

    // Phrases from adjacent surviving words: "outer world", "character creation".
    for (let i = 0; i < tokens.length - 1; i++) {
      const a = tokens[i];
      const b = tokens[i + 1];
      if (!usable(a) || !usable(b)) continue;
      addHit(bigrams, `${a} ${b}`, node.id, `${raw[i]} ${raw[i + 1]}`);
    }

    for (const raw of node.video.tags || []) {
      const tag = String(raw).toLowerCase().trim();
      if (tag.length < 3 || tag.length > 30) continue;
      addHit(tags, tag, node.id, tag);
    }
  }

  const floor = MIN_VIDEOS;
  const ceiling = Math.max(MIN_VIDEOS + 1, Math.floor(videos.length * MAX_SHARE));
  const viable = (entry) => entry.ids.size >= floor && entry.ids.size <= ceiling;

  const words = [...unigrams.values()].filter(viable);

  // A phrase earns its place only when both of its words are near-inseparable.
  // "outer worlds" qualifies; "combat design" does not — it's a slice of the far
  // larger "combat", and keeping it would crowd out genuinely distinct topics.
  const phrases = [...bigrams.values()].filter((phrase) => {
    if (!viable(phrase)) return false;
    const [a, b] = phrase.term.split(' ');
    const widest = Math.max(unigrams.get(a)?.ids.size || 0, unigrams.get(b)?.ids.size || 0);
    return phrase.ids.size >= widest * 0.8;
  });

  // Then the surviving phrase replaces its constituent words.
  const covered = new Set();
  for (const phrase of phrases) {
    for (const word of phrase.term.split(' ')) {
      const entry = unigrams.get(word);
      if (entry && phrase.ids.size >= entry.ids.size * 0.8) covered.add(word);
    }
  }

  const facets = new Map();
  for (const entry of [...phrases, ...words.filter((w) => !covered.has(w.term))]) {
    facets.set(entry.term, entry);
  }
  // Tags are already human-chosen, so they get in regardless of the phrase rule.
  for (const entry of tags.values()) {
    if (!viable(entry) || facets.has(entry.term)) continue;
    facets.set(entry.term, entry);
  }

  return [...facets.values()]
    .map((entry) => ({ term: entry.term, label: bestLabel(entry), ids: entry.ids, count: entry.ids.size }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
}
