const { JSDOM } = require('jsdom');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = path.join(__dirname, '..', 'content.js');
const long = 'This is a long GitHub comment that definitely deserves a summary. '.repeat(4);

// A classic comment carries its ... menu inline, inside the comment itself.
// Items are wrapped in a layout span and carry an octicon, the way GitHub
// builds them — the entry has to reproduce that, not just the class name.
const menuItem = (label, extraClass = '', icon = 'octicon-link') => `
      <span data-view-component="true">
        <button class="dropdown-item btn-link ${extraClass}" role="menuitem" data-view-component="true">
          <svg class="octicon ${icon}" width="16" height="16" aria-hidden="true" data-component="Octicon"><path d="M0 0"/></svg>
          ${label}
        </button>
      </span>`;

// Primer's ActionList, with the hashed CSS-module names real GitHub ships —
// not the plain .ActionList-content of the design's own preview. The hook sits
// on the inner content button while role="menuitem" sits on the li.
const actionListItem = (label, extraClass = '') => `
      <li role="menuitem" class="prc-ActionList-ActionListItem-uq6I7">
        <button type="button" class="prc-ActionList-ActionListContent-sg9-x ${extraClass}">
          <span class="prc-ActionList-Visual-49ccF prc-ActionList-VisualWrap-rfjV5">
            <svg class="octicon octicon-quote" width="16" height="16" aria-hidden="true"><path d="M0 0"/></svg>
          </span>
          <span class="prc-ActionList-ItemLabel-TSrdx">${label}</span>
        </button>
      </li>`;

const classicMenu = (id) => `
  <details class="details-overlay" id="${id}-details">
    <summary class="timeline-comment-action" id="${id}-kebab">…</summary>
    <details-menu class="dropdown-menu">
      ${menuItem('Copy link')}
      ${menuItem('Copy Markdown')}
      ${menuItem('Quote reply', 'js-comment-quote-reply', 'octicon-quote')}
      <div class="dropdown-divider" role="none"></div>
      ${menuItem('Edit', '', 'octicon-pencil')}
      ${menuItem('Delete', '', 'octicon-trash')}
    </details-menu>
  </details>`;

const dom = new JSDOM(`<!doctype html><body>
  <div class="js-comment-container" id="comment-a">
    <div class="timeline-comment-header">${classicMenu('a')}</div>
    <div class="comment-body js-comment-body">${long}</div>
  </div>

  <div class="js-comment-container" id="comment-b">
    <div class="timeline-comment-header">${classicMenu('b')}</div>
    <div class="comment-body js-comment-body">${long} Second top-level comment.</div>
  </div>

  <div class="js-comment-container" id="comment-short">
    <div class="timeline-comment-header">${classicMenu('short')}</div>
    <div class="comment-body js-comment-body">LGTM</div>
  </div>

  <!-- A PR review thread: three comments sharing one .js-comment-container. -->
  <review-thread-collapsible class="js-comment-container">
    <div class="js-inline-comments-container">
      <div class="js-comment review-comment" id="discussion_r1">
        ${classicMenu('r1')}
        <div class="comment-body js-comment-body">${long} First reply in the thread.</div>
      </div>
      <div class="js-comment review-comment" id="discussion_r2">
        ${classicMenu('r2')}
        <div class="comment-body js-comment-body">${long} Second reply in the thread.</div>
      </div>
    </div>
  </review-thread-collapsible>

  <!-- React issue description: Primer ActionList, portalled out of the comment. -->
  <div data-testid="issue-body" class="react-issue-body">
    <div class="ActivityHeader-module__activityHeader__xxxx">
      <button id="issue-kebab" aria-haspopup="true">…</button>
    </div>
    <div data-testid="issue-body-viewer">
      <div data-testid="markdown-body" class="markdown-body">${long} The issue description.</div>
    </div>
  </div>
</body>`, { pretendToBeVisual: true, runScripts: 'outside-only' });

const sent = [];
let peekReply = {};
let tldrReply = { summary: '- first point\n- second point' };
const chrome = {
  runtime: {
    sendMessage: (msg) => {
      sent.push(msg);
      return Promise.resolve(msg.type === 'peek' ? peekReply : tldrReply);
    },
  },
};

