/**
 * Stylesheet and script of the chat UI, served as same-origin files
 * (/assets/lore.css, /assets/lore.js) so the page runs under a strict CSP
 * without inline scripts or styles.
 */
import { MAX_CHAT_CHARS, MAX_CHAT_MESSAGES, MAX_PINNED_DOCS } from '../../application/chat-request.js';
import { CHAT_MARKDOWN_JS } from './chat-markdown.js';

export const CHAT_CSS = `.pub-hint { font-size: 12px; color: var(--muted); margin: -8px 0 12px; }
/* Static mermaid styling (rendered SVG <style> blocks are stripped) */
.mermaid-diagram svg { font-family: var(--font); font-size: 14px; }
.mermaid-diagram svg text, .mermaid-diagram svg .label { fill: var(--text); color: var(--text); }
.mermaid-diagram svg .node rect, .mermaid-diagram svg .node circle, .mermaid-diagram svg .node ellipse,
.mermaid-diagram svg .node polygon, .mermaid-diagram svg .node path { fill: var(--surface2); stroke: var(--accent-dim); stroke-width: 1px; }
.mermaid-diagram svg .cluster rect { fill: var(--surface); stroke: var(--border); }
.mermaid-diagram svg .flowchart-link, .mermaid-diagram svg .edgePath .path, .mermaid-diagram svg .messageLine0,
.mermaid-diagram svg .messageLine1, .mermaid-diagram svg .transition, .mermaid-diagram svg line { stroke: var(--text-dim); fill: none; }
.mermaid-diagram svg marker path, .mermaid-diagram svg .arrowheadPath, .mermaid-diagram svg .arrowMarkerPath { fill: var(--text-dim); stroke: var(--text-dim); }
.mermaid-diagram svg .edgeLabel, .mermaid-diagram svg .edgeLabel rect { fill: var(--surface); background: var(--surface); }
.mermaid-diagram svg .actor { fill: var(--surface2); stroke: var(--accent-dim); }
.mermaid-diagram svg .note { fill: var(--surface3); stroke: var(--border-light); }
.mermaid-diagram svg .stateGroup rect, .mermaid-diagram svg .state-group rect { fill: var(--surface2); stroke: var(--accent-dim); }
.login-error { color: var(--red); font-size: 12px; margin-bottom: 8px; }
:root {
  --bg: #131320; --surface: #1a1a2e; --surface2: #222240; --surface3: #2a2a4a;
  --border: #303058; --border-light: #3a3a65;
  --text: #e0e0f0; --text-dim: #b0b0cc; --muted: #7070a0;
  --accent: #7c8aff; --accent-dim: #5a64cc;
  --accent-glow: rgba(124,138,255,0.10); --accent-glow2: rgba(124,138,255,0.20);
  --green: #4ade80; --green-dim: #22a85a; --green-glow: rgba(74,222,128,0.12);
  --orange: #fbbf24; --orange-glow: rgba(251,191,36,0.12); --orange-dim: rgba(251,191,36,0.5);
  --pink: #f472b6; --red: #f87171; --red-glow: rgba(248,113,113,0.12);
  --cyan: #22d3ee;
  --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif;
  --mono: 'SF Mono', 'Fira Code', 'Consolas', monospace;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; background: var(--bg); color: var(--text); font-family: var(--font); font-size: 14px; line-height: 1.6; }
#app { display: flex; height: 100vh; overflow: hidden; }

/* ===== SIDEBAR (col-1) ===== */
.col-sessions {
  width: 220px; min-width: 220px; background: var(--surface); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; flex-shrink: 0;
}
.sb-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; border-bottom: 1px solid var(--border);
}
.sb-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: var(--muted); }
.sb-new-btn {
  display: flex; align-items: center; gap: 5px;
  padding: 5px 10px; border-radius: 8px; font-size: 11px; font-weight: 600;
  background: var(--accent-glow); color: var(--accent); border: 1px solid var(--accent-dim);
  cursor: pointer; transition: all 0.15s;
}
.sb-new-btn:hover { background: var(--accent-glow2); border-color: var(--accent); }
.sb-list { flex: 1; overflow-y: auto; padding: 6px; }
.sb-list::-webkit-scrollbar { width: 4px; }
.sb-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
.sb-item {
  padding: 8px 10px; border-radius: 8px; cursor: pointer; transition: background 0.12s;
  font-size: 12px; color: var(--text-dim); position: relative; margin-bottom: 1px;
}
.sb-item:hover { background: var(--surface2); }
.sb-item.active { background: var(--accent-glow); color: var(--accent); }
.sb-item-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 2px; }
.sb-item-meta { font-size: 10px; color: var(--muted); display: flex; gap: 6px; align-items: center; }
.sb-item-published { font-size: 9px; color: var(--green); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
.sb-item-del {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  display: none; width: 22px; height: 22px; border-radius: 4px; border: none; background: none;
  color: var(--muted); cursor: pointer; align-items: center; justify-content: center; font-size: 12px;
}
.sb-item:hover .sb-item-del { display: flex; }
.sb-item-del:hover { background: var(--red-glow); color: var(--red); }
.sb-empty { padding: 20px; text-align: center; color: var(--muted); font-size: 12px; }

/* ===== CHAT (col-2) ===== */
.col-chat {
  flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden;
}
.chat-header {
  display: flex; align-items: center; padding: 10px 20px; gap: 12px;
  border-bottom: 1px solid var(--border); background: var(--surface); flex-shrink: 0; z-index: 20;
}
.logo { font-size: 17px; font-weight: 700; display: flex; align-items: center; gap: 8px; color: var(--text); }
.divider { width: 1px; height: 22px; background: var(--border); }
.scope-selector { position: relative; }
.scope-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 12px; border-radius: 10px;
  border: 1px solid var(--border); background: var(--surface2);
  color: var(--text-dim); font-size: 12px; cursor: pointer; transition: all 0.15s;
}
.scope-btn:hover { border-color: var(--accent); color: var(--accent); }
.scope-btn.filtered { border-color: var(--accent); color: var(--accent); background: var(--accent-glow); }
.scope-btn .chevron { font-size: 9px; opacity: 0.6; transition: transform 0.2s; }
.scope-btn.open .chevron { transform: rotate(180deg); }
.scope-dropdown {
  position: absolute; top: calc(100% + 6px); left: 0; width: 280px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4); z-index: 100; overflow: hidden;
  display: none;
}
.scope-dropdown.open { display: block; }
.scope-search { padding: 10px 14px; border-bottom: 1px solid var(--border); }
.scope-search input {
  width: 100%; background: var(--surface2); border: 1px solid var(--border); border-radius: 8px;
  padding: 6px 10px; color: var(--text); font-size: 12px; outline: none;
}
.scope-search input:focus { border-color: var(--accent); }
.scope-list { max-height: 280px; overflow-y: auto; padding: 6px; }
.scope-item {
  display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 8px;
  cursor: pointer; font-size: 12px; transition: background 0.12s;
}
.scope-item:hover { background: var(--surface2); }
.scope-item.active { background: var(--accent-glow); }
.scope-name { flex: 1; color: var(--text-dim); }
.scope-item.active .scope-name { color: var(--accent); }
.scope-count { font-size: 11px; color: var(--muted); }
.scope-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.scope-check { width: 16px; flex-shrink: 0; color: var(--accent); }
.active-filters { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 14px 10px; }
.active-filter {
  display: flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 6px; background: var(--accent-glow);
  border: 1px solid var(--accent-dim); color: var(--accent); font-size: 11px;
}
.af-x { background: none; border: none; color: var(--muted); cursor: pointer; padding: 0 0 0 2px; font-size: 11px; }
.af-x:hover { color: var(--red); }
.publish-btn {
  margin-left: auto; display: flex; align-items: center; gap: 5px;
  padding: 5px 12px; border-radius: 8px; font-size: 11px; font-weight: 600;
  background: var(--green-glow); color: var(--green); border: 1px solid var(--green-dim);
  cursor: pointer; transition: all 0.15s; flex-shrink: 0;
}
.publish-btn:hover { background: rgba(74,222,128,0.2); border-color: var(--green); }
.publish-btn:disabled { opacity: 0.35; cursor: default; }
.user-menu { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--text-dim); flex-shrink: 0; }
.user-menu[hidden] { display: none; }
.user-menu button {
  padding: 4px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface2);
  color: var(--text-dim); font-size: 12px; cursor: pointer;
}
.user-menu button:hover { border-color: var(--accent); color: var(--accent); }
.user-menu-link { color: var(--text-dim); text-decoration: none; }
.user-menu-link[hidden] { display: none; }
.user-menu-link:hover { color: var(--accent); }
.messages {
  flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 16px;
}
.messages::-webkit-scrollbar { width: 5px; }
.messages::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
.msg { display: flex; gap: 10px; align-items: flex-start; max-width: 820px; }
.msg.user { flex-direction: row-reverse; align-self: flex-end; }
.avatar {
  width: 28px; height: 28px; border-radius: 9px; display: flex; align-items: center;
  justify-content: center; font-size: 10px; font-weight: 700; flex-shrink: 0;
}
.avatar.a { background: linear-gradient(135deg, var(--accent), var(--pink)); color: #fff; }
.avatar.u { background: var(--surface3); color: var(--muted); }
.bubble {
  padding: 10px 14px; border-radius: 14px; font-size: 14px; line-height: 1.7;
  max-width: calc(100% - 38px);
}
.bubble.a {
  background: var(--surface); border: 1px solid var(--border); color: var(--text);
  border-bottom-left-radius: 4px;
}
.bubble.u {
  background: var(--accent); color: #fff; border-bottom-right-radius: 4px;
}
.bubble.brainstorm {
  background: rgba(251,191,36,0.06); border: 1px solid rgba(251,191,36,0.2);
}
.bs-label {
  display: flex; align-items: center; gap: 4px;
  font-size: 11px; color: var(--orange); margin-bottom: 6px; font-weight: 600;
}
.bubble p, .doc-drawer-body p { margin: 0 0 0.6em; }
.bubble p:last-child, .doc-drawer-body p:last-child { margin-bottom: 0; }
.bubble ul, .bubble ol, .doc-drawer-body ul, .doc-drawer-body ol { padding-left: 20px; margin: 0.4em 0; }
.bubble li, .doc-drawer-body li { margin: 0.2em 0; }
.bubble h1,.bubble h2,.bubble h3,.bubble h4,
.doc-drawer-body h1,.doc-drawer-body h2,.doc-drawer-body h3,.doc-drawer-body h4 { margin: 0.8em 0 0.3em; font-size: 1em; }
.bubble code, .doc-drawer-body code { font-family: var(--mono); font-size: 12px; background: var(--surface2); padding: 1px 5px; border-radius: 4px; }
.bubble pre, .doc-drawer-body pre { background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 12px; overflow-x: auto; margin: 6px 0; }
.bubble pre code, .doc-drawer-body pre code { background: none; padding: 0; }
.bubble img, .doc-drawer-body img { max-width: 100%; border-radius: 6px; margin: 4px 0; cursor: zoom-in; }
.bubble table, .doc-drawer-body table { border-collapse: collapse; width: 100%; margin: 6px 0; font-size: 13px; }
.bubble th, .bubble td, .doc-drawer-body th, .doc-drawer-body td { border: 1px solid var(--border); padding: 5px 10px; }
.bubble th, .doc-drawer-body th { background: var(--surface2); font-weight: 600; }
.bubble a, .doc-drawer-body a { color: var(--accent); }
.cursor { display: inline-block; width: 2px; height: 14px; background: var(--accent); margin-left: 2px; animation: blink 1s step-end infinite; vertical-align: text-bottom; }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
.tool-indicator { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; padding: 4px 0; }
.tool-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: pulse 1.2s ease-in-out infinite; }
.retrieved-footer { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border); font-size: 11px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.retrieved-label { margin-right: 2px; flex-shrink: 0; }
@keyframes pulse { 0%,100%{opacity:0.4} 50%{opacity:1} }
.search-notice {
  display: flex; align-items: center; gap: 7px;
  padding: 5px 12px; margin: 0; align-self: flex-start;
  background: rgba(124,138,255,0.06); border: 1px solid rgba(124,138,255,0.18);
  border-radius: 8px; font-size: 12px; color: var(--muted); cursor: pointer;
  transition: background 0.15s; max-width: 300px;
}
.search-notice:hover { background: rgba(124,138,255,0.12); }
.sn-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }
.sn-dot.pulsing { animation: pulse 1.2s ease-in-out infinite; }
.sn-count { color: var(--accent); font-weight: 600; }
.sn-arrow { margin-left: auto; color: var(--accent); font-size: 11px; }
.suggest-add {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 8px 2px 6px; border-radius: 7px;
  font-size: 12px; font-family: var(--mono);
  background: var(--accent-glow); border: 1px dashed var(--accent-dim);
  color: var(--accent); cursor: pointer; transition: all 0.15s;
}
.suggest-add:hover { background: var(--accent-glow2); border-style: solid; }
.suggest-add .plus { font-weight: 700; font-size: 14px; }
.suggest-add.added { background: var(--green-glow); border: 1px solid rgba(74,222,128,0.3); color: var(--green); border-style: solid; cursor: default; }
.mermaid-diagram { position: relative; margin: 8px 0; cursor: zoom-in; }
.mermaid-expand { position: absolute; top: 6px; right: 6px; font-size: 11px; padding: 3px 8px; border-radius: 6px; background: var(--surface2); border: 1px solid var(--border); color: var(--muted); cursor: pointer; }
.mermaid-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 300; display: none; align-items: center; justify-content: center; }
.mermaid-overlay.open { display: flex; }
.mermaid-overlay-content { max-width: 90vw; max-height: 90vh; overflow: auto; background: var(--surface); border-radius: 12px; padding: 20px; position: relative; }
.mermaid-overlay-close { position: absolute; top: 10px; right: 12px; background: none; border: none; color: var(--muted); cursor: pointer; font-size: 18px; }
.img-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 300; display: none; align-items: center; justify-content: center; }
.img-overlay.open { display: flex; }
.img-overlay img { max-width: 90vw; max-height: 90vh; border-radius: 8px; }
#empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  flex: 1; gap: 16px; color: var(--muted); text-align: center; padding: 40px;
}
#empty h2 { font-size: 20px; font-weight: 600; color: var(--text); }
#empty p { font-size: 14px; max-width: 360px; }
.suggestions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 8px; }
.suggestion {
  background: var(--surface); border: 1px solid var(--border); border-radius: 20px;
  padding: 7px 14px; font-size: 13px; color: var(--text); cursor: pointer; transition: all 0.15s;
}
.suggestion:hover { border-color: var(--accent); background: var(--accent-glow); }

/* ===== INPUT AREA ===== */
.input-area { padding: 12px 20px 16px; border-top: 1px solid var(--border); flex-shrink: 0; }
.input-scope-hint {
  display: none; align-items: center; gap: 6px; padding: 4px 12px; font-size: 11px; color: var(--muted);
}
.input-scope-hint.visible { display: flex; }
.ish-tag { padding: 1px 6px; border-radius: 4px; background: var(--surface2); color: var(--cyan); font-family: var(--mono); font-size: 11px; }
.input-wrap {
  display: flex; align-items: center; background: var(--surface); border: 1px solid var(--border);
  border-radius: 14px; padding: 4px; gap: 4px; transition: border-color 0.2s;
}
.input-wrap:focus-within { border-color: var(--accent); }
.input-wrap.mode-brainstorm { border-color: rgba(251,191,36,0.3); }
.input-wrap.mode-brainstorm:focus-within { border-color: var(--orange); }
.mode-btns { display: flex; gap: 2px; background: var(--surface2); border-radius: 8px; padding: 2px; flex-shrink: 0; }
.mt-btn {
  width: 30px; height: 30px; border-radius: 6px; border: none; background: none;
  font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.15s; color: var(--muted);
}
.mt-btn:hover { color: var(--text); }
.mt-btn.active-qa { background: var(--accent-glow2); color: var(--accent); }
.mt-btn.active-bs { background: var(--orange-glow); color: var(--orange); }
#input {
  flex: 1; background: none; border: none; color: var(--text); font-family: var(--font);
  font-size: 14px; padding: 8px 12px; outline: none; resize: none; max-height: 200px; min-height: 24px; line-height: 1.5;
}
#input::placeholder { color: var(--muted); }
.send-btn {
  width: 34px; height: 34px; border-radius: 10px; border: none;
  background: var(--accent); color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.15s;
}
.send-btn:hover { opacity: 0.85; }
.send-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.send-btn.mode-bs { background: var(--orange); color: #111; }
.input-hint { text-align: center; font-size: 10px; color: var(--muted); margin-top: 5px; opacity: 0.5; }

/* ===== CONTEXT PANEL (col-3) ===== */
.col-context {
  width: 240px; min-width: 160px; max-width: 600px; background: var(--surface); border-left: 1px solid var(--border);
  display: flex; flex-direction: column; flex-shrink: 0; position: relative;
}
.ctx-resize-handle {
  position: absolute; left: 0; top: 0; bottom: 0; width: 5px;
  cursor: col-resize; z-index: 10; transition: background 0.15s;
}
.ctx-resize-handle:hover, .ctx-resize-handle.dragging { background: var(--accent-dim); }
.ctx-tabs {
  display: flex; border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.ctx-tab {
  flex: 1; padding: 10px 0; font-size: 12px; font-weight: 600; text-align: center;
  cursor: pointer; color: var(--muted); border-bottom: 2px solid transparent;
  transition: all 0.15s;
}
.ctx-tab:hover { color: var(--text); }
.ctx-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.ctx-panel { flex: 1; overflow-y: auto; display: none; }
.ctx-panel.active { display: flex; flex-direction: column; }
.ctx-panel::-webkit-scrollbar { width: 4px; }
.ctx-panel::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
.find-empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  color: var(--muted); font-size: 12px; text-align: center; padding: 24px; gap: 8px;
}
.find-group { border-bottom: 1px solid var(--border); }
.find-group-header {
  display: flex; align-items: center; gap: 6px; padding: 8px 12px;
  cursor: pointer; user-select: none; transition: background 0.12s;
}
.find-group-header:hover { background: var(--surface2); }
.fg-chevron { font-size: 10px; color: var(--muted); transition: transform 0.2s; width: 12px; flex-shrink: 0; }
.find-group.expanded .fg-chevron { transform: rotate(90deg); }
.fg-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.fg-name { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fg-count { font-size: 11px; color: var(--muted); margin-left: auto; flex-shrink: 0; }
.fg-add-all {
  padding: 1px 7px; border-radius: 5px; font-size: 10px; font-weight: 600;
  background: var(--accent-glow); color: var(--accent); border: 1px solid var(--accent-dim);
  cursor: pointer; flex-shrink: 0; transition: all 0.12s;
}
.fg-add-all:hover { background: var(--accent-glow2); }
.find-group-docs { display: none; padding: 0 8px 6px; }
.find-group.expanded .find-group-docs { display: block; }
.find-doc {
  display: flex; align-items: flex-start; gap: 7px; padding: 5px 4px; border-radius: 7px;
  cursor: pointer; transition: background 0.12s;
}
.find-doc:hover { background: var(--surface2); }
.doc-cb {
  width: 16px; height: 16px; border-radius: 4px; border: 1.5px solid var(--border);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px;
  transition: all 0.15s; background: none;
}
.doc-cb.checked { background: var(--accent); border-color: var(--accent); }
.doc-cb.checked::after { content: ''; display: block; width: 8px; height: 5px; border-left: 1.5px solid #fff; border-bottom: 1.5px solid #fff; transform: rotate(-45deg) translate(1px,-1px); }
.doc-info { flex: 1; min-width: 0; }
.doc-name { font-size: 12px; color: var(--text-dim); font-family: var(--mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.doc-meta { font-size: 10px; color: var(--muted); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.http-badge { display: inline-block; padding: 0 4px; border-radius: 3px; font-size: 9px; font-weight: 700; font-family: var(--mono); letter-spacing: 0.3px; margin-right: 4px; vertical-align: middle; }
.http-get    { background: rgba(34,211,238,0.15); color: var(--cyan); }
.http-post   { background: rgba(124,138,255,0.15); color: var(--accent); }
.http-put    { background: rgba(251,191,36,0.15); color: var(--orange); }
.http-patch  { background: rgba(167,139,250,0.15); color: #a78bfa; }
.http-delete { background: rgba(248,113,113,0.15); color: var(--red); }
.doc-score-bar  { height: 2px; border-radius: 2px; margin-top: 4px; background: var(--surface3); }
.doc-score-fill { height: 2px; border-radius: 2px; }
.doc-dedup {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 0px 5px; border-radius: 4px; font-size: 9px; font-weight: 700;
  background: rgba(251,191,36,0.12); color: var(--orange); border: 1px solid rgba(251,191,36,0.25);
  cursor: pointer; margin-left: 4px; flex-shrink: 0; align-self: center;
}
.dedup-expanded {
  padding: 4px 4px 4px 23px; display: flex; flex-direction: column; gap: 3px;
}
.dedup-lib {
  display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 6px;
  font-size: 11px; cursor: pointer; transition: background 0.12s;
}
.dedup-lib:hover { background: var(--surface2); }
.dedup-lib-name { font-family: var(--mono); color: var(--text-dim); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dedup-lib-add {
  padding: 1px 8px; border-radius: 5px; font-size: 10px; font-weight: 600;
  background: var(--accent-glow); color: var(--accent); border: 1px solid var(--accent-dim);
  cursor: pointer; flex-shrink: 0;
}
.dedup-lib-add.in-ctx { background: var(--green-glow); color: var(--green); border-color: rgba(74,222,128,0.3); cursor: default; }
.ctx-header {
  display: flex; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.ctx-count { font-size: 12px; color: var(--muted); flex: 1; }
.ctx-clear {
  padding: 2px 8px; font-size: 10px; font-weight: 600; border-radius: 5px;
  background: none; border: 1px solid var(--border); color: var(--muted); cursor: pointer;
  transition: all 0.12s;
}
.ctx-clear:hover { border-color: var(--red); color: var(--red); }
.ctx-docs { flex: 1; overflow-y: auto; padding: 8px; }
.ctx-doc-card {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px;
  background: var(--surface2); border: 1px solid var(--border); margin-bottom: 6px;
}
.ctx-doc-icon { font-size: 14px; flex-shrink: 0; }
.ctx-doc-info { flex: 1; min-width: 0; }
.ctx-doc-name { font-size: 12px; font-family: var(--mono); color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ctx-doc-lib { font-size: 10px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ctx-doc-rm {
  background: none; border: none; color: var(--muted); cursor: pointer; font-size: 14px;
  padding: 0; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;
  border-radius: 4px; flex-shrink: 0;
}
.ctx-doc-rm:hover { background: var(--red-glow); color: var(--red); }
.ctx-empty { padding: 20px; text-align: center; color: var(--muted); font-size: 12px; line-height: 1.6; }
.ctx-add-from-find {
  margin: 8px; padding: 8px; border-radius: 8px; border: 1px dashed var(--border);
  background: none; color: var(--muted); font-size: 12px; cursor: pointer; text-align: center;
  transition: all 0.15s; flex-shrink: 0;
}
.ctx-add-from-find:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-glow); }
.ctx-chat-btn {
  margin: 8px; padding: 9px; border-radius: 10px;
  background: var(--accent); color: #fff; border: none;
  font-size: 13px; font-weight: 600; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  transition: opacity 0.15s; flex-shrink: 0;
}
.ctx-chat-btn:hover { opacity: 0.85; }
.ctx-chat-btn:disabled { opacity: 0.35; cursor: default; }
.pub-modal-bg {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 200;
  display: none; align-items: center; justify-content: center;
}
.pub-modal-bg.open { display: flex; }
.pub-modal {
  background: var(--surface); border: 1px solid var(--border); border-radius: 16px;
  padding: 24px; width: 420px; max-width: 90vw;
}
.pub-modal h3 { font-size: 16px; margin-bottom: 16px; }
.pub-modal label { font-size: 12px; color: var(--muted); display: block; margin-bottom: 4px; }
.pub-modal select, .pub-modal input {
  width: 100%; background: var(--surface2); border: 1px solid var(--border); border-radius: 8px;
  padding: 8px 10px; color: var(--text); font-size: 13px; outline: none; margin-bottom: 12px;
}
.pub-modal select:focus, .pub-modal input:focus { border-color: var(--accent); }
.pub-modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
.pub-modal-actions button {
  padding: 7px 16px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; border: none;
}
.pub-cancel { background: var(--surface2); color: var(--muted); }
.pub-cancel:hover { color: var(--text); }
.pub-confirm { background: var(--accent); color: #fff; }
.pub-confirm:hover { opacity: 0.85; }
.cite-chip {
  display: inline-flex; align-items: center;
  padding: 1px 7px; border-radius: 6px;
  border: 1px solid var(--accent-dim); background: var(--accent-glow);
  color: var(--accent); font-size: 11px; font-family: var(--mono);
  cursor: pointer; white-space: nowrap; vertical-align: middle;
  transition: background 0.15s, border-color 0.15s;
}
.cite-chip:hover { background: var(--accent-glow2); border-color: var(--accent); }
.doc-drawer-bg {
  position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 350;
  display: none; align-items: center; justify-content: center;
}
.doc-drawer-bg.open { display: flex; }
.doc-drawer {
  width: 90vw; max-width: 960px; max-height: 90vh; background: var(--surface);
  border: 1px solid var(--border); border-radius: 14px;
  display: flex; flex-direction: column; overflow: hidden;
}
.doc-drawer-header {
  display: flex; align-items: center; padding: 14px 16px;
  border-bottom: 1px solid var(--border); flex-shrink: 0; gap: 12px;
}
.doc-drawer-title {
  flex: 1; font-size: 12px; font-family: var(--mono); color: var(--accent);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.doc-drawer-author { font-size: 12px; color: var(--muted); white-space: nowrap; flex-shrink: 0; }
.doc-drawer-author[hidden] { display: none; }
.doc-drawer-close {
  background: none; border: none; color: var(--muted); cursor: pointer;
  font-size: 16px; padding: 0; width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center; border-radius: 4px;
  flex-shrink: 0;
}
.doc-drawer-close:hover { background: var(--surface2); color: var(--text); }
.doc-drawer-body {
  flex: 1; overflow-y: auto; padding: 16px 20px;
  font-size: 13px; line-height: 1.7; color: var(--text);
}
.doc-drawer-body::-webkit-scrollbar { width: 4px; }
.doc-drawer-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
#findGroups { display: none; }
.ctx-limit { margin: 8px 12px 0; padding: 6px 10px; border-radius: 6px; font-size: 12px; color: var(--orange); background: var(--orange-glow); }
.ctx-limit[hidden] { display: none; }
`;

