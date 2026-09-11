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
| `content.js` | Button injection, panel rendering |
| `content.css` | Styles, themed with GitHub's CSS variables (works in dark mode) |
| `background.js` | OpenAI request |
| `options.html` / `options.js` | Key, model and base URL settings |

## Tests

Two small Node harnesses run the real source files against a fake `chrome` API —
`content.test.js` drives a simulated GitHub DOM (jsdom), `background.test.js`
stubs `fetch` and checks request shaping and error handling.

```sh
npm install jsdom      # only dependency, only needed for the DOM test
node test/content.test.js
node test/background.test.js
```
