/** Chat UI page. All assets are same-origin (see chat-assets.ts and ui-assets.ts). */
export function getChatHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Lore</title>
<link rel="stylesheet" href="/assets/vendor/github-dark.min.css">
<link rel="stylesheet" href="/assets/lore.css">
<script src="/assets/vendor/marked.umd.js" defer></script>
<script src="/assets/vendor/purify.min.js" defer></script>
<script src="/assets/vendor/highlight.min.js" defer></script>
<script src="/assets/vendor/mermaid.min.js" defer></script>
<script src="/assets/lore.js" defer></script>
</head>
<body>

<div id="app">
  <!-- Col 1: Sessions sidebar -->
  <div class="col-sessions" id="colSessions">
    <div class="sb-header">
      <span class="sb-title">Lore</span>
      <button class="sb-new-btn" id="newChatBtn">+ New</button>
    </div>
    <div class="sb-list" id="sbList"></div>
  </div>

  <!-- Col 2: Chat -->
  <div class="col-chat">
    <div class="chat-header">
      <div class="logo">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
        Lore
      </div>
      <div class="divider"></div>
      <div class="scope-selector" id="scopeSelector">
        <button class="scope-btn" id="scopeBtn">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
          <span id="scopeBtnLabel">All services</span>
          <span class="chevron">▼</span>
        </button>
        <div class="scope-dropdown" id="scopeDropdown">
          <div class="scope-search"><input type="text" placeholder="Search services…" id="scopeSearchInput"></div>
          <div class="active-filters" id="activeFilters"></div>
          <div class="scope-list" id="scopeList"></div>
        </div>
      </div>
      <button class="publish-btn" id="publishBtn" disabled>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        Publish
      </button>
      <div class="user-menu" id="userMenu" hidden>
        <a class="user-menu-link" id="navUsers" href="/admin/users" hidden>Users</a>
        <a class="user-menu-link" id="navNamespaces" href="/admin/namespaces" hidden>Namespaces</a>
        <span id="userName"></span>
        <a class="user-menu-link" id="navTokens" href="/tokens" hidden>Tokens</a>
        <button type="button" id="signOutBtn">Sign out</button>
      </div>
    </div>

    <div class="messages" id="messages">
      <div id="empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
        <h2>Ask Lore</h2>
        <p>Search your documentation or develop an idea with AI assistance.</p>
        <div class="suggestions">
          <div class="suggestion">How are refunds handled?</div>
          <div class="suggestion">What happens when an order is placed?</div>
          <div class="suggestion">Which endpoints send notifications?</div>
        </div>
      </div>
    </div>

    <div class="input-area">
      <div class="input-scope-hint" id="inputScopeHint">
        Filtering: <span class="ish-tag" id="ishTag"></span>
      </div>
      <div class="input-wrap" id="inputWrap">
        <div class="mode-btns">
          <button class="mt-btn active-qa" id="btnQA" title="Q&amp;A — strict answers from docs">🔍</button>
          <button class="mt-btn" id="btnBS" title="Brainstorm — free reasoning with docs as reference">💡</button>
        </div>
        <textarea id="input" rows="1" placeholder="Ask a question..."></textarea>
        <button class="send-btn" id="sendBtn" disabled>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
      <div class="input-hint">Enter to send · Shift+Enter for new line</div>
    </div>
  </div>

  <!-- Col 3: Context panel -->
  <div class="col-context" id="colContext">
    <div class="ctx-resize-handle" id="ctxResizeHandle"></div>
    <div class="ctx-tabs">
      <div class="ctx-tab active" id="tabFind" data-tab="find">Find</div>
      <div class="ctx-tab" id="tabContext" data-tab="context">Context <span id="ctxBadge"></span></div>
    </div>
    <div class="ctx-limit" id="ctxLimit" role="status" hidden></div>

    <!-- Find tab -->
    <div class="ctx-panel active" id="panelFind">
      <div class="find-empty" id="findEmpty">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        Results appear here after your first query
      </div>
      <div id="findGroups"></div>
    </div>

    <!-- Context tab -->
    <div class="ctx-panel" id="panelContext">
      <div class="ctx-header">
        <span class="ctx-count" id="ctxCount">0 documents</span>
        <button class="ctx-clear" id="ctxClear">clear</button>
      </div>
      <div class="ctx-docs" id="ctxDocs">
        <div class="ctx-empty" id="ctxEmpty">
          Add documents from the Find tab to chat with a focused context.
        </div>
      </div>
      <button class="ctx-add-from-find" id="ctxAddFromFind">+ Add from Find tab</button>
      <button class="ctx-chat-btn" id="ctxChatBtn" disabled>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        Chat with context
      </button>
    </div>
  </div>
</div>

<!-- Publish modal -->
<div class="pub-modal-bg" id="pubModalBg">
  <div class="pub-modal">
    <h3>Publish as insight</h3>
    <p class="pub-hint">Saved to the shared insights library, linked to the documents this chat cited.</p>
    <label>Related service (optional)</label>
    <select id="pubLibrary"></select>
    <label>Slug (optional; only admins may choose one)</label>
    <input type="text" id="pubSlug" placeholder="insight/&lt;session id&gt;">
    <label>Title</label>
    <input type="text" id="pubTitle" placeholder="Insight title">
    <div class="pub-modal-actions">
      <button class="pub-cancel" id="pubCancel">Cancel</button>
      <button class="pub-confirm" id="pubConfirm">Publish</button>
    </div>
  </div>
</div>

<!-- Mermaid overlay -->
<div class="mermaid-overlay" id="mermaidOverlay">
  <div class="mermaid-overlay-content" id="mermaidOverlayContent">
  </div>
</div>
<!-- Image overlay -->
<div class="img-overlay" id="imgOverlay">
  <img id="imgOverlayImg" src="" alt="">
</div>

<!-- Document drawer -->
<div class="doc-drawer-bg" id="docDrawerBg">
  <div class="doc-drawer">
    <div class="doc-drawer-header">
      <span class="doc-drawer-title" id="docDrawerTitle"></span>
      <span class="doc-drawer-author" id="docDrawerAuthor" hidden></span>
      <button class="doc-drawer-close" id="docDrawerClose">✕</button>
    </div>
    <div class="doc-drawer-body" id="docDrawerBody"></div>
  </div>
</div>


</body>
</html>
`;
}
