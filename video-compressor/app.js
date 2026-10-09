import { compressionArgs, presets, outputName, formatSize, reduction } from './compression.js?v=2';

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
  for (const id of ['#fileInput', '#quality', '#audio']) $(id).disabled = busy;
  $('#dropZone').setAttribute('aria-disabled', String(busy));
  const done = files.filter(file => file.blob);
  const total = files.reduce((sum, file) => sum + file.file.size, 0);
  $('#summary').textContent = !files.length ? '还没有视频' : `${files.length} 个视频 · 原大小 ${formatSize(total)}` +
    (done.length ? ` · 已完成 ${done.length} 个 / ${formatSize(done.reduce((sum, file) => sum + file.blob.size, 0))}` : '');
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
    link.textContent = '下载 MP4';
    link.setAttribute('aria-label', `下载 ${file.file.name} 的压缩结果`);
    file.row.cells[4].append(link);
  }
}

function metadataText(info) {
  if (!info) return '等待分析';
  const video = info.streams.find(stream => stream.codec_type === 'video');
  if (!video) return '没有可用视频轨道';
  const rate = (video.avg_frame_rate || '').split('/').map(Number);
  const fps = rate[1] ? rate[0] / rate[1] : 0;
  const duration = Number(video.duration || info.format?.duration);
  const audio = info.streams.find(stream => stream.codec_type === 'audio');
  return `${video.width} × ${video.height}${Number.isFinite(duration) ? ` · ${duration.toFixed(2)} 秒` : ''}${fps ? ` · ${fps.toFixed(2).replace(/\.00$/, '')} 帧/秒` : ''}` +
    (audio ? ` · ${audio.codec_name.toUpperCase()}${Number(audio.bit_rate) ? ` ${Math.round(Number(audio.bit_rate)/1000)} kbps` : ''}` : ' · 无音频');
}

function showPreview(file) {
  selected = file;
  for (const item of files) item.row.classList.toggle('is-selected', item === file);
  $('#preview').hidden = false;
  $('#previewName').textContent = file.file.name;
  $('#sourceVideo').pause();
  $('#resultVideo').pause();
  if ($('#sourceVideo').getAttribute('src') !== file.sourceUrl) $('#sourceVideo').src = file.sourceUrl;
  $('#sourceInfo').textContent = `${formatSize(file.file.size)} · ${metadataText(file.info)}`;
  $('#resultVideo').hidden = !file.blob;
  if (file.blob) {
    if ($('#resultVideo').getAttribute('src') !== file.resultUrl) $('#resultVideo').src = file.resultUrl;
    $('#resultInfo').textContent = `${formatSize(file.blob.size)} · ${reduction(file.file.size, file.blob.size)} · ${metadataText(file.resultInfo)} · ${file.settings}`;
  } else {
    $('#resultVideo').removeAttribute('src');
    $('#resultVideo').load();
    $('#resultInfo').textContent = '压缩后可播放对比';
  }
}

