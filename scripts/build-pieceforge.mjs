import { readFile, writeFile } from 'node:fs/promises';
import { build, transform } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const legacy = await readFile(new URL('../pieceforge/assets/index-CUd2o1mb.js', import.meta.url), 'utf8');
let source = (await transform(legacy, { format: 'esm', charset: 'utf8' })).code;

function replaceOnce(before, after) {
  if (source.split(before).length !== 2) throw new Error(`PieceForge integration point changed: ${before.slice(0, 100)}`);
  source = source.replace(before, after);
}

function replaceFunction(start, next, implementation) {
  const offset = source.indexOf(start);
  const end = source.indexOf(next, offset);
  if (offset < 0 || end < 0) throw new Error(`Missing renderer boundary: ${start}`);
  source = source.slice(0, offset) + implementation + '\n' + source.slice(end);
}

replaceFunction('async function It(', 'async function Lt(', 'async function It(file) { return loadMaterialTexture(file); }');
replaceFunction('function nn(', 'function rn(', 'function nn(mask, regions = null, options = {}) { return renderComposite(mask, regions ? Xt(mask, regions, options) : null, { ...options, palette: Ut }); }');
replaceFunction('function rn(', 'var an =', 'function rn(mask, regions, options = {}) { return renderPiece(mask, Xt(mask, regions, options), { ...options, palette: Ut }); }');
replaceOnce('function pn() {', 'function pn() {\n  const [exportScale, setExportScale] = (0, _.useState)(4);');
replaceOnce('function dn({ fragment: e2,', 'function dn({ exportScale = 4, fragment: e2,');
replaceOnce('children: [e2.width, ` × `, e2.height, `px`]', 'children: [pieceDimensions(e2, exportScale).width, ` × `, pieceDimensions(e2, exportScale).height, `px`]');
replaceOnce('(0, z.jsx)(dn, { fragment:', '(0, z.jsx)(dn, { exportScale, fragment:');
replaceOnce('pieceId: t3.id, scale: 4, padding: 16', 'pieceId: t3.id, scale: exportScale, padding: 16');
replaceOnce('pieceId: r4.id, scale: 4, padding: 16', 'pieceId: r4.id, scale: exportScale, padding: 16');
replaceOnce('scale: 4, padding: 12', 'scale: 4, padding: 16');
replaceOnce('width: 2048, height: 2048, requestedPieces: l2', 'width: 1024 * exportScale, height: 1024 * exportScale, requestedPieces: l2');
replaceOnce('JSON.stringify({ source: d2?.name, pieces: v2.count, gap: S2, material: n2?.name || e2, layout: E2 }, null, 2)', 'JSON.stringify(exportManifest(d2?.name, v2, E2, n2, e2, exportScale), null, 2)');
replaceOnce('children: `PNG · 2048 × 2048`', 'children: `PNG · ${1024 * exportScale} × ${1024 * exportScale}`');
replaceOnce('children: `2048px`', 'children: `${1024 * exportScale}px`');
replaceOnce('children: [v2?.pieces?.[w2]?.width || 0, ` × `, v2?.pieces?.[w2]?.height || 0, ` px · 透明 PNG`]', 'children: [v2?.pieces?.[w2] ? pieceDimensions(v2.pieces[w2], exportScale).width : 0, ` × `, v2?.pieces?.[w2] ? pieceDimensions(v2.pieces[w2], exportScale).height : 0, ` px · 透明 PNG`]');
replaceOnce('每一块都已带透明边距，可单独下载或批量打包。', '原始材质直接渲染 · 平滑边缘 · 尺寸为实际导出 PNG（含透明边距）。');
replaceOnce('className: `fragment-actions`, children: [', 'className: `fragment-actions`, children: [(0, z.jsxs)(`label`, { className: `quality-control`, children: [`清晰度`, (0, z.jsx)(`select`, { "aria-label": `导出清晰度`, value: exportScale, onChange: event => setExportScale(Number(event.target.value)), children: [[2, `标准 · 2K`], [4, `高清 · 4K（推荐）`], [8, `超清 · 8K`]].map(([value, label]) => (0, z.jsx)(`option`, { value, children: label }, value)) })] }),');
source = source.replaceAll('S2 * 4', 'S2 * exportScale');

const result = await build({
  stdin: { contents: 'import { loadMaterialTexture, renderPiece, renderComposite, pieceDimensions, exportManifest } from "./hd-renderer.js";\n' + source, resolveDir: root + 'pieceforge', sourcefile: 'pieceforge-app.js' },
  bundle: true, format: 'esm', minify: true, charset: 'utf8', write: false
});
await writeFile(new URL('../pieceforge/assets/pieceforge-hd.js', import.meta.url), result.outputFiles[0].contents);
console.log('Built PieceForge HD renderer');
