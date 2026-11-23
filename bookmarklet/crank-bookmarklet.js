/**
 * Crank bookmarklet — tool-ui CSS/helpers + text-source classification.
 * Preview (DOM) vs Save (source via SAVE_TEXT_CHANGE) uses Crank text dispatch.
 */
(function () {
  // Hot re-inject only — skip on fresh page load (fixes refresh / bfcache).
  if (typeof window.__crankTeardown === 'function') {
    try {
      if (
        document.getElementById('vp-shell') ||
        document.getElementById('vp-crank-fab') ||
        document.getElementById('vp-crank-reopen')
      ) {
        window.__crankTeardown();
      } else {
        window.__crankTeardown = null;
      }
    } catch (_) {
      /* ignore */
    }
  }
  if (window.__crankActive) {
    window.__crankActive = false;
  }
  window.__crankActive = true;

  function normalizeCompanionOrigin(raw) {
    const s = String(raw || '').trim().replace(/\/$/, '');
    if (!s) {
      return '';
    }
    if (s.startsWith('/')) {
      return location.origin.replace(/\/$/, '') + s;
    }
    return s;
  }

  const COMPANION_HTTP = normalizeCompanionOrigin(
    window.__CRANK_COMPANION__ ||
      detectCompanionOrigin() ||
      detectReplitCompanionOrigin() ||
      'http://127.0.0.1:3344'
  );
  const COMPANION_WS = COMPANION_HTTP.replace(/^http/i, 'ws') + '/ws';
  const TEAM_TOKEN_KEY = 'crank:teamToken';
  // Retune-style: UI assets from the npm package (same-origin), not companion.
  const ASSET_BASE = (window.__CRANK_ASSET_BASE__ || '').replace(/\/?$/, '/');

  function assetUrl(file, companionPath) {
    if (window.__CRANK_ASSET_MAP__ && window.__CRANK_ASSET_MAP__[file]) {
      return window.__CRANK_ASSET_MAP__[file];
    }
    if (ASSET_BASE && ASSET_BASE.indexOf('blob:crank/') !== 0 && ASSET_BASE.indexOf('inline:crank/') !== 0) {
      return ASSET_BASE + file;
    }
    return COMPANION_HTTP + (companionPath || '/ui/' + file);
  }

  function injectInlineCss(cssText) {
    let style = document.querySelector('style[data-crank-ui="1"]');
    if (!style) {
      style = document.createElement('style');
      style.setAttribute('data-crank-ui', '1');
      document.documentElement.appendChild(style);
    }
    style.textContent = cssText;
  }

  function injectInlineScript(code) {
    const s = document.createElement('script');
    s.textContent = code;
    document.documentElement.appendChild(s);
  }

  async function loadPanelAssets() {
    const src = window.__CRANK_ASSET_SOURCE__;
    if (src && src.css && src.helpers && src.textSource) {
      injectInlineCss(src.css);
      injectInlineScript(src.helpers);
      injectInlineScript(src.textSource);
      return;
    }
    loadCss(assetUrl('crank-ui.css', '/ui/crank-ui.css') + '?v=' + Date.now());
    await loadScript(assetUrl('crank-ui-helpers.js', '/ui/crank-ui-helpers.js') + '?v=' + Date.now());
    await loadScript(assetUrl('text-source.js', '/ui/text-source.js') + '?v=' + Date.now());
  }

  function detectReplitCompanionOrigin() {
    try {
      const host = window.location.hostname || '';
      if (!/\.replit\.dev$|\.repl\.co$|\.replit\.app$/.test(host)) {
        return null;
      }
      return location.origin.replace(/\/$/, '') + '/@crank';
    } catch (_) {
      return null;
    }
  }

  function getTeamToken() {
    try {
      return localStorage.getItem(TEAM_TOKEN_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function setTeamToken(value) {
    try {
      localStorage.setItem(TEAM_TOKEN_KEY, String(value || '').trim());
    } catch (_) {
      /* ignore */
    }
  }

  /** Local dev: sync CRANK_TEAM_TOKEN from Vite (.env) into browser storage once. */
  function seedDevTeamToken() {
    try {
      const devToken = String(window.__CRANK_DEV_TEAM_TOKEN__ || '').trim();
      if (devToken && !getTeamToken()) {
        setTeamToken(devToken);
      }
    } catch (_) {
      /* ignore */
    }
  }

  async function verifyTeamToken(token) {
    const value = String(token || '').trim();
    if (!value) return false;
    const verify = await fetch(COMPANION_HTTP + '/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: value })
    })
      .then(function (r) {
        return r.json();
      })
      .catch(function () {
        return { ok: false };
      });
    return !!(verify && verify.ok);
  }

  async function ensureTeamToken() {
    seedDevTeamToken();
    const status = await fetch(COMPANION_HTTP + '/api/auth/status').then(function (r) {
      return r.json();
    }).catch(function () {
      return { teamAuthRequired: false };
    });
    if (!status.teamAuthRequired) {
      hideTeamAuthUI();
      return true;
    }
    const stored = getTeamToken();
    if (stored && (await verifyTeamToken(stored))) {
      hideTeamAuthUI();
      return true;
    }
    if (stored) {
      setTeamToken('');
    }
    return false;
  }

  let teamAuthFab = null;
  let pendingSelectionPayload = null;

  function ensureTeamAuthFab() {
    if (teamAuthFab && teamAuthFab.parentNode) return teamAuthFab;
    const ui = UI();
    const btn = ui.vpButtonHtml || function (_v, label, attrs) {
      return (
        '<button type="button" id="' +
        (attrs && attrs.id ? attrs.id : '') +
        '">' +
        label +
        '</button>'
      );
    };
    teamAuthFab = document.createElement('div');
    teamAuthFab.id = 'vp-crank-team-auth';
    teamAuthFab.className = 'vp-crank-team-auth';
    teamAuthFab.innerHTML =
      '<div class="vp-type-label" style="font-weight:620;margin-bottom:6px;">Team token</div>' +
      '<p class="vp-muted vp-type-micro" style="margin:0 0 8px;line-height:1.45;">Paste the same value as <code>CRANK_TEAM_TOKEN</code> in your <code>.env</code>.</p>' +
      '<input type="password" id="vc-fab-team-token" class="vp-crank-team-auth-input" placeholder="Crank-…" autocomplete="off" />' +
      btn('primary', 'Save token', { id: 'vc-fab-team-token-save' }, { size: 'compact', flex: true });
    document.documentElement.appendChild(teamAuthFab);
    const saveBtn = teamAuthFab.querySelector('#vc-fab-team-token-save');
    const input = teamAuthFab.querySelector('#vc-fab-team-token');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        saveTeamTokenFromInput(input);
      });
    }
    if (input) {
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') saveTeamTokenFromInput(input);
      });
    }
    return teamAuthFab;
  }

  function showTeamAuthUI(surface) {
    const where = surface || (uiMode === 'panel' ? 'panel' : 'fab');
    if (where === 'fab' || where === 'both') {
      ensureTeamAuthFab();
      if (teamAuthFab) teamAuthFab.style.display = 'block';
    }
    if (where === 'panel' || where === 'both') {
      ensurePanelMounted();
      const box = panel.querySelector('#vc-team-auth');
      if (box) box.style.display = 'block';
    }
  }

  function hideTeamAuthUI() {
    if (teamAuthFab) teamAuthFab.style.display = 'none';
    const box = panel && panel.querySelector('#vc-team-auth');
    if (box) box.style.display = 'none';
  }

  async function registerSelection(payload, options) {
    if (sendWs({ type: 'SET_SELECTION', payload: payload })) {
      /* SELECTION_ACK or POST sets sessionId */
    }
    const data = await postJson('/api/selection', payload);
    if (data.ok && data.session) {
      applySessionFromServer(data.session);
      showFreshSelection();
      setStatus('Selection ready — preview/edit or Ask Glean');
      return true;
    }
    return false;
  }

  async function retryPendingSelection() {
    if (!pendingSelectionPayload) return;
    const payload = pendingSelectionPayload;
    pendingSelectionPayload = null;
    try {
      await registerSelection(payload);
    } catch (err) {
      pendingSelectionPayload = payload;
      const msg = err && err.message ? String(err.message) : 'Selection failed';
      showToast(msg, 'error');
      setStatus('Selection error: ' + msg);
      syncGleanButton();
    }
  }

  async function saveTeamTokenFromInput(inputEl) {
    const input = inputEl || (panel && panel.querySelector('#vc-team-token'));
    const token = input ? String(input.value || '').trim() : '';
    if (!token) {
      showToast('Paste your team token first', 'error');
      return false;
    }
    if (!(await verifyTeamToken(token))) {
      showToast('Invalid team token — check CRANK_TEAM_TOKEN in .env', 'error');
      return false;
    }
    setTeamToken(token);
    hideTeamAuthUI();
    showToast('Team token saved — Ask Glean is now available', 'ok');
    try {
      connectWs();
    } catch (_) {}
    await retryPendingSelection();
    if (typeof window.__crankProbeCompanion === 'function') {
      await window.__crankProbeCompanion();
    }
    return true;
  }

  function authHeaders(extra) {
    const h = extra || {};
    const token = getTeamToken();
    if (token) {
      h['X-Crank-Team-Token'] = token;
    }
    return h;
  }

  function wsUrlWithToken() {
    const token = getTeamToken();
    if (!token) {
      return COMPANION_WS;
    }
    const sep = COMPANION_WS.indexOf('?') >= 0 ? '&' : '?';
    return COMPANION_WS + sep + 'teamToken=' + encodeURIComponent(token);
  }

  function detectCompanionOrigin() {
    try {
      const scripts = document.querySelectorAll(
        'script[src*="bookmarklet.js"],script[src*="dev-loader.js"],script[data-crank-loader="1"]'
      );
      for (const s of scripts) {
        const u = new URL(s.src, location.href);
        // Vite same-origin proxy: /@crank/dev-loader.js → companion base is origin+/@crank
        if (u.pathname.indexOf('/@crank/') === 0 || u.pathname === '/@crank') {
          return u.origin + '/@crank';
        }
        return u.origin;
      }
    } catch (_) {}
    return null;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const existing = document.querySelector('script[src="' + src + '"]');
      if (existing) {
        resolve();
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.onload = function () {
        resolve();
      };
      s.onerror = reject;
      document.documentElement.appendChild(s);
    });
  }

  function loadCss(href) {
    let link = document.querySelector('link[data-crank-ui="1"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.setAttribute('data-crank-ui', '1');
      document.documentElement.appendChild(link);
    }
    link.href = href;
  }

  let selectedEl = null;
  let selectedNodes = [];
  let layerFocus = null;
  let checkedLayers = [];
  let layerCatalog = [];
  let sessionId = null;
  let socket = null;
  let selecting = false;
  let originalSnapshot = [];
  let lastVariants = [];
  let activeVariantId = null;
  let previewedVariantId = null;
  let previewRestore = [];
  const historyStringMap = {};
  let companionOffline = false;
  let historyShowingCache = false;
  let pageSenseTimer = null;
  /** Bumps on each Ask Glean; stale WS progress after variants must not reopen thinking. */
  let gleanEpoch = 0;
  let gleanActiveEpoch = 0;
  /** fab = logo only · selecting = pick layout · panel = full editor */
  let uiMode = 'fab';
  let fab = null;
  let launcher = null;
  let toolbarOpen = false;
  let activeTool = 'select';
  let selectHint = null;
  const OPTION_COUNT_KEY = 'crank.gleanOptionCount';
  const GLEAN_CONTEXT_KEY = 'crank.gleanContext';
  const DEFAULT_GLEAN_OPTION_COUNT = 3;
  const GLEAN_OPTION_COUNT_MIN = 2;
  const GLEAN_OPTION_COUNT_MAX = 7;
  const GLEAN_STRING_TYPES = [
    'General UI string',
    'Action menu',
    'Button',
    'Dialog',
    'Error',
    'Feedback (e.g. toasts)',
    'File upload',
    'Placeholder text',
    'Sidebar',
    'Tables (bulk selection, sort, statuses)',
    'Forms and inputs (cards, fields, dropdown, checkbox, radio, toggle, switch, slider)',
    'Tooltip (popover)',
    'Hyperlink',
    'Pendo'
  ];
  const GLEAN_STRING_TYPE_DEFAULTS = {
    'General UI string': 'Before',
    Button: 'Before',
    Dialog: 'After',
    Error: 'After'
  };
  const GLEAN_FIELD_SELECTORS = {
    humanStrings: '#vc-glean-strings',
    componentType: '#vc-glean-component-type',
    timing: '#vc-glean-timing',
    userType: '#vc-glean-user-type',
    entryPoint: '#vc-glean-entry-point',
    userGoal: '#vc-glean-user-goal',
    nextStep: '#vc-glean-next-step',
    prdLink: '#vc-glean-prd'
  };
  let gleanContextTouched = false;
  let gleanValidationRequested = false;
  const GLEAN_REQUIRED_MSG = 'This field is required.';

  let viewedRequestId = null;
  let returnToHistory = false;
  let historyOpenToken = 0;
  let historyDetailRun = null;
  let historyScrollTop = 0;
  let pendingHistoryScroll = null;
  const liveRequests = {};

  function formatGleanDraftFromSelection() {
    const list = assignUnitLabels(selectedNodes || []);
    const lines = [];
    list.forEach(function (node, index) {
      const label = node.label || unitDisplayLabel(node, index, list);
      const text = String(node.text != null ? node.text : '').trim();
      if (!text) return;
      lines.push(label + ': ' + text);
    });
    return lines.join('\n').slice(0, 1500);
  }

  function loadGleanContext() {
    try {
      const raw = localStorage.getItem(GLEAN_CONTEXT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (_) {}
    return {};
  }

  function saveGleanContext(ctx) {
    try {
      localStorage.setItem(GLEAN_CONTEXT_KEY, JSON.stringify(ctx || {}));
    } catch (_) {}
  }

  const GLEAN_FREE_TEXT_SELECTORS = [
    '#vc-glean-entry-point',
    '#vc-glean-user-goal',
    '#vc-glean-next-step',
    '#vc-glean-action-options',
    '#vc-glean-surrounding',
    '#vc-glean-prd',
    '#vc-glean-additional'
  ];

  function readGleanContextFromPanel() {
    const panelRoot = panel;
    if (!panelRoot) return {};
    const get = function (id) {
      const el = panelRoot.querySelector(id);
      return el ? String(el.value != null ? el.value : '').trim() : '';
    };
    return {
      humanStrings: get('#vc-glean-strings'),
      componentType: get('#vc-glean-component-type') || 'General UI string',
      timing: get('#vc-glean-timing') || 'Before',
      userType: get('#vc-glean-user-type') || 'Fleet user',
      entryPoint: get('#vc-glean-entry-point'),
      userGoal: get('#vc-glean-user-goal'),
      nextStep: get('#vc-glean-next-step'),
      actionOptions: get('#vc-glean-action-options'),
      surroundingStrings: get('#vc-glean-surrounding'),
      prdLink: get('#vc-glean-prd'),
      additionalContext: get('#vc-glean-additional')
    };
  }

  function isValidGleanUrl(text) {
    const s = String(text || '').trim();
    if (!s) return true;
    try {
      const u = new URL(s);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  function validateGleanContextClient(ctx) {
    const merged = Object.assign({}, readGleanContextFromPanel(), ctx || {});
    const errors = [];
    const fieldErrors = {};
    if (!String(merged.humanStrings || '').trim()) {
      errors.push(GLEAN_REQUIRED_MSG);
      fieldErrors.humanStrings = GLEAN_REQUIRED_MSG;
    }
    if (GLEAN_STRING_TYPES.indexOf(merged.componentType) < 0) {
      errors.push(GLEAN_REQUIRED_MSG);
      fieldErrors.componentType = GLEAN_REQUIRED_MSG;
    }
    if (merged.timing !== 'Before' && merged.timing !== 'After') {
      errors.push(GLEAN_REQUIRED_MSG);
      fieldErrors.timing = GLEAN_REQUIRED_MSG;
    }
    if (merged.userType !== 'Fleet user' && merged.userType !== 'Driver') {
      errors.push(GLEAN_REQUIRED_MSG);
      fieldErrors.userType = GLEAN_REQUIRED_MSG;
    }
    if (!String(merged.entryPoint || '').trim()) {
      errors.push(GLEAN_REQUIRED_MSG);
      fieldErrors.entryPoint = GLEAN_REQUIRED_MSG;
    }
    if (!String(merged.userGoal || '').trim()) {
      errors.push(GLEAN_REQUIRED_MSG);
      fieldErrors.userGoal = GLEAN_REQUIRED_MSG;
    }
    if (!String(merged.nextStep || '').trim()) {
      errors.push(GLEAN_REQUIRED_MSG);
      fieldErrors.nextStep = GLEAN_REQUIRED_MSG;
    }
    if (merged.prdLink && !isValidGleanUrl(merged.prdLink)) {
      const msg = 'Enter a valid link, like https://…';
      errors.push(msg);
      fieldErrors.prdLink = msg;
    }
    return {
      ok: !errors.length,
      errors: errors,
      fieldErrors: fieldErrors,
      context: merged
    };
  }

  function updateGleanContextValidationUI(options) {
    const opts = options || {};
    const result = validateGleanContextClient();
    const fieldsRoot = panel && panel.querySelector('#vc-glean-context');
    const showErrors = !!(opts.showAll || gleanValidationRequested);
    if (fieldsRoot) {
      fieldsRoot.querySelectorAll('.vp-field').forEach(function (fieldEl) {
        fieldEl.classList.remove('is-invalid');
        const errEl = fieldEl.querySelector('.vp-field-error');
        if (errEl) {
          errEl.textContent = '';
          errEl.classList.add('crank-hidden');
        }
      });
    }
    Object.keys(GLEAN_FIELD_SELECTORS).forEach(function (key) {
      const el = panel && panel.querySelector(GLEAN_FIELD_SELECTORS[key]);
      if (!el) return;
      const message = result.fieldErrors[key] || '';
      const invalid = !!message;
      const fieldEl = el.closest ? el.closest('.vp-field') : null;
      if (fieldEl && invalid && showErrors) {
        fieldEl.classList.add('is-invalid');
        const errEl = fieldEl.querySelector('.vp-field-error');
        if (errEl) {
          errEl.textContent = message;
          errEl.classList.remove('crank-hidden');
        }
      }
      if (el.setAttribute) {
        el.setAttribute('aria-invalid', invalid && showErrors ? 'true' : 'false');
      }
    });
    const errBox = panel && panel.querySelector('#vc-glean-context-errors');
    if (errBox) {
      errBox.className = 'vp-panel-block vp-panel-block--plain crank-hidden';
      errBox.innerHTML = '';
    }
    return result;
  }

  function scrollToFirstGleanFieldError() {
    if (!panel) return;
    const invalid = panel.querySelector('#vc-glean-context .vp-field.is-invalid');
    if (!invalid) return;
    const optionalId = invalid.getAttribute('data-optional-field');
    if (optionalId && !invalid.classList.contains('is-expanded')) {
      revealOptionalGleanField(optionalId, { focus: false });
    }
    const scroller = panel.querySelector('.vp-panel-body');
    if (scroller) {
      const top =
        invalid.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop -
        12;
      scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
    const control = invalid.querySelector('textarea, input:not([type="hidden"]), button');
    if (control && control.focus) control.focus({ preventScroll: true });
  }

  function setGleanFieldValue(selector, value) {
    const el = panel && panel.querySelector(selector);
    if (!el) return;
    el.value = value == null ? '' : String(value);
    if (el.classList && el.classList.contains('vp-textarea-autogrow')) {
      syncTextareaAutoGrow(el);
    }
  }

  function prefillGleanStringsFromSelection(force) {
    const area = panel && panel.querySelector('#vc-glean-strings');
    if (!area) return;
    const draft = formatGleanDraftFromSelection();
    if (!draft) return;
    if (force || !String(area.value || '').trim()) {
      area.value = draft;
      syncGleanStringsDisplay();
    }
  }

  function persistGleanContextFromPanel() {
    const ctx = readGleanContextFromPanel();
    saveGleanContext({
      componentType: ctx.componentType,
      timing: ctx.timing,
      userType: ctx.userType
    });
  }

  function applySelectionToGleanForm() {
    if (!panel) return;
    setGleanFieldValue('#vc-glean-strings', formatGleanDraftFromSelection());
    GLEAN_FREE_TEXT_SELECTORS.forEach(function (selector) {
      setGleanFieldValue(selector, '');
    });
    gleanContextTouched = false;
    gleanValidationRequested = false;
    resetOptionalGleanFieldsUi();
    persistGleanContextFromPanel();
    updateGleanContextValidationUI();
    syncGleanButton();
    scheduleAutogrowSync(panel);
  }

  function closeAllFieldSelects(except) {
    if (!panel) return;
    panel.querySelectorAll('.vp-field-select.is-open').forEach(function (wrap) {
      if (except && wrap === except) return;
      wrap.classList.remove('is-open');
      const trigger = wrap.querySelector('.vp-field-select-trigger');
      if (trigger) {
        trigger.setAttribute('aria-expanded', 'false');
        if (typeof trigger.blur === 'function') {
          trigger.blur();
        }
      }
      const menu = wrap.querySelector('.vp-dropdown-menu');
      if (menu) hideFieldSelectMenu(menu);
      const field = wrap.closest('.vp-field');
      if (field) field.classList.remove('is-active');
      const surface = wrap.querySelector('.vp-input-surface');
      if (surface) surface.removeAttribute('data-active');
    });
  }

  function finishHideFieldSelectMenu(menu) {
    if (!menu || menu.dataset.hideDone === '1') return;
    menu.dataset.hideDone = '1';
    menu.classList.add('crank-hidden');
    menu.classList.remove('vp-dropdown-menu--closing');
    clearFieldSelectMenuAnchor(menu);
    delete menu.dataset.hideDone;
  }

  function hideFieldSelectMenu(menu) {
    if (!menu || menu.classList.contains('crank-hidden')) return;
    if (menu.classList.contains('vp-dropdown-menu--closing')) return;
    menu.classList.add('vp-dropdown-menu--closing');
    const onEnd = function (event) {
      if (!event || event.target !== menu) return;
      const name = String(event.animationName || '');
      if (name.indexOf('vp-dropdown-out') !== 0) return;
      menu.removeEventListener('animationend', onEnd);
      finishHideFieldSelectMenu(menu);
    };
    menu.addEventListener('animationend', onEnd);
    setTimeout(function () {
      finishHideFieldSelectMenu(menu);
    }, 200);
  }

  function clearFieldSelectMenuAnchor(menu) {
    if (!menu) return;
    menu.classList.remove(
      'vp-dropdown-menu--drop-up',
      'vp-dropdown-menu--anchored',
      'vp-dropdown-menu--animate',
      'is-scrolling'
    );
    menu.style.left = '';
    menu.style.width = '';
    menu.style.top = '';
    menu.style.bottom = '';
    menu.style.maxHeight = '';
    menu.style.maxWidth = '';
    menu.style.minWidth = '';
    menu.style.visibility = '';
    menu.style.overflowX = '';
    menu.style.overflowY = '';
    delete menu.dataset.placed;
    delete menu.dataset.animated;
  }

  function bindOverlayScrollbar(el) {
    if (!el || el.__crankOverlayScroll) return;
    el.__crankOverlayScroll = true;
    el.classList.add('vp-overlay-scroll');
    const thumb = document.createElement('div');
    thumb.className = 'vp-overlay-scrollbar';
    thumb.setAttribute('aria-hidden', 'true');
    el.appendChild(thumb);
    let hideTimer = 0;
    function paint() {
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 1) {
        thumb.style.opacity = '0';
        return;
      }
      const track = el.clientHeight;
      const size = Math.max(28, (track / el.scrollHeight) * track);
      const travel = Math.max(0, track - size);
      const top = (el.scrollTop / max) * travel;
      thumb.style.height = size + 'px';
      thumb.style.transform = 'translateY(' + top + 'px)';
    }
    el.addEventListener(
      'scroll',
      function () {
        paint();
        el.classList.add('is-scrolling');
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(function () {
          el.classList.remove('is-scrolling');
        }, 700);
      },
      { passive: true }
    );
  }

  function placeAnchoredSelectMenu(menu, surface, opts) {
    const gap = 6;
    const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
    const first = !menu.dataset.placed;
    menu.classList.add('vp-dropdown-menu--anchored');
    menu.classList.remove('crank-hidden');
    if (first) menu.style.visibility = 'hidden';

    const surfaceRect = surface.getBoundingClientRect();
    menu.style.left = surfaceRect.left + 'px';
    menu.style.width = surfaceRect.width + 'px';
    menu.style.maxWidth = surfaceRect.width + 'px';
    menu.style.minWidth = '0';
    menu.style.boxSizing = 'border-box';
    if (first) menu.style.maxHeight = 'none';
    const natural = menu.scrollHeight;
    const spaceAbove = Math.max(0, surfaceRect.top - gap);
    const spaceBelow = Math.max(0, viewportH - surfaceRect.bottom - gap);
    const openUp = natural <= spaceAbove || spaceAbove >= spaceBelow;
    const available = openUp ? spaceAbove : spaceBelow;
    const needsScroll = natural > available + 1;
    menu.style.maxHeight = needsScroll ? available + 'px' : 'none';
    menu.style.overflowX = 'hidden';
    menu.style.overflowY = needsScroll ? 'auto' : 'hidden';
    if (needsScroll) bindOverlayScrollbar(menu);
    menu.classList.toggle('vp-dropdown-menu--drop-up', openUp);
    if (openUp) {
      menu.style.top = 'auto';
      menu.style.bottom = viewportH - surfaceRect.top + gap + 'px';
    } else {
      menu.style.bottom = 'auto';
      menu.style.top = surfaceRect.bottom + gap + 'px';
    }
    if (first) menu.style.visibility = 'visible';
    menu.dataset.placed = '1';
  }

  function fieldSelectUsesAnchoredMenu(wrap) {
    return !!(wrap && wrap.closest && wrap.closest('.vp-field--option-count'));
  }

  function syncFieldSelectMenuPlacement(wrap, opts) {
    if (!wrap || !panel) return;
    const menu = wrap.querySelector('.vp-dropdown-menu');
    const surface = wrap.querySelector('.vp-input-surface');
    const hidden = wrap.querySelector('.vp-field-select-value');
    if (!menu || !surface) return;

    if (fieldSelectUsesAnchoredMenu(wrap)) {
      placeAnchoredSelectMenu(menu, surface, opts || {});
      return;
    }

    clearFieldSelectMenuAnchor(menu);
    if (menu.classList.contains('crank-hidden')) return;

    const gap = 6;
    const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
    const surfaceRect = surface.getBoundingClientRect();
    const menuH = menu.getBoundingClientRect().height || menu.scrollHeight || 0;
    const spaceBelow = viewportH - surfaceRect.bottom - gap;
    const spaceAbove = surfaceRect.top - gap;

    if (spaceBelow < menuH && spaceAbove >= menuH) {
      menu.classList.add('vp-dropdown-menu--drop-up');
    } else if (spaceBelow < menuH && spaceAbove > spaceBelow) {
      menu.classList.add('vp-dropdown-menu--drop-up');
    }
  }

  function syncFieldSelectUi(wrap) {
    if (!wrap) return;
    const hidden = wrap.querySelector('.vp-field-select-value');
    const triggerLabel = wrap.querySelector('.vp-field-select-label');
    const menu = wrap.querySelector('.vp-dropdown-menu');
    if (!hidden || !menu) return;
    const currentValue = String(hidden.value || '');
    menu.querySelectorAll('.vp-menu-item').forEach(function (item) {
      const isChecked = item.getAttribute('data-value') === currentValue;
      item.classList.toggle('is-checked', isChecked);
      item.setAttribute('aria-checked', isChecked ? 'true' : 'false');
      let check = item.querySelector('.vp-menu-item__check');
      if (isChecked && !check) {
        item.insertAdjacentHTML(
          'beforeend',
          '<svg class="vp-menu-item__check" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.4697 6.46973C18.7626 6.17684 19.2373 6.17684 19.5302 6.46973C19.8231 6.76262 19.8231 7.23738 19.5302 7.53028L9.53022 17.5303C9.23732 17.8232 8.76256 17.8232 8.46967 17.5303L4.46967 13.5303C4.17678 13.2374 4.17678 12.7626 4.46967 12.4697C4.76256 12.1768 5.23732 12.1768 5.53022 12.4697L8.99994 15.9395L18.4697 6.46973Z" fill="currentColor"/></svg>'
        );
      } else if (!isChecked && check) {
        check.remove();
      }
      if (isChecked && triggerLabel) {
        const labelNode = item.querySelector('.vp-menu-item__label');
        triggerLabel.textContent = labelNode ? labelNode.textContent : currentValue;
      }
    });
  }

  function setFieldSelectValue(inputId, value) {
    const hidden = panel && panel.querySelector('#' + inputId);
    if (!hidden) return;
    hidden.value = String(value || '');
    const wrap = hidden.closest('.vp-field-select');
    if (wrap) syncFieldSelectUi(wrap);
  }

  function initFieldControls() {
    if (!panel || panel.__crankFieldControlsInit) return;
    panel.__crankFieldControlsInit = true;

    panel.addEventListener('focusin', function (event) {
      const target = event.target;
      if (
        target &&
        target.closest &&
        target.closest('[data-optional-toggle]')
      ) {
        return;
      }
      const field =
        target && target.closest ? target.closest('.vp-field') : null;
      if (!field || !panel.contains(field)) return;
      field.classList.add('is-active');
      const surface = field.querySelector(
        '[data-crank-part="control-surface"], .vp-input-surface, .vp-control-surface'
      );
      if (surface) surface.setAttribute('data-active', 'true');
    });

    panel.addEventListener('focusout', function (event) {
      const field =
        event.target && event.target.closest
          ? event.target.closest('.vp-field')
          : null;
      if (!field || !panel.contains(field)) return;
      const next = event.relatedTarget;
      if (!next || !field.contains(next)) {
        field.classList.remove('is-active');
        const surface = field.querySelector(
          '[data-crank-part="control-surface"], .vp-input-surface, .vp-control-surface'
        );
        if (surface && !field.contains(document.activeElement)) {
          surface.removeAttribute('data-active');
        }
      }
    });

    panel.addEventListener('click', function (event) {
      const target = event.target;
      if (!target || !target.closest) return;

      const menuItem = target.closest('.vp-menu-item');
      if (menuItem && panel.contains(menuItem) && !menuItem.disabled) {
        event.preventDefault();
        const wrap = menuItem.closest('.vp-field-select');
        const hidden = wrap ? wrap.querySelector('.vp-field-select-value') : null;
        if (hidden) {
          hidden.value = menuItem.getAttribute('data-value') || '';
          syncFieldSelectUi(wrap);
          hidden.dispatchEvent(new Event('change', { bubbles: true }));
          hidden.dispatchEvent(new Event('input', { bubbles: true }));
        }
        closeAllFieldSelects(null);
        return;
      }

      const trigger = target.closest('.vp-field-select-trigger');
      if (trigger && panel.contains(trigger)) {
        event.preventDefault();
        const wrap = trigger.closest('.vp-field-select');
        if (!wrap) return;
        const isOpen = wrap.classList.contains('is-open');
        closeAllFieldSelects(isOpen ? null : wrap);
        if (!isOpen) {
          wrap.classList.add('is-open');
          trigger.setAttribute('aria-expanded', 'true');
          if (fieldSelectUsesAnchoredMenu(wrap)) {
            syncFieldSelectMenuPlacement(wrap, { animate: true });
          } else {
            const menu = wrap.querySelector('.vp-dropdown-menu');
            if (menu) menu.classList.remove('crank-hidden');
            const openWrap = wrap;
            if (typeof requestAnimationFrame === 'function') {
              requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                  syncFieldSelectMenuPlacement(openWrap);
                });
              });
            } else {
              setTimeout(function () {
                syncFieldSelectMenuPlacement(openWrap);
              }, 0);
            }
          }
        }
      }
    });

    if (!panel.__crankFieldSelectRepositionInit) {
      panel.__crankFieldSelectRepositionInit = true;
      const repositionOpenSelectMenus = function () {
        if (!panel) return;
        panel.querySelectorAll('.vp-field-select.is-open').forEach(function (wrap) {
          syncFieldSelectMenuPlacement(wrap);
        });
      };
      panel.addEventListener('scroll', repositionOpenSelectMenus, true);
      window.addEventListener('resize', repositionOpenSelectMenus);
    }

    if (!document.__crankFieldSelectOutsideInit) {
      document.__crankFieldSelectOutsideInit = true;
      document.addEventListener(
        'mousedown',
        function (event) {
          if (!panel) return;
          const target = event.target;
          if (target && target.closest) {
            if (target.closest('.vp-field-select.is-open')) return;
            if (target.closest('.vp-dropdown-menu')) return;
          }
          closeAllFieldSelects(null);
        },
        true
      );
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') closeAllFieldSelects(null);
      });
    }
  }

  function gleanRequiredLabel(text) {
    return text;
  }

  function panelParagraphField(id, extraAttrs, content) {
    const ui = UI();
    const build = ui.vpParagraphFieldHtml || ui.vpTextareaHtml;
    const attrs = Object.assign({ id: id, rows: '1' }, extraAttrs || {});
    return build(attrs, content || '', { autogrow: true, paragraph: true });
  }

  function gleanAutoGrowArea(id, extraAttrs) {
    return panelParagraphField(id, extraAttrs, '');
  }

  function gleanStringsFieldHtml() {
    return panelParagraphField('vc-glean-strings', {
      placeholder: 'Select text on the page or add manually'
    });
  }

  function syncGleanStringsDisplay() {
    if (!panel) return;
    const area = panel.querySelector('#vc-glean-strings');
    if (area && area.classList && area.classList.contains('vp-textarea-autogrow')) {
      syncTextareaAutoGrow(area);
    }
  }

  function gleanOptionalField(label, fieldId, controlHtml, options) {
    const ui = UI();
    const optional =
      ui.vpOptionalFieldHtml ||
      function (lbl, ctrl, opts) {
        return (ui.vpFieldHtml || function (l, c) {
          return '<div>' + l + c + '</div>';
        })(lbl, ctrl, opts);
      };
    return optional(label, controlHtml, Object.assign({ fieldId: fieldId }, options || {}));
  }

  function setOptionalGleanFieldExpanded(fieldId, expanded) {
    if (!panel || !fieldId) return;
    const body = panel.querySelector('[data-optional-body="' + fieldId + '"]');
    const toggle = panel.querySelector('[data-optional-toggle="' + fieldId + '"]');
    const field = panel.querySelector('[data-optional-field="' + fieldId + '"]');
    if (!body || !toggle) return;
    if (expanded) {
      body.classList.remove('crank-hidden');
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('data-optional-state', 'expanded');
      if (field) field.classList.add('is-expanded');
    } else {
      body.classList.add('crank-hidden');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('data-optional-state', 'collapsed');
      if (field) field.classList.remove('is-expanded');
    }
  }

  function revealOptionalGleanField(fieldId, options) {
    const opts = options || {};
    setOptionalGleanFieldExpanded(fieldId, true);
    const body = panel && panel.querySelector('[data-optional-body="' + fieldId + '"]');
    if (body) {
      scheduleAutogrowSync(body);
    }
    if (opts.focus) {
      const input = body && body.querySelector('textarea, input');
      if (input) input.focus();
    }
  }

  function collapseOptionalGleanField(fieldId, options) {
    const opts = options || {};
    if (!panel || !fieldId) return;
    const body = panel.querySelector('[data-optional-body="' + fieldId + '"]');
    if (opts.clear && body) {
      body.querySelectorAll('input, textarea').forEach(function (el) {
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    setOptionalGleanFieldExpanded(fieldId, false);
    if (opts.clear) {
      gleanContextTouched = true;
      persistGleanContextFromPanel();
      updateGleanContextValidationUI();
      syncGleanButton();
    }
  }

  function resetOptionalGleanFieldsUi() {
    if (!panel) return;
    panel.querySelectorAll('[data-optional-field]').forEach(function (fieldEl) {
      const fieldId = fieldEl.getAttribute('data-optional-field');
      if (fieldId) collapseOptionalGleanField(fieldId, { clear: false });
    });
  }

  function syncTextareaAutoGrow(textarea, attempt) {
    if (!textarea || !textarea.classList || !textarea.classList.contains('vp-textarea-autogrow')) {
      return;
    }
    const tries = attempt == null ? 0 : attempt;
    if (textarea.clientWidth < 2) {
      if (tries < 12) {
        setTimeout(function () {
          syncTextareaAutoGrow(textarea, tries + 1);
        }, 50);
      }
      return;
    }
    const surface = textarea.closest('.vp-input-surface--textarea');
    const style = getComputedStyle(textarea);
    const lineH = parseFloat(style.lineHeight) || 18;
    const padY =
      (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const maxH = parseFloat(style.maxHeight);
    const innerMax =
      Number.isFinite(maxH) && maxH > 0
        ? maxH
        : (parseFloat(
            getComputedStyle(document.getElementById('vp-shell') || document.documentElement)
              .getPropertyValue('--vp-textarea-autogrow-max')
          ) || 216);
    const singleLineBox = lineH + padY;

    if (textarea.__crankGrowing) return;
    textarea.__crankGrowing = true;
    textarea.style.minHeight = '0';
    textarea.style.height = '0px';
    const scrollH = textarea.scrollHeight;
    const hardLines = String(textarea.value || '').split('\n').length;
    const contentH = Math.min(Math.max(scrollH, singleLineBox, lineH * hardLines + padY), innerMax);
    const hasHardBreak = hardLines > 1;
    const multiline =
      scrollH > singleLineBox + 1 || (hasHardBreak && scrollH > lineH);
    textarea.style.height = contentH + 'px';
    textarea.style.overflowY = scrollH > innerMax ? 'auto' : 'hidden';

    if (surface) {
      surface.style.height = '';
      surface.style.minHeight = '';
      surface.classList.toggle('is-multiline', multiline);
    }
    textarea.__crankGrowing = false;
    if (panel && panel.__crankGrowResize && textarea.__crankGrowObserved !== true) {
      textarea.__crankGrowObserved = true;
      panel.__crankGrowResize.observe(textarea);
    }
  }

  function syncAllAutoGrowTextareas(root) {
    const scope = root && root.querySelectorAll ? root : panel;
    if (!scope) return;
    scope.querySelectorAll('.vp-textarea-autogrow').forEach(syncTextareaAutoGrow);
  }

  function scheduleAutogrowSync(root) {
    const scope = root && root.querySelectorAll ? root : panel;
    if (!scope) return;
    const run = function () {
      syncAllAutoGrowTextareas(scope);
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(function () {
        requestAnimationFrame(run);
      });
    } else {
      setTimeout(run, 16);
    }
    setTimeout(run, 120);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(run).catch(function () {});
    }
  }

  function bindTextareaAutoGrow() {
    if (!panel || panel.__crankAutoGrowBound) return;
    panel.__crankAutoGrowBound = true;
    panel.addEventListener('input', function (event) {
      const target = event.target;
      if (target && target.classList && target.classList.contains('vp-textarea-autogrow')) {
        syncTextareaAutoGrow(target);
      }
    });
    if (!panel.__crankGrowResize && typeof ResizeObserver === 'function') {
      panel.__crankGrowResize = new ResizeObserver(function (entries) {
        entries.forEach(function (entry) {
          const el = entry.target;
          if (!el || el.__crankGrowing) return;
          if (el.classList && el.classList.contains('vp-textarea-autogrow')) {
            syncTextareaAutoGrow(el);
          }
        });
      });
    }
    if (!panel.__crankGrowWatch && typeof MutationObserver === 'function') {
      panel.__crankGrowWatch = new MutationObserver(function () {
        scheduleAutogrowSync(panel);
      });
      panel.__crankGrowWatch.observe(panel, {
        attributes: true,
        attributeFilter: ['data-crank-view', 'data-crank-step']
      });
    }
  }

  function bindOptionalGleanFields() {
    if (!panel || panel.__crankOptionalGleanBound) return;
    panel.__crankOptionalGleanBound = true;
    panel.addEventListener(
      'mousedown',
      function (event) {
        const btn =
          event.target && event.target.closest
            ? event.target.closest('[data-optional-toggle]')
            : null;
        if (btn && panel.contains(btn)) {
          event.preventDefault();
        }
      },
      true
    );
    panel.addEventListener('click', function (event) {
      const btn =
        event.target && event.target.closest
          ? event.target.closest('[data-optional-toggle]')
          : null;
      if (!btn || !panel.contains(btn)) return;
      const fieldId = btn.getAttribute('data-optional-toggle');
      if (!fieldId) return;
      event.preventDefault();
      const expanded = btn.getAttribute('data-optional-state') === 'expanded';
      if (expanded) {
        collapseOptionalGleanField(fieldId, { clear: false });
      } else {
        revealOptionalGleanField(fieldId, { focus: true });
      }
    });
  }


  function buildGleanContextFormHtml(ui) {
    const field = ui.vpFieldHtml;
    const select = ui.vpFieldSelectHtml || ui.vpSelectHtml;
    const componentOpts = GLEAN_STRING_TYPES.map(function (t) {
      return { value: t, label: t, selected: t === 'General UI string' };
    });
    const timingOpts = [
      {
        value: 'Before',
        label: 'Before: strings shown before user action',
        selected: true
      },
      {
        value: 'After',
        label: 'After: strings shown after user action',
        selected: false
      }
    ];
    const userOpts = [
      { value: 'Fleet user', label: 'Fleet user', selected: true },
      { value: 'Driver', label: 'Driver', selected: false }
    ];

    return (
      '<section class="vp-panel-section-group" id="vc-glean-context">' +
      '<div class="vp-panel-block">' +
      field(
        gleanRequiredLabel('Your string(s)'),
        gleanStringsFieldHtml(),
        { required: true }
      ) +
      field(
        gleanRequiredLabel('Component type'),
        select({ id: 'vc-glean-component-type' }, '', { options: componentOpts }),
        { required: true }
      ) +
      field(
        gleanRequiredLabel('Timing'),
        select({ id: 'vc-glean-timing' }, '', { options: timingOpts }),
        { required: true }
      ) +
      '</div>' +
      '<div class="vp-panel-block">' +
      '<div class="vp-glean-section-head">' +
      '<div class="vp-type-label">Functional requirements</div>' +
      '<p class="vp-subtle" style="margin:0;">Explain this feature to a colleague.</p>' +
      '</div>' +
      field(
        gleanRequiredLabel('Is this for a fleet user or driver?'),
        select({ id: 'vc-glean-user-type' }, '', { options: userOpts }),
        { required: true }
      ) +
      field(
        gleanRequiredLabel('How did they get to this screen?'),
        gleanAutoGrowArea('vc-glean-entry-point'),
        { required: true }
      ) +
      field(
        gleanRequiredLabel('What is the user trying to do?'),
        gleanAutoGrowArea('vc-glean-user-goal'),
        { required: true }
      ) +
      field(
        gleanRequiredLabel('What happens next?'),
        gleanAutoGrowArea('vc-glean-next-step'),
        { required: true }
      ) +
      gleanOptionalField(
        'What are the action options for the user?',
        'vc-glean-action-options',
        gleanAutoGrowArea('vc-glean-action-options')
      ) +
      gleanOptionalField(
        'What do the other existing strings around the component say?',
        'vc-glean-surrounding',
        gleanAutoGrowArea('vc-glean-surrounding')
      ) +
      gleanOptionalField(
        'PRD/PDP link',
        'vc-glean-prd',
        gleanAutoGrowArea('vc-glean-prd', {
          placeholder: 'https://…',
          autocomplete: 'off',
          spellcheck: 'false',
          inputmode: 'url'
        })
      ) +
      gleanOptionalField(
        'Additional context',
        'vc-glean-additional',
        gleanAutoGrowArea('vc-glean-additional')
      ) +
      '</div>' +
      '<div id="vc-glean-context-errors" class="vp-panel-block vp-panel-block--plain crank-hidden"></div>' +
      '</section>'
    );
  }

  function bindGleanContextForm() {
    if (!panel || panel.__crankGleanContextBound) return;
    panel.__crankGleanContextBound = true;
    const ids = [
      '#vc-glean-strings',
      '#vc-glean-component-type',
      '#vc-glean-timing',
      '#vc-glean-user-type',
      '#vc-glean-entry-point',
      '#vc-glean-user-goal',
      '#vc-glean-next-step',
      '#vc-glean-action-options',
      '#vc-glean-surrounding',
      '#vc-glean-prd',
      '#vc-glean-additional'
    ];
    ids.forEach(function (sel) {
      const el = panel.querySelector(sel);
      if (!el) return;
      const onFormChange = function () {
        gleanContextTouched = true;
        persistGleanContextFromPanel();
        updateGleanContextValidationUI();
        syncGleanButton();
      };
      el.addEventListener('input', onFormChange);
      el.addEventListener('change', onFormChange);
    });
    const typeSel = panel.querySelector('#vc-glean-component-type');
    if (typeSel) {
      typeSel.addEventListener('change', function () {
        const def = GLEAN_STRING_TYPE_DEFAULTS[typeSel.value];
        if (def) setFieldSelectValue('vc-glean-timing', def);
        gleanContextTouched = true;
        persistGleanContextFromPanel();
        updateGleanContextValidationUI();
        syncGleanButton();
      });
    }
    const stored = loadGleanContext();
    if (stored.componentType) {
      setFieldSelectValue('vc-glean-component-type', stored.componentType);
    }
    if (stored.timing) setFieldSelectValue('vc-glean-timing', stored.timing);
    if (stored.userType) setFieldSelectValue('vc-glean-user-type', stored.userType);
    persistGleanContextFromPanel();
    panel.querySelectorAll('.vp-field-select').forEach(function (wrap) {
      syncFieldSelectUi(wrap);
    });
    resetOptionalGleanFieldsUi();
    syncGleanStringsDisplay();
    scheduleAutogrowSync(panel);
    updateGleanContextValidationUI();
    syncGleanButton();
  }

  function normalizeRole(role) {
    return String(role || 'text').toLowerCase();
  }

  function isTextLikeRole(role) {
    const r = normalizeRole(role);
    return r === 'text' || r === 'label' || r === 'body';
  }

  function hasSemanticStructure(nodes) {
    return (Array.isArray(nodes) ? nodes : []).some(function (n) {
      const r = normalizeRole(n.role);
      return r === 'heading' || r === 'action' || r === 'button';
    });
  }

  function textLikeNodes(nodes) {
    return (Array.isArray(nodes) ? nodes : []).filter(function (n) {
      return isTextLikeRole(n.role);
    });
  }

  function unitDisplayLabel(node, index, nodes) {
    const list = Array.isArray(nodes) ? nodes : [];
    const role = normalizeRole(node && node.role);
    if (role === 'heading') return 'Heading';
    if (role === 'action' || role === 'button') return 'CTA';
    if (role === 'label') return 'Label';
    const semantic = hasSemanticStructure(list);
    const texts = textLikeNodes(list);
    if (semantic) {
      const bodyIndex = texts.findIndex(function (n) {
        return n === node;
      });
      if (bodyIndex >= 0) {
        return texts.length > 1 ? 'Body ' + (bodyIndex + 1) : 'Body';
      }
    }
    if (list.length <= 1) return 'Copy 1';
    return 'Copy ' + (index + 1);
  }

  function assignUnitLabels(nodes) {
    const list = Array.isArray(nodes) ? nodes : [];
    return list.map(function (node, index) {
      return Object.assign({}, node, {
        label: node.label || unitDisplayLabel(node, index, list)
      });
    });
  }

  function getGleanOptionCount() {
    const sel = panel && panel.querySelector('#vc-settings-option-count');
    const raw = sel ? sel.value : localStorage.getItem(OPTION_COUNT_KEY);
    const n = parseInt(String(raw || DEFAULT_GLEAN_OPTION_COUNT), 10);
    if (!Number.isFinite(n)) return DEFAULT_GLEAN_OPTION_COUNT;
    return Math.min(GLEAN_OPTION_COUNT_MAX, Math.max(GLEAN_OPTION_COUNT_MIN, n));
  }

  const highlight = document.createElement('div');
  highlight.id = 'crank-highlight';
  highlight.style.cssText =
    'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid oklch(0.45 0.08 180);background:oklch(0.7 0.06 180 / 0.12);border-radius:3px;transition:all 80ms ease;';

  const panel = document.createElement('div');
  panel.id = 'vp-shell';
  panel.setAttribute('data-crank-panel', '1');
  panel.setAttribute('data-crank-surface', 'crank');
  panel.style.cssText =
    'position:fixed;top:16px;right:16px;width:380px;height:calc(100vh - 32px);max-height:calc(100vh - 32px);overflow:hidden;z-index:2147483647;overscroll-behavior:none;';
  panel.addEventListener(
    'wheel',
    function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      let node = ev.target && ev.target.nodeType === 1 ? ev.target : ev.target && ev.target.parentElement;
      while (node && node !== panel) {
        const canY = node.scrollHeight > node.clientHeight + 1;
        const canX = node.scrollWidth > node.clientWidth + 1;
        if (canY || canX) {
          const cs = window.getComputedStyle(node);
          const sc = function (o) {
            return o === 'auto' || o === 'scroll' || o === 'overlay';
          };
          if ((canY && sc(cs.overflowY)) || (canX && sc(cs.overflowX))) {
            const dx = ev.deltaX || (ev.shiftKey && !canY ? ev.deltaY : 0);
            if (canY && sc(cs.overflowY) && !(ev.shiftKey && !ev.deltaX)) node.scrollTop += ev.deltaY;
            if (dx && canX && sc(cs.overflowX)) node.scrollLeft += dx;
            return;
          }
        }
        node = node.parentElement;
      }
      const body = panel.querySelector('#vp-body');
      if (body) body.scrollTop += ev.deltaY;
    },
    { passive: false, capture: true }
  );

  function UI() {
    return window.CrankUI || {};
  }
  function TS() {
    return window.CrankTextSource || {};
  }

  // Short phrase for the *current* Cursor chat — paste once; skill/MCP pulls pending.
  // Cursor has no public API to inject into an open Composer; deeplink opens a *new* chat.
  const AGENT_SHORT_PROMPT = 'Apply the pending Crank change';
  const COMPANION_AGENT_PHRASE = 'Start the Crank companion';
  const PASTE_IN_AGENT_CHAT = 'paste in your agent chat';
  const CURSOR_DEEPLINK_MAX = 7800;

  function isReplitHost() {
    try {
      return /\.replit\.dev$|\.repl\.co$|\.replit\.app$/i.test(
        String(window.location.hostname || '')
      );
    } catch (_) {
      return false;
    }
  }

  function normalizePanelChannel(raw) {
    const s = String(raw || 'production')
      .trim()
      .toLowerCase();
    if (s === 'preview' || s === 'beta' || s === 'staging') {
      return 'preview';
    }
    return 'production';
  }

  function getPanelChannel() {
    return normalizePanelChannel(
      window.__CRANK_PANEL_CHANNEL__ ||
        window.__CRANK_CHANNEL__ ||
        (document.querySelector('script[data-crank-bundled="1"]') &&
          document
            .querySelector('script[data-crank-bundled="1"]')
            .getAttribute('data-crank-panel-channel')) ||
        'production'
    );
  }

  function companionStartCommand() {
    if (getPanelChannel() === 'preview') {
      return isReplitHost()
        ? 'npx @ahmednawaz/crank@preview start --preview'
        : 'npx @ahmednawaz/crank@preview --preview';
    }
    return isReplitHost()
      ? 'npx @ahmednawaz/crank start'
      : 'npx @ahmednawaz/crank';
  }

  function companionFirstTimeCommand() {
    if (getPanelChannel() === 'preview') {
      return 'npx @ahmednawaz/crank@preview --preview';
    }
    return 'npx @ahmednawaz/crank@latest';
  }

  let companionRetryTimer = null;

  function stopCompanionAutoRetry() {
    if (companionRetryTimer) {
      clearInterval(companionRetryTimer);
      companionRetryTimer = null;
    }
  }

  function startCompanionAutoRetry() {
    if (companionRetryTimer) return;
    companionRetryTimer = setInterval(function () {
      const box = panel && panel.querySelector('#vc-companion-offline');
      if (!panel || !box || box.classList.contains('crank-hidden') || uiMode !== 'panel') {
        stopCompanionAutoRetry();
        return;
      }
      reconnectCompanionInBackground();
    }, 4000);
  }

  function setCompanionOfflineState(offline) {
    const changed = companionOffline !== offline;
    companionOffline = offline;
    if (!panel) return;
    if (offline) panel.setAttribute('data-crank-offline', '1');
    else panel.removeAttribute('data-crank-offline');
    if (changed && panel.getAttribute('data-crank-view') === 'history') loadHistoryList();
  }

  function showCompanionOfflineUI() {
    if (!panel || uiMode !== 'panel') return;
    ensurePanelMounted();
    const box = panel.querySelector('#vc-companion-offline');
    if (box) {
      box.classList.remove('crank-hidden');
      box.style.display = 'block';
    }
    setCompanionOfflineState(true);
    syncOfflineCommandText();
    startCompanionAutoRetry();
  }

  function hideCompanionOfflineUI() {
    stopCompanionAutoRetry();
    const box = panel && panel.querySelector('#vc-companion-offline');
    if (box) {
      box.classList.add('crank-hidden');
      box.style.display = 'none';
    }
    setCompanionOfflineState(false);
  }

  function setAgentStatus(mode, text) {
    const el = panel && panel.querySelector('#vc-agent-status');
    if (!el) return;
    const offline = mode === 'offline';
    el.classList.toggle('is-offline', offline);
    el.classList.toggle('is-running', !offline && mode !== 'checking');
    el.classList.toggle('is-checking', mode === 'checking');
    el.textContent =
      text ||
      (offline
        ? 'Agent not running'
        : 'Agent running');
  }

  let companionReconnectBusy = false;
  let companionCopyTimer = null;

  function syncOfflineCommandText() {
    const code = panel && panel.querySelector('#vc-companion-command');
    if (code) code.textContent = companionStartCommand();
  }

  async function copyCompanionCommand() {
    const btnEl = panel && panel.querySelector('#vc-companion-copy');
    const ok = await copyTextToClipboard(companionStartCommand());
    if (!ok) {
      showToast('Could not copy — select the command above', 'error');
      return;
    }
    if (!btnEl) return;
    if (companionCopyTimer) clearTimeout(companionCopyTimer);
    btnEl.textContent = 'Copied';
    companionCopyTimer = setTimeout(function () {
      companionCopyTimer = null;
      btnEl.textContent = 'Copy command';
    }, 1500);
  }

  /** Background reconnect: probe /health (3s timeout) while the offline banner is shown. */
  async function reconnectCompanionInBackground() {
    if (companionReconnectBusy) return;
    const probe =
      typeof window.__crankProbeCompanion === 'function'
        ? window.__crankProbeCompanion
        : null;
    if (!probe) return;
    companionReconnectBusy = true;
    let ok = false;
    try {
      ok = await probe();
    } catch (_) {
      ok = false;
    } finally {
      companionReconnectBusy = false;
    }
    if (ok) {
      hideCompanionOfflineUI();
      showToast('Companion connected — you can Ask Glean', 'ok');
      syncGleanButton();
      try {
        connectWs();
      } catch (_) {}
      try {
        if (panel && panel.getAttribute('data-crank-view') === 'history') loadHistoryList();
      } catch (_) {}
      checkPanelUpdate(COMPANION_HTTP, { quiet: true });
    }
  }

  function parseSemverPart(version) {
    const m = String(version || '0.0.0').match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!m) return [0, 0, 0];
    return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
  }

  function semverGreater(a, b) {
    const aa = parseSemverPart(a);
    const bb = parseSemverPart(b);
    for (let i = 0; i < 3; i++) {
      if (aa[i] > bb[i]) return true;
      if (aa[i] < bb[i]) return false;
    }
    return false;
  }

  function panelInUse() {
    return (
      selecting ||
      uiMode === 'panel' ||
      !!sessionId ||
      !!selectedEl ||
      !!pendingSelectionPayload
    );
  }

  function panelAutoUpdateEnabled() {
    if (window.__CRANK_PANEL_AUTO_UPDATE__ === false) return false;
    if (window.__CRANK_PANEL_UPDATE_DISABLED__) return false;
    if (window.__CRANK_PANEL_UPDATE_RELOAD__) return false;
    return !!document.querySelector('script[data-crank-bundled="1"]');
  }

  function reloadPanelFromCompanion(companionUrl, remoteVersion) {
    if (panelInUse()) {
      return;
    }
    const base = String(companionUrl || COMPANION_HTTP).replace(/\/$/, '');
    window.__CRANK_COMPANION__ = base;
    window.__CRANK_PANEL_UPDATE_RELOAD__ = true;
    showToast('Updating Crank panel to v' + (remoteVersion || 'latest') + '…', 'info');
    setStatus('Updating Crank panel…');
    if (typeof window.__crankTeardown === 'function') {
      try {
        window.__crankTeardown();
      } catch (_) {}
    }
    document.querySelectorAll('script[data-crank-loader="1"]').forEach(function (el) {
      try {
        el.remove();
      } catch (_) {}
    });
    window.__CRANK_LOADER__ = false;
    window.__CRANK_BOOTING__ = false;
    window.__crankActive = false;
    const s = document.createElement('script');
    s.src =
      base +
      '/bookmarklet.js?v=' +
      encodeURIComponent(remoteVersion || String(Date.now()));
    s.async = true;
    s.dataset.crankLoader = '1';
    s.onerror = function () {
      showToast(
        'Panel update failed — refresh the page or run npm update @ahmednawaz/crank',
        'error'
      );
      setStatus('Panel update failed — refresh the page');
    };
    document.documentElement.appendChild(s);
  }

  async function checkPanelUpdate(companionUrl, options) {
    const opts = options || {};
    if (!panelAutoUpdateEnabled()) return false;
    if (panelInUse()) return false;
    const localVersion = window.__CRANK_PANEL_VERSION__ || '0.0.0';
    const base = String(companionUrl || COMPANION_HTTP).replace(/\/$/, '');
    try {
      const resp = await fetch(base + '/health', {
        cache: 'no-store',
        headers: authHeaders()
      });
      const data = await resp.json().catch(function () {
        return {};
      });
      if (!resp.ok || !data || data.ok === false) return false;
      const remoteVersion =
        data.panelVersion || data.version || localVersion;
      const remoteChannel = normalizePanelChannel(data.channel || 'production');
      const localChannel = getPanelChannel();
      window.__CRANK_COMPANION_PANEL_VERSION__ = remoteVersion;
      if (localChannel !== remoteChannel) {
        return false;
      }
      if (!semverGreater(remoteVersion, localVersion)) {
        return false;
      }
      if (!opts.quiet) {
        console.info(
          '[Crank] Panel update available:',
          localVersion,
          '→',
          remoteVersion
        );
      }
      reloadPanelFromCompanion(base, remoteVersion);
      return true;
    } catch (_) {
      return false;
    }
  }

  function schedulePanelAutoUpdate(companionUrl) {
    if (!panelAutoUpdateEnabled()) return;
    if (window.__CRANK_PANEL_UPDATE_SCHEDULED__) return;
    window.__CRANK_PANEL_UPDATE_SCHEDULED__ = true;
    const base = String(companionUrl || COMPANION_HTTP).replace(/\/$/, '');
    const intervalMs = Number(window.__CRANK_PANEL_UPDATE_INTERVAL_MS || 300000);
    function tick() {
      checkPanelUpdate(base, { quiet: true });
    }
    if (window.__CRANK_PANEL_UPDATE_TIMER__) {
      clearInterval(window.__CRANK_PANEL_UPDATE_TIMER__);
    }
    window.__CRANK_PANEL_UPDATE_TIMER__ = setInterval(tick, intervalMs);
    if (!window.__CRANK_PANEL_VISIBILITY_BOUND__) {
      window.__CRANK_PANEL_VISIBILITY_BOUND__ = true;
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') {
          tick();
        }
      });
    }
  }

  function getFabLogoUrl() {
    if (window.__CRANK_GLEAN_LOGO__) {
      return String(window.__CRANK_GLEAN_LOGO__);
    }
    return assetUrl('glean-logo.png', '/ui/glean-logo.png');
  }

  function fabLogoMaskStyle() {
    const url = String(getFabLogoUrl())
      .replace(/&/g, '&amp;')
      .replace(/"/g, '%22')
      .replace(/</g, '%3C')
      .replace(/>/g, '%3E');
    return '--crank-fab-logo:url(&quot;' + url + '&quot;)';
  }

  function isCrankChrome(el) {
    if (!(el instanceof Element)) return false;
    return !!(
      el.closest('#vp-shell') ||
      el.closest('#vp-crank-launcher') ||
      el.closest('#vp-crank-fab') ||
      el.closest('#vp-crank-select-hint') ||
      el.closest('#vp-crank-tooltip') ||
      el.closest('#vp-crank-reopen') ||
      el.id === 'crank-highlight'
    );
  }

  function eventInCrankChrome(ev) {
    const path = ev && typeof ev.composedPath === 'function' ? ev.composedPath() : [];
    for (let i = 0; i < path.length; i += 1) {
      const node = path[i];
      if (node === panel || node === launcher) return true;
      if (node instanceof Element && isCrankChrome(node)) return true;
    }
    const target = ev && ev.target;
    if (target instanceof Element) {
      // A node re-rendered mid-click (e.g. a history card) is detached; never treat it as page copy.
      if (!target.isConnected) return true;
      if ((panel && panel.contains(target)) || (launcher && launcher.contains(target))) return true;
    }
    return false;
  }

  function toolIcon(name) {
    const open =
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">';
    const close = '</svg>';
    const paths = {
      select:
        '<path d="M16.5744 19.1999L12.6361 15.2616L11.4334 16.4643C10.2022 17.6955 9.58656 18.3111 8.92489 18.1658C8.26322 18.0204 7.96225 17.2035 7.3603 15.5696L5.3527 10.1205C4.15187 6.86106 3.55146 5.23136 4.39141 4.39141C5.23136 3.55146 6.86106 4.15187 10.1205 5.35271L15.5696 7.3603C17.2035 7.96225 18.0204 8.26322 18.1658 8.92489C18.3111 9.58656 17.6955 10.2022 16.4643 11.4334L15.2616 12.6361L19.1999 16.5744C19.6077 16.9821 19.8116 17.186 19.9058 17.4135C20.0314 17.7168 20.0314 18.0575 19.9058 18.3608C19.8116 18.5882 19.6077 18.7921 19.1999 19.1999C18.7921 19.6077 18.5882 19.8116 18.3608 19.9058C18.0575 20.0314 17.7168 20.0314 17.4135 19.9058C17.186 19.8116 16.9821 19.6077 16.5744 19.1999Z" fill="currentColor"/>',
      history:
        '<path d="M12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2ZM12 7.25C11.5858 7.25 11.25 7.58579 11.25 8V12C11.25 12.1989 11.3291 12.3896 11.4697 12.5303L13.9697 15.0303C14.2626 15.3232 14.7374 15.3232 15.0303 15.0303C15.3232 14.7374 15.3232 14.2626 15.0303 13.9697L12.75 11.6895V8C12.75 7.58579 12.4142 7.25 12 7.25Z" fill-rule="evenodd" clip-rule="evenodd" fill="currentColor"/>',
      settings:
        '<path d="M14.2788 2.15224C13.9085 2 13.439 2 12.5 2C11.561 2 11.0915 2 10.7212 2.15224C10.2274 2.35523 9.83509 2.74458 9.63056 3.23463C9.53719 3.45834 9.50065 3.7185 9.48635 4.09799C9.46534 4.65568 9.17716 5.17189 8.69017 5.45093C8.20318 5.72996 7.60864 5.71954 7.11149 5.45876C6.77318 5.2813 6.52789 5.18262 6.28599 5.15102C5.75609 5.08178 5.22018 5.22429 4.79616 5.5472C4.47814 5.78938 4.24339 6.1929 3.7739 6.99993C3.30441 7.80697 3.06967 8.21048 3.01735 8.60491C2.94758 9.1308 3.09118 9.66266 3.41655 10.0835C3.56506 10.2756 3.77377 10.437 4.0977 10.639C4.57391 10.936 4.88032 11.4419 4.88029 12C4.88026 12.5581 4.57386 13.0639 4.0977 13.3608C3.77372 13.5629 3.56497 13.7244 3.41645 13.9165C3.09108 14.3373 2.94749 14.8691 3.01725 15.395C3.06957 15.7894 3.30432 16.193 3.7738 17C4.24329 17.807 4.47804 18.2106 4.79606 18.4527C5.22008 18.7756 5.75599 18.9181 6.28589 18.8489C6.52778 18.8173 6.77305 18.7186 7.11133 18.5412C7.60852 18.2804 8.2031 18.27 8.69012 18.549C9.17714 18.8281 9.46533 19.3443 9.48635 19.9021C9.50065 20.2815 9.53719 20.5417 9.63056 20.7654C9.83509 21.2554 10.2274 21.6448 10.7212 21.8478C11.0915 22 11.561 22 12.5 22C13.439 22 13.9085 22 14.2788 21.8478C14.7726 21.6448 15.1649 21.2554 15.3694 20.7654C15.4628 20.5417 15.4994 20.2815 15.5137 19.902C15.5347 19.3443 15.8228 18.8281 16.3098 18.549C16.7968 18.2699 17.3914 18.2804 17.8886 18.5412C18.2269 18.7186 18.4721 18.8172 18.714 18.8488C19.2439 18.9181 19.7798 18.7756 20.2038 18.4527C20.5219 18.2105 20.7566 17.807 21.2261 16.9999C21.6956 16.1929 21.9303 15.7894 21.9827 15.395C22.0524 14.8691 21.9088 14.3372 21.5835 13.9164C21.4349 13.7243 21.2262 13.5628 20.9022 13.3608C20.4261 13.0639 20.1197 12.558 20.1197 11.9999C20.1197 11.4418 20.4261 10.9361 20.9022 10.6392C21.2263 10.4371 21.435 10.2757 21.5836 10.0835C21.9089 9.66273 22.0525 9.13087 21.9828 8.60497C21.9304 8.21055 21.6957 7.80703 21.2262 7C20.7567 6.19297 20.522 5.78945 20.2039 5.54727C19.7799 5.22436 19.244 5.08185 18.7141 5.15109C18.4722 5.18269 18.2269 5.28136 17.8887 5.4588C17.3915 5.71959 16.7969 5.73002 16.3099 5.45096C15.8229 5.17191 15.5347 4.65566 15.5136 4.09794C15.4993 3.71848 15.4628 3.45833 15.3694 3.23463C15.1649 2.74458 14.7726 2.35523 14.2788 2.15224ZM12.5 15C14.1695 15 15.5228 13.6569 15.5228 12C15.5228 10.3431 14.1695 9 12.5 9C10.8305 9 9.47716 10.3431 9.47716 12C9.47716 13.6569 10.8305 15 12.5 15Z" fill-rule="evenodd" clip-rule="evenodd" fill="currentColor"/>',
      dock:
        '<path d="M2 18C2 16.1144 2 15.1716 2.58579 14.5858C3.17157 14 4.11438 14 6 14C7.88562 14 8.82843 14 9.41421 14.5858C10 15.1716 10 16.1144 10 18C10 19.8856 10 20.8284 9.41421 21.4142C8.82843 22 7.88562 22 6 22C4.11438 22 3.17157 22 2.58579 21.4142C2 20.8284 2 19.8856 2 18Z" fill="currentColor"/><path d="M3.46447 3.46447C2 4.92893 2 7.28595 2 12C2 12.3956 2 12.7746 2.00087 13.1378C2.50896 12.8047 3.06882 12.6588 3.6056 12.5866C4.25122 12.4998 5.04488 12.4999 5.91052 12.5H6.08951C6.95514 12.4999 7.74881 12.4998 8.39443 12.5866C9.10539 12.6822 9.85684 12.9071 10.4749 13.5251C11.0929 14.1432 11.3178 14.8946 11.4134 15.6056C11.5002 16.2512 11.5001 17.0449 11.5 17.9105V18.0895C11.5001 18.9552 11.5002 19.7488 11.4134 20.3944C11.3412 20.9312 11.1954 21.491 10.8622 21.9991C11.2255 22 11.6044 22 12 22C16.714 22 19.0711 22 20.5355 20.5355C22 19.0711 22 16.714 22 12C22 7.28595 22 4.92893 20.5355 3.46447C19.0711 2 16.714 2 12 2C7.28595 2 4.92893 2 3.46447 3.46447ZM13.25 6.25C12.8358 6.25 12.5 6.58579 12.5 7C12.5 7.41421 12.8358 7.75 13.25 7.75H15.1893L11.4697 11.4697C11.1768 11.7626 11.1768 12.2374 11.4697 12.5303C11.7626 12.8232 12.2374 12.8232 12.5303 12.5303L16.25 8.81066V10.75C16.25 11.1642 16.5858 11.5 17 11.5C17.4142 11.5 17.75 11.1642 17.75 10.75V7C17.75 6.58579 17.4142 6.25 17 6.25H13.25Z" fill-rule="evenodd" clip-rule="evenodd" fill="currentColor"/>',
      undock:
        '<path d="M2 18C2 16.1144 2 15.1716 2.58579 14.5858C3.17157 14 4.11438 14 6 14C7.88562 14 8.82843 14 9.41421 14.5858C10 15.1716 10 16.1144 10 18C10 19.8856 10 20.8284 9.41421 21.4142C8.82843 22 7.88562 22 6 22C4.11438 22 3.17157 22 2.58579 21.4142C2 20.8284 2 19.8856 2 18Z" fill="currentColor"/><path d="M3.46447 3.46447C2 4.92893 2 7.28595 2 12C2 12.3956 2 12.7746 2.00087 13.1378C2.50896 12.8047 3.06882 12.6588 3.6056 12.5866C4.25122 12.4998 5.04488 12.4999 5.91052 12.5H6.08951C6.95514 12.4999 7.74881 12.4998 8.39443 12.5866C9.10539 12.6822 9.85684 12.9071 10.4749 13.5251C11.0929 14.1432 11.3178 14.8946 11.4134 15.6056C11.5002 16.2512 11.5001 17.0449 11.5 17.9105V18.0895C11.5001 18.9552 11.5002 19.7488 11.4134 20.3944C11.3412 20.9312 11.1954 21.491 10.8622 21.9991C11.2255 22 11.6044 22 12 22C16.714 22 19.0711 22 20.5355 20.5355C22 19.0711 22 16.714 22 12C22 7.28595 22 4.92893 20.5355 3.46447C19.0711 2 16.714 2 12 2C7.28595 2 4.92893 2 3.46447 3.46447ZM15.75 12.75C16.1642 12.75 16.5 12.4142 16.5 12C16.5 11.5858 16.1642 11.25 15.75 11.25H13.8107L17.5303 7.53033C17.8232 7.23744 17.8232 6.76256 17.5303 6.46967C17.2374 6.17678 16.7626 6.17678 16.4697 6.46967L12.75 10.1893V8.25C12.75 7.83579 12.4142 7.5 12 7.5C11.5858 7.5 11.25 7.83579 11.25 8.25V12C11.25 12.4142 11.5858 12.75 12 12.75H15.75Z" fill-rule="evenodd" clip-rule="evenodd" fill="currentColor"/>',
      clear:
        '<path d="M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12ZM8.96963 8.96965C9.26252 8.67676 9.73739 8.67676 10.0303 8.96965L12 10.9393L13.9696 8.96967C14.2625 8.67678 14.7374 8.67678 15.0303 8.96967C15.3232 9.26256 15.3232 9.73744 15.0303 10.0303L13.0606 12L15.0303 13.9696C15.3232 14.2625 15.3232 14.7374 15.0303 15.0303C14.7374 15.3232 14.2625 15.3232 13.9696 15.0303L12 13.0607L10.0303 15.0303C9.73742 15.3232 9.26254 15.3232 8.96965 15.0303C8.67676 14.7374 8.67676 14.2625 8.96965 13.9697L10.9393 12L8.96963 10.0303C8.67673 9.73742 8.67673 9.26254 8.96963 8.96965Z" fill-rule="evenodd" clip-rule="evenodd" fill="currentColor"/>',
      close:
        '<path d="M18.4765 4.46967C18.7694 4.17683 19.2442 4.1768 19.5371 4.46967C19.8299 4.76255 19.8299 5.23734 19.5371 5.53022L13.0634 12.0029L19.5302 18.4697C19.823 18.7626 19.8231 19.2374 19.5302 19.5302C19.2374 19.8231 18.7626 19.823 18.4697 19.5302L12.0029 13.0634L5.53705 19.5302C5.24417 19.823 4.76938 19.823 4.47651 19.5302C4.18363 19.2373 4.18367 18.7626 4.47651 18.4697L10.9423 12.0029L4.46967 5.53022C4.17678 5.23732 4.17678 4.76256 4.46967 4.46967C4.76256 4.17678 5.23732 4.17678 5.53022 4.46967L12.0029 10.9423L18.4765 4.46967Z" fill="currentColor"/>'
    };
    return open + (paths[name] || paths.close) + close;
  }

  function ensureFab() {
    if (launcher && launcher.isConnected) return fab;
    if (launcher) {
      document.documentElement.appendChild(launcher);
      fab = launcher.querySelector('#vp-crank-fab');
      syncLauncher();
      return fab;
    }
    launcher = document.createElement('div');
    launcher.id = 'vp-crank-launcher';
    launcher.innerHTML =
      '<div class="vp-crank-bar" role="toolbar" aria-label="Crank">' +
      '<div class="vp-crank-tools">' +
      '<button type="button" class="vp-crank-tool vp-crank-tool--cap" data-crank-tool="select" data-tip="Select" aria-label="Select">' +
      toolIcon('select') +
      '</button>' +
      '<button type="button" class="vp-crank-tool" data-crank-tool="history" data-tip="History" aria-label="History">' +
      toolIcon('history') +
      '</button>' +
      '<button type="button" class="vp-crank-tool" data-crank-tool="settings" data-tip="Settings" aria-label="Settings">' +
      toolIcon('settings') +
      '</button>' +
      '<span class="vp-crank-sep" aria-hidden="true"></span>' +
      '<button type="button" class="vp-crank-tool" id="vp-crank-dock" data-crank-tool="dock" data-tip="Dock" aria-label="Dock">' +
      toolIcon('dock') +
      '</button>' +
      '<button type="button" class="vp-crank-tool" data-crank-tool="clear" data-tip="Clear" aria-label="Clear">' +
      toolIcon('clear') +
      '</button>' +
      '<button type="button" class="vp-crank-tool" data-crank-tool="close" data-tip="Close" aria-label="Close">' +
      toolIcon('close') +
      '</button>' +
      '</div>' +
      '<button type="button" id="vp-crank-fab" class="vp-crank-fab" aria-label="Open Crank">' +
      '<span class="vp-crank-fab-mark" style="' +
      fabLogoMaskStyle() +
      '"></span>' +
      '</button>' +
      '</div>';
    fab = launcher.querySelector('#vp-crank-fab');
    fab.addEventListener('click', function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      if (ev && ev.stopPropagation) ev.stopPropagation();
      if (!toolbarOpen) expandToolbar();
    });
    launcher.addEventListener('pointerover', function (ev) {
      const btn = ev.target && ev.target.closest ? ev.target.closest('[data-tip]') : null;
      if (!btn || !launcher.contains(btn)) return;
      showCrankTooltip(btn);
    });
    launcher.addEventListener('pointerout', function (ev) {
      const btn = ev.target && ev.target.closest ? ev.target.closest('[data-tip]') : null;
      if (!btn || !launcher.contains(btn)) return;
      const next = ev.relatedTarget;
      if (next && btn.contains(next)) return;
      hideCrankTooltip();
    });
    launcher.addEventListener('click', function (ev) {
      hideCrankTooltip();
      const btn = ev.target && ev.target.closest ? ev.target.closest('[data-crank-tool]') : null;
      if (!btn || !launcher.contains(btn)) return;
      if (ev.preventDefault) ev.preventDefault();
      if (ev.stopPropagation) ev.stopPropagation();
      const tool = btn.getAttribute('data-crank-tool');
      if (tool === 'dock') {
        togglePanelDock();
        return;
      }
      activateTool(tool);
    });
    document.documentElement.appendChild(launcher);
    syncChromeIcons();
    syncLauncher();
    return fab;
  }

  function syncLauncher() {
    if (!launcher) return;
    const inPanel = toolbarLivesInDock();
    if (inPanel) toolbarOpen = true;
    launcher.classList.toggle('is-expanded', !!toolbarOpen);
    launcher.querySelectorAll('[data-crank-tool]').forEach(function (btn) {
      const name = btn.getAttribute('data-crank-tool');
      const on = !!toolbarOpen && (name === 'select' || name === 'history' || name === 'settings') && name === activeTool;
      btn.classList.toggle('is-active', on);
      if (name === 'select' || name === 'history' || name === 'settings') {
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    });
    parkLauncher();
    positionLauncher();
  }

  function toolbarLivesInDock() {
    return !!(panel && panel.parentNode && readPanelDocked() && panel.querySelector('#vc-chrome-footer'));
  }

  function parkLauncher() {
    if (!launcher) return;
    const footer = toolbarLivesInDock() ? panel.querySelector('#vc-chrome-footer') : null;
    if (footer) {
      if (launcher.parentNode !== footer) footer.appendChild(launcher);
      launcher.classList.add('is-in-panel');
      launcher.classList.add('is-expanded');
      toolbarOpen = true;
      return;
    }
    if (launcher.parentNode !== document.documentElement) {
      document.documentElement.appendChild(launcher);
    }
    launcher.classList.remove('is-in-panel');
  }

  function positionLauncher() {
    if (!launcher) return;
    launcher.style.left = '';
    launcher.style.right = '';
    launcher.style.transform = '';
    if (launcher.classList.contains('is-in-panel')) {
      launcher.classList.remove('is-beside-panel');
      launcher.style.bottom = '';
    } else {
      const floatingPanel = !!(panel && panel.parentNode && !readPanelDocked());
      launcher.classList.toggle('is-beside-panel', floatingPanel);
      launcher.style.bottom = '20px';
    }
    if (selectHint && selectHint.style.display !== 'none') {
      if (panel && panel.parentNode) {
        selectHint.style.right = 'calc(' + PANEL_DOCK_WIDTH + ' + 16px)';
        selectHint.style.bottom = '20px';
      } else {
        selectHint.style.right = '20px';
        selectHint.style.bottom = '72px';
      }
    }
  }

  function showFab() {
    ensureFab();
    if (launcher) launcher.hidden = false;
    syncLauncher();
  }

  function hideFab() {
    if (launcher) launcher.hidden = true;
  }

  function setFabActive(active) {
    if (!fab) return;
    fab.classList.toggle('vp-crank-fab--active', !!active);
  }

  function expandToolbar() {
    ensureFab();
    toolbarOpen = true;
    activeTool = 'select';
    syncLauncher();
    armSelection();
  }

  function clearSelection() {
    restoreOriginal();
    resetSessionState();
    if (panel) {
      setGleanFieldValue('#vc-glean-strings', '');
      GLEAN_FREE_TEXT_SELECTORS.forEach(function (selector) {
        setGleanFieldValue(selector, '');
      });
      gleanContextTouched = false;
      gleanValidationRequested = false;
      resetOptionalGleanFieldsUi();
      renderLayerList();
      if (panel.parentNode) {
        setPanelSurface('crank');
        setPanelStep('ask');
      }
      updateGleanContextValidationUI();
      syncGleanButton();
    }
    activeTool = 'select';
    if (toolbarOpen) armSelection();
    else syncLauncher();
    setStatus('Selection cleared');
  }

  function collapseToolbar() {
    toolbarOpen = false;
    activeTool = 'select';
    stopSelect();
    hideSelectHint();
    if (panel && panel.parentNode) {
      panel.removeAttribute('data-crank-view');
    }
    closePanel();
    syncLauncher();
  }

  function activateTool(tool) {
    returnToHistory = false;
    if (tool === 'close') {
      collapseToolbar();
      return;
    }
    if (tool === 'clear') {
      clearSelection();
      return;
    }
    toolbarOpen = true;
    activeTool = tool || 'select';
    if (activeTool === 'select') {
      if (panel) panel.setAttribute('data-crank-view', 'copy');
      armSelection();
      syncLauncher();
      return;
    }
    stopSelect();
    hideSelectHint();
    ensurePanelMounted();
    uiMode = 'panel';
    panel.setAttribute('data-crank-view', activeTool);
    positionLauncher();
    if (activeTool === 'history') loadHistoryList();
    if (activeTool === 'settings') syncSettingsControls();
    syncLauncher();
  }

  function armSelection() {
    if (selecting) return;
    uiMode = 'selecting';
    showSelectHint('Click a layout on the page · Esc to cancel');
    startSelect();
  }

  function showSelectHint(text) {
    const msg = String(text || '').trim();
    if (!msg) {
      hideSelectHint();
      return;
    }
    if (!selectHint) {
      selectHint = document.createElement('div');
      selectHint.id = 'vp-crank-select-hint';
      selectHint.className = 'vp-crank-select-hint';
      selectHint.setAttribute('role', 'status');
      document.documentElement.appendChild(selectHint);
    }
    selectHint.textContent = msg;
    selectHint.style.display = 'block';
  }

  function hideSelectHint() {
    if (selectHint) selectHint.style.display = 'none';
  }

  function cancelSelectionMode() {
    stopSelect();
    hideSelectHint();
    if (!toolbarOpen) uiMode = 'fab';
    else if (!(panel && panel.parentNode)) uiMode = 'fab';
  }

  function ensurePanelMounted() {
    const built = !panel.querySelector('#vc-glean');
    if (built) {
      buildPanelShell();
    }
    const wasAttached = !!panel.parentNode;
    if (!panel.parentNode) {
      document.documentElement.appendChild(panel);
    }
    setPageScrollbarHidden(true);
    applyPanelLayout();
    syncLauncher();
    if (built || !wasAttached) {
      scheduleAutogrowSync(panel);
    }
  }

  function openPanelAfterSelection() {
    returnToHistory = false;
    uiMode = 'panel';
    setFabActive(false);
    hideSelectHint();
    ensurePanelMounted();
    panel.setAttribute('data-crank-view', 'copy');
    panel.setAttribute('data-crank-has-selection', '1');
    activeTool = 'select';
    syncLauncher();
    setPanelStep('ask');
    setPanelSurface('crank');
    applySelectionToGleanForm();
  }

  function resetSessionState() {
    selectedEl = null;
    layerFocus = null;
    checkedLayers = [];
    layerCatalog = [];
    selectedNodes = [];
    if (panel) panel.removeAttribute('data-crank-has-selection');
    highlight.remove();
    sessionId = null;
    lastVariants = [];
    activeVariantId = null;
    originalSnapshot = [];
    hideAgentHandoff();
    hideThinking();
  }

  function syncGleanButton() {
    const glean = panel && panel.querySelector('#vc-glean');
    if (!glean) return;
    const online = window.__CRANK_COMPANION_ONLINE__ !== false;
    updateGleanContextValidationUI();
    glean.disabled = !!gleanActiveEpoch;
    if (!online) {
      glean.title =
        'Agent offline. Crank keeps checking.';
    } else if (!sessionId) {
      glean.title = 'Select copy on the page first';
    } else {
      glean.title = 'Ask Glean for rewritten copy alternatives';
    }
  }

  function applySessionFromServer(session) {
    if (!session || !session.id) return false;
    sessionId = session.id;
    syncGleanButton();
    return true;
  }

  function showFreshSelection() {
    lastVariants = [];
    activeVariantId = null;
    previewedVariantId = null;
    viewedRequestId = null;
    const box = panel && panel.querySelector('#vc-variants');
    if (box) {
      box.innerHTML = '';
      box.classList.add('crank-hidden');
    }
    hideThinking();
    setPanelStep('ask');
  }

  function syncSettingsControls() {
    if (!panel) return;
    const theme = readPanelTheme();
    const lightBtn = panel.querySelector('#vc-settings-light');
    const darkBtn = panel.querySelector('#vc-settings-dark');
    if (lightBtn) lightBtn.classList.toggle('is-active', theme !== 'dark');
    if (darkBtn) darkBtn.classList.toggle('is-active', theme === 'dark');
    const dockBtn = panel.querySelector('#vc-settings-dock');
    if (dockBtn) {
      dockBtn.textContent = readPanelDocked() ? 'Use floating panel' : 'Dock to the right';
    }
    const count = String(getGleanOptionCount());
    setFieldSelectValue('vc-settings-option-count', count);
    initDepthTune();
  }

  function normalizeCopy(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function visibleCopySet() {
    const set = new Set();
    if (!document.body) return set;
    const all = document.body.querySelectorAll('*');
    for (let i = 0; i < all.length; i += 1) {
      const el = all[i];
      if (isCrankChrome(el)) continue;
      const text = normalizeCopy(el.textContent);
      if (text.length >= 2 && text.length <= 2000) set.add(text);
    }
    return set;
  }

  function copiesAreVisible(copies, present) {
    const list = (copies || []).map(normalizeCopy).filter(function (text) {
      return text.length >= 2;
    });
    if (!list.length) return false;
    return list.every(function (text) {
      return present.has(text);
    });
  }

  function refreshPagePresence() {
    if (!panel) return;
    const present = visibleCopySet();
    const box = panel.querySelector('#vc-variants');
    if (box) {
      box.querySelectorAll('[data-variant-preview]').forEach(function (btn) {
        const id = btn.getAttribute('data-variant-preview');
        const variant = (lastVariants || []).find(function (item) {
          return item && item.id === id;
        });
        const copies =
          variant && Array.isArray(variant.nodes)
            ? variant.nodes.map(function (node) {
                return node.originalText || node.previousText || '';
              })
            : [];
        btn.hidden = !copiesAreVisible(copies, present);
      });
    }
  }

  function schedulePageSense() {
    if (pageSenseTimer) clearTimeout(pageSenseTimer);
    pageSenseTimer = setTimeout(refreshPagePresence, 400);
  }

  function startPageSensor() {
    if (window.__crankPageSensor) return;
    window.__crankPageSensor = true;
    const observer = new MutationObserver(function (mutations) {
      for (let i = 0; i < mutations.length; i += 1) {
        const target = mutations[i].target;
        const el = target && target.nodeType === 1 ? target : target && target.parentElement;
        if (el && el.closest && el.closest('#vp-shell, #vp-crank-launcher')) continue;
        schedulePageSense();
        return;
      }
    });
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
    window.addEventListener('focus', schedulePageSense);
    window.addEventListener('pageshow', schedulePageSense);
    window.addEventListener('popstate', schedulePageSense);
  }

  const HISTORY_CACHE_PREFIX = 'crank:history-cache:v1:';
  const HISTORY_CACHE_LIMIT = 50;

  function historyCacheKey() {
    return HISTORY_CACHE_PREFIX + getPanelChannel() + ':' + COMPANION_HTTP;
  }

  function readHistoryCache() {
    try {
      const raw = localStorage.getItem(historyCacheKey());
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || !Array.isArray(parsed.runs)) return { runs: [], details: {} };
      return {
        runs: parsed.runs,
        details: parsed.details && typeof parsed.details === 'object' ? parsed.details : {},
        savedAt: parsed.savedAt || 0
      };
    } catch (_) {
      return { runs: [], details: {} };
    }
  }

  function writeHistoryCache(cache) {
    const runs = (cache.runs || []).slice(0, HISTORY_CACHE_LIMIT);
    const keep = {};
    runs.forEach(function (run) {
      if (run && run.id && cache.details && cache.details[run.id]) keep[run.id] = cache.details[run.id];
    });
    const payload = { runs: runs, details: keep, savedAt: Date.now() };
    try {
      localStorage.setItem(historyCacheKey(), JSON.stringify(payload));
    } catch (_) {
      try {
        payload.details = {};
        localStorage.setItem(historyCacheKey(), JSON.stringify(payload));
      } catch (__) {}
    }
  }

  function saveHistoryListToCache(runs) {
    const cache = readHistoryCache();
    cache.runs = runs;
    writeHistoryCache(cache);
  }

  function saveHistoryDetailToCache(run) {
    if (!run || !run.id || run.status === 'running') return;
    const cache = readHistoryCache();
    cache.details[run.id] = run;
    writeHistoryCache(cache);
  }

  function cachedHistoryDetail(id) {
    return readHistoryCache().details[id] || null;
  }

  function renderCachedHistory(list) {
    const cache = readHistoryCache();
    if (!cache.runs.length) {
      historyShowingCache = false;
      list.innerHTML = '<p class="vc-tool-lead">History is unavailable. Start the companion and try again.</p>';
      return;
    }
    historyShowingCache = true;
    renderHistoryRuns(list, cache.runs, { offline: true, details: cache.details });
  }

  async function loadHistoryList() {
    const list = panel && panel.querySelector('#vc-history-list');
    if (!list) return;
    if (companionOffline) {
      renderCachedHistory(list);
      return;
    }
    list.innerHTML = '<p class="vc-tool-lead">Loading history…</p>';
    try {
      const resp = await fetch(COMPANION_HTTP + '/api/responses', {
        cache: 'no-store',
        headers: authHeaders()
      });
      if (!resp.ok) throw new Error('History request failed');
      const data = await resp.json();
      const runs = data && Array.isArray(data.runs) ? data.runs : [];
      saveHistoryListToCache(runs);
      historyShowingCache = false;
      if (!runs.length) {
        list.innerHTML = '<p class="vc-tool-lead vc-history-empty">No agent searches yet.</p>';
        return;
      }
      renderHistoryRuns(list, runs, { offline: false });
    } catch (err) {
      renderCachedHistory(list);
    }
  }

  function renderHistoryRuns(list, runs, opts) {
    const offline = !!(opts && opts.offline);
    const details = (opts && opts.details) || {};
    const escape = UI().escapeHtml || function (v) {
      return String(v == null ? '' : v);
    };
    const offlineHint = 'Needs the companion. Start it to use this.';
    list.innerHTML =
      (offline
        ? '<p class="vc-tool-lead vc-history-offline-note">Showing saved history. Companion is offline.</p>'
        : '') +
      runs
        .map(function (run) {
          const when = run.createdAt ? new Date(run.createdAt).toLocaleString() : '';
          const strings = Array.isArray(run.strings) ? run.strings.filter(Boolean) : [];
          const lines = strings
            .join('\n')
            .split(/\n/)
            .map(function (line) {
              return line.trim();
            })
            .filter(Boolean);
          const single = lines.length <= 1;
          historyStringMap[run.id] = lines;
          const preview = (single ? lines.slice(0, 1) : lines.slice(0, 2)).join('\n') || 'Untitled search';
          const running = run.status === 'running';
          const failed = run.status === 'error';
          const silent = run.status === 'expired';
          const meta = running ? 'Running' : failed ? 'Failed' : silent ? 'No response' : when;
          const shots = run.shots || {};
          const rawShot = shots.context || shots.tight || '';
          const fromCompanion = rawShot.indexOf('/shots/') === 0;
          const src = fromCompanion ? (offline ? '' : COMPANION_HTTP + rawShot) : rawShot;
          const thumbs = src
            ? '<img class="vc-history-shot" alt="" draggable="false" src="' + src + '" />'
            : '';
          const unavailable = offline && !details[run.id];
          return (
            '<div role="button" tabindex="0" class="vc-history-card' +
            (single ? ' is-single-line' : '') +
            (running ? ' is-running' : '') +
            (silent ? ' is-expired' : '') +
            (unavailable ? ' is-offline-unavailable' : '') +
            '" data-history-id="' +
            escape(run.id) +
            '" data-history-status="' +
            escape(run.status || 'ready') +
            '"' +
            (unavailable ? ' title="' + escape(offlineHint) + '"' : '') +
            '>' +
            '<button type="button" class="vc-history-delete" data-history-delete="' +
            escape(run.id) +
            '"' +
            (offline
              ? ' disabled aria-disabled="true" title="' + escape(offlineHint) + '" aria-label="Delete (needs the companion)"'
              : ' aria-label="Delete"') +
            '>' +
            '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true"><path fill="currentColor" d="M3 6.38597C3 5.90152 3.34538 5.50879 3.77143 5.50879L6.43567 5.50832C6.96502 5.49306 7.43202 5.11033 7.61214 4.54412C7.61688 4.52923 7.62232 4.51087 7.64185 4.44424L7.75665 4.05256C7.8269 3.81241 7.8881 3.60318 7.97375 3.41617C8.31209 2.67736 8.93808 2.16432 9.66147 2.03297C9.84457 1.99972 10.0385 1.99986 10.2611 2.00002H13.7391C13.9617 1.99986 14.1556 1.99972 14.3387 2.03297C15.0621 2.16432 15.6881 2.67736 16.0264 3.41617C16.1121 3.60318 16.1733 3.81241 16.2435 4.05256L16.3583 4.44424C16.3778 4.51087 16.3833 4.52923 16.388 4.54412C16.5682 5.11033 17.1278 5.49353 17.6571 5.50879H20.2286C20.6546 5.50879 21 5.90152 21 6.38597C21 6.87043 20.6546 7.26316 20.2286 7.26316H3.77143C3.34538 7.26316 3 6.87043 3 6.38597Z"/><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M11.5956 22.0001H12.4044C15.1871 22.0001 16.5785 22.0001 17.4831 21.1142C18.3878 20.2283 18.4803 18.7751 18.6654 15.8686L18.9321 11.6807C19.0326 10.1037 19.0828 9.31524 18.6289 8.81558C18.1751 8.31592 17.4087 8.31592 15.876 8.31592H8.12404C6.59127 8.31592 5.82488 8.31592 5.37105 8.81558C4.91722 9.31524 4.96744 10.1037 5.06788 11.6807L5.33459 15.8686C5.5197 18.7751 5.61225 20.2283 6.51689 21.1142C7.42153 22.0001 8.81289 22.0001 11.5956 22.0001ZM10.2463 12.1886C10.2051 11.7548 9.83753 11.4382 9.42537 11.4816C9.01321 11.525 8.71251 11.9119 8.75372 12.3457L9.25372 17.6089C9.29494 18.0427 9.66247 18.3593 10.0746 18.3159C10.4868 18.2725 10.7875 17.8856 10.7463 17.4518L10.2463 12.1886ZM14.5746 11.4816C14.9868 11.525 15.2875 11.9119 15.2463 12.3457L14.7463 17.6089C14.7051 18.0427 14.3375 18.3593 13.9254 18.3159C13.5132 18.2725 13.2125 17.8856 13.2537 17.4518L13.7537 12.1886C13.7949 11.7548 14.1625 11.4382 14.5746 11.4816Z"/></svg>' +
            '</button>' +
            (thumbs ? '<span class="vc-history-shots">' + thumbs + '</span>' : '') +
            '<span class="vc-history-preview">' +
            escape(preview) +
            '</span>' +
            '<span class="vc-history-meta">' +
            escape(meta) +
            '</span></div>'
          );
        })
        .join('');
    refreshPagePresence();
    if (pendingHistoryScroll != null) {
      const scroller = panel.querySelector('.vp-panel-body');
      if (scroller) scroller.scrollTop = pendingHistoryScroll;
      pendingHistoryScroll = null;
    }
  }

  function historyShotSrc(run) {
    const shots = (run && run.shots) || {};
    const rawShot = shots.context || shots.tight || '';
    if (!rawShot) return '';
    if (rawShot.indexOf('/shots/') !== 0) return rawShot;
    return companionOffline ? '' : COMPANION_HTTP + rawShot;
  }

  function prependHistoryShot(run) {
    const src = historyShotSrc(run);
    const box = panel && panel.querySelector('#vc-variants');
    if (!src || !box) return;
    const wrap = document.createElement('div');
    wrap.className = 'vc-history-detail-shot';
    const img = document.createElement('img');
    img.className = 'vc-history-shot';
    img.alt = '';
    img.addEventListener('error', function () {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    });
    img.src = src;
    wrap.appendChild(img);
    box.insertBefore(wrap, box.firstChild);
  }

  function showHistoryRequest(run) {
    if (!run || !panel) return;
    viewedRequestId = run.id;
    returnToHistory = true;
    activeTool = 'select';
    stopSelect();
    hideSelectHint();
    panel.setAttribute('data-crank-view', 'copy');
    setPanelSurface('crank');
    syncLauncher();
    if (run.status === 'error' || run.status === 'expired') {
      showHistoryEmptyDetail(run);
      return;
    }
    if (run.status === 'running') {
      renderVariants([]);
      const live = liveRequests[run.id];
      const started = live && live.startedAt ? live.startedAt : Date.parse(run.createdAt || '');
      thinkingStartedAt = Number.isFinite(started) ? started : Date.now();
      if (!thinkingUiTimer) startThinkingClock();
      showThinking({
        stage: 'stream_wait',
        text: 'Waiting for a response…',
        detail: 'This request is still in progress',
        live: false
      });
      setPanelStep('thinking');
      watchHistoryRequest(run.id);
      return;
    }
    if (!Array.isArray(run.variants) || !run.variants.length) {
      showHistoryEmptyDetail(run);
      return;
    }
    hideThinking();
    (run.variants || []).forEach(function (variant) {
      if (variant) variant.pageUrl = run.pageUrl || '';
    });
    if (run.table && run.variants[0] && !run.variants[0].agentTable) {
      run.variants[0].agentTable = run.table;
    }
    renderVariants(run.variants);
    prependHistoryShot(run);
    setPanelStep('results');
    scheduleAutogrowSync(panel);
  }

  const HISTORY_CONTEXT_PREFIX = 'crank:history-context:v1:';
  const HISTORY_CONTEXT_FIELDS = [
    ['humanStrings', 'Your string(s)', '#vc-glean-strings'],
    ['componentType', 'Component type', ''],
    ['timing', 'Timing', ''],
    ['userType', 'Is this for a fleet user or driver?', ''],
    ['entryPoint', 'How did they get to this screen?', '#vc-glean-entry-point'],
    ['userGoal', 'What is the user trying to do?', '#vc-glean-user-goal'],
    ['nextStep', 'What happens next?', '#vc-glean-next-step'],
    ['actionOptions', 'What are the action options for the user?', '#vc-glean-action-options'],
    ['surroundingStrings', 'What do the other existing strings around the component say?', '#vc-glean-surrounding'],
    ['prdLink', 'PRD/PDP link', '#vc-glean-prd'],
    ['additionalContext', 'Additional context', '#vc-glean-additional']
  ];

  function historyContextKey() {
    return HISTORY_CONTEXT_PREFIX + getPanelChannel() + ':' + COMPANION_HTTP;
  }

  function readHistoryContexts() {
    try {
      const parsed = JSON.parse(localStorage.getItem(historyContextKey()) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveHistoryContext(id, context) {
    if (!id || !context) return;
    const all = readHistoryContexts();
    all[id] = { context: context, savedAt: Date.now() };
    const ids = Object.keys(all).sort(function (a, b) {
      return (all[b].savedAt || 0) - (all[a].savedAt || 0);
    });
    ids.slice(HISTORY_CACHE_LIMIT).forEach(function (stale) {
      delete all[stale];
    });
    try {
      localStorage.setItem(historyContextKey(), JSON.stringify(all));
    } catch (_) {}
  }

  function historyContextFor(id) {
    const entry = readHistoryContexts()[id];
    return entry && entry.context && typeof entry.context === 'object' ? entry.context : null;
  }

  function historyRunNodes(run) {
    const nodes = run && run.source && Array.isArray(run.source.nodes) ? run.source.nodes : [];
    if (nodes.length) {
      return nodes.map(function (node, i) {
        const text = String(node.originalText != null ? node.originalText : node.text || '');
        return {
          id: node.id || 'copy-' + (node.path || i),
          path: node.path != null && node.path !== '' ? String(node.path) : String(i),
          role: node.role || '',
          selector: node.selector || '',
          label: node.label || '',
          text: text,
          previousText: text,
          originalText: text
        };
      });
    }
    const strings = Array.isArray(run && run.strings) ? run.strings : [];
    return strings.filter(Boolean).map(function (text, i) {
      return { id: 'copy-' + i, path: String(i), text: text, previousText: text, originalText: text };
    });
  }

  function historyRunStrings(run) {
    const fromNodes = historyRunNodes(run)
      .map(function (node) {
        return String(node.text || '').trim();
      })
      .filter(Boolean);
    if (fromNodes.length) return fromNodes;
    const combined = run && run.source && run.source.combinedText;
    return combined ? [String(combined).trim()] : [];
  }

  function historyRunContext(run) {
    const saved = historyContextFor(run && run.id) || {};
    const ctx = Object.assign({}, saved);
    if (!String(ctx.humanStrings || '').trim()) ctx.humanStrings = historyRunStrings(run).join('\n');
    return ctx;
  }

  function showHistoryEmptyDetail(run) {
    const ui = UI();
    const escape = ui.escapeHtml || function (v) {
      return String(v == null ? '' : v);
    };
    const field = ui.vpFieldHtml || function (label, control) {
      return '<div>' + escape(label) + control + '</div>';
    };
    const staticText = ui.vpFieldStaticTextHtml || function (_attrs, content) {
      return '<div>' + escape(content) + '</div>';
    };
    const btn = ui.vpButtonHtml || function (_v, label, attrs) {
      return '<button type="button" data-history-reask="">' + label + '</button>';
    };
    const group = ui.vpButtonGroupHtml || function (html) {
      return '<div>' + html + '</div>';
    };
    historyDetailRun = run;
    renderVariants([]);
    hideThinking();
    const ctx = historyRunContext(run);
    const fieldsHtml = HISTORY_CONTEXT_FIELDS.map(function (entry) {
      const value = String(ctx[entry[0]] || '').trim();
      if (!value) return '';
      return field(entry[1], staticText({}, value, {}));
    }).join('');
    const offline = !!(companionOffline || historyShowingCache);
    const offlineHint = 'Needs the companion. Start it to use this.';
    const message =
      run.status === 'error' && run.error && run.error !== 'No response'
        ? 'Glean could not finish this request: ' + run.error
        : 'No response from Glean.';
    const box = panel.querySelector('#vc-variants');
    if (box) {
      box.innerHTML =
        '<div class="vc-history-empty-detail">' +
        (fieldsHtml ? '<div class="vc-history-context">' + fieldsHtml + '</div>' : '') +
        '<p class="vc-history-empty-note vp-muted vp-type-support">' +
        escape(message) +
        '</p>' +
        group(
          btn(
            'primary',
            'Ask Glean again',
            offline
              ? {
                  'data-history-reask': run.id,
                  disabled: true,
                  'aria-disabled': 'true',
                  title: offlineHint
                }
              : { 'data-history-reask': run.id },
            { flex: true }
          ),
          { stretch: true }
        ) +
        '</div>';
      box.classList.remove('crank-hidden');
    }
    prependHistoryShot(run);
    setStatus('');
    setPanelStep('results');
    scheduleAutogrowSync(panel);
  }

  function fillGleanFormFromContext(ctx) {
    setGleanFieldValue('#vc-glean-strings', ctx.humanStrings || '');
    setFieldSelectValue('vc-glean-component-type', ctx.componentType || 'General UI string');
    setFieldSelectValue('vc-glean-timing', ctx.timing || 'Before');
    setFieldSelectValue('vc-glean-user-type', ctx.userType || 'Fleet user');
    resetOptionalGleanFieldsUi();
    HISTORY_CONTEXT_FIELDS.forEach(function (entry) {
      const selector = entry[2];
      if (!selector || selector === '#vc-glean-strings') return;
      const value = ctx[entry[0]] || '';
      setGleanFieldValue(selector, value);
      const fieldId = selector.slice(1);
      if (String(value).trim() && panel.querySelector('[data-optional-field="' + fieldId + '"]')) {
        revealOptionalGleanField(fieldId, { focus: false });
      }
    });
    gleanContextTouched = true;
    gleanValidationRequested = false;
    updateGleanContextValidationUI();
    scheduleAutogrowSync(panel);
  }

  async function askGleanAgainFromHistory(id) {
    const run = historyDetailRun;
    if (!run || run.id !== id) return;
    if (companionOffline || historyShowingCache) {
      setStatus('Asking Glean again needs the companion. Start it, then try again.');
      return;
    }
    const button = panel.querySelector('[data-history-reask]');
    if (button) button.disabled = true;
    try {
      const authed = await ensureTeamToken();
      if (!authed) {
        showTeamAuthUI('panel');
        setStatus('Paste your team token below, then click Save token');
        return;
      }
      let el = null;
      if (run.selector && (!run.pageUrl || run.pageUrl === location.href)) {
        try {
          el = document.querySelector(run.selector);
        } catch (_) {}
      }
      if (el && isCrankChrome(el)) el = null;
      selectedEl = el;
      layerFocus = el;
      checkedLayers = el ? [el] : [];
      selectedNodes = historyRunNodes(run);
      snapshotSelectionNodes();
      const data = await postJson('/api/selection', {
        origin: run.origin || location.origin,
        pageUrl: run.pageUrl || location.href,
        selector: run.selector || '',
        tagName: el ? el.tagName.toLowerCase() : '',
        nodes: selectedNodes,
        combinedText: historyRunStrings(run).join('\n'),
        meta: { pathHints: pathHintsFromLocation() }
      });
      if (!data || !data.ok || !data.session) {
        throw new Error((data && data.error) || 'Could not restore this selection');
      }
      applySessionFromServer(data.session);
      panel.setAttribute('data-crank-has-selection', '1');
      renderLayerList();
      fillGleanFormFromContext(historyRunContext(run));
      historyDetailRun = null;
      if (!validateGleanContextClient().ok) setPanelStep('ask');
      await requestGlean({ fromHistory: true });
    } catch (err) {
      const msg = err && err.message ? String(err.message) : 'Could not ask Glean again';
      showToast(msg, 'error');
      setStatus('Glean error: ' + msg);
    } finally {
      if (button && button.isConnected) button.disabled = false;
    }
  }

  function watchHistoryRequest(id) {
    if (!id || (liveRequests[id] && liveRequests[id].watch)) return;
    const holder = liveRequests[id] || (liveRequests[id] = {});
    holder.watch = setInterval(async function () {
      try {
        const resp = await fetch(COMPANION_HTTP + '/api/responses/' + encodeURIComponent(id), {
          cache: 'no-store',
          headers: authHeaders()
        });
        const data = await resp.json();
        const run = data && data.run;
        if (!run || run.status === 'running') return;
        saveHistoryDetailToCache(run);
        clearInterval(holder.watch);
        holder.watch = null;
        delete liveRequests[id];
        if (panel && panel.getAttribute('data-crank-view') === 'history') loadHistoryList();
        if (
          viewedRequestId === id &&
          returnToHistory &&
          panel &&
          panel.getAttribute('data-crank-view') === 'copy'
        ) {
          showHistoryRequest(run);
        }
      } catch (_) {}
    }, 1500);
  }

  async function deleteHistoryRun(id) {
    if (!id) return;
    if (companionOffline || historyShowingCache) {
      setStatus('Deleting history needs the companion. Start it, then try again.');
      return;
    }
    const live = liveRequests[id];
    if (live && live.watch) {
      clearInterval(live.watch);
      live.watch = null;
    }
    delete liveRequests[id];
    if (viewedRequestId === id) viewedRequestId = null;
    try {
      const resp = await fetch(COMPANION_HTTP + '/api/responses/' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: authHeaders()
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) throw new Error((data && data.error) || 'Could not delete');
      loadHistoryList();
    } catch (err) {
      setStatus(err.message || 'Could not delete');
    }
  }

  function openCachedHistoryRun(id) {
    const cached = cachedHistoryDetail(id);
    if (cached) {
      showHistoryRequest(cached);
      return true;
    }
    setStatus('This request needs the companion to open. Start it, then try again.');
    return false;
  }

  async function openHistoryRun(id) {
    if (!id) return;
    const scroller = panel && panel.querySelector('.vp-panel-body');
    if (scroller && panel.getAttribute('data-crank-view') === 'history') {
      historyScrollTop = scroller.scrollTop;
    }
    const token = ++historyOpenToken;
    if (companionOffline || historyShowingCache) {
      openCachedHistoryRun(id);
      return;
    }
    const stillWanted = function () {
      return token === historyOpenToken && panel && panel.getAttribute('data-crank-view') === 'history';
    };
    try {
      const resp = await fetch(COMPANION_HTTP + '/api/responses/' + encodeURIComponent(id), {
        cache: 'no-store',
        headers: authHeaders()
      });
      if (!resp.ok) throw new Error('History request failed');
      const data = await resp.json();
      const run = data && data.run;
      if (!run) return;
      saveHistoryDetailToCache(run);
      if (stillWanted()) showHistoryRequest(run);
    } catch (_) {
      if (stillWanted()) openCachedHistoryRun(id);
    }
  }

  function closePanel() {
    returnToHistory = false;
    stopSelect();
    hideSelectHint();
    restoreOriginal();
    resetSessionState();
    applyDockedPageLayout(false);
    stopCompanionAutoRetry();
    if (launcher && panel.contains(launcher)) {
      document.documentElement.appendChild(launcher);
      launcher.classList.remove('is-in-panel');
    }
    if (panel.parentNode) panel.remove();
    setPageScrollbarHidden(false);
    uiMode = 'fab';
    showFab();
    setFabActive(false);
    if (panelAutoUpdateEnabled() && !window.__CRANK_PANEL_UPDATE_SCHEDULED__) {
      schedulePanelAutoUpdate(COMPANION_HTTP);
    } else if (panelAutoUpdateEnabled()) {
      checkPanelUpdate(COMPANION_HTTP, { quiet: true });
    }
  }

  function setStatus(text) {
    const el = panel && panel.querySelector('#vc-status');
    const msg = String(text || '').trim();
    const isError =
      !!msg &&
      /error|failed|offline|required|missing|invalid|cannot/i.test(msg) &&
      !/returned \d+ options/i.test(msg);
    const show = isError || /^Preview/.test(msg);
    if (el) {
      if (!show) {
        el.textContent = '';
        el.classList.add('crank-hidden');
      } else {
        el.textContent = msg;
        el.classList.remove('crank-hidden');
      }
    }
  }

  function showToast(text, tone) {
    let toast = panel.querySelector('#vc-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'vc-toast';
      const status = panel.querySelector('#vc-status');
      if (status && status.parentNode) {
        status.parentNode.insertBefore(toast, status.nextSibling);
      } else {
        panel.appendChild(toast);
      }
    }
    const companionDown = /not running|offline|Failed to fetch|3344/i.test(String(text || ''));
    if (tone === 'error' && companionDown) {
      setAgentStatus('offline', 'Agent not running');
      showCompanionOfflineUI();
      toast.className = '';
      toast.style.cssText = 'display:none;';
      toast.textContent = '';
      return;
    }
    if (tone === 'ok' && /companion connected|token saved/i.test(String(text || ''))) {
      setAgentStatus('running', 'Agent running');
      hideCompanionOfflineUI();
    }
    toast.className = tone === 'error' ? 'error' : tone === 'ok' ? 'ok' : 'success';
    toast.style.cssText = 'display:block;';
    toast.textContent = text;
  }

  function hideToast() {
    const toast = panel.querySelector('#vc-toast');
    if (toast) toast.style.display = 'none';
  }

  async function copyTextToClipboard(text) {
    const value = String(text || '');
    if (!value) return false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_) {
      /* fall through */
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch (_) {
      return false;
    }
  }

  function buildCursorPromptDeeplink(promptText) {
    const text = String(promptText || '').trim();
    if (!text) return '';
    const base = 'cursor://anysphere.cursor-deeplink/prompt?text=';
    let encoded = encodeURIComponent(text);
    if (base.length + encoded.length <= CURSOR_DEEPLINK_MAX) {
      return base + encoded;
    }
    encoded = encodeURIComponent(AGENT_SHORT_PROMPT);
    if (base.length + encoded.length <= CURSOR_DEEPLINK_MAX) {
      return base + encoded;
    }
    return '';
  }

  /** Prefill Cursor chat via official prompt deeplink (user must confirm). */
  function openCursorPrompt(promptText) {
    const href = buildCursorPromptDeeplink(promptText);
    if (!href) return false;
    try {
      const a = document.createElement('a');
      a.href = href;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.documentElement.appendChild(a);
      a.click();
      a.remove();
      return true;
    } catch (_) {
      try {
        window.open(href, '_self');
        return true;
      } catch (__) {
        return false;
      }
    }
  }

  function hideAgentHandoff() {
    const box = panel.querySelector('#vc-agent-handoff');
    if (box) {
      box.style.display = 'none';
      box.innerHTML = '';
    }
    stopAgentRunPoll();
  }

  let agentRunPollTimer = null;
  let agentStatusPollTimer = null;

  function stopAgentRunPoll() {
    if (agentRunPollTimer) {
      clearInterval(agentRunPollTimer);
      agentRunPollTimer = null;
    }
  }

  function stopAgentStatusPoll() {
    if (agentStatusPollTimer) {
      clearInterval(agentStatusPollTimer);
      agentStatusPollTimer = null;
    }
  }

  function statusLabelForJob(job) {
    const s = String((job && job.status) || '').toLowerCase();
    if (s === 'queued') return 'Queued';
    if (s === 'running') return 'Running';
    if (s === 'done') return 'Done';
    if (s === 'failed') return 'Failed';
    return s || '—';
  }

  function updateAgentHandoffJobLine(job) {
    const box = panel.querySelector('#vc-agent-handoff');
    if (!box || box.style.display === 'none') return;
    const el = box.querySelector('#vc-agent-job-status');
    if (!el) return;
    const ui = UI();
    const escape = ui.escapeHtml || function (v) {
      return String(v == null ? '' : v);
    };
    if (!job) {
      el.style.display = 'none';
      el.textContent = '';
      return;
    }
    el.style.display = 'block';
    el.innerHTML =
      'Auto-run: <strong>' +
      escape(statusLabelForJob(job)) +
      '</strong>' +
      (job.error ? ' — ' + escape(job.error) : '');
  }

  function showAgentHandoffError(message, detail) {
    const box = panel.querySelector('#vc-agent-handoff');
    if (!box) return;
    const ui = UI();
    const escape = ui.escapeHtml || function (v) {
      return String(v == null ? '' : v);
    };
    box.style.display = 'block';
    box.innerHTML =
      '<div class="vp-type-label" style="font-weight:620;margin-bottom:6px;color:oklch(0.45 0.14 25);">Agent queue failed</div>' +
      '<div class="vp-type-support" style="line-height:1.45;color:var(--foreground);">' +
      escape(message || 'Unknown error') +
      (detail
        ? '<br/><span style="opacity:0.85;">' + escape(detail) + '</span>'
        : '') +
      '</div>';
    try {
      box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (_) {
      /* ignore */
    }
  }

  function showAgentHandoff(task, options) {
    const box = panel.querySelector('#vc-agent-handoff');
    if (!box) return;
    const opts = options || {};
    const ui = UI();
    const escape = ui.escapeHtml || function (v) {
      return String(v == null ? '' : v);
    };
    const btn = ui.vpButtonHtml || function (_v, label, attrs) {
      return (
        '<button type="button" id="' +
        (attrs && attrs.id ? attrs.id : '') +
        '">' +
        label +
        '</button>'
      );
    };
    const prompt = String((task && task.prompt) || '');
    const label = (task && task.variantLabel) || '';
    const changeCount =
      task && typeof task.changeCount === 'number'
        ? task.changeCount
        : Array.isArray(task && task.changes)
          ? task.changes.length
          : 0;
    const apiKeyConfigured = opts.apiKeyConfigured === true;
    const job = opts.job || null;
    box.style.display = 'block';
    box.innerHTML =
      '<div class="vp-type-label" style="font-weight:620;margin-bottom:6px;">Queued for agent' +
      (label ? ' (“' + escape(label) + '”)' : '') +
      (changeCount ? ' · ' + changeCount + ' change' + (changeCount === 1 ? '' : 's') : '') +
      '</div>' +
      '<div class="vp-type-support" style="margin-bottom:8px;line-height:1.45;color:var(--foreground);">' +
      (opts.waitingWatch
        ? 'Waiting for agent… (skill/MCP watch active)'
        : 'Paste in your <strong>current</strong> Cursor chat: <code>' +
          escape(AGENT_SHORT_PROMPT) +
          '</code> — the <code>crank-apply-changes</code> skill pulls pending changes via MCP. Cursor has no public API to inject into an open chat.') +
      (!apiKeyConfigured
        ? '<br/><span style="opacity:0.85;">Optional: set <code>CURSOR_API_KEY</code> for one-click fully automatic apply (separate agent, not your open chat).</span>'
        : '') +
      '</div>' +
      '<div id="vc-agent-job-status" class="vp-type-support" style="display:' +
      (job ? 'block' : 'none') +
      ';margin-bottom:8px;line-height:1.45;color:var(--foreground);">' +
      (job
        ? 'Auto-run: <strong>' +
          escape(statusLabelForJob(job)) +
          '</strong>' +
          (job.error ? ' — ' + escape(job.error) : '')
        : '') +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">' +
      (apiKeyConfigured
        ? btn('primary', 'Run fully automatic', { id: 'vc-agent-auto', type: 'button' }, {
            size: 'compact',
            flex: true
          })
        : '') +
      btn('secondary', 'Copy again', { id: 'vc-agent-copy', type: 'button' }, {
        size: 'compact',
        flex: true
      }) +
      btn('ghost', 'Open new chat instead', { id: 'vc-agent-open', type: 'button' }, {
        size: 'compact',
        flex: true
      }) +
      btn('ghost', 'Dismiss', { id: 'vc-agent-dismiss', type: 'button' }, {
        size: 'compact',
        flex: true
      }) +
      '</div>' +
      '<div class="vp-type-label" style="margin-top:10px;font-size:12px;">Full prompt</div>' +
      '<textarea id="vc-agent-prompt" readonly rows="8" style="width:100%;box-sizing:border-box;resize:vertical;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--background, #fff);color:var(--foreground);margin-top:6px;max-height:240px;overflow:auto;">' +
      escape(prompt) +
      '</textarea>' +
      '<div style="margin-top:6px;">' +
      btn('ghost', 'Copy full prompt', { id: 'vc-agent-copy-full', type: 'button' }, {
        size: 'compact',
        flex: true
      }) +
      '</div>';

    const autoBtn = box.querySelector('#vc-agent-auto');
    const openBtn = box.querySelector('#vc-agent-open');
    const copyBtn = box.querySelector('#vc-agent-copy');
    const copyFullBtn = box.querySelector('#vc-agent-copy-full');
    const dismissBtn = box.querySelector('#vc-agent-dismiss');

    if (autoBtn) {
      autoBtn.addEventListener('click', function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        startFullyAutomaticRun(task);
      });
    }
    if (openBtn) {
      openBtn.addEventListener('click', function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        const ok = openCursorPrompt(prompt || AGENT_SHORT_PROMPT);
        showToast(
          ok
            ? 'Opened a new Cursor chat (deeplink) — confirm if prompted'
            : 'Could not open deeplink — paste “' +
              AGENT_SHORT_PROMPT +
              '” in your current chat instead',
          ok ? 'ok' : 'error'
        );
      });
    }
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        copyTextToClipboard(AGENT_SHORT_PROMPT).then(function (ok) {
          showToast(
            ok
              ? 'Copied — ' + PASTE_IN_AGENT_CHAT
              : 'Copy failed — type: ' + AGENT_SHORT_PROMPT,
            ok ? 'ok' : 'error'
          );
        });
      });
    }
    if (copyFullBtn) {
      copyFullBtn.addEventListener('click', function () {
        copyTextToClipboard(prompt || AGENT_SHORT_PROMPT).then(function (ok) {
          showToast(
            ok ? 'Full prompt copied' : 'Copy failed — select the textarea',
            ok ? 'ok' : 'error'
          );
        });
      });
    }
    if (dismissBtn) {
      dismissBtn.addEventListener('click', function () {
        hideAgentHandoff();
        hideToast();
      });
    }
    try {
      box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (_) {
      /* ignore */
    }
  }

  async function fetchAgentStatus() {
    try {
      const data = await postJson('/api/agent-status', null, {
        method: 'GET',
        timeoutMs: 8000
      });
      return data || {};
    } catch (_) {
      try {
        const res = await fetch(COMPANION_HTTP + '/api/agent-status', {
          method: 'GET',
          headers: authHeaders()
        });
        return await res.json();
      } catch (__) {
        return {};
      }
    }
  }

  function pollAgentRun(jobId) {
    stopAgentRunPoll();
    if (!jobId) return;
    agentRunPollTimer = setInterval(async function () {
      try {
        const res = await fetch(
          COMPANION_HTTP + '/api/agent-run/' + encodeURIComponent(jobId),
          { method: 'GET', headers: authHeaders() }
        );
        const data = await res.json();
        const job = data && data.job;
        if (!job) return;
        updateAgentHandoffJobLine(job);
        setStatus('Agent auto-run: ' + statusLabelForJob(job));
        if (job.status === 'done' || job.status === 'failed') {
          stopAgentRunPoll();
          setStatus(
            job.status === 'done'
              ? 'Agent auto-run done'
              : 'Agent auto-run failed: ' + (job.error || 'unknown')
          );
        }
      } catch (_) {
        /* ignore transient poll errors */
      }
    }, 2000);
  }

  async function startFullyAutomaticRun(task) {
    showToast('Starting fully automatic agent…', 'info');
    setStatus('Starting fully automatic agent…');
    try {
      const body = {
        sessionId: sessionId,
        variantId: (task && task.variantId) || activeVariantId
      };
      const res = await fetch(COMPANION_HTTP + '/api/agent-run', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || data.ok === false) {
        const msg =
          (data && data.error) ||
          'Set CURSOR_API_KEY to enable one-click Agent apply';
        showToast(msg, 'error');
        setStatus(msg);
        return;
      }
      const job = data.job;
      showAgentHandoff(task || data.task, {
        apiKeyConfigured: true,
        job: job
      });
      if (job && job.id) pollAgentRun(job.id);
      setStatus('Agent auto-run: ' + statusLabelForJob(job));
    } catch (err) {
      const msg =
        err && err.message
          ? String(err.message)
          : 'Fully automatic run failed';
      showToast(msg, 'error');
      setStatus(msg);
    }
  }

  let lastFinishedAgentTaskId = null;

  async function finishAgentQueue(task, options) {
    const opts = options || {};
    if (
      task &&
      task.id &&
      task.id === lastFinishedAgentTaskId &&
      !opts.force
    ) {
      return;
    }
    if (task && task.id) lastFinishedAgentTaskId = task.id;
    let apiKeyConfigured = opts.apiKeyConfigured;
    if (apiKeyConfigured == null) {
      const st = await fetchAgentStatus();
      apiKeyConfigured = !!(st && st.apiKeyConfigured);
    }
    // Same-chat primary: queue for MCP pull + clipboard short phrase.
    // Do NOT auto-open cursor:// prompt deeplink (that opens a *new* chat).
    showAgentHandoff(task, {
      apiKeyConfigured: apiKeyConfigured,
      waitingWatch: !!opts.waitingWatch,
      job: opts.job || null
    });
    let copied = false;
    if (!opts.skipCopy) {
      copied = await copyTextToClipboard(AGENT_SHORT_PROMPT);
    }
    const msg =
      'Queued — ' +
        PASTE_IN_AGENT_CHAT +
        ' (or ask: ' +
      AGENT_SHORT_PROMPT +
      ')' +
      (copied ? ' · copied' : '');
    showToast(msg, copied || opts.skipCopy ? 'ok' : 'info');
    setStatus(msg);
  }

  function cssPath(el) {
    if (!(el instanceof Element)) return '';
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 8) {
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

  function isInlineTag(tag) {
    return /^(span|strong|b|em|i|u|small|mark|code|br|wbr|svg|path)$/i.test(tag);
  }

  function isLeafTextWrapper(el) {
    if (!(el instanceof Element)) return false;
    const tag = el.tagName.toLowerCase();
    if (!/^(div|span|section|article|header|footer|aside|blockquote)$/.test(tag)) {
      return false;
    }
    const kids = Array.from(el.childNodes);
    if (!kids.length) return false;
    return kids.every(function (child) {
      if (child.nodeType === 3) return true;
      if (child.nodeType !== 1) return false;
      return isInlineTag(child.tagName);
    });
  }

  function isCopyUnitRoot(el) {
    if (!(el instanceof Element)) return false;
    const tag = el.tagName.toLowerCase();
    if (/^(h1|h2|h3|h4|h5|h6|button|label|li|p|figcaption|caption|td|th|dt|dd|legend|summary)$/.test(tag)) {
      return true;
    }
    if (tag === 'a' && el.childNodes.length) return true;
    return isLeafTextWrapper(el);
  }

  function unitRole(el) {
    const tag = el.tagName.toLowerCase();
    if (/^(h1|h2|h3|h4|h5|h6)$/.test(tag)) return 'heading';
    if (/^(button|a)$/.test(tag)) return 'action';
    if (/^(label|figcaption|caption)$/.test(tag)) return 'label';
    const ariaRole = String(el.getAttribute('role') || '').toLowerCase();
    if (ariaRole === 'heading') return 'heading';
    if (ariaRole === 'button' || ariaRole === 'link') return 'action';
    const cls = String(el.className || '').toLowerCase();
    if (/\b(heading|headline|title|hero-title|card-title)\b/.test(cls)) {
      return 'heading';
    }
    if (/\b(cta|btn|button|action-link)\b/.test(cls)) return 'action';
    return 'text';
  }

  /**
   * Within one copy unit, keep the full sentence together but chip any
   * dynamic/bound fragments (DB/prop values) so they are visible, not separate fields.
   */
  function analyzeUnitParts(el, classify) {
    const parts = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let textNode;
    while ((textNode = walker.nextNode())) {
      const raw = String(textNode.nodeValue || '').replace(/\s+/g, ' ');
      if (!raw.trim()) continue;
      const owner =
        textNode.parentElement instanceof Element ? textNode.parentElement : el;
      const source = classify(owner, raw.trim());
      const type = source.type || 'static-label';
      parts.push({
        text: raw,
        type: type,
        editable: source.editable !== false
      });
    }
    if (!parts.length) {
      const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) {
        const source = classify(el, text);
        parts.push({
          text: text,
          type: source.type || 'static-label',
          editable: source.editable !== false
        });
      }
    }
    return parts;
  }

  /** Pure runtime data — show in selection list, hide from Glean variants/copy. */
  function isRuntimeOnlyNode(n) {
    if (!n) return true;
    const ts = n.textSource && n.textSource.type;
    if (ts === 'static-label' || ts === 'mixed') return false;
    if (n.copyLabel || n.label) return false;
    return isDynamicOnlyNode(n);
  }

  function isDynamicOnlyNode(n) {
    if (!n) return false;
    const ts = n.textSource && n.textSource.type;
    if (ts === 'dynamic-data') return true;
    const parts = n.parts || [];
    if (parts.length) {
      const looksStatic = TS().looksLikeStaticLabel || function () {
        return false;
      };
      const hasEditableStatic = parts.some(function (p) {
        return (
          p.type !== 'dynamic-data' &&
          p.editable !== false &&
          looksStatic(String(p.text || ''))
        );
      });
      return !hasEditableStatic;
    }
    if (n.editable === false && ts !== 'static-label') return true;
    const looksData = TS().looksLikeDataValue;
    const looksStatic = TS().looksLikeStaticLabel;
    if (
      looksData &&
      looksStatic &&
      !n.textSource &&
      looksData(n.text) &&
      !looksStatic(n.text)
    ) {
      return true;
    }
    return false;
  }

  function summarizeUnitSource(parts, classify, el, fullText) {
    const types = {};
    parts.forEach(function (p) {
      types[p.type] = (types[p.type] || 0) + 1;
    });
    const hasDynamic = !!types['dynamic-data'];
    const hasBound = !!types['bound-unknown'];
    const hasStatic = !!types['static-label'] || !!types['unknown'];

    if (hasDynamic && (hasStatic || hasBound)) {
      return {
        type: 'mixed',
        editable: parts.some(function (p) {
          return p.editable;
        }),
        chips: ['Mixed'].concat(hasDynamic ? ['Dynamic'] : []).concat(hasBound ? ['Bound'] : [])
      };
    }
    if (hasDynamic && !hasStatic && !hasBound) {
      return { type: 'dynamic-data', editable: false, chips: ['Dynamic'] };
    }
    if (hasBound && !hasStatic) {
      return { type: 'bound-unknown', editable: false, chips: ['Bound'] };
    }
    const whole = classify(el, fullText);
    return {
      type: whole.type || 'static-label',
      editable: whole.editable !== false,
      chips: [
        whole.type === 'dynamic-data'
          ? 'Dynamic'
          : whole.type === 'bound-unknown'
            ? 'Bound'
            : 'Static'
      ]
    };
  }

  function buildUnit(el, classify, pathIndex, textOverride, kind) {
    const text =
      textOverride != null
        ? String(textOverride).replace(/\s+/g, ' ').trim()
        : String(el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    const parts = kind
      ? [{ text: text, type: 'static-label', editable: true }]
      : analyzeUnitParts(el, classify);
    const source = summarizeUnitSource(parts, classify, el, text);
    const path = String(pathIndex);
    return {
      id: 'copy-' + path,
      path: path,
      text: text,
      previousText: text,
      originalText: text,
      role: unitRole(el),
      tagName: el.tagName.toLowerCase(),
      selector: cssPath(el),
      parts: parts,
      textSource: {
        type: source.type,
        editable: source.editable,
        chips: source.chips
      },
      editable: source.editable,
      kind: kind || ''
    };
  }

  /**
   * Merge consecutive sibling body wrappers under the same parent into one field
   * so a sentence split across nested div/spans is not exploded into N fields.
   */
  function mergeSiblingBodyUnits(units) {
    if (units.length < 2) return units;
    const merged = [];
    let i = 0;
    while (i < units.length) {
      const cur = units[i];
      if (cur.role !== 'text') {
        merged.push(cur);
        i += 1;
        continue;
      }
      let j = i + 1;
      const group = [cur];
      while (j < units.length && units[j].role === 'text') {
        const a = document.querySelector(group[group.length - 1].selector);
        const b = document.querySelector(units[j].selector);
        if (
          a &&
          b &&
          a.parentElement &&
          a.parentElement === b.parentElement &&
          isLeafTextWrapper(a) &&
          isLeafTextWrapper(b)
        ) {
          group.push(units[j]);
          j += 1;
        } else {
          break;
        }
      }
      if (group.length === 1) {
        merged.push(cur);
      } else {
        const parent = document.querySelector(group[0].selector)?.parentElement;
        if (parent) {
          const classify = TS().classifyTextSource || function () {
            return { type: 'static-label', editable: true };
          };
          const unit = buildUnit(parent, classify, merged.length);
          if (unit) merged.push(unit);
          else merged.push(cur);
        } else {
          merged.push(cur);
        }
      }
      i = j;
    }
    return merged.map(function (u, idx) {
      const path = String(idx);
      return Object.assign({}, u, { path: path, id: u.id || 'copy-' + path });
    });
  }

  function isSkippedCopyTag(el) {
    return /^(script|style|noscript|template|svg|canvas|video|audio|iframe)$/i.test(
      el.tagName || ''
    );
  }

  function isShownCopyElement(el) {
    if (!el || el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') {
      return false;
    }
    const style = window.getComputedStyle(el);
    return !!style && style.display !== 'none' && style.visibility !== 'hidden';
  }

  function isStructuralChild(el) {
    if (!(el instanceof Element)) return false;
    const tag = el.tagName.toLowerCase();
    if (isInlineTag(tag) || /^(br|wbr)$/.test(tag)) return false;
    return true;
  }

  function collectInlineText(el) {
    let text = '';
    Array.from(el.childNodes || []).forEach(function (node) {
      if (node.nodeType === 3) text += node.nodeValue || '';
      else if (
        node.nodeType === 1 &&
        isInlineTag(node.tagName) &&
        !isCrankChrome(node)
      ) {
        text += node.textContent || '';
      }
    });
    return text.replace(/\s+/g, ' ').trim();
  }

  function currentUnitText(el, node) {
    if (!el || !node) return '';
    if (node.kind === 'placeholder') return el.getAttribute('placeholder') || '';
    if (node.kind === 'alt') return el.getAttribute('alt') || '';
    if (node.kind === 'aria') return el.getAttribute('aria-label') || '';
    if (node.kind === 'value') return el.value || '';
    if (node.kind === 'inline') return collectInlineText(el);
    return String(el.textContent || '');
  }

  function applyInlineRun(el, next) {
    const nodes = [];
    Array.from(el.childNodes || []).forEach(function (node) {
      if (node.nodeType === 3 && String(node.nodeValue || '').trim()) nodes.push(node);
      else if (node.nodeType === 1 && isInlineTag(node.tagName)) nodes.push(node);
    });
    if (!nodes.length) {
      el.insertBefore(document.createTextNode(next), el.firstChild);
      return;
    }
    const first = nodes[0];
    if (first.nodeType === 3) first.nodeValue = next;
    else first.textContent = next;
    for (let i = 1; i < nodes.length; i++) {
      if (nodes[i].nodeType === 3) nodes[i].nodeValue = '';
      else nodes[i].textContent = '';
    }
  }

  /**
   * One string per visible block, control, or inline run.
   * Inline emphasis stays inside its sentence. Structural siblings are not dropped.
   */
  function extractTextNodes(root) {
    const classify = TS().classifyTextSource || function () {
      return { type: 'static-label', editable: true };
    };
    const units = [];
    const seen = new Set();

    function pushUnit(el, textOverride, kind) {
      if (!el) return;
      const key = (kind || 'text') + '|' + (cssPath(el) || el.tagName);
      if (seen.has(key)) return;
      const unit = buildUnit(el, classify, units.length, textOverride, kind);
      if (!unit) return;
      seen.add(key);
      units.push(unit);
    }

    function walk(el) {
      if (!(el instanceof Element)) return;
      if (isCrankChrome(el) || isSkippedCopyTag(el) || !isShownCopyElement(el)) return;
      const tag = el.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea') {
        const placeholder = el.getAttribute('placeholder');
        const value = String(el.value || '');
        if (placeholder && placeholder.trim()) pushUnit(el, placeholder.trim(), 'placeholder');
        if (value.trim() && value.trim() !== String(placeholder || '').trim()) {
          pushUnit(el, value.trim(), 'value');
        }
        return;
      }
      if (tag === 'select') {
        const option = el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
        const label = option ? String(option.text || '').trim() : '';
        if (label) pushUnit(el, label, 'value');
        return;
      }
      if (tag === 'img') {
        const alt = el.getAttribute('alt');
        if (alt && alt.trim()) pushUnit(el, alt.trim(), 'alt');
        return;
      }
      if (isCopyUnitRoot(el)) {
        const nested = Array.from(el.children).filter(isStructuralChild);
        if (!nested.length) {
          pushUnit(el);
          return;
        }
        const inlineText = collectInlineText(el);
        if (inlineText) pushUnit(el, inlineText, 'inline');
        nested.forEach(walk);
        return;
      }
      const structural = Array.from(el.children).filter(isStructuralChild);
      if (!structural.length) {
        const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) pushUnit(el, text);
        else {
          const aria = el.getAttribute('aria-label');
          if (aria && aria.trim()) pushUnit(el, aria.trim(), 'aria');
        }
        return;
      }
      const inlineText = collectInlineText(el);
      if (inlineText) pushUnit(el, inlineText, 'inline');
      structural.forEach(walk);
    }

    walk(root);

    if (!units.length && root instanceof Element) {
      const unit = buildUnit(root, classify, 0);
      if (unit) units.push(unit);
    }

    return assignUnitLabels(units);
  }

  function stringsFromCheckedLayers() {
    const roots = checkedLayers.filter(function (el, index) {
      if (!(el instanceof Element)) return false;
      return !checkedLayers.some(function (other, otherIndex) {
        return otherIndex !== index && other instanceof Element && other.contains(el);
      });
    });
    const seen = new Set();
    const units = [];
    roots.forEach(function (root) {
      extractTextNodes(root).forEach(function (unit) {
        const text = String(unit.text || '').replace(/\s+/g, ' ').trim();
        if (!text || seen.has(text)) return;
        seen.add(text);
        units.push(unit);
      });
    });
    return assignUnitLabels(
      units.map(function (unit, index) {
        const path = String(index);
        return Object.assign({}, unit, { path: path, id: 'copy-' + path });
      })
    );
  }

  function resolveUnitElement(root, node) {
    if (!root || !node) return null;
    if (node.selector) {
      try {
        const found = document.querySelector(node.selector);
        if (found && (found === root || root.contains(found))) return found;
      } catch (_) {}
      // Absolute cssPath may include ancestors; try the leaf selector inside root.
      try {
        const leaf = String(node.selector)
          .split('>')
          .pop()
          .trim();
        if (leaf) {
          const candidates = root.querySelectorAll(leaf);
          if (candidates.length === 1 && candidates[0] !== root) {
            return candidates[0];
          }
        }
      } catch (_) {}
    }
    return null;
  }

  function writeVisibleText(el, node, next) {
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (node.kind === 'placeholder') {
      el.setAttribute('placeholder', next);
      return;
    }
    if (node.kind === 'alt' || tag === 'img') {
      el.setAttribute('alt', next);
      return;
    }
    if (node.kind === 'aria') {
      el.setAttribute('aria-label', next);
      return;
    }
    if (node.kind === 'value' || tag === 'textarea' || (tag === 'input' && node.kind !== 'placeholder')) {
      el.value = next;
      return;
    }
    if (tag === 'select') {
      const opt = el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
      if (opt) opt.text = next;
      return;
    }
    if (!el.childElementCount) {
      el.textContent = next;
      return;
    }
    const textNodes = [];
    Array.from(el.childNodes || []).forEach(function (child) {
      if (child.nodeType === 3 && String(child.nodeValue || '').trim()) textNodes.push(child);
      else if (
        child.nodeType === 1 &&
        /^(span|strong|b|em|i|u|small|mark|code|a|label)$/i.test(child.tagName) &&
        !child.querySelector('svg')
      ) {
        textNodes.push(child);
      }
    });
    if (!textNodes.length) {
      el.insertBefore(document.createTextNode(next), el.firstChild);
      return;
    }
    const first = textNodes[0];
    if (first.nodeType === 3) first.nodeValue = next;
    else first.textContent = next;
    for (let i = 1; i < textNodes.length; i += 1) {
      if (textNodes[i].nodeType === 3) textNodes[i].nodeValue = '';
      else textNodes[i].textContent = '';
    }
  }

  function elementMatchingOriginalText(node) {
    const needle = String(node.originalText || node.previousText || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!needle || needle.length < 2) return null;
    const root = document.body;
    if (!root) return null;
    let best = null;
    let bestSize = Infinity;
    const all = root.querySelectorAll('*');
    for (let i = 0; i < all.length; i += 1) {
      const el = all[i];
      if (isCrankChrome(el)) continue;
      const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text !== needle) continue;
      const size = el.getBoundingClientRect ? el.getBoundingClientRect().width * el.getBoundingClientRect().height : 0;
      if (!best || size < bestSize) {
        best = el;
        bestSize = size;
      }
    }
    return best;
  }

  function applyNodesToDom(root, nodes) {
    if (!root || !Array.isArray(nodes)) return 0;
    // Resolve all targets before mutating — never fall back to wiping `root`
    // (that applied one string to the whole selection).
    const resolved = nodes.map(function (node) {
      return { node: node, el: resolveUnitElement(root, node) };
    });

    // Path-index fallback against live copy units when selectors miss.
    const needPath = resolved.some(function (r) {
      return !r.el;
    });
    let byPath = null;
    if (needPath) {
      byPath = new Map();
      extractTextNodes(root).forEach(function (u) {
        try {
          const el = document.querySelector(u.selector);
          if (el && (el === root || root.contains(el))) {
            byPath.set(String(u.path), el);
          }
        } catch (_) {}
      });
    }

    let applied = 0;
    for (let i = 0; i < resolved.length; i++) {
      const node = resolved[i].node;
      if (isDynamicOnlyNode(node)) continue;
      let el = resolved[i].el;
      if (!el && byPath && node.path != null) {
        el = byPath.get(String(node.path)) || null;
      }
      if (!el) el = elementMatchingOriginalText(node);
      if (!el) continue;
      const next = String(node.text || '');
      if (
        currentUnitText(el, node)
          .replace(/\s+/g, ' ')
          .trim() === next.replace(/\s+/g, ' ').trim()
      ) {
        continue;
      }
      writeVisibleText(el, node, next);
      applied += 1;
    }
    return applied;
  }

  function restoreOriginal() {
    if (selectedEl && originalSnapshot.length) {
      applyNodesToDom(selectedEl, originalSnapshot);
    }
  }

  function connectWs() {
    let companionOnline = false;

    function setGleanEnabled(on) {
      companionOnline = !!on;
      window.__CRANK_COMPANION_ONLINE__ = companionOnline;
      try {
        const gleanBtn = panel && panel.querySelector('#vc-glean');
        if (gleanBtn && !gleanActiveEpoch) gleanBtn.disabled = false;
      } catch (_) {}
    }

    function scheduleReconnect() {
      const delay = Math.min(
        (window.__CRANK_WS_BACKOFF__ || 1500) * 1.5,
        30000
      );
      window.__CRANK_WS_BACKOFF__ = delay;
      setTimeout(function () {
        connectWs();
      }, delay);
    }

    /** HTTP /health is enough for Ask Glean (uses POST /api/variants). WS is optional. */
    async function probeCompanionHttp() {
      try {
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const abortTimer = ctl ? setTimeout(function () { ctl.abort(); }, 3000) : null;
        let resp;
        try {
          resp = await fetch(COMPANION_HTTP + '/health', {
            cache: 'no-store',
            headers: authHeaders(),
            signal: ctl ? ctl.signal : undefined
          });
        } finally {
          if (abortTimer) clearTimeout(abortTimer);
        }
        const data = await resp.json().catch(function () {
          return {};
        });
        if (resp.status === 401 && data && (data.code === 'TEAM_TOKEN_REQUIRED' || data.code === 'TEAM_TOKEN_INVALID')) {
          setGleanEnabled(true);
          hideCompanionOfflineUI();
          setAgentStatus('running', 'Agent running — team token required');
          if (!getTeamToken() || data.code === 'TEAM_TOKEN_INVALID') {
            showTeamAuthUI(uiMode === 'panel' ? 'panel' : 'both');
          }
          syncGleanButton();
          return true;
        }
        if (resp.ok && data && data.ok !== false) {
          setGleanEnabled(true);
          hideCompanionOfflineUI();
          setAgentStatus('running', 'Agent running');
          const wsOpen = socket && socket.readyState === 1;
          const authed = !!getTeamToken();
          if (uiMode === 'panel' && sessionId) {
            setStatus('Selection ready — preview/edit or Ask Glean');
          } else if (data.teamAuthRequired && !authed) {
            setStatus('Companion online — enter team token to enable Ask Glean');
          } else {
            setStatus(
              wsOpen
                ? 'Connected to companion'
                : 'Companion ready — select copy, then Ask Glean'
            );
          }
          syncGleanButton();
          if (panelAutoUpdateEnabled()) {
            schedulePanelAutoUpdate(COMPANION_HTTP);
          }
          return true;
        }
      } catch (_) {}
      setGleanEnabled(false);
      showCompanionOfflineUI();
      setAgentStatus('offline', 'Agent not running');
      setStatus('');
      syncGleanButton();
      return false;
    }

    window.__crankProbeCompanion = probeCompanionHttp;

    try {
      if (socket) {
        try {
          socket.onclose = null;
          socket.close();
        } catch (_) {}
        socket = null;
      }
      socket = new WebSocket(wsUrlWithToken());
      socket.addEventListener('open', function () {
        window.__CRANK_WS_BACKOFF__ = 1500;
        setGleanEnabled(true);
        setStatus('Connected to companion');
      });
      socket.addEventListener('message', function (ev) {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch (_) {
          return;
        }
        if (msg.type === 'SELECTION_ACK' && msg.session) {
          applySessionFromServer(msg.session);
          showFreshSelection();
          setStatus('Selection ready — preview/edit or Ask Glean');
        }
        if (msg.type === 'VARIANTS_READY' && msg.session) {
          if (viewedRequestId) return;
          if (msg.session.id && sessionId && msg.session.id !== sessionId) return;
          sessionId = msg.session.id;
          gleanActiveEpoch = 0;
          hideThinking();
          renderVariants(msg.session.variants || []);
          setStatus('Glean returned ' + (msg.session.variants || []).length + ' options');
          syncGleanButton();
        }
        if (msg.type === 'GLEAN_PROGRESS') {
          const live = viewedRequestId && liveRequests[viewedRequestId];
          if (!live) return;
          if (msg.sessionId && live.sessionId && msg.sessionId !== live.sessionId) return;
          showThinking(msg.progress || {});
        }
        if (msg.type === 'GLEAN_ERROR') {
          if (viewedRequestId) return;
          gleanActiveEpoch = 0;
          hideThinking();
          setStatus('Glean error: ' + (msg.error || 'unknown'));
          syncGleanButton();
        }
        if (msg.type === 'ERROR' && msg.code === 'TEAM_TOKEN_REQUIRED') {
          setTeamToken('');
          showTeamAuthUI(uiMode === 'panel' ? 'panel' : 'fab');
          setStatus('Paste your team token to connect');
        }
        if (msg.type === 'APPLY_VARIANT' && selectedEl) {
          applyNodesToDom(selectedEl, msg.nodes || []);
          if (msg.variantId) activeVariantId = msg.variantId;
          markActiveVariantCard(activeVariantId);
          if (msg.preview) {
            setStatus('Previewed in DOM (not saved)');
          } else if (msg.persistResult) {
            setStatus(formatPersistStatus(msg.persistResult, msg.variantId));
          } else {
            setStatus('Applied variant in DOM');
          }
        }
        if (msg.type === 'APPLY_RESULT') {
          if (msg.persistResult) {
            setStatus(formatPersistStatus(msg.persistResult, msg.variantId));
          } else if (msg.preview) {
            setStatus('Previewed in DOM (not saved)');
          }
        }
        if (msg.type === 'PREVIEW_TEXT' && selectedEl) {
          applyNodesToDom(selectedEl, msg.nodes || []);
        }
        if (msg.type === 'DISCARD_TEXT_PREVIEW') {
          restoreOriginal();
          setStatus('Preview discarded');
        }
        if (msg.type === 'SAVE_RESULT') {
          const p = msg.payload || {};
          setStatus(
            p.success
              ? 'Saved to source' + (p.file ? ': ' + p.file : '')
              : 'Save failed: ' + (p.error || 'unknown')
          );
        }
        if (msg.type === 'AGENT_PROMPT_QUEUED') {
          const t = msg.task || {};
          if (t.prompt) {
            finishAgentQueue(t, {
              fromWs: true,
              skipCopy: true
            });
          } else {
            const wsMsg =
              'Queued — ' +
        PASTE_IN_AGENT_CHAT +
        ' (or ask: ' +
              AGENT_SHORT_PROMPT +
              ')';
            showToast(wsMsg, 'ok');
            setStatus(wsMsg);
          }
        }
        if (msg.type === 'ERROR') {
          setStatus('Error: ' + (msg.error || 'unknown'));
        }
      });
      socket.addEventListener('close', function () {
        // Prefer HTTP health — Replit often blocks wss on secondary ports (404).
        probeCompanionHttp().finally(function () {
          scheduleReconnect();
        });
      });
      socket.addEventListener('error', function () {
        probeCompanionHttp();
      });
    } catch (err) {
      probeCompanionHttp().finally(function () {
        scheduleReconnect();
      });
    }
  }

  function sendWs(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  // Short default for selection/preview/save. Glean /api/variants needs 3–5 min
  // (Robot Content Designer ~90–140s) — callers must pass timeoutMs explicitly.
  const GLEAN_VARIANTS_TIMEOUT_MS = 300000;

  async function postJson(path, body, options) {
    const opts = options || {};
    const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 20000;
    const controller =
      typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = null;
    if (controller && timeoutMs > 0) {
      timer = setTimeout(function () {
        try {
          controller.abort();
        } catch (_) {
          /* ignore */
        }
      }, timeoutMs);
    }
    let res;
    try {
      res = await fetch(COMPANION_HTTP + path, {
        method: opts.method || 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: opts.method === 'GET' ? undefined : JSON.stringify(body),
        signal: controller ? controller.signal : undefined
      });
    } catch (err) {
      if (timer) clearTimeout(timer);
      if (err && err.name === 'AbortError') {
        throw new Error('Request timed out after ' + timeoutMs + 'ms');
      }
      const m = (err && err.message) || String(err || '');
      if (
        /Failed to fetch|NetworkError|Load failed|Network request failed|fetch failed/i.test(
          m
        )
      ) {
        throw new Error(
          'Companion not running — start with npx crank / open :3344'
        );
      }
      throw err;
    }
    if (timer) clearTimeout(timer);
    let data = {};
    try {
      data = await res.json();
    } catch (_) {
      data = {};
    }
    if (!res.ok) {
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        throw new Error(
          'Companion not reachable (' +
            res.status +
            ') — start it with: cd crank && npm run dev'
        );
      }
      if (res.status === 401 && (data.code === 'TEAM_TOKEN_REQUIRED' || data.code === 'TEAM_TOKEN_INVALID')) {
        setTeamToken('');
        showTeamAuthUI(uiMode === 'panel' ? 'panel' : 'both');
        setStatus('Paste your team token below, then click Save token');
      }
      const err = new Error(data.error || 'HTTP ' + res.status);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function formatPersistStatus(persistResult, variantId) {
    if (!persistResult) {
      return 'Applied in DOM';
    }
    const bits = ['Applied in DOM'];
    if (persistResult.summary) bits.push(persistResult.summary);
    const locked = (persistResult.results || []).filter(function (r) {
      return r.status === 'skipped' && r.reason === 'locked';
    });
    const failed = (persistResult.results || []).filter(function (r) {
      return r.status === 'failed';
    });
    if (locked.length) {
      bits.push(
        locked.length +
          ' locked/dynamic field(s) not written — use Agent or edit source'
      );
    }
    if (failed.length) {
      bits.push(
        'Save failed: ' + (failed[0].message || 'could not write source')
      );
    }
    if (variantId && !persistResult.persisted && !failed.length && locked.length) {
      bits.push('(DOM only)');
    }
    return bits.join(' · ');
  }

  function roleLabel(role, node, index, nodes) {
    if (node && node.label) return node.label;
    if (node && nodes) return unitDisplayLabel(node, index, nodes);
    const r = normalizeRole(role);
    if (r === 'heading') return 'Heading';
    if (r === 'action' || r === 'button') return 'CTA';
    if (r === 'label') return 'Label';
    return 'Copy';
  }

  function sourceChips(textSource) {
    if (textSource && Array.isArray(textSource.chips) && textSource.chips.length) {
      return textSource.chips;
    }
    const type = textSource && textSource.type;
    if (type === 'dynamic-data') return ['Dynamic'];
    if (type === 'bound-unknown') return ['Bound'];
    if (type === 'mixed') return ['Mixed'];
    return ['Static'];
  }

  const PANEL_THEME_KEY = 'crank.panelTheme';
  const PANEL_DOCK_KEY = 'crank.panelDock';
  const DEPTH_TUNE_KEY = 'crank.controlDepthTune';
  const DEPTH_TUNE_NUMERIC_KEYS = ['top', 'bottom', 'drop', 'hairline', 'button', 'focus'];
  const DEPTH_TUNE_COLOR_KEYS = [
    'edgeColor',
    'highlightColor',
    'borderColor',
    'surfaceColor',
    'focusColor'
  ];
  const DEPTH_TUNE_CSS_VAR = {
    top: '--vp-depth-top',
    bottom: '--vp-depth-bottom',
    drop: '--vp-depth-drop',
    hairline: '--vp-depth-hairline',
    button: '--vp-depth-button',
    focus: '--vp-depth-focus',
    edgeColor: '--vp-depth-edge-color',
    highlightColor: '--vp-depth-highlight-color',
    borderColor: '--vp-depth-border-color',
    surfaceColor: '--vp-depth-surface-color',
    focusColor: '--vp-depth-focus-color'
  };
  let depthTuneCssDefaults = null;
  const CONTROL_EFFECTS_KEY = 'crank.controlEffects';
  const FX_LAYER_COUNT = 4;
  const DEFAULT_CONTROL_EFFECTS = {
    radius: 12.6957,
    borderWidth: 1,
    backgroundColor: '#ffffff',
    borderColor: '#bebebe',
    borderOpacity: 8,
    focusColor: '#639ee0',
    focusOpacity: 100,
    layers: [
      {
        enabled: true,
        kind: 'inner',
        x: 0,
        y: 1,
        blur: 4.5,
        spread: -2,
        color: '#ffffff',
        opacity: 40
      },
      {
        enabled: true,
        kind: 'inner',
        x: 0,
        y: -2,
        blur: 6.5,
        spread: -3,
        color: '#000000',
        opacity: 9
      },
      {
        enabled: true,
        kind: 'drop',
        x: 0,
        y: 2,
        blur: 4,
        spread: -1,
        color: '#000000',
        opacity: 7
      },
      {
        enabled: false,
        kind: 'inner',
        x: 0,
        y: 0,
        blur: 4.5,
        spread: -2,
        color: '#000000',
        opacity: 6
      }
    ]
  };
  let controlEffectsCssDefaults = null;
  const PANEL_DOCK_WIDTH = '380px';
  let dockedPageStyle = null;

  function readPanelDocked() {
    try {
      return localStorage.getItem(PANEL_DOCK_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function setPageScrollbarHidden(hidden) {
    const html = document.documentElement;
    if (!html) return;
    if (hidden) {
      if (html.getAttribute('data-crank-page-scroll') !== 'hidden') {
        const gap = Math.max(0, window.innerWidth - html.clientWidth);
        html.style.setProperty('--crank-scrollbar-gap', gap + 'px');
      }
      html.setAttribute('data-crank-page-scroll', 'hidden');
      return;
    }
    html.removeAttribute('data-crank-page-scroll');
    html.style.removeProperty('--crank-scrollbar-gap');
  }

  function applyDockedPageLayout(docked) {
    const html = document.documentElement;
    const body = document.body;
    if (docked && panel && panel.parentNode) {
      if (!dockedPageStyle || !dockedPageStyle.parentNode) {
        const style = document.createElement('style');
        style.id = 'crank-docked-page-layout-style';
        style.textContent = [
          ':root{--crank-dock-width:' + PANEL_DOCK_WIDTH + ' !important;}',
          'html{margin-right:var(--crank-dock-width) !important;overflow-x:hidden !important;}',
          'body{overflow-x:hidden !important;position:relative !important;transform:translateZ(0) !important;}'
        ].join('');
        (document.head || html).appendChild(style);
        dockedPageStyle = style;
      }
      if (html) html.style.setProperty('margin-right', PANEL_DOCK_WIDTH, 'important');
      if (body) body.style.removeProperty('margin-right');
      return;
    }
    if (dockedPageStyle && dockedPageStyle.parentNode) {
      dockedPageStyle.parentNode.removeChild(dockedPageStyle);
    }
    dockedPageStyle = null;
    if (html) html.style.removeProperty('margin-right');
    if (body) body.style.removeProperty('margin-right');
  }

  function applyPanelLayout() {
    if (!panel) return;
    const docked = readPanelDocked();
    if (docked) {
      panel.setAttribute('data-crank-dock', '1');
      panel.style.top = '0';
      panel.style.right = '0';
      panel.style.bottom = '0';
      panel.style.left = 'auto';
      panel.style.width = PANEL_DOCK_WIDTH;
      panel.style.height = '100vh';
      panel.style.maxHeight = '100vh';
      panel.style.borderRadius = '0';
    } else {
      panel.removeAttribute('data-crank-dock');
      panel.style.top = '16px';
      panel.style.right = '16px';
      panel.style.bottom = 'auto';
      panel.style.left = 'auto';
      panel.style.width = PANEL_DOCK_WIDTH;
      panel.style.height = 'calc(100vh - 32px)';
      panel.style.maxHeight = 'calc(100vh - 32px)';
      panel.style.borderRadius = '';
    }
    applyDockedPageLayout(docked);
    syncLauncher();
  }

  let crankTooltip = null;

  function ensureCrankTooltip() {
    if (crankTooltip && crankTooltip.isConnected) return crankTooltip;
    crankTooltip = document.createElement('div');
    crankTooltip.id = 'vp-crank-tooltip';
    crankTooltip.setAttribute('role', 'tooltip');
    crankTooltip.hidden = true;
    document.documentElement.appendChild(crankTooltip);
    return crankTooltip;
  }

  function showCrankTooltip(btn) {
    const text = btn.getAttribute('data-tip');
    if (!text) return;
    const tip = ensureCrankTooltip();
    tip.textContent = text;
    tip.hidden = false;
    // The docked panel is also z-index max and paints over a tip created earlier.
    document.documentElement.appendChild(tip);
    const rect = btn.getBoundingClientRect();
    tip.style.position = 'fixed';
    tip.style.zIndex = '2147483647';
    tip.style.left = rect.left + rect.width / 2 + 'px';
    tip.style.top = rect.top - 6 + 'px';
    tip.style.transform = 'translate(-50%, -100%)';
    tip.style.pointerEvents = 'none';
  }

  function hideCrankTooltip() {
    if (crankTooltip) crankTooltip.hidden = true;
  }

  function syncDockIcon() {
    const dockBtn = launcher && launcher.querySelector('#vp-crank-dock');
    if (!dockBtn) return;
    const docked = readPanelDocked();
    const label = docked ? 'Float' : 'Dock';
    dockBtn.innerHTML = toolIcon(docked ? 'undock' : 'dock');
    dockBtn.setAttribute('data-tip', label);
    dockBtn.setAttribute('aria-label', label);
    dockBtn.classList.remove('is-active');
  }

  function syncChromeIcons() {
    syncDockIcon();
  }

  function togglePanelDock() {
    const next = !readPanelDocked();
    try {
      localStorage.setItem(PANEL_DOCK_KEY, next ? '1' : '0');
    } catch (_) {}
    applyPanelLayout();
  }

  function themeModeIcon(theme) {
    if (theme === 'dark') {
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18 12C18 15.3137 15.3137 18 12 18C8.68629 18 6 15.3137 6 12C6 8.68629 8.68629 6 12 6C15.3137 6 18 8.68629 18 12Z" fill="currentColor"/><path fill-rule="evenodd" clip-rule="evenodd" d="M12 1.25C12.4142 1.25 12.75 1.58579 12.75 2V3C12.75 3.41421 12.4142 3.75 12 3.75C11.5858 3.75 11.25 3.41421 11.25 3V2C11.25 1.58579 11.5858 1.25 12 1.25ZM4.39861 4.39861C4.6915 4.10572 5.16638 4.10572 5.45927 4.39861L5.85211 4.79145C6.145 5.08434 6.145 5.55921 5.85211 5.85211C5.55921 6.145 5.08434 6.145 4.79145 5.85211L4.39861 5.45927C4.10572 5.16638 4.10572 4.6915 4.39861 4.39861ZM19.6011 4.39887C19.894 4.69176 19.894 5.16664 19.6011 5.45953L19.2083 5.85237C18.9154 6.14526 18.4405 6.14526 18.1476 5.85237C17.8547 5.55947 17.8547 5.0846 18.1476 4.79171L18.5405 4.39887C18.8334 4.10598 19.3082 4.10598 19.6011 4.39887ZM1.25 12C1.25 11.5858 1.58579 11.25 2 11.25H3C3.41421 11.25 3.75 11.5858 3.75 12C3.75 12.4142 3.41421 12.75 3 12.75H2C1.58579 12.75 1.25 12.4142 1.25 12ZM20.25 12C20.25 11.5858 20.5858 11.25 21 11.25H22C22.4142 11.25 22.75 11.5858 22.75 12C22.75 12.4142 22.4142 12.75 22 12.75H21C20.5858 12.75 20.25 12.4142 20.25 12ZM18.1476 18.1476C18.4405 17.8547 18.9154 17.8547 19.2083 18.1476L19.6011 18.5405C19.894 18.8334 19.894 19.3082 19.6011 19.6011C19.3082 19.894 18.8334 19.894 18.5405 19.6011L18.1476 19.2083C17.8547 18.9154 17.8547 18.4405 18.1476 18.1476ZM5.85211 18.1479C6.145 18.4408 6.145 18.9157 5.85211 19.2086L5.45927 19.6014C5.16638 19.8943 4.6915 19.8943 4.39861 19.6014C4.10572 19.3085 4.10572 18.8336 4.39861 18.5407L4.79145 18.1479C5.08434 17.855 5.55921 17.855 5.85211 18.1479ZM12 20.25C12.4142 20.25 12.75 20.5858 12.75 21V22C12.75 22.4142 12.4142 22.75 12 22.75C11.5858 22.75 11.25 22.4142 11.25 22V21C11.25 20.5858 11.5858 20.25 12 20.25Z" fill="currentColor"/></svg>';
    }
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 22C17.5228 22 22 17.5228 22 12C22 11.5373 21.3065 11.4608 21.0672 11.8568C19.9289 13.7406 17.8615 15 15.5 15C11.9101 15 9 12.0899 9 8.5C9 6.13845 10.2594 4.07105 12.1432 2.93276C12.5392 2.69347 12.4627 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" fill="currentColor"/></svg>';
  }

  function readPanelTheme() {
    try {
      return localStorage.getItem(PANEL_THEME_KEY) === 'dark' ? 'dark' : 'light';
    } catch (_) {
      return 'light';
    }
  }

  function applyPanelTheme(theme) {
    const next = theme === 'dark' ? 'dark' : 'light';
    if (panel) {
      if (next === 'dark') panel.setAttribute('data-theme', 'dark');
      else panel.removeAttribute('data-theme');
    }
    try {
      localStorage.setItem(PANEL_THEME_KEY, next);
    } catch (_) {}
    syncChromeIcons();
  }

  function clampDepth(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(1, Math.max(0, n));
  }

  function normalizeHexColor(value, fallback) {
    const s = String(value == null ? '' : value).trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      return (
        '#' +
        s[1] +
        s[1] +
        s[2] +
        s[2] +
        s[3] +
        s[3]
      ).toLowerCase();
    }
    return fallback;
  }

  function cssColorToHex(value, fallback) {
    const direct = normalizeHexColor(value, '');
    if (direct) return direct;
    if (!panel) return fallback;
    try {
      const probe = document.createElement('span');
      probe.style.color = String(value || '').trim();
      panel.appendChild(probe);
      const rgb = getComputedStyle(probe).color;
      panel.removeChild(probe);
      const m = rgb.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
      if (!m) return fallback;
      const hex = function (n) {
        const h = Number(n).toString(16);
        return h.length === 1 ? '0' + h : h;
      };
      return ('#' + hex(m[1]) + hex(m[2]) + hex(m[3])).toLowerCase();
    } catch (_) {
      return fallback;
    }
  }

  function captureDepthTuneCssDefaults() {
    if (!panel) return null;
    if (depthTuneCssDefaults) return depthTuneCssDefaults;
    clearDepthTuneInline();
    const cs = getComputedStyle(panel);
    const out = {};
    DEPTH_TUNE_NUMERIC_KEYS.forEach(function (key) {
      const raw = cs.getPropertyValue(DEPTH_TUNE_CSS_VAR[key]).trim();
      const n = parseFloat(raw);
      out[key] = clampDepth(Number.isFinite(n) ? n : 0, 0);
    });
    const surfaceFallback = cssColorToHex(cs.getPropertyValue('--background').trim(), '#ffffff');
    DEPTH_TUNE_COLOR_KEYS.forEach(function (key) {
      const raw = cs.getPropertyValue(DEPTH_TUNE_CSS_VAR[key]).trim();
      out[key] = cssColorToHex(raw, surfaceFallback);
    });
    depthTuneCssDefaults = out;
    return out;
  }

  function defaultDepthTune() {
    return Object.assign({}, captureDepthTuneCssDefaults() || {});
  }

  function hasStoredDepthTune() {
    try {
      if (localStorage.getItem(DEPTH_TUNE_KEY)) return true;
      const legacy = localStorage.getItem('crank.controlDepth');
      return legacy != null && legacy !== '';
    } catch (_) {
      return false;
    }
  }

  function clearDepthTuneInline() {
    if (!panel) return;
    DEPTH_TUNE_NUMERIC_KEYS.concat(DEPTH_TUNE_COLOR_KEYS).forEach(function (key) {
      panel.style.removeProperty(DEPTH_TUNE_CSS_VAR[key]);
    });
  }

  function readDepthTune() {
    const tune = defaultDepthTune();
    try {
      const raw = localStorage.getItem(DEPTH_TUNE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          DEPTH_TUNE_NUMERIC_KEYS.concat(DEPTH_TUNE_COLOR_KEYS).forEach(function (key) {
            if (parsed[key] == null) return;
            if (DEPTH_TUNE_COLOR_KEYS.indexOf(key) !== -1) {
              tune[key] = normalizeHexColor(parsed[key], tune[key]);
            } else {
              tune[key] = clampDepth(parsed[key], tune[key]);
            }
          });
        }
      } else {
        const legacy = localStorage.getItem('crank.controlDepth');
        if (legacy != null && legacy !== '') {
          const n = clampDepth(legacy, tune.top);
          tune.top = n;
          tune.bottom = n;
          tune.drop = n;
          tune.hairline = n;
          tune.button = n;
        }
      }
    } catch (_) {}
    return tune;
  }

  function persistDepthTune(tune) {
    try {
      localStorage.setItem(DEPTH_TUNE_KEY, JSON.stringify(tune));
    } catch (_) {}
  }

  function cloneControlEffects(effects) {
    const base = effects || DEFAULT_CONTROL_EFFECTS;
  return {
    radius: Number(base.radius),
    borderWidth: Number(base.borderWidth),
    backgroundColor: base.backgroundColor,
    borderColor: base.borderColor,
    borderOpacity: Number(base.borderOpacity),
    focusColor: base.focusColor,
    focusOpacity: Number(base.focusOpacity),
    layers: (base.layers || []).map(function (layer) {
      return Object.assign({}, layer);
    })
  };
}

  function normalizeControlEffects(effects) {
    const next = cloneControlEffects(DEFAULT_CONTROL_EFFECTS);
    const src = effects || {};
    next.radius = clampDepth(Number(src.radius) / 24, next.radius / 24) * 24;
    if (!Number.isFinite(next.radius) || next.radius <= 0) next.radius = DEFAULT_CONTROL_EFFECTS.radius;
    next.borderWidth = Math.min(4, Math.max(0, Number(src.borderWidth)));
    if (!Number.isFinite(next.borderWidth)) next.borderWidth = DEFAULT_CONTROL_EFFECTS.borderWidth;
    next.backgroundColor = normalizeHexColor(src.backgroundColor, next.backgroundColor);
    next.borderColor = normalizeHexColor(src.borderColor, next.borderColor);
    next.focusColor = normalizeHexColor(src.focusColor, next.focusColor);
    next.borderOpacity = Math.min(100, Math.max(0, Math.round(Number(src.borderOpacity))));
    if (!Number.isFinite(next.borderOpacity)) next.borderOpacity = DEFAULT_CONTROL_EFFECTS.borderOpacity;
    next.focusOpacity = Math.min(100, Math.max(0, Math.round(Number(src.focusOpacity))));
    if (!Number.isFinite(next.focusOpacity)) next.focusOpacity = DEFAULT_CONTROL_EFFECTS.focusOpacity;
    const layers = Array.isArray(src.layers) ? src.layers : [];
    for (let i = 0; i < FX_LAYER_COUNT; i += 1) {
      const layer = layers[i] || DEFAULT_CONTROL_EFFECTS.layers[i] || DEFAULT_CONTROL_EFFECTS.layers[0];
      const kind = layer.kind === 'inner' ? 'inner' : 'drop';
      next.layers[i] = {
        enabled: !!layer.enabled,
        kind: kind,
        x: Number(layer.x) || 0,
        y: Number(layer.y) || 0,
        blur: Math.max(0, Number(layer.blur) || 0),
        spread: Number(layer.spread) || 0,
        color: normalizeHexColor(layer.color, '#000000'),
        opacity: Math.min(100, Math.max(0, Math.round(Number(layer.opacity))))
      };
      if (!Number.isFinite(next.layers[i].opacity)) next.layers[i].opacity = 0;
    }
    return next;
  }

  function hasStoredControlEffects() {
    try {
      return !!localStorage.getItem(CONTROL_EFFECTS_KEY);
    } catch (_) {
      return false;
    }
  }

  function readControlEffects() {
    const tune = normalizeControlEffects(DEFAULT_CONTROL_EFFECTS);
    try {
      const raw = localStorage.getItem(CONTROL_EFFECTS_KEY);
      if (!raw) return tune;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return normalizeControlEffects(parsed);
    } catch (_) {}
    return tune;
  }

  function persistControlEffects(effects) {
    try {
      localStorage.setItem(CONTROL_EFFECTS_KEY, JSON.stringify(normalizeControlEffects(effects)));
    } catch (_) {}
  }

  function hexToRgbParts(hex) {
    const value = normalizeHexColor(hex, '#000000');
    return {
      r: parseInt(value.slice(1, 3), 16),
      g: parseInt(value.slice(3, 5), 16),
      b: parseInt(value.slice(5, 7), 16)
    };
  }

  function composeFxShadowFromLayers(layers) {
    const parts = [];
    (layers || []).forEach(function (layer) {
      if (!layer || !layer.enabled) return;
      const rgb = hexToRgbParts(layer.color);
      const alpha = Math.min(1, Math.max(0, Number(layer.opacity) / 100));
      const inset = layer.kind === 'inner' ? 'inset ' : '';
      parts.push(
        inset +
          layer.x +
          'px ' +
          layer.y +
          'px ' +
          layer.blur +
          'px ' +
          layer.spread +
          'px rgb(' +
          rgb.r +
          ' ' +
          rgb.g +
          ' ' +
          rgb.b +
          ' / ' +
          alpha +
          ')'
      );
    });
    return parts.join(', ');
  }

  function clearControlEffectsInline() {
    if (!panel) return;
    const names = [
      '--vp-fx-field-shadow',
      '--vp-fx-field-shadow-hover',
      '--vp-fx-secondary-shadow',
      '--vp-fx-secondary-shadow-hover',
      '--vp-fx-control-border-width'
    ];
    names.forEach(function (name) {
      panel.style.removeProperty(name);
    });
  }

  function applyControlEffectsVars(effects) {
    const next = normalizeControlEffects(effects);
    if (!panel) return next;
    const fieldShadow = composeFxShadowFromLayers(next.layers);
    const elev =
      '0 1px 1px 0 color-mix(in srgb, #11141c 5.5%, transparent)';
    const secondary = fieldShadow ? fieldShadow + ', ' + elev : '';
    if (fieldShadow) {
      panel.style.setProperty('--vp-fx-field-shadow', fieldShadow);
      panel.style.setProperty('--vp-fx-field-shadow-hover', fieldShadow);
      panel.style.setProperty('--vp-fx-secondary-shadow', secondary);
      panel.style.setProperty('--vp-fx-secondary-shadow-hover', secondary);
    } else {
      panel.style.removeProperty('--vp-fx-field-shadow');
      panel.style.removeProperty('--vp-fx-field-shadow-hover');
      panel.style.removeProperty('--vp-fx-secondary-shadow');
      panel.style.removeProperty('--vp-fx-secondary-shadow-hover');
    }
    panel.style.setProperty('--vp-control-shell-radius', String(next.radius) + 'px');
    panel.style.setProperty('--vp-fx-control-border-width', String(next.borderWidth) + 'px');
    panel.style.setProperty('--vp-depth-surface-color', next.backgroundColor);
    panel.style.setProperty('--vp-input-surface-gradient', next.backgroundColor);
    panel.style.setProperty('--vp-input-surface-gradient-hover', next.backgroundColor);
    panel.style.setProperty('--vp-input-surface-gradient-focus', next.backgroundColor);
    const borderStroke =
      'color-mix(in srgb, ' +
      next.borderColor +
      ' ' +
      next.borderOpacity +
      '%, transparent)';
    panel.style.setProperty('--vp-button-secondary-face-stroke', borderStroke);
    panel.style.setProperty('--vp-depth-border-color', next.borderColor);
    panel.style.setProperty('--vp-depth-focus-color', next.focusColor);
    panel.style.setProperty('--vp-depth-focus', String(next.focusOpacity / 100));
    return next;
  }

  function fxNumInput(id, value, step) {
    return (
      '<input type="number" id="' +
      id +
      '" step="' +
      step +
      '" value="' +
      value +
      '" inputmode="decimal" />'
    );
  }

  function buildFxShadowRow(index, layer) {
    const title = layer.kind === 'inner' ? 'Inner shadow' : 'Drop shadow';
    return (
      '<div class="vc-fx-shadow-row" data-fx-layer="' +
      index +
      '">' +
      '<div class="vc-fx-shadow-head">' +
      '<input type="checkbox" class="vc-fx-layer-enable" id="vc-fx-layer-' +
      index +
      '-on"' +
      (layer.enabled ? ' checked' : '') +
      ' />' +
      '<label class="vc-fx-shadow-title vp-type-micro" for="vc-fx-layer-' +
      index +
      '-on">' +
      title +
      '</label>' +
      '</div>' +
      '<motion class="vc-fx-shadow-grid">' +
      '<label>X' +
      fxNumInput('vc-fx-layer-' + index + '-x', layer.x, '0.1') +
      '</label>' +
      '<label>Y' +
      fxNumInput('vc-fx-layer-' + index + '-y', layer.y, '0.1') +
      '</label>' +
      '<label>Blur' +
      fxNumInput('vc-fx-layer-' + index + '-blur', layer.blur, '0.1') +
      '</label>' +
      '<label>Spread' +
      fxNumInput('vc-fx-layer-' + index + '-spread', layer.spread, '0.1') +
      '</label>' +
      '</motion>' +
      '<div class="vc-fx-shadow-color">' +
      '<input type="color" id="vc-fx-layer-' +
      index +
      '-color" value="' +
      layer.color +
      '" />' +
      '<input type="text" class="vc-fx-hex" id="vc-fx-layer-' +
      index +
      '-hex" value="' +
      layer.color +
      '" spellcheck="false" />' +
      '<span class="vc-fx-opacity-wrap">' +
      '<input type="number" class="vc-fx-opacity" id="vc-fx-layer-' +
      index +
      '-opacity" min="0" max="100" step="1" value="' +
      layer.opacity +
      '" />' +
      '<span>%</span></span>' +
      '</div></div>'
    );
  }

  function buildFxInspectorHtml(effects) {
    const fx = normalizeControlEffects(effects || DEFAULT_CONTROL_EFFECTS);
    const layersHtml = fx.layers
      .map(function (layer, index) {
        return buildFxShadowRow(index, layer);
      })
      .join('');
    return (
      '<div class="vc-settings-block vc-fx-inspector">' +
      '<div class="vc-fx-section-head">' +
      '<div class="vc-readout-label">Light controls</div>' +
      '<span class="vc-fx-section-tag">Hex</span>' +
      '</div>' +
      '<p class="vp-muted vp-type-micro vc-fx-inspector-lead">Figma-style fills and shadow stacks for inputs, selects, and buttons.</p>' +
      '<motion class="vc-fx-metrics">' +
      '<div class="vc-fx-metric">' +
      '<span class="vc-fx-metric-label vp-type-micro">Radius</span>' +
      fxNumInput('vc-fx-radius', fx.radius, '0.0001') +
      '</div>' +
      '<div class="vc-fx-metric">' +
      '<span class="vc-fx-metric-label vp-type-micro">Border</span>' +
      fxNumInput('vc-fx-border-width', fx.borderWidth, '1') +
      '</div>' +
      '<span class="vc-fx-metric vc-fx-metric--static vp-type-micro">Inside</span>' +
      '</motion>' +
      '<div class="vc-fx-section">' +
      '<motion class="vc-fx-section-head"><span class="vc-readout-label">Colors</span><span class="vc-fx-section-tag">Hex</span></div>' +
      '<div class="vc-fx-color-row">' +
      '<span class="vc-fx-color-label vp-type-micro">Background</span>' +
      '<input type="color" id="vc-fx-bg-color" value="' +
      fx.backgroundColor +
      '" />' +
      '<input type="text" class="vc-fx-hex" id="vc-fx-bg-hex" value="' +
      fx.backgroundColor +
      '" spellcheck="false" />' +
      '<span class="vc-fx-opacity-wrap"><input type="number" class="vc-fx-opacity" id="vc-fx-bg-opacity" min="0" max="100" value="100" /><span>%</span></span>' +
      '</div>' +
      '<div class="vc-fx-color-row">' +
      '<span class="vc-fx-color-label vp-type-micro">Border</span>' +
      '<input type="color" id="vc-fx-border-color" value="' +
      fx.borderColor +
      '" />' +
      '<input type="text" class="vc-fx-hex" id="vc-fx-border-hex" value="' +
      fx.borderColor +
      '" spellcheck="false" />' +
      '<span class="vc-fx-opacity-wrap"><input type="number" class="vc-fx-opacity" id="vc-fx-border-opacity" min="0" max="100" value="' +
      fx.borderOpacity +
      '" /><span>%</span></span>' +
      '</div>' +
      '<div class="vc-fx-color-row">' +
      '<span class="vc-fx-color-label vp-type-micro">Focus ring</span>' +
      '<input type="color" id="vc-fx-focus-color" value="' +
      fx.focusColor +
      '" />' +
      '<input type="text" class="vc-fx-hex" id="vc-fx-focus-hex" value="' +
      fx.focusColor +
      '" spellcheck="false" />' +
      '<span class="vc-fx-opacity-wrap"><input type="number" class="vc-fx-opacity" id="vc-fx-focus-opacity" min="0" max="100" value="' +
      fx.focusOpacity +
      '" /><span>%</span></span>' +
      '</div></motion>' +
      '<div class="vc-fx-section">' +
      '<div class="vc-fx-section-head"><span class="vc-readout-label">Shadows and blurs</span><span class="vc-fx-section-tag">Hex</span></div>' +
      layersHtml +
      '</div>' +
      '<div class="vc-fx-inspector-actions">' +
      '<button type="button" id="vc-settings-depth-reset" class="vp-button-secondary-surface vp-control-shell vc-button-surface-control vp-control-typography vc-settings-depth-reset">Reset to defaults</button>' +
      '</div></div>'
    );
  }

  function readControlEffectsFromDom() {
    if (!panel) return normalizeControlEffects(DEFAULT_CONTROL_EFFECTS);
    const effects = normalizeControlEffects(DEFAULT_CONTROL_EFFECTS);
    const radius = panel.querySelector('#vc-fx-radius');
    const borderWidth = panel.querySelector('#vc-fx-border-width');
    if (radius) effects.radius = Number(radius.value);
    if (borderWidth) effects.borderWidth = Number(borderWidth.value);
    const bgColor = panel.querySelector('#vc-fx-bg-color');
    const borderColor = panel.querySelector('#vc-fx-border-color');
    const focusColor = panel.querySelector('#vc-fx-focus-color');
    if (bgColor) effects.backgroundColor = normalizeHexColor(bgColor.value, effects.backgroundColor);
    if (borderColor) effects.borderColor = normalizeHexColor(borderColor.value, effects.borderColor);
    if (focusColor) effects.focusColor = normalizeHexColor(focusColor.value, effects.focusColor);
    const borderOpacity = panel.querySelector('#vc-fx-border-opacity');
    const focusOpacity = panel.querySelector('#vc-fx-focus-opacity');
    if (borderOpacity) effects.borderOpacity = Number(borderOpacity.value);
    if (focusOpacity) effects.focusOpacity = Number(focusOpacity.value);
    for (let i = 0; i < FX_LAYER_COUNT; i += 1) {
      const layer = effects.layers[i];
      const enabled = panel.querySelector('#vc-fx-layer-' + i + '-on');
      const x = panel.querySelector('#vc-fx-layer-' + i + '-x');
      const y = panel.querySelector('#vc-fx-layer-' + i + '-y');
      const blur = panel.querySelector('#vc-fx-layer-' + i + '-blur');
      const spread = panel.querySelector('#vc-fx-layer-' + i + '-spread');
      const color = panel.querySelector('#vc-fx-layer-' + i + '-color');
      const opacity = panel.querySelector('#vc-fx-layer-' + i + '-opacity');
      if (enabled) layer.enabled = enabled.checked;
      if (x) layer.x = Number(x.value);
      if (y) layer.y = Number(y.value);
      if (blur) layer.blur = Number(blur.value);
      if (spread) layer.spread = Number(spread.value);
      if (color) layer.color = normalizeHexColor(color.value, layer.color);
      if (opacity) layer.opacity = Number(opacity.value);
      layer.kind = DEFAULT_CONTROL_EFFECTS.layers[i].kind;
    }
    return normalizeControlEffects(effects);
  }

  function syncFxHexFields(colorId, hexId) {
    if (!panel) return;
    const color = panel.querySelector(colorId);
    const hex = panel.querySelector(hexId);
    if (color && hex && document.activeElement !== hex) {
      hex.value = normalizeHexColor(color.value, hex.value);
    }
  }

  function syncFxInspectorControls(effects) {
    const next = normalizeControlEffects(effects);
    if (!panel) return next;
    const radius = panel.querySelector('#vc-fx-radius');
    const borderWidth = panel.querySelector('#vc-fx-border-width');
    if (radius && document.activeElement !== radius) radius.value = String(next.radius);
    if (borderWidth && document.activeElement !== borderWidth) {
      borderWidth.value = String(next.borderWidth);
    }
    const bgColor = panel.querySelector('#vc-fx-bg-color');
    const borderColor = panel.querySelector('#vc-fx-border-color');
    const focusColor = panel.querySelector('#vc-fx-focus-color');
    if (bgColor && document.activeElement !== bgColor) {
      bgColor.value = cssColorToHex(next.backgroundColor, bgColor.value);
    }
    if (borderColor && document.activeElement !== borderColor) {
      borderColor.value = cssColorToHex(next.borderColor, borderColor.value);
    }
    if (focusColor && document.activeElement !== focusColor) {
      focusColor.value = cssColorToHex(next.focusColor, focusColor.value);
    }
    syncFxHexFields('#vc-fx-bg-color', '#vc-fx-bg-hex');
    syncFxHexFields('#vc-fx-border-color', '#vc-fx-border-hex');
    syncFxHexFields('#vc-fx-focus-color', '#vc-fx-focus-hex');
    const borderOpacity = panel.querySelector('#vc-fx-border-opacity');
    const focusOpacity = panel.querySelector('#vc-fx-focus-opacity');
    if (borderOpacity && document.activeElement !== borderOpacity) {
      borderOpacity.value = String(next.borderOpacity);
    }
    if (focusOpacity && document.activeElement !== focusOpacity) {
      focusOpacity.value = String(next.focusOpacity);
    }
    for (let i = 0; i < FX_LAYER_COUNT; i += 1) {
      const layer = next.layers[i];
      const enabled = panel.querySelector('#vc-fx-layer-' + i + '-on');
      const x = panel.querySelector('#vc-fx-layer-' + i + '-x');
      const y = panel.querySelector('#vc-fx-layer-' + i + '-y');
      const blur = panel.querySelector('#vc-fx-layer-' + i + '-blur');
      const spread = panel.querySelector('#vc-fx-layer-' + i + '-spread');
      const color = panel.querySelector('#vc-fx-layer-' + i + '-color');
      const opacity = panel.querySelector('#vc-fx-layer-' + i + '-opacity');
      if (enabled) enabled.checked = !!layer.enabled;
      if (x && document.activeElement !== x) x.value = String(layer.x);
      if (y && document.activeElement !== y) y.value = String(layer.y);
      if (blur && document.activeElement !== blur) blur.value = String(layer.blur);
      if (spread && document.activeElement !== spread) spread.value = String(layer.spread);
      if (color && document.activeElement !== color) {
        color.value = cssColorToHex(layer.color, color.value);
      }
      if (opacity && document.activeElement !== opacity) opacity.value = String(layer.opacity);
      syncFxHexFields('#vc-fx-layer-' + i + '-color', '#vc-fx-layer-' + i + '-hex');
    }
    return next;
  }

  function applyControlEffects(effects, options) {
    const opts = options || {};
    const next = applyControlEffectsVars(effects);
    syncFxInspectorControls(next);
    if (opts.persist) persistControlEffects(next);
    return next;
  }

  function initControlEffects() {
    if (!panel) return;
    const useFx = hasStoredControlEffects();
    const effects = readControlEffects();
    if (useFx) {
      applyControlEffectsVars(effects);
      syncFxInspectorControls(effects);
      return;
    }
    clearControlEffectsInline();
    syncFxInspectorControls(DEFAULT_CONTROL_EFFECTS);
    if (hasStoredDepthTune()) {
      initDepthTune();
    } else {
      clearDepthTuneInline();
      initDepthTune();
    }
  }

  function randomControlEffectsFromSeed(seedRaw) {
    const trimmed = String(seedRaw == null ? '' : seedRaw).trim();
    const seedNum = trimmed === '' ? Date.now() : parseInt(trimmed, 10);
    const seed = Number.isFinite(seedNum) ? seedNum : Date.now();
    const rng = depthTuneRng(seed);
    const effects = normalizeControlEffects(DEFAULT_CONTROL_EFFECTS);
    effects.radius = Math.round((10 + rng() * 8) * 10000) / 10000;
    effects.borderWidth = Math.round(rng() * 2);
    effects.backgroundColor = randomHexRgb(rng, 235, 255);
    effects.borderColor = randomHexRgb(rng, 160, 220);
    effects.borderOpacity = Math.round(4 + rng() * 20);
    effects.focusColor = randomHexRgb(rng, 80, 200);
    effects.focusOpacity = Math.round(70 + rng() * 30);
    effects.layers = effects.layers.map(function (layer, index) {
      const base = DEFAULT_CONTROL_EFFECTS.layers[index] || layer;
      return {
        enabled: rng() > 0.35,
        kind: base.kind,
        x: 0,
        y: Math.round((rng() * 4 - 2) * 10) / 10,
        blur: Math.round(rng() * 10 * 10) / 10,
        spread: Math.round((rng() * 4 - 2) * 10) / 10,
        color: '#000000',
        opacity: Math.round(4 + rng() * 24)
      };
    });
    if (trimmed === '') {
      const randomInput = panel && panel.querySelector('#vc-settings-depth-random');
      if (randomInput) randomInput.value = String(seed);
    }
    return effects;
  }

  function depthSliderRow(label, id) {
    const valueId = id + '-value';
    return (
      '<label class="vc-settings-depth-row" for="' +
      id +
      '">' +
      '<span class="vc-settings-depth-name vp-type-micro">' +
      label +
      '</span>' +
      '<input type="range" id="' +
      id +
      '" min="0" max="100" step="5" value="45" aria-valuemin="0" aria-valuemax="100" />' +
      '<span id="' +
      valueId +
      '" class="vp-type-micro vc-settings-depth-value">45%</span>' +
      '</label>'
    );
  }

  function depthColorRow(label, id) {
    return (
      '<label class="vc-settings-depth-row vc-settings-depth-row--color" for="' +
      id +
      '">' +
      '<span class="vc-settings-depth-name vp-type-micro">' +
      label +
      '</span>' +
      '<input type="color" id="' +
      id +
      '" value="#ffffff" />' +
      '</label>'
    );
  }

  function normalizeDepthTune(tune) {
    const base = defaultDepthTune();
    const next = Object.assign({}, base, tune || {});
    DEPTH_TUNE_NUMERIC_KEYS.forEach(function (key) {
      next[key] = clampDepth(next[key], base[key]);
    });
    DEPTH_TUNE_COLOR_KEYS.forEach(function (key) {
      next[key] = normalizeHexColor(next[key], base[key]);
    });
    return next;
  }

  function applyDepthTuneVars(tune) {
    const next = normalizeDepthTune(tune);
    if (!panel) return next;
    DEPTH_TUNE_NUMERIC_KEYS.forEach(function (key) {
      panel.style.setProperty(DEPTH_TUNE_CSS_VAR[key], String(next[key]));
    });
    DEPTH_TUNE_COLOR_KEYS.forEach(function (key) {
      panel.style.setProperty(DEPTH_TUNE_CSS_VAR[key], next[key]);
    });
    return next;
  }

  function syncDepthTuneControls(tune) {
    const next = normalizeDepthTune(tune);
    const sliders = {
      top: '#vc-settings-depth-top',
      bottom: '#vc-settings-depth-bottom',
      drop: '#vc-settings-depth-drop',
      hairline: '#vc-settings-depth-hairline',
      button: '#vc-settings-depth-button',
      focus: '#vc-settings-depth-focus'
    };
    Object.keys(sliders).forEach(function (key) {
      const slider = panel && panel.querySelector(sliders[key]);
      const label = panel && panel.querySelector(sliders[key] + '-value');
      const pct = Math.round(next[key] * 100);
      if (label) label.textContent = pct + '%';
      if (slider && document.activeElement !== slider) slider.value = String(pct);
    });
    const colorInputs = {
      edgeColor: '#vc-settings-depth-edge-color',
      highlightColor: '#vc-settings-depth-highlight-color',
      borderColor: '#vc-settings-depth-border-color',
      surfaceColor: '#vc-settings-depth-surface-color',
      focusColor: '#vc-settings-depth-focus-color'
    };
    Object.keys(colorInputs).forEach(function (key) {
      const input = panel && panel.querySelector(colorInputs[key]);
      if (input && document.activeElement !== input) {
        input.value = cssColorToHex(next[key], input.value || '#ffffff');
      }
    });
    return next;
  }

  function initDepthTune() {
    if (!panel) return;
    clearDepthTuneInline();
    clearControlEffectsInline();
  }

  function applyDepthTune(tune, options) {
    const opts = options || {};
    const next = opts.vars === false ? normalizeDepthTune(tune) : applyDepthTuneVars(tune);
    syncDepthTuneControls(next);
    if (opts.persist) persistDepthTune(next);
    return next;
  }

  function depthTuneRng(seed) {
    let state = (Number(seed) >>> 0) || 1;
    return function () {
      state += 0x6d2b79f5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomChannelByte(rng, min, max) {
    return min + Math.floor(rng() * (max - min + 1));
  }

  function randomHexRgb(rng, min, max) {
    const r = randomChannelByte(rng, min, max);
    const g = randomChannelByte(rng, min, max);
    const b = randomChannelByte(rng, min, max);
    return (
      '#' +
      ('0' + r.toString(16)).slice(-2) +
      ('0' + g.toString(16)).slice(-2) +
      ('0' + b.toString(16)).slice(-2)
    );
  }

  function randomDepthTuneFromSeed(seedRaw) {
    const trimmed = String(seedRaw == null ? '' : seedRaw).trim();
    const seedNum = trimmed === '' ? Date.now() : parseInt(trimmed, 10);
    const seed = Number.isFinite(seedNum) ? seedNum : Date.now();
    const rng = depthTuneRng(seed);
    const tune = readDepthTune();
    DEPTH_TUNE_NUMERIC_KEYS.forEach(function (key) {
      tune[key] = Math.round(rng() * 20) / 20;
    });
    tune.edgeColor = randomHexRgb(rng, 10, 55);
    tune.highlightColor = randomHexRgb(rng, 235, 255);
    tune.borderColor = randomHexRgb(rng, 170, 230);
    tune.surfaceColor = randomHexRgb(rng, 240, 255);
    tune.focusColor = randomHexRgb(rng, 80, 220);
    if (trimmed === '') {
      try {
        const randomInput = panel && panel.querySelector('#vc-settings-depth-random');
        if (randomInput) randomInput.value = String(seed);
      } catch (_) {}
    }
    return tune;
  }

  function bindDepthTuneSliders() {
    if (!panel || panel.__crankDepthTuneInit) return;
    panel.__crankDepthTuneInit = true;
    const ids = ['top', 'bottom', 'drop', 'hairline', 'button', 'focus'];
    ids.forEach(function (key) {
      const slider = panel.querySelector('#vc-settings-depth-' + key);
      if (!slider) return;
      slider.addEventListener('input', function () {
        const tune = readDepthTune();
        tune[key] = clampDepth(Number(slider.value) / 100, tune[key]);
        applyDepthTune(tune, { persist: true });
      });
    });
    const depthColorInputIds = {
      edgeColor: '#vc-settings-depth-edge-color',
      highlightColor: '#vc-settings-depth-highlight-color',
      borderColor: '#vc-settings-depth-border-color',
      surfaceColor: '#vc-settings-depth-surface-color',
      focusColor: '#vc-settings-depth-focus-color'
    };
    DEPTH_TUNE_COLOR_KEYS.forEach(function (key) {
      const input = panel.querySelector(depthColorInputIds[key]);
      if (!input) return;
      input.addEventListener('input', function () {
        const tune = readDepthTune();
        tune[key] = normalizeHexColor(input.value, tune[key]);
        applyDepthTune(tune, { persist: true });
      });
    });
    const resetBtn = panel.querySelector('#vc-settings-depth-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        try {
          localStorage.removeItem(DEPTH_TUNE_KEY);
          localStorage.removeItem('crank.controlDepth');
        } catch (_) {}
        clearDepthTuneInline();
        const tune = defaultDepthTune();
        syncDepthTuneControls(tune);
        const randomInput = panel.querySelector('#vc-settings-depth-random');
        if (randomInput) randomInput.value = '';
      });
    }
    const randomInput = panel.querySelector('#vc-settings-depth-random');
    if (randomInput) {
      function rollRandomDepthTune() {
        applyDepthTune(randomDepthTuneFromSeed(randomInput.value), { persist: true });
      }
      randomInput.addEventListener('change', rollRandomDepthTune);
      randomInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          rollRandomDepthTune();
        }
      });
    }
  }

  function buildPanelShell() {
    const ui = UI();
    const escape = ui.escapeHtml || function (v) {
      return String(v == null ? '' : v);
    };
    const btn = ui.vpButtonHtml || function (v, label, attrs) {
      return '<button type="button" id="' + (attrs && attrs.id || '') + '">' + label + '</button>';
    };
    const group = ui.vpButtonGroupHtml || function (html) {
      return '<div style="display:flex;gap:8px;flex-wrap:wrap;">' + html + '</div>';
    };
    const field = ui.vpFieldHtml || function (label, control) {
      return '<div>' + label + control + '</div>';
    };
    const select = ui.vpFieldSelectHtml || ui.vpSelectHtml || function () {
      return '';
    };
    const input = ui.vpInputHtml || function (attrs) {
      return '<input' + (attrs && attrs.id ? ' id="' + attrs.id + '"' : '') + ' />';
    };

    panel.innerHTML =
      '<div class="vp-panel-root">' +
      '<div id="vc-agent-status" class="is-checking" role="status">Checking agent…</div>' +
      '<div id="vc-surface-tabs" class="vc-surface-tabs" role="tablist">' +
      '<button type="button" class="vc-surface-tab is-active" data-crank-surface="crank" role="tab" aria-selected="true">Crank</button>' +
      '<button type="button" class="vc-surface-tab" data-crank-surface="layers" role="tab" aria-selected="false">Layers</button>' +
      '</div>' +
      '<div class="vp-panel-body" id="vp-body">' +
      '<div id="vc-companion-offline" class="vp-panel-block crank-hidden" style="display:none;">' +
      '<div class="vc-offline-copy">' +
      '<div class="vp-type-label vc-offline-title">Agent offline</div>' +
      '<p class="vc-offline-lead">Ask Glean needs the companion running on this machine.</p>' +
      '</div>' +
      '<p id="vc-companion-msg" class="vc-offline-msg" role="status" aria-live="polite">Run the command in your terminal. Crank reconnects on its own.</p>' +
      '<code id="vc-companion-command" class="vc-offline-command">' + escape(companionStartCommand()) + '</code>' +
      '<div class="vc-offline-actions">' +
      btn('secondary', 'Copy command', { id: 'vc-companion-copy', type: 'button' }) +
      '</div>' +
      '</div>' +
      '<section id="vc-layers" class="vp-panel-block"></section>' +
      '<div id="vc-step-nav" class="vp-panel-block vp-panel-block--plain">' +
      btn('ghost', 'Back', { id: 'vc-back', type: 'button' }) +
      '</div>' +
      '<section id="vc-history" class="vp-panel-block">' +
      '<div id="vc-history-list"></div>' +
      '</section>' +
      '<section id="vc-settings" class="vp-panel-block">' +
      '<div class="vp-type-label vc-tool-heading">Settings</div>' +
      '<div class="vc-settings-block">' +
      '<div class="vc-readout-label">Appearance</div>' +
      '<div class="vc-settings-actions">' +
      btn('secondary', 'Light', { id: 'vc-settings-light', type: 'button' }) +
      btn('secondary', 'Dark', { id: 'vc-settings-dark', type: 'button' }) +
      '</div></div>' +
      '<div class="vc-settings-block">' +
      field(
        'Max alternatives',
        select({ id: 'vc-settings-option-count' }, '', {
          options: [2, 3, 4, 5, 6, 7].map(function (n) {
            return { value: String(n), label: String(n), selected: n === DEFAULT_GLEAN_OPTION_COUNT };
          }),
          width: 'calc(4.75rem + 8px)'
        }),
        { layout: 'inline', className: 'vp-field--option-count' }
      ) +
      '</div>' +
      '</section>' +
      '<p id="vc-status" class="vp-panel-block vp-panel-block--plain vp-muted vp-type-support crank-hidden" aria-live="polite"></p>' +
      '<div id="vc-toast" style="display:none;"></div>' +
      '<section id="vc-team-auth" class="vp-panel-block vp-panel-section crank-hidden" style="display:none;">' +
      '<div class="vp-type-label" style="font-weight:620;margin-bottom:6px;">Team token required</div>' +
      '<p class="vp-muted vp-type-micro" style="margin:0 0 8px;line-height:1.45;">Paste the same value as <code>CRANK_TEAM_TOKEN</code> in your project <code>.env</code>. It is saved in this browser only — not sent to chat.</p>' +
      (ui.vpInputHtml
        ? ui.vpInputHtml({
            id: 'vc-team-token',
            type: 'password',
            placeholder: 'Crank-…',
            autocomplete: 'off'
          })
        : '<input type="password" id="vc-team-token" placeholder="Crank-…" autocomplete="off" />') +
      btn('primary', 'Save token', { id: 'vc-team-token-save' }, { flex: true, className: 'vp-button-accent-surface' }) +
      '</section>' +
      buildGleanContextFormHtml(ui) +
      '<section id="vc-edit" class="vp-panel-block vp-panel-section crank-hidden"></section>' +
      '<div id="vc-thinking" class="vp-panel-block vp-muted vp-type-support crank-hidden" style="display:none;white-space:pre-wrap;line-height:1.5;"></div>' +
      '<div id="vc-variants" class="vp-panel-block vp-panel-section crank-hidden"></div>' +
      '<div id="vc-agent-handoff" class="vp-panel-block crank-hidden" style="display:none;"></div>' +
      '</div>' +
      '<footer class="vp-panel-footer" id="vc-panel-footer">' +
      '<div class="vp-panel-block">' +
      group(
        btn('primary', 'Ask Glean', { id: 'vc-glean' }, { flex: true }),
        { stretch: true }
      ) +
      '</div>' +
      '<div class="vp-panel-block" id="vc-actions">' +
      group(
        btn('secondary', 'Preview', { id: 'vc-preview', disabled: true }, { flex: true }) +
          btn(
            'primary',
            'Copy',
            { id: 'vc-copy-edits', disabled: true },
            { flex: true, className: 'vp-button-accent-surface' }
          ),
        { stretch: true }
      ) +
      '</div>' +
      '</footer>' +
      '<div id="vc-chrome-footer"></div>' +
      '</div>';

    panel.querySelectorAll('.vc-surface-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setPanelSurface(btn.getAttribute('data-crank-surface'));
      });
    });
    const layerHost = panel.querySelector('#vc-layers');
    if (layerHost && !layerHost.__crankBound) {
      layerHost.__crankBound = true;
      layerHost.addEventListener('click', function (ev) {
        if (ev.target && ev.target.closest && ev.target.closest('[data-layer-check]')) return;
        const row = ev.target && ev.target.closest ? ev.target.closest('[data-layer-focus]') : null;
        if (!row || !layerHost.contains(row)) return;
        const el = layerCatalog[Number(row.getAttribute('data-layer-focus'))];
        if (!(el instanceof Element)) return;
        layerFocus = el;
        checkedLayers = [el];
        selectedEl = el;
        commitLayerStrings();
        renderLayerList();
        showLayerHighlight(el);
      });
      layerHost.addEventListener('change', function (ev) {
        const box = ev.target && ev.target.closest ? ev.target.closest('[data-layer-check]') : null;
        if (!box || !layerHost.contains(box)) return;
        const el = layerCatalog[Number(box.getAttribute('data-layer-check'))];
        if (!(el instanceof Element)) return;
        const index = checkedLayers.indexOf(el);
        if (box.checked && index < 0) checkedLayers.push(el);
        else if (!box.checked && index >= 0) checkedLayers.splice(index, 1);
        commitLayerStrings();
      });
      layerHost.addEventListener('mouseover', function (ev) {
        const row = ev.target && ev.target.closest ? ev.target.closest('[data-layer-focus]') : null;
        if (!row) return;
        const el = layerCatalog[Number(row.getAttribute('data-layer-focus'))];
        showLayerHighlight(el);
      });
      layerHost.addEventListener('mouseleave', function () {
        if (panel && panel.getAttribute('data-crank-surface') === 'layers') {
          showLayerHighlight(layerFocus);
        }
      });
    }
    const backBtn = panel.querySelector('#vc-back');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        if (returnToHistory) {
          setPanelStep('ask');
          pendingHistoryScroll = historyScrollTop;
          activateTool('history');
          return;
        }
        setPanelStep('ask');
      });
    }
    applyPanelTheme(readPanelTheme());
    initDepthTune();
    const panelBody = panel.querySelector('.vp-panel-body');
    if (panelBody) bindOverlayScrollbar(panelBody);
    const companionCopy = panel.querySelector('#vc-companion-copy');
    if (companionCopy) {
      companionCopy.addEventListener('click', function () {
        copyCompanionCommand();
      });
    }
    const teamTokenInput = panel.querySelector('#vc-team-token');
    const teamTokenSave = panel.querySelector('#vc-team-token-save');
    if (teamTokenSave && teamTokenInput) {
      teamTokenSave.addEventListener('click', function () {
        saveTeamTokenFromInput(teamTokenInput);
      });
      teamTokenInput.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') saveTeamTokenFromInput(teamTokenInput);
      });
    }
    panel.querySelector('#vc-glean').addEventListener('click', requestGlean);
    panel.querySelector('#vc-preview').addEventListener('click', previewEdits);
    panel.querySelector('#vc-copy-edits').addEventListener('click', copyEditsPrompt);
    const editBox = panel.querySelector('#vc-edit');
    if (editBox && !editBox.__crankInputBound) {
      editBox.__crankInputBound = true;
      editBox.addEventListener('input', function () {
        const anyEditable = selectedNodes.some(function (n) {
          return n.editable;
        });
        setEditButtons(anyEditable);
      });
    }
    // Event delegation so Agent/Preview/Copy keep working after re-renders.
    const variantsBox = panel.querySelector('#vc-variants');
    if (variantsBox && !variantsBox.__crankTableKeys) {
      variantsBox.__crankTableKeys = true;
      variantsBox.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        const t = ev.target instanceof Element ? ev.target.closest('[data-variants-table]') : null;
        if (!t) return;
        ev.preventDefault();
        ev.stopPropagation();
        openOptionsTable(lastVariants);
      });
    }
    if (variantsBox && !variantsBox.__crankDelegated) {
      variantsBox.__crankDelegated = true;
      variantsBox.addEventListener('click', function (ev) {
        const target = ev.target && ev.target.closest
          ? ev.target.closest(
              '[data-variant-agent],[data-variant-preview],[data-variant-copy],[data-history-reask],[data-variants-table]'
            )
          : null;
        if (!target || !variantsBox.contains(target)) return;
        if (ev.preventDefault) ev.preventDefault();
        if (ev.stopPropagation) ev.stopPropagation();
        if (target.hasAttribute('data-variants-table')) {
          openOptionsTable(lastVariants);
          return;
        }
        const reaskId = target.getAttribute('data-history-reask');
        if (reaskId) {
          if (!target.disabled) askGleanAgainFromHistory(reaskId);
          return;
        }
        const agentId = target.getAttribute('data-variant-agent');
        if (agentId) {
          queueAgentVariant(agentId);
          return;
        }
        const previewId = target.getAttribute('data-variant-preview');
        if (previewId) {
          previewVariantOnSelection(previewId);
          return;
        }
        const copyId = target.getAttribute('data-variant-copy');
        if (copyId) {
          copyVariantPrompt(copyId);
        }
      });
    }
    initFieldControls();
    bindGleanContextForm();
    bindTextareaAutoGrow();
    bindOptionalGleanFields();
    panel.setAttribute('data-crank-view', 'copy');
    const settingsLight = panel.querySelector('#vc-settings-light');
    const settingsDark = panel.querySelector('#vc-settings-dark');
    const settingsDock = panel.querySelector('#vc-settings-dock');
    const settingsCount = panel.querySelector('#vc-settings-option-count');
    if (settingsLight) {
      settingsLight.addEventListener('click', function () {
        applyPanelTheme('light');
        syncSettingsControls();
      });
    }
    if (settingsDark) {
      settingsDark.addEventListener('click', function () {
        applyPanelTheme('dark');
        syncSettingsControls();
      });
    }
    if (settingsDock) {
      settingsDock.addEventListener('click', function () {
        togglePanelDock();
        syncSettingsControls();
      });
    }
    if (settingsCount) {
      try {
        const saved = localStorage.getItem(OPTION_COUNT_KEY);
        if (saved) {
          const n = parseInt(saved, 10);
          if (Number.isFinite(n)) {
            const clamped = Math.min(
              GLEAN_OPTION_COUNT_MAX,
              Math.max(GLEAN_OPTION_COUNT_MIN, n)
            );
            setFieldSelectValue('vc-settings-option-count', String(clamped));
          }
        }
      } catch (_) {}
      settingsCount.addEventListener('change', function () {
        try {
          localStorage.setItem(OPTION_COUNT_KEY, settingsCount.value);
        } catch (_) {}
      });
    }
    bindDepthTuneSliders();
    const historyList = panel.querySelector('#vc-history-list');
    if (historyList && !historyList.__crankBound) {
      historyList.__crankBound = true;
      const historyCardFor = function (ev) {
        const el = ev.target instanceof Element ? ev.target : ev.target && ev.target.parentElement;
        const card = el && el.closest ? el.closest('.vc-history-card[data-history-id]') : null;
        return card && historyList.contains(card) ? card : null;
      };
      historyList.addEventListener('click', function (ev) {
        const el = ev.target instanceof Element ? ev.target : null;
        const del = el ? el.closest('[data-history-delete]') : null;
        if (del && historyList.contains(del)) {
          ev.preventDefault();
          ev.stopPropagation();
          if (!del.disabled) deleteHistoryRun(del.getAttribute('data-history-delete'));
          return;
        }
        const card = historyCardFor(ev);
        if (!card) return;
        ev.preventDefault();
        ev.stopPropagation();
        openHistoryRun(card.getAttribute('data-history-id'));
      });
      historyList.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        const card = historyCardFor(ev);
        // The delete button activates itself via its native click.
        if (!card || ev.target !== card) return;
        ev.preventDefault();
        ev.stopPropagation();
        openHistoryRun(card.getAttribute('data-history-id'));
      });
    }
    setPanelStep('ask');
    startPageSensor();
    schedulePageSense();
  }

  function setPanelSurface(surface) {
    if (!panel) return;
    const next = surface === 'layers' ? 'layers' : 'crank';
    panel.setAttribute('data-crank-surface', next);
    panel.querySelectorAll('.vc-surface-tab').forEach(function (btn) {
      const on = btn.getAttribute('data-crank-surface') === next;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (next === 'layers') {
      renderLayerList();
      showLayerHighlight(layerFocus);
    } else {
      highlight.remove();
    }
  }

  function layerDescriptor(el) {
    const tag = String(el.tagName || '').toLowerCase();
    const classes = Array.from(el.classList || [])
      .filter(function (cls) {
        return cls && cls.indexOf('vp-') !== 0 && cls.indexOf('crank-') !== 0;
      })
      .slice(0, 2);
    return {
      name: classes.length ? tag + '.' + classes.join('.') : tag,
      text: String(el.innerText || el.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 72)
    };
  }

  function showLayerHighlight(el) {
    if (!(el instanceof Element)) return;
    const rect = el.getBoundingClientRect();
    if (!highlight.parentNode) document.documentElement.appendChild(highlight);
    highlight.style.left = rect.left + 'px';
    highlight.style.top = rect.top + 'px';
    highlight.style.width = rect.width + 'px';
    highlight.style.height = rect.height + 'px';
  }

  function renderLayerList() {
    const host = panel && panel.querySelector('#vc-layers');
    if (!host) return;
    const escape = (UI().escapeHtml) || function (value) {
      return String(value || '');
    };
    if (!(layerFocus instanceof Element)) {
      layerCatalog = [];
      host.innerHTML = '<p class="vc-tool-lead">Select a region to see its layers.</p>';
      return;
    }
    const chain = [];
    let current = layerFocus;
    while (
      current &&
      current.nodeType === 1 &&
      current !== document.body &&
      current !== document.documentElement
    ) {
      chain.unshift(current);
      current = current.parentElement;
    }
    function hasLayerText(el) {
      if (!(el instanceof Element) || isCrankChrome(el) || isSkippedCopyTag(el)) return false;
      const text = String(el.innerText || el.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
      const placeholder = el.getAttribute && el.getAttribute('placeholder');
      return !!(text || placeholder);
    }
    const children = Array.from(layerFocus.children || [])
      .filter(hasLayerText)
      .slice(0, 80);
    const siblings = layerFocus.parentElement
      ? Array.from(layerFocus.parentElement.children || [])
          .filter(function (el) {
            return el !== layerFocus && hasLayerText(el);
          })
          .slice(0, 24)
      : [];
    layerCatalog = [];
    function row(el, depth, isCurrent) {
      const index = layerCatalog.length;
      layerCatalog.push(el);
      const desc = layerDescriptor(el);
      const checked = checkedLayers.indexOf(el) >= 0;
      return (
        '<div class="vc-layer-row' +
        (isCurrent ? ' is-current' : '') +
        '" style="padding-left:' +
        depth * 14 +
        'px">' +
        '<input type="checkbox" data-layer-check="' +
        index +
        '"' +
        (checked ? ' checked' : '') +
        ' aria-label="Include ' +
        escape(desc.name) +
        '" />' +
        '<button type="button" class="vp-context-btn' +
        (isCurrent ? ' vp-context-btn--emphasis' : '') +
        '" data-layer-focus="' +
        index +
        '"><span class="vp-strong">' +
        escape(desc.name) +
        '</span>' +
        (desc.text ? '<span class="vc-layer-snippet">' + escape(desc.text) + '</span>' : '') +
        '</button></div>'
      );
    }
    const pathDepth = Math.max(0, chain.length - 1);
    host.innerHTML =
      '<div class="vp-section-title"><span>Layer path</span></div>' +
      chain
        .map(function (el, index) {
          return row(el, index, el === layerFocus);
        })
        .join('') +
      (siblings.length
        ? '<div class="vp-section-title" style="margin-top:12px;"><span>Siblings</span></div>' +
          siblings
            .map(function (el) {
              return row(el, pathDepth, false);
            })
            .join('')
        : '') +
      (children.length
        ? '<div class="vp-section-title" style="margin-top:12px;"><span>Children</span></div>' +
          children
            .map(function (el) {
              return row(el, chain.length, false);
            })
            .join('')
        : '<p class="vc-tool-lead" style="margin-top:8px;">This layer has no inner layers.</p>');
  }

  function snapshotSelectionNodes() {
    originalSnapshot = selectedNodes.map(function (node) {
      return Object.assign({}, node, {
        text: node.text,
        previousText: node.text,
        originalText: node.originalText != null ? node.originalText : node.text
      });
    });
  }

  function selectionPayloadFor(el) {
    return {
      origin: location.origin,
      pageUrl: location.href,
      selector: el ? cssPath(el) : '',
      tagName: el ? el.tagName.toLowerCase() : '',
      nodes: selectedNodes,
      combinedText: selectedNodes
        .map(function (node) {
          return node.text;
        })
        .join('\n'),
      meta: { pathHints: pathHintsFromLocation() }
    };
  }

  async function commitLayerStrings() {
    selectedEl = layerFocus || selectedEl;
    selectedNodes = stringsFromCheckedLayers();
    snapshotSelectionNodes();
    renderNodes();
    setGleanFieldValue('#vc-glean-strings', formatGleanDraftFromSelection());
    updateGleanContextValidationUI();
    syncGleanButton();
    const payload = selectionPayloadFor(selectedEl);
    pendingSelectionPayload = payload;
    try {
      const authed = await ensureTeamToken();
      if (!authed) return;
      pendingSelectionPayload = null;
      await registerSelection(payload, { restore: false });
    } catch (_) {}
  }

  function renderNodes() {
    const ui = UI();
    const editEl = panel.querySelector('#vc-edit');
    if (!editEl) return;

    if (!selectedNodes.length) {
      editEl.innerHTML = '';
      editEl.classList.add('crank-hidden');
      setEditButtons(false);
      return;
    }
    // Manual string editors stay out of the main ask view. A later option can show them.
    editEl.classList.add('crank-hidden');

    const field = ui.vpFieldHtml || function (label, control) {
      return '<div><div>' + label + '</div>' + control + '</div>';
    };
    const area = ui.vpTextareaHtml || function (attrs, content) {
      return '<textarea id="' + (attrs.id || '') + '"' + (attrs.disabled ? ' disabled' : '') + '>' + (content || '') + '</textarea>';
    };
    const escape = ui.escapeHtml || function (v) {
      return String(v || '');
    };

    editEl.innerHTML = selectedNodes
      .map(function (n, idx) {
        const label = roleLabel(n.role, n, idx, selectedNodes);

        const dynamicHints = (n.parts || [])
          .filter(function (p) {
            return p.type === 'dynamic-data' || p.type === 'bound-unknown';
          })
          .map(function (p) {
            return (
              '<span class="vp-type-micro" style="display:inline-block;margin:2px 4px 0 0;padding:1px 6px;border:1px dashed var(--border);border-radius:999px;">' +
              escape(String(p.text || '').trim()) +
              '</span>'
            );
          })
          .join('');

        if (!n.editable) {
          return (
            field(
              label,
              '<div class="vp-type-support" style="opacity:0.85;white-space:pre-wrap;word-break:break-word;">' +
                escape(n.text) +
                '</div>'
            ) +
            (dynamicHints
              ? '<div class="vp-muted vp-type-micro" style="margin:-2px 0 4px;">' +
                dynamicHints +
                '</div>'
              : '')
          );
        }

        const editArea = ui.vpParagraphFieldHtml
          ? ui.vpParagraphFieldHtml(
              { id: 'vc-edit-' + n.path, rows: '1', 'data-path': n.path },
              n.text,
              { autogrow: true, paragraph: true }
            )
          : ui.vpTextareaHtml
            ? ui.vpTextareaHtml(
                { id: 'vc-edit-' + n.path, rows: '1', 'data-path': n.path },
                n.text,
                { autogrow: true, paragraph: true }
              )
            : area({ id: 'vc-edit-' + n.path, rows: '2', 'data-path': n.path }, n.text);
        return (
          field(label, editArea) +
          (dynamicHints
            ? '<div class="vp-muted vp-type-micro" style="margin:-4px 0 10px;">Vars: ' +
              dynamicHints +
              '</div>'
            : '')
        );
      })
      .join('');

    const anyEditable = selectedNodes.some(function (n) {
      return n.editable;
    });
    setEditButtons(anyEditable);
    prefillGleanStringsFromSelection(false);
    scheduleAutogrowSync(editEl);
    scheduleAutogrowSync(panel);
  }

  function hasEditDeltas() {
    const nodes = readEditedNodes();
    return nodes.some(function (n) {
      if (!n.editable) return false;
      const snap = originalSnapshot.find(function (o) {
        return o.path === n.path;
      });
      const oldText =
        snap && snap.text != null
          ? snap.text
          : n.originalText != null
            ? n.originalText
            : n.text;
      return String(n.text) !== String(oldText);
    });
  }

  function setEditButtons(enabled) {
    syncGleanButton();
    const preview = panel.querySelector('#vc-preview');
    const copyEdits = panel.querySelector('#vc-copy-edits');
    if (preview) preview.disabled = !enabled;
    if (copyEdits) {
      copyEdits.disabled = !enabled || !sessionId || !hasEditDeltas();
    }
  }

  function readEditedNodes() {
    return selectedNodes.map(function (n) {
      const input = panel.querySelector('#vc-edit-' + n.path);
      if (input && n.editable) {
        return Object.assign({}, n, { text: input.value });
      }
      return n;
    });
  }

  function previewEdits() {
    const nodes = readEditedNodes();
    if (selectedEl) applyNodesToDom(selectedEl, nodes);
    selectedNodes = nodes;
    sendWs({
      type: 'PREVIEW_TEXT_CHANGE',
      sessionId: sessionId,
      payload: { sessionId: sessionId, nodes: nodes }
    });
    setStatus('DOM preview applied (not saved to source yet)');
  }

  async function copyEditsPrompt() {
    if (!sessionId) {
      const msg = 'Select a region first';
      showToast(msg, 'error');
      setStatus(msg);
      return;
    }
    const nodes = readEditedNodes();
    if (!hasEditDeltas()) {
      const msg = 'Edit copy in the fields above, then Copy';
      showToast(msg, 'error');
      setStatus(msg);
      return;
    }
    showToast('Building copy prompt…', 'info');
    setStatus('Building copy prompt…');
    try {
      const data = await postJson(
        '/api/copy-prompt',
        {
          sessionId: sessionId,
          nodes: nodes,
          label: 'Manual edits'
        },
        { timeoutMs: 15000 }
      );
      if (!data.ok || !data.prompt) {
        throw new Error(
          (data && data.error) || 'Companion returned no copy prompt'
        );
      }
      const copied = await copyTextToClipboard(data.prompt);
      const count =
        typeof data.changeCount === 'number'
          ? data.changeCount
          : Array.isArray(data.changes)
            ? data.changes.length
            : 0;
      const msg = copied
        ? 'Copied agent prompt (' +
          count +
          ' change' +
          (count === 1 ? '' : 's') +
          ') — ' +
          PASTE_IN_AGENT_CHAT
        : 'Copy prompt ready but clipboard failed — check browser permissions';
      showToast(msg, copied ? 'ok' : 'error');
      setStatus(msg);
    } catch (err) {
      const raw = err && err.message ? String(err.message) : 'unknown';
      const down =
        /Companion not running|Failed to fetch|NetworkError|Load failed/i.test(
          raw
        );
      const msg = down
        ? 'Companion not running — start with npx crank / open :3344'
        : 'Copy failed: ' + raw;
      showToast(msg, 'error');
      setStatus(msg);
    }
  }

  function pathHintsFromLocation() {
    const hints = [];
    try {
      const pathname = String(location.pathname || '/');
      if (pathname && pathname !== '/') {
        hints.push(pathname);
        hints.push(pathname.replace(/^\//, ''));
        const base = pathname.split('/').pop();
        if (base) hints.push(base);
      } else {
        hints.push('/index.html', 'index.html');
      }
    } catch (_) {}
    return hints;
  }

  function variantFieldRows(variant) {
    const fields = variant && variant.fields ? variant.fields : null;
    const rows = [];
    const sessionLabels = (selectedNodes || [])
      .filter(function (n) {
        return !isDynamicOnlyNode(n);
      })
      .map(function (n, idx) {
        return roleLabel(n.role, n, idx, selectedNodes);
      });

    const variantNodes = (variant.nodes || []).filter(function (n) {
      return !isRuntimeOnlyNode(n);
    });
    if (variantNodes.length) {
      variantNodes.forEach(function (n, idx) {
        const text = String(
          n && n.text != null && String(n.text).trim()
            ? n.text
            : n && n.originalText != null
              ? n.originalText
              : ''
        ).trim();
        if (!text) return;
        rows.push({
          label: n.copyLabel || n.label || roleLabel(n.role, n, idx, variantNodes),
          text: text
        });
      });
      return rows;
    }

    if (
      fields &&
      (fields.heading ||
        fields.body ||
        fields.cta ||
        (Array.isArray(fields.bodies) && fields.bodies.length) ||
        (Array.isArray(fields.copies) && fields.copies.length))
    ) {
      if (fields.heading) {
        rows.push({ label: sessionLabels[0] || 'Heading', text: fields.heading });
      }
      if (Array.isArray(fields.bodies) && fields.bodies.length) {
        fields.bodies.forEach(function (t, i) {
          if (String(t || '').trim()) {
            rows.push({
              label: sessionLabels[rows.length] || 'Body ' + (i + 1),
              text: t
            });
          }
        });
      } else if (fields.body) {
        rows.push({
          label: sessionLabels[rows.length] || 'Body',
          text: fields.body
        });
      }
      if (Array.isArray(fields.copies) && fields.copies.length) {
        fields.copies.forEach(function (t, i) {
          if (String(t || '').trim()) {
            rows.push({
              label: sessionLabels[rows.length] || 'Copy ' + (i + 1),
              text: t
            });
          }
        });
      }
      if (fields.cta) {
        rows.push({
          label: sessionLabels[sessionLabels.length - 1] || 'CTA',
          text: fields.cta
        });
      }
      return rows;
    }
    return rows;
  }

  function markActiveVariantCard(variantId) {
    const box = panel.querySelector('#vc-variants');
    if (!box) return;
    box.querySelectorAll('[data-variant-card]').forEach(function (card) {
      const active = card.getAttribute('data-variant-card') === String(variantId || '');
      card.classList.toggle('is-active', active);
    });
  }

  function syncEditorsFromVariant(variant) {
    if (!variant || !Array.isArray(variant.nodes) || !variant.nodes.length) return;
    const byPath = {};
    const byId = {};
    variant.nodes.forEach(function (n) {
      byPath[String(n.path)] = n;
      if (n.id) byId[String(n.id)] = n;
    });
    selectedNodes = selectedNodes.map(function (n) {
      if (isDynamicOnlyNode(n)) return n;
      const next = (n.id && byId[String(n.id)]) || byPath[String(n.path)];
      if (!next || isDynamicOnlyNode(next)) return n;
      return Object.assign({}, n, { text: next.text });
    });
    // If selection was empty of matching paths, fall back to variant nodes.
    if (!selectedNodes.length) {
      selectedNodes = variant.nodes.map(function (n) {
        return Object.assign({}, n);
      });
    }
    renderNodes();
    setEditButtons(true);
  }

  function renderVariantCard(variant, ui) {
    const escape = ui.escapeHtml || function (v) {
      return String(v == null ? '' : v);
    };
    const escapeAttr = ui.escapeAttr || escape;
    const btn = ui.vpButtonHtml || function (_v, label, attrs) {
      const a = attrs || {};
      let attrHtml = ' type="button"';
      Object.keys(a).forEach(function (key) {
        if (key === 'type' || a[key] == null || a[key] === false) return;
        if (a[key] === true) {
          attrHtml += ' ' + key;
          return;
        }
        attrHtml += ' ' + key + '="' + escapeAttr(String(a[key])) + '"';
      });
      return '<button' + attrHtml + '>' + label + '</button>';
    };
    const group = ui.vpButtonGroupHtml || function (html) {
      return '<div style="display:flex;gap:8px;flex-wrap:wrap;">' + html + '</div>';
    };
    const badge = ui.vpCapabilityBadgeHtml || function (_mode, text) {
      return '<span class="vp-chip">' + escape(text) + '</span>';
    };
    const title = variant.label || variant.title || variant.id || 'Option';
    const rows = variantFieldRows(variant);
    function readout(label, text, kind) {
      return (
        '<div class="vc-readout' +
        (kind ? ' vc-readout--' + kind : '') +
        '">' +
        '<div class="vc-readout-label">' +
        escape(label || 'Copy') +
        '</div>' +
        '<div class="vc-readout-text">' +
        escape(text) +
        '</div></div>'
      );
    }
    let bodyHtml = '';

    if (rows.length) {
      bodyHtml = rows
        .map(function (row) {
          return readout(row.label || 'Copy', row.text, 'copy');
        })
        .join('');
    } else if (variant.rawText) {
      bodyHtml = readout('Copy', String(variant.rawText), 'copy');
    } else if (variant.summary) {
      bodyHtml = readout('Copy', variant.summary, 'copy');
    }

    if (variant.scores) {
      bodyHtml += readout('Agent notes', String(variant.scores), 'notes');
    }

    const recommended = !!variant.recommended;
    const previewIcon =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 4C16.1819 4 19.0285 6.49933 20.7256 8.7041C21.5755 9.80824 22 10.3607 22 12C22 13.6393 21.5755 14.1918 20.7256 15.2959C19.0285 17.5007 16.1819 20 12 20C7.81811 20 4.97149 17.5007 3.27441 15.2959C2.42453 14.1918 2 13.6393 2 12C2 10.3607 2.42453 9.80824 3.27441 8.7041C4.97149 6.49933 7.81811 4 12 4ZM12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9Z" fill="currentColor"/></svg>';
    const copyIcon =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M15.2402 5.61426C17.9551 5.61426 19.3127 5.61431 20.1562 6.46094C20.9998 7.30786 21 8.67127 21 11.3975V16.2168C21 18.9429 20.9998 20.3064 20.1562 21.1533C19.3127 21.9998 17.955 22 15.2402 22H12.3604C9.64515 22 8.2869 22.0002 7.44336 21.1533C6.59984 20.3064 6.60059 18.9429 6.60059 16.2168V11.3975C6.60059 8.67128 6.59984 7.30786 7.44336 6.46094C8.28689 5.61402 9.64506 5.61426 12.3604 5.61426H15.2402Z" fill="currentColor"/><path d="M15.2402 2C16.7616 2.0001 18.0629 2.94764 18.5898 4.28711C17.7091 4.16822 16.6114 4.16887 15.335 4.16895H12.2656C10.9891 4.16887 9.8886 4.16821 9.00781 4.28711C8.06393 4.41454 7.15966 4.70266 6.42578 5.43945C5.69187 6.17631 5.40523 7.08449 5.27832 8.03223C5.15992 8.91654 5.16008 10.0211 5.16016 11.3027V16.3125C5.1601 17.374 5.16027 18.6502 5.22754 19.5596C3.92032 19.0177 3 17.7249 3 16.2168V10.3789C2.99999 8.60799 3.00049 7.20531 3.14746 6.10742C3.29878 4.97738 3.61751 4.06213 4.33594 3.34082C5.05433 2.61968 5.96542 2.29937 7.09082 2.14746C8.18439 1.99988 9.58168 1.99999 11.3457 2H15.2402Z" fill="currentColor"/></svg>';
    return (
      '<article class="vc-variant-row' +
      (recommended ? ' is-recommended' : '') +
      '" data-variant-card="' +
      escape(variant.id) +
      '">' +
      '<div class="vc-variant-head">' +
      '<div class="vp-type-label vc-variant-title">' +
      escape(title) +
      (recommended ? '<span class="vc-variant-recommended">Recommended</span>' : '') +
      '</div>' +
      '<div class="vc-variant-tools">' +
      btn(
        'ghost',
        previewIcon,
        {
          type: 'button',
          'data-variant-preview': variant.id,
          'aria-label': 'Preview this option on the selected strings',
          title: 'Preview on the selected strings',
          hidden: true
        },
        { icon: true }
      ) +
      btn(
        'ghost',
        copyIcon,
        {
          type: 'button',
          'data-variant-copy': variant.id,
          'aria-label': 'Copy this option for the agent',
          title: 'Copy for the agent'
        },
        { icon: true }
      ) +
      '</div>' +
      '</div>' +
      bodyHtml +
      '<div style="margin-top:10px;" class="vc-variant-actions">' +
      group(
        btn(
          'secondary',
          'Preview',
          { 'data-variant-preview': variant.id, type: 'button', hidden: true },
          { flex: true }
        ) +
          btn(
            'primary',
            'Copy',
            { 'data-variant-copy': variant.id, type: 'button' },
            { flex: true }
          ) +
          btn(
            'secondary',
            'Agent',
            { 'data-variant-agent': variant.id, type: 'button' },
            { flex: true }
          ),
        { stretch: true }
      ) +
      '</div>' +
      '</article>'
    );
  }

  // ---- View Table modal (port of Figma Crank Copy parseAgentTable / renderTable) ----
  const TABLE_CLOSE_ICON_SVG =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12ZM8.96963 8.96965C9.26252 8.67676 9.73739 8.67676 10.0303 8.96965L12 10.9393L13.9696 8.96967C14.2625 8.67678 14.7374 8.67678 15.0303 8.96967C15.3232 9.26256 15.3232 9.73744 15.0303 10.0303L13.0606 12L15.0303 13.9696C15.3232 14.2625 15.3232 14.7374 15.0303 15.0303C14.7374 15.3232 14.2625 15.3232 13.9696 15.0303L12 13.0607L10.0303 15.0303C9.73742 15.3232 9.26254 15.3232 8.96965 15.0303C8.67676 14.7374 8.67676 14.2625 8.96965 13.9697L10.9393 12L8.96963 10.0303C8.67673 9.73742 8.67673 9.26254 8.96963 8.96965Z"/></svg>';
  const GRADE_COLUMNS = [
    ['clear', 'Clarity'],
    ['consistent', 'Consistency'],
    ['concise', 'Conciseness'],
    ['conversational', 'Conversation'],
    ['coaching', 'Coaching']
  ];

  let tableModalEl = null;
  let tableModalReturnFocus = null;

  // Ported from ~/Downloads/crank-copy 2/ui.html parseAgentTable.
  function parseAgentTable(md) {
    const empty = { rows: [], notesBefore: '', notesAfter: '' };
    if (!md) return empty;
    const lines = String(md).split('\n');
    const splitRow = function (row) {
      return row
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(function (c) {
          return c
            .replace(/<br\s*\/?>/gi, '\n')
            .split('\n')
            .map(function (l) {
              return l.trim();
            })
            .join('\n')
            .trim();
        });
    };
    const isSeparator = function (cells) {
      return (
        cells.length > 0 &&
        cells.every(function (c) {
          return /^:?-{2,}:?$/.test(c);
        })
      );
    };
    const headerIndex = lines.findIndex(function (l) {
      return l.trim().startsWith('|');
    });
    if (headerIndex === -1) {
      const pipeLines = lines
        .filter(function (l) {
          return l.includes('|');
        })
        .map(splitRow);
      if (!pipeLines.some(isSeparator)) return empty;
      return {
        rows: pipeLines.filter(function (c) {
          return !isSeparator(c);
        }),
        notesBefore: '',
        notesAfter: ''
      };
    }
    const header = splitRow(lines[headerIndex]);
    const rows = [header];
    const pipesPerRow = header.length + 1;
    let current = null;
    let lastRowEnd = headerIndex;
    for (let i = headerIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      const startsRow = line.trim().startsWith('|');
      if (current !== null && startsRow && current.trim().endsWith('|')) {
        const shortCells = splitRow(current);
        if (!isSeparator(shortCells)) rows.push(shortCells);
        current = null;
        lastRowEnd = i - 1;
      }
      if (current === null) {
        if (!startsRow) continue;
        current = line;
      } else {
        current += '\n' + line;
      }
      const pipes = (current.match(/\|/g) || []).length;
      if (pipes >= pipesPerRow && current.trim().endsWith('|')) {
        const cells = splitRow(current);
        if (!isSeparator(cells)) rows.push(cells);
        current = null;
        lastRowEnd = i;
      }
    }
    if (current !== null) {
      const cells = splitRow(current);
      if (!isSeparator(cells)) rows.push(cells);
      lastRowEnd = lines.length - 1;
    }
    const note = function (ls) {
      return ls.join('\n').replace(/<br\s*\/?>/gi, '\n').trim();
    };
    return {
      rows: rows,
      notesBefore: note(lines.slice(0, headerIndex)),
      notesAfter: note(lines.slice(lastRowEnd + 1))
    };
  }

  // Safe inline render: text nodes only, plus <br> for newlines and <strong> for **bold**.
  function appendInlineMarkdown(el, text) {
    const lines = String(text == null ? '' : text).split('\n');
    lines.forEach(function (line, li) {
      if (li) el.appendChild(document.createElement('br'));
      const re = /\*\*([^*]+)\*\*/g;
      let last = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        if (m.index > last) el.appendChild(document.createTextNode(line.slice(last, m.index)));
        const strong = document.createElement('strong');
        strong.textContent = m[1];
        el.appendChild(strong);
        last = re.lastIndex;
      }
      if (last < line.length) el.appendChild(document.createTextNode(line.slice(last)));
    });
  }

  function variantTableCells(variant) {
    const v = variant || {};
    const f = v.fields && typeof v.fields === 'object' ? v.fields : null;
    const cells = [];
    const push = function (label, text) {
      const t = String(text == null ? '' : text).trim();
      if (t) cells.push({ label: label, text: t });
    };
    if (f) {
      push('Heading', f.heading);
      if (Array.isArray(f.bodies) && f.bodies.length) {
        f.bodies.forEach(function (t, i) {
          push(f.bodies.length > 1 ? 'Body ' + (i + 1) : 'Body', t);
        });
      } else {
        push('Body', f.body);
      }
      if (Array.isArray(f.copies) && f.copies.length) {
        f.copies.forEach(function (t, i) {
          push(f.copies.length > 1 ? 'Copy ' + (i + 1) : 'Copy', t);
        });
      }
      push('CTA', f.cta);
      push('Label', f.label);
    }
    if (!cells.length) {
      (v.nodes || []).forEach(function (n, idx) {
        if (!n || isRuntimeOnlyNode(n)) return;
        const t = n.text != null && String(n.text).trim() ? n.text : n.originalText;
        push(n.copyLabel || n.label || (n.role ? String(n.role) : 'Copy ' + (idx + 1)), t);
      });
    }
    if (!cells.length) push('Copy', v.rawText || v.summary || '');
    return cells;
  }

  // Fallback for runs saved before the raw agent table was kept.
  function rebuildTableRows(variants) {
    const list = (variants || []).filter(Boolean);
    const columns = [];
    const parsed = list.map(function (v) {
      const cells = variantTableCells(v);
      cells.forEach(function (c) {
        if (columns.indexOf(c.label) === -1) columns.push(c.label);
      });
      return cells;
    });
    const hasGrades = list.some(function (v) {
      return v.grades && typeof v.grades === 'object';
    });
    const hasNotes = !hasGrades && list.some(function (v) {
      return v.scores;
    });
    const header = ['Option'].concat(columns);
    if (hasGrades) GRADE_COLUMNS.forEach(function (g) { header.push(g[1]); });
    if (hasNotes) header.push('Agent notes');
    const rows = [header];
    list.forEach(function (v, i) {
      const row = [(v.label || v.id || 'Option ' + (i + 1))];
      columns.forEach(function (col) {
        const hit = parsed[i].filter(function (c) {
          return c.label === col;
        })[0];
        row.push(hit ? hit.text : '');
      });
      if (hasGrades) {
        GRADE_COLUMNS.forEach(function (g) {
          const gr = v.grades && v.grades[g[0]];
          row.push(
            gr && typeof gr === 'object'
              ? [gr.score, gr.explanation || gr.rationale].filter(Boolean).join(' — ')
              : ''
          );
        });
      }
      if (hasNotes) row.push(v.scores || '');
      rows.push(row);
    });
    return { rows: rows, notesBefore: '', notesAfter: '' };
  }

  function tableDataFor(variants, rawTable) {
    const list = Array.isArray(variants) ? variants.filter(Boolean) : [];
    let md = rawTable || '';
    if (!md) {
      const hit = list.filter(function (v) {
        return v.agentTable;
      })[0];
      md = hit ? hit.agentTable : '';
    }
    if (md) {
      const parsed = parseAgentTable(md);
      if (parsed.rows.length) return parsed;
    }
    return list.length ? rebuildTableRows(list) : null;
  }

  function buildTableElement(data) {
    const wrap = document.createElement('div');
    const table = document.createElement('table');
    table.className = 'vp-options-table';
    if (data.notesBefore) {
      const cap = document.createElement('caption');
      cap.className = 'vp-options-table-note';
      appendInlineMarkdown(cap, data.notesBefore);
      table.appendChild(cap);
    }
    const width = data.rows[0] ? data.rows[0].length : 1;
    if (width > 1) {
      const colgroup = document.createElement('colgroup');
      let minW = 0;
      for (let c = 0; c < width; c++) {
        const col = document.createElement('col');
        if (c === 0) {
          col.style.width = '72px';
          minW += 72;
        } else if (c < width - 1) {
          col.style.width = '140px';
          minW += 140;
        } else {
          minW += 320;
        }
        colgroup.appendChild(col);
      }
      table.appendChild(colgroup);
      table.style.minWidth = minW + 'px';
    }
    data.rows.forEach(function (cells, r) {
      const tr = document.createElement('tr');
      cells.forEach(function (text) {
        const cell = document.createElement(r === 0 ? 'th' : 'td');
        if (r === 0) cell.setAttribute('scope', 'col');
        appendInlineMarkdown(cell, text);
        tr.appendChild(cell);
      });
      table.appendChild(tr);
    });
    if (data.notesAfter) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.className = 'vp-options-table-note';
      td.colSpan = width;
      appendInlineMarkdown(td, data.notesAfter);
      tr.appendChild(td);
      table.appendChild(tr);
    }
    wrap.appendChild(table);
    return wrap;
  }

  function closeOptionsTable() {
    if (!tableModalEl) return;
    const el = tableModalEl;
    tableModalEl = null;
    document.removeEventListener('keydown', onOptionsTableKey, true);
    if (el.parentNode) el.parentNode.removeChild(el);
    const back = tableModalReturnFocus;
    tableModalReturnFocus = null;
    if (back && back.focus && document.contains(back)) {
      try {
        back.focus();
      } catch (_) {}
    }
  }

  function onOptionsTableKey(ev) {
    if (!tableModalEl) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      closeOptionsTable();
      return;
    }
    if (ev.key === 'Tab') {
      // Only the Close control is focusable; keep focus on it.
      ev.preventDefault();
      const closeBtn = tableModalEl.querySelector('.vp-options-modal-close');
      if (closeBtn) closeBtn.focus();
    }
  }

  function openOptionsTable(variants, rawTable) {
    if (!panel) return;
    const data = tableDataFor(variants, rawTable);
    if (!data || !data.rows.length) return;
    if (tableModalEl) closeOptionsTable();
    tableModalReturnFocus = document.activeElement;
    const el = document.createElement('div');
    el.className = 'vp-options-modal';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Table');
    el.innerHTML =
      '<div class="vp-options-modal-backdrop" data-table-close></div>' +
      '<div class="vp-options-modal-panel" tabindex="-1">' +
      '<div class="vp-options-modal-header"><h2 class="vp-options-modal-title">Table</h2>' +
      '<button type="button" class="vp-options-modal-close" data-table-close aria-label="Close" title="Close">' +
      TABLE_CLOSE_ICON_SVG +
      '</button></div>' +
      '<div class="vp-options-modal-body"></div></div>';
    el.querySelector('.vp-options-modal-body').appendChild(buildTableElement(data));
    el.addEventListener('click', function (ev) {
      const t = ev.target instanceof Element ? ev.target : null;
      if (t && t.closest('[data-table-close]')) {
        ev.preventDefault();
        ev.stopPropagation();
        closeOptionsTable();
      }
    });
    panel.appendChild(el);
    tableModalEl = el;
    document.addEventListener('keydown', onOptionsTableKey, true);
    const closeBtn = el.querySelector('.vp-options-modal-close');
    if (closeBtn) closeBtn.focus();
  }

  function renderVariants(variants) {
    const box = panel.querySelector('#vc-variants');
    const ui = UI();
    lastVariants = Array.isArray(variants) ? variants : [];
    if (!lastVariants.length) {
      box.innerHTML = '';
      box.classList.add('crank-hidden');
      return;
    }
    box.classList.remove('crank-hidden');
    box.innerHTML =
      (tableDataFor(lastVariants)
        ? '<div class="vp-panel-stroke vc-variant-divider vc-view-table-divider vc-view-table-divider--top" role="separator"></div>' +
          '<div class="vc-view-table vc-variant-title" role="button" tabindex="0" data-variants-table>View table</div>' +
          '<div class="vp-panel-stroke vc-variant-divider vc-view-table-divider" role="separator"></div>'
        : '') +
      '<div class="vc-variants-list">' +
      lastVariants
        .map(function (v) {
          return renderVariantCard(v, ui);
        })
        .join('<div class="vp-panel-stroke vc-variant-divider" role="separator"></div>') +
      '</div>';

    markActiveVariantCard(activeVariantId);
    refreshPagePresence();
  }

  async function queueAgentVariant(variantId) {
    if (!sessionId) {
      const msg = 'Select a region and Ask Glean before using Agent';
      showToast(msg, 'error');
      setStatus(msg);
      return;
    }
    if (!variantId) {
      const msg = 'Agent: missing variant id';
      showToast(msg, 'error');
      setStatus(msg);
      return;
    }
    const local = lastVariants.find(function (v) {
      return v && v.id === variantId;
    });
    activeVariantId = variantId;
    markActiveVariantCard(variantId);
    showToast('Queueing for Cursor agent…', 'info');
    setStatus('Queueing for Cursor agent…');

    // Prefer HTTP so we always get the executable prompt for clipboard + handoff UI.
    // (WS-only fire-and-forget looked like “nothing happened” when Cursor chat stayed quiet.)
    try {
      const data = await postJson(
        '/api/agent-prompt',
        {
          sessionId: sessionId,
          variantId: variantId,
          source: 'panel'
        },
        { timeoutMs: 15000 }
      );
      const task = (data && data.task) || {};
      if (!task.prompt) {
        throw new Error(
          (data && data.error) || 'Companion returned no agent prompt'
        );
      }
      if (!task.variantLabel && local && local.label) {
        task.variantLabel = local.label;
      }
      await finishAgentQueue(task, { force: true });
    } catch (err) {
      const raw = err && err.message ? String(err.message) : 'unknown';
      const down =
        /Companion not running|Failed to fetch|NetworkError|Load failed/i.test(
          raw
        );
      const msg = down
        ? 'Companion not running — start with npx crank / open :3344'
        : 'Agent queue failed: ' + raw;
      showAgentHandoffError(
        msg,
        down
          ? 'Expected companion at ' + COMPANION_HTTP
          : 'Is the companion running at ' + COMPANION_HTTP + '?'
      );
      showToast(msg, 'error');
      setStatus(msg);
    }
  }

  async function copyVariantPrompt(variantId) {
    const local = lastVariants.find(function (v) {
      return v && v.id === variantId;
    });
    if (!local) {
      const msg = 'That option is no longer in this response';
      showToast(msg, 'error');
      setStatus(msg);
      return;
    }
    if (!variantId) {
      const msg = 'Copy: missing variant id';
      showToast(msg, 'error');
      setStatus(msg);
      return;
    }
    activeVariantId = variantId;
    markActiveVariantCard(variantId);
    showToast('Copying agent prompt…', 'info');
    setStatus('Copying agent prompt…');
    try {
      const data = await postJson(
        '/api/copy-prompt',
        {
          sessionId: sessionId || undefined,
          variantId: variantId,
          pageUrl: location.href,
          selector: selectedEl ? cssPath(selectedEl) : '',
          sourceNodes: selectedNodes.map(function (node) {
            return {
              id: node.id,
              path: node.path,
              role: node.role,
              selector: node.selector,
              label: node.label,
              editable: node.editable,
              text: node.text,
              originalText:
                node.originalText != null ? node.originalText : node.text,
              textSource: node.textSource || null,
              parts: node.parts || null
            };
          }),
          variant: {
            id: local.id,
            label: local.label || local.title || local.id,
            nodes: local.nodes || [],
            fields: local.fields || null
          }
        },
        { timeoutMs: 15000 }
      );
      if (!data.ok || !data.prompt) {
        throw new Error(
          (data && data.error) || 'Companion returned no copy prompt'
        );
      }
      const copied = await copyTextToClipboard(data.prompt);
      const count =
        typeof data.changeCount === 'number'
          ? data.changeCount
          : Array.isArray(data.changes)
            ? data.changes.length
            : 0;
      const msg = copied
        ? 'Copied agent prompt (' +
          count +
          ' change' +
          (count === 1 ? '' : 's') +
          ') — ' +
          PASTE_IN_AGENT_CHAT
        : 'Copy prompt ready but clipboard failed — check browser permissions';
      showToast(msg, copied ? 'ok' : 'error');
      setStatus(msg);
    } catch (err) {
      const raw = err && err.message ? String(err.message) : 'unknown';
      const down =
        /Companion not running|Failed to fetch|NetworkError|Load failed/i.test(
          raw
        );
      const msg = down
        ? 'Companion not running — start with npx crank / open :3344'
        : 'Copy failed: ' + raw;
      showToast(msg, 'error');
      setStatus(msg);
    }
  }

  function clearPagePreview() {
    if (previewRestore.length) {
      for (let i = previewRestore.length - 1; i >= 0; i -= 1) {
        const item = previewRestore[i];
        if (item.el && item.el.isConnected !== false) {
          writeVisibleText(item.el, item.node, item.previous);
        }
      }
      previewRestore = [];
    } else {
      restoreOriginal();
    }
    previewedVariantId = null;
    activeVariantId = null;
    markActiveVariantCard(null);
  }

  function textMatchesOriginal(el, node, original) {
    if (!el || !original) return !original;
    return currentUnitText(el, node).replace(/\s+/g, ' ').trim() === original;
  }

  function previewTargetsOnThisPage(nodes) {
    const targets = [];
    const used = new Set();
    (nodes || []).forEach(function (node) {
      if (!node || isDynamicOnlyNode(node)) return;
      const original = String(node.originalText || node.previousText || '')
        .replace(/\s+/g, ' ')
        .trim();
      let el = selectedEl ? resolveUnitElement(selectedEl, node) : null;
      if (el && !textMatchesOriginal(el, node, original)) el = null;
      if (!el && selectedEl && textMatchesOriginal(selectedEl, node, original)) el = selectedEl;
      if (!el) el = elementMatchingOriginalText(node);
      if (!el || isCrankChrome(el) || used.has(el)) return;
      if (!textMatchesOriginal(el, node, original)) return;
      used.add(el);
      targets.push({ node: node, el: el });
    });
    return targets;
  }

  function previewVariantOnSelection(variantId) {
    const local = lastVariants.find(function (v) {
      return v && v.id === variantId;
    });
    if (!local) {
      setStatus('That option is no longer in this response');
      return;
    }
    if (previewedVariantId === variantId) {
      clearPagePreview();
      syncEditorsFromVariant({ nodes: originalSnapshot });
      setStatus('Preview cleared');
      return;
    }
    clearPagePreview();
    const targets = previewTargetsOnThisPage(local.nodes || []);
    if (!targets.length) {
      setStatus('Those strings are not on this page, so nothing was changed.');
      return;
    }
    previewRestore = targets.map(function (target) {
      return {
        el: target.el,
        node: target.node,
        previous: currentUnitText(target.el, target.node)
      };
    });
    targets.forEach(function (target) {
      writeVisibleText(target.el, target.node, String(target.node.text || ''));
    });
    previewedVariantId = variantId;
    activeVariantId = variantId;
    markActiveVariantCard(variantId);
    syncEditorsFromVariant(local);
    const pageUrl = String(local.pageUrl || '');
    let otherPage = false;
    try {
      const saved = new URL(pageUrl, location.href);
      otherPage = pageUrl && saved.origin + saved.pathname !== location.origin + location.pathname;
    } catch (_) {
      otherPage = !!pageUrl && pageUrl !== location.href;
    }
    setStatus(
      otherPage
        ? 'Previewing "' +
            (local.label || 'this option') +
            '" on the matching strings on this page. Click the eye again to restore.'
        : 'Previewing "' +
            (local.label || 'this option') +
            '" on the page. Click the eye again to restore.'
    );
  }

  async function applyVariant(variantId, options) {
    if (!sessionId) return;
    const opts = options || {};
    const persist = opts.persist === true;
    const local = lastVariants.find(function (v) {
      return v && v.id === variantId;
    });
    setStatus(persist ? 'Applying (DOM + source)…' : 'Previewing…');
    activeVariantId = variantId;
    markActiveVariantCard(variantId);

    if (persist) {
      if (
        sendWs({
          type: 'APPLY_VARIANT',
          sessionId: sessionId,
          variantId: variantId,
          persist: true
        })
      ) {
        if (opts.syncEditors && local) syncEditorsFromVariant(local);
        return;
      }
      try {
        const data = await postJson('/api/apply', {
          sessionId: sessionId,
          variantId: variantId,
          persist: true
        });
        if (data.ok && selectedEl) {
          const variant = data.variant || local;
          applyNodesToDom(selectedEl, (variant && variant.nodes) || []);
          if (opts.syncEditors && variant) syncEditorsFromVariant(variant);
          setStatus(
            formatPersistStatus(
              data.persistResult,
              (variant && variant.label) || variantId
            )
          );
        } else {
          setStatus('Apply error: ' + (data.error || 'failed'));
        }
      } catch (err) {
        setStatus('Apply error: ' + (err.message || 'failed'));
      }
      return;
    }

    // Preview — DOM only
    if (
      sendWs({
        type: 'PREVIEW_VARIANT',
        sessionId: sessionId,
        variantId: variantId
      })
    ) {
      return;
    }
    try {
      const data = await postJson('/api/preview-variant', {
        sessionId: sessionId,
        variantId: variantId
      });
      if (data.ok && selectedEl) {
        const variant = data.variant || local;
        applyNodesToDom(selectedEl, (variant && variant.nodes) || []);
        setStatus(
          'Previewed "' +
            ((variant && variant.label) || variantId) +
            '" in DOM (not saved)'
        );
      } else {
        setStatus('Preview error: ' + (data.error || 'failed'));
      }
    } catch (err) {
      // Fallback: local DOM only if companion route missing
      if (local && selectedEl) {
        applyNodesToDom(selectedEl, local.nodes || []);
        setStatus(
          'Previewed "' +
            (local.label || variantId) +
            '" in DOM (local; companion preview unavailable)'
        );
      } else {
        setStatus('Preview error: ' + (err.message || 'failed'));
      }
    }
  }

  let thinkingLivePartial = '';
  let lastThinkingProgress = null;
  let thinkingStartedAt = 0;
  let thinkingUiTimer = null;

  function thinkingElapsedLine() {
    if (!thinkingStartedAt) return 'Elapsed 0s';
    const secs = Math.round((Date.now() - thinkingStartedAt) / 1000);
    return 'Elapsed ' + secs + 's';
  }

  /** Last N lines of stream text for paragraph-style thinking display. */
  function streamingBodyLines(partial, maxLines) {
    maxLines = maxLines || 3;
    const raw = String(partial || '').trim();
    if (!raw) return [];

    let lines = raw.split(/\n/).map(function (l) {
      return l.trim();
    }).filter(Boolean);
    if (lines.length > maxLines) {
      return lines.slice(-maxLines);
    }
    if (lines.length >= 2) return lines;

    const compact = raw.replace(/\s+/g, ' ').trim();
    const tail = compact.length > 320 ? '…' + compact.slice(-317) : compact;
    const width = 88;
    const wrapped = [];
    for (let i = tail.length; i > 0 && wrapped.length < maxLines; ) {
      const start = Math.max(0, i - width);
      const piece = tail.slice(start, i).trim();
      if (piece) wrapped.unshift(piece);
      i = start;
      if (start === 0) break;
    }
    return wrapped.slice(-maxLines);
  }

  function resolveLatestThought(progress) {
    if (!progress) return 'Waiting on Glean…';

    const stage = progress.stage ? String(progress.stage) : '';
    const genericConnected = 'Connected — agent running…';

    if (
      progress.latestThought &&
      progress.latestThought !== genericConnected &&
      !/^Streaming agent output/i.test(String(progress.latestThought))
    ) {
      return String(progress.latestThought);
    }

    if (progress.streamChars > 0 && !(progress.live && progress.partial)) {
      return 'Generating copy… (' + progress.streamChars + ' chars received)';
    }

    if (stage === 'start') {
      return progress.latestThought || progress.text || 'Sending to Glean…';
    }

    if (stage === 'stream_wait' || stage === 'waiting' || progress.text === genericConnected) {
      return progress.text || 'Connected — agent running…';
    }

    if (progress.text) return String(progress.text);
    return 'Waiting on Glean…';
  }

  function renderThinking() {
    const el = panel.querySelector('#vc-thinking');
    if (!el || !viewedRequestId) return;
    const progress = lastThinkingProgress || {};
    el.classList.remove('crank-hidden');
    el.style.display = 'block';

    if (progress.live && progress.partial) {
      thinkingLivePartial = String(progress.partial);
    }

    const elapsed = thinkingElapsedLine();
    const liveVariants = Array.isArray(progress.variants) ? progress.variants : [];
    if (panel.getAttribute('data-crank-step') === 'thinking') {
      renderVariants(liveVariants);
    }

    const displayLines = [];
    if (liveVariants.length) {
      displayLines.push(
        progress.text ||
          'Writing option ' + liveVariants.length + '…'
      );
    } else {
      displayLines.push(
        progress.live ? 'Writing options…' : resolveLatestThought(progress)
      );
      if (!progress.live && progress.detail && String(progress.detail).trim()) {
        displayLines.push(String(progress.detail).trim());
      }
    }
    displayLines.push(elapsed);

    el.style.whiteSpace = 'pre-wrap';
    el.style.overflow = 'visible';
    el.style.textOverflow = '';
    el.style.maxHeight = 'none';
    el.style.lineHeight = '1.45';
    el.style.overflowY = 'visible';
    el.style.overflowX = 'hidden';
    el.style.fontFamily = '';
    el.textContent = displayLines.join('\n');

    const stage = progress.stage ? String(progress.stage) : '';
    const statusPreview = displayLines[0] || '';
    if (stage === 'stub' || stage === 'done' || stage === 'fallback') {
      setStatus(statusPreview);
    } else if (stage === 'start') {
      setStatus('Sending to Glean…');
    } else if (progress.live) {
      setStatus('Glean is streaming…');
    } else {
      setStatus('Waiting on Glean…');
    }
    if (!el.__crankScrolled) {
      el.__crankScrolled = true;
      const scroller = panel.querySelector('.vp-panel-body');
      if (scroller) {
        const top =
          el.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop -
          12;
        scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      }
    }
  }

  function showThinking(progress) {
    lastThinkingProgress = progress || {};
    renderThinking();
  }

  function startThinkingClock() {
    thinkingStartedAt = Date.now();
    lastThinkingProgress = null;
    thinkingLivePartial = '';
    if (thinkingUiTimer) clearInterval(thinkingUiTimer);
    thinkingUiTimer = setInterval(function () {
      if (!viewedRequestId) return;
      renderThinking();
    }, 1000);
  }

  function stopThinkingClock() {
    if (thinkingUiTimer) {
      clearInterval(thinkingUiTimer);
      thinkingUiTimer = null;
    }
    thinkingStartedAt = 0;
    lastThinkingProgress = null;
    thinkingLivePartial = '';
  }

  function setPanelStep(step) {
    if (!panel) return;
    panel.setAttribute('data-crank-step', step === 'thinking' || step === 'results' ? step : 'ask');
    const scroller = panel.querySelector('.vp-panel-body');
    if (scroller) scroller.scrollTop = 0;
    scheduleAutogrowSync(panel);
  }

  function hideThinking() {
    const el = panel.querySelector('#vc-thinking');
    if (el) {
      el.__crankScrolled = false;
      el.classList.add('crank-hidden');
      el.style.display = 'none';
      el.textContent = '';
      el.style.maxHeight = '';
      el.style.overflowY = '';
      el.style.overflowX = '';
      el.style.fontFamily = '';
    }
    stopThinkingClock();
  }

  function hideCrankForShot() {
    ['crank-highlight', 'vp-crank-select-hint'].forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.setAttribute('data-crank-shot-hidden', '1');
      el.style.setProperty('visibility', 'hidden', 'important');
    });
  }

  function showCrankAfterShot() {
    document.querySelectorAll('[data-crank-shot-hidden]').forEach(function (el) {
      el.style.removeProperty('visibility');
      el.removeAttribute('data-crank-shot-hidden');
    });
  }

  function revealSelectionForShot(el) {
    const rect = el.getBoundingClientRect();
    const viewW = window.innerWidth || 1;
    const viewH = window.innerHeight || 1;
    const onScreen =
      rect.width > 2 &&
      rect.height > 2 &&
      rect.bottom > 8 &&
      rect.right > 8 &&
      rect.top < viewH - 8 &&
      rect.left < viewW - 8;
    if (onScreen) return function () {};
    const saved = [];
    let node = el.parentElement;
    while (node) {
      saved.push({ node: node, top: node.scrollTop, left: node.scrollLeft });
      node = node.parentElement;
    }
    const winX = window.scrollX;
    const winY = window.scrollY;
    try {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    } catch (_) {
      el.scrollIntoView(true);
    }
    return function () {
      for (let i = saved.length - 1; i >= 0; i -= 1) {
        saved[i].node.scrollTop = saved[i].top;
        saved[i].node.scrollLeft = saved[i].left;
      }
      window.scrollTo(winX, winY);
    };
  }

  function selectionFrame(rect) {
    const viewW = window.innerWidth || 1;
    const viewH = window.innerHeight || 1;
    const width = Math.max(rect.width + 220, Math.min(Math.max(viewW, rect.width + 220), 860));
    const height = Math.max(rect.height + 180, Math.min(Math.max(viewH, rect.height + 180), 520));
    return {
      left: rect.left + rect.width / 2 - width / 2,
      top: rect.top + rect.height / 2 - height / 2,
      width: width,
      height: height
    };
  }

  function browserWindowBox() {
    const screen = window.screen || {};
    const screenLeft = Number(screen.availLeft || screen.left || 0);
    const screenTop = Number(screen.availTop || screen.top || 0);
    const screenWidth = Number(screen.width || 0);
    const screenHeight = Number(screen.height || 0);
    const reportedX = Number(window.screenX || 0);
    const reportedY = Number(window.screenY || 0);
    const alreadyGlobal =
      screenWidth > 1 &&
      reportedX >= screenLeft - 20 &&
      reportedX <= screenLeft + screenWidth + 20 &&
      reportedY >= screenTop - 20 &&
      reportedY <= screenTop + screenHeight + 20;
    return {
      screenX: alreadyGlobal ? reportedX : screenLeft + reportedX,
      screenY: alreadyGlobal ? reportedY : screenTop + reportedY,
      screenLeft: screenLeft,
      screenTop: screenTop,
      screenWidth: screenWidth,
      screenHeight: screenHeight,
      outerWidth: window.outerWidth || 0,
      outerHeight: window.outerHeight || 0,
      innerWidth: window.innerWidth || 0,
      innerHeight: window.innerHeight || 0
    };
  }

  function selectionShotSpec(rect, match) {
    const frame = selectionFrame(rect);
    const box = browserWindowBox();
    return {
      title: document.title || '',
      match: match || '',
      screenX: box.screenX,
      screenY: box.screenY,
      screenLeft: box.screenLeft,
      screenTop: box.screenTop,
      screenWidth: box.screenWidth,
      screenHeight: box.screenHeight,
      outerWidth: box.outerWidth,
      outerHeight: box.outerHeight,
      innerWidth: box.innerWidth,
      innerHeight: box.innerHeight,
      frameLeft: frame.left,
      frameTop: frame.top,
      frameWidth: frame.width,
      frameHeight: frame.height,
      markerInner: 12,
      viewCenterX: rect.left + rect.width / 2,
      viewCenterY: rect.top + rect.height / 2,
      viewWidth: pageViewSize().width,
      viewHeight: pageViewSize().height,
      selLeft: rect.left,
      selTop: rect.top,
      selWidth: rect.width,
      selHeight: rect.height
    };
  }

  function pageViewSize() {
    let width = window.innerWidth || 0;
    let height = window.innerHeight || 0;
    if (panel && panel.parentNode && panel.getAttribute('data-crank-dock') === '1') {
      const dock = panel.getBoundingClientRect().width || 0;
      if (dock > 40 && dock < width) width -= dock;
    }
    return { width: width, height: height };
  }

  function placeShotMarker(rect) {
    const existing = document.getElementById('crank-shot-marker');
    if (existing) existing.remove();
    const marker = document.createElement('div');
    marker.id = 'crank-shot-marker';
    const size = 18;
    marker.style.cssText =
      'position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;background:#ff00ff;border:3px solid #00ffff;width:' +
      size +
      'px;height:' +
      size +
      'px;left:' +
      (rect.left + rect.width / 2 - size / 2) +
      'px;top:' +
      (rect.top + rect.height / 2 - size / 2) +
      'px;';
    document.documentElement.appendChild(marker);
    return function () {
      if (marker.parentNode) marker.parentNode.removeChild(marker);
    };
  }

  async function captureSelectionShots() {
    if (!selectedEl || !selectedEl.getBoundingClientRect) return null;
    const restoreScroll = revealSelectionForShot(selectedEl);
    hideCrankForShot();
    try {
      const previousTitle = document.title;
      const match = 'crankcap' + Math.random().toString(16).slice(2, 10);
      document.title = (previousTitle || 'Crank') + ' ' + match;
      let removeMarker = function () {};
      try {
        await new Promise(function (resolve) {
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              setTimeout(resolve, 280);
            });
          });
        });
        const rect = selectedEl.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return null;
        removeMarker = placeShotMarker(rect);
        await new Promise(function (resolve) {
          requestAnimationFrame(function () {
            setTimeout(resolve, 60);
          });
        });
        const spec = selectionShotSpec(rect, match);
        const located = await postJson('/api/screenshot', Object.assign({ locate: true }, spec));
        removeMarker();
        removeMarker = function () {};
        if (!located || !located.ok || !(located.scale > 0)) return null;
        await new Promise(function (resolve) {
          requestAnimationFrame(function () {
            requestAnimationFrame(resolve);
          });
        });
        const data = await postJson(
          '/api/screenshot',
          Object.assign({}, spec, {
            locate: false,
            anchorX: located.x,
            anchorY: located.y,
            pixelScale: located.scale
          })
        );
        if (!data || !data.ok || !data.path) return null;
        return { tight: '', context: data.path };
      } finally {
        removeMarker();
        document.title = previousTitle;
      }
    } catch (_) {
      return null;
    } finally {
      showCrankAfterShot();
      restoreScroll();
    }
  }
  async function requestGlean(opts) {
    returnToHistory = !!(opts && opts.fromHistory === true);
    historyDetailRun = null;
    gleanValidationRequested = true;
    const gleanValidation = updateGleanContextValidationUI();
    if (!gleanValidation.ok) {
      scrollToFirstGleanFieldError();
      setStatus(GLEAN_REQUIRED_MSG);
      syncGleanButton();
      return;
    }
    const requestSessionId = sessionId;
    if (!requestSessionId) {
      showToast('Select copy on the page first', 'error');
      setStatus('Select copy on the page first');
      return;
    }
    const pendingId = 'pending-' + Date.now();
    const gleanBtn = panel && panel.querySelector('#vc-glean');
    if (gleanBtn) gleanBtn.disabled = true;
    viewedRequestId = pendingId;
    liveRequests[pendingId] = { sessionId: requestSessionId, startedAt: Date.now() };
    thinkingStartedAt = liveRequests[pendingId].startedAt;
    startThinkingClock();
    renderVariants([]);
    setAgentStatus('running', 'Agent running');
    setPanelStep('thinking');
    setPanelSurface('crank');
    showThinking({
      stage: 'snapshot',
      text: 'Saving a snapshot of the selection…',
      detail: 'The agent starts as soon as that finishes',
      live: false
    });
    let selectionShots = null;
    try {
      selectionShots = await captureSelectionShots();
    } catch (_) {}
    if (viewedRequestId === pendingId) {
      showThinking({
        stage: 'stream_wait',
        text: 'Connecting to the agent…',
        detail: 'Robot Content Designer · usually 1–2 min',
        live: false
      });
    }
    let responseId = '';
    try {
      const started = await postJson('/api/responses/start', {
        sessionId: requestSessionId,
        shots: selectionShots || undefined
      });
      responseId = started && started.id ? String(started.id) : '';
    } catch (_) {}
    if (responseId) saveHistoryContext(responseId, gleanValidation.context);
    const pending = liveRequests[pendingId];
    delete liveRequests[pendingId];
    if (responseId) {
      liveRequests[responseId] = {
        sessionId: requestSessionId,
        startedAt: pending && pending.startedAt ? pending.startedAt : Date.now()
      };
      if (viewedRequestId === pendingId) viewedRequestId = responseId;
    } else if (viewedRequestId === pendingId) {
      viewedRequestId = pendingId;
      liveRequests[pendingId] = pending || { sessionId: requestSessionId, startedAt: Date.now() };
      setStatus('Could not save this request to history');
    }
    if (panel && panel.getAttribute('data-crank-view') === 'history') loadHistoryList();
    const activeId = responseId || pendingId;
    let progressPoll = null;
    try {
      const companionOk =
        typeof window.__crankProbeCompanion === 'function'
          ? await window.__crankProbeCompanion()
          : window.__CRANK_COMPANION_ONLINE__ !== false;
      if (!companionOk) {
        showCompanionOfflineUI();
        showToast('Companion offline — copy the command in the banner and run it', 'error');
        delete liveRequests[activeId];
        if (responseId) {
          postJson('/api/responses/' + encodeURIComponent(responseId) + '/expire', {
            error: 'No response'
          }).catch(function () {});
        }
        hideThinking();
        setPanelStep('ask');
        setStatus('No response');
        return;
      }
      persistGleanContextFromPanel();
      progressPoll = setInterval(async function () {
        if (viewedRequestId !== activeId) return;
        try {
          const resp = await fetch(
            COMPANION_HTTP + '/api/glean-progress?sessionId=' + encodeURIComponent(requestSessionId),
            { cache: 'no-store', headers: authHeaders() }
          );
          const data = await resp.json();
          if (data.ok && data.progress && viewedRequestId === activeId) {
            showThinking(data.progress);
          }
        } catch (_) {}
      }, 400);
      const optionCount = getGleanOptionCount();
      const data = await postJson(
        '/api/variants',
        {
          sessionId: requestSessionId,
          responseId: responseId || undefined,
          optionCount: optionCount,
          shots: selectionShots || undefined,
          gleanContext: gleanValidation.context,
          options: {
            optionCount: optionCount,
            gleanContext: gleanValidation.context
          }
        },
        { timeoutMs: GLEAN_VARIANTS_TIMEOUT_MS }
      );
      if (!data.ok) throw new Error(data.error || 'Glean failed');
      const variants = data.variants || (data.session && data.session.variants) || [];
      delete liveRequests[activeId];
      if (viewedRequestId === activeId) {
        hideThinking();
        renderVariants(variants);
        setPanelStep(variants.length ? 'results' : 'ask');
        setStatus(variants.length ? 'Glean returned ' + variants.length + ' options' : 'No response');
      } else if (panel && panel.getAttribute('data-crank-view') === 'history') {
        loadHistoryList();
      }
    } catch (err) {
      delete liveRequests[activeId];
      if (viewedRequestId === activeId) {
        hideThinking();
        setPanelStep('ask');
        setStatus('Glean error: ' + err.message);
      } else if (panel && panel.getAttribute('data-crank-view') === 'history') {
        loadHistoryList();
      }
    } finally {
      if (progressPoll) clearInterval(progressPoll);
      const gleanBtn = panel && panel.querySelector('#vc-glean');
      if (gleanBtn) gleanBtn.disabled = false;
    }
  }

  function pickerElement(event) {
    const fromPoint = document.elementFromPoint(event.clientX, event.clientY);
    const raw =
      event.target && event.target.nodeType === 1
        ? event.target
        : fromPoint && fromPoint.nodeType === 3
          ? fromPoint.parentElement
          : fromPoint;
    if (!(raw instanceof Element) || isCrankChrome(raw)) return null;
    return raw;
  }

  function onMove(ev) {
    if (!selecting) return;
    if (eventInCrankChrome(ev)) return;
    const target = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!(target instanceof Element) || isCrankChrome(target)) return;
    const r = target.getBoundingClientRect();
    highlight.style.left = r.left + 'px';
    highlight.style.top = r.top + 'px';
    highlight.style.width = r.width + 'px';
    highlight.style.height = r.height + 'px';
  }

  async function onClick(ev) {
    if (!selecting) return;
    if (eventInCrankChrome(ev)) return;
    const target = pickerElement(ev);
    if (!target) return;
    ev.preventDefault();
    ev.stopPropagation();
    stopSelect();
    layerFocus = target;
    checkedLayers = [target];
    selectedEl = target;
    selectedNodes = stringsFromCheckedLayers();
    snapshotSelectionNodes();
    openPanelAfterSelection();
    renderNodes();
    renderLayerList();
    const payload = selectionPayloadFor(target);
    pendingSelectionPayload = payload;
    try {
      const authed = await ensureTeamToken();
      if (!authed) {
        showTeamAuthUI('panel');
        setStatus('Paste your team token below, then click Save token');
        syncGleanButton();
        return;
      }
      pendingSelectionPayload = null;
      await registerSelection(payload);
    } catch (err) {
      const msg = err && err.message ? String(err.message) : 'Selection failed';
      showToast(msg, 'error');
      setStatus('Selection error: ' + msg);
      syncGleanButton();
    }
  }

  function onKey(ev) {
    if (ev.key === 'Escape' && selecting) cancelSelectionMode();
  }

  function startSelect() {
    selecting = true;
    document.documentElement.appendChild(highlight);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    setStatus('Hover an element, click to select · Esc cancels');
  }

  function stopSelect() {
    selecting = false;
    highlight.remove();
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
  }

  function showReopenChip() {
    showFab();
  }

  async function reopenPanel() {
    const chip = document.getElementById('vp-crank-reopen');
    if (chip) chip.remove();
    window.__crankActive = true;
    window.__CRANK_LOADER__ = true;
    try {
      await boot();
    } catch (err) {
      console.error('[Crank] reopen failed', err);
      showFab();
    }
  }

  window.__crankReopenPanel = reopenPanel;

  function teardown() {
    closePanel();
    if (socket) {
      try {
        socket.close();
      } catch (_) {}
      socket = null;
    }
    if (highlight && highlight.parentNode) highlight.remove();
    if (launcher && launcher.parentNode) launcher.remove();
    launcher = null;
    fab = null;
    toolbarOpen = false;
    if (teamAuthFab && teamAuthFab.parentNode) teamAuthFab.remove();
    teamAuthFab = null;
    if (selectHint && selectHint.parentNode) selectHint.remove();
    selectHint = null;
    window.__crankActive = false;
    window.__crankTeardown = null;
    window.__CRANK_LOADER__ = false;
    try {
      document.querySelectorAll('script[data-crank-loader="1"]').forEach(function (el) {
        el.remove();
      });
    } catch (_) {}
  }

  window.__crankTeardown = teardown;

  async function boot() {
    await loadPanelAssets();
    ensureFab();
    if (!panel.querySelector('#vc-glean')) {
      buildPanelShell();
    }
    const authed = await ensureTeamToken();
    if (!authed) {
      showTeamAuthUI('fab');
      try {
        connectWs();
      } catch (_) {}
      if (typeof window.__crankProbeCompanion === 'function') {
        await window.__crankProbeCompanion();
      }
      return;
    }
    try {
      connectWs();
    } catch (_) {}
    if (typeof window.__crankProbeCompanion === 'function') {
      await window.__crankProbeCompanion();
    }
    if (panelAutoUpdateEnabled()) {
      schedulePanelAutoUpdate(COMPANION_HTTP);
    }
  }

  boot().catch(function (err) {
    console.error('[Crank] boot failed', err);
    const shellReady = panel && panel.querySelector('#vc-glean');
    if (shellReady || (fab && fab.parentNode)) {
      return;
    }
    ensureFab();
  });
})();
