import { compressionArgs, formats, outputName, canKeepOriginal } from './compression.js?v=2';
import { formatSize, reduction } from '../video-compressor/compression.js';

const $ = selector => document.querySelector(selector);
const files = [];
let nextId = 1;
let selected = null;
let busy = false;
let cancelled = false;
let engine = null;
let currentFile = null;
let recentLogs = [];
const maxFileSize = 200 * 1024 * 1024;

function updateControls() {
  $('#compressButton').disabled = busy || !files.length;
  $('#compressButton').textContent = busy ? '正在处理…' : files.some(file => file.blob) ? '重新压缩全部' : '压缩全部';
  $('#clearButton').disabled = busy || !files.length;
  $('#zipButton').disabled = busy || !files.some(file => file.blob);
  for (const id of ['#fileInput', '#profile', '#format', '#channels', '#keepSmaller']) $(id).disabled = busy;
  $('#bitrate').disabled = busy || $('#profile').value === 'mp3-vbr';
  $('#dropZone').setAttribute('aria-disabled', String(busy));
  const done = files.filter(file => file.blob);
  const total = files.reduce((sum, file) => sum + file.file.size, 0);
  const doneBefore = done.reduce((sum, file) => sum + file.file.size, 0);
  const doneAfter = done.reduce((sum, file) => sum + file.blob.size, 0);
  $('#summary').textContent = !files.length ? '还没有音频' : `${files.length} 个音频 · 原大小 ${formatSize(total)}` +
    (done.length ? ` · 已完成 ${done.length} 个 / ${formatSize(doneAfter)} · ${reduction(doneBefore, doneAfter)}` : '');
  $('#emptyState').hidden = !!files.length;
}

function updateRow(file) {
  file.row.cells[2].textContent = file.blob ? formatSize(file.blob.size) : '—';
  file.row.cells[3].textContent = file.status;
  file.row.querySelector('a')?.remove();
  if (file.blob) {
    const link = document.createElement('a');
    link.href = file.resultUrl;
    link.download = file.outputName;
    link.textContent = '下载音频';
    link.setAttribute('aria-label', `下载 ${file.file.name} 的压缩结果`);
    file.row.cells[4].append(link);
  }
}

function metadataText(info) {
  if (!info) return '等待分析';
  const audio = info.streams.find(stream => stream.codec_type === 'audio');
  if (!audio) return '没有可用音频轨道';
  const duration = Number(audio.duration || info.format?.duration);
  const bitrate = Number(audio.bit_rate || info.format?.bit_rate);
  return `${Number.isFinite(duration) ? duration.toFixed(2) + ' 秒 · ' : ''}${audio.channels} 声道 · ${Number(audio.sample_rate)/1000} kHz${bitrate ? ' · ' + Math.round(bitrate/1000) + ' kbps' : ''}`;
}

function showPreview(file) {
  selected = file;
  for (const item of files) item.row.classList.toggle('is-selected', item === file);
  $('#preview').hidden = false;
  $('#previewName').textContent = file.file.name;
  $('#sourceAudio').pause();
  $('#resultAudio').pause();
  if ($('#sourceAudio').getAttribute('src') !== file.sourceUrl) $('#sourceAudio').src = file.sourceUrl;
  $('#sourceInfo').textContent = `${formatSize(file.file.size)} · ${metadataText(file.info)}`;
  $('#resultAudio').hidden = !file.blob;
  if (file.blob) {
    if ($('#resultAudio').getAttribute('src') !== file.resultUrl) $('#resultAudio').src = file.resultUrl;
    $('#resultInfo').textContent = `${formatSize(file.blob.size)} · ${reduction(file.file.size, file.blob.size)} · ${metadataText(file.resultInfo)} · ${file.settings}`;
  } else {
    $('#resultAudio').removeAttribute('src');
    $('#resultAudio').load();
    $('#resultInfo').textContent = '压缩后可播放对比';
  }
}

function addFiles(incoming) {
  if (busy) return;
  const rejected = [];
  for (const source of incoming) {
    if ((!source.type.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|ogg|opus|flac|wma|aif|aiff)$/i.test(source.name)) || !source.size) {
      rejected.push(`${source.name}：不是有效音频文件`);
      continue;
    }
    if (source.size > maxFileSize) {
      rejected.push(`${source.name}：超过 200 MB，请使用桌面工具处理`);
      continue;
    }
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
  $('#status').textContent = rejected.length ? rejected.join('；') : `已添加 ${files.length} 个音频，点击“压缩全部”开始。`;
  updateControls();
}

