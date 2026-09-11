# GitHub TLDR

A small Chrome/Edge extension (Manifest V3) that adds a **TLDR** button to every
GitHub comment. Click it and the comment is summarized into at most three bullets
by the OpenAI API.

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

- `content.js` finds comment bodies on `github.com` (classic timeline and the
  React issue views), injects a **TLDR** button into the comment's action bar,
  and renders the result in a panel above the comment. A `MutationObserver`
  handles GitHub's client-side navigation and lazily loaded comments.
- `background.js` reads the settings and calls
  `POST {baseUrl}/chat/completions`, returning the summary to the content script.
- Comments shorter than 120 characters get no button; comment text is truncated
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

Clicking **TLDR** again hides/shows the existing summary — it does not re-bill a
second request.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest, `github.com` content script, `api.openai.com` host permission |
| `content.js` | Button injection, wand icon, panel rendering, cache peek |
| `preview.html` | Standalone design preview, no extension install needed |
| `content.css` | Styles, themed with GitHub's CSS variables (works in dark mode) |
| `background.js` | OpenAI request, summary cache |
| `options.html` / `options.js` | Key, model and base URL settings, cache size and clear |

## Previewing the button without installing

Open `preview.html` in a browser — no extension loading, no build step, no server:

```sh
xdg-open preview.html    # or just double-click it
```

It loads the extension's real `content.css` and `content.js` and stubs only the
extension APIs, so the button you see is the one that ships. There is a button
states row (idle and loading side by side), three mock comments, and a theme
toggle. The stub fails every second call so the error state is reachable, and
the third comment is pre-seeded in the stub's cache so it opens on load without
a click — press **Clear cache** to put it back.

## Button styling

`content.css` is the design handed off in the **GitHub TLDR extension design**
Claude Design project, applied verbatim.

The **TLDR** button carries [lucide.dev](https://lucide.dev)'s `wand-sparkles`
icon, stroked with `currentColor` so it follows the GitHub theme. It is built
with `createElementNS` rather than assigned as an `innerHTML` string, which is
the one deliberate deviation from the handoff's `content.js`; the rendered
result is identical.

The sheen timings are the one deviation from the handoff, at explicit request:
5x slower than specified (35s at rest, 11s hover, 7s loading, against the
handoff's 7s / 2.2s / 1.4s), because the original read as distracting on a long
thread. This is effectively an answer to the handoff's own open question. The
wand wave is a rotation rather than a colour cycle and stays at 1s.

The gradient stroke is a two-layer background — a flat surface layer clipped to
`padding-box` over a `#0969da → #8250df → #bf3989 → #bc4c00 → #1a7f37` gradient
clipped to `border-box`, all GitHub's own accent hues. The `gh-tldr-sheen`
animation slides that second layer, 7s at rest, 2.2s on hover, 1.4s while
loading, where the wand also waves ±12°. The surface layer reads
`--gh-tldr-surface` so the button stays legible in dark mode.

The panel drops the old blue left border for a 1px box with a static 2px
gradient hairline along the top — deliberately still, so the result does not
compete with the control — a mono uppercase title and custom 4px bullet dots.

`prefers-reduced-motion` disables the sheen and the wave. The sheen runs whenever
a button is on screen; to restrict it to hover, move `animation: gh-tldr-sheen …`
from `.gh-tldr-btn` into `.gh-tldr-btn:hover:not(:disabled)`.

## Where the button is placed

First the extension decides **which comment it is placing into**. That is not
always the nearest container with a familiar class: a pull request review thread
nests all of its replies inside a single `.js-comment-container`
(`<review-thread-collapsible>`), so trusting that container would hand every
reply the *first* comment's header and stack every button there. A known
container is therefore used only if it holds exactly one comment body; otherwise
the code climbs from the body to the widest ancestor that still contains this
comment and no other.

Then the button goes immediately **left of the `Member` / `Collaborator` badge**,
in issues, comments and PRs alike. Strategies, in order:

1. **The React issue badges row** (`IssueBodyHeader-module__badgesSection`) —
   holds the badge group and then the kebab.
2. **The classic/PR header row** — the flex row wrapping
   `.timeline-comment-actions`, which is where the badge lives as a sibling.
3. **Other action bars**, then **a bare header**, then **its own row above the
   body** as the last resort.

Left is not the same as first child: GitHub lays the classic header out with
`flex-row-reverse`, so DOM order there runs right to left while the React badges
row runs the usual way. `insertLeftmost()` reads `getComputedStyle(row)
.flexDirection` and appends or prepends accordingly, rather than assuming either.

Those React headers are CSS modules whose class names carry a per-deploy build
hash (`ActivityHeader-module__activityHeader__ZGlyB`), so the selectors match the
stable module prefix with `[class*="…"]`, never the hash.

The button centres itself with `align-self: center` for GitHub's flex header
rows plus `vertical-align: middle` for inline ones, an explicit `line-height`
so its box stays symmetric around the label, and `display: block` on the icon to
drop the inline baseline gap under the glyph.

## Caching

A summary is reused rather than re-bought. When the content script attaches to a
comment it sends a `peek` message; a hit renders the panel immediately, titled
`TLDR · cached`, with no click and no API call. A miss leaves the panel closed.

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
