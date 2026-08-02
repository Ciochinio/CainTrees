// Turning the link graph into something drawable.
//
// A video linked by five others is shown under all five. That means the display
// is a forest of *placements*, not of videos: the same video id can occur many
// times, each occurrence with its own key. Every edge stays short and local,
// which is what keeps the picture readable — the alternative was drawing real
// many-to-many edges, and at channel scale that turns into a wall of wires.

const MAX_PLACEMENTS = 6000;

/**
 * Expand `rootIds` into a placement forest.
 *
 * Recursion stops when a video is already on the path from the root, which is
 * how link cycles terminate; those placements are flagged `cyclic` so the views
 * can mark them instead of silently truncating.
 */
export function buildForest(tree, rootIds) {
  let count = 0;
  let truncated = false;

  const build = (id, depth, path, parentKey) => {
    if (count >= MAX_PLACEMENTS) {
      truncated = true;
      return null;
    }
    count++;

    const key = parentKey ? `${parentKey}/${id}` : id;
    const placement = { key, id, depth, children: [], cyclic: false, size: 1 };
    const node = tree.nodes.get(id);
    if (!node) return placement;

    if (path.has(id)) {
      placement.cyclic = true; // the chain came back around; stop here
      return placement;
    }

    const nextPath = new Set(path).add(id);
    for (const target of node.links) {
      if (!tree.nodes.has(target)) continue;
      const child = build(target, depth + 1, nextPath, key);
      if (!child) break;
      placement.children.push(child);
      placement.size += child.size;
    }
    return placement;
  };

  const roots = [];
  for (const id of rootIds) {
    const placement = build(id, 1, new Set(), '');
    if (placement) roots.push(placement);
  }
  // Biggest chains first — upload order buries the interesting ones.
  roots.sort((a, b) => b.size - a.size);
  return { roots, count, truncated };
}

/** Depth-first list of every placement in a forest. */
export function walkForest(roots) {
  const out = [];
  const visit = (placement) => {
    out.push(placement);
    placement.children.forEach(visit);
  };
  roots.forEach(visit);
  return out;
}
