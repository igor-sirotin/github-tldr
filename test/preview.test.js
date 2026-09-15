// Loads preview.html exactly as a browser would (real content.js + content.css)
// and drives the menu, so the preview page can't silently rot.
const { JSDOM } = require('jsdom');
const path = require('path');

const file = 'file://' + path.join(__dirname, '..', 'preview.html');
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok -', m); };

JSDOM.fromURL(file, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true })
  .then((dom) => new Promise((r) => dom.window.addEventListener('load', () => setTimeout(() => r(dom), 300))))
  .then(async (dom) => {
    const doc = dom.window.document;
    const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    const menus = doc.querySelectorAll('details-menu');
    assert(menus.length === 8, `every mock comment has a menu, plus the always-open demo (got ${menus.length})`);
    assert(doc.querySelectorAll('.gh-tldr-entry').length === 8, 'every menu gets a TLDR entry');
    assert(doc.querySelectorAll('.gh-tldr-btn').length === 0, 'no injected buttons remain in the preview');

    // The design's inspection aids.
    const open = doc.querySelector('.states .open-menu');
    assert(open && open.querySelector('.gh-tldr-entry'), 'the always-open menu shows the entry without clicking');
    const demo = doc.getElementById('fill-demo');
    assert(demo && demo.querySelectorAll('.gh-tldr-blob').length === 7, 'the magnified hover-fill demo is present');
    assert(doc.getElementById('gh-tldr-icon-gradient'), 'the icon gradient paint server is injected');
    assert(doc.querySelector('link[href="content.css"]'), 'preview links the real stylesheet');

    for (const menu of menus) {
      const labels = [...menu.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent.trim());
      assert(labels[labels.indexOf('Quote reply') + 1] === 'TLDR', `TLDR follows Quote reply (${labels.join(' | ')})`);
      const entry = menu.querySelector('.gh-tldr-entry');
      assert(entry.compareDocumentPosition(menu.querySelector('.dropdown-divider')) & 4, 'entry is in the first section');
      const sibling = menu.querySelector('.js-comment-quote-reply').parentElement;
      assert(entry.tagName === sibling.tagName, 'entry matches the wrapper element of a real item');
      assert(entry.querySelector('svg.gh-tldr-wand'), 'entry carries the wand in the native icon slot');
      assert(entry.querySelector('.gh-tldr-label').textContent === 'TLDR', 'label is wrapped for the gradient');
      assert(entry.querySelectorAll('.gh-tldr-blob').length === 7, 'entry carries the seven-blob hover mesh');
    }

    // Each thread reply keeps its own entry and its own panel.
    const replies = doc.querySelectorAll('review-thread-collapsible .js-comment.review-comment');
    assert(replies.length === 3, 'thread mock has three comments');
    for (const [n, reply] of [...replies].entries()) {
      assert(reply.querySelectorAll('.gh-tldr-entry').length === 1, `thread reply ${n + 1} has exactly one entry`);
    }

    // The pre-seeded comment still opens on load, with no interaction at all.
    const seededPanel = [...doc.querySelectorAll('.gh-tldr-panel')]
      .find((el) => el.parentElement.textContent.includes('PRESEEDED'));
    assert(seededPanel && seededPanel.hidden === false, 'pre-cached comment opens its panel on load');
    assert(seededPanel.querySelector('.gh-tldr-title').textContent === 'TLDR · cached', 'and is labelled as cached');

    // Choosing TLDR summarizes and closes the menu.
    const first = doc.querySelector('details-menu');
    const panel = first.closest('.timeline-comment').querySelector('.gh-tldr-panel');
    assert(panel.hidden === true, 'uncached comment starts closed');
    click(first.querySelector('.gh-tldr-entry .gh-tldr-menu-item'));
    assert(first.closest('details').open === false, 'menu closes on choosing TLDR');
    await new Promise((r) => setTimeout(r, 1100));
    assert(panel.hidden === false, 'stubbed summary renders');
    assert(panel.querySelectorAll('.gh-tldr-list li').length === 3, 'three bullets in the preview summary');
    assert(panel.querySelector('.gh-tldr-title').textContent === 'TLDR', 'a fresh summary is not labelled cached');

    // The stub fails every second call, so the next one shows the error state.
    const second = doc.querySelectorAll('details-menu')[1];
    click(second.querySelector('.gh-tldr-entry .gh-tldr-menu-item'));
    await new Promise((r) => setTimeout(r, 1100));
    assert(second.closest('.timeline-comment').querySelector('.gh-tldr-panel').className.includes('gh-tldr-error'),
      'second choice reaches the error state');

    doc.getElementById('theme').click();
    assert(doc.documentElement.dataset.previewTheme === 'dark', 'theme toggle works');
    doc.getElementById('clear').click();
    assert(seededPanel.hidden === true && panel.hidden === true, 'clear cache closes every panel again');
    dom.window.close();
  })
  .catch((e) => { console.error('FAIL:', e.message); process.exitCode = 1; });
