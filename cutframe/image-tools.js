import '../asset-vectorizer/app.js?v=20260907-1';

const root = document.querySelector('#image-studio');
const engine = window.AssetVectorizer;
let view = 'result';
let zoom = 1;
const fullExport = root.querySelector('#image-full-export');
const color = root.querySelector('#image-bg-color');
function syncControls() {
  const stats = engine.stats();
  fullExport.disabled = !stats.imageReady || stats.batch;
  root.querySelectorAll('[data-image-view]').forEach(button => {
    button.disabled = stats.batch;
    button.classList.toggle('is-active', button.dataset.imageView === view);
    button.setAttribute('aria-pressed', String(button.dataset.imageView === view));
  });
  color.disabled = stats.batch || !stats.imageReady;
  color.value = root.querySelector('#bgText').textContent;
}
function renderView() {
  engine.setPreview({ view, zoom });
  root.querySelector('#image-zoom-value').textContent = Math.round(zoom * 100) + '%';
  syncControls();
}
root.querySelectorAll('[data-image-view]').forEach(button => button.addEventListener('click', () => {
  view = button.dataset.imageView;
  renderView();
}));
root.querySelector('#image-zoom-in').addEventListener('click', () => { zoom = Math.min(2, zoom + 0.1); renderView(); });
root.querySelector('#image-zoom-out').addEventListener('click', () => { zoom = Math.max(0.6, zoom - 0.1); renderView(); });
root.querySelector('#image-empty-upload').addEventListener('click', () => root.querySelector('#fileInput').click());
fullExport.addEventListener('click', () => engine.downloadFullImage());
color.addEventListener('input', () => engine.setBackground(color.value));
window.addEventListener('cutframe:reset-image', () => { engine.resetControls(); view = 'result'; zoom = 1; renderView(); });
window.addEventListener('keydown', event => {
  if (root.hidden || event.target.matches('input, select, button, textarea') || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key.toLowerCase() === 'r') root.querySelector('#analyzeBtn').click();
  if (event.key.toLowerCase() === 'v' && !engine.stats().batch) { view = view === 'result' ? 'source' : 'result'; renderView(); }
});
const observer = new MutationObserver(syncControls);
for (const selector of ['#assetList', '#statusText', '#bgText']) observer.observe(root.querySelector(selector), { childList: true, subtree: true });
syncControls();