const ctx = dom.getInternalVMContext();
ctx.chrome = chrome;
vm.runInContext(fs.readFileSync(SRC, 'utf8'), ctx);

const doc = dom.window.document;
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok -', m); };
const entryIn = (root) => root.querySelector('.gh-tldr-entry');
const actionable = (entry) => entry.querySelector('.gh-tldr-menu-item') || entry;
const labelsIn = (menu) => [...menu.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent.trim());

// --- the menu entry, classic inline menus ---
const menuA = doc.querySelector('#a-details details-menu');
assert(entryIn(menuA), 'a TLDR entry is added to the comment menu');
assert(labelsIn(menuA).join(' | ') === 'Copy link | Copy Markdown | Quote reply | TLDR | Edit | Delete',
  `entry sits directly under Quote reply (got ${labelsIn(menuA).join(' | ')})`);

const quoteCell = menuA.querySelector('.js-comment-quote-reply').parentElement;
assert(quoteCell.nextElementSibling === entryIn(menuA), 'entry is a sibling of the Quote reply cell, not nested inside it');
assert(entryIn(menuA).previousElementSibling === quoteCell, 'nothing was inserted between Quote reply and the entry');

const divider = menuA.querySelector('.dropdown-divider');
assert(entryIn(menuA).compareDocumentPosition(divider) & 4, 'entry stays in the first section, above the divider');

// It must *be* a GitHub menu item, not a button wearing its class name.
const quoteCellA = menuA.querySelector('.js-comment-quote-reply').parentElement;
const entryA = entryIn(menuA);
assert(entryA.tagName === quoteCellA.tagName, `entry has the same wrapper element as a real item (${entryA.tagName} vs ${quoteCellA.tagName})`);
assert(actionable(entryA).tagName === 'BUTTON' && actionable(entryA).className.includes('dropdown-item btn-link'),
  'the actionable element keeps the real item classes, including the button reset');
assert(actionable(entryA).getAttribute('data-view-component') === 'true', "Primer's styling attributes survive the clone");
assert(actionable(entryA).getAttribute('role') === 'menuitem', 'entry is exposed as a menu item');
assert(entryA.textContent.trim() === 'TLDR', `label reads TLDR and nothing else (got ${JSON.stringify(entryA.textContent.trim())})`);
assert(!entryA.textContent.includes('Quote'), 'the cloned label is gone');

// --- the design: gradient label, gradient icon, mesh hover fill ---
assert(actionable(entryA).classList.contains('gh-tldr-menu-item'),
  'the styled class lands on the element GitHub hovers, not the layout wrapper');
assert(actionable(entryA).dataset.tldrMenu === 'dropdown',
  `the legacy menu is tagged as the dropdown variant (got ${actionable(entryA).dataset.tldrMenu})`);
const labelEl = entryA.querySelector('.gh-tldr-label');
assert(labelEl && labelEl.textContent === 'TLDR', 'label is wrapped so the gradient has something to paint');

const mesh = actionable(entryA).querySelector('.gh-tldr-mesh');
assert(mesh, 'hover mesh is built into the entry');
assert(mesh.querySelectorAll('.gh-tldr-blob').length === 7, 'mesh has the seven blobs the design animates');
assert(mesh.getAttribute('aria-hidden') === 'true', 'mesh is decorative');
assert(actionable(entryA).firstElementChild === mesh, 'mesh sits behind the icon and label');

const paint = doc.getElementById('gh-tldr-icon-gradient');
assert(paint, 'a gradient paint server is injected for the icon stroke');
assert(paint.tagName.toLowerCase() === 'lineargradient', 'paint server is a linearGradient');
const stops = paint.querySelectorAll('stop');
assert(stops.length === 4, `gradient has four stops (got ${stops.length})`);
assert([...stops].every((st, i) => st.getAttribute('class') === `gh-tldr-stop-${i + 1}`),
  'stops carry the classes content.css colours them with');
assert(doc.querySelectorAll('#gh-tldr-icon-gradient').length === 1, 'only one paint server for the whole page');

