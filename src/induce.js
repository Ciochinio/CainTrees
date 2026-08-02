// Laying out a *subset* of videos using only the links between them.
//
// This is the core of the topic view. Given the 18 videos of a topic, it draws
// exactly those 18 — never a video from outside, never the same video twice.
// Links that leave the subset are reported per video so they stay reachable,
// but they don't drag their own subtrees in.

function makePlacement(id, depth) {
  return {
    id,
    depth,
    children: [],
    extraParents: [], // other videos in the subset that also link here
    offTopic: [], // links leaving the subset
  };
}

/**
 * Build a forest over `ids` from the links among them.
 *
 * A video with several linkers inside the subset is placed under the first and
 * names the rest in `extraParents`, so it appears once and the row count always
 * equals `ids.size`. Videos in a link cycle — where every member has an inbound
 * edge — are broken into by promoting one to the top.
 */
export function induce(tree, ids) {
  const out = new Map();
  const indegree = new Map();
  for (const id of ids) {
    out.set(id, []);
    indegree.set(id, 0);
  }
  for (const id of ids) {
    for (const target of tree.nodes.get(id)?.links || []) {
      if (!ids.has(target)) continue;
      out.get(id).push(target);
      indegree.set(target, indegree.get(target) + 1);
    }
  }

  const placed = new Map();
  const roots = [];
  const queue = [];
  let cursor = 0;

  const promote = (id) => {
    const placement = makePlacement(id, 1);
    placed.set(id, placement);
    roots.push(placement);
    queue.push(id);
  };

  const drain = () => {
    while (cursor < queue.length) {
      const id = queue[cursor++];
      const parent = placed.get(id);
      for (const target of out.get(id)) {
        const existing = placed.get(target);
        if (existing) {
          existing.extraParents.push(id);
          continue;
        }
        const child = makePlacement(target, parent.depth + 1);
        placed.set(target, child);
        parent.children.push(child);
        queue.push(target);
      }
    }
  };

  for (const id of ids) if (!indegree.get(id)) promote(id);
  drain();
  // Anything left belongs to a cycle; break in and continue.
  for (const id of ids) {
    if (placed.has(id)) continue;
    promote(id);
    drain();
  }

  for (const [id, placement] of placed) {
    placement.offTopic = (tree.nodes.get(id)?.links || []).filter(
      (target) => !ids.has(target) && tree.nodes.has(target),
    );
  }

  const size = (placement) =>
    (placement.size = 1 + placement.children.reduce((sum, child) => sum + size(child), 0));
  roots.forEach(size);
  roots.sort((a, b) => b.size - a.size);

  return { roots, placed, total: placed.size };
}
