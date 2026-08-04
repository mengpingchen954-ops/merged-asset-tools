const $ = (selector) => document.querySelector(selector);

const elements = {
  dropZone: $("#dropZone"),
  videoInput: $("#videoInput"),
  sourceVideo: $("#sourceVideo"),
  sourceCanvas: $("#sourceCanvas"),
  previewCanvas: $("#previewCanvas"),
  canvasWrap: $("#canvasWrap"),
  previewStage: $("#previewStage"),
  cropSelection: $("#cropSelection"),
  previewPanel: $("#previewPanel"),
  sampleHint: $("#sampleHint"),
  sampleButton: $("#sampleButton"),
  colorSwatch: $("#colorSwatch"),
  colorHex: $("#colorHex"),
  thresholdInput: $("#thresholdInput"),
  thresholdValue: $("#thresholdValue"),
  softnessInput: $("#softnessInput"),
  softnessValue: $("#softnessValue"),
  spillInput: $("#spillInput"),
  spillValue: $("#spillValue"),
  timeInput: $("#timeInput"),
  timeValue: $("#timeValue"),
  frameRateInput: $("#frameRateInput"),
  originalSize: $("#originalSize"),
  outputWidthInput: $("#outputWidthInput"),
  outputHeightInput: $("#outputHeightInput"),
  cropModeButton: $("#cropModeButton"),
  resetCropButton: $("#resetCropButton"),
  cropMeta: $("#cropMeta"),
  exportButton: $("#exportButton"),
  exportLabel: $("#exportLabel"),
  downloadLink: $("#downloadLink"),
  progressBar: $("#progressBar"),
  exportStatus: $("#exportStatus"),
  headerStatus: $("#headerStatus"),
  videoName: $("#videoName"),
  videoMeta: $("#videoMeta"),
};

const MAX_EXPORT_FRAMES = 600;
const MAX_OUTPUT_DIMENSION = 8192;
const MAX_OUTPUT_PIXELS = 33_554_432;
const state = {
  file: null,
  objectUrl: "",
  sourceWidth: 0,
  sourceHeight: 0,
  duration: 0,
  keyColor: { r: 0, g: 169, b: 79 },
  previewRequest: 0,
  isExporting: false,
  outputUrl: "",
  keyCanvas: document.createElement("canvas"),
  crop: null,
  cropStart: null,
  cropPointerId: null,
  isCropMode: false,
};

