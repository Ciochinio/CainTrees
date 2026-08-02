// Breadth-first walk over "video description links to other videos".

import { fetchChannel, fetchPlaylistIds, fetchPlaylists, fetchVideos } from './api.js';
import { extractVideoIds } from './extract.js';

function makeNode(id, depth, parentId) {
  return {
    id,
    depth,
    parentId,
    video: null,
    unavailable: false,
    offChannel: false, // a link out of the channel: shown, never expanded
    isChannel: false, // the synthetic root of a channel crawl
    childIds: [], // tree children — nodes whose first discovery was through this one
    linkIds: [], // every video id found in the description
    crossLinks: [], // links to videos already placed elsewhere in the tree
    links: [], // every link that resolved to a node, regardless of tree shape
    incoming: [], // every node that links here — the tree only records one of them
    notFollowed: 0, // links left unexpanded because of a depth or node limit
  };
}

/**
 * The tree gives each video one parent, chosen by discovery order. The real
 * relation is many-to-many, so record it separately: `links` and `incoming` hold
 * every edge, and nothing about them depends on the order videos were found.
 */
function linkUp(nodes) {
  for (const node of nodes.values()) {
    if (node.isChannel) continue; // its children are clusters, not links
    node.links = [...node.childIds, ...node.crossLinks].filter((id) => nodes.has(id));
  }
  for (const node of nodes.values()) {
    for (const target of node.links) nodes.get(target).incoming.push(node.id);
  }
}

/**
 * Crawl outward from `rootId`.
 *
 * Breadth-first matters here: a video linked from several places gets attached
 * at its shallowest position, and the later links become cross-links instead of
 * duplicate subtrees.
 *
 * Resolves to { rootId, nodes: Map<id, node>, truncated, reason }.
 * Rejects with AbortError if `signal` fires, or ApiError on an API failure.
 */
export async function crawl({
  rootId,
  maxDepth = 2,
  maxNodes = 200,
  maxChildren = 10,
  key,
  signal,
  onProgress = () => {},
}) {
  const nodes = new Map([[rootId, makeNode(rootId, 0, null)]]);
  let frontier = [rootId];
  let depth = 0;
  let truncated = false;
  let reason = '';

  while (frontier.length && depth <= maxDepth) {
    if (signal?.aborted) throw new DOMException('Crawl cancelled', 'AbortError');

    onProgress({ depth, total: nodes.size, fetching: frontier.length });
    const videos = await fetchVideos(frontier, { key, signal });
    const nextFrontier = [];

    for (const id of frontier) {
      const node = nodes.get(id);
      const video = videos.get(id);
      if (!video) {
        node.unavailable = true;
        continue;
      }
      node.video = video;

      const links = extractVideoIds(video.description, id);
      node.linkIds = links.slice(0, maxChildren);
      node.notFollowed = links.length - node.linkIds.length;

      if (depth === maxDepth) {
        // Still worth showing what it points at, we just don't go further.
        node.notFollowed = links.length;
        continue;
      }

      for (const childId of node.linkIds) {
        if (nodes.has(childId)) {
          node.crossLinks.push(childId);
          continue;
        }
        if (nodes.size >= maxNodes) {
          node.notFollowed++;
          truncated = true;
          reason = `Stopped at the ${maxNodes}-video limit.`;
          continue;
        }
        nodes.set(childId, makeNode(childId, depth + 1, id));
        node.childIds.push(childId);
        nextFrontier.push(childId);
      }
    }

    frontier = nextFrontier;
    depth++;
  }

  if (!truncated && frontier.length) {
    truncated = true;
    reason = `Stopped at depth ${maxDepth}.`;
  }

  linkUp(nodes);
  onProgress({ depth: Math.min(depth, maxDepth), total: nodes.size, fetching: 0, done: true });
  return { rootId, nodes, isolatedIds: [], truncated, reason };
}

const OFF_CHANNEL_CAP = 300;
const MAX_PLAYLISTS = 100;
const PLAYLIST_ITEM_CAP = 500;

