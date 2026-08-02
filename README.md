# Link Tree

## Two pages

| Page | What it's for | Needs an API key |
| --- | --- | --- |
| `index.html` | Viewing the map. Loads `data/channel.json` and shows the list, graph, topics, playlists and search. | **No** |
| `build.html` | Crawling YouTube and exporting the data file. | Yes |

**Publishing workflow:** open `build.html`, paste your key, press *Build tree*, then
*Export snapshot (JSON)*. Save the download as `data/channel.json`, commit it, push.
Every visitor to `index.html` — on any machine, including people who aren't you —
then gets the whole map with no key at all. Re-run it whenever you want fresher data.

Without that file the viewer shows a message pointing at the build page. The key
never leaves the build page's `localStorage` and is never committed.

Playlists live in the snapshot too, so a data file exported before they existed
shows topics only — the **Group by** switch stays hidden until you re-run the
build and commit the new export.

## A video linked from several places

Each video is shown **under every video that links to it**. A hub linked by five
others appears five times, each occurrence tagged `linked from 5`; click that tag
to jump to another occurrence. Nothing about the layout depends on the order
videos were discovered, and because every edge is a short hop from a parent to
its own child, the picture stays readable — an earlier attempt at drawing the
true many-to-many edges turned into a wall of wires at channel scale.

Chains that loop back on themselves stop at the repeat, marked `↺ already higher
up this chain`, so cycles terminate instead of recursing.


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

On Windows that's `python -m http.server 8000`. Then open <http://localhost:8000>
for the viewer, or <http://localhost:8000/build.html> to crawl.

`.gitattributes` normalises line endings, so the repo is safe to work on from
both macOS and Windows. `.DS_Store` is tracked from the initial commit; drop it
with `git rm --cached .DS_Store` whenever convenient — `.gitignore` already
keeps new ones out.

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

Playlists add 1 request per 50 playlists, plus 1 per 50 videos in each — so a
channel with 20 playlists costs about 21 more. Still nowhere near the ceiling,
but that's the one part of a run that scales with something other than video
count.

Videos are cached in `localStorage` for 7 days, and playlist contents — the
uploads list included — for 12 hours, so a repeat run of the same channel
usually costs nothing at all.

## Making 600 videos navigable

Most of a channel's uploads link to nothing and are linked by nothing, and a few
hundred link chains stacked in one column can't be read at any zoom. What keeps
it usable:

- **Topics are the top level** — see below. Everything starts collapsed.
- **A topic never renders more videos than its header promises.**
- **Click a node for its detail panel** — a real `<a>` to watch it on YouTube,
  everything it links to, and everything that links to it, each tagged with the
  topic it belongs to. Clicking one of those shows that video; it doesn't move
  the graph. **Centre on this** is what travels.
- **Middle-click a node to just watch it.** Each node's face is a genuine SVG
  `<a href>`, so middle-click, ⌘/Ctrl-click, shift-click and the right-click
  menu all behave as they do on any link. Only a plain left click is intercepted,
  to open the panel.

### Finding a video

The topic selector is a filter, not a requirement — it starts on **Any topic**,
so the search box reaches the whole channel and you don't need to know which
topic a video lives in to find it. With nothing picked and nothing typed the
graph opens on the 20 best-connected videos, as somewhere to start walking from;
type a title and it draws the matches instead, wherever they live.

Picking a topic narrows both the drawing and the search to that topic.

### Walking the links

Following a reference used to drop you into the *destination's* topic, which was
arbitrary — often a 4-video topic you'd never heard of — and the breadcrumb reset,
so there was no way back. Clicking a link now **centres the graph on that video**
instead: `src/neighbourhood.js` collects what links to it on the left and what it
links to on the right, ignoring topics entirely. Clicking any neighbour walks on
from there.

- **Clicking never travels.** A left click always just shows the video, in every
  view. Moving the graph is only ever the explicit **Centre on this** button, so
  you can inspect a node without losing your place.
- **How far out is yours to set** — `linked from` and `links to` selectors in the
  graph toolbar, each `none` / `1 step` / `2 steps`.
- Re-picking the topic you're already on leaves the walk and returns to it.
- **The breadcrumb is now a trail**: `lore › Fun vs. Realism › Encumbrance`.
  Every step is clickable, there's a **← Back** button, and the topic you started
  from is always the first entry, so one click returns you to it.

### Browsing by topic

The list's top level is **topics**, because the question is nearly always "what
has he said about X". You get a collapsed index — `fallout 32 videos` — and open
the one you want.

**A topic shows exactly its own videos.** Open a section promising 32 videos and
you get 32 rows: never a video from outside the topic, never the same video
twice. `src/induce.js` takes the topic's id set and lays it out using only the
links *between* those videos, so the ones that form a chain nest and the rest sit
flat. Links leaving the topic appear as `also links to →` chips; clicking one
opens whichever topic holds that video and scrolls to it.

This replaced an earlier design where a topic pulled in every chain it touched,
entire, with videos repeated under each linker. On a 600-video fixture that
turned a 60-video topic into **5974 rows** and blew past an internal 6000-node
cap. The same fixture now renders exactly 60.

- A video carrying three topics appears in three sections — the price of
  subject-first browsing.
- Whatever no topic claims lands in **No topic** at the bottom.
- Sections build their rows the first time you open them, so a closed section
  costs nothing.
- A video linked by several others inside a topic is placed under one of them and
  names the rest with `←` chips, so it appears once and the count stays honest.
- The graph draws one topic at a time, chosen with the selector in its toolbar —
  opening a topic in the list selects it there too.
- Search narrows each section to its matching videos and drops topics left with
  none; the header then reads `6 videos matching`.

### Browsing by playlist

Topics are a guess at what a video is about; a playlist is the author saying so.
The **Group by** switch in the toolbar swaps the whole index between the two —
same list, same graph, same search, different sections — and it only appears
when the data file actually carries playlists.

- Sections are the channel's playlists in the channel's own order, and the
  videos inside keep **playlist order** rather than being sorted by subtree size,
  because a playlist is usually meant to be watched front to back. Videos that
  link to one another still nest.
- A playlist shows exactly the videos this crawl holds. Entries it can't show —
  someone else's upload, a deleted video, an upload past the **Max uploads**
  ceiling — are counted separately in the header as `3 not in this snapshot`, so
  the number never silently disagrees with YouTube's.
- Everything the author never filed lands in **In no playlist** at the bottom,
  the same way **No topic** works.
- Following a link out of a playlist switches to whichever playlist holds the
  target, exactly as it does between topics.

### How topics are found

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
- `src/api.js` — batched Data API calls (videos, channels, playlists and their contents), `localStorage` cache, quota counter.
- `src/crawl.js` — `crawl()` for video mode, `crawlChannel()` for channel mode.
- `src/sections.js` — the two browse indexes: topics mined from titles, and the channel's own playlists. Both produce the same shape, so nothing downstream knows which it has.
- `src/tree-list.js`, `src/tree-graph.js` — the two views over one data model.
- `src/view.js` — the shared UI: browse switch, sections, search, detail panel, graph.
- `src/builder-page.js` — settings, mode detection, crawl lifecycle, snapshot export.

Because several videos often link to the same video, the result is really a graph.
Whichever placement wins (shortest path in video mode, first linker in channel
mode) becomes the video's spot in the tree, and every later link to it shows up as
a cross-link: a `↩` chip in the list, a dashed edge in the graph.

Channel mode also has to survive **link cycles** — if A links B and B links A,
neither qualifies as a top-level video. Any group left unplaced after the main
pass gets one member promoted to the top level, repeatedly, until everything is
in the tree.