$('#fileInput').addEventListener('change', event => { addFiles(event.target.files); event.target.value = ''; });
for (const type of ['dragenter', 'dragover']) $('#dropZone').addEventListener(type, event => {
  event.preventDefault();
  if (!busy) $('#dropZone').classList.add('is-dragging');
});
for (const type of ['dragleave', 'drop']) $('#dropZone').addEventListener(type, event => {
  event.preventDefault();
  $('#dropZone').classList.remove('is-dragging');
});
$('#dropZone').addEventListener('drop', event => addFiles(event.dataTransfer.files));
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());
function updateSettings() {
  $('#formatHelp').textContent = formats[$('#format').value].help;
  const profile = $('#profile').value;
  $('#profileHelp').textContent = profile === 'mp3-vbr' ? 'MP3 按声音复杂度自动分配码率，保留立体声。体积取决于素材；重要音乐可选自定义 128–192 kbps。' : profile === 'opus-effects' ? 'Opus 96 kbps 变码率，更适合网页音效，保留立体声。导入游戏引擎前确认支持 Opus；需要 MP3 时选通用方案。' : '自行选择格式、码率与声道。低码率和单声道可能损失细节或空间感，请试听结果。';
  $('#bitrateHelp').textContent = profile === 'mp3-vbr' ? '当前使用 MP3 VBR 质量档 V5，码率自动分配；此码率选项仅在指定码率方案下生效。' : $('#format').value === 'ogg' ? 'Opus 使用变码率，此处为目标平均码率，实际码率随声音复杂度变化。' : '码率越低，体积越小。语音可用 32–64 kbps，音乐建议 128–192 kbps。';
  updateControls();
}
$('#profile').addEventListener('change', () => {
  if ($('#profile').value !== 'custom') {
    $('#format').value = $('#profile').value === 'mp3-vbr' ? 'mp3' : 'ogg';
    $('#bitrate').value = $('#profile').value === 'mp3-vbr' ? '128' : '96';
    $('#channels').value = 'keep';
  }
  updateSettings();
});
for (const id of ['#format', '#bitrate', '#channels']) $(id).addEventListener('change', () => { $('#profile').value = 'custom'; updateSettings(); });
$('#sourceAudio').addEventListener('play', () => $('#resultAudio').pause());
$('#resultAudio').addEventListener('play', () => $('#sourceAudio').pause());

function checkCancelled() {
  if (cancelled) throw new Error('已停止');
}

function releaseEngine() {
  engine?.terminate();
  engine = null;
}

