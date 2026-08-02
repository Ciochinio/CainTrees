// One video's surroundings, independent of topics.
//
// Topics slice the catalogue by subject, but a video's references scatter across
// them — so following a link always meant leaving for some unrelated topic. This
// centres on the video instead: what links TO it on one side, what it links to
// on the other.

/**
 * Collect the neighbourhood of `centreId`.
 *
 * Columns are keyed by signed distance: negative for videos that link inward,
 * 0 for the centre, positive for what it links out to. A video reachable both
 * ways is kept at whichever distance found it first, so it's drawn once.
 */
export function buildNeighbourhood(tree, centreId, { inDepth = 1, outDepth = 1 } = {}) {
  const column = new Map([[centreId, 0]]);
  const columns = new Map([[0, [centreId]]]);

  const walk = (getNext, depth, sign) => {
    let frontier = [centreId];
    for (let step = 1; step <= depth; step++) {
      const next = [];
      for (const id of frontier) {
        for (const other of getNext(tree.nodes.get(id)) || []) {
          if (!tree.nodes.has(other) || column.has(other)) continue;
          column.set(other, sign * step);
          next.push(other);
        }
      }
      if (next.length) columns.set(sign * step, next);
      frontier = next;
      if (!frontier.length) break;
    }
  };

  walk((node) => node?.links, outDepth, 1);
  walk((node) => node?.incoming, inDepth, -1);

  const edges = [];
  for (const id of column.keys()) {
    for (const target of tree.nodes.get(id)?.links || []) {
      if (column.has(target)) edges.push([id, target]);
    }
  }

  return { centreId, column, columns, edges, total: column.size };
}
