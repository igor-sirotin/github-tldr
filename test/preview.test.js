// Loads preview.html exactly as a browser would (real content.js + content.css)
// and drives the button, so the preview page can't silently rot.
const { JSDOM } = require('jsdom');
const path = require('path');

const file = 'file://' + path.join(__dirname, '..', 'preview.html');
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok -', m); };

JSDOM.fromURL(file, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true })
  .then((dom) => new Promise((r) => dom.window.addEventListener('load', () => setTimeout(() => r(dom), 200))))
  .then(async (dom) => {
    const doc = dom.window.document;

    const injected = doc.querySelectorAll('.timeline-comment-actions .gh-tldr-btn');
    assert(injected.length === 3, `a button is injected into each of the three mock comments (got ${injected.length})`);
    assert(doc.querySelectorAll('.states .gh-tldr-btn').length === 2, 'the states row shows idle and loading buttons');
    assert(doc.querySelector('.states .gh-tldr-btn.is-loading[disabled]'), 'loading state button is present and disabled');
    assert(doc.querySelectorAll('svg.gh-tldr-wand').length === 5, 'every button carries the wand icon');
    assert(doc.querySelector('link[href="content.css"]'), 'preview links the real stylesheet');

    // The pre-seeded comment must be summarized on load, with no click.
    const panels = doc.querySelectorAll('.gh-tldr-panel');
    const seeded = panels[panels.length - 1];
    assert(seeded && seeded.hidden === false, 'pre-cached comment opens its panel on load');
    assert(seeded.querySelector('.gh-tldr-title').textContent === 'TLDR · cached', 'and is labelled as cached');
    assert(seeded.querySelectorAll('.gh-tldr-list li').length === 3, 'cached summary renders its bullets');

    // The other two still start closed.
    assert(panels[0].hidden === true && panels[1].hidden === true, 'uncached comments start closed');

    injected[0].click();
    assert(injected[0].classList.contains('is-loading'), 'loading class applied while waiting (drives the wand wave)');
    await new Promise((r) => setTimeout(r, 1100));
    assert(panels[0].hidden === false, 'stubbed summary renders');
    assert(panels[0].querySelectorAll('.gh-tldr-list li').length === 3, 'three bullets in the preview summary');
    assert(panels[0].querySelector('.gh-tldr-title').textContent === 'TLDR', 'a fresh summary is not labelled cached');
    assert(!injected[0].classList.contains('is-loading'), 'loading class cleared when done');

    // The stub fails every second call, so the next one shows the error state.
    injected[1].click();
    await new Promise((r) => setTimeout(r, 1100));
    assert(panels[1].className.includes('gh-tldr-error'), 'second click reaches the error state');

    doc.getElementById('theme').click();
    assert(doc.documentElement.dataset.previewTheme === 'dark', 'theme toggle works');

    doc.getElementById('clear').click();
    assert(seeded.hidden === true && panels[0].hidden === true, 'clear cache closes every panel again');
    dom.window.close();
  })
  .catch((e) => { console.error('FAIL:', e.message); process.exitCode = 1; });
