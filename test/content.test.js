const { JSDOM } = require('jsdom');
const fs = require('fs');
const vm = require('vm');

const SRC = require('path').join(__dirname, '..', 'content.js');
const long = 'This is a long GitHub comment that definitely deserves a summary. '.repeat(4);

// The issue-description markup mirrors what github.com actually serves for the
// React issue view (data-testid and CSS-module class names taken from a fetched
// issue page). The class hash is deliberately a different one from the live
// page, to prove we match the module prefix and not the build hash.
const dom = new JSDOM(`<!doctype html><body>
  <div class="js-comment-container">
    <div class="timeline-comment-header">
      <div class="d-flex flex-row-reverse flex-items-center" id="classic-row" style="display:flex;flex-direction:row-reverse">
        <div class="timeline-comment-actions"><button>…</button></div>
        <div class="d-none d-sm-flex"><span class="tooltipped"><span class="Label ml-1 tmp-ml-1">Member</span></span></div>
      </div>
    </div>
    <div class="comment-body js-comment-body">${long}</div>
  </div>
  <div data-testid="comment-viewer-outer-box">
    <div data-testid="comment-body">${long}</div>
  </div>
  <div class="js-comment-container">
    <div class="comment-body js-comment-body">too short</div>
  </div>
  <!-- A PR review thread, as github.com serves it: three comments sharing one
       .js-comment-container, each with its own header and reversed action row. -->
  <review-thread-collapsible class="js-comment-container js-resolvable-timeline-thread-container">
    <div class="js-inline-comments-container">
      <div class="js-comment review-comment" id="discussion_r1">
        <div class="flex-row-reverse" id="thread-row-1" style="display:flex;flex-direction:row-reverse">
          <div class="timeline-comment-actions"><button>…</button></div>
          <span class="Label">Member</span>
        </div>
        <div class="comment-body js-comment-body">${long} First reply in the thread.</div>
      </div>
      <div class="js-comment review-comment" id="discussion_r2">
        <div class="flex-row-reverse" id="thread-row-2" style="display:flex;flex-direction:row-reverse">
          <div class="timeline-comment-actions"><button>…</button></div>
          <span class="Label">Collaborator</span>
        </div>
        <div class="comment-body js-comment-body">${long} Second reply in the thread.</div>
      </div>
      <div class="js-comment review-comment" id="discussion_r3">
        <div class="flex-row-reverse" id="thread-row-3" style="display:flex;flex-direction:row-reverse">
          <div class="timeline-comment-actions"><button>…</button></div>
        </div>
        <div class="comment-body js-comment-body">${long} Third reply in the thread.</div>
      </div>
    </div>
  </review-thread-collapsible>
  <div data-testid="issue-body" class="react-issue-body IssueBody-module__innerContainer__xxxx">
    <h2 class="sr-only">Description</h2>
    <div class="IssueBody-module__headerRow__xxxx">
      <div class="IssueBody-module__commentBorder__xxxx">
        <div class="IssueBodyHeader-module__IssueBodyHeaderContainer__xxxx">
          <div class="ActivityHeader-module__activityHeader__xxxx">
            <div class="IssueBodyHeader-module__avatarContainer__xxxx"></div>
            <div class="IssueBodyHeader-module__titleSection__xxxx"></div>
            <div class="IssueBodyHeader-module__badgesSection__xxxx" id="issue-row" style="display:flex">
              <div class="IssueBodyHeader-module__badgeGroup__xxxx"><span class="Label">Collaborator</span></div>
              <div class="IssueBodyHeader-module__actionsSection__xxxx"><button>…</button></div>
            </div>
          </div>
        </div>
        <div id="issue-body-viewer" data-testid="issue-body-viewer">
          <div data-testid="markdown-body" class="markdown-body">${long}</div>
        </div>
      </div>
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
const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('ok -', msg); };

const btns = doc.querySelectorAll('.gh-tldr-btn');
assert(btns.length === 6, `a button per comment: 2 comments + 3 thread replies + the issue description (got ${btns.length})`);
// Visual order is what matters, and the classic row runs right-to-left.
function visualOrder(rowId) {
  const row = doc.getElementById(rowId);
  const kids = [...row.children];
  const reversed = row.style.flexDirection.includes('reverse');
  return (reversed ? kids.reverse() : kids).map((el) =>
    el.classList.contains('gh-tldr-btn') ? 'TLDR' : (el.textContent.trim().replace('…', 'kebab') || '?')
  );
}

const classicOrder = visualOrder('classic-row');
assert(classicOrder[0] === 'TLDR', `classic/PR: button is leftmost, before the badge (got ${classicOrder.join(' | ')})`);
assert(classicOrder.indexOf('TLDR') < classicOrder.indexOf('Member'), 'classic/PR: button sits left of the Member badge');
assert(!doc.querySelector('.timeline-comment-actions .gh-tldr-btn'), 'classic/PR: button moved out of the kebab action bar');

// The reported bug: three comments in one thread put all three buttons in the
// first comment's header instead of one each.
for (const n of [1, 2, 3]) {
  const comment = doc.getElementById('discussion_r' + n);
  const own = comment.querySelectorAll('.gh-tldr-btn');
  assert(own.length === 1, `thread comment ${n} has exactly one button (got ${own.length})`);
  assert(own[0].closest('.js-comment') === comment, `thread comment ${n}'s button stays in its own comment`);
  const row = doc.getElementById('thread-row-' + n);
  assert([...row.children].pop() === own[0], `thread comment ${n}: button is leftmost in its own row`);
}
assert(doc.querySelectorAll('review-thread-collapsible .gh-tldr-btn').length === 3, 'thread has three buttons total, not stacked');

