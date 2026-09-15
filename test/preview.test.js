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
    assert(menus.length === 7, `legacy menus: one per comment plus the always-open demo (got ${menus.length})`);

    // The React issue view renders Primer's slot layout, where the glyph has its
    // own gap — the shape that showed a stray margin as padding on the label.
    const lists = doc.querySelectorAll('ul.ActionList');
    assert(lists.length === 2, `both ActionList menus are present (got ${lists.length})`);
    for (const list of lists) {
      const entry = list.querySelector('.gh-tldr-entry');
      assert(entry && entry.tagName === 'LI', 'ActionList menu gets an <li> entry');
      const styled = entry.querySelector('.gh-tldr-menu-item');
      assert(styled && styled.classList.contains('ActionList-content'),
        'the hover styling lands on the content element, not the li');
      assert(styled.dataset.tldrMenu === 'actionlist', 'tagged as the actionlist variant');

      // GitHub spaces these children with a margin rule aimed at every direct
      // child, which an absolutely positioned overlay also picks up — and a
      // right margin shrinks such a box rather than being ignored. The host's
      // own children must keep that spacing; only the mesh opts out.
      const win = dom.window;
      const hostChild = entry.querySelector('.ActionList-item-visual');
      assert(win.getComputedStyle(hostChild).marginRight.includes('control-medium-gap'),
        "the preview really does reproduce GitHub's child-spacing rule");
      const meshEl = entry.querySelector('.gh-tldr-mesh');
      assert(win.getComputedStyle(meshEl).marginRight === '0px',
        `the mesh opts out of it, so the fill is not shrunk on the right (got ${win.getComputedStyle(meshEl).marginRight})`);
      assert(meshEl.style.getPropertyPriority('inset') === 'important',
        'and its measured inset is set with priority, so a host rule cannot move it');

      // jsdom computes no geometry, so compare the boxes by proxy: the element
      // we fill must be the same kind of element, with the same classes, as the
      // one a neighbouring item fills. Then its border box — and so the fill's
      // right edge — is theirs.
      const neighbour = [...list.querySelectorAll('.ActionList-content')].find((el) => el !== styled);
      assert(neighbour, 'there is a neighbouring item to compare against');
      assert(styled.tagName === neighbour.tagName, 'entry fills the same kind of element as its neighbours');
      const ours = [...styled.classList].filter((c) => !c.startsWith('gh-tldr-')).sort().join(' ');
      const theirs = [...neighbour.classList].filter((c) => !c.startsWith('js-')).sort().join(' ');
      assert(ours === theirs, `and the same classes, so the same box (ours: "${ours}" vs "${theirs}")`);
      assert(entry.querySelector('.gh-tldr-wand').closest('.ActionList-item-visual'),
        'wand sits in the visual slot');
      assert(entry.querySelector('.gh-tldr-label').classList.contains('ActionList-item-label'),
        "ActionList's own label element is re-used rather than wrapped");
      const labels = [...list.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent.trim());
      assert(labels[labels.indexOf('Quote reply') + 1] === 'TLDR', `TLDR follows Quote reply (${labels.join(' | ')})`);
    }

    // Entries start at different points in the animation cycle.
    const phases = [...doc.querySelectorAll('.gh-tldr-entry')].map((el) => el.style.getPropertyValue('--gh-tldr-phase'));
    assert(phases.every((p) => /^-\d+(\.\d+)?s$/.test(p)), 'every entry carries a negative animation phase');
    assert(new Set(phases).size > 1, 'and they are not all the same');

    // The legacy menu has no icons at all, so the entry adds none there either.
    const legacyEntry = doc.querySelector('details-menu:not(.ActionList) .gh-tldr-entry');
    assert(legacyEntry, 'legacy menu gets an entry');
    assert(!legacyEntry.querySelector('svg'), 'and no icon, because that menu has none');
    assert(legacyEntry.querySelector('.gh-tldr-menu-item').dataset.tldrMenu === 'dropdown',
      'tagged as the dropdown variant');
    assert(doc.querySelectorAll('.gh-tldr-entry').length === 9, 'every menu in both systems gets a TLDR entry');
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
    // content.js keeps a requestAnimationFrame loop alive; closing the window
    // mid-callback makes jsdom throw, so stop the process instead.
    try { dom.window.close(); } catch { /* raced the rAF loop */ }
    process.exit(process.exitCode || 0);
  })
  .catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