const sourceContext = elements.sourceCanvas.getContext("2d", { willReadFrequently: true });
const previewContext = elements.previewCanvas.getContext("2d");

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function isMp4(file) {
  return Boolean(file && (file.type === "video/mp4" || /\.mp4$/i.test(file.name)));
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "-";
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "-";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function sanitizeName(name) {
  const cleaned = String(name || "green-screen")
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim();
  return cleaned || "green-screen";
}

function getSettings() {
  return {
    threshold: Number(elements.thresholdInput.value) / 100,
    softness: Number(elements.softnessInput.value) / 100,
    spill: Number(elements.spillInput.value) / 100,
    frameRate: Number(elements.frameRateInput.value),
  };
}

function updateValueLabels() {
  elements.thresholdValue.textContent = `${elements.thresholdInput.value}%`;
  elements.softnessValue.textContent = `${elements.softnessInput.value}%`;
  elements.spillValue.textContent = `${elements.spillInput.value}%`;
}

function updateKeyColorUi() {
  const { r, g, b } = state.keyColor;
  const hex = `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  elements.colorSwatch.style.background = hex;
  elements.colorHex.textContent = hex;
}

function setProgress(percent, status) {
  elements.progressBar.style.width = `${clamp(percent, 0, 100)}%`;
  if (status) elements.exportStatus.textContent = status;
}

function setHeaderStatus(text) {
  elements.headerStatus.textContent = text;
}

function setExporting(isExporting) {
  state.isExporting = isExporting;
  const hasLoadedVideo = Boolean(state.file && state.sourceWidth && state.sourceHeight);
  elements.exportButton.disabled = isExporting || !hasLoadedVideo;
  elements.frameRateInput.disabled = isExporting || !hasLoadedVideo;
  elements.outputWidthInput.disabled = isExporting || !hasLoadedVideo;
  elements.outputHeightInput.disabled = isExporting || !hasLoadedVideo;
  elements.cropModeButton.disabled = isExporting || !hasLoadedVideo;
  elements.resetCropButton.disabled = isExporting || !hasLoadedVideo;
  updateCropUi();
}

function clearExportOutput() {
  if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
  state.outputUrl = "";
  elements.exportLabel.textContent = "导出并保存透明 PNG 序列";
  elements.exportButton.classList.remove("is-hidden");
  elements.downloadLink.classList.add("is-hidden");
  elements.downloadLink.removeAttribute("href");
  elements.downloadLink.removeAttribute("download");
}

function drawSourceFrame() {
  if (!state.file || !state.sourceWidth || !state.sourceHeight) return false;
  sourceContext.clearRect(0, 0, state.sourceWidth, state.sourceHeight);
  sourceContext.drawImage(elements.sourceVideo, 0, 0, state.sourceWidth, state.sourceHeight);
  return true;
}

function applyChromaKey(targetCanvas) {
  const { threshold, softness, spill } = getSettings();
  const width = state.sourceWidth;
  const height = state.sourceHeight;
  if (!width || !height) return;

  const input = sourceContext.getImageData(0, 0, width, height);
  const pixels = input.data;
  const keyRed = state.keyColor.r / 255;
  const keyGreen = state.keyColor.g / 255;
  const keyBlue = state.keyColor.b / 255;
  const keyBase = Math.min(state.keyColor.r, state.keyColor.g, state.keyColor.b);
  const keyChroma = {
    r: state.keyColor.r - keyBase,
    g: state.keyColor.g - keyBase,
    b: state.keyColor.b - keyBase,
  };
  const keyDistance = 0.12 + threshold * 0.5;
  const feather = 0.006 + softness * 0.19;

  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3];
    if (!alpha) continue;

    const red = pixels[offset] / 255;
    const green = pixels[offset + 1] / 255;
    const blue = pixels[offset + 2] / 255;
    const distance = Math.sqrt(
      (red - keyRed) ** 2 + (green - keyGreen) ** 2 + (blue - keyBlue) ** 2,
    ) / Math.sqrt(3);
    const keySimilarity = 1 - smoothstep(keyDistance - feather, keyDistance + feather, distance);
    const chromaAmount = keySimilarity;

    if (chromaAmount <= 0) continue;

    const spillAmount = spill * Math.min(1, chromaAmount * 1.35);
    pixels[offset] = Math.round(pixels[offset] - keyChroma.r * spillAmount);
    pixels[offset + 1] = Math.round(pixels[offset + 1] - keyChroma.g * spillAmount);
    pixels[offset + 2] = Math.round(pixels[offset + 2] - keyChroma.b * spillAmount);
    pixels[offset + 3] = Math.round(alpha * (1 - chromaAmount));
  }

  targetCanvas.width = width;
  targetCanvas.height = height;
  targetCanvas.getContext("2d").putImageData(input, 0, 0);
}

function renderPreview() {
  if (!drawSourceFrame()) return;
  applyChromaKey(elements.previewCanvas);
}

function getCropRect() {
  return state.crop || {
    x: 0,
    y: 0,
    width: state.sourceWidth,
    height: state.sourceHeight,
  };
}

function isFullCrop(crop = getCropRect()) {
  return crop.x === 0
    && crop.y === 0
    && crop.width === state.sourceWidth
    && crop.height === state.sourceHeight;
}

function updatePreviewStageSize() {
  if (!state.sourceWidth || !state.sourceHeight || !elements.canvasWrap.offsetWidth) return;
  const availableWidth = elements.canvasWrap.clientWidth;
  const availableHeight = elements.canvasWrap.clientHeight;
  const scale = Math.min(availableWidth / state.sourceWidth, availableHeight / state.sourceHeight);
  const width = Math.max(1, Math.floor(state.sourceWidth * scale));
  const height = Math.max(1, Math.floor(state.sourceHeight * scale));

  elements.previewStage.style.width = `${width}px`;
  elements.previewStage.style.height = `${height}px`;
}

function updateCropUi() {
  const hasVideo = Boolean(state.file && state.sourceWidth && state.sourceHeight);
  const crop = getCropRect();
  const fullCrop = !hasVideo || isFullCrop(crop);
  const showSelection = hasVideo && (state.isCropMode || !fullCrop);

  elements.canvasWrap.classList.toggle("is-cropping", state.isCropMode);
  elements.cropSelection.classList.toggle("is-hidden", !showSelection);
  elements.cropModeButton.classList.toggle("is-active", state.isCropMode);
  elements.cropModeButton.setAttribute("aria-pressed", String(state.isCropMode));
  elements.cropModeButton.disabled = !hasVideo || state.isExporting;
  elements.resetCropButton.disabled = !hasVideo || state.isExporting || fullCrop;
  elements.sampleHint.textContent = state.isCropMode ? "拖动框选裁剪区域" : "点击画面取样背景色";

  if (!hasVideo) {
    elements.cropMeta.textContent = "完整画面";
    return;
  }

  if (showSelection) {
    elements.cropSelection.style.left = `${(crop.x / state.sourceWidth) * 100}%`;
    elements.cropSelection.style.top = `${(crop.y / state.sourceHeight) * 100}%`;
    elements.cropSelection.style.width = `${(crop.width / state.sourceWidth) * 100}%`;
    elements.cropSelection.style.height = `${(crop.height / state.sourceHeight) * 100}%`;
  }

  elements.cropMeta.textContent = fullCrop
    ? `完整画面 · ${state.sourceWidth} x ${state.sourceHeight} px`
    : `裁剪 ${crop.width} x ${crop.height} px`;
}

function setCropMode(enabled) {
  state.isCropMode = Boolean(enabled && state.file && !state.isExporting);
  state.cropStart = null;
  state.cropPointerId = null;
  updateCropUi();
}

function resetCrop() {
  state.crop = null;
  setCropMode(false);
}

function setOutputDimensions(width, height) {
  elements.originalSize.textContent = `${state.sourceWidth} x ${state.sourceHeight} px`;
  elements.outputWidthInput.value = String(width);
  elements.outputHeightInput.value = String(height);
}

function getOutputDimensions() {
  const width = Math.round(Number(elements.outputWidthInput.value));
  const height = Math.round(Number(elements.outputHeightInput.value));
  if (!Number.isFinite(width) || width < 1 || width > MAX_OUTPUT_DIMENSION) {
    throw new Error(`输出宽度应在 1 到 ${MAX_OUTPUT_DIMENSION} px 之间。`);
  }
  if (!Number.isFinite(height) || height < 1 || height > MAX_OUTPUT_DIMENSION) {
    throw new Error(`输出高度应在 1 到 ${MAX_OUTPUT_DIMENSION} px 之间。`);
  }
  if (width * height > MAX_OUTPUT_PIXELS) {
    throw new Error("输出尺寸过大，请降低宽度或高度。");
  }
  return { width, height };
}

function sampleBackdropColor() {
  if (!drawSourceFrame()) return;
  const sampleSize = clamp(Math.round(Math.min(state.sourceWidth, state.sourceHeight) * 0.07), 12, 56);
  const corners = [
    [0, 0],
    [state.sourceWidth - sampleSize, 0],
    [0, state.sourceHeight - sampleSize],
    [state.sourceWidth - sampleSize, state.sourceHeight - sampleSize],
  ];
  const samples = [];
  const bins = new Map();

  for (const [x, y] of corners) {
    const pixels = sourceContext.getImageData(x, y, sampleSize, sampleSize).data;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const alpha = pixels[offset + 3];
      if (alpha < 128) continue;

      const sample = { r: red, g: green, b: blue };
      const bin = `${red >> 4}:${green >> 4}:${blue >> 4}`;
      samples.push(sample);
      bins.set(bin, (bins.get(bin) || 0) + 1);
    }
  }

  if (samples.length < 12) return;
  const dominantBin = [...bins.entries()].reduce((best, entry) => (entry[1] > best[1] ? entry : best));
  const [binRed, binGreen, binBlue] = dominantBin[0].split(":").map(Number);
  const center = { r: binRed * 16 + 8, g: binGreen * 16 + 8, b: binBlue * 16 + 8 };
  const backdropSamples = samples.filter((sample) => (
    (sample.r - center.r) ** 2 + (sample.g - center.g) ** 2 + (sample.b - center.b) ** 2 <= 48 ** 2
  ));
  const selectedSamples = backdropSamples.length >= 12 ? backdropSamples : samples;

  state.keyColor = {
    r: median(selectedSamples.map((sample) => sample.r)),
    g: median(selectedSamples.map((sample) => sample.g)),
    b: median(selectedSamples.map((sample) => sample.b)),
  };
  updateKeyColorUi();
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round(sorted[Math.floor(sorted.length / 2)]);
}

function getSourcePoint(event, includeEdge = false) {
  const rect = elements.previewCanvas.getBoundingClientRect();
  const maxX = includeEdge ? state.sourceWidth : state.sourceWidth - 1;
  const maxY = includeEdge ? state.sourceHeight : state.sourceHeight - 1;
  return {
    x: clamp(Math.floor(((event.clientX - rect.left) / rect.width) * state.sourceWidth), 0, maxX),
    y: clamp(Math.floor(((event.clientY - rect.top) / rect.height) * state.sourceHeight), 0, maxY),
  };
}

function updateCropFromPoints(start, end) {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  state.crop = {
    x: left,
    y: top,
    width: Math.max(1, Math.abs(end.x - start.x)),
    height: Math.max(1, Math.abs(end.y - start.y)),
  };
  updateCropUi();
}

function startCropSelection(event) {
  if (!state.isCropMode || state.isExporting) return;
  event.preventDefault();
  const point = getSourcePoint(event, true);
  state.cropStart = { point, previousCrop: state.crop };
  state.cropPointerId = event.pointerId;
  elements.previewCanvas.setPointerCapture(event.pointerId);
  updateCropFromPoints(point, point);
}

function moveCropSelection(event) {
  if (!state.cropStart || event.pointerId !== state.cropPointerId) return;
  updateCropFromPoints(state.cropStart.point, getSourcePoint(event, true));
}

function finishCropSelection(event) {
  if (!state.cropStart || event.pointerId !== state.cropPointerId) return;
  const previousCrop = state.cropStart.previousCrop || {
    x: 0,
    y: 0,
    width: state.sourceWidth,
    height: state.sourceHeight,
  };
  const crop = getCropRect();
  if (crop.width < 2 || crop.height < 2) state.crop = state.cropStart.previousCrop;
  const currentCrop = getCropRect();
  const cropChanged = previousCrop.x !== currentCrop.x
    || previousCrop.y !== currentCrop.y
    || previousCrop.width !== currentCrop.width
    || previousCrop.height !== currentCrop.height;
  state.cropStart = null;
  state.cropPointerId = null;
  updateCropUi();
  if (cropChanged) {
    clearExportOutput();
    setProgress(0, "裁剪区域已更新，请重新导出 PNG 序列。");
  }
}

function sampleColorAtEvent(event) {
  if (!state.file || state.isExporting || state.isCropMode) return;
  const { x, y } = getSourcePoint(event);
  drawSourceFrame();
  const radius = 4;
  const startX = clamp(x - radius, 0, state.sourceWidth - 1);
  const startY = clamp(y - radius, 0, state.sourceHeight - 1);
  const sampleWidth = Math.min(radius * 2 + 1, state.sourceWidth - startX);
  const sampleHeight = Math.min(radius * 2 + 1, state.sourceHeight - startY);
  const data = sourceContext.getImageData(startX, startY, sampleWidth, sampleHeight).data;
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;

  for (let offset = 0; offset < data.length; offset += 4) {
    if (!data[offset + 3]) continue;
    red += data[offset];
    green += data[offset + 1];
    blue += data[offset + 2];
    count += 1;
  }
  if (!count) return;

  state.keyColor = {
    r: Math.round(red / count),
    g: Math.round(green / count),
    b: Math.round(blue / count),
  };
  updateKeyColorUi();
  renderPreview();
  setHeaderStatus("已从预览画面取样背景色");
}

function waitForVideoEvent(name) {
  const video = elements.sourceVideo;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener(name, onSuccess);
      video.removeEventListener("error", onError);
    };
    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("浏览器无法解码这个 MP4 视频。请尝试 H.264 编码的 MP4。"));
    };
    video.addEventListener(name, onSuccess, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

async function ensureVideoFrame() {
  if (elements.sourceVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
  await waitForVideoEvent("loadeddata");
}

async function seekVideo(time, force = false) {
  const video = elements.sourceVideo;
  const boundedTime = clamp(time, 0, Math.max(0, state.duration - 0.001));
  if (!force && Math.abs(video.currentTime - boundedTime) < 0.002 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return;
  }

  await new Promise((resolve, reject) => {
    let timeoutId;
    const cleanup = () => {
      clearTimeout(timeoutId);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("视频定位失败，无法继续导出。"));
    };
    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("视频定位超时，请重新选择视频后重试。"));
    }, 15000);
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = boundedTime;
  });
}

async function updatePreviewPosition() {
  const requestId = ++state.previewRequest;
  try {
    const requestedTime = Number(elements.timeInput.value);
    elements.timeValue.textContent = formatDuration(requestedTime);
    await seekVideo(requestedTime);
    if (requestId === state.previewRequest) renderPreview();
  } catch (error) {
    if (requestId === state.previewRequest) setProgress(0, error.message);
  }
}

async function handleVideo(file) {
  if (!isMp4(file)) {
    setProgress(0, "请选择 .mp4 格式的纯色背景视频。");
    return;
  }

  state.previewRequest += 1;
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.file = file;
  state.sourceWidth = 0;
  state.sourceHeight = 0;
  state.duration = 0;
  state.crop = null;
  clearExportOutput();
  state.objectUrl = URL.createObjectURL(file);
  setExporting(false);
  setProgress(0, "正在读取视频信息...");
  setHeaderStatus("正在读取 MP4 元数据");
  elements.videoName.textContent = file.name;
  elements.videoMeta.textContent = `${formatBytes(file.size)} · 正在读取视频`;
  elements.originalSize.textContent = "-- x -- px";
  elements.outputWidthInput.value = "";
  elements.outputHeightInput.value = "";
  elements.previewStage.style.width = "";
  elements.previewStage.style.height = "";
  elements.canvasWrap.classList.add("is-hidden");
  elements.dropZone.classList.remove("is-hidden");
  elements.sourceVideo.src = state.objectUrl;
  elements.sourceVideo.load();

  try {
    await waitForVideoEvent("loadedmetadata");
    await ensureVideoFrame();
    state.sourceWidth = elements.sourceVideo.videoWidth;
    state.sourceHeight = elements.sourceVideo.videoHeight;
    state.duration = elements.sourceVideo.duration;
    if (!state.sourceWidth || !state.sourceHeight || !Number.isFinite(state.duration)) {
      throw new Error("未能读取视频尺寸或时长。");
    }

    elements.sourceCanvas.width = state.sourceWidth;
    elements.sourceCanvas.height = state.sourceHeight;
    elements.previewCanvas.width = state.sourceWidth;
    elements.previewCanvas.height = state.sourceHeight;
    setOutputDimensions(state.sourceWidth, state.sourceHeight);
    resetCrop();
    await seekVideo(Math.min(0.001, Math.max(0, state.duration - 0.001)), true);
    elements.timeInput.max = String(state.duration);
    elements.timeInput.value = "0";
    elements.timeInput.disabled = false;
    elements.timeValue.textContent = formatDuration(0);
    elements.videoMeta.textContent = `${state.sourceWidth} x ${state.sourceHeight} · ${formatDuration(state.duration)} · ${formatBytes(file.size)}`;
    elements.canvasWrap.classList.remove("is-hidden");
    elements.dropZone.classList.add("is-hidden");
    sampleBackdropColor();
    renderPreview();
    requestAnimationFrame(() => {
      updatePreviewStageSize();
      updateCropUi();
    });
    setProgress(0, "预览已生成，可调节参数后导出 ZIP。");
    setHeaderStatus("已自动取样四角背景色");
    setExporting(false);
  } catch (error) {
    state.file = null;
    clearExportOutput();
    elements.videoName.textContent = "未能读取视频";
    elements.videoMeta.textContent = "请确认浏览器支持该 MP4 编码";
    elements.dropZone.classList.remove("is-hidden");
    setProgress(0, error.message || "视频读取失败。");
    setHeaderStatus("视频读取失败");
    setExporting(false);
  }
}

function canvasToPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PNG 编码失败。"));
    }, "image/png");
  });
}

async function requestSaveHandle(fileName) {
  if (typeof window.showSaveFilePicker !== "function") return null;

  try {
    return await window.showSaveFilePicker({
      suggestedName: fileName,
      types: [{
        description: "ZIP archive",
        accept: { "application/zip": [".zip"] },
      }],
    });
  } catch (error) {
    if (error?.name === "AbortError") return false;
    return null;
  }
}

async function saveWithHandle(handle, blob) {
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function nextFrame() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function exportFrames() {
  if (!state.file || state.isExporting) return;
  if (typeof window.JSZip !== "function") {
    setProgress(0, "压缩组件没有加载，请刷新页面后重试。");
    return;
  }

  const { frameRate } = getSettings();
  const frameCount = Math.max(1, Math.ceil(state.duration * frameRate - 0.00001));
  if (frameCount > MAX_EXPORT_FRAMES) {
    setProgress(0, `当前设置会导出 ${frameCount} 帧，超过 ${MAX_EXPORT_FRAMES} 帧上限。请降低帧率或缩短视频。`);
    return;
  }

  let output;
  try {
    output = getOutputDimensions();
  } catch (error) {
    setProgress(0, error.message);
    return;
  }
  const crop = getCropRect();
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = output.width;
  exportCanvas.height = output.height;
  const exportContext = exportCanvas.getContext("2d");
  const zip = new window.JSZip();
  const frameDigits = Math.max(4, String(frameCount).length);
  const baseName = sanitizeName(state.file.name);
  const outputFileName = `${baseName}_transparent_png_frames.zip`;
  setHeaderStatus("请选择 ZIP 的保存位置");
  const saveHandle = await requestSaveHandle(outputFileName);
  if (saveHandle === false) {
    setProgress(0, "已取消选择保存位置。");
    setHeaderStatus("导出已取消");
    return;
  }

  setExporting(true);
  setProgress(0, `正在抠像并编码 0 / ${frameCount} 帧`);
  setHeaderStatus("正在导出透明 PNG 序列");

  try {
    for (let index = 0; index < frameCount; index += 1) {
      await seekVideo(index / frameRate);
      drawSourceFrame();
      applyChromaKey(state.keyCanvas);
      exportContext.clearRect(0, 0, output.width, output.height);
      exportContext.drawImage(
        state.keyCanvas,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        output.width,
        output.height,
      );
      const png = await canvasToPng(exportCanvas);
      zip.file(`${baseName}_${String(index + 1).padStart(frameDigits, "0")}.png`, png, { compression: "STORE" });

      const progress = ((index + 1) / frameCount) * 84;
      setProgress(progress, `正在抠像并编码 ${index + 1} / ${frameCount} 帧`);
      if (index % 3 === 2) await nextFrame();
    }

    setProgress(86, "正在打包透明 PNG 序列 ZIP...");
    const zipBlob = await zip.generateAsync(
      { type: "blob", compression: "STORE" },
      (metadata) => setProgress(86 + metadata.percent * 0.14, "正在打包透明 PNG 序列 ZIP..."),
    );
    state.outputUrl = URL.createObjectURL(zipBlob);
    elements.downloadLink.href = state.outputUrl;
    elements.downloadLink.download = outputFileName;
    elements.exportButton.classList.add("is-hidden");
    elements.downloadLink.classList.remove("is-hidden");
    if (saveHandle) {
      await saveWithHandle(saveHandle, zipBlob);
      setProgress(100, `完成 ${frameCount} 帧 · ${output.width} x ${output.height} · ZIP ${formatBytes(zipBlob.size)}，已保存。`);
      setHeaderStatus("透明 PNG 序列已保存");
    } else {
      setProgress(100, `完成 ${frameCount} 帧 · ${output.width} x ${output.height} · ZIP ${formatBytes(zipBlob.size)}，点击重新下载。`);
      setHeaderStatus("透明 PNG 序列已生成，点击重新下载");
    }
    elements.timeInput.value = String(Math.min((frameCount - 1) / frameRate, Math.max(0, state.duration - 0.001)));
    elements.timeValue.textContent = formatDuration(Number(elements.timeInput.value));
    renderPreview();
  } catch (error) {
    console.error(error);
    setProgress(0, error.message || "导出失败，请重新尝试。");
    setHeaderStatus("导出未完成");
  } finally {
    setExporting(false);
  }
}

function bindEvents() {
  elements.videoInput.addEventListener("change", (event) => {
    handleVideo(event.target.files?.[0]);
    event.target.value = "";
  });

  for (const eventName of ["dragenter", "dragover"]) {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.add("is-dragging");
    });
  }

  for (const eventName of ["dragleave", "drop"]) {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.remove("is-dragging");
    });
  }

  elements.dropZone.addEventListener("drop", (event) => handleVideo(event.dataTransfer.files?.[0]));
  elements.previewCanvas.addEventListener("pointerdown", startCropSelection);
  elements.previewCanvas.addEventListener("pointermove", moveCropSelection);
  elements.previewCanvas.addEventListener("pointerup", finishCropSelection);
  elements.previewCanvas.addEventListener("pointercancel", finishCropSelection);
  elements.previewCanvas.addEventListener("click", sampleColorAtEvent);
  elements.sampleHint.addEventListener("click", () => {
    setHeaderStatus(state.isCropMode ? "拖动预览画面框选裁剪区域" : "在预览画面的背景区域点击取样");
    elements.previewCanvas.focus();
  });
  elements.sampleButton.addEventListener("click", () => {
    setCropMode(false);
    setHeaderStatus("在预览画面的背景区域点击取样");
  });
  elements.cropModeButton.addEventListener("click", () => {
    setCropMode(!state.isCropMode);
    setHeaderStatus(state.isCropMode ? "拖动预览画面框选裁剪区域" : "已退出裁剪模式");
  });
  elements.resetCropButton.addEventListener("click", () => {
    resetCrop();
    clearExportOutput();
    setProgress(0, "裁剪区域已重置，请重新导出 PNG 序列。");
    setHeaderStatus("裁剪区域已重置");
  });
  elements.timeInput.addEventListener("input", updatePreviewPosition);
  elements.exportButton.addEventListener("click", exportFrames);

  for (const input of [elements.thresholdInput, elements.softnessInput, elements.spillInput]) {
    input.addEventListener("input", () => {
      clearExportOutput();
      updateValueLabels();
      renderPreview();
      if (state.file) setProgress(0, "参数已更新，请重新导出 PNG 序列。");
    });
  }

  for (const input of [elements.frameRateInput, elements.outputWidthInput, elements.outputHeightInput]) {
    input.addEventListener("change", () => {
      clearExportOutput();
      if (state.file) setProgress(0, "输出设置已更新，请重新导出 PNG 序列。");
    });
  }

  window.addEventListener("resize", updatePreviewStageSize);
}

function init() {
  updateValueLabels();
  updateKeyColorUi();
  updateCropUi();
  bindEvents();
}

init();
