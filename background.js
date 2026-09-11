// Talks to OpenAI from the extension context, so the content script never
// needs cross-origin access or sees the API key.

const DEFAULTS = {
  openaiModel: 'gpt-5.6-luna',
  openaiBaseUrl: 'https://api.openai.com/v1',
};

const SYSTEM_PROMPT =
  'You summarize GitHub comments for a busy developer. Reply with a TLDR of at most ' +
  '3 short bullet points, each starting with "- ". No preamble, no markdown headings, ' +
  'no code fences. Keep names, numbers and decisions; drop pleasantries. ' +
  'If the comment asks for something or blocks progress, say so explicitly.';

const MAX_CHARS = 12000; // keep requests cheap; comments are rarely longer
const MAX_OUTPUT_TOKENS = 500; // a 3-bullet TLDR, with headroom for reasoning tokens

// Model families disagree about parameters: reasoning models want
// max_completion_tokens and a fixed temperature, older chat models reject
// reasoning_effort. Rather than hardcode a table that goes stale, learn what a
// model refuses from its own error and stop sending it.
const unsupported = new Map(); // model id -> Set of parameter names

function markUnsupported(model, param) {
  if (!unsupported.has(model)) unsupported.set(model, new Set());
  unsupported.get(model).add(param);
}

function buildBody(model, text) {
  const skip = unsupported.get(model) || new Set();
  const body = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: sentText(text) },
    ],
  };
  // Summarizing needs no deliberation; 'none' keeps latency and billed
  // reasoning tokens down on reasoning models.
  if (!skip.has('reasoning_effort')) body.reasoning_effort = 'none';
  if (!skip.has('temperature')) body.temperature = 0.2;
  if (skip.has('max_tokens')) body.max_completion_tokens = MAX_OUTPUT_TOKENS;
  else body.max_tokens = MAX_OUTPUT_TOKENS;
  return body;
}

function droppableParam(error) {
  const param = error?.param;
  if (!param) return null;
  const code = error.code || '';
  const unsupportedish =
    code === 'unsupported_parameter' ||
    code === 'unsupported_value' ||
    /unsupported|not supported/i.test(error.message || '');
  return unsupportedish ? param : null;
}

const CACHE_KEY = 'tldrCache';
const CACHE_LIMIT = 200; // entries; oldest are dropped first

// Cache entries are keyed by a hash of the model plus the exact comment text
// that was sent. That is the version check: edit a comment and the hash moves,
// so the old entry is simply never looked up again. No separate revision field
// to keep in sync, and no way to show a summary of text that no longer exists.
function cacheKey(model, payload) {
  let h = 5381;
  for (let i = 0; i < payload.length; i += 1) {
    h = ((h << 5) + h + payload.charCodeAt(i)) | 0;
  }
  const tag = String(model).replace(/[^a-z0-9.\-]/gi, '');
  return `${tag}:${(h >>> 0).toString(36)}:${payload.length}`;
}

// What actually goes to the API, and therefore what the key must cover.
function sentText(text) {
  return text.slice(0, MAX_CHARS);
}

async function readCache() {
  const stored = await chrome.storage.local.get(CACHE_KEY);
  const cache = stored[CACHE_KEY];
  return cache && typeof cache === 'object' ? cache : {};
}

// Several comments can finish at once, and a bare read-modify-write would let
// the last writer drop the others. Serialize them.
let writes = Promise.resolve();
function writeCache(key, summary) {
  writes = writes
    .then(async () => {
      const cache = await readCache();
      cache[key] = { summary, at: Date.now() };
      const keys = Object.keys(cache);
      if (keys.length > CACHE_LIMIT) {
        keys.sort((a, b) => (cache[a].at || 0) - (cache[b].at || 0));
        for (const stale of keys.slice(0, keys.length - CACHE_LIMIT)) delete cache[stale];
      }
      await chrome.storage.local.set({ [CACHE_KEY]: cache });
    })
    .catch(() => {}); // a failed cache write must not fail the summary
  return writes;
}

// Look up without ever calling the API — this runs for every comment on the
// page, so it must stay free.
async function peek(text) {
  const { openaiModel } = await getSettings();
  const cache = await readCache();
  const hit = cache[cacheKey(openaiModel, sentText(text))];
  return hit ? hit.summary : null;
}

async function getSettings() {
  const stored = await chrome.storage.local.get(['openaiKey', 'openaiModel', 'openaiBaseUrl']);
  return { ...DEFAULTS, ...stored };
}

async function tldr(text) {
  const { openaiKey, openaiModel, openaiBaseUrl } = await getSettings();
  if (!openaiKey) {
    throw new Error('No OpenAI API key set. Open the extension options and add one.');
  }

  const key = cacheKey(openaiModel, sentText(text));
  const cache = await readCache();
  if (cache[key]) return cache[key].summary;

  const url = `${openaiBaseUrl.replace(/\/+$/, '')}/chat/completions`;
  let data = null;
  let ok = false;

  // At most one retry per droppable parameter, then give up.
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify(buildBody(openaiModel, text)),
    });

    data = await res.json().catch(() => null);
    if (res.ok) {
      ok = true;
      break;
    }

    const param = droppableParam(data?.error);
    const known = unsupported.get(openaiModel);
    if (param && !(known && known.has(param))) {
      markUnsupported(openaiModel, param);
      continue; // rebuild without it and try again
    }
    throw new Error(data?.error?.message || `${res.status} ${res.statusText}`);
  }

  // Ran out of attempts while still stripping parameters.
  if (!ok) throw new Error(data?.error?.message || 'Request rejected by the API.');

  const summary = data?.choices?.[0]?.message?.content?.trim();
  if (!summary) {
    const reason = data?.choices?.[0]?.finish_reason;
    throw new Error(
      reason === 'length'
        ? 'Response cut off before any summary — the model spent the token budget on reasoning.'
        : 'Empty response from OpenAI.'
    );
  }
  await writeCache(key, summary);
  return summary;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'peek') {
    peek(msg.text)
      .then((summary) => sendResponse(summary ? { summary, cached: true } : {}))
      .catch(() => sendResponse({}));
    return true;
  }

  if (msg?.type !== 'tldr') return;
  tldr(msg.text)
    .then((summary) => sendResponse({ summary }))
    .catch((err) => sendResponse({ error: err.message }));
  return true; // keep the message channel open for the async reply
});
