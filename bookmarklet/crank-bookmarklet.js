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

  async function registerSelection(payload) {
    if (sendWs({ type: 'SET_SELECTION', payload: payload })) {
      /* SELECTION_ACK or POST sets sessionId */
    }
    const data = await postJson('/api/selection', payload);
    if (data.ok && data.session) {
      applySessionFromServer(data.session);
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
  let sessionId = null;
  let socket = null;
  let selecting = false;
  let originalSnapshot = [];
  let lastVariants = [];
  let activeVariantId = null;
  /** Bumps on each Ask Glean; stale WS progress after variants must not reopen thinking. */
  let gleanEpoch = 0;
  let gleanActiveEpoch = 0;
  /** fab = logo only · selecting = pick layout · panel = full editor */
  let uiMode = 'fab';
  let fab = null;
  let selectHint = null;
  const OPTION_COUNT_KEY = 'crank.gleanOptionCount';
  const DEFAULT_GLEAN_OPTION_COUNT = 3;

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
    const sel = panel && panel.querySelector('#vc-option-count');
    const raw = sel ? sel.value : localStorage.getItem(OPTION_COUNT_KEY);
    const n = parseInt(String(raw || DEFAULT_GLEAN_OPTION_COUNT), 10);
    if (!Number.isFinite(n)) return DEFAULT_GLEAN_OPTION_COUNT;
    return Math.min(6, Math.max(2, n));
  }

  const highlight = document.createElement('div');
  highlight.id = 'crank-highlight';
  highlight.style.cssText =
    'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid oklch(0.45 0.08 180);background:oklch(0.7 0.06 180 / 0.12);border-radius:3px;transition:all 80ms ease;';

  const panel = document.createElement('div');
  panel.id = 'vp-shell';
  panel.setAttribute('data-crank-panel', '1');
  panel.style.cssText =
    'position:fixed;top:16px;right:16px;width:380px;max-height:calc(100vh - 32px);overflow:auto;z-index:2147483647;';

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

  function updateCompanionOfflineCopy() {
    const cmdEl = panel && panel.querySelector('#vc-companion-cmd');
    const agentEl = panel && panel.querySelector('#vc-companion-agent-phrase');
    if (cmdEl) cmdEl.textContent = companionStartCommand();
    if (agentEl) agentEl.textContent = COMPANION_AGENT_PHRASE;
  }

  function showCompanionOfflineUI() {
    if (!panel || uiMode !== 'panel') return;
    ensurePanelMounted();
    updateCompanionOfflineCopy();
    const box = panel.querySelector('#vc-companion-offline');
    if (box) box.style.display = 'block';
  }

  function hideCompanionOfflineUI() {
    const box = panel && panel.querySelector('#vc-companion-offline');
    if (box) box.style.display = 'none';
  }

  async function retryCompanionConnection() {
    setStatus('Checking companion…');
    showToast('Checking companion…', 'info');
    const probe =
      typeof window.__crankProbeCompanion === 'function'
        ? window.__crankProbeCompanion
        : null;
    if (!probe) {
      showToast('Companion check unavailable — reload the page', 'error');
      return;
    }
    const ok = await probe();
    if (ok) {
      hideCompanionOfflineUI();
      showToast('Companion connected — you can Ask Glean', 'ok');
      syncGleanButton();
      try {
        connectWs();
      } catch (_) {}
      checkPanelUpdate(COMPANION_HTTP, { quiet: true });
    } else {
      showToast(
        'Still offline — run the terminal command below or paste the agent phrase in Cursor chat',
        'error'
      );
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

  function isCrankChrome(el) {
    if (!(el instanceof Element)) return false;
    return !!(
      el.closest('#vp-shell') ||
      el.closest('#vp-crank-fab') ||
      el.closest('#vp-crank-select-hint') ||
      el.id === 'crank-highlight'
    );
  }

  function ensureFab() {
    if (fab && fab.parentNode) return fab;
    fab = document.createElement('button');
    fab.id = 'vp-crank-fab';
    fab.type = 'button';
    fab.className = 'vp-crank-fab';
    fab.setAttribute('aria-label', 'Crank — select copy to edit');
    fab.innerHTML =
      '<img src="' +
      getFabLogoUrl().replace(/"/g, '&quot;') +
      '" alt="" draggable="false" width="36" height="36" />';
    fab.addEventListener('click', function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      if (ev && ev.stopPropagation) ev.stopPropagation();
      if (uiMode === 'selecting' || uiMode === 'panel') return;
      startSelectFromFab();
    });
    document.documentElement.appendChild(fab);
    return fab;
  }

  function showFab() {
    ensureFab();
    if (fab) fab.style.display = '';
  }

  function hideFab() {
    if (fab) fab.style.display = 'none';
  }

  function setFabActive(active) {
    if (!fab) return;
    fab.classList.toggle('vp-crank-fab--active', !!active);
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

  function startSelectFromFab() {
    if (selecting || uiMode === 'panel') return;
    uiMode = 'selecting';
    setFabActive(true);
    showSelectHint('Click a layout on the page · Esc to cancel');
    startSelect();
  }

  function cancelSelectionMode() {
    stopSelect();
    uiMode = 'fab';
    setFabActive(false);
    hideSelectHint();
  }

  function ensurePanelMounted() {
    if (!panel.querySelector('#vc-glean')) {
      buildPanelShell();
    }
    if (!panel.parentNode) {
      document.documentElement.appendChild(panel);
    }
  }

  function openPanelAfterSelection() {
    uiMode = 'panel';
    setFabActive(false);
    hideSelectHint();
    hideFab();
    ensurePanelMounted();
  }

  function resetSessionState() {
    selectedEl = null;
    selectedNodes = [];
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
    glean.disabled = !sessionId || !online;
    glean.title = !online
      ? 'Companion offline — use Retry below or run: ' + companionStartCommand()
      : sessionId
        ? 'Ask Glean for rewritten copy alternatives'
        : 'Select copy on the page first';
  }

  function applySessionFromServer(session) {
    if (!session || !session.id) return false;
    sessionId = session.id;
    syncGleanButton();
    return true;
  }

  function closePanel() {
    stopSelect();
    hideSelectHint();
    restoreOriginal();
    resetSessionState();
    if (panel.parentNode) panel.remove();
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
    if (el) el.textContent = text;
    if (selectHint && uiMode === 'selecting') {
      selectHint.textContent = String(text || '');
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
    const bg =
      tone === 'error'
        ? 'oklch(0.93 0.04 25)'
        : tone === 'ok'
          ? 'oklch(0.93 0.04 160)'
          : 'oklch(0.95 0.03 180)';
    const border =
      tone === 'error'
        ? 'oklch(0.55 0.14 25)'
        : tone === 'ok'
          ? 'oklch(0.45 0.1 160)'
          : 'oklch(0.45 0.08 180)';
    toast.style.cssText =
      'display:block;margin:0 0 10px;padding:8px 10px;border:1px solid ' +
      border +
      ';border-radius:8px;background:' +
      bg +
      ';color:var(--foreground,#111);font:12px/1.45 ui-sans-serif,system-ui,sans-serif;';
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
    return /^(span|strong|b|em|i|u|small|mark|code|a|br|wbr|svg|path)$/i.test(tag);
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
    if (/^(h1|h2|h3|h4|h5|h6|button|label|li|p|figcaption|caption|td|th)$/.test(tag)) {
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

  function buildUnit(el, classify, pathIndex) {
    const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    const parts = analyzeUnitParts(el, classify);
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
      editable: source.editable
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

  /**
   * Coalesce copy into meaningful units (id, optional role, text, selector).
   * Do not split a sentence across text nodes — keep one field per block;
   * chip dynamic/bound fragments inside the unit instead.
   */
  function extractTextNodes(root) {
    const classify = TS().classifyTextSource || function () {
      return { type: 'static-label', editable: true };
    };
    const units = [];
    const seen = new Set();

    function pushUnit(el) {
      if (!el || seen.has(el)) return;
      const unit = buildUnit(el, classify, units.length);
      if (!unit) return;
      seen.add(el);
      units.push(unit);
    }

    function walk(el) {
      if (!(el instanceof Element)) return;
      if (isCrankChrome(el)) return;
      if (isCopyUnitRoot(el)) {
        pushUnit(el);
        return; // do not split children into separate units
      }
      Array.from(el.children).forEach(walk);
    }

    walk(root);

    // Fallback: whole selection as one body if nothing matched
    if (!units.length) {
      const unit = buildUnit(root, classify, 0);
      if (unit) units.push(unit);
    }

    return assignUnitLabels(mergeSiblingBodyUnits(units));
  }

  function resolveUnitElement(root, node) {
    if (!root || !node) return null;
    if (node.selector) {
      try {
        const found = document.querySelector(node.selector);
        if (found && root.contains(found) && found !== root) return found;
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
          if (el && root.contains(el) && el !== root) {
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
      if (!el) continue;
      const next = String(node.text || '');
      if (
        String(el.textContent || '')
          .replace(/\s+/g, ' ')
          .trim() === next.replace(/\s+/g, ' ').trim()
      ) {
        continue;
      }
      el.textContent = next;
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
        if (gleanBtn && !sessionId) {
          // Keep disabled until selection+session; only gate when we know companion is down
          if (!on) gleanBtn.disabled = true;
        }
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
        const resp = await fetch(COMPANION_HTTP + '/health', {
          cache: 'no-store',
          headers: authHeaders()
        });
        const data = await resp.json().catch(function () {
          return {};
        });
        if (resp.ok && data && data.ok !== false) {
          setGleanEnabled(true);
          hideCompanionOfflineUI();
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
      setStatus(
        'Companion offline — Retry below, run: ' +
          companionStartCommand() +
          ', or ask Cursor: ' +
          COMPANION_AGENT_PHRASE
      );
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
          setStatus('Selection ready — preview/edit or Ask Glean');
        }
        if (msg.type === 'VARIANTS_READY' && msg.session) {
          sessionId = msg.session.id;
          gleanActiveEpoch = 0;
          hideThinking();
          renderVariants(msg.session.variants || []);
          setStatus('Glean returned ' + (msg.session.variants || []).length + ' options');
          syncGleanButton();
        }
        if (msg.type === 'GLEAN_PROGRESS') {
          if (!gleanActiveEpoch) return;
          if (msg.sessionId && sessionId && msg.sessionId !== sessionId) return;
          showThinking(msg.progress || {});
        }
        if (msg.type === 'GLEAN_ERROR') {
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

    panel.innerHTML =
      '<div class="vp-panel-block" style="padding:var(--vp-panel-padding, 1rem);">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">' +
      '<div style="display:flex;align-items:center;gap:8px;">' +
      '<strong style="font-size:var(--vp-font-size-body,14px);font-weight:var(--vp-font-weight-title,600);">Crank</strong>' +
      (getPanelChannel() === 'preview'
        ? '<span class="vp-type-micro" style="padding:2px 8px;border-radius:999px;background:oklch(0.93 0.06 85);color:oklch(0.45 0.12 85);font-weight:620;">Preview</span>'
        : '') +
      '</div>' +
      btn('ghost', '×', { id: 'vc-close' }, { icon: true, size: 'compact' }) +
      '</div>' +
      '<p id="vc-status" class="vp-muted vp-type-support" style="margin:0 0 10px;">Loading UI…</p>' +
      '<div id="vc-toast" style="display:none;"></div>' +
      '<div id="vc-companion-offline" style="display:none;margin:0 0 10px;padding:10px;border:1px solid oklch(0.55 0.14 25);border-radius:8px;background:oklch(0.97 0.02 25);">' +
      '<div class="vp-type-label" style="font-weight:620;margin-bottom:6px;color:oklch(0.45 0.14 25);">Companion offline</div>' +
      '<p class="vp-muted vp-type-micro" style="margin:0 0 8px;line-height:1.45;">Ask Glean, Copy, and Agent need the Crank companion (<code>' +
      escape(String(COMPANION_HTTP).replace(/^https?:\/\//, '')) +
      '</code>). The browser cannot start it — run in your project terminal, or paste the agent phrase in Cursor chat and let the agent run the command.</p>' +
      '<div class="vp-type-micro" style="margin:0 0 6px;font-weight:600;">Terminal (project root)</div>' +
      '<code id="vc-companion-cmd" style="display:block;margin:0 0 8px;padding:8px 10px;border-radius:6px;background:var(--background);border:1px solid var(--border);font:12px/1.4 ui-monospace,Menlo,monospace;word-break:break-all;">' +
      escape(companionStartCommand()) +
      '</code>' +
      '<div class="vp-type-micro" style="margin:0 0 6px;font-weight:600;">First time in this repo</div>' +
      '<code style="display:block;margin:0 0 8px;padding:8px 10px;border-radius:6px;background:var(--background);border:1px solid var(--border);font:12px/1.4 ui-monospace,Menlo,monospace;word-break:break-all;">' +
      escape(companionFirstTimeCommand()) +
      '</code>' +
      '<div class="vp-type-micro" style="margin:0 0 6px;font-weight:600;">Cursor agent phrase</div>' +
      '<code id="vc-companion-agent-phrase" style="display:block;margin:0 0 10px;padding:8px 10px;border-radius:6px;background:var(--background);border:1px solid var(--border);font:12px/1.4 ui-monospace,Menlo,monospace;">' +
      escape(COMPANION_AGENT_PHRASE) +
      '</code>' +
      group(
        btn('primary', 'Retry connection', { id: 'vc-companion-retry', type: 'button' }, { size: 'compact', flex: true }) +
          btn('secondary', 'Copy command', { id: 'vc-companion-copy-cmd', type: 'button' }, { size: 'compact', flex: true }) +
          btn('secondary', 'Copy agent phrase', { id: 'vc-companion-copy-agent', type: 'button' }, { size: 'compact', flex: true }),
        { stretch: true }
      ) +
      '</div>' +
      '<div id="vc-team-auth" style="display:none;margin:0 0 10px;padding:10px;border:1px solid var(--border);border-radius:8px;background:oklch(0.97 0.01 180);">' +
      '<div class="vp-type-label" style="font-weight:620;margin-bottom:6px;">Team token required</div>' +
      '<p class="vp-muted vp-type-micro" style="margin:0 0 8px;line-height:1.45;">Paste the same value as <code>CRANK_TEAM_TOKEN</code> in your project <code>.env</code>. It is saved in this browser only — not sent to chat.</p>' +
      '<input type="password" id="vc-team-token" placeholder="Crank-…" autocomplete="off" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--background);color:var(--foreground);font:13px/1.4 ui-sans-serif,system-ui,sans-serif;margin-bottom:8px;" />' +
      btn('primary', 'Save token', { id: 'vc-team-token-save' }, { size: 'compact', flex: true }) +
      '</div>' +
      '<div id="vc-glean-options" style="margin:0 0 10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
      '<label for="vc-option-count" class="vp-type-label" style="display:flex;align-items:center;gap:6px;cursor:help;" title="Number of new rewritten alternatives (original draft is not shown). Fewer may reduce wait slightly; most latency is still agent runtime (~1–2 min).">' +
      'New alternatives' +
      '<span class="vp-muted vp-type-micro" aria-hidden="true">(?)</span>' +
      '</label>' +
      '<select id="vc-option-count" class="vp-type-support" style="min-width:4.5rem;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--background);color:var(--foreground);">' +
      [2, 3, 4, 5, 6]
        .map(function (n) {
          return (
            '<option value="' +
            n +
            '"' +
            (n === DEFAULT_GLEAN_OPTION_COUNT ? ' selected' : '') +
            '>' +
            n +
            '</option>'
          );
        })
        .join('') +
      '</select>' +
      '</div>' +
      group(
        btn('secondary', 'Ask Glean', { id: 'vc-glean', disabled: true }, { size: 'compact', flex: true }),
        { stretch: true }
      ) +
      '<div id="vc-edit" style="margin-top:12px;"></div>' +
      '<div id="vc-thinking" class="vp-muted vp-type-support" style="display:none;margin-top:10px;padding:10px;border:1px solid var(--border);border-radius:8px;white-space:pre-wrap;line-height:1.5;font-size:12px;background:oklch(0.97 0.01 180);max-height:none;overflow:visible;"></div>' +
      '<div id="vc-actions" style="margin-top:10px;">' +
      group(
        btn('secondary', 'Preview', { id: 'vc-preview', disabled: true }, { size: 'compact', flex: true }) +
          btn('primary', 'Copy', { id: 'vc-copy-edits', disabled: true }, { size: 'compact', flex: true }),
        { stretch: true }
      ) +
      '</div>' +
      '<div id="vc-variants" style="margin-top:12px;"></div>' +
      '<div id="vc-agent-handoff" style="display:none;margin:12px 0 0;padding:10px;border:1px solid var(--border);border-radius:8px;background:oklch(0.97 0.01 180);"></div>' +
      '</div>';

    panel.querySelector('#vc-close').addEventListener('click', closePanel);
    const companionRetry = panel.querySelector('#vc-companion-retry');
    const companionCopyCmd = panel.querySelector('#vc-companion-copy-cmd');
    const companionCopyAgent = panel.querySelector('#vc-companion-copy-agent');
    if (companionRetry) {
      companionRetry.addEventListener('click', function () {
        retryCompanionConnection();
      });
    }
    if (companionCopyCmd) {
      companionCopyCmd.addEventListener('click', async function () {
        const ok = await copyTextToClipboard(companionStartCommand());
        showToast(
          ok ? 'Copied terminal command' : 'Copy failed — select the command text',
          ok ? 'ok' : 'error'
        );
      });
    }
    if (companionCopyAgent) {
      companionCopyAgent.addEventListener('click', async function () {
        const ok = await copyTextToClipboard(COMPANION_AGENT_PHRASE);
        showToast(
          ok ? 'Copied agent phrase — ' + PASTE_IN_AGENT_CHAT : 'Copy failed',
          ok ? 'ok' : 'error'
        );
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
    if (variantsBox && !variantsBox.__crankDelegated) {
      variantsBox.__crankDelegated = true;
      variantsBox.addEventListener('click', function (ev) {
        const target = ev.target && ev.target.closest
          ? ev.target.closest(
              '[data-variant-agent],[data-variant-preview],[data-variant-copy]'
            )
          : null;
        if (!target || !variantsBox.contains(target)) return;
        if (ev.preventDefault) ev.preventDefault();
        if (ev.stopPropagation) ev.stopPropagation();
        const agentId = target.getAttribute('data-variant-agent');
        if (agentId) {
          queueAgentVariant(agentId);
          return;
        }
        const previewId = target.getAttribute('data-variant-preview');
        if (previewId) {
          applyVariant(previewId, { syncEditors: false, persist: false });
          return;
        }
        const copyId = target.getAttribute('data-variant-copy');
        if (copyId) {
          copyVariantPrompt(copyId);
        }
      });
    }
    const optionCountSel = panel.querySelector('#vc-option-count');
    if (optionCountSel) {
      try {
        const saved = localStorage.getItem(OPTION_COUNT_KEY);
        if (saved && [2, 3, 4, 5, 6].indexOf(parseInt(saved, 10)) >= 0) {
          optionCountSel.value = String(parseInt(saved, 10));
        }
      } catch (_) {}
      optionCountSel.addEventListener('change', function () {
        try {
          localStorage.setItem(OPTION_COUNT_KEY, optionCountSel.value);
        } catch (_) {}
      });
    }
  }

  function renderNodes() {
    const ui = UI();
    const editEl = panel.querySelector('#vc-edit');
    if (!editEl) return;

    if (!selectedNodes.length) {
      editEl.innerHTML = '';
      setEditButtons(false);
      return;
    }

    const field = ui.vpFieldHtml || function (label, control) {
      return '<div><div>' + label + '</div>' + control + '</div>';
    };
    const area = ui.vpTextareaHtml || function (attrs, content) {
      return '<textarea id="' + (attrs.id || '') + '"' + (attrs.disabled ? ' disabled' : '') + '>' + (content || '') + '</textarea>';
    };
    const badge = ui.vpCapabilityBadgeHtml || function (_mode, text) {
      return '<span class="vp-type-micro">' + text + '</span>';
    };
    const escape = ui.escapeHtml || function (v) {
      return String(v || '');
    };

    editEl.innerHTML = selectedNodes
      .map(function (n, idx) {
        const label = roleLabel(n.role, n, idx, selectedNodes);
        const chips = sourceChips(n.textSource);
        const mode = n.editable ? 'editable' : 'read-only';
        const meta =
          chips
            .map(function (chip) {
              return badge(mode, chip);
            })
            .join(' ') +
          (n.editable
            ? ''
            : '<span class="vp-muted vp-type-micro"> Locked</span>');

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
            '<div class="vp-field" style="margin-bottom:10px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px;">' +
            '<span class="vp-type-label">' +
            escape(label) +
            '</span>' +
            meta +
            '</div>' +
            '<div class="vp-type-support" style="padding:8px;border:1px dashed var(--border);border-radius:8px;opacity:0.85;">' +
            escape(n.text) +
            '</div>' +
            (dynamicHints
              ? '<div style="margin-top:4px;">' + dynamicHints + '</div>'
              : '') +
            '</div>'
          );
        }

        return (
          field(
            label,
            area(
              { id: 'vc-edit-' + n.path, rows: '2', 'data-path': n.path },
              n.text,
              { size: 'compact' }
            ),
            { size: 'compact', metaHtml: meta }
          ) +
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
      return !isDynamicOnlyNode(n);
    });
    if (variantNodes.length) {
      variantNodes.forEach(function (n, idx) {
        const text = String(n && n.text != null ? n.text : '').trim();
        if (!text) return;
        rows.push({
          label: roleLabel(n.role, n, idx, variantNodes),
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
      card.style.borderColor = active
        ? 'color-mix(in oklch, var(--ring, #888) 45%, var(--border))'
        : '';
      card.style.boxShadow = active
        ? '0 0 0 1px color-mix(in oklch, var(--ring, #888) 25%, transparent)'
        : '';
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
    let bodyHtml = '';

    if (rows.length) {
      bodyHtml = rows
        .map(function (row) {
          return (
            '<div class="vc-variant-field" style="margin-top:8px;">' +
            '<div class="vp-muted vp-type-micro" style="margin-bottom:2px;">' +
            escape(row.label || 'Copy') +
            '</div>' +
            '<div class="vp-type-body" style="white-space:pre-wrap;word-break:break-word;color:var(--foreground);">' +
            escape(row.text) +
            '</div>' +
            '</div>'
          );
        })
        .join('');
    } else if (variant.rawText) {
      bodyHtml =
        '<div class="vp-type-support" style="margin-top:8px;white-space:pre-wrap;word-break:break-word;line-height:1.4;color:var(--foreground);">' +
        escape(String(variant.rawText)) +
        '</div>';
    } else if (variant.summary) {
      bodyHtml =
        '<div class="vp-muted vp-type-support" style="margin-top:8px;white-space:pre-wrap;word-break:break-word;">' +
        escape(variant.summary) +
        '</div>';
    }

    if (variant.scores) {
      bodyHtml +=
        '<div class="vp-muted vp-type-micro" style="margin-top:8px;padding:8px;border-radius:8px;background:oklch(0.97 0.01 180);line-height:1.45;">' +
        '<span style="font-weight:600;">Agent notes:</span> ' +
        escape(String(variant.scores)) +
        '</div>';
    }

    const recommended = !!variant.recommended;
    return (
      '<article class="vp-panel-block vc-variant-card' +
      (recommended ? ' is-recommended' : '') +
      '" data-variant-card="' +
      escape(variant.id) +
      '" style="padding:10px 12px;margin-bottom:8px;">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">' +
      '<div class="vp-type-label" style="font-weight:var(--vp-font-weight-title,620);color:var(--foreground);line-height:var(--vp-line-height-label,1.4);">' +
      escape(title) +
      '</div>' +
      (recommended ? badge('preview', 'Recommended') : '') +
      '</div>' +
      bodyHtml +
      '<div style="margin-top:10px;">' +
      group(
        btn(
          'secondary',
          'Preview',
          { 'data-variant-preview': variant.id, type: 'button' },
          { size: 'compact', flex: true }
        ) +
          btn(
            'primary',
            'Copy',
            { 'data-variant-copy': variant.id, type: 'button' },
            { size: 'compact', flex: true }
          ) +
          btn(
            'secondary',
            'Agent',
            { 'data-variant-agent': variant.id, type: 'button' },
            { size: 'compact', flex: true }
          ),
        { stretch: true }
      ) +
      '</div>' +
      '</article>'
    );
  }

  function renderVariants(variants) {
    const box = panel.querySelector('#vc-variants');
    const ui = UI();
    const escape = ui.escapeHtml || String;
    lastVariants = Array.isArray(variants) ? variants : [];
    if (!lastVariants.length) {
      box.innerHTML = '';
      return;
    }
    const titleHtml = ui.vpSectionTitleHtml
      ? ui.vpSectionTitleHtml('New alternatives')
      : '<div class="vp-section-title"><span>' + escape('New alternatives') + '</span></div>';
    box.innerHTML =
      '<div style="margin-bottom:8px;">' +
      titleHtml +
      '</div>' +
      lastVariants.map(function (v) {
        return renderVariantCard(v, ui);
      }).join('');

    markActiveVariantCard(activeVariantId);
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
    if (!sessionId) {
      const msg = 'Select a region and Ask Glean before using Copy';
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
    showToast('Building copy prompt…', 'info');
    setStatus('Building copy prompt…');
    try {
      const data = await postJson(
        '/api/copy-prompt',
        {
          sessionId: sessionId,
          variantId: variantId
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

    const elapsedSec = thinkingStartedAt
      ? Math.round((Date.now() - thinkingStartedAt) / 1000)
      : 0;
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

    // Silent stream / wait — Glean often sends no tokens for ~1 min; rotate by elapsed.
    if (stage === 'stream_wait' || stage === 'waiting' || progress.text === genericConnected) {
      if (elapsedSec < 15) {
        return progress.text || 'Connecting to live agent stream…';
      }
      if (elapsedSec < 35) return 'Agent is analyzing your copy…';
      if (elapsedSec < 60) return 'Agent is drafting alternatives…';
      if (elapsedSec < 90) return 'Agent is formatting options…';
      return 'Agent is finishing the response…';
    }

    if (progress.text) return String(progress.text);
    return 'Waiting on Glean…';
  }

  function renderThinking() {
    const el = panel.querySelector('#vc-thinking');
    if (!el || !gleanActiveEpoch) return;
    const progress = lastThinkingProgress || {};
    el.style.display = 'block';

    if (progress.live && progress.partial) {
      thinkingLivePartial = String(progress.partial);
    }

    const elapsed = thinkingElapsedLine();
    const displayLines = [];
    const partial = progress.partial || thinkingLivePartial;

    if (progress.live && partial) {
      const body = streamingBodyLines(partial, 3);
      if (body.length) {
        for (let i = 0; i < body.length; i++) displayLines.push(body[i]);
      } else {
        displayLines.push(resolveLatestThought(progress));
      }
    } else {
      displayLines.push(resolveLatestThought(progress));
      if (progress.detail && String(progress.detail).trim()) {
        displayLines.push(String(progress.detail).trim());
      }
    }

    displayLines.push(elapsed);

    el.style.whiteSpace = 'pre-wrap';
    el.style.overflow = 'hidden';
    el.style.textOverflow = '';
    el.style.maxHeight = 'min(6.5em, 96px)';
    el.style.lineHeight = '1.45';
    el.style.overflowY = 'auto';
    el.style.overflowX = 'hidden';
    el.style.fontFamily = progress.live && partial
      ? 'ui-monospace,SFMono-Regular,Menlo,monospace'
      : '';
    el.textContent = displayLines.join('\n');
    el.scrollTop = el.scrollHeight;

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
      if (!gleanActiveEpoch) return;
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

  function hideThinking() {
    const el = panel.querySelector('#vc-thinking');
    if (el) {
      el.style.display = 'none';
      el.textContent = '';
      el.style.maxHeight = '';
      el.style.overflowY = '';
      el.style.overflowX = '';
      el.style.fontFamily = '';
    }
    stopThinkingClock();
  }

  async function requestGlean() {
    if (!sessionId) {
      const authed = await ensureTeamToken();
      if (!authed) {
        showTeamAuthUI('panel');
        setStatus('Paste your team token below, then click Save token');
        return;
      }
      await retryPendingSelection();
      if (!sessionId) return;
    }
    const companionOk =
      typeof window.__crankProbeCompanion === 'function'
        ? await window.__crankProbeCompanion()
        : window.__CRANK_COMPANION_ONLINE__ !== false;
    if (!companionOk) {
      showCompanionOfflineUI();
      showToast('Companion offline — start it, then click Retry', 'error');
      return;
    }
    if (gleanActiveEpoch) {
      setStatus('Glean request already in progress…');
      return;
    }
    const epoch = ++gleanEpoch;
    gleanActiveEpoch = epoch;
    setStatus('Waiting on Glean…');
    startThinkingClock();
    showThinking({
      stage: 'stream_wait',
      text: 'Connecting to live agent stream…',
      detail: 'Robot Content Designer · usually 1–2 min',
      live: false
    });
    panel.querySelector('#vc-glean').disabled = true;
    let progressPoll = null;
    const pollProgress = async function () {
      if (gleanActiveEpoch !== epoch || !sessionId) return;
      try {
        const resp = await fetch(
          COMPANION_HTTP + '/api/glean-progress?sessionId=' + encodeURIComponent(sessionId),
          { cache: 'no-store', headers: authHeaders() }
        );
        const data = await resp.json();
        if (data.ok && data.progress && gleanActiveEpoch === epoch) {
          showThinking(data.progress);
        }
      } catch (_) {}
    };
    progressPoll = setInterval(pollProgress, 1000);
    pollProgress();
    // HTTP await is source of truth; WS + poll carry live GLEAN_PROGRESS.
    // Do not also send REQUEST_VARIANTS (would double-call Glean).
    try {
      const data = await postJson(
        '/api/variants',
        {
          sessionId: sessionId,
          optionCount: getGleanOptionCount(),
          options: { optionCount: getGleanOptionCount() }
        },
        { timeoutMs: GLEAN_VARIANTS_TIMEOUT_MS }
      );
      if (gleanActiveEpoch !== epoch) return;
      if (!data.ok) throw new Error(data.error || 'Glean failed');
      gleanActiveEpoch = 0;
      hideThinking();
      const variants = data.variants || (data.session && data.session.variants) || [];
      renderVariants(variants);
      setStatus('Glean returned ' + variants.length + ' options');
    } catch (err) {
      if (gleanActiveEpoch !== epoch) return;
      gleanActiveEpoch = 0;
      hideThinking();
      setStatus('Glean error: ' + err.message);
    } finally {
      if (progressPoll) clearInterval(progressPoll);
      if (gleanActiveEpoch === epoch) gleanActiveEpoch = 0;
      panel.querySelector('#vc-glean').disabled = !sessionId;
    }
  }

  function onMove(ev) {
    if (!selecting) return;
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!el || isCrankChrome(el)) return;
    const target = el.closest('div') || el;
    const r = target.getBoundingClientRect();
    highlight.style.left = r.left + 'px';
    highlight.style.top = r.top + 'px';
    highlight.style.width = r.width + 'px';
    highlight.style.height = r.height + 'px';
  }

  async function onClick(ev) {
    if (!selecting) return;
    ev.preventDefault();
    ev.stopPropagation();
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!el || isCrankChrome(el)) return;
    const target = el.closest('div') || el;
    stopSelect();
    selectedEl = target;
    selectedNodes = extractTextNodes(target);
    originalSnapshot = selectedNodes.map(function (n) {
      return Object.assign({}, n, {
        text: n.text,
        previousText: n.text,
        originalText: n.originalText != null ? n.originalText : n.text
      });
    });
    selectedNodes = selectedNodes.map(function (n) {
      return Object.assign({}, n, {
        originalText: n.originalText != null ? n.originalText : n.text
      });
    });
    openPanelAfterSelection();
    renderNodes();
    const payload = {
      origin: location.origin,
      pageUrl: location.href,
      selector: cssPath(target),
      tagName: target.tagName.toLowerCase(),
      nodes: selectedNodes,
      combinedText: selectedNodes.map(function (n) {
        return n.text;
      }).join('\n'),
      meta: {
        pathHints: pathHintsFromLocation()
      }
    };
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
    setStatus('Hover a layout, click to select · Esc cancels');
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
    if (fab && fab.parentNode) fab.remove();
    fab = null;
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
