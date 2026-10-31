/**
 * Stylesheet additions and script of the account pages, served same-origin as part of
 * `/assets/lore.css` and as `/assets/account.js` (strict CSP: no inline code). The script uses
 * DOM APIs only and never writes data with innerHTML.
 */
export const ACCOUNT_CSS = `
.account-login .pub-modal { width: 360px; }
.account-page { max-width: 880px; margin: 0 auto; padding: 32px 20px; color: var(--text); }
.account-page h1 { font-size: 20px; margin: 0 0 6px; }
.account-page .account-back { color: var(--text-dim); font-size: 12px; text-decoration: none; }
.account-page .account-back:hover { color: var(--accent); }
.account-page .account-hint { color: var(--text-dim); font-size: 13px; margin: 0 0 20px; }
.account-form { display: flex; gap: 8px; margin: 16px 0; }
.account-form input {
  flex: 1; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border);
  background: var(--surface2); color: var(--text); font-size: 13px;
}
.account-page button {
  padding: 7px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface2);
  color: var(--text); font-size: 12px; cursor: pointer;
}
.account-page button:hover { border-color: var(--accent); color: var(--accent); }
.account-page button:disabled { opacity: 0.4; cursor: default; }
.account-error { color: var(--red, #f87171); font-size: 13px; }
.token-created {
  border: 1px solid var(--accent-dim, var(--border)); border-radius: 10px; padding: 14px; margin: 16px 0;
  background: var(--surface);
}
.token-created p { margin: 0 0 8px; font-size: 13px; }
.token-secret { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 10px; }
.token-secret code {
  flex: 1; padding: 8px 10px; border-radius: 8px; background: var(--surface2); font-size: 12px;
  word-break: break-all; user-select: all;
}
.token-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 12px; }
.token-table th, .token-table td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--border); }
.token-table th { color: var(--text-dim); font-weight: 500; font-size: 12px; }
.token-table tr.revoked td { color: var(--text-dim); }
.token-table code { font-size: 12px; }
.account-page h2 { font-size: 15px; margin: 28px 0 10px; }
.account-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.account-table th, .account-table td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--border); vertical-align: top; }
.account-table th { color: var(--muted); font-weight: 500; font-size: 12px; }
.account-form select {
  padding: 6px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface2);
  color: var(--text); font-size: 13px;
}
#namespaceForm, #assignForm, #keyForm, #userForm { flex-wrap: wrap; align-items: center; margin-top: 10px; }
.account-note { font-size: 12px; color: var(--muted); }
.account-secret {
  margin-top: 10px; padding: 10px; border-radius: 8px; border: 1px solid var(--accent); background: var(--surface2);
  font-family: ui-monospace, monospace; font-size: 12px; word-break: break-all;
}
.account-tag { font-size: 11px; color: var(--muted); border: 1px solid var(--border); border-radius: 6px; padding: 1px 6px; margin-left: 6px; }
.account-login [hidden], .account-page [hidden] { display: none !important; }
.account-login .sso-button { display: inline-block; text-decoration: none; text-align: center; }
.cli-login .cli-login-code { font-family: monospace; font-size: 28px; letter-spacing: 4px; text-align: center; margin: 12px 0; }
.cli-login .cli-login-note { margin: 8px 0; line-height: 1.4; }
.cli-login [hidden] { display: none; }
.cli-login .cli-login-facts { margin: 8px 0; font-size: 13px; }
.cli-login .cli-login-facts dt { color: var(--text-dim); margin-top: 6px; }
.cli-login .cli-login-facts dd { margin: 2px 0 0; font-family: monospace; overflow-wrap: anywhere; }
`;

