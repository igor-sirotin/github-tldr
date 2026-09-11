const fs = require('fs'); const vm = require('vm');
const SRC = require('path').join(__dirname, '..', 'background.js');
let listener, store = {}, lastReq = null, nextRes;
const ctx = vm.createContext({
  chrome: {
    storage: { local: { get: (keys) => Promise.resolve(Object.fromEntries(Object.entries(store).filter(([k]) => keys.includes(k)))) } },
    runtime: { onMessage: { addListener: (fn) => { listener = fn; } } },
  },
  fetch: (url, opts) => { lastReq = { url, opts }; return Promise.resolve(nextRes); },
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
  assert(body.model === 'gpt-4o-mini', 'default model applied');
  assert(body.messages[1].content === 'some comment', 'comment sent as the user message');

  store = { openaiKey: 'sk-test', openaiBaseUrl: 'https://proxy.example/v1/', openaiModel: 'gpt-5' };
  await call('x');
  assert(lastReq.url === 'https://proxy.example/v1/chat/completions', 'custom base URL, trailing slash trimmed');
  assert(JSON.parse(lastReq.opts.body).model === 'gpt-5', 'custom model applied');

  nextRes = { ok: false, status: 401, statusText: 'Unauthorized', json: () => Promise.resolve({ error: { message: 'Incorrect API key provided' } }) };
  r = await call('x');
  assert(r.error === 'Incorrect API key provided', 'OpenAI error message passed through');

  assert(JSON.parse(lastReq.opts.body).messages[1].content.length <= 12000, 'input truncated to the cap');
  nextRes = { ok: true, json: () => Promise.resolve({ choices: [{ message: { content: '' } }] }) };
  r = await call('x');
  assert(/Empty response/.test(r.error), 'empty completion reported as an error');
})();
