const { JSDOM } = require('jsdom');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// Rendered Markdown files: a repository's README on its home page, and a .md
// opened in the file view. Neither has a ... menu, so each gets a TLDR button
// beside GitHub's own Outline button. The markup below is trimmed from
// fetched github.com pages; the hashed module suffixes are deliberately not
// the live ones, so only the stable parts can be relied on.

const SRC = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const README = 'This project does something useful and this README explains how to install and run it. '.repeat(4);

const outlineIcon = '<svg data-component="Octicon" aria-hidden="true" focusable="false" class="octicon octicon-list-unordered" viewBox="0 0 16 16" width="16" height="16"><path d="M0 0"/></svg>';

// Repository home: the README header row is a nav, an empty slot, then Outline.
const homePage = (text = README) => `
  <div class="OverviewRepoFiles-module__Box__zzzz" id="readme">
    <div class="OverviewRepoFiles-module__Box_1__zzzz" id="readme-header">
      <nav aria-label="Repository files"><ul><li><a href="#">README</a></li></ul></nav>
      <div class="OverviewRepoFiles-module__readmeHeaderSlot__zzzz"></div>
      <button data-component="ActionMenu.Button" type="button" aria-label="Outline" aria-haspopup="true"
        aria-expanded="false" tabindex="0" id="outline"
        class="prc-Button-ButtonBase-zzzz OverviewRepoFiles-module__ActionMenu_Button__zzzz"
        data-loading="false" data-size="medium" data-variant="invisible">${outlineIcon}</button>
    </div>
    <div class="js-snippet-clipboard-copy-unpositioned DirectoryRichtextContent-module__SharedMarkdownContent__zzzz" id="readme-wrap">
      <article class="markdown-body entry-content container-lg" itemprop="text"><h1>Project</h1><p>${text}</p></article>
    </div>
  </div>`;

// File view: Raw / copy / download, then an icon-only Outline with a tooltip
// sibling, then the kebab. The article is four levels below the header.
const blobPage = (text = README) => `<div id="blob-view">
  <div class="BlobViewHeader-module__Box__zzzz">
    <div class="BlobViewHeader-module__Box_3__zzzz" id="blob-header">
      <div class="react-blob-header-edit-and-raw-actions">
        <div class="prc-ButtonGroup-ButtonGroup-zzzz">
          <a data-testid="raw-button" class="prc-Button-ButtonBase-zzzz" data-size="small" data-variant="default">Raw</a>
        </div>
      </div>
      <button data-component="IconButton" type="button" aria-pressed="false" id="outline"
        class="prc-Button-ButtonBase-zzzz tmp-mr-2 TableOfContents-module__IconButton__zzzz prc-Button-IconButton-zzzz"
        data-loading="false" data-no-visuals="true" data-size="small" data-variant="invisible"
        aria-labelledby="outline-tip">${outlineIcon}</button>
      <span class="prc-TooltipV2-Tooltip-zzzz" aria-hidden="true" id="outline-tip">Outline</span>
      <div class="react-blob-header-edit-and-raw-actions-combined"><button data-testid="more-file-actions-button">…</button></div>
    </div>
  </div>
  <div class="BlobViewContent-module__blobContentWrapper__zzzz">
    <section class="BlobContent-module__blobContentSection__zzzz">
      <div class="js-snippet-clipboard-copy-unpositioned BlobContent-module__markdownBlob__zzzz" id="blob-wrap">
        <article class="markdown-body entry-content container-lg" itemprop="text"><p>${text}</p></article>
      </div>
    </section>
  </div>
</div>`;

function load(html, { peekReply = {}, tldrReply = { summary: '- what it is\n- how to run it' } } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { pretendToBeVisual: true, runScripts: 'outside-only' });
  const sent = [];
  const replies = { peekReply, tldrReply };
  const ctx = dom.getInternalVMContext();
  ctx.chrome = {
    runtime: {
      sendMessage: (msg) => {
        sent.push(msg);
        return Promise.resolve(msg.type === 'peek' ? replies.peekReply : replies.tldrReply);
      },
    },
  };
  vm.runInContext(SRC, ctx);
  return { dom, doc: dom.window.document, sent, replies };
}

const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok -', m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (dom, el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

