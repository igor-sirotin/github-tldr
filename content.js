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

// The resting icon is stroked with a gradient, which needs a paint server in
// the document. One hidden <svg> serves every entry on the page; content.css
// supplies the stop colours (and the hover state swaps back to currentColor).
const GRADIENT_ID = 'gh-tldr-icon-gradient';

const PROCESSED = 'data-tldr-ready';
// The cloned wrapper, used for dedupe; and the element GitHub actually hovers
// and fills, which is what content.css styles.
const ENTRY_CLASS = 'gh-tldr-entry';
const MENU_ITEM_CLASS = 'gh-tldr-menu-item';
// Only long comments are worth an up-front cache lookup. The menu entry itself
// is offered whatever the length: it takes no space until the menu is opened,
// and an entry that silently goes missing on short comments just reads as a
// broken extension. This mattered less when it was a button in the header.
const PEEK_MIN_CHARS = 120;

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

function ensureGradient() {
  if (document.getElementById(GRADIENT_ID)) return;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  svg.style.pointerEvents = 'none';

  const defs = document.createElementNS(SVG_NS, 'defs');
  const gradient = document.createElementNS(SVG_NS, 'linearGradient');
  gradient.setAttribute('id', GRADIENT_ID);
  // The icon's own 24-unit viewBox, on the diagonal the wand is drawn along.
  gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
  gradient.setAttribute('x1', '2');
  gradient.setAttribute('y1', '22');
  gradient.setAttribute('x2', '22');
  gradient.setAttribute('y2', '2');

  ['0%', '38%', '70%', '100%'].forEach((offset, i) => {
    const stop = document.createElementNS(SVG_NS, 'stop');
    stop.setAttribute('offset', offset);
    stop.setAttribute('class', `gh-tldr-stop-${i + 1}`);
    gradient.appendChild(stop);
  });

  defs.appendChild(gradient);
  svg.appendChild(defs);
  document.body.appendChild(svg);
}

// The hover fill is a mesh gradient: seven blurred colour blobs behind the
// label, animated independently. They need real elements, so they are built
// here; content.css owns their colours and paths.
function buildMesh() {
  const mesh = document.createElement('span');
  mesh.className = 'gh-tldr-mesh';
  mesh.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 7; i += 1) {
    const blob = document.createElement('span');
    blob.className = 'gh-tldr-blob';
    mesh.appendChild(blob);
  }
  return mesh;
}

function wandIcon() {
  ensureGradient();
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

// Swap the visible label for our own, wrapped in .gh-tldr-label so the design
// has something to paint the gradient onto. Where GitHub already wraps its
// label in an element of its own, that wrapper is reused so its spacing
// survives; otherwise the bare text node is replaced.
function wrapLabel(root, text) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    if (walker.currentNode.nodeValue.trim()) nodes.push(walker.currentNode);
  }

  const label = document.createElement('span');
  label.className = 'gh-tldr-label';
  label.textContent = text;

  if (!nodes.length) {
    root.appendChild(label);
    return label;
  }

  const first = nodes[0];
  const holder = first.parentElement;
  if (holder !== root && holder.childNodes.length === 1) {
    holder.textContent = '';
    holder.appendChild(label);
  } else {
    first.replaceWith(label);
  }
  for (const extra of nodes.slice(1)) extra.nodeValue = '';
  return label;
}

// The only way to look exactly like a GitHub menu item is to be one: clone the
// neighbouring entry whole -- wrapper element, nested icon slot, Primer's
// data-* attributes, the lot -- then swap the label and the glyph. Building a
// <button> and copying a class name is what made it read as a button.
function makeMenuItem(cell) {
  const entry = cell.cloneNode(true);
  entry.classList.add(ENTRY_CLASS);

  const all = [entry, ...entry.querySelectorAll('*')];
  for (const el of all) {
    // Ids must stay unique, and anything pointing at the original's id is now
    // dangling.
    el.removeAttribute('id');
    el.removeAttribute('aria-labelledby');
    el.removeAttribute('aria-describedby');
    // Behavioural hooks belong to Quote reply, not to us.
    el.removeAttribute('data-testid');
    el.removeAttribute('value');
    el.removeAttribute('for');
    if (el.tagName === 'A') el.removeAttribute('href');
    for (const cls of [...el.classList]) {
      if (cls.startsWith('js-')) el.classList.remove(cls);
    }
    el.removeAttribute('disabled');
  }

  // content.css styles the element GitHub itself hovers and fills — the
  // actionable one — not the layout wrapper around it.
  const selector = MENU_ITEM_SELECTORS.join(',');
  const item = entry.matches(selector) ? entry : entry.querySelector(selector) || entry;
  item.classList.add(MENU_ITEM_CLASS);

  // Swap the glyph in place, keeping whatever wrapper and sizing GitHub gave it.
  const icon = item.querySelector('svg');
  if (icon) {
    const wand = wandIcon();
    for (const cls of icon.classList) {
      if (!cls.startsWith('octicon-')) wand.classList.add(cls);
    }
    for (const attr of ['width', 'height', 'aria-hidden', 'focusable', 'data-component']) {
      if (icon.hasAttribute(attr)) wand.setAttribute(attr, icon.getAttribute(attr));
    }
    // If GitHub sized the glyph by neither attribute nor class, the SVG would
    // have no intrinsic size at all.
    if (!wand.hasAttribute('width') && !wand.classList.length) {
      wand.setAttribute('width', '16');
      wand.setAttribute('height', '16');
    }
    icon.replaceWith(wand);
  }

  wrapLabel(item, 'TLDR');

  // Behind the label and icon, which content.css lifts above it with z-index.
  item.insertBefore(buildMesh(), item.firstChild);

  return entry;
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

// One panel per comment, created on first need and reused after that.
function panelFor(body) {
  const existing = panels.get(body);
  if (existing) return existing;

  const panel = makePanel();
  body.parentElement.insertBefore(panel, body);
  panels.set(body, panel);
  return panel;
}

function attach(body) {
  if (body.hasAttribute(PROCESSED)) return;
  body.setAttribute(PROCESSED, '1');

  if (textOf(body).length < PEEK_MIN_CHARS) return;

  const panel = panelFor(body);

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
  if (next && next.classList.contains(ENTRY_CLASS)) return; // already there

  const body = commentForMenu(quote);
  if (!body) return;

  attach(body); // a lazily rendered comment may not have been peeked yet

  const item = makeMenuItem(cell);
  item.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeMenu(item);
    // Built here rather than up front, so a comment nobody summarizes costs
    // no DOM at all.
    const panel = panelFor(body);
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
      if (candidate.closest('.' + ENTRY_CLASS)) continue;
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
