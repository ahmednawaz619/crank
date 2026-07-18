/**
 * Vizcopy bookmarklet — div selection + text-node extraction.
 *
 * Adapted from Vizpatch extension/content.js picker + bookmarklet inspect patterns:
 * hover highlight → click to select → extract text nodes → POST/WS to companion.
 *
 * Loaded from companion: http://127.0.0.1:3344/bookmarklet.js
 */
(function () {
  if (window.__vizcopyActive) {
    console.info('[Vizcopy] Already active');
    return;
  }
  window.__vizcopyActive = true;

  const COMPANION_HTTP =
    window.__VIZCOPY_COMPANION__ ||
    detectCompanionOrigin() ||
    'http://127.0.0.1:3344';
  const COMPANION_WS = COMPANION_HTTP.replace(/^http/i, 'ws') + '/ws';

  function detectCompanionOrigin() {
    try {
      const scripts = document.querySelectorAll('script[src*="bookmarklet.js"]');
      for (const s of scripts) {
        const u = new URL(s.src, location.href);
        return u.origin;
      }
    } catch (_) {}
    return null;
  }

  /** @type {HTMLElement | null} */
  let selectedEl = null;
  /** @type {{ path: string, text: string, role: string }[] } */
  let selectedNodes = [];
  let sessionId = null;
  /** @type {WebSocket | null} */
  let socket = null;

  const highlight = document.createElement('div');
  highlight.id = 'vizcopy-highlight';
  highlight.style.cssText = [
    'position:fixed',
    'pointer-events:none',
    'z-index:2147483646',
    'border:2px solid #0f766e',
    'background:rgba(15,118,110,0.08)',
    'border-radius:3px',
    'transition:all 80ms ease'
  ].join(';');

  const panel = document.createElement('div');
  panel.id = 'vizcopy-panel';
  panel.style.cssText = [
    'position:fixed',
    'top:16px',
    'right:16px',
    'width:340px',
    'max-height:calc(100vh - 32px)',
    'overflow:auto',
    'z-index:2147483647',
    'background:#fff',
    'color:#111',
    'border:1px solid #d4d4d4',
    'border-radius:10px',
    'box-shadow:0 12px 40px rgba(0,0,0,0.14)',
    'font:13px/1.45 ui-sans-serif,system-ui,sans-serif',
    'padding:12px 14px'
  ].join(';');

  panel.innerHTML = [
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">',
    '  <strong style="font-size:14px;">Vizcopy</strong>',
    '  <button type="button" id="vc-close" style="border:0;background:transparent;cursor:pointer;font-size:16px;">×</button>',
    '</div>',
    '<p id="vc-status" style="margin:8px 0 10px;color:#555;">Click Select, then click a div.</p>',
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">',
    '  <button type="button" id="vc-select" style="padding:6px 10px;border-radius:6px;border:0;background:#0f766e;color:#fff;cursor:pointer;font-weight:600;">Select</button>',
    '  <button type="button" id="vc-glean" style="padding:6px 10px;border-radius:6px;border:1px solid #ccc;background:#f7f7f7;cursor:pointer;" disabled>Ask Glean</button>',
    '</div>',
    '<div id="vc-nodes" style="font-size:12px;color:#333;white-space:pre-wrap;background:#fafafa;border:1px solid #eee;border-radius:6px;padding:8px;min-height:48px;"></div>',
    '<div id="vc-variants" style="margin-top:10px;"></div>'
  ].join('');

  document.documentElement.appendChild(panel);

  const statusEl = panel.querySelector('#vc-status');
  const nodesEl = panel.querySelector('#vc-nodes');
  const variantsEl = panel.querySelector('#vc-variants');
  const selectBtn = panel.querySelector('#vc-select');
  const gleanBtn = panel.querySelector('#vc-glean');
  const closeBtn = panel.querySelector('#vc-close');

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function cssPath(el) {
    if (!(el instanceof Element)) {
      return '';
    }
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        part += '#' + CSS.escape(node.id);
        parts.unshift(part);
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (c) => c.tagName === node.tagName
        );
        if (siblings.length > 1) {
          part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
        }
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }

  /**
   * Walk text nodes under root. path = depth-first index string.
   */
  function extractTextNodes(root) {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const text = String(node.nodeValue || '').replace(/\s+/g, ' ').trim();
        if (!text) {
          return NodeFilter.FILTER_REJECT;
        }
        const parent = node.parentElement;
        if (!parent) {
          return NodeFilter.FILTER_REJECT;
        }
        const tag = parent.tagName.toLowerCase();
        if (['script', 'style', 'noscript', 'svg'].includes(tag)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let index = 0;
    let current;
    while ((current = walker.nextNode())) {
      const parent = current.parentElement;
      const role =
        parent && /^(h1|h2|h3|h4|h5|h6)$/i.test(parent.tagName)
          ? 'heading'
          : parent && /^(button|a)$/i.test(parent.tagName)
            ? 'action'
            : parent && /^(label|figcaption|caption)$/i.test(parent.tagName)
              ? 'label'
              : 'text';
      out.push({
        path: String(index++),
        text: String(current.nodeValue || '').replace(/\s+/g, ' ').trim(),
        role,
        tagName: parent ? parent.tagName.toLowerCase() : ''
      });
    }
    return out;
  }

  function applyNodesToDom(root, nodes) {
    if (!root || !Array.isArray(nodes)) {
      return 0;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const text = String(node.nodeValue || '').replace(/\s+/g, ' ').trim();
        if (!text) {
          return NodeFilter.FILTER_REJECT;
        }
        const parent = node.parentElement;
        if (!parent) {
          return NodeFilter.FILTER_REJECT;
        }
        const tag = parent.tagName.toLowerCase();
        if (['script', 'style', 'noscript', 'svg'].includes(tag)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const live = [];
    let current;
    while ((current = walker.nextNode())) {
      live.push(current);
    }
    let applied = 0;
    for (const node of nodes) {
      const idx = Number(node.path);
      if (!Number.isFinite(idx) || !live[idx]) {
        continue;
      }
      live[idx].nodeValue = node.text;
      applied += 1;
    }
    return applied;
  }

  function connectWs() {
    try {
      socket = new WebSocket(COMPANION_WS);
      socket.addEventListener('open', () => setStatus('Connected to companion'));
      socket.addEventListener('message', (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch (_) {
          return;
        }
        if (msg.type === 'VARIANTS_READY' && msg.session) {
          sessionId = msg.session.id;
          renderVariants(msg.session.variants || []);
          setStatus('Glean returned ' + (msg.session.variants || []).length + ' options');
        }
        if (msg.type === 'APPLY_VARIANT' && selectedEl) {
          const n = applyNodesToDom(selectedEl, msg.nodes || []);
          setStatus('Applied variant to page (' + n + ' nodes)');
        }
        if (msg.type === 'ERROR') {
          setStatus('Error: ' + msg.error);
        }
      });
      socket.addEventListener('close', () => {
        setStatus('Companion disconnected — HTTP fallback still works');
      });
    } catch (err) {
      console.warn('[Vizcopy] WS failed', err);
    }
  }

  async function postSelection(payload) {
    const res = await fetch(COMPANION_HTTP + '/api/selection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.ok) {
      throw new Error(data.error || 'selection failed');
    }
    sessionId = data.session.id;
    return data.session;
  }

  async function requestGlean() {
    if (!sessionId) {
      setStatus('Select a div first');
      return;
    }
    setStatus('Asking Glean…');
    gleanBtn.disabled = true;
    try {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'REQUEST_VARIANTS', sessionId }));
      } else {
        const res = await fetch(COMPANION_HTTP + '/api/variants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId })
        });
        const data = await res.json();
        if (!data.ok) {
          throw new Error(data.error || 'Glean failed');
        }
        renderVariants(data.variants || []);
        setStatus('Glean returned ' + (data.variants || []).length + ' options');
      }
    } catch (err) {
      setStatus('Glean error: ' + err.message);
    } finally {
      gleanBtn.disabled = !sessionId;
    }
  }

  async function applyVariant(variantId) {
    try {
      const res = await fetch(COMPANION_HTTP + '/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, variantId })
      });
      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error || 'apply failed');
      }
      if (selectedEl) {
        applyNodesToDom(selectedEl, data.variant.nodes || []);
      }
      setStatus('Applied “‘ + (data.variant.label || variantId) + '”');
    } catch (err) {
      setStatus('Apply error: ' + err.message);
    }
  }

  function renderVariants(variants) {
    if (!variants.length) {
      variantsEl.innerHTML = '';
      return;
    }
    variantsEl.innerHTML = variants
      .map(function (v) {
        const preview = (v.nodes || [])
          .map(function (n) {
            return escapeHtml(n.text);
          })
          .join('\n');
        return (
          '<div style="border:1px solid #e5e5e5;border-radius:8px;padding:8px;margin-bottom:8px;">' +
          '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">' +
          '<strong>' +
          escapeHtml(v.label || v.id) +
          '</strong>' +
          '<button type="button" data-variant="' +
          escapeAttr(v.id) +
          '" style="padding:4px 8px;border-radius:5px;border:0;background:#111;color:#fff;cursor:pointer;">Apply</button>' +
          '</div>' +
          '<pre style="margin:6px 0 0;white-space:pre-wrap;font:11px/1.4 ui-monospace,monospace;color:#333;">' +
          preview +
          '</pre></div>'
        );
      })
      .join('');

    variantsEl.querySelectorAll('button[data-variant]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyVariant(btn.getAttribute('data-variant'));
      });
    });
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, '&quot;');
  }

  let pickerActive = false;

  function activatePicker() {
    if (pickerActive) {
      return;
    }
    pickerActive = true;
    document.documentElement.appendChild(highlight);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    setStatus('Hover a div, click to select. Esc cancels.');
  }

  function deactivatePicker() {
    if (!pickerActive) {
      return;
    }
    pickerActive = false;
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    if (highlight.parentNode) {
      highlight.parentNode.removeChild(highlight);
    }
  }

  function resolveDiv(target) {
    let el = target;
    if (!(el instanceof Element)) {
      return null;
    }
    if (panel.contains(el) || el === highlight) {
      return null;
    }
    while (el && el !== document.body) {
      if (el.tagName && el.tagName.toLowerCase() === 'div') {
        return el;
      }
      el = el.parentElement;
    }
    return target instanceof Element ? target : null;
  }

  function onMove(event) {
    const el = resolveDiv(event.target);
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    highlight.style.top = rect.top + 'px';
    highlight.style.left = rect.left + 'px';
    highlight.style.width = rect.width + 'px';
    highlight.style.height = rect.height + 'px';
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      deactivatePicker();
      setStatus('Selection cancelled');
    }
  }

  async function onClick(event) {
    const el = resolveDiv(event.target);
    if (!el) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    deactivatePicker();

    selectedEl = el;
    selectedNodes = extractTextNodes(el);
    nodesEl.textContent = selectedNodes.length
      ? selectedNodes
          .map(function (n, i) {
            return '[' + i + '] (' + n.role + ') ' + n.text;
          })
          .join('\n')
      : '(no text nodes)';

    const payload = {
      origin: location.origin,
      pageUrl: location.href,
      selector: cssPath(el),
      tagName: el.tagName.toLowerCase(),
      nodes: selectedNodes,
      combinedText: selectedNodes.map(function (n) {
        return n.text;
      }).join('\n'),
      meta: { tool: 'vizcopy-bookmarklet' }
    };

    try {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'SET_SELECTION', payload }));
      }
      const session = await postSelection(payload);
      sessionId = session.id;
      gleanBtn.disabled = false;
      setStatus(
        'Selected ' +
          el.tagName.toLowerCase() +
          ' · ' +
          selectedNodes.length +
          ' text node(s) · session ' +
          sessionId
      );
      variantsEl.innerHTML = '';
    } catch (err) {
      setStatus('Could not reach companion: ' + err.message);
      gleanBtn.disabled = true;
    }
  }

  selectBtn.addEventListener('click', activatePicker);
  gleanBtn.addEventListener('click', requestGlean);
  closeBtn.addEventListener('click', function () {
    deactivatePicker();
    if (socket) {
      socket.close();
    }
    panel.remove();
    window.__vizcopyActive = false;
  });

  connectWs();
  setStatus('Ready — companion ' + COMPANION_HTTP);
})();