// Icon: same slot, same sizing, wand glyph.
const wand = entryA.querySelector('svg');
assert(wand && wand.classList.contains('gh-tldr-wand'), 'entry carries the wand glyph');
assert(wand.classList.contains('octicon'), "it keeps GitHub's octicon class so it is sized and spaced natively");
assert(wand.closest('.gh-tldr-menu-item'), 'wand is inside the styled item, so the gradient stroke rule matches');
assert(wand.parentElement === actionable(entryA),
  'classic menu: the wand is a direct child, so it does get the 8px gap');
const classicLabel = entryA.querySelector('.gh-tldr-label');
assert(classicLabel.tagName === 'SPAN' && classicLabel.parentElement === actionable(entryA),
  'classic menu: a bare text label is replaced by our own span, at the same level');
assert(!wand.classList.contains('octicon-quote'), "but not the original glyph's specific class");
assert(wand.getAttribute('width') === '16' && wand.getAttribute('height') === '16', 'icon keeps the real item dimensions');
assert(wand.querySelectorAll('path').length === 8, 'and is the full lucide wand, not the cloned path');

// Nothing that belonged to Quote reply may come along.
assert(!entryA.querySelector('.js-comment-quote-reply') && !entryA.classList.contains('js-comment-quote-reply'),
  'no js- behaviour hooks are cloned');
assert(!entryA.querySelector('[id]') && !entryA.hasAttribute('id'), 'no duplicated ids');
assert(doc.querySelectorAll('.gh-tldr-btn').length === 0, 'no injected button remains anywhere');

// One entry per comment, including inside a review thread.
assert(entryIn(doc.querySelector('#b-details details-menu')), 'second comment gets its own entry');
for (const n of [1, 2]) {
  const reply = doc.getElementById('discussion_r' + n);
  assert(reply.querySelectorAll('.gh-tldr-entry').length === 1, `thread reply ${n} has exactly one entry`);
}
// A short comment still gets the entry: it costs no space until the menu is
// opened, and going missing reads as the extension being broken. Only the
// up-front cache lookup is skipped for it.
const shortEntry = doc.querySelector('#comment-short .gh-tldr-entry');
assert(shortEntry, 'a short comment is still offered the entry');
assert(!doc.querySelector('#comment-short .gh-tldr-panel'), 'but no panel is built until it is actually used');
assert(sent.filter((m) => m.type === 'peek').length === 5,
  `the cache is peeked only for the five long comments, not the short one (got ${sent.filter((m) => m.type === 'peek').length})`);

