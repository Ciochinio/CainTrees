// The topic index. Each section is just a name and a set of video ids — the
// layout inside it is computed on demand, because a section that nobody opened
// costs nothing.

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

  const orphans = new Set();
  for (const node of tree.nodes.values()) {
    if (node.isChannel || node.offChannel || !node.video) continue;
    if (!covered.has(node.id)) orphans.add(node.id);
  }
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
