/**
 * Text source classification — Crank bookmarklet classifyTextSource.
 * Hardcoded / static labels are editable; dynamic/bound data is locked.
 */
(function (root) {
  'use strict';

  function normalizeTextForCompare(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function looksLikeDataValue(text) {
    const value = String(text || '').trim();
    if (!value) return false;
    if (/^[\d,.$%+-]+$/.test(value)) return true;
    if (/\b\d{4}-\d{2}-\d{2}\b/.test(value) || /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(value)) return true;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return true;
    if (/^https?:\/\//i.test(value)) return true;
    if (/^[A-Z]{2,}-\d{2,}$/.test(value) || /^#?[A-F0-9]{8,}$/i.test(value)) return true;
    return false;
  }

  function looksLikeStaticLabel(text) {
    const value = String(text || '').trim();
    if (!value) return false;
    const normalized = value
      .replace(/^[\[\(\{<\s]+/, '')
      .replace(/[\]\)\}>\s]+$/, '')
      .replace(/[.:;!?]+$/, '')
      .trim();
    const candidate = normalized || value;
    if (candidate.length > 40) return false;
    if (looksLikeDataValue(candidate)) return false;
    if (/^[A-Z0-9_\-.]+$/.test(candidate) && candidate.length <= 6) return false;
    return /[A-Za-z]/.test(candidate);
  }

  function getDisplayNameFromFiber(fiber) {
    if (!fiber) return '';
    try {
      const t = fiber.type || fiber.elementType;
      if (!t) return '';
      if (typeof t === 'string') return t;
      if (typeof t.displayName === 'string' && t.displayName) return t.displayName;
      if (typeof t.name === 'string' && t.name) return t.name;
    } catch (_err) {}
    return '';
  }

  function findReactFiber(element) {
    if (!element) return null;
    const keys = Object.keys(element);
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].indexOf('__reactFiber$') === 0 || keys[i].indexOf('__reactInternalInstance$') === 0) {
        return element[keys[i]];
      }
    }
    return null;
  }

  function getNearestComponentFiber(element) {
    let fiber = findReactFiber(element);
    let hops = 0;
    while (fiber && hops < 24) {
      const name = getDisplayNameFromFiber(fiber);
      if (name && name[0] && name[0] === name[0].toUpperCase() && name.indexOf('http') !== 0) {
        return fiber;
      }
      fiber = fiber.return || null;
      hops += 1;
    }
    return findReactFiber(element);
  }

  function getMatchingComponentTextProps(componentFiber, text) {
    const startFiber = componentFiber || null;
    if (!startFiber) return [];

    const textNorm = normalizeTextForCompare(text);
    if (!textNorm) return [];

    const maxFiberHops = looksLikeStaticLabel(textNorm) ? 2 : 8;
    const matches = [];
    const seen = {};

    function visit(value, keyPath, depth) {
      if (depth > 3 || value === null || value === undefined) return;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        const str = normalizeTextForCompare(String(value));
        if (!str) return;
        const exactMatch = str === textNorm;
        const allowContainment = textNorm.length >= 24 && str.length >= 24;
        const containmentMatch =
          allowContainment && (textNorm.indexOf(str) !== -1 || str.indexOf(textNorm) !== -1);
        if (exactMatch || containmentMatch) {
          const key = String(keyPath || '').trim() || 'value';
          if (!seen[key]) {
            seen[key] = true;
            matches.push({ key: key, value: String(value) });
          }
        }
        return;
      }
      if (Array.isArray(value)) {
        value.slice(0, 8).forEach(function (item, index) {
          visit(item, keyPath + '[' + index + ']', depth + 1);
        });
        return;
      }
      if (typeof value === 'object') {
        Object.keys(value).slice(0, 20).forEach(function (key) {
          if (/^(children|className|style|ref|key|on[A-Z])/.test(key)) return;
          visit(value[key], keyPath ? keyPath + '.' + key : key, depth + 1);
        });
      }
    }

    let cursor = startFiber;
    let hops = 0;
    while (cursor && hops < maxFiberHops) {
      const props =
        cursor && (cursor.memoizedProps || cursor.pendingProps)
          ? cursor.memoizedProps || cursor.pendingProps
          : null;
      if (props && typeof props === 'object') {
        const ownerName = getDisplayNameFromFiber(cursor) || 'Component';
        Object.keys(props).forEach(function (key) {
          if (/^(children|className|style|ref|key|on[A-Z])/.test(key)) return;
          visit(props[key], ownerName + '.' + key, 0);
        });
      }
      cursor = cursor.return || null;
      hops += 1;
    }
    return matches;
  }

  function classifyTextSource(element, textOverride) {
    const text = String(
      textOverride != null ? textOverride : (element && element.textContent) || ''
    )
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) {
      return {
        type: 'unknown',
        label: 'No editable text detected',
        editable: false,
        reason: 'Selected node has no direct text target to edit.'
      };
    }

    const componentFiber = getNearestComponentFiber(element);
    const matchedProps = getMatchingComponentTextProps(componentFiber, text);

    if (matchedProps.length) {
      const dataLikeText = looksLikeDataValue(text);
      const hasStaticLabelPattern = looksLikeStaticLabel(text);
      const dataKeyMatches = matchedProps.filter(function (entry) {
        return /(id|uuid|code|vin|plate|license|count|qty|amount|total|price|cost|date|time|email|phone|created|updated|api|data|record|order|row|item|entity|seed|metric|score|value|number)/i.test(
          entry.key
        );
      }).length;
      const labelKeyMatches = matchedProps.filter(function (entry) {
        return /(label|title|text|heading|caption|placeholder|button|cta|copy|tab|menu|nav|section|subtitle|description)/i.test(
          entry.key
        );
      }).length;

      let dynamicScore = 0;
      let staticScore = 0;
      if (dataLikeText) dynamicScore += 3;
      if (hasStaticLabelPattern) staticScore += 2;
      dynamicScore += Math.min(3, dataKeyMatches);
      staticScore += Math.min(3, labelKeyMatches);
      if (matchedProps.length >= 3 && dataKeyMatches >= 2) dynamicScore += 1;
      if (matchedProps.length === 1 && labelKeyMatches > 0) staticScore += 1;
      if (hasStaticLabelPattern && !dataLikeText && dataKeyMatches === 0 && matchedProps.length <= 2) {
        staticScore += 2;
      }
      if (text.length <= 20 && !dataLikeText) staticScore += 1;

      if (dynamicScore >= 4 && dynamicScore >= staticScore + 1) {
        return {
          type: 'dynamic-data',
          label: 'Dynamic data (bound via props)',
          editable: false,
          reason: 'This text matches component data props and is likely API/seeder driven.',
          matchedProps: matchedProps
        };
      }
      if (staticScore >= 4 && staticScore >= dynamicScore + 1) {
        return {
          type: 'static-label',
          label: 'Static label (high confidence)',
          editable: true,
          reason: 'Signals strongly indicate this is UI copy/label text defined in frontend source.',
          matchedProps: matchedProps
        };
      }
      return {
        type: 'bound-unknown',
        label: 'Bound text (needs confirmation)',
        editable: false,
        reason:
          'Text is prop-bound but confidence is mixed. Confirm in component source before enabling edits.',
        matchedProps: matchedProps
      };
    }

    if (looksLikeDataValue(text)) {
      return {
        type: 'dynamic-data',
        label: 'Dynamic data pattern',
        editable: false,
        reason: 'Looks like runtime data (number/date/email/url/id) rather than fixed label copy.'
      };
    }

    return {
      type: 'static-label',
      label: 'Static/default label',
      editable: true,
      reason: 'No runtime data binding detected for this text.'
    };
  }

  root.CrankTextSource = {
    classifyTextSource: classifyTextSource,
    looksLikeDataValue: looksLikeDataValue,
    looksLikeStaticLabel: looksLikeStaticLabel,
    getNearestComponentFiber: getNearestComponentFiber,
    getDisplayNameFromFiber: getDisplayNameFromFiber
  };
})(typeof window !== 'undefined' ? window : globalThis);