const issueOrder = visualOrder('issue-row');
assert(issueOrder[0] === 'TLDR', `issue: button is leftmost in the badges row (got ${issueOrder.join(' | ')})`);
assert(issueOrder.indexOf('TLDR') < issueOrder.indexOf('Collaborator'), 'issue: button sits left of the Collaborator badge');
assert(btns[0].querySelector('svg.gh-tldr-wand'), 'button carries the wand icon with the design class');
assert(btns[0].querySelectorAll('svg.gh-tldr-wand path').length === 8, 'icon has all 8 lucide wand-sparkles paths');
assert(btns[0].querySelector('svg.gh-tldr-wand').namespaceURI === 'http://www.w3.org/2000/svg', 'icon built in the SVG namespace');
assert(!btns[0].querySelector('svg').hasAttribute('width'), 'icon sized by CSS (14x14), not width attributes');
assert(btns[0].querySelector('.gh-tldr-label').textContent === 'TLDR', 'button still reads TLDR');
assert(doc.querySelector('[data-testid="comment-viewer-outer-box"] .gh-tldr-bar .gh-tldr-btn'), 'react comment: button falls back to its own bar');

// The bug: on GitHub Issues the description has no action bar, so the button
// used to land in a row above the body instead of up in the header.
const issueBody = doc.querySelector('[data-testid="issue-body"]');
const issueBtn = issueBody.querySelector('.gh-tldr-btn');
assert(issueBtn, 'issue description gets a button');
assert(
  issueBtn.closest('[class*="ActivityHeader-module__activityHeader"]'),
  'issue description: button sits in the header, not above the body'
);
assert(!issueBody.querySelector('.gh-tldr-bar'), 'issue description: no fallback bar is created');
assert(!issueBtn.classList.contains('gh-tldr-btn--header'), 'badge-row placement does not need the right-align modifier');
assert(
  issueBody.querySelector('[data-testid="issue-body-viewer"] .gh-tldr-panel'),
  'issue description: panel still renders next to the body'
);

(async () => {
  const btn = btns[0];
  const panel = doc.querySelectorAll('.gh-tldr-panel')[0];
  assert(panel.hidden === true, 'panel starts hidden');
  btn.click();
  await new Promise((r) => setTimeout(r, 20));

  const tldrs = () => sent.filter((m) => m.type === 'tldr');
  assert(sent.filter((m) => m.type === 'peek').length === 6, 'cache peeked once per comment on attach');
  assert(tldrs().length === 1, 'one tldr message sent to background');
  assert(tldrs()[0].text.includes('deserves a summary'), 'comment text forwarded');
  assert(panel.hidden === false, 'panel visible after summarizing');
  assert(panel.querySelectorAll('.gh-tldr-list li').length === 2, 'bullets rendered as a list');

  btn.click();
  await new Promise((r) => setTimeout(r, 10));
  assert(panel.hidden === true && tldrs().length === 1, 'second click hides panel without a second API call');
  btn.click();
  await new Promise((r) => setTimeout(r, 10));
  assert(panel.hidden === false && tldrs().length === 1, 'third click re-shows the cached summary');

  // error path
  tldrReply = { error: 'No OpenAI API key set.' };
  const btn2 = btns[1];
  btn2.click();
  await new Promise((r) => setTimeout(r, 20));
  const p2 = doc.querySelectorAll('.gh-tldr-panel')[1];
  assert(p2.className.includes('gh-tldr-error') && p2.textContent.includes('No OpenAI API key'), 'error surfaces in the panel');
  assert(btn2.disabled === false, 'button re-enabled after failure');

  // --- cached summaries appear without a click ---
  peekReply = { summary: '- cached bullet one\n- cached bullet two', cached: true };
  const before = sent.filter((m) => m.type === 'tldr').length;
  const fresh = doc.createElement('div');
  fresh.className = 'js-comment-container';
  fresh.innerHTML = '<div class="comment-body js-comment-body">' + long + '</div>';
  doc.body.appendChild(fresh);
  await new Promise((r) => setTimeout(r, 500)); // MutationObserver debounce

  const newPanel = fresh.querySelector('.gh-tldr-panel');
  assert(newPanel && newPanel.hidden === false, 'cache hit opens the panel with no click');
  assert(/cached bullet one/.test(newPanel.textContent), 'cached summary rendered');
  assert(newPanel.querySelector('.gh-tldr-title').textContent === 'TLDR · cached', 'title marks it as cached');
  assert(sent.filter((m) => m.type === 'tldr').length === before, 'cache hit costs no API call');

  // A miss must leave the panel shut.
  peekReply = {};
  const fresh2 = doc.createElement('div');
  fresh2.className = 'js-comment-container';
  fresh2.innerHTML = '<div class="comment-body js-comment-body">' + long + ' edited since.</div>';
  doc.body.appendChild(fresh2);
  await new Promise((r) => setTimeout(r, 500));
  const missPanel = fresh2.querySelector('.gh-tldr-panel');
  assert(missPanel && missPanel.hidden === true, 'cache miss (e.g. edited comment) leaves the panel closed');
})();
