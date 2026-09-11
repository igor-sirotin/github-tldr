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
| `content.js` | Button injection, wand icon, panel rendering |
| `preview.html` | Standalone design preview, no extension install needed |
| `content.css` | Styles, themed with GitHub's CSS variables (works in dark mode) |
| `background.js` | OpenAI request |
| `options.html` / `options.js` | Key, model and base URL settings |

## Previewing the button without installing

Open `preview.html` in a browser — no extension loading, no build step, no server:

```sh
xdg-open preview.html    # or just double-click it
```

It loads the extension's real `content.css` and `content.js` and stubs only the
OpenAI call, so the button you see is the one that ships. There are mock comments
in both GitHub layouts, a dark-mode toggle, and one comment wired to the error
path. Hover the button to spin the stroke; click it for the loading and result
states.

## Button styling

The **TLDR** button carries [lucide.dev](https://lucide.dev)'s `wand-sparkles`
icon, inlined as SVG built with `createElementNS` (no `innerHTML`, so it is
CSP-safe) and stroked with `currentColor` so it follows the GitHub theme.

Its multi-colored stroke is a `conic-gradient` on a `::before` pseudo-element,
masked with `mask-composite: exclude` down to a 1px ring — which leaves the
button's interior transparent, so it sits on any GitHub background. The gradient
rotates by animating an `@property`-registered `--gh-tldr-angle`, which is what
makes an angle animatable at all.

The ring only animates on `:hover` and while a summary is loading — a page with
forty comments should not shimmer. To make it always spin, move the `animation`
line out of the `:hover, .is-loading` rule in `content.css` and into
`.gh-tldr-btn::before`. `prefers-reduced-motion` disables it either way.

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