// An untagged template: a regex escape in it must be doubled (`\\b\\w` ships as `\b\w`);
// src/__tests__/ui/chat-regex.test.ts runs the shipped regexes.
export const CHAT_JS = `/* ── Sign-in: a 401 from the API (no or expired session) goes to the sign-in page ── */
function loginUrl() {
  return '/login?returnTo=' + encodeURIComponent(location.pathname + location.search);
}
(function() {
  var origFetch = window.fetch.bind(window);
  window.fetch = function(input) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var path = url.indexOf(location.origin) === 0 ? url.slice(location.origin.length) : url;
    return origFetch.apply(null, arguments).then(function(res) {
      // /api/auth/* answers 401 by design (who am I, sign-in); everything else means "sign in first"
      if (res.status === 401 && path.indexOf('/api/') === 0 && path.indexOf('/api/auth/') !== 0) location = loginUrl();
      return res;
    });
  };
})();

/* ── User menu: who is signed in, and sign out ── */
(function() {
  fetch('/api/auth/me', { credentials: 'same-origin' }).then(function(res) {
    return res.ok ? res.json() : null;
  }).then(function(me) {
    if (!me) return;
    var name = document.getElementById('userName');
    name.textContent = me.kind === 'user' ? (me.display_name || me.login) : 'admin key';
    if (me.kind === 'user') name.title = me.login + ' (' + me.role + ')';
    // Tokens are managed by people signed in to the web UI
    document.getElementById('navTokens').hidden = me.kind !== 'user';
    if (me.role === 'admin') {
      document.getElementById('navUsers').hidden = false;
      document.getElementById('navNamespaces').hidden = false;
    }
    document.getElementById('userMenu').hidden = false;
  }).catch(function() {});
  document.getElementById('signOutBtn').addEventListener('click', function() {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).finally(function() {
      location = '/login';
    });
  });
})();

/* ── Constants ─────────────────────── */
var SERVICE_COLORS = ['#7c8aff','#f472b6','#4ade80','#fb923c','#38bdf8','#a78bfa','#34d399','#fbbf24'];
var CHECK_SVG = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';

/* The /api/chat limits (application/chat-request.ts): the request carries at most this many
   messages, characters of all messages together, and distinct pinned documents. */
var MAX_CHAT_MESSAGES = ${MAX_CHAT_MESSAGES};
var MAX_CHAT_CHARS = ${MAX_CHAT_CHARS};
var MAX_PINNED_DOCS = ${MAX_PINNED_DOCS};

/* ── State ──────────────────────────── */
var chatHistory = [];
var pinnedDocs = [];
var contextDocs = [];
var lastFindData = null;
var scopeFilters = [];
var services = [];
var currentSessionId = null;
var sessionsList = [];
var isStreaming = false;
var currentMode = 'qa';
/* Bumped whenever another chat is shown (opened, new, deleted): a stream or a session load
   started for an earlier view leaves the screen and the current chat alone. */
var viewGen = 0;

/* ── DOM refs ───────────────────────── */
var messagesEl   = document.getElementById('messages');
var inputEl      = document.getElementById('input');
var sendBtn      = document.getElementById('sendBtn');
var inputWrap    = document.getElementById('inputWrap');
var btnQA        = document.getElementById('btnQA');
var btnBS        = document.getElementById('btnBS');
var inputScopeHint = document.getElementById('inputScopeHint');
var sbList       = document.getElementById('sbList');
var scopeBtn     = document.getElementById('scopeBtn');
var scopeBtnLabel= document.getElementById('scopeBtnLabel');
var scopeDropdown= document.getElementById('scopeDropdown');
var activeFiltersEl = document.getElementById('activeFilters');
var publishBtn   = document.getElementById('publishBtn');
var pubModalBg   = document.getElementById('pubModalBg');
var pubConfirm   = document.getElementById('pubConfirm');
var pubCancel    = document.getElementById('pubCancel');
var emptyEl      = document.getElementById('empty');
var findEmpty    = document.getElementById('findEmpty');
var findGroups   = document.getElementById('findGroups');
var panelFind    = document.getElementById('panelFind');
var panelContext = document.getElementById('panelContext');
var tabFind      = document.getElementById('tabFind');
var tabContext   = document.getElementById('tabContext');
var ctxDocs      = document.getElementById('ctxDocs');
var ctxCount     = document.getElementById('ctxCount');
var ctxBadge     = document.getElementById('ctxBadge');
var ctxEmpty     = document.getElementById('ctxEmpty');
var ctxClear     = document.getElementById('ctxClear');
var ctxAddFromFind = document.getElementById('ctxAddFromFind');
var ctxChatBtn   = document.getElementById('ctxChatBtn');
var ctxLimit     = document.getElementById('ctxLimit');
var mermaidOverlay = document.getElementById('mermaidOverlay');
var mermaidOverlayContent = document.getElementById('mermaidOverlayContent');
var imgOverlay   = document.getElementById('imgOverlay');
var imgOverlayImg= document.getElementById('imgOverlayImg');
var docDrawerBg    = document.getElementById('docDrawerBg');
var docDrawerTitle = document.getElementById('docDrawerTitle');
var docDrawerBody  = document.getElementById('docDrawerBody');
var docDrawerAuthor = document.getElementById('docDrawerAuthor');
var docDrawerClose = document.getElementById('docDrawerClose');
var colContext        = document.getElementById('colContext');
var ctxResizeHandle  = document.getElementById('ctxResizeHandle');

/* ── Context panel resize ───────────── */
(function() {
  var isResizing = false;
  var savedWidth = localStorage.getItem('lore_ctx_width');
  if (savedWidth) { colContext.style.width = savedWidth; colContext.style.minWidth = savedWidth; }
  ctxResizeHandle.addEventListener('mousedown', function(e) {
    isResizing = true;
    ctxResizeHandle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  document.addEventListener('mousemove', function(e) {
    if (!isResizing) return;
    var rect = colContext.getBoundingClientRect();
    var newWidth = Math.round(rect.right - e.clientX);
    newWidth = Math.max(160, Math.min(600, newWidth));
    colContext.style.width = newWidth + 'px';
    colContext.style.minWidth = newWidth + 'px';
  });
  document.addEventListener('mouseup', function() {
    if (!isResizing) return;
    isResizing = false;
    ctxResizeHandle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem('lore_ctx_width', colContext.style.width);
  });
})();

/* ── Mode toggle ────────────────────── */
function setMode(mode) {
  currentMode = mode;
  if (mode === 'qa') {
    btnQA.classList.add('active-qa');
    btnQA.classList.remove('active-bs');
    btnBS.classList.remove('active-qa', 'active-bs');
    inputWrap.classList.remove('mode-brainstorm');
    sendBtn.classList.remove('mode-bs');
    inputEl.placeholder = 'Ask a question...';
  } else {
    btnBS.classList.add('active-bs');
    btnBS.classList.remove('active-qa');
    btnQA.classList.remove('active-qa', 'active-bs');
    inputWrap.classList.add('mode-brainstorm');
    sendBtn.classList.add('mode-bs');
    inputEl.placeholder = 'Develop an idea...';
  }
}
btnQA.addEventListener('click', function() { setMode('qa'); });
btnBS.addEventListener('click', function() { setMode('brainstorm'); });

/* ── Context panel tabs ─────────────── */
function switchCtxTab(tab) {
  tabFind.classList.toggle('active', tab === 'find');
  tabContext.classList.toggle('active', tab === 'context');
  panelFind.classList.toggle('active', tab === 'find');
  panelContext.classList.toggle('active', tab === 'context');
}
tabFind.addEventListener('click', function() { switchCtxTab('find'); });
tabContext.addEventListener('click', function() { switchCtxTab('context'); });

/* ── Context tab: manage docs ───────── */
function persistContextDocs() {
  if (!currentSessionId) return;
  fetch('/api/sessions/' + currentSessionId, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinned_docs: contextDocs.map(function(d) { return { slug: d.slug, library_id: d.library_id }; }) }),
  }).catch(function() {});
}

/* Pins a document; false when the context already holds MAX_PINNED_DOCS documents (the
   server answers more with 400), which the panel then says. */
function addToContext(doc) {
  var already = contextDocs.some(function(d) { return d.slug === doc.slug && d.library_id === doc.library_id; });
  if (already) return true;
  if (contextDocs.length >= MAX_PINNED_DOCS) {
    ctxLimit.textContent = 'At most ' + MAX_PINNED_DOCS + ' documents fit in the context. Remove one to add another.';
    ctxLimit.hidden = false;
    return false;
  }
  contextDocs.push(doc);
  pinnedDocs = contextDocs;
  updateContextPanel();
  updateFindCheckboxes();
  persistContextDocs();
  return true;
}

function removeFromContext(slug, library_id) {
  contextDocs = contextDocs.filter(function(d) { return !(d.slug === slug && d.library_id === library_id); });
  pinnedDocs = contextDocs;
  updateContextPanel();
  updateFindCheckboxes();
  persistContextDocs();
}

function updateContextPanel() {
  if (contextDocs.length < MAX_PINNED_DOCS) ctxLimit.hidden = true;
  ctxCount.textContent = contextDocs.length + ' document' + (contextDocs.length !== 1 ? 's' : '');
  ctxBadge.textContent = contextDocs.length > 0 ? ' (' + contextDocs.length + ')' : '';
  ctxChatBtn.disabled = contextDocs.length === 0;
  Array.from(ctxDocs.querySelectorAll('.ctx-doc-card')).forEach(function(el) { el.remove(); });
  if (contextDocs.length === 0) {
    ctxEmpty.style.display = '';
    return;
  }
  ctxEmpty.style.display = 'none';
  contextDocs.forEach(function(doc) {
    var card = document.createElement('div');
    card.className = 'ctx-doc-card';
    var icon = document.createElement('span');
    icon.className = 'ctx-doc-icon';
    icon.textContent = '📄';
    var info = document.createElement('div');
    info.className = 'ctx-doc-info';
    var nameEl = document.createElement('div');
    nameEl.className = 'ctx-doc-name';
    nameEl.textContent = doc.slug.split('/').pop() || doc.slug;
    var libEl = document.createElement('div');
    libEl.className = 'ctx-doc-lib';
    libEl.textContent = doc.library_id;
    info.appendChild(nameEl);
    info.appendChild(libEl);
    var rm = document.createElement('button');
    rm.className = 'ctx-doc-rm';
    rm.textContent = '×';
    rm.setAttribute('title', 'Remove from context');
    (function(s, l) {
      rm.addEventListener('click', function() { removeFromContext(s, l); });
    })(doc.slug, doc.library_id);
    card.appendChild(icon);
    card.appendChild(info);
    card.appendChild(rm);
    ctxDocs.insertBefore(card, ctxEmpty);
  });
}

ctxClear.addEventListener('click', function() {
  contextDocs = [];
  pinnedDocs = [];
  updateContextPanel();
  updateFindCheckboxes();
  persistContextDocs();
});

ctxAddFromFind.addEventListener('click', function() { switchCtxTab('find'); });

ctxChatBtn.addEventListener('click', function() {
  if (contextDocs.length === 0) return;
  inputEl.focus();
});

/* ── Find panel ─────────────────────── */
function renderFindPanel(data) {
  lastFindData = data;
  findGroups.textContent = '';
  findEmpty.style.display = 'none';
  findGroups.style.display = 'block';
  if (!data.groups || data.groups.length === 0) {
    findEmpty.textContent = 'No results found.';
    findEmpty.style.display = 'flex';
    findGroups.style.display = 'none';
    return;
  }
  var maxScore = 0;
  data.groups.forEach(function(g) { g.results.forEach(function(r) { if ((r.score||0) > maxScore) maxScore = r.score; }); });
  data.groups.forEach(function(group) {
    var groupEl = document.createElement('div');
    groupEl.className = 'find-group';
    var color = getServiceColor(group.domain);
    var displayName = group.domain
      ? group.domain.replace(/[-_]/g, ' ').replace(/\\b\\w/g, function(c) { return c.toUpperCase(); })
      : 'Other';
    var header = document.createElement('div');
    header.className = 'find-group-header';
    var chevron = document.createElement('span');
    chevron.className = 'fg-chevron';
    chevron.textContent = '▶';
    var dot = document.createElement('span');
    dot.className = 'fg-dot';
    dot.style.background = color;
    var nameEl = document.createElement('span');
    nameEl.className = 'fg-name';
    nameEl.style.color = color;
    nameEl.textContent = displayName;
    var count = document.createElement('span');
    count.className = 'fg-count';
    var addAll = document.createElement('button');
    addAll.className = 'fg-add-all';
    addAll.textContent = '+ all';
    header.appendChild(chevron);
    header.appendChild(dot);
    header.appendChild(nameEl);
    header.appendChild(count);
    header.appendChild(addAll);
    header.addEventListener('click', function(e) {
      if (e.target === addAll) return;
      groupEl.classList.toggle('expanded');
    });
    var bySlug = {};
    group.results.forEach(function(r) {
      if (!bySlug[r.slug]) bySlug[r.slug] = [];
      bySlug[r.slug].push(r);
    });
    var slugs = Object.keys(bySlug);
    count.textContent = slugs.length;
    (function(slugList, slugMap) {
      addAll.addEventListener('click', function(e) {
        e.stopPropagation();
        slugList.forEach(function(slug) {
          var results = slugMap[slug];
          var best = results.reduce(function(a, b) { return (a.score || 0) >= (b.score || 0) ? a : b; });
          addToContext({ slug: best.slug, library_id: best.library_id, display_name: best.library_id + '.' + best.slug });
        });
        switchCtxTab('context');
      });
    })(slugs, bySlug);
    var docsEl = document.createElement('div');
    docsEl.className = 'find-group-docs';
    slugs.forEach(function(slug) {
      var results = bySlug[slug];
      var best = results.reduce(function(a, b) { return (a.score || 0) >= (b.score || 0) ? a : b; });
      var inCtx = contextDocs.some(function(d) { return d.slug === best.slug && d.library_id === best.library_id; });
      var row = document.createElement('div');
      row.className = 'find-doc';
      row.setAttribute('data-slug', slug);
      row.setAttribute('data-library-id', best.library_id);
      var cb = document.createElement('div');
      cb.className = 'doc-cb' + (inCtx ? ' checked' : '');
      var info = document.createElement('div');
      info.className = 'doc-info';
      var nameEl2 = document.createElement('div');
      nameEl2.className = 'doc-name';
      var lastPart = slug.split('/').pop() || slug;
      if (best.http_method) {
        var httpBadge = document.createElement('span');
        httpBadge.className = 'http-badge http-' + best.http_method.toLowerCase();
        httpBadge.textContent = best.http_method;
        nameEl2.appendChild(httpBadge);
      }
      nameEl2.appendChild(document.createTextNode(lastPart));
      var metaEl = document.createElement('div');
      metaEl.className = 'doc-meta';
      var slugParts = slug.split('/');
      if (best.route) {
        metaEl.textContent = best.route;
      } else if (slugParts.length > 1) {
        metaEl.textContent = slugParts.slice(0, -1).join(' / ');
      } else {
        metaEl.textContent = (best.entry_type || '') + (best.summary ? ' · ' + best.summary.slice(0, 80) : '');
      }
      var scoreBarWrap = document.createElement('div');
      scoreBarWrap.className = 'doc-score-bar';
      var scoreBarFill = document.createElement('div');
      scoreBarFill.className = 'doc-score-fill';
      var relScore = maxScore > 0 ? (best.score || 0) / maxScore : 0;
      scoreBarFill.style.width = Math.round(relScore * 100) + '%';
      scoreBarFill.style.background = relScore >= 0.75 ? 'var(--green)' : relScore >= 0.45 ? 'var(--orange)' : 'var(--muted)';
      scoreBarWrap.appendChild(scoreBarFill);
      info.appendChild(nameEl2);
      info.appendChild(metaEl);
      info.appendChild(scoreBarWrap);
      row.appendChild(cb);
      row.appendChild(info);
      if (results.length > 1) {
        var badge = document.createElement('span');
        badge.className = 'doc-dedup';
        badge.textContent = '×' + results.length + ' libs';
        var dedupExpanded = null;
        badge.addEventListener('click', function(e) {
          e.stopPropagation();
          if (dedupExpanded) { dedupExpanded.remove(); dedupExpanded = null; return; }
          dedupExpanded = document.createElement('div');
          dedupExpanded.className = 'dedup-expanded';
          results.forEach(function(lib) {
            var libRow = document.createElement('div');
            libRow.className = 'dedup-lib';
            var libName = document.createElement('span');
            libName.className = 'dedup-lib-name';
            libName.textContent = lib.library_id;
            var libAdd = document.createElement('button');
            var inCtxNow = contextDocs.some(function(d) { return d.slug === lib.slug && d.library_id === lib.library_id; });
            libAdd.className = 'dedup-lib-add' + (inCtxNow ? ' in-ctx' : '');
            libAdd.textContent = inCtxNow ? 'In context' : 'Add';
            (function(l) {
              libAdd.addEventListener('click', function() {
                if (!addToContext({ slug: l.slug, library_id: l.library_id, display_name: l.library_id + '.' + l.slug })) return;
                libAdd.className = 'dedup-lib-add in-ctx';
                libAdd.textContent = 'In context';
              });
            })(lib);
            libRow.appendChild(libName);
            libRow.appendChild(libAdd);
            dedupExpanded.appendChild(libRow);
          });
          row.parentNode.insertBefore(dedupExpanded, row.nextSibling);
        });
        row.appendChild(badge);
      }
      (function(r, cbEl) {
        cbEl.addEventListener('click', function(e) {
          e.stopPropagation();
          var idx = contextDocs.findIndex(function(d) { return d.slug === r.slug && d.library_id === r.library_id; });
          if (idx >= 0) { removeFromContext(r.slug, r.library_id); }
          else { addToContext({ slug: r.slug, library_id: r.library_id, display_name: r.library_id + '.' + r.slug }); }
        });
        row.addEventListener('click', function() { cbEl.click(); });
      })(best, cb);
      docsEl.appendChild(row);
    });
    groupEl.appendChild(header);
    groupEl.appendChild(docsEl);
    findGroups.appendChild(groupEl);
  });
}

function updateFindCheckboxes() {
  document.querySelectorAll('.find-doc').forEach(function(row) {
    var slug = row.getAttribute('data-slug');
    if (!slug) return;
    var cb = row.querySelector('.doc-cb');
    if (!cb) return;
    var libId = row.getAttribute('data-library-id');
    var inCtx = contextDocs.some(function(d) { return d.slug === slug && (!libId || d.library_id === libId); });
    cb.classList.toggle('checked', inCtx);
  });
}

/* ── Search notice in chat ──────────── */
function addSearchNotice() {
  removeEmpty();
  var notice = document.createElement('div');
  notice.className = 'search-notice';
  var dot = document.createElement('span');
  dot.className = 'sn-dot pulsing';
  var text = document.createElement('span');
  text.textContent = 'Searching...';
  var arrow = document.createElement('span');
  arrow.className = 'sn-arrow';
  arrow.textContent = '→';
  notice.appendChild(dot);
  notice.appendChild(text);
  notice.appendChild(arrow);
  messagesEl.appendChild(notice);
  scrollBottom();
  return { notice: notice, dot: dot, text: text };
}

function finalizeSearchNotice(noticeRef, count) {
  noticeRef.dot.classList.remove('pulsing');
  var countSpan = document.createElement('span');
  countSpan.className = 'sn-count';
  countSpan.textContent = count + ' docs';
  noticeRef.text.textContent = 'Found ';
  noticeRef.text.appendChild(countSpan);
  var panel = document.createTextNode(' → panel');
  noticeRef.text.appendChild(panel);
  noticeRef.notice.addEventListener('click', function() { switchCtxTab('find'); });
}

/* ── mermaid helper ─────────────────── */
marked.use({ breaks: true });
/* Diagram source comes from documents and LLM output: lock every styling/security key so
   %%{init}%% directives cannot change them (they are also stripped before rendering). */
mermaid.initialize({
  startOnLoad: false, theme: 'dark', securityLevel: 'strict', htmlLabels: false, flowchart: { htmlLabels: false },
  /* mermaid 12 defaults to the ELK layout and a new look; keep the dagre layout the styles are made for */
  layout: 'dagre', look: 'classic',
  secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'theme', 'themeCSS', 'themeVariables', 'fontFamily', 'altFontFamily', 'darkMode', 'htmlLabels', 'flowchart', 'dompurifyConfig', 'layout', 'look'],
});

function openMermaidOverlay(svgEl) {
  mermaidOverlayContent.textContent = '';
  var closeBtn = document.createElement('button');
  closeBtn.className = 'mermaid-overlay-close';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', function() { mermaidOverlay.classList.remove('open'); });
  mermaidOverlayContent.appendChild(closeBtn);
  var clone = svgEl.cloneNode(true);
  clone.style.maxWidth = '80vw';
  mermaidOverlayContent.appendChild(clone);
  mermaidOverlay.classList.add('open');
}
mermaidOverlay.addEventListener('click', function(e) {
  if (e.target === mermaidOverlay) mermaidOverlay.classList.remove('open');
});

async function renderMermaidBlocks(container) {
  var pres = container.querySelectorAll('pre code.language-mermaid');
  for (var i = 0; i < pres.length; i++) {
    var pre = pres[i].parentNode;
    var graphDef = loreCleanMermaidSource(pres[i].textContent);
    try {
      var id = 'mermaid-' + Date.now() + '-' + i;
      var rendered = await mermaid.render(id, graphDef);
      /* No <style> from rendered output ever reaches the page: diagrams are styled by
         the static rules in lore.css, and the CSP has no inline-style allowance. */
      var safeSvg = DOMPurify.sanitize(rendered.svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ['style'],
        FORBID_ATTR: ['style'],
        ADD_TAGS: ['text','tspan','textPath','foreignObject'],
        ADD_ATTR: ['dominant-baseline','text-anchor','font-size','font-family','font-weight','dy','dx','x','y','requiredExtensions'],
      });
      var div = document.createElement('div'); div.className = 'mermaid-diagram';
      var parser = new DOMParser();
      var svgDoc = parser.parseFromString(safeSvg, 'image/svg+xml');
      var svgEl = svgDoc.documentElement;
      svgEl.setAttribute('width', '100%'); svgEl.style.maxWidth = '';
      div.appendChild(svgEl);
      var expandBtn = document.createElement('button'); expandBtn.className = 'mermaid-expand'; expandBtn.textContent = '⤢ Expand';
      (function(s) {
        expandBtn.addEventListener('click', function(e) { e.stopPropagation(); openMermaidOverlay(s); });
        div.addEventListener('click', function() { openMermaidOverlay(s); });
      })(svgEl);
      div.appendChild(expandBtn);
      pre.parentNode.replaceChild(div, pre);
    } catch (err) { console.error('Mermaid error:', err); }
  }
}

/* ── image previews ─────────────────── */
function initImagePreviews(container) {
  container.querySelectorAll('img').forEach(function(img) {
    img.addEventListener('click', function() {
      imgOverlayImg.src = img.src;
      imgOverlay.classList.add('open');
    });
  });
}
imgOverlay.addEventListener('click', function() { imgOverlay.classList.remove('open'); });

/* ── Document drawer ────────────────── */
function openDocDrawer(libId, slug) {
  var dotName = libId + '.' + slug.replace(/\\//g, '.');
  docDrawerTitle.textContent = dotName;
  docDrawerAuthor.textContent = '';
  docDrawerAuthor.hidden = true;
  docDrawerBody.textContent = 'Loading…';
  docDrawerBg.classList.add('open');
  fetch('/api/document?library_id=' + encodeURIComponent(libId) + '&slug=' + encodeURIComponent(slug))
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function(doc) {
      /* Insights record who published them */
      if (doc.author && doc.author.name) {
        docDrawerAuthor.textContent = 'by ' + doc.author.name;
        docDrawerAuthor.hidden = false;
      }
      /* safeMarkdown runs DOMPurify — output is sanitized HTML */
      var sanitizedHtml = safeMarkdown(doc.content || '_No content_');
      docDrawerBody.innerHTML = sanitizedHtml;
      docDrawerBody.querySelectorAll('pre code:not(.language-mermaid)').forEach(function(el) { hljs.highlightElement(el); });
      renderMermaidBlocks(docDrawerBody);
      initImagePreviews(docDrawerBody);
    })
    .catch(function(err) {
      docDrawerBody.textContent = 'Failed to load document (' + err + ')';
    });
}
docDrawerClose.addEventListener('click', function() { docDrawerBg.classList.remove('open'); });
docDrawerBg.addEventListener('click', function(e) {
  if (e.target === docDrawerBg) docDrawerBg.classList.remove('open');
});

/* ── safeMarkdown: see chat-markdown.ts ── */
${CHAT_MARKDOWN_JS}

/* ── Service color ──────────────────── */
function getServiceColor(domain) {
  if (!domain) return 'var(--muted)';
  var hash = 0;
  for (var i = 0; i < domain.length; i++) hash = ((hash << 5) - hash) + domain.charCodeAt(i);
  return SERVICE_COLORS[Math.abs(hash) % SERVICE_COLORS.length];
}

/* ── Scope selector ─────────────────── */
scopeBtn.addEventListener('click', function() {
  scopeDropdown.classList.toggle('open');
  scopeBtn.classList.toggle('open');
  if (scopeDropdown.classList.contains('open')) {
    document.getElementById('scopeSearchInput').focus();
  }
});
document.addEventListener('click', function(e) {
  if (!document.getElementById('scopeSelector').contains(e.target)) {
    scopeDropdown.classList.remove('open');
    scopeBtn.classList.remove('open');
  }
});
document.getElementById('scopeSearchInput').addEventListener('input', renderScopeList);

function renderScopeList() {
  var list = document.getElementById('scopeList');
  var filter = (document.getElementById('scopeSearchInput').value || '').toLowerCase();
  list.textContent = '';
  var allItem = document.createElement('div');
  allItem.className = 'scope-item' + (scopeFilters.length === 0 ? ' active' : '');
  allItem.style.cssText = 'border-bottom:1px solid var(--border);margin-bottom:4px;padding-bottom:10px;';
  var allCheck = document.createElement('div'); allCheck.className = 'scope-check';
  if (scopeFilters.length === 0) allCheck.innerHTML = CHECK_SVG;
  var allName = document.createElement('span'); allName.className = 'scope-name';
  var allB = document.createElement('b'); allB.textContent = 'All services';
  allName.appendChild(allB);
  allItem.appendChild(allCheck); allItem.appendChild(allName);
  allItem.addEventListener('click', function() { scopeFilters = []; updateScopeUI(); });
  list.appendChild(allItem);
  var filtered = services.filter(function(s) { return !filter || s.display_name.toLowerCase().includes(filter) || s.id.toLowerCase().includes(filter); });
  filtered.forEach(function(s) {
    var isActive = scopeFilters.includes(s.id);
    var item = document.createElement('div');
    item.className = 'scope-item' + (isActive ? ' active' : '');
    var color = getServiceColor(s.id);
    var dot = document.createElement('div'); dot.className = 'scope-dot'; dot.style.background = color;
    var name = document.createElement('span'); name.className = 'scope-name'; name.textContent = s.display_name;
    var cnt = document.createElement('span'); cnt.className = 'scope-count'; cnt.textContent = s.doc_count;
    var check = document.createElement('div'); check.className = 'scope-check';
    if (isActive) check.innerHTML = CHECK_SVG;
    item.appendChild(dot); item.appendChild(name); item.appendChild(cnt); item.appendChild(check);
    (function(svc) {
      item.addEventListener('click', function() {
        var idx = scopeFilters.indexOf(svc.id);
        if (idx >= 0) scopeFilters.splice(idx, 1);
        else scopeFilters.push(svc.id);
        updateScopeUI();
      });
    })(s);
    list.appendChild(item);
  });
}

function updateScopeUI() {
  renderScopeList();
  if (scopeFilters.length === 0) {
    scopeBtnLabel.textContent = 'All services';
    scopeBtn.classList.remove('filtered');
  } else if (scopeFilters.length === 1) {
    scopeBtnLabel.textContent = scopeFilters[0];
    scopeBtn.classList.add('filtered');
  } else {
    scopeBtnLabel.textContent = scopeFilters.length + ' services';
    scopeBtn.classList.add('filtered');
  }
  activeFiltersEl.textContent = '';
  scopeFilters.forEach(function(f) {
    var pill = document.createElement('div');
    pill.className = 'active-filter';
    var color = getServiceColor(f);
    var gdot = document.createElement('span');
    gdot.style.cssText = 'width:6px;height:6px;border-radius:50%;background:' + color + ';display:inline-block';
    var fText = document.createTextNode(' ' + f + ' ');
    var xBtn = document.createElement('button'); xBtn.className = 'af-x'; xBtn.textContent = '✕';
    (function(fname) {
      xBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        var idx = scopeFilters.indexOf(fname);
        if (idx >= 0) scopeFilters.splice(idx, 1);
        updateScopeUI();
      });
    })(f);
    pill.appendChild(gdot); pill.appendChild(fText); pill.appendChild(xBtn);
    activeFiltersEl.appendChild(pill);
  });
  if (scopeFilters.length > 0) {
    inputScopeHint.classList.add('visible');
    document.getElementById('ishTag').textContent = scopeFilters.join(', ');
  } else {
    inputScopeHint.classList.remove('visible');
  }
}

/* ── Message helpers ────────────────── */
function removeEmpty() {
  if (emptyEl) { emptyEl.remove(); emptyEl = null; }
}

function addUserMessage(text) {
  removeEmpty();
  var d = document.createElement('div');
  d.className = 'msg user';
  var av = document.createElement('div'); av.className = 'avatar u'; av.textContent = 'You';
  var bbl = document.createElement('div'); bbl.className = 'bubble u'; bbl.textContent = text;
  d.appendChild(av); d.appendChild(bbl);
  messagesEl.appendChild(d);
  scrollBottom();
}

function addAssistantBubble(isBrainstorm) {
  removeEmpty();
  var d = document.createElement('div');
  d.className = 'msg';
  var av = document.createElement('div'); av.className = 'avatar a'; av.textContent = 'L';
  var bbl = document.createElement('div');
  bbl.className = 'bubble a' + (isBrainstorm ? ' brainstorm' : '');
  if (isBrainstorm) {
    var lbl = document.createElement('div'); lbl.className = 'bs-label';
    lbl.textContent = '💡 Brainstorm';
    bbl.appendChild(lbl);
  }
  d.appendChild(av); d.appendChild(bbl);
  messagesEl.appendChild(d);
  scrollBottom();
  return bbl;
}

function scrollBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/* ── Suggest chip click (delegated) ─── */
messagesEl.addEventListener('click', function(e) {
  var el = e.target.closest('.suggest-add:not(.added)');
  if (!el) return;
  var libId = el.getAttribute('data-lib');
  var slug = el.getAttribute('data-slug');
  if (!libId || !slug) return;
  if (!addToContext({ slug: slug, library_id: libId, display_name: libId + '.' + slug })) return;
  el.classList.add('added');
  el.textContent = '✓ ' + (slug.split('/').pop() || slug);
});

/* ── Cite chip click (delegated) ───── */
messagesEl.addEventListener('click', function(e) {
  var chip = e.target.closest('.cite-chip');
  if (!chip) return;
  var libId = chip.getAttribute('data-lib');
  var slug = chip.getAttribute('data-slug');
  if (libId && slug) openDocDrawer(libId, slug);
});

/* ── Suggestion chips in empty state ── */
document.querySelectorAll('.suggestion').forEach(function(el) {
  el.addEventListener('click', function() {
    inputEl.value = el.textContent.trim();
    inputEl.dispatchEvent(new Event('input'));
    handleSend();
  });
});

/* ── Streaming chat ─────────────────── */
/* The most recent messages that fit the /api/chat limits, oldest dropped first. The latest
   message (the question being asked) is always sent; the whole history stays on screen. */
function recentHistory(history) {
  var out = [];
  var chars = 0;
  for (var i = history.length - 1; i >= 0 && out.length < MAX_CHAT_MESSAGES; i--) {
    var len = history[i].content.length;
    if (out.length > 0 && chars + len > MAX_CHAT_CHARS) break;
    out.unshift(history[i]);
    chars += len;
  }
  return out;
}

/* The error text of a failed /api/chat response ({ error } or { message }), else its status. */
async function responseError(res) {
  var text = 'HTTP ' + res.status;
  try {
    var data = await res.json();
    if (data && typeof data.error === 'string') text = data.error;
    else if (data && typeof data.message === 'string') text = data.message;
  } catch (_) {}
  return text;
}

async function streamChat(text) {
  isStreaming = true;
  sendBtn.disabled = true;
  /* The chat this answer belongs to, even if another one is opened while it streams */
  var sessionId = currentSessionId;
  var history = chatHistory;
  var gen = viewGen;
  function onScreen() { return gen === viewGen; }
  var bubble = null;
  var cursor = null;
  var rawText = '';
  var toolIndicator = null;
  var noticeRef = null;
  var isBrainstorm = currentMode === 'brainstorm';
  var lastSearchData = null;
  var fetchedDocs = [];
  /* The Sources footer; kept apart so the final re-render of the answer can put it back. */
  var sourcesFooter = null;

  function ensureBubble() {
    if (!bubble) {
      bubble = addAssistantBubble(isBrainstorm);
      cursor = document.createElement('span');
      cursor.className = 'cursor';
      bubble.appendChild(cursor);
    }
    return bubble;
  }

  try {
    var body = { messages: recentHistory(history), mode: currentMode };
    if (pinnedDocs.length > 0) {
      body.pinned_docs = pinnedDocs.slice(0, MAX_PINNED_DOCS).map(function(d) { return { slug: d.slug, library_id: d.library_id }; });
    }
    if (scopeFilters.length > 0) {
      body.library_ids = scopeFilters.slice();
    }
    var res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      /* The server says why (too long a chat, too many pinned documents, ...): show that */
      var failure = new Error(await responseError(res));
      failure.fromServer = true;
      throw failure;
    }
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buf = '';
    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      var lines = buf.split('\\n');
      buf = lines.pop();
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        try {
          var evt = JSON.parse(line);
          if (!onScreen()) {
            /* Another chat is shown: only collect the answer, to save it into its own chat */
            if (evt.type === 'text') rawText += evt.content;
            else if (evt.type === 'search_results' && evt.data) lastSearchData = evt.data;
            continue;
          }
          if (evt.type === 'tool' && evt.name === 'search_lore') {
            if (!noticeRef) noticeRef = addSearchNotice();
          } else if (evt.type === 'search_results') {
            if (!noticeRef) noticeRef = addSearchNotice();
            if (evt.data) { lastSearchData = evt.data; renderFindPanel(evt.data); }
            finalizeSearchNotice(noticeRef, evt.data ? (evt.data.total || 0) : 0);
          } else if (evt.type === 'text') {
            rawText += evt.content;
            var b = ensureBubble();
            if (toolIndicator) { toolIndicator.remove(); toolIndicator = null; }
            if (isBrainstorm) {
              var lbl2 = b.querySelector('.bs-label');
              b.textContent = '';
              if (lbl2) b.appendChild(lbl2);
            } else {
              b.textContent = '';
            }
            b.innerHTML = (isBrainstorm && b.querySelector('.bs-label') ? b.querySelector('.bs-label').outerHTML : '') + safeMarkdown(rawText);
            if (isBrainstorm) {
              var lbl3 = b.querySelector('.bs-label');
              if (!lbl3) { var newLbl = document.createElement('div'); newLbl.className = 'bs-label'; newLbl.textContent = '💡 Brainstorm'; b.insertBefore(newLbl, b.firstChild); }
            }
            cursor = document.createElement('span');
            cursor.className = 'cursor';
            b.appendChild(cursor);
            scrollBottom();
          } else if (evt.type === 'tool') {
            var b2 = ensureBubble();
            if (evt.name === 'get_document' && evt.query) {
              if (evt.library_id) fetchedDocs.push({ slug: evt.query, library_id: evt.library_id });
              if (toolIndicator) {
                var tspanUpd = toolIndicator.querySelector('span');
                if (tspanUpd) tspanUpd.textContent = 'Reading ' + evt.query + '…';
              } else {
                toolIndicator = document.createElement('div');
                toolIndicator.className = 'tool-indicator';
                var tdot = document.createElement('div'); tdot.className = 'tool-dot';
                var tspan = document.createElement('span'); tspan.textContent = 'Reading ' + evt.query + '…';
                toolIndicator.appendChild(tdot); toolIndicator.appendChild(tspan);
                b2.appendChild(toolIndicator);
              }
            } else if (!toolIndicator) {
              toolIndicator = document.createElement('div');
              toolIndicator.className = 'tool-indicator';
              var tdot2 = document.createElement('div'); tdot2.className = 'tool-dot';
              var tspan2 = document.createElement('span'); tspan2.textContent = 'Searching documentation…';
              toolIndicator.appendChild(tdot2); toolIndicator.appendChild(tspan2);
              b2.appendChild(toolIndicator);
            }
          } else if (evt.type === 'sources' && evt.docs && evt.docs.length > 0) {
            var srcBubble = ensureBubble();
            var footer = document.createElement('div');
            footer.className = 'retrieved-footer';
            var lbl = document.createElement('span');
            lbl.className = 'retrieved-label';
            lbl.textContent = 'Sources:';
            footer.appendChild(lbl);
            evt.docs.forEach(function(d) {
              var parts = d.slug.split('/');
              var dotName = d.library_id + '.' + parts.join('.');
              var chip = document.createElement('span');
              chip.className = 'cite-chip';
              chip.dataset.lib = d.library_id;
              chip.dataset.slug = d.slug;
              chip.textContent = dotName + ' →';
              footer.appendChild(chip);
            });
            sourcesFooter = footer;
            srcBubble.appendChild(footer);
          } else if (evt.type === 'done') {
            if (bubble) {
              var finalHtml = safeMarkdown(rawText || '_No response_');
              if (isBrainstorm) {
                bubble.innerHTML = '<div class="bs-label">💡 Brainstorm</div>' + finalHtml;
              } else {
                bubble.innerHTML = finalHtml;
              }
              bubble.querySelectorAll('pre code:not(.language-mermaid)').forEach(function(el) { hljs.highlightElement(el); });
              renderMermaidBlocks(bubble);
              initImagePreviews(bubble);
              if (sourcesFooter) bubble.appendChild(sourcesFooter);
            }
          } else if (evt.type === 'error') {
            var eb = ensureBubble();
            var errSpan = document.createElement('span');
            errSpan.style.color = 'var(--red)';
            errSpan.textContent = 'Error: ' + evt.message;
            eb.appendChild(errSpan);
          }
        } catch (_) {}
      }
    }
  } catch (e) {
    if (onScreen()) {
      var eb2 = ensureBubble();
      var errSpan2 = document.createElement('span');
      errSpan2.style.color = 'var(--red)';
      errSpan2.textContent = e && e.fromServer ? 'Error: ' + e.message : 'Connection error: ' + String(e);
      eb2.appendChild(errSpan2);
    }
  }
  if (rawText) {
    history.push({ role: 'assistant', content: rawText });
    var meta = {};
    if (isBrainstorm) meta.mode = 'brainstorm';
    if (lastSearchData) meta.search_results = lastSearchData;
    var saving = saveMessage('assistant', rawText, Object.keys(meta).length ? meta : null, sessionId);
    if (!onScreen() && sessionId && currentSessionId === sessionId) {
      /* The chat was left and opened again while the answer streamed: it was loaded from the
         server without the answer, so load it again once the answer is saved. */
      await saving;
      if (currentSessionId === sessionId) await loadSession({ id: sessionId });
    }
  }
  isStreaming = false;
  sendBtn.disabled = !inputEl.value.trim();
  inputEl.focus();
}

/* ── Input handling ─────────────────── */
inputEl.addEventListener('input', function() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
  sendBtn.disabled = !inputEl.value.trim() || isStreaming;
});
inputEl.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
});
sendBtn.addEventListener('click', handleSend);

async function handleSend() {
  var text = inputEl.value.trim();
  if (!text || isStreaming) return;
  inputEl.value = '';
  inputEl.style.height = 'auto';
  sendBtn.disabled = true;
  await ensureSession();
  var scopeMatch = text.match(/^in:(\\S+)\\s+(.+)$/i);
  if (scopeMatch) {
    var svc = scopeMatch[1];
    var q = scopeMatch[2];
    if (svc && !scopeFilters.includes(svc)) { scopeFilters.push(svc); updateScopeUI(); }
    text = q;
  }
  addUserMessage(text);
  chatHistory.push({ role: 'user', content: text });
  saveMessage('user', text);
  await streamChat(text);
}

/* ── Session management ─────────────── */
async function ensureSession() {
  if (currentSessionId) return currentSessionId;
  try {
    var res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned_docs: pinnedDocs, scope_filters: scopeFilters }),
    });
    if (!res.ok) return null;
    var session = await res.json();
    currentSessionId = session.id;
    publishBtn.disabled = false;
    await loadSessions();
    return currentSessionId;
  } catch (e) { return null; }
}

async function saveMessage(role, content, metadata, sessionId) {
  sessionId = sessionId || currentSessionId;
  if (!sessionId) return;
  try {
    await fetch('/api/sessions/' + sessionId + '/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: role, content: content, metadata: metadata || null }),
    });
    if (role === 'user') loadSessions();
  } catch (e) {}
}

async function loadSessions() {
  try {
    var res = await fetch('/api/sessions');
    if (!res.ok) return;
    sessionsList = await res.json();
    renderSidebar();
  } catch (e) {}
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  var d = new Date(dateStr); var now = new Date();
  var diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff/60) + 'm ago';
  if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
  return Math.floor(diff/86400) + 'd ago';
}

function renderSidebar() {
  sbList.textContent = '';
  if (sessionsList.length === 0) {
    var emp = document.createElement('div'); emp.className = 'sb-empty'; emp.textContent = 'No chats yet';
    sbList.appendChild(emp);
    return;
  }
  sessionsList.forEach(function(s) {
    var item = document.createElement('div');
    item.className = 'sb-item' + (s.id === currentSessionId ? ' active' : '');
    var titleEl = document.createElement('div'); titleEl.className = 'sb-item-title'; titleEl.textContent = s.title || 'New chat';
    var meta = document.createElement('div'); meta.className = 'sb-item-meta';
    if (s.is_published) { var pub = document.createElement('div'); pub.className = 'sb-item-published'; pub.textContent = 'published'; meta.appendChild(pub); }
    var ago = document.createElement('span'); ago.textContent = timeAgo(s.updated_at);
    meta.appendChild(ago);
    var delBtn = document.createElement('button'); delBtn.className = 'sb-item-del'; delBtn.textContent = '✕'; delBtn.title = 'Delete';
    (function(sid) {
      delBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (!confirm('Delete this chat?')) return;
        fetch('/api/sessions/' + sid, { method: 'DELETE' }).then(function() { loadSessions(); });
        if (sid === currentSessionId) {
          viewGen++;
          currentSessionId = null; chatHistory = []; contextDocs = []; pinnedDocs = [];
          messagesEl.textContent = '';
          updateContextPanel();
          var empty = document.createElement('div'); empty.id = 'empty';
          empty.innerHTML = '<h2>Ask Lore</h2>';
          emptyEl = empty;
          messagesEl.appendChild(empty);
        }
      });
    })(s.id);
    item.appendChild(titleEl);
    item.appendChild(meta);
    item.appendChild(delBtn);
    (function(session) {
      item.addEventListener('click', function() { loadSession(session); });
    })(s);
    sbList.appendChild(item);
  });
}

async function loadSession(session) {
  var gen = ++viewGen;
  currentSessionId = session.id;
  chatHistory = [];
  contextDocs = [];
  pinnedDocs = [];
  messagesEl.textContent = '';
  updateContextPanel();
  renderSidebar();
  try {
    var res = await fetch('/api/sessions/' + session.id);
    if (gen !== viewGen || !res.ok) return;
    var data = await res.json();
    /* Another chat was opened meanwhile: its view and pinned documents stay as they are */
    if (gen !== viewGen) return;
    var msgs = data.messages || [];
    var lastSearchResults = null;
    msgs.forEach(function(m) {
      if (m.role === 'user') {
        chatHistory.push({ role: 'user', content: m.content });
        addUserMessage(m.content);
      } else if (m.role === 'assistant') {
        chatHistory.push({ role: 'assistant', content: m.content });
        var meta = m.metadata || {};
        var isBs = meta.mode === 'brainstorm';
        var bbl = addAssistantBubble(isBs);
        bbl.innerHTML = safeMarkdown(m.content);
        bbl.querySelectorAll('pre code:not(.language-mermaid)').forEach(function(el) { hljs.highlightElement(el); });
        renderMermaidBlocks(bbl);
        initImagePreviews(bbl);
        if (meta.search_results) lastSearchResults = meta.search_results;
      } else if (m.role === 'search' && m.metadata && m.metadata.data) {
        lastSearchResults = m.metadata.data;
      }
    });
    if (lastSearchResults) renderFindPanel(lastSearchResults);
    publishBtn.disabled = false;
    if (data.scope_filters && data.scope_filters.length > 0) {
      scopeFilters = data.scope_filters.slice();
      updateScopeUI();
    }
    if (data.pinned_docs && data.pinned_docs.length > 0) {
      data.pinned_docs.forEach(function(d) {
        addToContext({ slug: d.slug, library_id: d.library_id, display_name: d.library_id + '.' + d.slug });
      });
    }
  } catch (e) {}
}

document.getElementById('newChatBtn').addEventListener('click', function() {
  viewGen++;
  currentSessionId = null;
  chatHistory = [];
  contextDocs = [];
  pinnedDocs = [];
  messagesEl.textContent = '';
  updateContextPanel();
  var empty = document.createElement('div');
  empty.id = 'empty';
  emptyEl = empty;
  messagesEl.appendChild(empty);
  publishBtn.disabled = true;
  renderSidebar();
  inputEl.focus();
});

/* ── Publish modal ──────────────────── */
publishBtn.addEventListener('click', async function() {
  if (!currentSessionId) return;
  try {
    var libRes = await fetch('/api/libraries');
    if (libRes.ok) {
      var libs = await libRes.json();
      var sel = document.getElementById('pubLibrary');
      sel.textContent = '';
      var none = document.createElement('option'); none.value = ''; none.textContent = '(none)';
      sel.appendChild(none);
      libs.forEach(function(l) {
        if (l.id === 'insights') return;
        var opt = document.createElement('option'); opt.value = l.id; opt.textContent = l.display_name || l.id;
        sel.appendChild(opt);
      });
    }
  } catch (e) {}
  pubModalBg.classList.add('open');
});

pubCancel.addEventListener('click', function() { pubModalBg.classList.remove('open'); });
pubModalBg.addEventListener('click', function(e) { if (e.target === pubModalBg) pubModalBg.classList.remove('open'); });

pubConfirm.addEventListener('click', async function() {
  var slug = document.getElementById('pubSlug').value.trim();
  var title = document.getElementById('pubTitle').value.trim();
  var library_id = document.getElementById('pubLibrary').value;
  if (!title) { alert('Fill in a title'); return; }
  pubConfirm.disabled = true; pubConfirm.textContent = 'Publishing...';
  try {
    var res = await fetch('/api/sessions/' + currentSessionId + '/publish', {
      method: 'POST',
      // Signed in with the session cookie; the server derives the slug unless an admin picks one.
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(Object.assign({ title: title }, slug ? { slug: slug } : {}, library_id ? { library_id: library_id } : {})),
    });
    if (res.ok) {
      var data = await res.json();
      pubModalBg.classList.remove('open');
      var bbl = addAssistantBubble(false);
      var pubMsg = '\\u2705 **Published as insight!** Document: ' + data.library_id + '/' + data.slug + '\\n\\nTitle: ' + data.title;
      bbl.innerHTML = safeMarkdown(pubMsg);
      scrollBottom();
      await loadSessions();
    } else {
      var err = await res.json();
      alert('Publish failed: ' + (err.error || 'unknown'));
    }
  } catch (e) { alert('Publish error: ' + e); }
  pubConfirm.disabled = false; pubConfirm.textContent = 'Publish';
});

/* ── Init ───────────────────────────── */
fetch('/api/services').then(function(r) { return r.ok ? r.json() : []; }).then(function(data) {
  services = data; renderScopeList();
}).catch(function() { services = []; renderScopeList(); });

loadSessions();
`;
