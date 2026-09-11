// GitHub TLDR - injects a "TLDR" button next to every GitHub comment.

const BODY_SELECTORS = [
  '.js-comment-body',
  '.comment-body',
  '[data-testid="comment-body"]',
  '[data-testid="markdown-body"]',
];

// Action bars, where the button is prepended ahead of the existing controls.
const ACTION_SELECTORS = [
  '.timeline-comment-actions',
  '[data-testid="comment-header-right-side-items"]',
  '.js-comment-header-actions',
];

// The cluster holding the Member/Collaborator badge and the kebab menu. The
// button goes at the visually-left end of it, ahead of the badge.
//   classic + PRs: the flex-row-reverse row that wraps .timeline-comment-actions
//   React issues:  IssueBodyHeader's badgesSection (badgeGroup, then actions)
const BADGE_ROW_SELECTORS = [
  '[class*="IssueBodyHeader-module__badgesSection"]',
];

// The React issue view ships no action bar at all — its header is a plain flex
// row — so fall back to appending at the end of that header. These are CSS
// module class names whose trailing hash changes on every GitHub deploy
// (…__activityHeader__ZGlyB), hence the prefix match on the stable part.
const HEADER_SELECTORS = [
  '[class*="ActivityHeader-module__activityHeader"]',
  '[class*="IssueBodyHeader-module__IssueBodyHeaderContainer"]',
];

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

// "Left" is not the same as "first child": GitHub lays the classic header row
// out with flex-row-reverse, so DOM order there runs right to left. Ask the
// browser which way the row actually flows rather than assuming.
function insertLeftmost(row, btn) {
  const direction = (getComputedStyle(row).flexDirection || 'row');
  if (direction.includes('reverse')) row.appendChild(btn);
  else row.insertBefore(btn, row.firstChild);
}

function makeButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'gh-tldr-btn';
  btn.title = 'Summarize this comment with AI';
  btn.appendChild(wandIcon());
  const label = document.createElement('span');
  label.className = 'gh-tldr-label';
  label.textContent = 'TLDR';
  btn.appendChild(label);
  return btn;
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

async function summarize(btn, panel, body) {
  const text = textOf(body);
  if (!text) {
    setState(panel, 'gh-tldr-error', 'Nothing to summarize.');
    return;
  }

  btn.disabled = true;
  btn.classList.add('is-loading');
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
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }
}

function attach(body) {
  if (body.hasAttribute(PROCESSED)) return;
  body.setAttribute(PROCESSED, '1');

  if (textOf(body).length < MIN_CHARS) return;

  const container = commentContainerOf(body);
  if (!container) return;

  const btn = makeButton();
  const panel = makePanel();

  let placed = false;

  // Preferred: immediately left of the Member/Collaborator badge.
  for (const sel of BADGE_ROW_SELECTORS) {
    const row = container.querySelector(sel);
    if (row) {
      insertLeftmost(row, btn);
      placed = true;
      break;
    }
  }

  // Classic and PR headers have no badge wrapper of their own; the badge sits
  // beside .timeline-comment-actions in the row above it.
  if (!placed) {
    const actions = container.querySelector('.timeline-comment-actions');
    if (actions && actions.parentElement) {
      insertLeftmost(actions.parentElement, btn);
      placed = true;
    }
  }

  if (!placed) for (const sel of ACTION_SELECTORS) {
    const actions = container.querySelector(sel);
    if (actions) {
      actions.insertBefore(btn, actions.firstChild);
      placed = true;
      break;
    }
  }

  if (!placed) {
    for (const sel of HEADER_SELECTORS) {
      const header = container.querySelector(sel);
      if (header) {
        btn.classList.add('gh-tldr-btn--header');
        header.appendChild(btn);
        placed = true;
        break;
      }
    }
  }

  // Last resort: its own row above the body.
  if (!placed) {
    const bar = document.createElement('div');
    bar.className = 'gh-tldr-bar';
    bar.appendChild(btn);
    body.parentElement.insertBefore(bar, body);
  }

  body.parentElement.insertBefore(panel, body);

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

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Once a summary exists, the button just toggles it.
    if (panel.dataset.loaded === '1') {
      panel.hidden = !panel.hidden;
      return;
    }
    summarize(btn, panel, body);
  });
}

function scan() {
  for (const sel of BODY_SELECTORS) {
    for (const body of document.querySelectorAll(sel)) attach(body);
  }
}

let pending = null;
const observer = new MutationObserver(() => {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    scan();
  }, 300);
});

scan();
observer.observe(document.body, { childList: true, subtree: true });