async function loadEngine() {
  if (engine?.loaded) return engine;
  checkCancelled();
  if (!window.FFmpegWASM || !window.WebAssembly || !window.Worker) throw new Error('浏览器不支持压缩引擎，请使用新版 Chrome 或 Edge。');
  $('#status').textContent = '正在载入本地压缩引擎（首次约 31 MB）…';
  const worker = new window.FFmpegWASM.FFmpeg();
  engine = worker;
  worker.on('log', ({ message }) => { recentLogs.push(message); if (recentLogs.length > 30) recentLogs.shift(); });
  worker.on('progress', ({ time }) => {
    const duration = Number(currentFile?.info?.format?.duration);
    if (!currentFile || !duration || !Number.isFinite(time)) return;
    const progress = Math.max(0, Math.min(99, Math.round(time / 1e6 / duration * 100)));
    $('#progress').value = progress;
    currentFile.status = `压缩中 ${progress}%`;
    updateRow(currentFile);
  });
  let timer;
  try {
    await Promise.race([
      worker.load({ coreURL: new URL('../video-compressor/vendor/ffmpeg-core.js', import.meta.url).href, wasmURL: new URL('../video-compressor/vendor/ffmpeg-core.wasm', import.meta.url).href }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('引擎载入超时，请检查网络后重试。')), 90000); }),
    ]);
    checkCancelled();
    return worker;
  } catch (error) {
    releaseEngine();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function probe(worker, path, report) {
  const code = await worker.ffprobe(['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path, '-o', report]);
  // ffmpeg-core 0.12.10 can leave ret at -1 after a successful ffprobe; validate its JSON report as well.
  if (code > 0) throw new Error('无法读取音频信息，文件可能损坏或编码不受支持。');
  const info = JSON.parse(await worker.readFile(report, 'utf8'));
  if (!info.streams?.some(stream => stream.codec_type === 'audio')) throw new Error('文件没有音频轨道。');
  return info;
}

$('#compressButton').addEventListener('click', async () => {
  if (busy || !files.length) return;
  busy = true;
  cancelled = false;
  $('#cancelButton').hidden = false;
  $('#progress').hidden = false;
  $('#progress').value = 0;
  const format = $('#format').value;
  const bitrate = $('#bitrate').value;
  const channels = $('#channels').value;
  const keepSmaller = $('#keepSmaller').checked;
  const encoding = $('#profile').value === 'mp3-vbr' ? 'vbr' : 'fixed';
  let failures = 0;
  let completed = 0;
  updateControls();
  try {
    const worker = await loadEngine();
    for (const [index, file] of files.entries()) {
      checkCancelled();
      currentFile = file;
      recentLogs = [];
      const input = `input-${file.id}.${file.file.name.split('.').pop().replace(/[^a-z0-9]/gi, '') || 'mp3'}`;
      const output = `output-${file.id}.${format}`;
      const reports = [`source-${file.id}.json`, `result-${file.id}.json`];
      $('#progress').value = 0;
      $('#status').textContent = `正在压缩 ${index + 1}/${files.length}：${file.file.name}`;
      file.status = '分析中…';
      updateRow(file);
      try {
        const bytes = new Uint8Array(await file.file.arrayBuffer());
        checkCancelled();
        await worker.writeFile(input, bytes);
        file.info = await probe(worker, input, reports[0]);
        if (selected === file) showPreview(file);
        const source = file.info.streams.find(stream => stream.codec_type === 'audio');
        file.status = '压缩中…';
        updateRow(file);
        const exitCode = await worker.exec(compressionArgs(input, output, format, bitrate, channels, source, encoding));
        checkCancelled();
        if (exitCode !== 0) throw new Error('编码失败，文件可能损坏、编码不受支持或浏览器内存不足。');
        const resultInfo = await probe(worker, output, reports[1]);
        const data = await worker.readFile(output);
        checkCancelled();
        if (!data.length) throw new Error('没有生成音频，请重试。');
        const candidate = new Blob([data], { type: formats[format].mime });
        const keptOriginal = keepSmaller && file.file.size <= candidate.size && canKeepOriginal(format, channels, source, file.file.name, bitrate);
        const blob = keptOriginal ? file.file : candidate;
        if (file.resultUrl) URL.revokeObjectURL(file.resultUrl);
        file.blob = blob;
        file.resultUrl = URL.createObjectURL(blob);
        file.resultInfo = keptOriginal ? file.info : resultInfo;
        file.outputName = outputName(file.file.name, file.id, format);
        file.settings = keptOriginal ? '已优化，保留原文件' : `${formats[format].label} · ${encoding === 'vbr' ? 'VBR V5 · 自动码率' : format === 'ogg' ? `VBR · 目标 ${bitrate} kbps` : `${bitrate} kbps`} · ${channels === 'mono' ? '单声道' : '保留声道（最多双声道）'}`;
        file.status = keptOriginal ? '已优化，保留原文件' : blob.size < file.file.size ? reduction(file.file.size, blob.size) : '已完成，体积增加';
        completed++;
        $('#progress').value = 100;
        if (selected === file) showPreview(file);
      } catch (error) {
        if (cancelled) { file.status = '已停止'; throw error; }
        failures++;
        file.status = error instanceof Error ? error.message : '处理失败，请重试或使用较小音频。';
        if (recentLogs.some(log => /out of memory|memory access out of bounds/i.test(log))) file.status = '浏览器内存不足，请使用较小音频或桌面工具。';
      } finally {
        updateRow(file);
        updateControls();
        if (worker.loaded && !cancelled) {
          for (const path of [input, output, ...reports]) await worker.deleteFile(path).catch(() => {});
        }
        currentFile = null;
      }
    }
    $('#status').textContent = `处理完成：${completed} 个成功${failures ? `，${failures} 个失败，可重新压缩` : ''}。请试听确认音质。`;
  } catch (error) {
    $('#status').textContent = cancelled ? '已停止压缩，已完成的结果仍可下载。' : `无法压缩：${error instanceof Error ? error.message : String(error)} 可重试或使用新版 Chrome / Edge。`;
  } finally {
    releaseEngine();
    busy = false;
    currentFile = null;
    $('#cancelButton').hidden = true;
    $('#progress').hidden = true;
    updateControls();
  }
});

$('#cancelButton').addEventListener('click', () => {
  cancelled = true;
  releaseEngine();
  $('#status').textContent = '正在停止…';
});

$('#clearButton').addEventListener('click', () => {
  if (busy) return;
  for (const id of ['#sourceAudio', '#resultAudio']) { $(id).pause(); $(id).removeAttribute('src'); $(id).load(); }
  for (const file of files) { URL.revokeObjectURL(file.sourceUrl); if (file.resultUrl) URL.revokeObjectURL(file.resultUrl); }
  files.length = 0;
  selected = null;
  nextId = 1;
  $('#fileList').replaceChildren();
  $('#preview').hidden = true;
  $('#status').textContent = '已清空，可以添加新音频。';
  updateControls();
});

$('#zipButton').addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  updateControls();
  $('#status').textContent = '正在打包压缩结果…';
  try {
    if (!window.JSZip) throw new Error('ZIP 组件未载入，请刷新后重试。');
    const zip = new window.JSZip();
    for (const file of files.filter(file => file.blob)) zip.file(file.outputName, file.blob);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '音频压缩.zip';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    $('#status').textContent = 'ZIP 已生成，包含所有成功压缩的音频。';
  } catch (error) {
    $('#status').textContent = `打包失败：${error.message}，可单独下载音频。`;
  } finally {
    busy = false;
    updateControls();
  }
});