/**
 * The author's own playlists, narrowed to the videos this crawl actually holds.
 *
 * Titles mined from descriptions are a guess at what a video is about; a
 * playlist is the author saying so. Order is preserved — a playlist is usually
 * meant to be watched front to back — and entries this crawl never loaded
 * (other channels, deleted videos, uploads past the cap) are dropped, so the
 * count on a playlist is the number of videos it can actually show.
 *
 * Costs 1 unit per 50 playlists plus 1 per 50 videos in each.
 */
async function collectPlaylists(channelId, nodes, { key, signal, onProgress = () => {} }) {
  const found = await fetchPlaylists(channelId, {
    key,
    signal,
    max: MAX_PLAYLISTS,
    onPage: (count) => onProgress({ phase: 'playlists', count }),
  });

  const playlists = [];
  for (const [index, playlist] of found.entries()) {
    if (signal?.aborted) throw new DOMException('Crawl cancelled', 'AbortError');
    onProgress({ phase: 'playlists', count: index, of: found.length });
    const { ids } = await fetchPlaylistIds(playlist.id, { key, signal, max: PLAYLIST_ITEM_CAP });
    const videoIds = ids.filter((id) => nodes.has(id));
    if (!videoIds.length) continue;
    playlists.push({
      id: playlist.id,
      title: playlist.title,
      itemCount: playlist.itemCount,
      videoIds,
    });
  }
  return playlists;
}

/**
 * Map a whole channel instead of expanding from one video.
 *
 * Everything is fetched up front — the uploads list, then every description —
 * and the tree is derived from the link graph afterwards: a video nobody in the
 * channel links to sits at the top level, and every other video hangs off the
 * first video that links to it. Links out of the channel become leaves that are
 * looked up for their title but never expanded.
 *
 * Resolves to { rootId, nodes, channel, truncated, reason, mode: 'channel' }.
 */
