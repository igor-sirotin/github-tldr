const { JSDOM } = require('jsdom');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = path.join(__dirname, '..', 'content.js');
const long = 'This is a long GitHub comment that definitely deserves a summary. '.repeat(4);

// A classic comment carries its ... menu inline, inside the comment itself.
const classicMenu = (id) => `
  <details class="details-overlay" id="${id}-details">
    <summary class="timeline-comment-action" id="${id}-kebab">…</summary>
    <details-menu class="dropdown-menu">
      <span data-view-component="true"><button class="dropdown-item btn-link" role="menuitem">Copy link</button></span>
      <span data-view-component="true"><button class="dropdown-item btn-link" role="menuitem">Copy Markdown</button></span>
      <span data-view-component="true"><button class="dropdown-item btn-link js-comment-quote-reply" role="menuitem">Quote reply</button></span>
      <div class="dropdown-divider" role="none"></div>
      <span data-view-component="true"><button class="dropdown-item btn-link" role="menuitem">Edit</button></span>
      <span data-view-component="true"><button class="dropdown-item btn-link" role="menuitem">Delete</button></span>
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
    <div class="comment-body js-comment-body">too short</div>
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

  <!-- React issue description: the menu is portalled out of the comment. -->
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
const entryIn = (root) => root.querySelector('.gh-tldr-menu-item');
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

assert(entryIn(menuA).className.includes('dropdown-item'), "entry borrows the neighbouring item's classes");
assert(entryIn(menuA).getAttribute('role') === 'menuitem', 'entry is exposed as a menu item');
assert(!entryIn(menuA).querySelector('svg'), 'no icon, because the classic menu items have none');
assert(doc.querySelectorAll('.gh-tldr-btn').length === 0, 'no injected button remains anywhere');

// One entry per comment, including inside a review thread.
assert(entryIn(doc.querySelector('#b-details details-menu')), 'second comment gets its own entry');
for (const n of [1, 2]) {
  const reply = doc.getElementById('discussion_r' + n);
  assert(reply.querySelectorAll('.gh-tldr-menu-item').length === 1, `thread reply ${n} has exactly one entry`);
}
assert(!doc.querySelector('#comment-short .gh-tldr-menu-item'), 'short comment gets no entry');

(async () => {
  // Reopening a menu must not stack a second entry into it.
  doc.getElementById('a-kebab').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  assert(menuA.querySelectorAll('.gh-tldr-menu-item').length === 1, 'reopening the menu does not duplicate the entry');

  // --- clicking the entry summarizes the right comment ---
  const bodyA = doc.querySelector('#comment-a .js-comment-body');
  const panelA = doc.querySelector('#comment-a .gh-tldr-panel');
  assert(panelA && panelA.hidden === true, 'a hidden panel is prepared for each comment');

  entryIn(menuA).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));

  const tldrs = sent.filter((m) => m.type === 'tldr');
  assert(tldrs.length === 1, 'one summary requested');
  assert(tldrs[0].text.includes('deserves a summary'), "the clicked comment's text is what gets sent");
  assert(panelA.hidden === false && panelA.querySelectorAll('.gh-tldr-list li').length === 2, 'summary renders in that comment\'s panel');
  assert(doc.getElementById('a-details').open === false, 'the menu closes after choosing TLDR');

  // Choosing it again toggles, without paying for a second summary.
  entryIn(menuA).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  assert(panelA.hidden === true && sent.filter((m) => m.type === 'tldr').length === 1, 'choosing it again hides the panel, no second request');

  // --- portalled menu: resolved through the trigger that opened it ---
  const issueBody = doc.querySelector('[data-testid="markdown-body"]');
  const portal = doc.createElement('div');
  portal.innerHTML = `<div role="menu" id="portal-menu">
    <button role="menuitem" class="prc-ActionList-ActionListContent">Copy link</button>
    <button role="menuitem" class="prc-ActionList-ActionListContent js-comment-quote-reply"><svg></svg>Quote reply</button>
  </div>`;
  doc.getElementById('issue-kebab').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  doc.body.appendChild(portal); // Primer renders the menu at the end of the document
  await new Promise((r) => setTimeout(r, 300));

  const portalEntry = portal.querySelector('.gh-tldr-menu-item');
  assert(portalEntry, 'portalled menu gets an entry too');
  assert(portalEntry.previousElementSibling === portal.querySelector('.js-comment-quote-reply'), 'entry follows Quote reply in the portalled menu');
  assert(portalEntry.querySelector('svg.gh-tldr-wand'), 'icon is included, because this menu uses icons');

  portalEntry.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
  const last = sent.filter((m) => m.type === 'tldr').pop();
  assert(last.text.includes('The issue description'), 'portalled entry summarizes the comment whose kebab was clicked');
  assert(doc.querySelector('[data-testid="issue-body-viewer"] .gh-tldr-panel').hidden === false, 'issue panel opens');

  // --- errors and cached summaries still work ---
  tldrReply = { error: 'No OpenAI API key set.' };
  const menuB = doc.querySelector('#b-details details-menu');
  entryIn(menuB).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
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
