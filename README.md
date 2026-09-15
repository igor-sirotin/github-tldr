# GitHub TLDR

A small Chrome/Edge extension (Manifest V3) that adds a **TLDR** entry to the
`···` menu on every GitHub comment, directly under *Quote reply*. Choose it and
the comment is summarized into at most three bullets by the OpenAI API.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Click the extension icon (or **Details → Extension options**) and paste your
   OpenAI API key, then **Save**.

## Setting the key from the console instead

Open the extension's options page (or its service worker console from
`chrome://extensions` → **Service worker**) and run:

```js
chrome.storage.local.set({ openaiKey: 'sk-...' })            // key
chrome.storage.local.set({ openaiModel: 'gpt-5.6-luna' })    // optional
chrome.storage.local.set({ openaiBaseUrl: 'https://api.openai.com/v1' }) // optional
```

The key lives in `chrome.storage.local` for this browser profile only. The API
call is made from the service worker, so the key is never exposed to page
scripts on github.com.

## How it works

- `content.js` finds comment bodies on `github.com` (classic timeline, review
  threads and the React issue views), adds a **TLDR** entry to each comment's
  `···` menu, and renders the result in a panel above the comment. A
  `MutationObserver` handles GitHub's client-side navigation and lazily loaded
  comments.
- `background.js` reads the settings and calls
  `POST {baseUrl}/chat/completions`, returning the summary to the content script.
- Every comment is offered the entry regardless of length. Only the up-front
  cache lookup is limited to comments over 120 characters, and a comment's panel
  is not built until its entry is actually used; comment text is truncated
  to 12k characters before being sent.

## Model choice

The default is `gpt-5.6-luna` — the cheap tier of the current generation, at
$0.20/1M input and $1.20/1M output. A typical comment costs well under a tenth
of a cent to summarize, so model choice here is about output quality, not spend.
`reasoning_effort` is pinned to `none`: summarizing needs no deliberation, and
that keeps both latency and billed reasoning tokens down.

Any OpenAI-compatible model works — set it in the options. Parameter differences
between model families are handled automatically: if the API rejects
`temperature`, `max_tokens` or `reasoning_effort` for the chosen model, the
request is rebuilt without it (swapping in `max_completion_tokens` where needed)
and retried, and the result is remembered for later calls.

Choosing **TLDR** again hides/shows the existing summary — it does not re-bill a
second request.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest, `github.com` content script, `api.openai.com` host permission |
| `content.js` | Menu entry, wand icon, panel rendering, cache peek |
| `preview.html` | Standalone preview with working menus, no extension install needed |
| `content.css` | Panel styles, themed with GitHub's CSS variables (works in dark mode) |
| `background.js` | OpenAI request, summary cache |
| `options.html` / `options.js` | Key, model and base URL settings, cache size and clear |

## Previewing without installing

Open `preview.html` in a browser — no extension loading, no build step, no server:

```sh
xdg-open preview.html    # or just double-click it
```

It loads the extension's real `content.css` and `content.js` and stubs only the
extension APIs, so what you see is what ships. Open any `···` menu and **TLDR**
is there under *Quote reply*. There are mock comments in three layouts — classic,
a review thread, and the React issue view — plus a theme toggle. The stub fails
every second call so the error state is reachable, and one comment is pre-seeded
in the stub's cache so it opens on load without any interaction; press **Clear
cache** to put it back.

## The menu entry

The entry is added to the comment's own `···` menu rather than injected as a
button in the header, so it costs no header space and matches how GitHub's other
per-comment actions are reached.

Finding the right spot without knowing GitHub's class names:

- **Anchor on *Quote reply*.** The `.js-comment-quote-reply` hook is tried first
  and the visible label is the fallback, so the entry lands immediately under it
  and therefore at the end of the menu's first section, above the divider. The
  label fallback is the one part a non-English UI would miss.
- **Clone the neighbour, don't imitate it.** The entry is a deep clone of the
  Quote reply item's whole cell — wrapper element, nested icon slot, Primer's
  `data-*` attributes and all — with the label swapped to `TLDR` and the glyph
  swapped for the wand. Building a `<button>` and copying a class name is not
  enough: any wrapper or attribute GitHub styles on is lost and native button
  chrome shows through. Cloning means the extension ships **no** menu styling at
  all, so the entry cannot drift from its neighbours.
- **Know which menu you are in.** GitHub ships two implementations, shaped
  differently rather than merely styled differently. The legacy `details-menu`
  is a `<button class="dropdown-item" role="menuitem">` whose hover is a
  full-bleed accent row; Primer's `ActionList` is an `<li role="menuitem">`
  wrapping a content element, and the hover is an inset rounded fill on *that
  element*, not the li. So the styling class lands on the content element where
  there is one, tagged `data-tldr-menu="actionlist"` or `"dropdown"` so
  `content.css` can shape each correctly — radius, icon gap, and whether the
  foreground flips to white on hover. Real GitHub ships ActionList with hashed
  CSS-module names, so the content element is matched by substring.
- **Add no spacing the layout already provides.** Where GitHub already wraps
  the label in an element of its own, that element is re-used rather than having
  another span nested inside it, and the icon's margin is dropped in ActionList,
  whose content element owns that gap.
