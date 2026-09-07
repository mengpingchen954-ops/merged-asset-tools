(function () {
  'use strict';
  const definitions = {
    'green-screen': { title: '绿幕视频转序列帧', description: '导入 MP4、MOV 或 GIF，去除纯色背景，调整尺寸与裁剪后导出透明 PNG 序列 ZIP。', src: '../green-screen-to-frames/index.html?v=gif-input-1' },
    gif: { title: '序列帧压缩', description: '本地处理 GIF、MP4、PNG 序列与文件夹，压缩 PNG 并导出 Cocos 动画资源。', src: '../gif-to-cocos-tool/index.html?v=vfx-entry-1' },
    cocos: { title: 'Cocos HTML 压缩', description: '导入 Cocos HTML 或渠道 ZIP，压缩图片与音频，生成 5MB 提交包和横竖屏版本。', src: '../cocos-html-compressor/index.html?v=channel-zip-6' },
    model: { title: 'FBX / GLB 模型压缩', description: '本地转换 FBX、压缩 GLB，支持网格减面与贴图优化，默认适配 Cocos Creator 3.8.3。', src: '../glb-model-optimizer/index.html?mode=model&v=fbx-cocos383-2' },
    extractor: { title: '构建包素材提取', description: '导入 HTML 或 ZIP 构建包，提取 UI 图片、图标与音频，支持分类下载、素材打包及玩法分析。', src: '../game-insight-parser/index.html?v=asset-download-3' },
    vfx: { title: '特效贴图生成', description: '分析特效参考图，生成光条、碎片、爆闪与柔光透明 PNG，预览粒子效果并打包导出。', src: '../glb-model-optimizer/index.html?mode=vfx&v=vfx-textures-3' },
  };
  const studio = document.querySelector('#suite-studio');
  const loading = document.querySelector('#suite-loading');
  const nav = document.querySelector('.mode-switch');
  const mobileSelect = document.querySelector('#mobile-tool-select');
  const frames = new Map();
  let activeMode = 'image';
  const known = new Set(['image', 'video', ...Object.keys(definitions)]);
  function fromHash() {
    const hash = location.hash.slice(1);
    if (hash === 'vector') return 'image';
    return known.has(hash) ? hash : 'image';
  }
  function elevateImportArea(doc, mode) {
    if (!['gif', 'cocos', 'model', 'vfx'].includes(mode) || doc.querySelector('.cutframe-import-area')) return;
    const drop = doc.querySelector(mode === 'vfx' ? '#vfxDropZone' : '#dropZone');
    const workspace = drop?.closest('.workspace, .vfx-workspace');
    if (!workspace) return;
    // Move the existing nodes so their inputs and drag handlers remain attached.
    const area = doc.createElement('div');
    area.className = 'cutframe-import-area';
    workspace.prepend(area);
    area.append(drop);
    if (mode === 'gif') {
      const folder = doc.querySelector('label[for="pngFolderInput"]');
      if (folder) {
        area.classList.add('has-folder-picker');
        area.append(folder);
      }
    }
  }
  function createFrame(mode) {
    const definition = definitions[mode];
    const frame = document.createElement('iframe');
    frame.className = 'suite-frame';
    frame.dataset.tool = mode;
    frame.title = definition.title;
    frame.setAttribute('allow', 'autoplay; clipboard-write; fullscreen');
    frame.addEventListener('load', () => {
      const doc = frame.contentDocument;
      if (!doc?.body || doc.URL === 'about:blank') return;
      doc.documentElement.dataset.cutframeTool = mode;
      elevateImportArea(doc, mode);
      const markReady = () => {
        frame.dataset.ready = 'true';
        if (activeMode === mode) loading.hidden = true;
      };
      if (!doc.querySelector('#cutframe-embedded-theme')) {
        const theme = doc.createElement('link');
        theme.id = 'cutframe-embedded-theme';
        theme.rel = 'stylesheet';
        theme.href = new URL('./embedded-tools.css?v=20260907-upload3', location.href).href;
        theme.onload = markReady;
        theme.onerror = markReady;
        doc.head.append(theme);
      } else {
        markReady();
      }
    });
    frames.set(mode, frame);
    frame.src = definition.src;
    studio.append(frame);
    return frame;
  }
  function activate(mode) {
    activeMode = mode;
    mobileSelect.value = mode;
    studio.hidden = !definitions[mode];
    for (const [id, frame] of frames) frame.hidden = id !== mode;
    if (!definitions[mode]) return;
    const frame = frames.get(mode) || createFrame(mode);
    frame.hidden = false;
    loading.textContent = '正在载入' + definitions[mode].title + '…';
    loading.hidden = frame.dataset.ready === 'true';
  }
  document.querySelector('#reload-current-tool').addEventListener('click', () => {
    const frame = frames.get(activeMode);
    if (frame) {
      frame.dataset.ready = 'false';
      loading.hidden = false;
      frame.contentWindow.location.reload();
    } else {
      location.reload();
    }
  });
  document.querySelector('#open-current-tool').addEventListener('click', () => {
    const src = definitions[activeMode]?.src || (activeMode === 'image' ? '../asset-vectorizer/index.html' : './#video');
    window.open(new URL(src, location.href).href, '_blank', 'noopener');
  });
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.data?.type !== 'open-tool') return;
    if (![...frames.values()].some(frame => frame.contentWindow === event.source)) return;
    const mode = event.data.tool === 'vector' ? (event.data.mode === 'vfx' ? 'vfx' : 'image') : event.data.tool;
    if (known.has(mode)) window.dispatchEvent(new CustomEvent('cutframe:open-tool', { detail: mode }));
  });

  // Preserve each loaded tool and its files when switching; only load a tool on first use.
  const defaultOrder = [...nav.querySelectorAll('.mode-button')].map(button => button.dataset.mode);
  const storageKey = 'cutframe:tool-order';
  const resetOrder = document.querySelector('#reset-tool-order');
  const orderStatus = document.querySelector('#tool-order-status');
  let dragged = null;
  const currentItems = () => [...nav.querySelectorAll('.tool-nav-item')];
  const currentOrder = () => currentItems().map(item => item.dataset.mode);
  function updateOrder() {
    currentItems().forEach((item, index) => {
      const title = item.querySelector('strong').textContent;
      item.querySelector('.tool-order-handle').setAttribute('aria-label', `调整${title}顺序，当前第 ${index + 1} 项；可拖动或使用上下方向键`);
      mobileSelect.append(mobileSelect.querySelector(`option[value="${item.dataset.mode}"]`));
    });
    mobileSelect.value = activeMode;
    resetOrder.disabled = currentOrder().every((mode, index) => mode === defaultOrder[index]);
  }
  function saveOrder() {
    try { localStorage.setItem(storageKey, JSON.stringify(currentOrder())); } catch (_) { /* Session-only order is still usable. */ }
    updateOrder();
  }
  for (const button of [...nav.querySelectorAll('.mode-button')]) {
    const item = document.createElement('div');
    item.className = 'tool-nav-item';
    item.dataset.mode = button.dataset.mode;
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'tool-order-handle';
    handle.draggable = true;
    handle.title = '拖动排序，或使用上下方向键';
    handle.innerHTML = '<i data-lucide="grip-vertical"></i>';
    button.replaceWith(item);
    item.append(button, handle);
    handle.addEventListener('keydown', event => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const items = currentItems();
      const index = items.indexOf(item);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)));
      if (next === index) return;
      nav.insertBefore(item, next < index ? items[next] : items[next].nextSibling);
      saveOrder();
      handle.focus();
      orderStatus.textContent = button.querySelector('strong').textContent + '已移至第 ' + (next + 1) + ' 项';
    });
    handle.addEventListener('dragstart', event => {
      dragged = item;
      item.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', item.dataset.mode);
    });
    handle.addEventListener('dragend', finishDrag);
  }
  function finishDrag() {
    if (!dragged) return;
    dragged.classList.remove('is-dragging');
    const name = dragged.querySelector('strong').textContent;
    const position = currentItems().indexOf(dragged) + 1;
    dragged = null;
    saveOrder();
    orderStatus.textContent = name + '已移至第 ' + position + ' 项';
  }
  nav.addEventListener('dragover', event => {
    if (!dragged) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = nav.getBoundingClientRect();
    if (event.clientY < rect.top + 30) nav.scrollTop -= 12;
    if (event.clientY > rect.bottom - 30) nav.scrollTop += 12;
    const next = currentItems().filter(item => item !== dragged).find(item => {
      const box = item.getBoundingClientRect();
      return event.clientY < box.top + box.height / 2;
    });
    nav.insertBefore(dragged, next || null);
  });
  nav.addEventListener('drop', event => { if (dragged) { event.preventDefault(); finishDrag(); } });
  function applyOrder(order) {
    for (const mode of order) {
      const item = currentItems().find(item => item.dataset.mode === mode);
      if (item) nav.append(item);
    }
    updateOrder();
  }
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || localStorage.getItem('merged-asset-tools:tool-order') || 'null');
    if (Array.isArray(saved)) {
      const normalized = [...new Set(saved.map(mode => mode === 'vector' ? 'image' : mode).filter(mode => known.has(mode)))];
      applyOrder([...normalized, ...defaultOrder.filter(mode => !normalized.includes(mode))]);
    }
  } catch (_) { /* Keep the default order when storage is unavailable. */ }
  resetOrder.addEventListener('click', () => { applyOrder(defaultOrder); saveOrder(); orderStatus.textContent = '已恢复默认工具排序'; });
  updateOrder();
  window.CutframeToolSuite = Object.freeze({
    modes: Object.fromEntries(Object.entries(definitions).map(([mode, value]) => [mode, { ...value, hash: mode }])),
    activate,
    fromHash,
  });
})();