(async () => {
  // --- repository home: README ---
  {
    const { dom, doc, sent } = load(homePage());
    const outline = doc.getElementById('outline');
    const btns = doc.querySelectorAll('.gh-tldr-doc-button');
    assert(btns.length === 1, `the README gets exactly one TLDR button (got ${btns.length})`);
    const btn = btns[0];
    assert(outline.previousElementSibling === btn, 'it sits directly left of the Outline button');
    assert(btn.parentElement.id === 'readme-header', 'inside the README header row, not above the text');

    // It is a clone of GitHub's own button, not a lookalike.
    assert(btn.tagName === 'BUTTON' && btn.type === 'button', 'it is a real <button type="button">');
    assert(btn.className.includes('prc-Button-ButtonBase'), "Primer's base class survives, so GitHub sizes it");
    assert(btn.dataset.size === 'medium' && btn.dataset.variant === 'invisible',
      'and so do the size and variant it styles on');
    assert(!/-module__|IconButton/.test(btn.className), "Outline's own layout and icon-only classes are stripped");
    for (const attr of ['id', 'aria-label', 'aria-haspopup', 'data-component']) {
      assert(!btn.hasAttribute(attr), `Outline's ${attr} is not copied`);
    }
    assert(!btn.querySelector('.octicon-list-unordered'), "Outline's glyph is not copied");

    // Same design as the menu entry.
    assert(btn.classList.contains('gh-tldr-menu-item') && btn.dataset.tldrMenu === 'button',
      'it wears the menu entry styling, tagged as the button variant');
    const label = btn.querySelector('.gh-tldr-label');
    assert(label && label.textContent === 'TLDR', 'label reads TLDR, wrapped for the gradient');
    assert(btn.textContent.trim() === 'TLDR', 'and nothing else');
    const wand = btn.querySelector('svg.gh-tldr-wand');
    assert(wand && wand.querySelectorAll('path').length === 8, 'it carries the wand glyph');
    assert(wand.getAttribute('width') === '16', 'sized like an octicon');
    const mesh = btn.querySelector('.gh-tldr-mesh');
    assert(mesh && btn.firstElementChild === mesh && mesh.querySelectorAll('.gh-tldr-blob').length === 7,
      'the hover mesh is built in, behind the content');
    assert(/^-\d+(\.\d+)?s$/.test(btn.style.getPropertyValue('--gh-tldr-phase')), 'with its own animation phase');
    assert(doc.getElementById('gh-tldr-icon-gradient'), 'the icon gradient paint server is there');
    assert(btn.getAttribute('aria-expanded') === 'false', 'it reports its panel as closed');

    // The cache is peeked as a document, and nothing is built yet.
    const peeks = sent.filter((m) => m.type === 'peek');
    assert(peeks.length === 1 && peeks[0].kind === 'document', 'the README is peeked once, as a document');
    const panel = doc.querySelector('#readme-wrap > .gh-tldr-panel');
    assert(panel && panel.hidden, 'its panel is prepared, closed');
    assert(panel.nextElementSibling === doc.querySelector('article.markdown-body'), 'directly above the article');
    assert(panel.dataset.tldrKind === 'document', 'and tagged so content.css can line it up with the article');

    click(dom, btn);
    await wait(30);
    const tldrs = sent.filter((m) => m.type === 'tldr');
    assert(tldrs.length === 1 && tldrs[0].kind === 'document', 'clicking requests one summary, as a document');
    assert(tldrs[0].text.includes('README explains how to install'), "the README's text is what gets sent");
    assert(!panel.hidden && panel.querySelectorAll('.gh-tldr-list li').length === 2, 'the summary renders above the README');
    assert(panel.dataset.tldrKind === 'document', 'the panel keeps its tag through the state changes');
    assert(btn.getAttribute('aria-expanded') === 'true', 'and the button says so');

    click(dom, btn);
    await wait(20);
    assert(panel.hidden && sent.filter((m) => m.type === 'tldr').length === 1, 'clicking again hides it without a second request');
    assert(btn.getAttribute('aria-expanded') === 'false', 'and the button follows');

    // Re-scans must not stack buttons.
    doc.body.appendChild(doc.createElement('div'));
    await wait(400);
    assert(doc.querySelectorAll('.gh-tldr-doc-button').length === 1, 'mutations do not add a second button');

    // --- client-side navigation ---
    // Switching README tabs (or files) swaps the article but keeps the header:
    // the button stays put and now summarizes the new document.
    const wrap = doc.getElementById('readme-wrap');
    wrap.innerHTML = '<article class="markdown-body entry-content container-lg" itemprop="text"><p>Code of conduct. Be kind to one another, and report problems to the maintainers who will act on them promptly. Thank you.</p></article>';
    await wait(400);
    assert(doc.querySelectorAll('.gh-tldr-doc-button').length === 1, 'after the article is swapped there is still one button');
    assert(doc.querySelector('.gh-tldr-doc-button') === btn, 'the same one, rebound rather than rebuilt');
    click(dom, btn);
    await wait(30);
    const last = sent.filter((m) => m.type === 'tldr').pop();
    assert(last.text.includes('Code of conduct'), 'and it now summarizes the new document');
    assert(doc.querySelectorAll('.gh-tldr-panel').length === 1, 'the old panel went with the old document');

    // Leaving Markdown altogether takes the button with it.
    wrap.innerHTML = '<pre>plain code, no Markdown here</pre>';
    await wait(400);
    assert(doc.querySelectorAll('.gh-tldr-doc-button').length === 0, 'with no document left, the button is removed');
    assert(doc.querySelectorAll('.gh-tldr-panel').length === 0, 'and so is its panel');
  }

  // --- file view: a .md opened in the blob view ---
  {
    const { dom, doc, sent } = load(blobPage());
    const outline = doc.getElementById('outline');
    const btn = doc.querySelector('.gh-tldr-doc-button');
    assert(btn && outline.previousElementSibling === btn, 'a .md file gets the button left of its Outline button');
    assert(btn.parentElement.id === 'blob-header', 'in the file header, beside Raw and the other actions');
    assert(btn.dataset.size === 'small', "it takes the file header's small size from the button it cloned");
    assert(!btn.className.includes('tmp-mr-2'), "Outline's own margin is not copied");
    assert(!btn.hasAttribute('aria-labelledby') && !btn.hasAttribute('aria-pressed'), 'nor its tooltip or toggle state');
    assert(!btn.hasAttribute('data-no-visuals'), 'it has visuals now, so that flag goes');
    assert(doc.querySelectorAll('.gh-tldr-doc-button').length === 1, 'exactly one');

    click(dom, btn);
    await wait(30);
    assert(sent.some((m) => m.type === 'tldr' && m.kind === 'document'), 'clicking summarizes it as a document');
    assert(doc.querySelector('#blob-wrap > .gh-tldr-panel:not([hidden])'), 'into a panel above the file');
  }

  // --- no Outline button: a row of its own ---
  {
    // The unrelated list icon shares an ancestor with the document, but only
    // eight levels up — past where any real Outline button sits.
    const { dom, doc, sent } = load(`<div id="page">
      <div id="far-away"><button id="unrelated">${outlineIcon}</button></div>
      <div><div><div><div><div><div><div id="wrap">
        <article class="markdown-body entry-content container-lg"><p>${README}</p></article>
      </div></div></div></div></div></div></div></div>`);
    const btn = doc.querySelector('.gh-tldr-doc-button');
    assert(btn, 'a document with no Outline button still gets one');
    const bar = btn.parentElement;
    assert(bar.classList.contains('gh-tldr-doc-bar'), 'in a row of its own');
    assert(doc.getElementById('far-away').querySelectorAll('.gh-tldr-doc-button').length === 0,
      'a list icon far up the page is not mistaken for this document\'s Outline');
    assert(btn.classList.contains('btn') && btn.classList.contains('btn-sm'), "styled by GitHub's global .btn");
    assert(btn.querySelector('.gh-tldr-mesh') && btn.querySelector('.gh-tldr-label'), 'with the same design');
    const panel = doc.querySelector('#wrap > .gh-tldr-panel');
    assert(bar.nextElementSibling === panel && panel.nextElementSibling === doc.querySelector('article'),
      'the row sits above the panel, which sits above the document');
    click(dom, btn);
    await wait(30);
    assert(sent.some((m) => m.type === 'tldr' && m.kind === 'document') && !panel.hidden, 'and it works');
  }

  // --- comments are not documents ---
  {
    const { doc, sent } = load(`
      <div class="js-comment-container">
        <div class="comment-body markdown-body js-comment-body">${README}</div>
      </div>
      <div data-testid="issue-body-viewer"><div data-testid="markdown-body" class="markdown-body">${README}</div></div>`);
    assert(doc.querySelectorAll('.gh-tldr-doc-button').length === 0, 'comment bodies, which are .markdown-body too, get no button');
    assert(sent.every((m) => m.kind === 'comment'), 'and are still peeked as comments');
  }

  // --- a cached summary opens on its own ---
  {
    const { doc } = load(homePage(), { peekReply: { summary: '- cached one\n- cached two', cached: true } });
    await wait(20);
    const panel = doc.querySelector('.gh-tldr-panel');
    assert(panel && !panel.hidden, 'a README summarized before opens with no click');
    assert(panel.querySelector('.gh-tldr-title').textContent === 'TLDR · cached', 'labelled as cached');
    assert(doc.querySelector('.gh-tldr-doc-button').getAttribute('aria-expanded') === 'true',
      'and the button reports it open');
  }
})();
