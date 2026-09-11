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
      { role: 'user', content: text.slice(0, MAX_CHARS) },
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

async function getSettings() {
  const stored = await chrome.storage.local.get(['openaiKey', 'openaiModel', 'openaiBaseUrl']);
  return { ...DEFAULTS, ...stored };
}

async function tldr(text) {
  const { openaiKey, openaiModel, openaiBaseUrl } = await getSettings();
  if (!openaiKey) {
    throw new Error('No OpenAI API key set. Open the extension options and add one.');
  }

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
  return summary;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'tldr') return;
  tldr(msg.text)
    .then((summary) => sendResponse({ summary }))
    .catch((err) => sendResponse({ error: err.message }));
  return true; // keep the message channel open for the async reply
});
