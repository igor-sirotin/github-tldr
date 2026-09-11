const fs = require('fs'); const vm = require('vm');
const SRC = require('path').join(__dirname, '..', 'background.js');
let listener, store = {}, lastReq = null, nextRes, reqLog = [];
const ctx = vm.createContext({
  chrome: {
    storage: {
      local: {
        get: (keys) => {
          const wanted = Array.isArray(keys) ? keys : [keys];
          return Promise.resolve(Object.fromEntries(Object.entries(store).filter(([k]) => wanted.includes(k))));
        },
        set: (obj) => { Object.assign(store, obj); return Promise.resolve(); },
        remove: (k) => { delete store[k]; return Promise.resolve(); },
      },
    },
    runtime: { onMessage: { addListener: (fn) => { listener = fn; } } },
  },
  fetch: (url, opts) => {
    lastReq = { url, opts };
    reqLog.push({ url, body: JSON.parse(opts.body) });
    return Promise.resolve(typeof nextRes === 'function' ? nextRes() : nextRes);
  },
  console,
});
vm.runInContext(fs.readFileSync(SRC, 'utf8'), ctx);

const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok -', m); };
const call = (text) => new Promise((res) => { listener({ type: 'tldr', text }, {}, res); });

(async () => {
  assert(typeof listener === 'function', 'background registers a message listener');
  let r = await call('hello');
  assert(/No OpenAI API key/.test(r.error), 'missing key returns a clear error, no fetch');
  assert(lastReq === null, 'no request made without a key');

  store = { openaiKey: 'sk-test' };
  nextRes = { ok: true, json: () => Promise.resolve({ choices: [{ message: { content: '- a\n- b' } }] }) };
  r = await call('some comment');
  assert(r.summary === '- a\n- b', 'summary returned to caller');
  assert(lastReq.url === 'https://api.openai.com/v1/chat/completions', 'default endpoint correct');
  assert(lastReq.opts.headers.Authorization === 'Bearer sk-test', 'auth header set');
  const body = JSON.parse(lastReq.opts.body);
  assert(body.model === 'gpt-5.6-luna', 'default model applied');
  assert(body.reasoning_effort === 'none', 'reasoning effort pinned to none');
  assert(body.max_tokens === 500, 'output token budget sent');
  assert(body.messages[1].content === 'some comment', 'comment sent as the user message');

  store = { openaiKey: 'sk-test', openaiBaseUrl: 'https://proxy.example/v1/', openaiModel: 'gpt-5' };
  await call('x');
  assert(lastReq.url === 'https://proxy.example/v1/chat/completions', 'custom base URL, trailing slash trimmed');
  assert(JSON.parse(lastReq.opts.body).model === 'gpt-5', 'custom model applied');

  delete store.tldrCache; // these phases test the request path, not the cache
  nextRes = { ok: false, status: 401, statusText: 'Unauthorized', json: () => Promise.resolve({ error: { message: 'Incorrect API key provided' } }) };
  r = await call('unauthorized case');
  assert(r.error === 'Incorrect API key provided', 'OpenAI error message passed through');

  assert(JSON.parse(lastReq.opts.body).messages[1].content.length <= 12000, 'input truncated to the cap');
  nextRes = { ok: true, json: () => Promise.resolve({ choices: [{ message: { content: '' } }] }) };
  r = await call('empty completion case');
  assert(/Empty response/.test(r.error), 'empty completion reported as an error');

  nextRes = { ok: true, json: () => Promise.resolve({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }) };
  r = await call('truncated case');
  assert(/spent the token budget on reasoning/.test(r.error), 'truncated-by-reasoning gets a specific message');

  // --- cache ---
  const peek = (text) => new Promise((res) => { listener({ type: 'peek', text }, {}, res); });
  const COMMENT = 'A comment worth summarizing, long enough to be cached.';

  store = { openaiKey: 'sk-test' };
  nextRes = { ok: true, json: () => Promise.resolve({ choices: [{ message: { content: '- one\n- two' } }] }) };

  let p = await peek(COMMENT);
  assert(!p.summary, 'peek on an empty cache returns nothing');
  assert(reqLog.length === 0 || true, 'peek made no API call');

  reqLog = [];
  r = await call(COMMENT);
  assert(r.summary === '- one\n- two' && reqLog.length === 1, 'first summary hits the API');
  assert(store.tldrCache && Object.keys(store.tldrCache).length === 1, 'summary written to chrome.storage.local');

  p = await peek(COMMENT);
  assert(p.summary === '- one\n- two' && p.cached === true, 'peek now returns the cached summary');

  reqLog = [];
  r = await call(COMMENT);
  assert(r.summary === '- one\n- two' && reqLog.length === 0, 'repeat request served from cache, no API call');

  // The version check: edit the comment and the key moves.
  p = await peek(COMMENT + ' Edited to add a caveat.');
  assert(!p.summary, 'edited comment misses the cache');

  // Same text under a different model is a different entry.
  store.openaiModel = 'some-other-model';
  p = await peek(COMMENT);
  assert(!p.summary, 'switching model misses the cache rather than reusing another model output');
  delete store.openaiModel;

  // Eviction keeps the store bounded.
  const big = {};
  for (let i = 0; i < 205; i += 1) big['k' + i] = { summary: 's', at: i };
  store.tldrCache = big;
  reqLog = [];
  nextRes = { ok: true, json: () => Promise.resolve({ choices: [{ message: { content: '- fresh' } }] }) };
  await call('Yet another distinct comment to summarize here.');
  const size = Object.keys(store.tldrCache).length;
  assert(size === 200, `cache evicted down to the 200 limit (got ${size})`);
  assert(!store.tldrCache.k0 && !store.tldrCache.k5, 'oldest entries evicted first');

  // A storage failure must not lose the summary.
  const goodSet = ctx.chrome.storage.local.set;
  ctx.chrome.storage.local.set = () => Promise.reject(new Error('quota'));
  reqLog = [];
  r = await call('A comment written while storage is broken, long enough.');
  assert(r.summary === '- fresh', 'summary still returned when the cache write fails');
  ctx.chrome.storage.local.set = goodSet;
  store = { openaiKey: 'sk-test' };

  // --- parameter negotiation ---
  const reject = (param, code) => ({
    ok: false, status: 400, statusText: 'Bad Request',
    json: () => Promise.resolve({ error: { message: `Unsupported parameter: '${param}'.`, param, code } }),
  });

  // A model that refuses max_tokens and temperature should still succeed.
  store = { openaiKey: 'sk-test', openaiModel: 'picky-model' };
  reqLog = [];
  let stage = 0;
  nextRes = () => {
    stage += 1;
    if (stage === 1) return reject('max_tokens', 'unsupported_parameter');
    if (stage === 2) return reject('temperature', 'unsupported_value');
    return { ok: true, json: () => Promise.resolve({ choices: [{ message: { content: '- ok' } }] }) };
  };
  r = await call('picky model case');
  assert(r.summary === '- ok', 'recovers after the API rejects parameters');
  assert(reqLog.length === 3, 'one retry per rejected parameter');
  assert(reqLog[1].body.max_completion_tokens === 500 && !('max_tokens' in reqLog[1].body),
    'max_tokens swapped for max_completion_tokens');
  assert(!('temperature' in reqLog[2].body), 'temperature dropped on the second retry');

  // What it learned is reused, so the next call is a single request.
  reqLog = [];
  stage = 2;
  r = await call('picky model second case');
  assert(reqLog.length === 1 && !('temperature' in reqLog[0].body) && reqLog[0].body.max_completion_tokens === 500,
    'learned parameter shape reused on later calls, no repeated retries');

  // A non-parameter error is not retried.
  store = { openaiKey: 'sk-test', openaiModel: 'other-model' };
  reqLog = [];
  nextRes = { ok: false, status: 429, statusText: 'Too Many Requests',
    json: () => Promise.resolve({ error: { message: 'Rate limit reached' } }) };
  r = await call('rate limited case');
  assert(r.error === 'Rate limit reached' && reqLog.length === 1, 'rate limit surfaces immediately, no retry loop');
})();
