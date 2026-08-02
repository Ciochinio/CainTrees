// The browse index. Each section is just a name and a set of video ids — the
// layout inside it is computed on demand, because a section that nobody opened
// costs nothing.
//
// Two indexes are built over the same tree: topics mined from titles, and the
// author's own playlists. Everything downstream — the list, the graph selector,
// search — works off a section, so it doesn't care which one it's looking at.

/** Every real video in the channel: not the synthetic root, not an off-channel leaf. */
function channelVideoIds(tree) {
  const ids = [];
  for (const node of tree.nodes.values()) {
    if (node.isChannel || node.offChannel || !node.video) continue;
    ids.push(node.id);
  }
  return ids;
}

/**
 * One section per topic, biggest first, plus a "No topic" bucket holding every
 * video no topic claimed. Every video in the channel is in at least one section.
 */
export function buildSections(tree, topics) {
  const sections = topics
    .filter((topic) => topic.ids.size)
    .map((topic) => ({
      term: topic.term,
      label: topic.label,
      ids: topic.ids,
      videos: topic.ids.size,
    }));

  const covered = new Set();
  for (const topic of topics) for (const id of topic.ids) covered.add(id);

  const orphans = new Set(channelVideoIds(tree).filter((id) => !covered.has(id)));
  if (orphans.size) {
    sections.push({
      term: '__none__',
      label: 'No topic',
      ids: orphans,
      videos: orphans.size,
      isOrphanBucket: true,
    });
  }
  return sections;
}

/**
 * One section per playlist the author published, in the channel's own order,
 * plus an "In no playlist" bucket so every video is still reachable.
 *
 * Unlike topics, the order inside a playlist is deliberate, so these sections
 * are marked `ordered` and laid out in playlist order rather than by size.
 * `itemCount` is what YouTube says the playlist holds; `videos` is how many of
 * those this crawl actually has, which is what gets rendered.
 */
export function buildPlaylistSections(tree) {
  const sections = [];
  const covered = new Set();

  for (const playlist of tree.playlists || []) {
    const ids = new Set((playlist.videoIds || []).filter((id) => tree.nodes.has(id)));
    if (!ids.size) continue;
    for (const id of ids) covered.add(id);
    sections.push({
      term: `pl:${playlist.id}`,
      label: playlist.title,
      ids,
      videos: ids.size,
      itemCount: playlist.itemCount ?? ids.size,
      ordered: true,
      playlistId: playlist.id,
    });
  }

  if (!sections.length) return sections;

  const loose = new Set(channelVideoIds(tree).filter((id) => !covered.has(id)));
  if (loose.size) {
    sections.push({
      term: '__unlisted__',
      label: 'In no playlist',
      ids: loose,
      videos: loose.size,
      isOrphanBucket: true,
    });
  }
  return sections;
}

/** The ids in a section that satisfy `predicate` (all of them when null). */
export function matchingIds(tree, section, predicate) {
  if (!predicate) return section.ids;
  const out = new Set();
  for (const id of section.ids) {
    const node = tree.nodes.get(id);
    if (node && predicate(node)) out.add(id);
  }
  return out;
}