function addFiles(incoming) {
  if (busy) return;
  const rejected = [];
  for (const source of incoming) {
    if ((!source.type.startsWith('video/') && !/\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(source.name)) || !source.size) {
      rejected.push(`${source.name}：不是有效视频文件`);
      continue;
    }
    if (source.size > maxFileSize) {
      rejected.push(`${source.name}：超过 200 MB，请使用桌面工具处理`);
      continue;
    }
    const file = { id: nextId++, file: source, sourceUrl: URL.createObjectURL(source), status: '待压缩', blob: null };
    file.outputName = outputName(source.name, file.id);
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
  $('#status').textContent = rejected.length ? rejected.join('；') : `已添加 ${files.length} 个视频，点击“压缩全部”开始。`;
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
$('#quality').addEventListener('change', () => { $('#qualityHelp').textContent = presets[$('#quality').value].help; });
$('#audio').addEventListener('change', () => {
  $('#audioHelp').textContent = $('#audio').value === 'compact' ? '将高码率音频压缩为 AAC 128 kbps，保留采样率（最多 48 kHz）和声道（最多双声道）。低码率 AAC 直接保留；可能损失音频细节，请试听。' : $('#audio').value === 'remove' ? '输出视频不包含声音。' : '原 AAC 音频直接保留，其他编码转换为 AAC 128 kbps。音乐或重要音效建议保持此选项。';
});
$('#sourceVideo').addEventListener('play', () => $('#resultVideo').pause());
$('#resultVideo').addEventListener('play', () => $('#sourceVideo').pause());

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
      worker.load({ coreURL: new URL('./vendor/ffmpeg-core.js', import.meta.url).href, wasmURL: new URL('./vendor/ffmpeg-core.wasm', import.meta.url).href }),
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
  if (code > 0) throw new Error('无法读取视频信息，文件可能损坏或编码不受支持。');
  const info = JSON.parse(await worker.readFile(report, 'utf8'));
  if (!info.streams?.some(stream => stream.codec_type === 'video')) throw new Error('文件没有视频轨道。');
  return info;
}

$('#compressButton').addEventListener('click', async () => {
  if (busy || !files.length) return;
  busy = true;
  cancelled = false;
  $('#cancelButton').hidden = false;
  $('#progress').hidden = false;
  $('#progress').value = 0;
  const quality = $('#quality').value;
  const audio = $('#audio').value;
  let failures = 0;
  let completed = 0;
  updateControls();
  try {
    const worker = await loadEngine();
    for (const [index, file] of files.entries()) {
      checkCancelled();
      currentFile = file;
      recentLogs = [];
      const input = `input-${file.id}.${file.file.name.split('.').pop().replace(/[^a-z0-9]/gi, '') || 'mp4'}`;
      const output = `output-${file.id}.mp4`;
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
        const sourceAudio = file.info.streams.find(stream => stream.codec_type === 'audio');
        file.status = '压缩中…';
        updateRow(file);
        const exitCode = await worker.exec(compressionArgs(input, output, quality, audio, sourceAudio));
        checkCancelled();
        if (exitCode !== 0) throw new Error('编码失败，文件可能损坏、编码不受支持或浏览器内存不足。');
        const resultInfo = await probe(worker, output, reports[1]);
        const data = await worker.readFile(output);
        checkCancelled();
        if (!data.length) throw new Error('没有生成视频，请重试。');
        const blob = new Blob([data], { type: 'video/mp4' });
        if (file.resultUrl) URL.revokeObjectURL(file.resultUrl);
        file.blob = blob;
        file.resultUrl = URL.createObjectURL(blob);
        file.resultInfo = resultInfo;
        const copiedAudio = sourceAudio?.codec_name === 'aac' && (audio === 'keep' || !(Number(sourceAudio.bit_rate) > 128000));
        file.settings = `${presets[quality].label} · ${audio === 'remove' ? '已移除音频' : !sourceAudio ? '源视频无音频' : copiedAudio ? '原 AAC 音频保留' : 'AAC 128 kbps'}`;
        file.status = blob.size < file.file.size ? reduction(file.file.size, blob.size) : '已完成，源视频已较小';
        completed++;
        $('#progress').value = 100;
        if (selected === file) showPreview(file);
      } catch (error) {
        if (cancelled) { file.status = '已停止'; throw error; }
        failures++;
        file.status = error instanceof Error ? error.message : '处理失败，请重试或使用较小视频。';
        if (recentLogs.some(log => /out of memory|memory access out of bounds/i.test(log))) file.status = '浏览器内存不足，请使用较小视频或桌面工具。';
      } finally {
        updateRow(file);
        updateControls();
        if (worker.loaded && !cancelled) {
          for (const path of [input, output, ...reports]) await worker.deleteFile(path).catch(() => {});
        }
        currentFile = null;
      }
    }
    $('#status').textContent = `处理完成：${completed} 个成功${failures ? `，${failures} 个失败，可重新压缩` : ''}。请播放预览确认画质。`;
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
  for (const id of ['#sourceVideo', '#resultVideo']) { $(id).pause(); $(id).removeAttribute('src'); $(id).load(); }
  for (const file of files) { URL.revokeObjectURL(file.sourceUrl); if (file.resultUrl) URL.revokeObjectURL(file.resultUrl); }
  files.length = 0;
  selected = null;
  nextId = 1;
  $('#fileList').replaceChildren();
  $('#preview').hidden = true;
  $('#status').textContent = '已清空，可以添加新视频。';
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
    link.download = '视频压缩.zip';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    $('#status').textContent = 'ZIP 已生成，包含所有成功压缩的视频。';
  } catch (error) {
    $('#status').textContent = `打包失败：${error.message}，可单独下载 MP4。`;
  } finally {
    busy = false;
    updateControls();
  }
});
