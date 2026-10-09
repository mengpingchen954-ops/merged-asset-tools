import { presets, extensions, detectImage, validateImage, chooseResult, outputName } from './compression.js';
import { formatSize, reduction } from '../video-compressor/compression.js';

const $ = selector => document.querySelector(selector);
const files = [];
let selected = null;
let nextId = 1;
let busy = false;
let cancelled = false;
let stopPng = null;

function syncSettings() {
  const preset = presets[$('#quality').value];
  $('#qualityHelp').textContent = `PNG ${$('#lossless').checked ? '保留原像素' : `最多 ${preset.colors} 色，色差明显时自动保留原像素`}；JPG / WebP 使用 ${Math.round(preset.quality * 100)}% 编码质量。`;
  $('#formatHelp').textContent = $('#format').value === 'image/jpeg' ? 'JPG 不支持透明背景，透明区域将填充白色。' : 'PNG 和 WebP 支持透明背景。默认保留原尺寸。';
  $('#lossless').disabled = busy || !['original','image/png'].includes($('#format').value);
}

function updateControls() {
  $('#compressButton').disabled = busy || !files.length;
  $('#compressButton').textContent = busy ? '正在处理…' : files.some(file => file.blob) ? '重新压缩全部' : '压缩全部';
  $('#clearButton').disabled = busy || !files.length;
  $('#zipButton').disabled = busy || !files.some(file => file.blob);
  for (const id of ['#fileInput', '#format', '#quality']) $(id).disabled = busy;
  $('#dropZone').setAttribute('aria-disabled', String(busy));
  const done = files.filter(file => file.blob);
  const before = done.reduce((sum, file) => sum + file.file.size, 0);
  const after = done.reduce((sum, file) => sum + file.blob.size, 0);
  $('#summary').textContent = files.length ? `${files.length} 张图片 · 原大小 ${formatSize(files.reduce((sum, file) => sum + file.file.size, 0))}` +
    (done.length ? ` · 已完成 ${done.length} 张 / ${formatSize(after)} · ${reduction(before, after)}` : '') : '还没有图片';
  $('#emptyState').hidden = !!files.length;
  syncSettings();
}

function updateRow(file) {
  file.row.cells[2].textContent = file.blob ? formatSize(file.blob.size) : '—';
  file.row.cells[3].textContent = file.status;
  file.row.querySelector('a')?.remove();
  if (file.blob) {
    const link = document.createElement('a');
    link.href = file.resultUrl;
    link.download = file.outputName;
    link.textContent = '下载图片';
    link.setAttribute('aria-label', `下载 ${file.file.name} 的压缩结果`);
    file.row.cells[4].append(link);
  }
}

function showPreview(file) {
  selected = file;
  for (const item of files) item.row.classList.toggle('is-selected', item === file);
  $('#preview').hidden = false;
  $('#previewName').textContent = file.file.name;
  if (file.info) $('#sourceImage').src = file.sourceUrl;
  else $('#sourceImage').removeAttribute('src');
  $('#sourceInfo').textContent = `${formatSize(file.file.size)}${file.info ? ` · ${file.info.width} × ${file.info.height}` : ''}`;
  $('#resultStage').hidden = !file.blob;
  if (file.blob) {
    $('#resultImage').src = file.resultUrl;
    $('#resultInfo').textContent = `${formatSize(file.blob.size)} · ${reduction(file.file.size, file.blob.size)} · ${file.info.width} × ${file.info.height} · ${extensions[file.mime].toUpperCase()} · ${file.settings}`;
  } else {
    $('#resultImage').removeAttribute('src');
    $('#resultInfo').textContent = '压缩后可查看对比';
  }
}

