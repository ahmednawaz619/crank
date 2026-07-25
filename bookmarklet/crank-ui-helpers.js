/**
 * Crank UI helpers — reused from Vizpatch tool-ui / vizpatch-ui-helpers.
 */
(function (root) {
  'use strict';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/\n/g, ' ');
  }

  /* VizPatch UI markup helpers — mirrors tool-ui InputField / Button structure */

  function vpJoinClasses() {
    const parts = [];
    for (let i = 0; i < arguments.length; i++) {
      const value = arguments[i];
      if (value) {
        parts.push(String(value));
      }
    }
    return parts.join(' ');
  }

  function vpShellSizeClass(size) {
    return size === 'compact'
      ? 'vp-compact-control-shell vp-compact-control-typography'
      : 'vp-control-shell vp-control-typography';
  }

  function vpBuildTagAttrs(attrs) {
    if (!attrs || typeof attrs !== 'object') {
      return '';
    }
    let html = '';
    Object.keys(attrs).forEach((key) => {
      const value = attrs[key];
      if (value === undefined || value === null || value === false) {
        return;
      }
      if (value === true) {
        html += ' ' + key;
        return;
      }
      html += ' ' + key + '="' + escapeAttr(String(value)) + '"';
    });
    return html;
  }

  function vpInputSurface(attrs, innerHtml, options) {
    const opts = options || {};
    const size = opts.size === 'compact' ? 'compact' : 'default';
    const shellClass = vpShellSizeClass(size);
    const widthClass = opts.width ? '' : ' style="width:100%;"';
    const widthStyle = opts.width ? ' style="width:' + escapeAttr(String(opts.width)) + ';"' : widthClass;
    const extraClass = opts.className ? ' ' + opts.className : '';
    const fixedClass = opts.width ? ' vp-input-surface--fixed' : '';
    const disabledClass = attrs && attrs.disabled ? ' vp-input-surface-disabled' : '';
    return '<div class="vp-input-surface vp-control-surface' + fixedClass + disabledClass + ' ' + shellClass + extraClass + '"' + widthStyle + '>'
      + innerHtml
      + '</div>';
  }

  function vpInputHtml(attrs, options) {
    const opts = options || {};
    const size = opts.size === 'compact' ? 'compact' : 'default';
    const typeClass = size === 'compact' ? 'vp-compact-control-typography' : 'vp-control-typography';
    const inputAttrs = Object.assign({}, attrs || {}, { class: vpJoinClasses('vp-input-native', typeClass, attrs && attrs.class) });
    return vpInputSurface(attrs, '<input' + vpBuildTagAttrs(inputAttrs) + ' />', opts);
  }

  function vpChevronSvgHtml() {
    return '<svg class="vp-field-select-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  }

  function vpParseSelectOptions(optionsHtml) {
    const options = [];
    const pattern = /<option([^>]*)>([\s\S]*?)<\/option>/gi;
    let match = pattern.exec(optionsHtml || '');
    while (match) {
      const attrStr = match[1] || '';
      const label = match[2] || '';
      const valueMatch = attrStr.match(/value="([^"]*)"/i);
      const value = valueMatch ? valueMatch[1] : label;
      options.push({
        value: value,
        label: label,
        selected: /\bselected\b/i.test(attrStr),
        disabled: /\bdisabled\b/i.test(attrStr)
      });
      match = pattern.exec(optionsHtml || '');
    }
    return options;
  }

  function vpNormalizeSelectOptions(optionList, optionsHtml) {
    if (Array.isArray(optionList) && optionList.length) {
      return optionList.map(function (entry) {
        return {
          value: String(entry.value != null ? entry.value : ''),
          label: String(entry.label != null ? entry.label : entry.value != null ? entry.value : ''),
          selected: !!entry.selected,
          disabled: !!entry.disabled
        };
      });
    }
    return vpParseSelectOptions(optionsHtml || '');
  }

  function vpFieldLabelHtml(label, options) {
    const opts = options || {};
    const size = opts.size === 'compact' ? 'compact' : 'default';
    const sizeClass = size === 'compact' ? 'vp-field-label-grid--compact' : 'vp-field-label-grid--default';
    const text = String(label || '');
    if (!text || opts.hideLabel) {
      return '';
    }
    return '<span class="vp-field-label-grid ' + sizeClass + ' vp-compact-control-typography">'
      + '<span class="vp-field-label-reserve" aria-hidden="true">' + escapeHtml(text) + '</span>'
      + '<span class="vp-field-label-visible">' + escapeHtml(text) + '</span>'
      + '</span>';
  }

  function vpFieldHtml(label, controlHtml, options) {
    const opts = options || {};
    const labelHtml = vpFieldLabelHtml(label, opts);
    const extraClass = opts.className ? ' ' + opts.className : '';
    const metaHtml = opts.metaHtml ? '<div class="vp-field-meta">' + opts.metaHtml + '</div>' : '';
    return '<div class="vp-field' + extraClass + '">'
      + labelHtml
      + (controlHtml || '')
      + metaHtml
      + '</div>';
  }

  function vpFieldSelectHtml(attrs, optionsHtml, options) {
    const opts = options || {};
    const size = opts.size === 'compact' ? 'compact' : 'default';
    const shellClass = vpShellSizeClass(size);
    const typeClass = size === 'compact' ? 'vp-compact-control-typography' : 'vp-control-typography';
    const optionEntries = vpNormalizeSelectOptions(opts.options, optionsHtml);
    let selectedValue = attrs && attrs.value != null ? String(attrs.value) : '';
    if (!selectedValue) {
      const selectedEntry = optionEntries.find(function (entry) { return entry.selected; });
      if (selectedEntry) {
        selectedValue = selectedEntry.value;
      } else if (optionEntries.length) {
        selectedValue = optionEntries[0].value;
      }
    }
    const selectedEntry = optionEntries.find(function (entry) {
      return entry.value === selectedValue;
    }) || optionEntries[0];
    const selectedLabel = selectedEntry ? selectedEntry.label : (opts.placeholder || 'Select');
    const hiddenAttrs = Object.assign({}, attrs || {}, {
      type: 'hidden',
      class: 'vp-field-select-value',
      value: selectedValue
    });
    const menuItems = optionEntries.map(function (entry) {
      const isChecked = entry.value === selectedValue;
      return '<button type="button" class="vp-menu-item' + (isChecked ? ' is-checked' : '') + '" role="menuitemradio" aria-checked="' + (isChecked ? 'true' : 'false') + '" data-value="' + escapeAttr(entry.value) + '"' + (entry.disabled ? ' disabled' : '') + '>'
        + '<span class="vp-menu-item__label">' + escapeHtml(entry.label) + '</span>'
        + (isChecked ? '<svg class="vp-menu-item__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12L9 17L20 6"/></svg>' : '')
        + '</button>';
    }).join('');
    const triggerLabel = escapeHtml(selectedLabel);
    const widthStyle = opts.width ? ' style="width:' + escapeAttr(String(opts.width)) + ';"' : ' style="width:100%;"';
    return '<div class="vp-field-select"' + widthStyle + '>'
      + '<input' + vpBuildTagAttrs(hiddenAttrs) + ' />'
      + '<div class="vp-input-surface vp-control-surface ' + shellClass + '" data-vizpatch-part="control-surface" style="width:100%;">'
      + '<button type="button" class="vp-field-select-trigger ' + typeClass + '" aria-haspopup="listbox" aria-expanded="false">'
      + '<span class="vp-field-select-label">' + triggerLabel + '</span>'
      + vpChevronSvgHtml()
      + '</button>'
      + '</div>'
      + '<div class="vp-dropdown-menu vizpatch-hidden" role="menu">' + menuItems + '</div>'
      + '</div>';
  }

  function vpSelectHtml(attrs, optionsHtml, options) {
    return vpFieldSelectHtml(attrs, optionsHtml, options);
  }

  function vpTextareaHtml(attrs, content, options) {
    const opts = options || {};
    const size = opts.size === 'compact' ? 'compact' : 'default';
    const typeClass = size === 'compact' ? 'vp-compact-control-typography' : 'vp-control-typography';
    const areaAttrs = Object.assign({}, attrs || {}, { class: vpJoinClasses('vp-textarea-native', typeClass, attrs && attrs.class) });
    const shellClass = vpShellSizeClass(size);
    return '<div class="vp-input-surface vp-input-surface--textarea vp-control-surface ' + shellClass + '" data-vizpatch-part="control-surface" style="width:100%;">'
      + '<textarea' + vpBuildTagAttrs(areaAttrs) + '>' + escapeHtml(content || '') + '</textarea>'
      + '</div>';
  }

  function vpButtonShellClasses(variant, size) {
    const isCompact = size === 'compact';
    const shellClass = isCompact ? 'vp-compact-control-shell' : 'vp-control-shell';
    const typeClass = isCompact ? 'vp-compact-control-typography' : 'vp-control-typography';
    return vpJoinClasses(shellClass, typeClass);
  }

  function vpButtonHtml(variant, label, attrs, options) {
    const opts = options || {};
    const size = opts.size === 'compact' ? 'compact' : 'default';
    let surfaceClass = 'vp-button-secondary-surface';
    if (variant === 'primary') {
      surfaceClass = 'vp-button-primary-surface';
    } else if (variant === 'ghost') {
      surfaceClass = 'vp-button-ghost-surface';
    }
    const iconClass = opts.icon ? ' vp-btn-icon' : '';
    const activeClass = opts.active ? ' is-active' : '';
    const surfaceControlClass = variant === 'ghost' ? '' : 'vp-button-surface-control';
    const buttonAttrs = Object.assign({}, attrs || {}, {
      type: (attrs && attrs.type) || 'button',
      class: vpJoinClasses(
        surfaceClass,
        surfaceControlClass,
        vpButtonShellClasses(variant, size),
        iconClass,
        activeClass,
        opts.className,
        attrs && attrs.class
      )
    });
    const style = opts.flex ? ' style="flex:1;min-width:0;"' : '';
    return '<button' + vpBuildTagAttrs(buttonAttrs) + style + '>' + (label || '') + '</button>';
  }

  function vpButtonGroupHtml(buttonsHtml, options) {
    const opts = options || {};
    const groupClass = vpJoinClasses(
      'vp-button-group',
      opts.stretch ? 'vp-button-group--stretch' : '',
      opts.className
    );
    return '<div class="' + groupClass + '">' + (buttonsHtml || '') + '</div>';
  }

  function vpTabLabelHtml(label, active) {
    const text = String(label || '');
    const activeClass = active ? ' is-active' : '';
    return '<span class="vp-tab-label-grid vp-type-support">'
      + '<span class="vp-tab-label-reserve" aria-hidden="true">' + escapeHtml(text) + '</span>'
      + '<span class="vp-tab-label-visible' + activeClass + '">' + escapeHtml(text) + '</span>'
      + '</span>';
  }

  function vpTabsHtml(tabs) {
    const items = (tabs || []).map((tab, index) => {
      const active = !!tab.active;
      const activeClass = active ? ' is-active' : '';
      const attrs = Object.assign({}, tab.attrs || {}, {
        type: 'button',
        role: 'tab',
        class: 'vp-tab' + activeClass,
        id: tab.id,
        'aria-selected': active ? 'true' : 'false',
        'data-proximity-index': String(index)
      });
      return '<button' + vpBuildTagAttrs(attrs) + '>' + vpTabLabelHtml(tab.label || '', active) + '</button>';
    }).join('');
    return '<div class="vp-tabs vp-control-surface vp-list-surface" role="tablist">'
      + '<div class="vp-tab-indicator vp-tab-indicator--selected vp-control-surface-overlay" aria-hidden="true"></div>'
      + '<div class="vp-tab-indicator vp-tab-indicator--hover vp-control-surface-overlay" aria-hidden="true"></div>'
      + items
      + '</div>';
  }

  function vpChipHtml(text) {
    return '<span class="vp-chip">' + escapeHtml(text || '') + '</span>';
  }

  function vpCapabilityBadgeHtml(mode, text) {
    const cls = mode === 'editable'
      ? 'vp-cap-badge vp-cap-badge--editable'
      : mode === 'read-only'
        ? 'vp-cap-badge vp-cap-badge--readonly'
        : 'vp-cap-badge vp-cap-badge--preview';
    return '<span class="' + cls + '">' + escapeHtml(text || '') + '</span>';
  }

  function vpCapabilityLabel(mode) {
    if (mode === 'editable') {
      return 'Can save';
    }
    if (mode === 'read-only') {
      return 'Read only';
    }
    return 'Preview only';
  }

  function vpSegmentButtonHtml(label, attrs, selected, compact) {
    const buttonAttrs = Object.assign({}, attrs || {}, {
      type: 'button',
      class: vpJoinClasses(
        'vp-segment-btn',
        compact ? 'vp-segment-btn--compact' : '',
        selected ? 'is-selected' : '',
        attrs && attrs.class
      )
    });
    return '<button' + vpBuildTagAttrs(buttonAttrs) + '>' + label + '</button>';
  }

  function vpErrorBannerHtml(message) {
    return '<div class="vp-banner vp-banner--error vp-type-support">' + escapeHtml(message || '') + '</div>';
  }

  function vpDividerHtml() {
    return '<div class="vp-divider"></div>';
  }

  function vpSectionTitleHtml(text) {
    return '<div class="vp-section-title"><span>' + escapeHtml(text || '') + '</span></div>';
  }

  function vpListButtonHtml(innerHtml, attrs) {
    const buttonAttrs = Object.assign({}, attrs || {}, {
      type: 'button',
      class: vpJoinClasses('vp-list-button', attrs && attrs.class)
    });
    return '<button' + vpBuildTagAttrs(buttonAttrs) + '>' + innerHtml + '</button>';
  }


  root.CrankUI = {
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr,
    vpFieldHtml: vpFieldHtml,
    vpFieldLabelHtml: vpFieldLabelHtml,
    vpInputHtml: vpInputHtml,
    vpTextareaHtml: vpTextareaHtml,
    vpButtonHtml: vpButtonHtml,
    vpButtonGroupHtml: vpButtonGroupHtml,
    vpFieldSelectHtml: vpFieldSelectHtml,
    vpSelectHtml: vpSelectHtml,
    vpTabsHtml: vpTabsHtml,
    vpChipHtml: vpChipHtml,
    vpCapabilityBadgeHtml: vpCapabilityBadgeHtml,
    vpCapabilityLabel: vpCapabilityLabel,
    vpSectionTitleHtml: vpSectionTitleHtml,
    vpDividerHtml: vpDividerHtml,
    vpErrorBannerHtml: vpErrorBannerHtml
  };
})(typeof window !== 'undefined' ? window : globalThis);