(async () => {
  // Reopening a menu must not stack a second entry into it.
  doc.getElementById('a-kebab').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  assert(menuA.querySelectorAll('.gh-tldr-entry').length === 1, 'reopening the menu does not duplicate the entry');

  // --- clicking the entry summarizes the right comment ---
  const bodyA = doc.querySelector('#comment-a .js-comment-body');
  const panelA = doc.querySelector('#comment-a .gh-tldr-panel');
  assert(panelA && panelA.hidden === true, 'a hidden panel is prepared for each comment');

  actionable(entryIn(menuA)).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));

  const tldrs = sent.filter((m) => m.type === 'tldr');
  assert(tldrs.length === 1, 'one summary requested');
  assert(tldrs[0].text.includes('deserves a summary'), "the clicked comment's text is what gets sent");
  assert(panelA.hidden === false && panelA.querySelectorAll('.gh-tldr-list li').length === 2, 'summary renders in that comment\'s panel');
  assert(doc.getElementById('a-details').open === false, 'the menu closes after choosing TLDR');

  // Choosing it again toggles, without paying for a second summary.
  actionable(entryIn(menuA)).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  assert(panelA.hidden === true && sent.filter((m) => m.type === 'tldr').length === 1, 'choosing it again hides the panel, no second request');

  // Choosing TLDR on a short comment builds its panel on demand.
  const shortBefore = sent.filter((m) => m.type === 'tldr').length;
  actionable(doc.querySelector('#comment-short .gh-tldr-entry')).dispatchEvent(
    new dom.window.MouseEvent('click', { bubbles: true })
  );
  await new Promise((r) => setTimeout(r, 30));
  const shortPanel = doc.querySelector('#comment-short .gh-tldr-panel');
  assert(shortPanel, 'the panel is created when the short comment is actually summarized');
  assert(sent.filter((m) => m.type === 'tldr').length === shortBefore + 1, 'and the summary is requested');

  // --- portalled menu: resolved through the trigger that opened it ---
  const issueBody = doc.querySelector('[data-testid="markdown-body"]');
  const portal = doc.createElement('div');
  portal.innerHTML = `<ul role="menu" id="portal-menu">
    ${actionListItem('Copy link')}
    ${actionListItem('Quote reply', 'js-comment-quote-reply')}
  </ul>`;
  doc.getElementById('issue-kebab').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  doc.body.appendChild(portal); // Primer renders the menu at the end of the document
  await new Promise((r) => setTimeout(r, 300));

  const portalEntry = portal.querySelector('.gh-tldr-entry');
  assert(portalEntry, 'portalled menu gets an entry too — the hook is on a descendant, not the menuitem itself');
  const quoteRow = portal.querySelector('.js-comment-quote-reply').closest('[role="menuitem"]');
  assert(portalEntry.previousElementSibling === quoteRow, 'entry follows the Quote reply row in the portalled menu');
  assert(portalEntry.querySelector('svg.gh-tldr-wand'), 'icon is included, because this menu uses icons');

  // ActionList paints its hover on the content element inside the li, so that
  // is where the styling class and the variant tag must land.
  const portalItem = portalEntry.querySelector('.gh-tldr-menu-item');
  assert(portalItem, 'ActionList entry has a styled element');
  assert(portalItem !== portalEntry, 'which is the content element, not the cloned li');
  assert(portalItem.className.includes('prc-ActionList-ActionListContent'),
    'the styled element is the ActionList content element, matched by its hashed module name');
  assert(portalItem.dataset.tldrMenu === 'actionlist',
    `ActionList is tagged as such, so content.css can shape it (got ${portalItem.dataset.tldrMenu})`);
  assert(portalEntry.tagName === 'LI' && portalEntry.classList.contains('gh-tldr-entry'),
    'the li carries only the entry class, so it adds no second hover box');
  assert(!portalEntry.classList.contains('gh-tldr-menu-item'), 'and is not itself styled as the item');

  const portalWand = portalEntry.querySelector('svg.gh-tldr-wand');
  assert(portalWand.closest('[class*="prc-ActionList-Visual"]'), 'wand stays in the visual slot');

  const portalLabel = portalEntry.querySelector('.gh-tldr-label');
  assert(portalLabel.className.includes('prc-ActionList-ItemLabel'),
    "the label is GitHub's own label element, re-used rather than wrapped in another span");
  assert(portalLabel.children.length === 0 && portalLabel.textContent === 'TLDR',
    'no extra element is nested inside the label');

  actionable(portalEntry).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
  const last = sent.filter((m) => m.type === 'tldr').pop();
  assert(last.text.includes('The issue description'), 'portalled entry summarizes the comment whose kebab was clicked');
  assert(doc.querySelector('[data-testid="issue-body-viewer"] .gh-tldr-panel').hidden === false, 'issue panel opens');

  // --- errors and cached summaries still work ---
  tldrReply = { error: 'No OpenAI API key set.' };
  const menuB = doc.querySelector('#b-details details-menu');
  actionable(entryIn(menuB)).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
  const panelB = doc.querySelector('#comment-b .gh-tldr-panel');
  assert(panelB.className.includes('gh-tldr-error') && panelB.textContent.includes('No OpenAI API key'), 'errors surface in the panel');

  peekReply = { summary: '- cached one\n- cached two', cached: true };
  const fresh = doc.createElement('div');
  fresh.className = 'js-comment-container';
  fresh.innerHTML = `<div class="comment-body js-comment-body">${long} A previously summarized comment.</div>`;
  doc.body.appendChild(fresh);
  await new Promise((r) => setTimeout(r, 500));
  const cachedPanel = fresh.querySelector('.gh-tldr-panel');
  assert(cachedPanel && cachedPanel.hidden === false, 'a cached summary still opens with no interaction at all');
  assert(cachedPanel.querySelector('.gh-tldr-title').textContent === 'TLDR · cached', 'and is labelled as cached');
})();