function addFiles(incoming) {
  if (busy) return;
  const rejected = [];
  for (const source of incoming) {
    if ((!['image/png','image/jpeg','image/webp'].includes(source.type) && !/\.(png|jpe?g|webp)$/i.test(source.name)) || !source.size) {
      rejected.push(`${source.name}：仅支持 PNG、JPG 和 WebP`);
      continue;
    }
    if (source.size > 50 * 1024 * 1024) { rejected.push(`${source.name}：超过 50 MB`); continue; }
    const file = { id: nextId++, file: source, sourceUrl: URL.createObjectURL(source), status: '待压缩', blob: null };
    const row = document.createElement('tr');
    for (let i = 0; i < 5; i++) row.insertCell();
    const name = document.createElement('strong');
    name.textContent = source.name;
    row.cells[0].append(name);
    row.cells[1].textContent = formatSize(source.size);
    const preview = document.createElement('button');
    preview.type = 'button';
    preview.textContent = '预览';
    preview.setAttribute('aria-label', `预览 ${source.name}`);
    preview.addEventListener('click', () => showPreview(file));
    row.cells[4].append(preview);
    file.row = row;
    files.push(file);
    $('#fileList').append(row);
    updateRow(file);
  }
  if (!selected && files.length) showPreview(files[0]);
  $('#status').textContent = rejected.length ? rejected.join('；') : `已添加 ${files.length} 张图片，点击“压缩全部”开始。`;
  updateControls();
}

$('#fileInput').addEventListener('change', event => { addFiles(event.target.files); event.target.value = ''; });
for (const type of ['dragenter','dragover','dragleave','drop']) $('#dropZone').addEventListener(type, event => {
  event.preventDefault();
  $('#dropZone').classList.toggle('is-dragging', !busy && ['dragenter','dragover'].includes(type));
});
$('#dropZone').addEventListener('drop', event => addFiles(event.dataTransfer.files));
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());
for (const id of ['#quality','#format','#lossless']) $(id).addEventListener('change', syncSettings);

function checkCancelled() { if (cancelled) throw new Error('已停止'); }

function encodePng(data) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./png-worker.js', import.meta.url));
    const finish = (error, result) => {
      clearTimeout(timer);
      worker.terminate();
      stopPng = null;
      error ? reject(error) : resolve({blob:new Blob([result.encoded], {type:'image/png'}), usedLossless:result.usedLossless});
    };
    const timer = setTimeout(() => finish(new Error('PNG 处理超时，请使用较小图片')), 120000);
    stopPng = () => finish(new Error('已停止'));
    worker.onmessage = ({data}) => finish(data.error ? new Error(data.error) : null, data);
    worker.onerror = () => finish(new Error('PNG 编码失败，请刷新重试或使用较小图片'));
    worker.postMessage(data, [data.png || data.rgba]);
  });
}