- **Opt the overlay out of the host's child spacing.** GitHub spaces an item's
  children with rules aimed at every direct child, such as
  `.ActionListContent > :not(:last-child, .Spacer) { margin-right: .5rem }`.
  The mesh is a direct child too, and on an absolutely positioned box with both
  `left` and `right` set a right margin *shrinks the used width* rather than
  being ignored — which is a gap down the right of the fill that no amount of
  adjusting `inset` can close, because the box is shrunk after the offsets
  resolve. So the mesh neutralises margin, padding, border and grid/flex
  placement with `!important`: the host's own children keep their spacing and
  only the overlay opts out. The preview reproduces that rule, and a test
  asserts the host's children still receive the margin while the mesh computes
  to `0px`.
- **Measure the box; don't assume it.** An element's background covers its
  *border* box. An absolutely positioned child can only reach its parent's
  *padding* box. So a mesh at `inset: 0` is always short by the item's border,
  which shows as a margin down one side — and no arrangement of CSS fixes it,
  because the border widths belong to GitHub's stylesheet and are unknowable
  until runtime. `fitMesh()` reads them with `getComputedStyle` once the entry
  is in the document and pulls the mesh out over the border, so its box is the
  item's background box exactly. `.gh-tldr-menu-item` therefore must *not* set
  `overflow: hidden`, which would clip it straight back; the mesh clips itself.
  The mesh is then the single painter — the item's hover rule suppresses the
  host's fill and paints nothing — so there is one rectangle, over the same box
  every neighbouring item fills. Tests assert both halves: one painter in
  `content.css`, and a measured inset of `-2px` on a bordered fixture.
- **Give each entry its own phase.** `content.js` sets a random negative
  `--gh-tldr-phase` per entry, which every animation in `content.css` takes as
  its `animation-delay`. A negative delay starts an animation part-way through
  its cycle and wraps on an infinite one, so a single range covers the label's
  8s ramp and the blobs' 9–15s drifts. Without it every TLDR entry on a page
  runs in lockstep, which reads as one synced pulse rather than as each item
  having a life of its own.
- **Re-colour, don't re-layout.** `content.css` sets no geometry on the entry at
  all — height, padding, font and icon gap are GitHub's. It only adds colour:
  the label carries an animated multi-hue ramp via `background-clip: text`, the
  wand is stroked from an SVG paint server (`#gh-tldr-icon-gradient`, one hidden
  `<svg>` per page, its stop colours set from CSS), and hovering swaps GitHub's
  flat fill for an animated mesh of seven independently drifting colour blobs.
  Both palettes have light and dark variants.
- **Strip what belonged to Quote reply.** Ids (which must stay unique), `js-`
  behaviour hooks, `data-testid`, `href`/`value`/`for` and dangling
  `aria-labelledby` are all removed from the clone. The wand keeps the original
  glyph's `octicon` class and width/height so it is sized and spaced natively,
  but not its specific `octicon-quote` class.
- **Insert beside, not inside.** Classic items sit in a wrapper `<span>`, so the
  entry is placed after the outermost wrapper that is still inside the menu.

Menus are filled in *after* they open and are then re-rendered wholesale, which
throws the entry away — it flicks in and vanishes. So menus are re-checked on
the very next animation frame after any mutation, not just on the 300ms
debounce, and for a second after any click, since menu contents can arrive late.

Primer also portals its menu to the end of the document rather than leaving it
inside the comment, so the owning comment is resolved from the menu where it is
inline and from the trigger where it is not. A re-render can replace that
trigger too, so the comment whose menu was last opened is remembered; any live
trigger still wins over that memory, so another comment's menu cannot inherit a
stale one.

## Which comment

A pull request review thread nests all of its replies inside a single
`.js-comment-container` (`<review-thread-collapsible>`), so trusting that
container would hand every reply the first comment's menu. A known container is
therefore used only if it holds exactly one comment body; otherwise the code
climbs from the body to the widest ancestor containing this comment and no other.

The summary panel keeps the design handed off in the **GitHub TLDR extension
design** Claude Design project: a 1px box with a static 2px gradient hairline
along the top in GitHub's accent hues, a mono uppercase title and 4px bullet
dots. The animated gradient button that design also specified is gone with the
button itself.

## Caching

A summary is reused rather than re-bought. When the content script attaches to a
comment it sends a `peek` message; a hit renders the panel immediately, titled
`TLDR · cached`, without the menu being opened at all and with no API call. A
miss leaves the panel closed until you choose TLDR.

The cache key is a hash of the model and the exact comment text that was sent to
the API. **That is the version check.** Comments are editable, and an edit moves
the hash, so the old entry is simply never looked up again — there is no
revision number to track and no way to show a summary of text that no longer
exists. Switching models also misses, rather than reusing another model's output.

Entries live in `chrome.storage.local` under `tldrCache`, capped at 200 with the
oldest evicted first. Writes are serialized, because several comments can finish
at once and a plain read-modify-write would drop entries. A failed cache write
never fails the summary. The options page shows the entry count and clears it.

## Tests

Two small Node harnesses run the real source files against a fake `chrome` API —
`content.test.js` drives a simulated GitHub DOM (jsdom), `background.test.js`
stubs `fetch` and checks request shaping and error handling.

```sh
npm install jsdom      # only dependency, only needed for the DOM test
node test/content.test.js
node test/background.test.js
node test/preview.test.js
```

`preview.test.js` loads `preview.html` the way a browser would, so the preview
page can't silently rot as the content script changes.
