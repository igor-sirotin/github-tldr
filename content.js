// GitHub TLDR - adds a "TLDR" entry to the ... menu on every GitHub comment.

const BODY_SELECTORS = [
  '.js-comment-body',
  '.comment-body',
  '[data-testid="comment-body"]',
  '[data-testid="markdown-body"]',
];

// How the "Quote reply" entry is recognised in a comment's ... menu. The JS
// hook is checked first; the label is the fallback, and the only part that a
// non-English UI would miss.
const QUOTE_SELECTORS = [
  '.js-comment-quote-reply',
  '[data-testid="quote-reply"]',
  '[data-testid="comment-quote-reply"]',
];
const QUOTE_LABEL = /^quote reply$/i;

// Anything that behaves like a menu entry, in either the classic details-menu
// or Primer's ActionList.
const MENU_ITEM_SELECTORS = ['[role="menuitem"]', '.dropdown-item'];

// Containers we must not climb out of when looking for the entry's outer cell.
const MENU_SELECTORS = ['details-menu', '[role="menu"]', '.dropdown-menu', 'action-menu'];

// Lucide "wand-sparkles" (https://lucide.dev/icons/wand-sparkles), ISC licensed.
// Built as nodes rather than an innerHTML string; sized by .gh-tldr-wand in CSS.
const WAND_PATHS = [
  'm21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z',
  'm14 7 3 3',
  'M5 6v4',
  'M19 14v4',
  'M10 2v2',
  'M7 8H3',
  'M21 16h-4',
  'M11 3H9',
];

const SVG_NS = 'http://www.w3.org/2000/svg';

const PROCESSED = 'data-tldr-ready';
const MENU_ITEM_CLASS = 'gh-tldr-menu-item';
const MIN_CHARS = 120; // shorter comments don't need a TLDR

// innerText gives the rendered text (collapsed details, hidden nodes dropped);
// textContent is the fallback where innerText isn't implemented.
function textOf(el) {
  return (el.innerText ?? el.textContent ?? '').trim();
}

// Every distinct comment body inside `root`, counting one comment once even
// though several selectors can match the same element, and ignoring bodies
// nested inside another matched body.
function commentBodiesIn(root) {
  const found = [];
  for (const sel of BODY_SELECTORS) {
    for (const el of root.querySelectorAll(sel)) if (!found.includes(el)) found.push(el);
  }
  return found.filter((el) => !found.some((other) => other !== el && other.contains(el)));
}

// The widest ancestor that still holds this comment and no other. Climbing
// stops the moment an ancestor also contains a sibling comment.
function ownContainerOf(body) {
  let el = body.parentElement;
  let best = el;
  while (el && el !== document.body) {
    if (commentBodiesIn(el).length > 1) break;
    best = el;
    el = el.parentElement;
  }
  return best;
}

function commentContainerOf(body) {
  const known =
    body.closest('.js-comment') ||
    body.closest('.review-comment') ||
    body.closest('.js-comment-container') ||
    body.closest('.timeline-comment') ||
    body.closest('[data-testid="comment-viewer-outer-box"]') ||
    body.closest('.react-issue-comment') ||
    body.closest('[data-testid="issue-body"]') ||
    body.closest('.react-issue-body');

  // A pull request review thread nests all of its comments inside a single
  // .js-comment-container, so that container is too broad: querySelector would
  // hand every comment in the thread the first comment's header, and all the
  // buttons would pile up there. Only trust a known container if it holds this
  // comment alone; otherwise fall back to the nearest ancestor that does.
  if (known && commentBodiesIn(known).length <= 1) return known;
  return ownContainerOf(body) || body.parentElement;
}

function wandIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('gh-tldr-wand');
  for (const d of WAND_PATHS) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

function isQuoteReply(el) {
  if (QUOTE_SELECTORS.some((sel) => el.matches(sel))) return true;
  return QUOTE_LABEL.test(textOf(el));
}

// Borrow the neighbouring entry's classes so the new one inherits whatever
// GitHub styles menu items with today, in either menu implementation.
function makeMenuItem(reference) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = `${reference.className} ${MENU_ITEM_CLASS}`.trim();
  item.setAttribute('role', reference.getAttribute('role') || 'menuitem');
  item.title = 'Summarize this comment with AI';

  // Only carry an icon if the menu it is joining uses them.
  if (reference.querySelector('svg')) item.appendChild(wandIcon());

  const label = document.createElement('span');
  label.className = 'gh-tldr-label';
  label.textContent = 'TLDR';
  item.appendChild(label);
  return item;
}

// The entry may be wrapped in a layout span; insert after the outermost
// wrapper that still sits inside the menu, so we land beside it rather than
// inside its box.
function outerCell(item) {
  let cell = item;
  while (
    cell.parentElement &&
    cell.parentElement !== document.body &&
    cell.parentElement.children.length === 1 &&
    !MENU_SELECTORS.some((sel) => cell.parentElement.matches(sel))
  ) {
    cell = cell.parentElement;
  }
  return cell;
}