async function encodeImage(file, bytes, mime, quality, lossless) {
  const preset = presets[quality];
  if (file.info.mime === 'image/png' && mime === 'image/png') {
    return encodePng({png:bytes.buffer, width:file.info.width, height:file.info.height, colors:lossless ? 0 : preset.colors, maxError:preset.maxError});
  }
  let bitmap;
  let canvas;
  try {
    bitmap = await createImageBitmap(file.file);
    checkCancelled();
    validateImage({width:bitmap.width,height:bitmap.height});
    file.info.width = bitmap.width;
    file.info.height = bitmap.height;
    canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', {willReadFrequently: mime === 'image/png'});
    if (mime === 'image/jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0,0,canvas.width,canvas.height); }
    context.drawImage(bitmap,0,0);
    bitmap.close();
    bitmap = null;
    if (mime === 'image/png') {
      const rgba = context.getImageData(0,0,canvas.width,canvas.height).data.buffer;
      return await encodePng({rgba,width:canvas.width,height:canvas.height,colors:lossless ? 0 : preset.colors,maxError:preset.maxError});
    }
    const blob = await new Promise((resolve,reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片编码失败')), mime, preset.quality));
    if (blob.type !== mime) throw new Error('浏览器不支持该输出格式，请使用新版 Chrome 或 Edge');
    return {blob};
  } finally {
    bitmap?.close();
    if (canvas) { canvas.width = 1; canvas.height = 1; }
  }
}

$('#compressButton').addEventListener('click', async () => {
  if (busy || !files.length) return;
  busy = true;
  cancelled = false;
  $('#cancelButton').hidden = false;
  $('#progress').hidden = false;
  $('#progress').value = 0;
  const format = $('#format').value;
  const quality = $('#quality').value;
  const lossless = $('#lossless').checked;
  let completed = 0, failures = 0;
  updateControls();
  try {
    for (const [index,file] of files.entries()) {
      checkCancelled();
      file.status = '压缩中…';
      updateRow(file);
      $('#status').textContent = `正在压缩 ${index+1}/${files.length}：${file.file.name}`;
      try {
        const bytes = new Uint8Array(await file.file.arrayBuffer());
        checkCancelled();
        file.info = validateImage(detectImage(bytes));
        if (selected === file) showPreview(file);
        const mime = format === 'original' ? file.info.mime : format;
        const {blob:candidate, usedLossless} = await encodeImage(file,bytes,mime,quality,lossless);
        checkCancelled();
        if (!candidate.size) throw new Error('未生成图片，请重试');
        const {blob, keptOriginal} = chooseResult(file.file,candidate,file.info.mime,mime);
        if (file.resultUrl) URL.revokeObjectURL(file.resultUrl);
        file.blob = blob;
        file.resultUrl = URL.createObjectURL(blob);
        file.mime = mime;
        file.outputName = outputName(file.file.name,file.id,mime);
        file.settings = keptOriginal ? '保留原文件' : usedLossless ? (lossless ? '保留原像素' : '自动保留原像素') : presets[quality].label;
        file.status = keptOriginal ? '已优化，保留原文件' : blob.size >= file.file.size ? '已转换，体积增加' : reduction(file.file.size,blob.size);
        completed++;
        if (selected === file) showPreview(file);
      } catch (error) {
        if (cancelled) { file.status = '已停止'; throw error; }
        failures++;
        file.status = error.message || '压缩失败，文件可能损坏';
      } finally {
        updateRow(file);
        $('#progress').value = Math.round((index+1)/files.length*100);
        updateControls();
      }
    }
    $('#status').textContent = `处理完成：${completed} 张成功${failures ? `，${failures} 张失败` : ''}。请查看预览确认画质。`;
  } catch (error) {
    $('#status').textContent = cancelled ? '已停止压缩，已完成的图片仍可下载。' : `处理失败：${error.message}`;
  } finally {
    busy = false;
    $('#cancelButton').hidden = true;
    $('#progress').hidden = true;
    updateControls();
  }
});

$('#cancelButton').addEventListener('click', () => { cancelled = true; stopPng?.(); $('#status').textContent = '正在停止…'; });
$('#clearButton').addEventListener('click', () => {
  if (busy) return;
  $('#sourceImage').removeAttribute('src');
  $('#resultImage').removeAttribute('src');
  for (const file of files) { URL.revokeObjectURL(file.sourceUrl); if (file.resultUrl) URL.revokeObjectURL(file.resultUrl); }
  files.length = 0; nextId = 1; selected = null;
  $('#fileList').replaceChildren();
  $('#preview').hidden = true;
  $('#status').textContent = '已清空，可以添加新图片。';
  updateControls();
});
$('#zipButton').addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  updateControls();
  $('#status').textContent = '正在打包图片…';
  try {
    if (!window.JSZip) throw new Error('ZIP 组件未载入，请刷新重试');
    const zip = new window.JSZip();
    for (const file of files.filter(file => file.blob)) zip.file(file.outputName,file.blob);
    const blob = await zip.generateAsync({type:'blob',compression:'STORE'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = '压缩图片.zip';
    document.body.append(link); link.click(); link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    $('#status').textContent = 'ZIP 已生成，包含所有成功处理的图片。';
  } catch (error) { $('#status').textContent = `打包失败：${error.message}，可单独下载图片。`; }
  finally { busy = false; updateControls(); }
});
updateControls();
