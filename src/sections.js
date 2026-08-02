// Grouping the link chains by subject.
//
// The top level of the UI is a list of topics rather than a list of chains: the
// question being asked is almost always "what has he said about X", and a
// channel's worth of chains stacked in one column is unreadable no matter how
// it's laid out. A chain belongs to a topic if *any* video in it carries that
// topic, and the chain is then shown whole, so you keep the context of why a
// video sits where it does.

/** Every video id appearing anywhere in a placement subtree. */
function idsIn(placement, into = new Set()) {
  into.add(placement.id);
  for (const child of placement.children) idsIn(child, into);
  return into;
}

function lonePlacement(id) {
  return { key: id, id, depth: 1, children: [], cyclic: false, size: 1 };
}

/**
 * Build the topic sections.
 *
 * Unlinked videos join in as single-node chains, so every video in the channel
 * is reachable through some section — either a topic it carries, or the
 * "No topic" bucket at the end.
 */
export function buildSections(tree, forest, topics) {
  const roots = [...forest, ...(tree.isolatedIds || []).map(lonePlacement)];
  const contents = new Map(roots.map((root) => [root.key, idsIn(root)]));

  const sections = [];
  for (const topic of topics) {
    const members = roots.filter((root) => {
      for (const id of contents.get(root.key)) if (topic.ids.has(id)) return true;
      return false;
    });
    if (members.length) {
      sections.push({
        term: topic.term,
        label: topic.label,
        videos: topic.count,
        ids: topic.ids,
        roots: members,
      });
    }
  }

  const covered = new Set();
  for (const topic of topics) for (const id of topic.ids) covered.add(id);

  const orphans = roots.filter((root) => {
    for (const id of contents.get(root.key)) if (covered.has(id)) return false;
    return true;
  });

  if (orphans.length) {
    const ids = new Set();
    for (const root of orphans) for (const id of contents.get(root.key)) ids.add(id);
    sections.push({
      term: '__none__',
      label: 'No topic',
      videos: ids.size,
      ids,
      roots: orphans,
      isOrphanBucket: true,
    });
  }

  return sections;
}

/**
 * Narrow every section to the chains containing a match, dropping sections left
 * with nothing. `predicate` takes a node; null returns the sections untouched.
 */
export function filterSections(tree, sections, predicate) {
  if (!predicate) return sections;
  const out = [];
  for (const section of sections) {
    const roots = section.roots.filter((root) => {
      for (const id of idsIn(root)) {
        const node = tree.nodes.get(id);
        if (node && predicate(node)) return true;
      }
      return false;
    });
    if (roots.length) out.push({ ...section, roots, filtered: true });
  }
  return out;
}

/** Distinct videos across a section's chains that actually match. */
export function countMatches(tree, section, predicate) {
  const seen = new Set();
  for (const root of section.roots) {
    for (const id of idsIn(root)) {
      if (seen.has(id)) continue;
      const node = tree.nodes.get(id);
      if (node && (!predicate || predicate(node))) seen.add(id);
    }
  }
  return seen.size;
}