function closeMenu(el) {
  const details = el.closest('details');
  if (details) {
    details.open = false;
    return;
  }
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

function makePanel() {
  const panel = document.createElement('div');
  panel.className = 'gh-tldr-panel';
  panel.hidden = true;
  return panel;
}

function renderSummary(panel, text, { cached = false } = {}) {
  panel.textContent = '';
  const title = document.createElement('div');
  title.className = 'gh-tldr-title';
  // Say where it came from, so a summary that appears unprompted is explained.
  title.textContent = cached ? 'TLDR · cached' : 'TLDR';
  panel.appendChild(title);

  const list = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const looksLikeList = list.length > 1 && list.every((l) => /^([-*•]|\d+[.)])\s+/.test(l));
  if (looksLikeList) {
    const ul = document.createElement('ul');
    ul.className = 'gh-tldr-list';
    for (const item of list) {
      const li = document.createElement('li');
      li.textContent = item.replace(/^([-*•]|\d+[.)])\s+/, '');
      ul.appendChild(li);
    }
    panel.appendChild(ul);
  } else {
    const p = document.createElement('div');
    p.className = 'gh-tldr-text';
    p.textContent = list.join('\n');
    panel.appendChild(p);
  }
}

function setState(panel, cls, text) {
  panel.hidden = false;
  panel.className = `gh-tldr-panel ${cls}`;
  panel.textContent = text;
}

async function summarize(panel, body) {
  const text = textOf(body);
  if (!text) {
    setState(panel, 'gh-tldr-error', 'Nothing to summarize.');
    return;
  }

  setState(panel, 'gh-tldr-loading', 'Summarizing…');

  try {
    const res = await chrome.runtime.sendMessage({ type: 'tldr', text });
    if (!res) throw new Error('No response from extension background.');
    if (res.error) throw new Error(res.error);
    panel.hidden = false;
    panel.className = 'gh-tldr-panel';
    renderSummary(panel, res.summary);
    panel.dataset.loaded = '1';
  } catch (err) {
    setState(panel, 'gh-tldr-error', `TLDR failed: ${err.message}`);
  }
}

// Panels are created up front, one per comment, and remembered so a menu entry
// can find the one it belongs to.
const panels = new WeakMap();

function attach(body) {
  if (body.hasAttribute(PROCESSED)) return;
  body.setAttribute(PROCESSED, '1');

  if (textOf(body).length < MIN_CHARS) return;

  const panel = makePanel();
  body.parentElement.insertBefore(panel, body);
  panels.set(body, panel);

  // If this exact comment text was summarized before, show it straight away.
  // A miss (including an edited comment, whose text now hashes differently)
  // leaves the panel closed and costs nothing.
  chrome.runtime
    .sendMessage({ type: 'peek', text: textOf(body) })
    .then((res) => {
      if (!res || !res.summary || panel.dataset.loaded === '1') return;
      panel.hidden = false;
      panel.className = 'gh-tldr-panel';
      renderSummary(panel, res.summary, { cached: true });
      panel.dataset.loaded = '1';
    })
    .catch(() => {}); // no background worker (or no cache) is not an error
}

// The comment a menu belongs to. Classic menus sit inside the comment, so
// climbing finds it; Primer portals its menus to the end of the document, so
// there we climb from whatever was clicked to open it instead.
let lastAnchor = null;

function ownCommentOf(el) {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const bodies = commentBodiesIn(node);
    if (bodies.length === 1) return bodies[0];
    if (bodies.length > 1) return null; // a thread: ambiguous, give up
    node = node.parentElement;
  }
  return null;
}

function commentForMenu(item) {
  return (
    ownCommentOf(item) ||
    (lastAnchor && lastAnchor.isConnected ? ownCommentOf(lastAnchor) : null)
  );
}

function addMenuEntry(quote) {
  const cell = outerCell(quote);
  const next = cell.nextElementSibling;
  if (next && next.classList.contains(MENU_ITEM_CLASS)) return; // already there

  const body = commentForMenu(quote);
  if (!body) return;

  attach(body); // a lazily rendered comment may not have been scanned yet
  const panel = panels.get(body);
  if (!panel) return;

  const item = makeMenuItem(quote);
  item.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeMenu(item);
    if (panel.dataset.loaded === '1') {
      panel.hidden = !panel.hidden;
      return;
    }
    summarize(panel, body);
  });

  cell.insertAdjacentElement('afterend', item);
}

// Menus are cheap to re-check and are re-rendered on every open, so this runs
// on mutations and right after any click.
function scanMenus() {
  for (const sel of MENU_ITEM_SELECTORS) {
    for (const candidate of document.querySelectorAll(sel)) {
      if (candidate.classList.contains(MENU_ITEM_CLASS)) continue;
      if (isQuoteReply(candidate)) addMenuEntry(candidate);
    }
  }
}

function scan() {
  for (const sel of BODY_SELECTORS) {
    for (const body of document.querySelectorAll(sel)) attach(body);
  }
  scanMenus();
}

let pending = null;
const observer = new MutationObserver(() => {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    scan();
  }, 300);
});

// A portalled menu appears only once its trigger is clicked, and waiting for
// the mutation debounce would show the menu before our entry. Re-check on the
// next frames instead; the observer stays as the backstop.
document.addEventListener(
  'click',
  (e) => {
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    lastAnchor = el.closest('summary, button, [role="button"]') || el;
    for (const delay of [0, 60, 200]) setTimeout(scanMenus, delay);
  },
  true
);

scan();
observer.observe(document.body, { childList: true, subtree: true });
