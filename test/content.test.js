const { JSDOM } = require('jsdom');
const fs = require('fs');
const vm = require('vm');

const SRC = require('path').join(__dirname, '..', 'content.js');
const long = 'This is a long GitHub comment that definitely deserves a summary. '.repeat(4);

const dom = new JSDOM(`<!doctype html><body>
  <div class="js-comment-container">
    <div class="timeline-comment-header"><div class="timeline-comment-actions"><button>…</button></div></div>
    <div class="comment-body js-comment-body">${long}</div>
  </div>
  <div data-testid="comment-viewer-outer-box">
    <div data-testid="comment-body">${long}</div>
  </div>
  <div class="js-comment-container">
    <div class="comment-body js-comment-body">too short</div>
  </div>
</body>`, { pretendToBeVisual: true, runScripts: 'outside-only' });

const sent = [];
const chrome = {
  runtime: {
    sendMessage: (msg) => { sent.push(msg); return Promise.resolve({ summary: '- first point\n- second point' }); },
  },
};

const ctx = dom.getInternalVMContext();
ctx.chrome = chrome;
vm.runInContext(fs.readFileSync(SRC, 'utf8'), ctx);

const doc = dom.window.document;
const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('ok -', msg); };

const btns = doc.querySelectorAll('.gh-tldr-btn');
assert(btns.length === 2, `button injected on both long comments, skipped the short one (got ${btns.length})`);
assert(doc.querySelector('.timeline-comment-actions .gh-tldr-btn'), 'classic comment: button lands in the action bar');
assert(btns[0].querySelector('svg.gh-tldr-icon'), 'button carries the wand icon');
assert(btns[0].querySelectorAll('svg.gh-tldr-icon path').length === 8, 'icon has all 8 lucide wand-sparkles paths');
assert(btns[0].querySelector('svg.gh-tldr-icon').namespaceURI === 'http://www.w3.org/2000/svg', 'icon built in the SVG namespace');
assert(btns[0].querySelector('.gh-tldr-label').textContent === 'TLDR', 'button still reads TLDR');
assert(doc.querySelector('[data-testid="comment-viewer-outer-box"] .gh-tldr-bar .gh-tldr-btn'), 'react comment: button falls back to its own bar');

(async () => {
  const btn = btns[0];
  const panel = doc.querySelectorAll('.gh-tldr-panel')[0];
  assert(panel.hidden === true, 'panel starts hidden');
  btn.click();
  await new Promise((r) => setTimeout(r, 20));

  assert(sent.length === 1 && sent[0].type === 'tldr', 'one tldr message sent to background');
  assert(sent[0].text.includes('deserves a summary'), 'comment text forwarded');
  assert(panel.hidden === false, 'panel visible after summarizing');
  assert(panel.querySelectorAll('.gh-tldr-list li').length === 2, 'bullets rendered as a list');

  btn.click();
  await new Promise((r) => setTimeout(r, 10));
  assert(panel.hidden === true && sent.length === 1, 'second click hides panel without a second API call');
  btn.click();
  await new Promise((r) => setTimeout(r, 10));
  assert(panel.hidden === false && sent.length === 1, 'third click re-shows the cached summary');

  // error path
  chrome.runtime.sendMessage = () => Promise.resolve({ error: 'No OpenAI API key set.' });
  const btn2 = btns[1];
  btn2.click();
  await new Promise((r) => setTimeout(r, 20));
  const p2 = doc.querySelectorAll('.gh-tldr-panel')[1];
  assert(p2.className.includes('gh-tldr-error') && p2.textContent.includes('No OpenAI API key'), 'error surfaces in the panel');
  assert(btn2.disabled === false, 'button re-enabled after failure');
})();