export const ACCOUNT_JS = `(function() {
  'use strict';

  /* Same rules as normalizeReturnTo on the server: a same-origin path, else '/'. */
  function normalizeReturnTo(raw) {
    if (typeof raw !== 'string' || raw.length > 512) return '/';
    if (raw.charAt(0) !== '/' || raw.indexOf('//') === 0 || raw.indexOf('/\\\\') === 0) return '/';
    for (var i = 0; i < raw.length; i++) {
      var c = raw.charCodeAt(i);
      if (c < 0x20 || c === 0x7f) return '/';
    }
    return raw;
  }

  function returnTo() {
    return normalizeReturnTo(new URLSearchParams(window.location.search).get('returnTo') || '/');
  }

  function showError(el, text) {
    el.textContent = text;
    el.hidden = false;
  }

  /* The fixed codes the single sign-on routes send back as ?loginError=. */
  var SSO_ERRORS = {
    invalid_state: 'The sign-in attempt expired or did not start in this browser. Try again.',
    not_allowed: 'Your account is not in a group that may use Lore. Ask an administrator for access.',
    disabled: 'Your account is disabled. Ask an administrator.',
    idp_unavailable: 'The identity provider is unavailable right now. Try again later.',
    rate_limited: 'Too many sign-in attempts. Try again in a few minutes.',
    internal: 'Sign-in failed. Try again.'
  };

  function showSso(sso, fields, button) {
    sso.href = '/api/auth/sso/login?returnTo=' + encodeURIComponent(returnTo());
    sso.hidden = false;
    fields.hidden = true;
    button.hidden = true;
    sso.focus();
  }

  function initLogin() {
    var form = document.getElementById('loginForm');
    var error = document.getElementById('loginError');
    var button = document.getElementById('loginBtn');
    var sso = document.getElementById('ssoBtn');
    var fields = document.getElementById('passwordFields');
    var ssoMode = false;

    var code = new URLSearchParams(window.location.search).get('loginError');
    if (code) showError(error, Object.prototype.hasOwnProperty.call(SSO_ERRORS, code) ? SSO_ERRORS[code] : SSO_ERRORS.internal);

    fetch('/api/auth/config', { credentials: 'same-origin' }).then(function(res) {
      return res.ok ? res.json() : null;
    }).then(function(cfg) {
      if (cfg && cfg.method === 'sso') {
        ssoMode = true;
        showSso(sso, fields, button);
      }
    }).catch(function() { /* keep the password form */ });

    form.addEventListener('submit', function(e) {
      e.preventDefault();
      if (ssoMode) {
        window.location.assign(sso.href);
        return;
      }
      error.hidden = true;
      var login = document.getElementById('login').value.trim();
      var password = document.getElementById('password').value;
      if (!login || !password) {
        showError(error, 'Enter your login and password.');
        return;
      }
      button.disabled = true;
      fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ login: login, password: password })
      }).then(function(res) {
        if (res.status === 204) {
          window.location.assign(returnTo());
          return;
        }
        button.disabled = false;
        if (res.status === 429) {
          var after = parseInt(res.headers.get('Retry-After') || '0', 10);
          var minutes = Math.max(1, Math.ceil(after / 60));
          showError(error, 'Too many failed attempts. Try again in ' + minutes + ' minute' + (minutes === 1 ? '' : 's') + '.');
        } else if (res.status === 401) {
          showError(error, 'Invalid login or password.');
        } else if (res.status === 403) {
          showError(error, 'This server signs in with SSO only.');
        } else {
          showError(error, 'Sign-in failed (' + res.status + '). Try again.');
        }
      }).catch(function() {
        button.disabled = false;
        showError(error, 'Cannot reach the server. Try again.');
      });
    });
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'className') node.className = attrs[k];
      else node.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function(c) { if (c) node.appendChild(c); });
    return node;
  }

  function api(method, url, body) {
    var init = { method: method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return fetch(url, init).then(function(res) {
      if (res.status === 401) {
        window.location.assign('/login?returnTo=' + encodeURIComponent(window.location.pathname));
        throw new Error('signed out');
      }
      return res;
    });
  }

  function when(iso) {
    return iso ? new Date(iso).toLocaleString() : '—';
  }

  function copyButton(getText) {
    var b = el('button', { type: 'button', text: 'Copy' });
    b.addEventListener('click', function() {
      var done = function() { b.textContent = 'Copied'; setTimeout(function() { b.textContent = 'Copy'; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(getText()).then(done, function() { b.textContent = 'Select and copy'; });
      } else {
        b.textContent = 'Select and copy';
      }
    });
    return b;
  }

  function initTokens() {
    var root = document.getElementById('account');
    var nameInput = el('input', { type: 'text', id: 'tokenName', maxlength: '100', placeholder: 'Token name, e.g. laptop', autocomplete: 'off', 'aria-label': 'Token name' });
    var createBtn = el('button', { type: 'submit', id: 'createTokenBtn', text: 'Create token' });
    var form = el('form', { className: 'account-form', id: 'tokenForm', novalidate: '' }, [nameInput, createBtn]);
    var error = el('p', { className: 'account-error', id: 'tokenError', role: 'alert' });
    error.hidden = true;
    var created = el('section', { className: 'token-created', id: 'tokenCreated' });
    created.hidden = true;
    var tbody = el('tbody', { id: 'tokenRows' });
    var table = el('table', { className: 'token-table' }, [
      el('thead', null, [el('tr', null, ['Name', 'Token', 'Created', 'Last used', 'Expires', ''].map(function(h) { return el('th', { text: h }); }))]),
      tbody
    ]);
    var empty = el('p', { className: 'account-hint', id: 'tokenEmpty', text: 'No tokens yet.' });
    empty.hidden = true;

    root.appendChild(el('a', { className: 'account-back', href: '/', text: '← Back to chat' }));
    root.appendChild(el('h1', { text: 'Personal tokens' }));
    root.appendChild(el('p', { className: 'account-hint', text: 'Tokens let MCP clients, scripts and the lore CLI act as you. Tokens created here never expire; the ones lore login creates (cli-…) do. Revoke the ones you no longer use.' }));
    [form, error, created, table, empty].forEach(function(n) { root.appendChild(n); });

    function showCreated(t) {
      while (created.firstChild) created.removeChild(created.firstChild);
      var tokenCode = el('code', { id: 'newToken', text: t.token });
      var cmdCode = el('code', { id: 'mcpCommand', text: t.mcp_command });
      created.appendChild(el('p', { text: 'Token "' + t.name + '" created. Copy it now: it is not shown again.' }));
      created.appendChild(el('div', { className: 'token-secret' }, [tokenCode, copyButton(function() { return t.token; })]));
      created.appendChild(el('p', { text: 'Add Lore to Claude Code:' }));
      created.appendChild(el('div', { className: 'token-secret' }, [cmdCode, copyButton(function() { return t.mcp_command; })]));
      created.hidden = false;
    }

    function render(tokens) {
      while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
      empty.hidden = tokens.length > 0;
      tokens.forEach(function(t) {
        var action;
        if (t.revoked_at) {
          action = el('span', { text: 'revoked ' + when(t.revoked_at) });
        } else {
          action = el('button', { type: 'button', text: 'Revoke', 'aria-label': 'Revoke ' + t.name });
          action.addEventListener('click', function() {
            if (!window.confirm('Revoke token "' + t.name + '"? Clients using it stop working.')) return;
            action.disabled = true;
            api('DELETE', '/api/tokens/' + encodeURIComponent(t.id)).then(function(res) {
              if (res.status !== 204 && res.status !== 404) throw new Error('revoke failed (' + res.status + ')');
              load();
            }).catch(function(e) {
              action.disabled = false;
              if (e.message !== 'signed out') showError(error, 'Could not revoke the token. Try again.');
            });
          });
        }
        var row = el('tr', { className: t.revoked_at ? 'revoked' : '', 'data-token-id': t.id }, [
          el('td', { text: t.name }),
          el('td', null, [el('code', { text: t.prefix + '…' })]),
          el('td', { text: when(t.created_at) }),
          el('td', { text: when(t.last_used_at) }),
          el('td', { text: t.expires_at ? when(t.expires_at) : 'never' }),
          el('td', null, [action])
        ]);
        tbody.appendChild(row);
      });
    }

    function load() {
      return api('GET', '/api/tokens').then(function(res) {
        if (!res.ok) throw new Error('list failed (' + res.status + ')');
        return res.json();
      }).then(render).catch(function(e) {
        if (e.message !== 'signed out') showError(error, 'Could not load your tokens.');
      });
    }

    form.addEventListener('submit', function(e) {
      e.preventDefault();
      error.hidden = true;
      var name = nameInput.value.trim();
      if (!name) {
        showError(error, 'Enter a name for the token.');
        return;
      }
      createBtn.disabled = true;
      api('POST', '/api/tokens', { name: name }).then(function(res) {
        createBtn.disabled = false;
        if (res.status !== 201) {
          showError(error, res.status === 400 ? 'The name must be 1-100 characters.' : 'Could not create the token (' + res.status + ').');
          return null;
        }
        return res.json().then(function(t) {
          nameInput.value = '';
          showCreated(t);
          return load();
        });
      }).catch(function(e) {
        createBtn.disabled = false;
        if (e.message !== 'signed out') showError(error, 'Cannot reach the server. Try again.');
      });
    });

    load();
  }

  /* ── Namespaces & keys (admin) ── */
  /* JSON helper: resolves to the parsed body, rejects with the server's error message. */
  function apiJson(method, path, body) {
    return api(method, path, body).then(function(res) {
      return res.text().then(function(text) {
        var data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
        return data;
      });
    });
  }

  function option(value, label) {
    return el('option', { value: value, text: label });
  }

  function initNamespaces() {
    var root = document.getElementById('account');
    var error = el('p', { class: 'account-error', role: 'alert' });
    error.hidden = true;
    var secret = el('div', { class: 'account-secret', id: 'newKey' });
    secret.hidden = true;
    var nsBody = el('tbody', { id: 'namespaceRows' });
    var keyBody = el('tbody', { id: 'keyRows' });
    var nsSelects = [];
    var libSelects = [];

    function fail(e) {
      if (e.message === 'signed out') return;
      error.textContent = e.message;
      error.hidden = false;
    }

    function fillSelect(select, items, placeholder) {
      while (select.firstChild) select.removeChild(select.firstChild);
      if (placeholder) select.appendChild(option('', placeholder));
      items.forEach(function(i) { select.appendChild(option(i.value, i.label)); });
    }

    function render(namespaces, keys) {
      error.hidden = true;
      while (nsBody.firstChild) nsBody.removeChild(nsBody.firstChild);
      var libs = [];
      namespaces.forEach(function(ns) {
        ns.libraries.forEach(function(l) { libs.push({ value: l, label: l + ' (' + ns.id + ')' }); });
        var rename = el('button', { type: 'button', text: 'Rename' });
        rename.addEventListener('click', function() {
          var name = window.prompt('New display name for ' + ns.id, ns.display_name);
          if (name && name.trim()) apiJson('PATCH', '/api/namespaces/' + encodeURIComponent(ns.id), { display_name: name.trim() }).then(load, fail);
        });
        var nameCell = el('td', { text: ns.display_name });
        if (ns.system) nameCell.appendChild(el('span', { class: 'account-tag', text: 'system' }));
        nsBody.appendChild(el('tr', {}, [
          el('td', { text: ns.id }),
          nameCell,
          el('td', { text: ns.libraries.length ? ns.libraries.join(', ') : '—' }),
          el('td', {}, [ns.system ? null : rename]),
        ]));
      });
      var assignable = namespaces.filter(function(ns) { return !ns.system; }).map(function(ns) {
        return { value: ns.id, label: ns.display_name + ' (' + ns.id + ')' };
      });
      nsSelects.forEach(function(s) { fillSelect(s, assignable); });
      libSelects.forEach(function(s) { fillSelect(s, libs, s.dataset.placeholder); });

      while (keyBody.firstChild) keyBody.removeChild(keyBody.firstChild);
      keys.forEach(function(k) {
        var revoke = el('button', { type: 'button', text: 'Revoke' });
        revoke.addEventListener('click', function() {
          if (window.confirm('Revoke project key "' + k.name + '"? CI using it stops pushing at once.')) {
            apiJson('DELETE', '/api/project-keys/' + encodeURIComponent(k.id)).then(load, fail);
          }
        });
        keyBody.appendChild(el('tr', {}, [
          el('td', { text: k.name }),
          el('td', { text: k.prefix + '…' }),
          el('td', { text: k.namespace_id + (k.library_id ? ' / ' + k.library_id : '') }),
          el('td', { text: k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'never' }),
          el('td', {}, [k.revoked_at ? el('span', { class: 'account-note', text: 'revoked' }) : revoke]),
        ]));
      });
    }

    function load() {
      return Promise.all([apiJson('GET', '/api/namespaces'), apiJson('GET', '/api/project-keys')]).then(function(r) {
        render(r[0], r[1]);
      }, fail);
    }

    // Create a namespace
    var nsId = el('input', { type: 'text', id: 'nsId', placeholder: 'id (e.g. payments)', autocapitalize: 'none', spellcheck: 'false' });
    var nsName = el('input', { type: 'text', id: 'nsName', placeholder: 'Display name' });
    var nsForm = el('form', { class: 'account-form', id: 'namespaceForm' }, [nsId, nsName, el('button', { type: 'submit', text: 'Create namespace' })]);
    nsForm.addEventListener('submit', function(e) {
      e.preventDefault();
      apiJson('POST', '/api/namespaces', { id: nsId.value.trim(), display_name: nsName.value.trim() }).then(function() {
        nsId.value = '';
        nsName.value = '';
        return load();
      }, fail);
    });

    // Move a library
    var assignLib = el('select', { id: 'assignLibrary', 'aria-label': 'Library', 'data-placeholder': 'Library…' });
    var assignNs = el('select', { id: 'assignNamespace', 'aria-label': 'Namespace' });
    libSelects.push(assignLib);
    nsSelects.push(assignNs);
    var assignForm = el('form', { class: 'account-form', id: 'assignForm' }, [assignLib, el('span', { class: 'account-note', text: 'to' }), assignNs, el('button', { type: 'submit', text: 'Move' })]);
    assignForm.addEventListener('submit', function(e) {
      e.preventDefault();
      if (!assignLib.value) return;
      apiJson('PUT', '/api/libraries/' + encodeURIComponent(assignLib.value) + '/namespace', { namespace_id: assignNs.value }).then(load, fail);
    });

    // Create a project key
    var keyNs = el('select', { id: 'keyNamespace', 'aria-label': 'Namespace' });
    var keyName = el('input', { type: 'text', id: 'keyName', placeholder: 'Key name (e.g. github-ci)' });
    var keyLib = el('select', { id: 'keyLibrary', 'aria-label': 'Restrict to library', 'data-placeholder': 'Whole namespace' });
    nsSelects.push(keyNs);
    libSelects.push(keyLib);
    var keyForm = el('form', { class: 'account-form', id: 'keyForm' }, [keyNs, keyName, keyLib, el('button', { type: 'submit', text: 'Create key' })]);
    keyForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var body = { namespace_id: keyNs.value, name: keyName.value.trim() };
      if (keyLib.value) body.library_id = keyLib.value;
      apiJson('POST', '/api/project-keys', body).then(function(created) {
        keyName.value = '';
        secret.textContent = 'New key "' + created.name + '" (shown only once): ' + created.key;
        secret.hidden = false;
        return load();
      }, fail);
    });

    var back = el('a', { class: 'account-back', href: '/', text: '← Back to chat' });
    root.appendChild(back);
    root.appendChild(el('h1', { text: 'Namespaces & keys' }));
    root.appendChild(el('p', { class: 'account-note', text: 'Namespaces group libraries. A project key (lpk_…) pushes only to libraries of its namespace; use it as LORE_TOKEN in CI.' }));
    root.appendChild(error);
    root.appendChild(el('h2', { text: 'Namespaces' }));
    root.appendChild(el('table', { class: 'account-table' }, [
      el('thead', {}, [el('tr', {}, [el('th', { text: 'Id' }), el('th', { text: 'Name' }), el('th', { text: 'Libraries' }), el('th', {})])]),
      nsBody,
    ]));
    root.appendChild(nsForm);
    root.appendChild(el('h2', { text: 'Move a library' }));
    root.appendChild(assignForm);
    root.appendChild(el('h2', { text: 'Project keys' }));
    root.appendChild(el('table', { class: 'account-table' }, [
      el('thead', {}, [el('tr', {}, [el('th', { text: 'Name' }), el('th', { text: 'Key' }), el('th', { text: 'Scope' }), el('th', { text: 'Last used' }), el('th', {})])]),
      keyBody,
    ]));
    root.appendChild(keyForm);
    root.appendChild(secret);
    load();
  }

  /* ── Users (admin) ── */
  function initUsers() {
    var root = document.getElementById('account');
    var error = el('p', { class: 'account-error', id: 'userError', role: 'alert' });
    error.hidden = true;
    var notice = el('p', { class: 'account-note', id: 'userNotice', role: 'status' });
    notice.hidden = true;
    var tbody = el('tbody', { id: 'userRows' });
    var sso = false;
    var self = null;

    function fail(e) {
      if (e.message === 'signed out') return;
      notice.hidden = true;
      error.textContent = e.message;
      error.hidden = false;
    }
    function done(text) {
      error.hidden = true;
      notice.textContent = text;
      notice.hidden = false;
    }

    function render(users) {
      while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
      users.forEach(function(u) {
        var mine = u.login === self;
        var role = el('select', { 'aria-label': 'Role of ' + u.login, 'data-user-role': u.login }, [option('member', 'member'), option('admin', 'admin')]);
        role.value = u.role;
        role.disabled = mine;
        role.addEventListener('change', function() {
          apiJson('PATCH', '/api/users/' + encodeURIComponent(u.id), { role: role.value }).then(function() {
            done(u.login + ' is now ' + role.value + '.');
            return load();
          }, function(e) { role.value = u.role; fail(e); });
        });
        var toggle = el('button', { type: 'button', text: u.disabled ? 'Enable' : 'Disable', 'data-user-toggle': u.login });
        toggle.disabled = mine;
        toggle.addEventListener('click', function() {
          if (!u.disabled && !window.confirm('Disable ' + u.login + '? They are signed out and their tokens stop working.')) return;
          apiJson('PATCH', '/api/users/' + encodeURIComponent(u.id), { disabled: !u.disabled }).then(function() {
            done(u.login + (u.disabled ? ' is enabled.' : ' is disabled.'));
            return load();
          }, fail);
        });
        var actions = [toggle];
        if (!sso) {
          var reset = el('button', { type: 'button', text: 'Reset password', 'data-user-reset': u.login });
          reset.addEventListener('click', function() {
            var body = {};
            if (mine) {
              var current = window.prompt('Your current password:');
              if (!current) return;
              body.current_password = current;
            } else if (!window.confirm('Reset the password of ' + u.login + '? Their sessions end and all their personal tokens (MCP clients, scripts, lore login) are revoked.')) {
              return;
            }
            var pw = window.prompt('New password for ' + u.login + ' (at least 12 characters):');
            if (!pw) return;
            body.password = pw;
            apiJson('POST', '/api/users/' + encodeURIComponent(u.id) + '/password', body).then(function() {
              done('Password of ' + u.login + ' changed; their sessions ended and their personal tokens were revoked.');
            }, fail);
          });
          actions.push(reset);
          var unlock = el('button', { type: 'button', text: 'Unlock sign-in', 'data-user-unlock': u.login });
          unlock.addEventListener('click', function() {
            apiJson('POST', '/api/users/' + encodeURIComponent(u.id) + '/unlock').then(function() {
              done('Password sign-in of ' + u.login + ' is unlocked.');
            }, fail);
          });
          actions.push(unlock);
        }
        var loginCell = el('td', { text: u.login });
        if (u.sso) loginCell.appendChild(el('span', { class: 'account-tag', text: 'SSO' }));
        if (u.disabled) loginCell.appendChild(el('span', { class: 'account-tag', text: 'disabled' }));
        tbody.appendChild(el('tr', { 'data-user': u.login }, [
          loginCell,
          el('td', { text: u.display_name }),
          el('td', {}, [role]),
          el('td', { text: u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'never' }),
          el('td', {}, actions),
        ]));
      });
    }

    function load() {
      return apiJson('GET', '/api/users').then(render, fail);
    }

    var login = el('input', { type: 'text', id: 'newLogin', placeholder: 'login', autocapitalize: 'none', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Login' });
    var displayName = el('input', { type: 'text', id: 'newDisplayName', placeholder: 'Display name', autocomplete: 'off', 'aria-label': 'Display name' });
    var password = el('input', { type: 'password', id: 'newPassword', placeholder: 'Password (12+ characters)', autocomplete: 'new-password', 'aria-label': 'Password' });
    var newRole = el('select', { id: 'newRole', 'aria-label': 'Role' }, [option('member', 'member'), option('admin', 'admin')]);
    var form = el('form', { class: 'account-form', id: 'userForm', novalidate: '' }, [login, displayName, password, newRole, el('button', { type: 'submit', text: 'Add user' })]);
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      apiJson('POST', '/api/users', { login: login.value.trim(), display_name: displayName.value.trim(), password: password.value, role: newRole.value }).then(function(u) {
        login.value = '';
        displayName.value = '';
        password.value = '';
        done('User ' + u.login + ' added.');
        return load();
      }, fail);
    });
    var ssoNote = el('p', { class: 'account-note', id: 'userSsoNote', text: 'People sign in with SSO: they are created on first sign-in and their role follows their groups. You can still disable someone here.' });
    ssoNote.hidden = true;
    form.hidden = true;

    root.appendChild(el('a', { class: 'account-back', href: '/', text: '← Back to chat' }));
    root.appendChild(el('h1', { text: 'Users' }));
    root.appendChild(el('p', { class: 'account-note', text: 'Admins manage namespaces, keys and users; members read and chat. Disabling someone ends their sessions and blocks their tokens.' }));
    [error, notice, ssoNote].forEach(function(n) { root.appendChild(n); });
    root.appendChild(el('table', { class: 'account-table' }, [
      el('thead', {}, [el('tr', {}, ['Login', 'Name', 'Role', 'Last sign-in', ''].map(function(h) { return el('th', { text: h }); }))]),
      tbody,
    ]));
    root.appendChild(form);

    Promise.all([
      api('GET', '/api/auth/config').then(function(r) { return r.ok ? r.json() : { method: 'password' }; }),
      api('GET', '/api/auth/me').then(function(r) { return r.ok ? r.json() : null; }),
    ]).then(function(r) {
      sso = r[0].method === 'sso';
      self = r[1] && r[1].kind === 'user' ? r[1].login : null;
      ssoNote.hidden = !sso;
      form.hidden = sso;
      return load();
    }, fail);
  }

  function initCliLogin() {
    var form = document.getElementById('cliCodeForm');
    var input = document.getElementById('cliCodeInput');
    var request = document.getElementById('cliRequest');
    var approve = document.getElementById('cliApprove');
    var deny = document.getElementById('cliDeny');
    if (!form || !input || !request || !approve || !deny) return;
    var error = document.getElementById('cliError');
    var done = document.getElementById('cliDone');
    var actions = document.getElementById('cliActions');
    var userCode = null;

    form.addEventListener('submit', function(ev) {
      ev.preventDefault();
      error.hidden = true;
      var typed = input.value.trim();
      if (!typed) { showError(error, 'Type the code your terminal shows.'); return; }
      fetch('/api/cli/login/' + encodeURIComponent(typed), { credentials: 'same-origin' }).then(function(res) {
        if (res.status === 404) throw new Error('No sign-in request has this code. Check the code in your terminal.');
        if (res.status === 410) throw new Error('This request has expired. Run lore login again.');
        if (!res.ok) throw new Error('Could not look up the code (' + res.status + '). Try again.');
        return res.json();
      }).then(function(r) {
        if (r.status !== 'pending') throw new Error('This request has already been answered.');
        userCode = r.user_code;
        document.getElementById('cliCode').textContent = r.user_code;
        document.getElementById('cliHost').textContent = r.hostname;
        document.getElementById('cliIp').textContent = r.requested_ip;
        document.getElementById('cliTokenName').textContent = 'cli-' + r.hostname;
        form.hidden = true;
        request.hidden = false;
      }).catch(function(e) {
        showError(error, e && e.message && e.message !== 'Failed to fetch' ? e.message : 'Cannot reach the server. Try again.');
      });
    });

    function decide(ok) {
      error.hidden = true;
      approve.disabled = true;
      deny.disabled = true;
      fetch('/api/cli/login/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ user_code: userCode, approve: ok })
      }).then(function(res) {
        if (res.status === 204) {
          actions.hidden = true;
          done.textContent = ok
            ? 'The CLI is signed in. You can close this tab and return to your terminal.'
            : 'The request was denied. You can close this tab.';
          done.hidden = false;
          return;
        }
        if (res.status === 409) {
          actions.hidden = true;
          showError(error, 'This request has already been answered.');
        } else if (res.status === 410 || res.status === 404) {
          actions.hidden = true;
          showError(error, 'This request has expired. Run lore login again.');
        } else {
          approve.disabled = false;
          deny.disabled = false;
          showError(error, 'Could not answer the request (' + res.status + '). Try again.');
        }
      }).catch(function() {
        approve.disabled = false;
        deny.disabled = false;
        showError(error, 'Cannot reach the server. Try again.');
      });
    }
    approve.addEventListener('click', function() { decide(true); });
    deny.addEventListener('click', function() { decide(false); });
  }

  var pages = { login: initLogin, tokens: initTokens, users: initUsers, namespaces: initNamespaces, 'cli-login': initCliLogin };
  var init = pages[document.body.dataset.page];
  if (init) init();
})();
`;