export async function crawlChannel({
  ref,
  maxNodes = 600,
  maxChildren = 15,
  withPlaylists = true,
  key,
  signal,
  onProgress = () => {},
}) {
  const abortIfCancelled = () => {
    if (signal?.aborted) throw new DOMException('Crawl cancelled', 'AbortError');
  };

  onProgress({ phase: 'channel' });
  const channel = await fetchChannel(ref, { key, signal });

  abortIfCancelled();
  onProgress({ phase: 'uploads', count: 0 });
  const { ids: uploadIds, complete } = await fetchPlaylistIds(channel.uploads, {
    key,
    signal,
    max: maxNodes,
    onPage: (count) => onProgress({ phase: 'uploads', count }),
  });

  abortIfCancelled();
  const videos = await fetchVideos(uploadIds, {
    key,
    signal,
    onProgress: (count) => onProgress({ phase: 'descriptions', count, of: uploadIds.length }),
  });

  const inChannel = new Set(uploadIds);
  const nodes = new Map();
  const outgoing = new Map();
  let truncated = false;
  let reason = '';

  for (const id of uploadIds) {
    const node = makeNode(id, 1, null);
    node.video = videos.get(id) || null;
    node.unavailable = !node.video;
    nodes.set(id, node);

    const links = node.video ? extractVideoIds(node.video.description, id) : [];
    node.linkIds = links.slice(0, maxChildren);
    node.notFollowed = links.length - node.linkIds.length;
    outgoing.set(id, {
      inside: node.linkIds.filter((linkId) => inChannel.has(linkId)),
      outside: node.linkIds.filter((linkId) => !inChannel.has(linkId)),
    });
  }

  // A video nobody in the channel points at is a starting point.
  const incoming = new Map(uploadIds.map((id) => [id, 0]));
  for (const { inside } of outgoing.values()) {
    for (const target of inside) incoming.set(target, incoming.get(target) + 1);
  }

  const topLevel = [];
  const placed = new Set();
  const queue = [];
  let cursor = 0;

  const addTopLevel = (id) => {
    placed.add(id);
    topLevel.push(id);
    nodes.get(id).depth = 1;
    queue.push(id);
  };

  const drain = () => {
    while (cursor < queue.length) {
      const id = queue[cursor++];
      const node = nodes.get(id);
      for (const target of outgoing.get(id).inside) {
        if (placed.has(target)) {
          node.crossLinks.push(target);
          continue;
        }
        placed.add(target);
        const child = nodes.get(target);
        child.parentId = id;
        child.depth = node.depth + 1;
        node.childIds.push(target);
        queue.push(target);
      }
    }
  };

  for (const id of uploadIds) if (!incoming.get(id)) addTopLevel(id);
  drain();
  // Whatever is left belongs to a link cycle, where every member has an
  // incoming edge. Break in by promoting one, then continue.
  for (const id of uploadIds) {
    if (placed.has(id)) continue;
    addTopLevel(id);
    drain();
  }

  // Off-channel links: fetched for their titles, never expanded.
  const offChannelIds = [];
  for (const id of uploadIds) {
    const node = nodes.get(id);
    for (const target of outgoing.get(id).outside) {
      if (nodes.has(target)) {
        node.crossLinks.push(target);
        continue;
      }
      if (offChannelIds.length >= OFF_CHANNEL_CAP) {
        node.notFollowed++;
        truncated = true;
        reason = `Stopped after ${OFF_CHANNEL_CAP} off-channel links.`;
        continue;
      }
      const leaf = makeNode(target, node.depth + 1, id);
      leaf.offChannel = true;
      nodes.set(target, leaf);
      node.childIds.push(target);
      offChannelIds.push(target);
    }
  }

  if (offChannelIds.length) {
    abortIfCancelled();
    onProgress({ phase: 'offchannel', count: 0, of: offChannelIds.length });
    const offVideos = await fetchVideos(offChannelIds, {
      key,
      signal,
      onProgress: (count) => onProgress({ phase: 'offchannel', count, of: offChannelIds.length }),
    });
    for (const id of offChannelIds) {
      const node = nodes.get(id);
      node.video = offVideos.get(id) || null;
      node.unavailable = !node.video;
    }
  }

  // Playlists are a bonus on top of a finished crawl, so a failure here — a
  // quota wall on the last few requests, say — must not throw away everything
  // already fetched. It's reported instead, and the tree stands without them.
  let playlists = [];
  let playlistsError = '';
  if (withPlaylists) {
    abortIfCancelled();
    try {
      playlists = await collectPlaylists(channel.id, nodes, { key, signal, onProgress });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      playlistsError = err.message || 'Playlists could not be loaded.';
    }
  }

  const rootId = `channel:${channel.id}`;
  const root = makeNode(rootId, 0, null);
  root.isChannel = true;
  root.channel = channel;
  nodes.set(rootId, root);
  linkUp(nodes);
  for (const id of topLevel) nodes.get(id).parentId = rootId;

  // Most uploads link to nothing and are linked by nothing. They carry no
  // structure, so they'd only add empty rows to the graph — split them out and
  // lead with the biggest clusters instead.
  const isolatedIds = [];
  const clusterRoots = [];
  for (const id of topLevel) {
    const node = nodes.get(id);
    if (!node.childIds.length && !node.crossLinks.length) isolatedIds.push(id);
    else clusterRoots.push(id);
  }

  const measure = (id) => {
    const node = nodes.get(id);
    node.subtreeSize = 1 + node.childIds.reduce((sum, childId) => sum + measure(childId), 0);
    return node.subtreeSize;
  };
  for (const id of clusterRoots) measure(id);
  clusterRoots.sort((a, b) => nodes.get(b).subtreeSize - nodes.get(a).subtreeSize);

  root.childIds = clusterRoots;
  root.subtreeSize = nodes.size;

  if (!complete) {
    truncated = true;
    reason = `Loaded the newest ${maxNodes} uploads only.`;
  }

  onProgress({ phase: 'done', count: nodes.size - 1 });
  return {
    rootId,
    nodes,
    channel,
    isolatedIds,
    playlists,
    playlistsError,
    truncated,
    reason,
    mode: 'channel',
  };
}

/** Ordered list of nodes as a depth-first walk of the tree. */
export function walk(tree) {
  const out = [];
  const visit = (id) => {
    const node = tree.nodes.get(id);
    if (!node) return;
    out.push(node);
    for (const childId of node.childIds) visit(childId);
  };
  visit(tree.rootId);
  return out;
}
