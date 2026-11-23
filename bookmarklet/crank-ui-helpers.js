/**
 * Crank UI helpers — tool-ui InputField / Button markup helpers.
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

  /* Crank UI markup helpers — mirrors tool-ui InputField / Button structure */

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
    return '<svg class="vp-field-select-chevron" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4.43057 8.5119C4.70014 8.19741 5.17361 8.16099 5.48811 8.43056L12 14.0122L18.5119 8.43056C18.8264 8.16099 19.2999 8.19741 19.5695 8.51191C19.839 8.8264 19.8026 9.29987 19.4881 9.56944L12.4881 15.5694C12.2072 15.8102 11.7928 15.8102 11.5119 15.5694L4.51192 9.56944C4.19743 9.29987 4.161 8.8264 4.43057 8.5119Z" fill="currentColor"/></svg>';
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
    const mark = opts.required
      ? '<span class="vp-required-mark" aria-hidden="true">*</span>'
      : '';
    return '<span class="vp-field-label-grid ' + sizeClass + ' vp-compact-control-typography">'
      + '<span class="vp-field-label-reserve" aria-hidden="true">' + escapeHtml(text + (opts.required ? ' *' : '')) + '</span>'
      + '<span class="vp-field-label-visible">' + escapeHtml(text) + mark + '</span>'
      + '</span>';
  }

  function vpFieldHtml(label, controlHtml, options) {
    const opts = options || {};
    const labelHtml = vpFieldLabelHtml(label, opts);
    const layoutClass = opts.layout === 'inline' ? ' vp-field--inline' : '';
    const extraClass = opts.className ? ' ' + opts.className : '';
    const metaHtml = opts.metaHtml ? '<div class="vp-field-meta">' + opts.metaHtml + '</div>' : '';
    return '<div class="vp-field' + layoutClass + extraClass + '">'
      + labelHtml
      + (controlHtml || '')
      + metaHtml
      + '<p class="vp-field-error crank-hidden" role="alert"></p>'
      + '</div>';
  }

  function vpOptionalFieldHtml(label, controlHtml, options) {
    const opts = options || {};
    const fieldId = String(opts.fieldId || '');
    const extraClass = opts.className ? ' ' + opts.className : '';
    const metaHtml = opts.metaHtml ? '<div class="vp-field-meta">' + opts.metaHtml + '</div>' : '';
    const labelHtml = vpFieldLabelHtml(label, opts);
    return (
      '<div class="vp-field vp-field--optional' + extraClass + '" data-optional-field="' + escapeAttr(fieldId) + '">'
      + '<div class="vp-field-optional-head">'
      + '<button type="button" class="vp-field-optional-toggle" aria-expanded="false"'
      + ' data-optional-toggle="' + escapeAttr(fieldId) + '" data-optional-state="collapsed">'
      + '<span class="vp-field-optional-label">' + labelHtml + '</span>'
      + '</button>'
      + '</div>'
      + '<div class="vp-field-optional-body crank-hidden" data-optional-body="' + escapeAttr(fieldId) + '">'
      + (controlHtml || '')
      + metaHtml
      + '</div>'
      + '<p class="vp-field-error crank-hidden" role="alert"></p>'
      + '</div>'
    );
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
        + (isChecked ? '<svg class="vp-menu-item__check" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.4697 6.46973C18.7626 6.17684 19.2373 6.17684 19.5302 6.46973C19.8231 6.76262 19.8231 7.23738 19.5302 7.53028L9.53022 17.5303C9.23732 17.8232 8.76256 17.8232 8.46967 17.5303L4.46967 13.5303C4.17678 13.2374 4.17678 12.7626 4.46967 12.4697C4.76256 12.1768 5.23732 12.1768 5.53022 12.4697L8.99994 15.9395L18.4697 6.46973Z" fill="currentColor"/></svg>' : '')
        + '</button>';
    }).join('');
    const triggerLabel = escapeHtml(selectedLabel);
    const widthStyle = opts.width ? ' style="width:' + escapeAttr(String(opts.width)) + ';"' : ' style="width:100%;"';
    return '<div class="vp-field-select"' + widthStyle + '>'
      + '<input' + vpBuildTagAttrs(hiddenAttrs) + ' />'
      + '<div class="vp-input-surface vp-control-surface ' + shellClass + '" data-crank-part="control-surface" style="width:100%;">'
      + '<button type="button" class="vp-field-select-trigger ' + typeClass + '" aria-haspopup="listbox" aria-expanded="false">'
      + '<span class="vp-field-select-label">' + triggerLabel + '</span>'
      + vpChevronSvgHtml()
      + '</button>'
      + '</div>'
      + '<div class="vp-dropdown-menu crank-hidden" role="menu">' + menuItems + '</div>'
      + '</div>';
  }

  function vpSelectHtml(attrs, optionsHtml, options) {
    return vpFieldSelectHtml(attrs, optionsHtml, options);
  }

  function vpFieldStaticTextHtml(attrs, content, options) {
    const opts = options || {};
    const size = opts.size === 'compact' ? 'compact' : 'default';
    const shellClass = vpShellSizeClass(size);
    const typeClass = size === 'compact' ? 'vp-compact-control-typography' : 'vp-control-typography';
    const id = attrs && attrs.id ? String(attrs.id) : '';
    const placeholder =
      attrs && attrs.placeholder != null ? String(attrs.placeholder) : 'Select text on the page or add manually';
    const text = String(content || '');
    const isEmpty = !text.trim();
    const displayText = isEmpty ? placeholder : text;
    const hiddenAttrs = {
      id: id,
      class: 'vp-field-static-value crank-hidden',
      'aria-hidden': 'true',
      tabindex: '-1',
      rows: '1'
    };
    const displayCls = vpJoinClasses(
      'vp-field-static-display',
      typeClass,
      isEmpty ? 'is-placeholder' : ''
    );
    return (
      '<div class="vp-field-static-text"' + (id ? ' data-static-field="' + escapeAttr(id) + '"' : '') + '>'
      + '<textarea' + vpBuildTagAttrs(hiddenAttrs) + '>' + escapeHtml(text) + '</textarea>'
      + '<div class="vp-input-surface vp-input-surface--static vp-control-surface ' + shellClass + '" data-crank-part="control-surface" style="width:100%;">'
      + '<div class="' + displayCls + '"' + (id ? ' data-strings-display="' + escapeAttr(id) + '"' : '') + ' aria-live="polite">'
      + escapeHtml(displayText)
      + '</div></div></div>'
    );
  }

  function vpTextareaHtml(attrs, content, options) {
    const opts = options || {};
    const size = opts.size === 'compact' ? 'compact' : 'default';
    const typeClass = size === 'compact' ? 'vp-compact-control-typography' : 'vp-control-typography';
    const areaAttrs = Object.assign({}, attrs || {}, {
      class: vpJoinClasses('vp-textarea-native', typeClass, opts.autogrow ? 'vp-textarea-autogrow' : '', attrs && attrs.class),
      rows: attrs && attrs.rows != null ? attrs.rows : opts.autogrow ? '1' : attrs && attrs.rows
    });
    const shellClass = vpShellSizeClass(size);
    const paragraphClass = opts.paragraph || opts.autogrow ? ' vp-input-surface--paragraph' : '';
    return '<div class="vp-input-surface vp-input-surface--textarea' + paragraphClass + ' vp-control-surface ' + shellClass + '" data-crank-part="control-surface" style="width:100%;">'
      + '<textarea' + vpBuildTagAttrs(areaAttrs) + '>' + escapeHtml(content || '') + '</textarea>'
      + '</div>';
  }

  /** Canonical multiline copy field — autogrow paragraph shell (Glean + edit targets). */
  function vpParagraphFieldHtml(attrs, content, options) {
    const opts = Object.assign({ autogrow: true, paragraph: true, size: 'default' }, options || {});
    return vpTextareaHtml(attrs, content, opts);
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
    return '<div class="vp-panel-stroke" role="separator"></div>';
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
    vpFieldStaticTextHtml: vpFieldStaticTextHtml,
    vpOptionalFieldHtml: vpOptionalFieldHtml,
    vpFieldLabelHtml: vpFieldLabelHtml,
    vpInputHtml: vpInputHtml,
    vpTextareaHtml: vpTextareaHtml,
    vpParagraphFieldHtml: vpParagraphFieldHtml,
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
