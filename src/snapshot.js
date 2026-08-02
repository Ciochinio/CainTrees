// Freeze a finished crawl to JSON and thaw it back, so the published site can
// serve a committed dataset instead of asking every visitor for an API key.

export const SNAPSHOT_VERSION = 1;
export const SNAPSHOT_PATH = './data/channel.json';

const NODE_FIELDS = [
  'id',
  'depth',
  'parentId',
  'unavailable',
  'offChannel',
  'isChannel',
  'childIds',
  'crossLinks',
  'links',
  'incoming',
  'notFollowed',
  'subtreeSize',
];

export function toSnapshot(tree) {
  const nodes = [];
  for (const node of tree.nodes.values()) {
    const out = {};
    for (const field of NODE_FIELDS) {
      const value = node[field];
      if (value === undefined || value === false) continue;
      if (Array.isArray(value) && !value.length) continue;
      out[field] = value;
    }
    if (node.channel) out.channel = node.channel;
    if (node.video) {
      // Descriptions are the bulk of the payload and nothing downstream reads
      // them — every link was already extracted during the crawl.
      const { description, ...rest } = node.video;
      out.video = rest;
    }
    nodes.push(out);
  }

  return {
    version: SNAPSHOT_VERSION,
    generatedAt: new Date().toISOString(),
    mode: tree.mode || 'video',
    rootId: tree.rootId,
    channel: tree.channel || null,
    isolatedIds: tree.isolatedIds || [],
    truncated: !!tree.truncated,
    reason: tree.reason || '',
    nodes,
  };
}

export function fromSnapshot(data) {
  if (!data || data.version !== SNAPSHOT_VERSION) {
    throw new Error(`Unsupported snapshot version: ${data?.version}`);
  }

  const nodes = new Map();
  for (const raw of data.nodes || []) {
    nodes.set(raw.id, {
      id: raw.id,
      depth: raw.depth || 0,
      parentId: raw.parentId ?? null,
      video: raw.video ? { description: '', tags: [], ...raw.video } : null,
      channel: raw.channel || null,
      unavailable: !!raw.unavailable,
      offChannel: !!raw.offChannel,
      isChannel: !!raw.isChannel,
      childIds: raw.childIds || [],
      linkIds: [],
      crossLinks: raw.crossLinks || [],
      links: raw.links || [],
      incoming: raw.incoming || [],
      notFollowed: raw.notFollowed || 0,
      subtreeSize: raw.subtreeSize || 1,
    });
  }

  return {
    rootId: data.rootId,
    nodes,
    channel: data.channel,
    isolatedIds: data.isolatedIds || [],
    truncated: !!data.truncated,
    reason: data.reason || '',
    mode: data.mode,
    generatedAt: data.generatedAt,
    fromSnapshot: true,
  };
}

export function download(tree, filename = 'channel.json') {
  const blob = new Blob([JSON.stringify(toSnapshot(tree))], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Returns the committed snapshot, or null when the site ships without one. */
export async function loadBundled() {
  try {
    const response = await fetch(SNAPSHOT_PATH, { cache: 'no-cache' });
    if (!response.ok) return null;
    return fromSnapshot(await response.json());
  } catch {
    return null;
  }
}
