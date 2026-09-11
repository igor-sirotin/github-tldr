// Loads preview.html exactly as a browser would (real content.js + content.css)
// and drives the button, so the preview page can't silently rot.
const { JSDOM } = require('jsdom');
const path = require('path');

const file = 'file://' + path.join(__dirname, '..', 'preview.html');
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok -', m); };

JSDOM.fromURL(file, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true })
  .then((dom) => new Promise((r) => dom.window.addEventListener('load', () => setTimeout(() => r(dom), 100))))
  .then(async (dom) => {
    const doc = dom.window.document;
    const btns = doc.querySelectorAll('.gh-tldr-btn');
    assert(btns.length === 2, `preview injects a button into both mock comments (got ${btns.length})`);
    assert(doc.querySelector('.timeline-comment-actions .gh-tldr-btn'), 'classic mock: button in the action bar');
    assert(doc.querySelectorAll('svg.gh-tldr-icon').length === 2, 'wand icon rendered in the preview');
    assert(doc.querySelector('link[href="content.css"]'), 'preview links the real stylesheet');

    btns[0].click();
    assert(btns[0].classList.contains('is-loading'), 'loading class applied while waiting (drives the spin)');
    await new Promise((r) => setTimeout(r, 1100));
    const panel = doc.querySelectorAll('.gh-tldr-panel')[0];
    assert(panel.hidden === false, 'stubbed summary renders');
    assert(panel.querySelectorAll('.gh-tldr-list li').length === 3, 'three bullets in the preview summary');
    assert(!btns[0].classList.contains('is-loading'), 'loading class cleared when done');

    btns[1].click();
    await new Promise((r) => setTimeout(r, 1100));
    const p2 = doc.querySelectorAll('.gh-tldr-panel')[1];
    assert(p2.className.includes('gh-tldr-error'), 'FAIL-wired comment shows the error state');

    doc.getElementById('theme').click();
    assert(doc.documentElement.dataset.previewTheme === 'dark', 'dark mode toggle works');
    doc.getElementById('reset').click();
    assert(doc.querySelectorAll('.gh-tldr-panel')[0].hidden === true, 'reset hides panels again');
    dom.window.close();
  })
  .catch((e) => { console.error('FAIL:', e.message); process.exitCode = 1; });
