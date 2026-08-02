# Link Tree

Give it a YouTube video or a whole channel. It reads descriptions, pulls out every
YouTube link it finds, and builds a tree of videos-linking-to-videos. Rendered as
a collapsible list or a node-link graph.

Static site: HTML + ES modules + Tailwind from a CDN. No build step, no backend.

## Two modes

The one input field takes either, and switches on what you paste.

**Video** — `watch?v=…`, `youtu.be/…`, `/shorts/…`, or a bare id. Crawls outward
breadth-first from that video up to **Max depth**.

**Channel** — `/@handle`, `/channel/UC…`, `/user/name`, or a bare `@handle`.
Defaults to [@CainOnGames](https://www.youtube.com/@CainOnGames). Loads every
upload first, then derives the tree from the link graph: a video **nothing else
in the channel links to** sits at the top level, and every other video nests under
the first video that links to it. There's no depth setting here — the nesting is
whatever the links say it is. Links pointing outside the channel appear as
`off-channel` leaves: looked up for their title, never expanded.

## Running it

ES modules don't load over `file://`, so serve the folder:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Getting an API key

A browser can't scrape youtube.com — the watch page sends no CORS headers, so
`fetch()` is blocked before any regex could run. The YouTube Data API v3 does
allow cross-origin reads, so that's what this uses.

1. Open the [Google Cloud console](https://console.cloud.google.com/) and create a project.
2. Enable **YouTube Data API v3** under APIs & Services → Library.
3. Credentials → Create credentials → API key.
4. Restrict the key: **API restrictions** → YouTube Data API v3, and **Application
   restrictions** → Websites → add `localhost:8000` (plus your deployed origin).
5. Paste it into the API key field in the sidebar.

The key is stored in your browser's `localStorage` and sent only to
`googleapis.com`. It is never committed — nothing in this repo reads it from disk.

### Quota

The free tier is 10,000 units per day. Everything here costs **1 unit per
request**, and requests are batched 50 items at a time. A full 600-video channel
run measured **27 requests** — 1 to resolve the channel, 12 to page the uploads
list, 12 for the descriptions, 2 for the off-channel leaves. That's 0.3% of a
day's quota.

Videos are cached in `localStorage` for 7 days and the uploads list for 12 hours,
so a repeat run of the same channel usually costs nothing at all.

## Making 600 videos navigable

Most of a channel's uploads link to nothing and are linked by nothing. Drawn all
at once they're just empty rows, so the views separate them out:

- **Unlinked videos** — no links in or out — are excluded from the graph and
  collapse into one `Unlinked videos (N)` section at the bottom of the list.
  On a 600-video fixture this took the graph from 603 nodes to 20.
- **Clusters come first.** Top-level videos are ordered by how big their subtree
  is, so the substantial link chains are at the top rather than in upload order.
- **Cross-links are off by default.** They're the dashed edges, and at scale they
  form a curtain of near-vertical lines across the whole canvas. The
  **Cross-links** checkbox brings them back.
- **Drill down.** Click any node with children in the graph to make it the root
  and see just its subtree; breadcrumbs above walk back up. ⌘/Ctrl-click opens
  the video on YouTube instead. Leaf nodes open YouTube on a plain click.
- **Search** filters the list to matching titles (keeping their ancestors) and
  dims non-matches in the graph, centring the first hit. The two views hold
  different node sets, so the match count is reported per view.

### Topic chips

`src/topics.js` mines subjects out of the titles so you can browse by topic
instead of guessing at the search box. Terms are counted **per video**, and:

- anything appearing in more than 35% of the catalogue is dropped — "game" on a
  game-dev channel is not a topic;
- a two-word phrase survives only if its count is within 80% of its widest
  constituent, so `outer worlds` is kept as a phrase (and replaces `outer` and
  `worlds`) while `combat design` is dropped as a mere slice of `combat`;
- plurals are folded together, but the chip shows the most common spelling —
  `analytics`, not the stemmed `analytic`;
- the uploader's own `snippet.tags` are folded in when present. They arrive with
  data we already fetch, so they cost nothing.

Selected chips are **OR**-ed — two topics widen the set — and the search box
**AND**s on top, narrowing whatever the chips left. Filtering auto-expands the
unlinked section so matches there are reachable, and clearing tucks it away again.

## While it runs

A channel run is almost entirely time spent waiting on the API — the uploads list
has to be paged one request at a time — so the results area shows a progress panel
with the current phase, a counter, elapsed seconds, requests made so far, and a
Cancel button. If nothing changes for 12 seconds it says so explicitly, and every
request gives up after 25 seconds with an error rather than waiting forever.

## Settings

| Setting | What it does |
| --- | --- |
| Video or channel | A video URL/id, or a channel handle. The mode switches automatically. |
| Max depth | Video mode only. 0 = root only, 1 = root + its links, and so on (max 5). |
| Links / video | How many links from a single description get followed. Descriptions with 40 affiliate links won't blow up the tree. |
| Max videos / Max uploads | Hard ceiling. In channel mode it caps how many of the newest uploads get loaded. |

## How it works

- `src/extract.js` — the regexes that find video ids and channel references in text.
- `src/api.js` — batched Data API calls (videos, channels, uploads playlist), `localStorage` cache, quota counter.
- `src/crawl.js` — `crawl()` for video mode, `crawlChannel()` for channel mode.
- `src/tree-list.js`, `src/tree-graph.js` — the two views over one data model.
- `src/app.js` — settings, mode detection, crawl lifecycle, view toggle.

Because several videos often link to the same video, the result is really a graph.
Whichever placement wins (shortest path in video mode, first linker in channel
mode) becomes the video's spot in the tree, and every later link to it shows up as
a cross-link: a `↩` chip in the list, a dashed edge in the graph.

Channel mode also has to survive **link cycles** — if A links B and B links A,
neither qualifies as a top-level video. Any group left unplaced after the main
pass gets one member promoted to the top level, repeatedly, until everything is
in the tree.
