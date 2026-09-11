// Talks to OpenAI from the extension context, so the content script never
// needs cross-origin access or sees the API key.

const DEFAULTS = {
  openaiModel: 'gpt-4o-mini',
  openaiBaseUrl: 'https://api.openai.com/v1',
};

const SYSTEM_PROMPT =
  'You summarize GitHub comments for a busy developer. Reply with a TLDR of at most ' +
  '3 short bullet points, each starting with "- ". No preamble, no markdown headings, ' +
  'no code fences. Keep names, numbers and decisions; drop pleasantries. ' +
  'If the comment asks for something or blocks progress, say so explicitly.';

const MAX_CHARS = 12000; // keep requests cheap; comments are rarely longer

async function getSettings() {
  const stored = await chrome.storage.local.get(['openaiKey', 'openaiModel', 'openaiBaseUrl']);
  return { ...DEFAULTS, ...stored };
}

async function tldr(text) {
  const { openaiKey, openaiModel, openaiBaseUrl } = await getSettings();
  if (!openaiKey) {
    throw new Error('No OpenAI API key set. Open the extension options and add one.');
  }

  const body = {
    model: openaiModel,
    temperature: 0.2,
    max_tokens: 300,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text.slice(0, MAX_CHARS) },
    ],
  };

  const res = await fetch(`${openaiBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error?.message || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }

  const summary = data?.choices?.[0]?.message?.content?.trim();
  if (!summary) throw new Error('Empty response from OpenAI.');
  return summary;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'tldr') return;
  tldr(msg.text)
    .then((summary) => sendResponse({ summary }))
    .catch((err) => sendResponse({ error: err.message }));
  return true; // keep the message channel open for the async reply
});
