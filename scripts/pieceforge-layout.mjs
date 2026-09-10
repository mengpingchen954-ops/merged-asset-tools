export function layoutStyles(layout) {
  const settings = layout.settings;
  if (layout.format !== 'pieceforge-layout' || layout.version !== 1 || !settings) throw new Error('Unsupported PieceForge layout');
  const bounds = { sidebarWidth: [280,680], sourceHeight: [140,500], materialHeight: [140,500], sectionGap: [8,40], resultHeight: [220,650], thumbnailSize: [95,210] };
  for (const [key, [minimum, maximum]] of Object.entries(bounds)) {
    if (!Number.isInteger(settings[key]) || settings[key] < minimum || settings[key] > maximum) throw new Error(`Invalid layout value: ${key}`);
  }
  const groups = { sidebarOrder: ['source','material','count','gap','background'], workspaceOrder: ['results','mask','fragments'] };
  for (const [key, values] of Object.entries(groups)) {
    if (!Array.isArray(settings[key]) || settings[key].length !== values.length || new Set(settings[key]).size !== values.length || !settings[key].every(value => values.includes(value))) throw new Error(`Invalid layout order: ${key}`);
  }
  if (!['top','bottom'].includes(settings.buttonPosition) || typeof settings.showSteps !== 'boolean') throw new Error('Invalid layout controls');
  const order = name => settings.workspaceOrder.indexOf(name) * 10 + 1;
  return `html, body { height: 100%; overflow: hidden; }
.host-tool-nav { height: 42px; padding: 10px 20px; }
.body-grid { grid-template-columns: min(var(--workflow-width, ${settings.sidebarWidth}px), 50vw) 12px minmax(0, 1fr); height: calc(100vh - 42px); height: calc(100dvh - 42px); min-height: 0; padding-bottom: 0; }
.layout-resizer { width: 12px; min-width: 12px; background: #edf7fe; }
.sidebar { overflow: auto; min-height: 0; gap: ${settings.sectionGap}px; padding: 20px 18px 86px; position: relative; scrollbar-width: thin; }
.sidebar > * { flex-shrink: 0; }
.sidebar .side-title { order: -30; }
.sidebar .stepper { order: -10; display: ${settings.showSteps ? 'block' : 'none'}; }
.sidebar .control-section { margin: 0; max-width: none; }
${groups.sidebarOrder.map((name, index) => `.sidebar > .control-section:nth-of-type(${index + 1}) { order: ${settings.sidebarOrder.indexOf(name) * 10 + 10}; }`).join('\n')}
.sidebar .upload-art { height: ${settings.sourceHeight}px; min-height: 0; }
.sidebar .upload-art img { object-fit: contain; }
.sidebar .material-upload { height: ${settings.materialHeight}px; min-height: 0; }
.sidebar .material-upload > img { height: calc(100% - 48px); object-fit: contain; }
.sidebar .generate-btn { order: -20; flex-shrink: 0; height: 46px; min-height: 46px; margin: 0; z-index: 12; box-shadow: 0 0 0 8px white, 0 6px 14px #173a5a15; font-size: 14px; ${settings.buttonPosition === 'top' ? 'position: sticky; top: 0;' : 'position: fixed; bottom: 18px; left: 18px; width: calc(min(var(--workflow-width), 50vw) - 36px);'} }
.sidebar .section-label { font-size: 13px; }
.sidebar .field-note { font-size: 11px; }
.workspace { min-height: 0; overflow: auto; padding: 22px; scrollbar-width: thin; }
.workspace > * { flex-shrink: 0; }
.workspace-head { order: -10; }
.results-head { order: ${order('results') - 1}; margin-top: 0; }
.result-grid { order: ${order('results')}; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.canvas-board { order: ${order('mask')}; }
.fragment-section { order: ${order('fragments')}; }
.result-image { height: ${settings.resultHeight}px; aspect-ratio: auto; }
.result-image canvas { height: 100%; width: 100%; object-fit: contain; }
.fragment-grid { grid-template-columns: repeat(auto-fill, minmax(min(${settings.thumbnailSize}px, 100%), 1fr)); }
@media (max-width: 900px) {
  html, body { height: auto; overflow: auto; }
  .body-grid { display: block; height: auto; min-height: calc(100dvh - 42px); padding-bottom: 80px; }
  .layout-resizer { display: none; }
  .sidebar { overflow: visible; padding-bottom: 24px; }
  .sidebar .generate-btn { position: fixed; top: auto; bottom: 14px; left: 18px; width: calc(100% - 36px); }
  .workspace { overflow: visible; padding: 18px 14px; }
  .mobile-tabs { display: none; }
}
@media (max-width: 540px) {
  .result-grid { grid-template-columns: 1fr; }
}
`;
}
