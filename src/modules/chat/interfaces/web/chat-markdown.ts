/**
 * Client-side Markdown rendering for the chat UI, shipped as a plain script
 * string so it can be embedded into the page and unit-tested in jsdom.
 *
 * Security model: Markdown is rendered by `marked`, sanitized by DOMPurify into
 * a DOM fragment, and only then are Lore markers ([ref:...], [suggest:...],
 * **library.slug** names) turned into chips — using DOM APIs (createElement,
 * setAttribute, textContent), never by concatenating HTML strings. Marker
 * values that do not look like library ids/slugs are left as plain text.
 *
 * Requires globals: marked, DOMPurify, document; optional `contextDocs` array.
 * Keep this script free of backticks and "${" (it is embedded in a template).
 */
export const CHAT_MARKDOWN_JS = String.raw`
var LORE_LIB_RE = /^[a-z0-9][a-z0-9_-]*$/i;
var LORE_SLUG_RE = /^[a-z0-9][a-z0-9_.\/-]*$/i;
var LORE_MARKER_RE = /\[(ref|suggest):([^\]\s]+)\]/g;
var LORE_NAME_RE = /^([a-z][a-z0-9-]+)((?:\.[a-z][a-z0-9-]+)+)$/;

function escapeHtml(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function loreIsValidRef(libId, slug) {
  return LORE_LIB_RE.test(libId) && LORE_SLUG_RE.test(slug) && slug.indexOf('..') < 0;
}

function loreCiteChip(libId, slug, label) {
  var span = document.createElement('span');
  span.className = 'cite-chip';
  span.setAttribute('data-lib', libId);
  span.setAttribute('data-slug', slug);
  span.textContent = label + ' →';
  return span;
}

function loreSuggestChip(libId, slug) {
  var short = slug.split('/').pop() || slug;
  var docs = (typeof contextDocs !== 'undefined' && contextDocs) ? contextDocs : [];
  var already = docs.some(function(d) { return d.slug === slug && d.library_id === libId; });
  var span = document.createElement('span');
  if (already) {
    span.className = 'suggest-add added';
    span.textContent = '✓ ' + short;
    return span;
  }
  span.className = 'suggest-add';
  span.setAttribute('data-lib', libId);
  span.setAttribute('data-slug', slug);
  var plus = document.createElement('span');
  plus.className = 'plus';
  plus.textContent = '+';
  span.appendChild(plus);
  span.appendChild(document.createTextNode(' ' + short));
  return span;
}

/* Returns a DOM node for one marker, or null to keep the original text. */
function loreMarkerNode(kind, ref) {
  if (kind === 'ref') {
    var slashIdx = ref.indexOf('/');
    if (slashIdx < 0) return document.createTextNode('');
    var libId = ref.substring(0, slashIdx);
    var slug = ref.substring(slashIdx + 1);
    if (!loreIsValidRef(libId, slug)) return null;
    return loreCiteChip(libId, slug, libId + '.' + slug.replace(/\//g, '.'));
  }
  var dotIdx = ref.indexOf('.');
  if (dotIdx < 0) return document.createTextNode(ref);
  var sLib = ref.substring(0, dotIdx);
  var sSlug = ref.substring(dotIdx + 1);
  if (!loreIsValidRef(sLib, sSlug)) return null;
  return loreSuggestChip(sLib, sSlug);
}

function loreReplaceMarkers(root) {
  var walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  var textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach(function(node) {
    if (node.parentNode && node.parentNode.closest && node.parentNode.closest('code, pre')) return;
    var text = node.nodeValue;
    LORE_MARKER_RE.lastIndex = 0;
    if (!LORE_MARKER_RE.test(text)) return;
    LORE_MARKER_RE.lastIndex = 0;
    var frag = document.createDocumentFragment();
    var last = 0;
    var m;
    while ((m = LORE_MARKER_RE.exec(text)) !== null) {
      var replacement = loreMarkerNode(m[1], m[2]);
      if (!replacement) continue;
      frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      frag.appendChild(replacement);
      last = m.index + m[0].length;
    }
    frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  });
}

/* **library.some.slug** in answers becomes a citation chip */
function loreReplaceStrongNames(root) {
  Array.prototype.slice.call(root.querySelectorAll('strong')).forEach(function(el) {
    if (el.children.length > 0) return;
    var name = el.textContent || '';
    var m = name.match(LORE_NAME_RE);
    if (!m) return;
    var libId = m[1];
    var slug = m[2].substring(1).replace(/\./g, '/');
    el.parentNode.replaceChild(loreCiteChip(libId, slug, name), el);
  });
}

/* Rewrite absolute image URLs that point at a Lore server to same-origin /static paths */
function loreRewriteImages(root) {
  Array.prototype.slice.call(root.querySelectorAll('img[src]')).forEach(function(img) {
    var src = img.getAttribute('src') || '';
    var abs = src.match(/^https?:\/\/[a-z]+\.libraries\.([^\/]+)(\/versions\/.+)$/);
    if (abs) { img.setAttribute('src', '/static/libraries/' + abs[1] + abs[2]); return; }
    var hosted = src.match(/^https?:\/\/[^\/]+(\/static\/libraries\/.+)$/);
    if (hosted) img.setAttribute('src', hosted[1]);
  });
}

/* Remove mermaid directives (%%{init: ...}%% and friends) and front-matter config from
   untrusted diagram source; they can change theme CSS, fonts and security settings. */
function loreCleanMermaidSource(src) {
  var text = String(src || '');
  text = text.replace(/^\s*---[\s\S]*?\n---\s*\n/, '');
  return text.replace(/%%\{[\s\S]*?\}%%/g, '');
}

function safeMarkdown(text) {
  /* Convert raw <img> tags to Markdown so marked + DOMPurify handle them uniformly. A tag ends
     at the next < as well as at >, so unterminated <img tokens cannot make this quadratic. */
  var preprocessed = (text || '').replace(/<img\b([^<>]*)>/gi, function(_, attrs) {
    var srcMatch = attrs.match(/\bsrc="([^"]*)"/);
    var altMatch = attrs.match(/\balt="([^"]*)"/);
    if (!srcMatch) return '';
    return '![' + (altMatch ? altMatch[1] : '') + '](' + srcMatch[1] + ')';
  });
  var result = marked.parse(preprocessed);
  var html = typeof result === 'string' ? result : '';
  var fragment = DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true });
  loreRewriteImages(fragment);
  loreReplaceMarkers(fragment);
  loreReplaceStrongNames(fragment);
  var box = document.createElement('div');
  box.appendChild(fragment);
  return box.innerHTML;
}
`;
