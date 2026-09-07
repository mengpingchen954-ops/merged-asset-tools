(function () {
  'use strict';
  const storageKey = 'cutframe:layout:v1';
  const modes = [...document.querySelectorAll('.mode-button')].map(el => el.dataset.mode);
  const originals = Object.fromEntries(modes.map(mode => {
    const button = document.querySelector(`.mode-button[data-mode="${mode}"]`);
    return [mode, { name: button.querySelector('strong').textContent, note: button.querySelector('small').textContent }];
  }));
  const brandDefault = document.querySelector('.brand-name').textContent;
  const records = new Map();
  let editing = false;
  let saveTimer;
  let state = { version: 1, global: {}, tools: {} };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const currentMode = () => window.CutframeToolSuite.fromHash();
  function validate(raw) {
    if (!raw || raw.version !== 1 || typeof raw.global !== 'object' || !raw.global || typeof raw.tools !== 'object' || !raw.tools) throw new Error('配置格式不正确');
    const clean = { version: 1, global: {}, tools: {} };
    const number = (source, target, key, min, max) => { if (Number.isFinite(source[key])) target[key] = clamp(source[key], min, max); };
    number(raw.global, clean.global, 'rail', 200, 420);
    for (const key of ['accent', 'railColor']) if (/^#[0-9a-f]{6}$/i.test(raw.global[key])) clean.global[key] = raw.global[key];
    if (typeof raw.global.brand === 'string') clean.global.brand = raw.global.brand.slice(0, 24);
    for (const mode of modes) {
      const source = raw.tools[mode];
      if (!source || typeof source !== 'object') continue;
      const tool = clean.tools[mode] = {};
      number(source, tool, 'column', 220, 620);
      number(source, tool, 'upload', 220, 720);
      if (typeof source.name === 'string') tool.name = source.name.slice(0, 36);
      if (typeof source.note === 'string') tool.note = source.note.slice(0, 100);
    }
    return clean;
  }
  try { const saved = localStorage.getItem(storageKey); if (saved) state = validate(JSON.parse(saved)); } catch (_) { /* Invalid or unavailable storage keeps the default layout. */ }

  const toggle = document.createElement('button');
  toggle.id = 'layout-edit-toggle';
  toggle.className = 'icon-button';
  toggle.type = 'button';
  toggle.title = '编辑布局与外观';
  toggle.setAttribute('aria-label', '编辑布局与外观');
  toggle.setAttribute('aria-pressed', 'false');
  toggle.setAttribute('aria-controls', 'layout-editor');
  toggle.innerHTML = '<i data-lucide="sliders-horizontal"></i>';
  document.querySelector('.header-actions').prepend(toggle);
  const editor = document.createElement('aside');
  editor.id = 'layout-editor';
  editor.className = 'layout-editor';
  editor.hidden = true;
  editor.setAttribute('aria-label', '编辑布局与外观');
  editor.innerHTML = `
    <header><h2>编辑布局与外观</h2><button class="layout-icon" id="layout-close" title="完成编辑" aria-label="完成编辑"><i data-lucide="check"></i></button></header>
    <div class="layout-editor-tabs" role="tablist"><button id="layout-tab-size" role="tab" aria-selected="true" aria-controls="layout-size">尺寸</button><button id="layout-tab-style" role="tab" aria-selected="false" aria-controls="layout-style">文字与颜色</button></div>
    <div class="layout-editor-body">
      <div id="layout-size" role="tabpanel" aria-labelledby="layout-tab-size">
        <fieldset><legend>全局</legend><label class="layout-field"><span>侧栏宽度 / px</span><input id="layout-rail-number" type="number" aria-label="侧栏宽度"><input id="layout-rail-range" type="range" aria-label="拖动调整侧栏宽度"></label></fieldset>
        <fieldset><legend class="layout-current-name"></legend><label class="layout-field"><span>参数栏宽度 / px</span><input id="layout-column-number" type="number" aria-label="参数栏宽度"><input id="layout-column-range" type="range" aria-label="拖动调整参数栏宽度"></label><label class="layout-field"><span>拖入区高度 / px</span><input id="layout-upload-number" type="number" aria-label="拖入区高度"><input id="layout-upload-range" type="range" aria-label="拖动调整拖入区高度"></label></fieldset>
      </div>
      <div id="layout-style" role="tabpanel" aria-labelledby="layout-tab-style" hidden>
        <fieldset><legend>全局</legend><label class="layout-text">品牌名称<input id="layout-brand" maxlength="24"></label><label class="layout-color">强调色<input id="layout-accent" type="color"></label><label class="layout-color">侧栏背景<input id="layout-rail-color" type="color"></label></fieldset>
        <fieldset><legend class="layout-current-name"></legend><label class="layout-text">工具名称<input id="layout-name" maxlength="36"></label><label class="layout-text">副标题<input id="layout-note" maxlength="100"></label></fieldset>
      </div>
    </div>
    <footer><span id="layout-save-status" role="status">保存在此浏览器</span><div><button id="layout-reset" class="layout-icon" title="恢复默认布局与外观" aria-label="恢复默认布局与外观"><i data-lucide="rotate-ccw"></i></button><button id="layout-import" class="layout-icon" title="导入配置" aria-label="导入配置"><i data-lucide="upload"></i></button><button id="layout-export" class="layout-icon" title="导出配置" aria-label="导出配置"><i data-lucide="download"></i></button></div><input id="layout-config-file" type="file" accept="application/json,.json" hidden></footer>`;
  document.body.append(editor);
  window.lucide?.createIcons({ nodes: [toggle, editor] });
  const $ = id => document.getElementById(id);
  const status = message => { $('layout-save-status').textContent = message; };
  function save() {
    clearTimeout(saveTimer);
    try { localStorage.setItem(storageKey, JSON.stringify(state)); status('已保存到此浏览器'); }
    catch (_) { status('无法保存，请导出配置'); }
  }
  function changed() { applyAll(); syncFields(); clearTimeout(saveTimer); saveTimer = setTimeout(save, 150); }
  const toolState = mode => state.tools[mode] || (state.tools[mode] = {});
  const rgb = hex => hex.slice(1).match(/../g).map(value => parseInt(value, 16));
  const mix = (hex, target, amount) => '#' + rgb(hex).map((value, i) => Math.round(value * (1 - amount) + rgb(target)[i] * amount).toString(16).padStart(2, '0')).join('');
  const dark = hex => {
    const [r, g, b] = rgb(hex).map(value => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; });
    return r * .2126 + g * .7152 + b * .0722 < .179;
  };
  function setText(node, text) { if (node && node.textContent !== text) node.textContent = text; }
  function setVariable(root, name, value) { if (value == null) root.style.removeProperty(name); else root.style.setProperty(name, value); }
  function applyGlobal() {
    const g = state.global;
    const root = document.documentElement;
    setVariable(root, '--rail-width', g.rail && innerWidth > 760 ? clamp(g.rail, 200, Math.min(420, innerWidth - 560)) + 'px' : null);
    document.body.toggleAttribute('data-layout-custom-accent', !!g.accent);
    setVariable(root, '--layout-accent-text', g.accent && dark(g.accent) ? '#ffffff' : '#111317');
    for (const [name, value] of Object.entries({ '--accent': g.accent, '--accent-hover': g.accent && mix(g.accent, '#000000', .08), '--accent-strong': g.accent && mix(g.accent, '#000000', .58), '--accent-soft': g.accent && mix(g.accent, '#ffffff', .85), '--accent-pale': g.accent && mix(g.accent, '#ffffff', .95) })) setVariable(root, name, value || null);
    document.body.toggleAttribute('data-layout-custom-colors', !!g.railColor);
    if (g.railColor) {
      const contrast = dark(g.railColor) ? '#ffffff' : '#111317';
      for (const [key, value] of Object.entries({ rail: g.railColor, 'rail-text': contrast, 'rail-muted': mix(g.railColor, contrast, .65), 'rail-panel': mix(g.railColor, contrast, .06), 'rail-active': mix(g.railColor, contrast, .12), 'rail-line': mix(g.railColor, contrast, .18) })) setVariable(root, '--layout-' + key, value);
    }
    setText(document.querySelector('.brand-name'), g.brand || brandDefault);
    for (const mode of modes) {
      const tool = state.tools[mode] || {};
      const button = document.querySelector(`.mode-button[data-mode="${mode}"]`);
      setText(button.querySelector('strong'), tool.name || originals[mode].name);
      setText(button.querySelector('small'), tool.note || originals[mode].note);
      setText(document.querySelector(`#mobile-tool-select option[value="${mode}"]`), tool.name || originals[mode].name);
    }
    const active = state.tools[currentMode()] || {};
    if (active.name) setText($('page-title'), active.name);
    if (active.note) setText($('page-description'), active.note);
  }
  function elements(doc, mode) {
    if (doc === document) {
      const scope = doc.querySelector(mode === 'image' ? '#image-studio' : '#video-studio');
      return { column: scope?.querySelector('.control-panel'), workspace: scope?.querySelector('.image-workspace, .studio') };
    }
    const column = doc.querySelector(mode === 'vfx' ? '.vfx-controls' : mode === 'gif' ? '.drop-panel' : mode === 'green-screen' ? '.inspector' : '.control-panel');
    const upload = doc.querySelector(mode === 'extractor' ? '#dropzone' : mode === 'vfx' ? '#vfxDropZone' : '.drop-zone');
    return { column, upload, workspace: doc.querySelector(mode === 'vfx' ? '.vfx-workspace' : '.workspace') };
  }
  function limits(key, doc = document, mode = currentMode()) {
    const nodes = elements(doc, mode);
    if (key === 'rail') return { min: 200, max: Math.max(200, Math.min(420, innerWidth - 560)), enabled: innerWidth > 760 && !document.body.classList.contains('sidebar-collapsed') };
    if (key === 'upload') return { min: mode === 'extractor' ? 280 : 220, max: 720, enabled: !!nodes.upload && !nodes.upload.hidden };
    const width = nodes.workspace?.getBoundingClientRect().width || 0;
    const breakpoint = doc === document || mode === 'gif' ? 760 : 900;
    const viewport = doc.defaultView.innerWidth;
    const reserve = doc === document ? (viewport > 1040 ? 700 : 400) : mode === 'cocos' ? 560 : mode === 'vfx' ? (viewport > 1100 ? 670 : 500) : mode === 'gif' ? (viewport >= 1300 ? 700 : 420) : 460;
    return { min: 220, max: Math.max(220, Math.min(620, width - reserve)), enabled: !!nodes.column && viewport > breakpoint };
  }
  function applyDocument(doc, mode) {
    const nodes = elements(doc, mode);
    const config = state.tools[mode] || {};
    doc.documentElement.toggleAttribute('data-layout-editing', editing);
    if (nodes.workspace) {
      const bound = limits('column', doc, mode);
      if (config.column && bound.enabled) {
        const size = clamp(config.column, bound.min, bound.max) + 'px';
        const width = doc.defaultView.innerWidth;
        const third = doc === document ? (width > 1040 ? (mode === 'image' ? ' 310px' : ' 300px') : '') : mode === 'gif' && width >= 1300 ? ' 280px' : '';
        nodes.workspace.style.gridTemplateColumns = mode === 'green-screen' ? `minmax(0, 1fr) ${size}` : `${size} minmax(0, 1fr)${third}`;
      } else nodes.workspace.style.removeProperty('grid-template-columns');
    }
    if (nodes.upload) {
      nodes.upload.style.transitionProperty = 'border-color, background-color';
      if (config.upload) {
        nodes.upload.style.minHeight = clamp(config.upload, limits('upload', doc, mode).min, 720) + 'px';
        nodes.upload.style.height = 'auto';
      } else { nodes.upload.style.removeProperty('min-height'); nodes.upload.style.removeProperty('height'); }
      if (mode === 'green-screen') nodes.upload.closest('.preview-panel').style.minHeight = config.upload ? '0px' : '';
    }
    if (doc !== document) {
      let theme = doc.getElementById('cutframe-user-theme');
      if (!theme) { theme = doc.createElement('style'); theme.id = 'cutframe-user-theme'; doc.head.append(theme); }
      const accent = state.global.accent;
      const css = accent ? `html[data-cutframe-tool] { --blue:${mix(accent, '#000000', .5)}; --blue-strong:${mix(accent, '#000000', .6)}; --blue-soft:${mix(accent, '#ffffff', .85)}; --accent:${accent}; --accent-strong:${mix(accent, '#000000', .6)}; --accent-soft:${mix(accent, '#ffffff', .85)}; } html[data-cutframe-tool] .primary-action,html[data-cutframe-tool] .export-button,html[data-cutframe-tool] .btn.primary,html[data-cutframe-tool] .brand-mark,html[data-cutframe-tool] .brandmark {background:${accent};border-color:${accent};color:${dark(accent) ? '#ffffff' : '#111317'};} html[data-cutframe-tool] .primary-action:hover:not(:disabled),html[data-cutframe-tool] .btn.primary:hover:not(:disabled){background:${mix(accent, '#000000', .1)};border-color:${accent};}` : '';
      if (theme.textContent !== css) theme.textContent = css;
      const record = records.get(mode);
      if (record?.title) setText(record.title, config.name || record.originalTitle);
    }
  }
  function activeDocument() { return records.get(currentMode())?.doc || document; }
  function measured(key, doc, mode) {
    const nodes = elements(doc, mode);
    if (key === 'rail') return document.querySelector('.tool-rail').getBoundingClientRect().width;
    return nodes[key]?.getBoundingClientRect()[key === 'upload' ? 'height' : 'width'] || 0;
  }
  function syncFields() {
    const mode = currentMode();
    const doc = activeDocument();
    for (const key of ['rail', 'column', 'upload']) {
      const bound = limits(key, doc, mode);
      const value = Math.round(measured(key, doc, mode));
      for (const kind of ['range', 'number']) {
        const input = $(`layout-${key}-${kind}`);
        input.min = bound.min; input.max = bound.max; input.step = 1; input.disabled = !bound.enabled;
        if (input !== document.activeElement) input.value = value || bound.min;
      }
    }
    const tool = state.tools[mode] || {};
    for (const [id, value] of Object.entries({ 'layout-brand': state.global.brand || brandDefault, 'layout-name': tool.name || originals[mode].name, 'layout-note': tool.note || originals[mode].note, 'layout-accent': state.global.accent || '#caff3d', 'layout-rail-color': state.global.railColor || '#101216' })) if ($(id) !== document.activeElement) $(id).value = value;
    editor.querySelectorAll('.layout-current-name').forEach(el => setText(el, tool.name || originals[mode].name));
  }
  function updateValue(key, value, doc, mode) {
    const bound = limits(key, doc, mode);
    if (!bound.enabled || !Number.isFinite(value)) return;
    (key === 'rail' ? state.global : toolState(mode))[key] = Math.round(clamp(value, bound.min, bound.max));
    changed();
  }
  function createHandles(doc, mode, keys) {
    const win = doc.defaultView;
    const handles = keys.map(key => {
      const node = doc.createElement('button');
      node.type = 'button'; node.className = 'layout-resize-handle'; node.dataset.axis = key === 'upload' ? 'y' : 'x'; node.dataset.resize = key;
      node.setAttribute('role', 'separator'); node.setAttribute('aria-orientation', key === 'upload' ? 'horizontal' : 'vertical');
      node.title = key === 'rail' ? '拖动调整侧栏宽度' : key === 'upload' ? '拖动调整拖入区高度' : '拖动调整参数栏宽度';
      node.setAttribute('aria-label', node.title);
      doc.body.append(node);
      let drag;
      node.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        drag = { position: key === 'upload' ? event.clientY : event.clientX, value: measured(key, doc, mode), previous: key === 'rail' ? state.global.rail : state.tools[mode]?.[key] };
        node.setPointerCapture(event.pointerId);
      });
      node.addEventListener('pointermove', event => {
        if (!drag) return;
        const delta = (key === 'upload' ? event.clientY : event.clientX) - drag.position;
        updateValue(key, drag.value + delta * (mode === 'green-screen' && key === 'column' ? -1 : 1), doc, mode);
      });
      node.addEventListener('lostpointercapture', () => { drag = null; save(); });
      node.addEventListener('pointerup', event => { if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId); });
      node.addEventListener('keydown', event => {
        const bound = limits(key, doc, mode);
        const delta = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 8 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -8 : 0;
        if (!delta && !['Home', 'End'].includes(event.key)) return;
        event.preventDefault(); updateValue(key, event.key === 'Home' ? bound.min : event.key === 'End' ? bound.max : measured(key, doc, mode) + delta, doc, mode);
      });
      return { key, node };
    });
    let scheduled;
    function position() {
      scheduled = null;
      for (const { key, node } of handles) {
        const target = key === 'rail' ? document.querySelector('.tool-rail') : elements(doc, mode)[key];
        const box = target?.getBoundingClientRect();
        const bound = limits(key, doc, mode);
        const active = doc !== document ? currentMode() === mode : key === 'rail' || currentMode() === mode;
        node.hidden = !editing || !active || !bound.enabled || !box?.width || !box?.height || box.bottom < 0 || box.top > win.innerHeight;
        if (node.hidden) continue;
        if (key === 'upload') {
          node.hidden = box.bottom > win.innerHeight;
          Object.assign(node.style, { left: box.left + 'px', top: box.bottom - 5 + 'px', width: box.width + 'px' });
        } else {
          const top = Math.max(0, box.top);
          Object.assign(node.style, { left: (mode === 'green-screen' && key === 'column' ? box.left : box.right) - 5 + 'px', top: top + 'px', height: Math.min(win.innerHeight - top, box.bottom - top) + 'px' });
        }
        node.setAttribute('aria-valuemin', bound.min); node.setAttribute('aria-valuemax', bound.max); node.setAttribute('aria-valuenow', Math.round(measured(key, doc, mode)));
      }
    }
    const schedule = () => { if (!scheduled) scheduled = win.requestAnimationFrame(position); };
    const observer = new win.ResizeObserver(schedule);
    for (const { key } of handles) { const target = key === 'rail' ? doc.querySelector('.tool-rail') : elements(doc, mode)[key]; if (target) observer.observe(target); }
    win.addEventListener('scroll', schedule, true);
    win.addEventListener('resize', schedule);
    return { update: schedule, dispose() { observer.disconnect(); win.removeEventListener('scroll', schedule, true); win.removeEventListener('resize', schedule); handles.forEach(({ node }) => node.remove()); } };
  }
  const mainHandles = [createHandles(document, 'image', ['rail', 'column']), createHandles(document, 'video', ['column'])];
  function applyAll() {
    applyGlobal();
    for (const mode of ['image', 'video']) applyDocument(document, mode);
    for (const [mode, record] of records) { applyDocument(record.doc, mode); record.handles.update(); }
    mainHandles.forEach(handles => handles.update());
  }
  function attachFrame(frame, mode) {
    const doc = frame.contentDocument;
    if (!doc?.body || doc.URL === 'about:blank') return;
    if (records.get(mode)?.doc === doc) { applyAll(); return; }
    records.get(mode)?.handles.dispose();
    const link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = new URL('./layout-editor.css?v=20260907-1', location.href).href; doc.head.append(link);
    const title = doc.querySelector(mode === 'vfx' ? '.vfx-toolbar h1' : '.toolbar h1, .app-header h1, .topbar .brand strong');
    const handles = createHandles(doc, mode, ['column', 'upload']);
    records.set(mode, { doc, title, originalTitle: title?.textContent, handles });
    doc.addEventListener('keydown', event => { if (event.key === 'Escape' && editing) setEditing(false); });
    doc.defaultView.addEventListener('resize', () => { applyDocument(doc, mode); handles.update(); if (currentMode() === mode) syncFields(); });
    applyAll(); syncFields();
  }
  function setEditing(value) {
    editing = value; editor.hidden = !value; toggle.setAttribute('aria-pressed', String(value)); document.body.classList.toggle('layout-editing', value);
    applyAll(); syncFields(); if (!value) { save(); toggle.focus(); }
  }
  toggle.addEventListener('click', () => setEditing(!editing));
  $('layout-close').addEventListener('click', () => setEditing(false));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && editing) setEditing(false); });
  for (const tab of ['size', 'style']) $('layout-tab-' + tab).addEventListener('click', () => {
    for (const id of ['size', 'style']) { $('layout-' + id).hidden = id !== tab; $('layout-tab-' + id).setAttribute('aria-selected', String(id === tab)); }
  });
  for (const key of ['rail', 'column', 'upload']) for (const kind of ['number', 'range']) {
    const input = $(`layout-${key}-${kind}`);
    input.addEventListener(kind === 'range' ? 'input' : 'change', () => { updateValue(key, input.valueAsNumber, activeDocument(), currentMode()); input.value = Math.round(measured(key, activeDocument(), currentMode())); });
  }
  for (const [id, key] of [['layout-brand', 'brand'], ['layout-accent', 'accent'], ['layout-rail-color', 'railColor']]) $(id).addEventListener('input', () => { state.global[key] = $(id).value; changed(); });
  for (const [id, key] of [['layout-name', 'name'], ['layout-note', 'note']]) $(id).addEventListener('input', () => {
    toolState(currentMode())[key] = $(id).value;
    if (!$(id).value) window.dispatchEvent(new HashChangeEvent('hashchange'));
    changed();
  });
  $('layout-reset').addEventListener('click', () => {
    state = { version: 1, global: {}, tools: {} };
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    changed(); status('已恢复默认');
  });
  $('layout-export').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'cutframe-layout.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('layout-import').addEventListener('click', () => $('layout-config-file').click());
  $('layout-config-file').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 65536) throw new Error('配置文件过大');
      state = validate(JSON.parse(await file.text()));
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      changed(); save();
    } catch (_) { status('配置无效，未更改'); }
    event.target.value = '';
  });
  window.addEventListener('resize', () => { applyAll(); syncFields(); });
  window.addEventListener('pagehide', save);
  window.addEventListener('hashchange', () => { requestAnimationFrame(() => { applyAll(); syncFields(); }); });
  new MutationObserver(() => { applyAll(); syncFields(); }).observe($('page-title'), { childList: true });
  new MutationObserver(() => mainHandles.forEach(handles => handles.update())).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.CutframeLayoutEditor = Object.freeze({ attachFrame });
  document.querySelectorAll('.suite-frame[data-ready="true"]').forEach(frame => attachFrame(frame, frame.dataset.tool));
  applyAll(); syncFields();
})();
