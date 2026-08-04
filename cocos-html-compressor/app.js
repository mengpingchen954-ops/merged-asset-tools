import { encodeWebp } from "./vendor/webp/encoder.js";

(() => {
  "use strict";

  const DECIMAL_MB = 1_000_000;
  const DATA_URL_EXTENSIONS = new Set([
    "png", "jpg", "jpeg", "webp", "bmp", "gif", "mp3", "m4a", "ogg", "wav", "cconb",
  ]);
  const PRESETS = {
    balanced: { name: "均衡", quality: 35, alphaQuality: 55 },
    strict: { name: "强力", quality: 23, alphaQuality: 38 },
    "very-strict": { name: "更强", quality: 20, alphaQuality: 32 },
    tiny: { name: "极限", quality: 16, alphaQuality: 24 },
  };
  const AUTO_PRESETS = ["balanced", "strict", "very-strict", "tiny"];
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();
  let wasmFallbackReported = false;

  const elements = {
    dropZone: document.querySelector("#dropZone"),
    fileInput: document.querySelector("#fileInput"),
    targetInput: document.querySelector("#targetInput"),
    presetSelect: document.querySelector("#presetSelect"),
    compressBtn: document.querySelector("#compressBtn"),
    clearBtn: document.querySelector("#clearBtn"),
    downloadAllBtn: document.querySelector("#downloadAllBtn"),
    beforeSize: document.querySelector("#beforeSize"),
    innerSize: document.querySelector("#innerSize"),
    imageCount: document.querySelector("#imageCount"),
    afterSize: document.querySelector("#afterSize"),
    statusText: document.querySelector("#statusText"),
    progressText: document.querySelector("#progressText"),
    progressBar: document.querySelector("#progressBar"),
    emptyState: document.querySelector("#emptyState"),
    errorState: document.querySelector("#errorState"),
    warningState: document.querySelector("#warningState"),
    resultList: document.querySelector("#resultList"),
    htmlName: document.querySelector("#htmlName"),
    htmlMeta: document.querySelector("#htmlMeta"),
    zipName: document.querySelector("#zipName"),
    zipMeta: document.querySelector("#zipMeta"),
    landscapeName: document.querySelector("#landscapeName"),
    landscapeMeta: document.querySelector("#landscapeMeta"),
    portraitName: document.querySelector("#portraitName"),
    portraitMeta: document.querySelector("#portraitMeta"),
  };

  const state = {
    inputFile: null,
    inputHtml: "",
    zipBytes: null,
    zipLocation: null,
    inputStats: null,
    outputs: null,
    processing: false,
  };

  initialise();

  function initialise() {
    elements.fileInput.addEventListener("change", () => {
      const [file] = elements.fileInput.files || [];
      if (file) loadInput(file);
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
    elements.dropZone.addEventListener("drop", (event) => {
      const [file] = event.dataTransfer?.files || [];
      if (file) loadInput(file);
    });
    elements.compressBtn.addEventListener("click", compressInput);
    elements.clearBtn.addEventListener("click", resetInput);
    elements.downloadAllBtn.addEventListener("click", downloadAll);
    document.querySelectorAll("[data-download]").forEach((button) => {
      button.addEventListener("click", () => downloadOutput(button.dataset.download));
    });
  }

  async function loadInput(file) {
    resetMessages();
    resetOutputs();
    if (!window.JSZip) {
      showError("ZIP 组件未加载，请刷新页面后重试。");
      return;
    }
    if (!/\.html?$/i.test(file.name)) {
      showError("请选择 .html 文件。");
      return;
    }

    setControlsDisabled(true);
    setProgress(4, "正在读取 HTML…");
    let readyToCompress = false;
    try {
      const inputHtml = await file.text();
      const zipLocation = findEmbeddedZip(inputHtml);
      if (!zipLocation) {
        throw new Error("没有找到 window.__zip。请选择 Cocos super-html 单文件构建结果。");
      }

      const zipBytes = base64ToBytes(zipLocation.base64);
      setProgress(15, "正在检查内嵌资源…");
      const zip = await window.JSZip.loadAsync(zipBytes);
      const inputStats = await inspectZip(zip);

      state.inputFile = file;
      state.inputHtml = inputHtml;
      state.zipBytes = zipBytes;
      state.zipLocation = zipLocation;
      state.inputStats = inputStats;
      elements.beforeSize.textContent = formatBytes(file.size);
      elements.innerSize.textContent = formatBytes(zipBytes.byteLength);
      elements.imageCount.textContent = String(inputStats.pngCount);
      elements.afterSize.textContent = "-";
      elements.clearBtn.disabled = false;
      elements.compressBtn.disabled = false;
      setProgress(0, `${file.name} 已就绪`, false);
      readyToCompress = true;
    } catch (error) {
      clearState();
      showError(error instanceof Error ? error.message : "无法读取这个 HTML。");
      setProgress(0, "文件不可用", false);
    } finally {
      setControlsDisabled(false);
    }
    if (readyToCompress) await compressInput();
  }

  async function inspectZip(zip) {
    let pngCount = Object.values(zip.files).filter((entry) => !entry.dir && getExtension(entry.name) === "png").length;
    const resEntry = zip.file("__res");
    if (resEntry) {
      try {
        const res = JSON.parse(await resEntry.async("string"));
        pngCount += Object.keys(res).filter((key) => key.toLowerCase().endsWith(".png")).length;
      } catch {
        // A malformed __res will be left untouched during compression.
      }
    }
    const audioCount = Object.values(zip.files).filter((entry) => !entry.dir && getExtension(entry.name) === "m4a").length;
    return { pngCount, audioCount };
  }

  function findEmbeddedZip(html) {
    const match = /window\.__zip\s*=\s*(["'])([A-Za-z0-9+/=]+)\1/.exec(html);
    if (!match || match.index === undefined) return null;
    const relativeStart = match[0].indexOf(match[2]);
    const valueStart = match.index + relativeStart;
    return {
      valueStart,
      valueEnd: valueStart + match[2].length,
      base64: match[2],
    };
  }

  async function compressInput() {
    if (!state.inputFile || !state.zipBytes || state.processing) return;
    resetMessages();
    resetOutputs();
    state.processing = true;
    setControlsDisabled(true);

    try {
      const targetBytes = clamp(Number(elements.targetInput.value) || 5, 1, 20) * DECIMAL_MB;
      const selectedPreset = elements.presetSelect.value;
      const presetKeys = selectedPreset === "auto" ? AUTO_PRESETS : [selectedPreset];
      let bestResult = null;

      for (let index = 0; index < presetKeys.length; index += 1) {
        const preset = PRESETS[presetKeys[index]];
        const result = await runPreset(preset, index, presetKeys.length);
        if (!bestResult || result.maximumSize < bestResult.maximumSize) bestResult = result;
        if (allOutputsUnder(result, targetBytes)) break;
        await yieldToBrowser();
      }

      if (!bestResult) throw new Error("没有生成压缩结果。");
      state.outputs = buildOutputRecords(bestResult);
      renderResults(bestResult, targetBytes);
      setProgress(100, "压缩完成");
    } catch (error) {
      showError(error instanceof Error ? error.message : "压缩失败。");
      setProgress(0, "压缩失败", false);
    } finally {
      state.processing = false;
      setControlsDisabled(false);
    }
  }

  async function runPreset(preset, presetIndex, presetCount) {
    const zip = await window.JSZip.loadAsync(state.zipBytes);
    const obfuscationIndices = await detectObfuscationIndices(zip);
    const runtimePatched = await patchRuntimeObfuscation(zip);
    const pngEntries = Object.values(zip.files).filter((entry) => !entry.dir && getExtension(entry.name) === "png");
    let converted = 0;
    let savedBytes = 0;

    for (let index = 0; index < pngEntries.length; index += 1) {
      const result = await compressLoosePng(zip, pngEntries[index], preset, obfuscationIndices);
      converted += result.converted;
      savedBytes += result.savedBytes;
      const fraction = pngEntries.length ? (index + 1) / pngEntries.length : 1;
      const passProgress = ((presetIndex + fraction * 0.62) / presetCount) * 82;
      setProgress(6 + passProgress, `${preset.name}：正在压缩 ${pngEntries[index].name}`);
      if (index % 2 === 0) await yieldToBrowser();
    }

    const resResult = await compressResDataUrls(zip, preset, obfuscationIndices);
    converted += resResult.converted;
    savedBytes += resResult.savedBytes;
    await normalizeLooseDataUrls(zip, obfuscationIndices);

    setProgress(88, `${preset.name}：正在重新打包…`);
    const innerZipBytes = await zip.generateAsync(
      { type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } },
      ({ percent }) => setProgress(88 + percent * 0.06, `${preset.name}：正在重新打包…`),
    );

    const commonHtml = replaceEmbeddedZip(setOrientation(state.inputHtml, "portrait,landscape"), innerZipBytes);
    const landscapeHtml = replaceEmbeddedZip(setOrientation(state.inputHtml, "landscape"), innerZipBytes);
    const portraitHtml = replaceEmbeddedZip(setOrientation(state.inputHtml, "portrait"), innerZipBytes);
    const [commonZip, landscapeZip, portraitZip] = await Promise.all([
      createOuterZip(commonHtml),
      createOuterZip(landscapeHtml),
      createOuterZip(portraitHtml),
    ]);
    const htmlBlob = new Blob([commonHtml], { type: "text/html;charset=utf-8" });
    const maximumSize = Math.max(htmlBlob.size, commonZip.byteLength, landscapeZip.byteLength, portraitZip.byteLength);

    return {
      preset,
      htmlBlob,
      commonZip,
      landscapeZip,
      portraitZip,
      innerZipBytes,
      maximumSize,
      converted,
      savedBytes,
      runtimePatched,
      resResult,
    };
  }

  async function compressLoosePng(zip, entry, preset, obfuscationIndices) {
    const original = await entry.async("uint8array");
    const originalText = bytesStartWith(original, "data:") ? textDecoder.decode(original) : null;
    const parsed = originalText ? parseDataUrl(originalText, obfuscationIndices) : null;
    const sourceBytes = parsed ? parsed.data : original;

    if (parsed?.mime === "image/webp") {
      const normalized = textEncoder.encode(makeDataUrl(parsed.mime, parsed.data));
      if (normalized.byteLength < original.byteLength) zip.file(entry.name, normalized);
      return { converted: 0, savedBytes: Math.max(0, original.byteLength - normalized.byteLength) };
    }

    const webp = await compressImageToWebp(sourceBytes, preset);
    if (!webp) return { converted: 0, savedBytes: 0 };
    const next = textEncoder.encode(makeDataUrl("image/webp", webp));
    if (next.byteLength >= original.byteLength) return { converted: 0, savedBytes: 0 };
    zip.file(entry.name, next);
    return { converted: 1, savedBytes: original.byteLength - next.byteLength };
  }

  async function compressResDataUrls(zip, preset, obfuscationIndices) {
    const entry = zip.file("__res");
    if (!entry) return { converted: 0, savedBytes: 0, splashRemoved: false };

    let res;
    const beforeText = await entry.async("string");
    try {
      res = JSON.parse(beforeText);
    } catch {
      return { converted: 0, savedBytes: 0, splashRemoved: false };
    }

    let converted = 0;
    let imageSavedBytes = 0;
    for (const [key, value] of Object.entries(res)) {
      if (typeof value !== "string" || !value.startsWith("data:")) continue;
      const parsed = parseDataUrl(value, obfuscationIndices);
      if (!parsed) continue;

      if (!key.toLowerCase().endsWith(".png") || parsed.mime === "image/webp") {
        res[key] = makeDataUrl(parsed.mime, parsed.data);
        continue;
      }

      const webp = await compressImageToWebp(parsed.data, preset);
      if (!webp) {
        res[key] = makeDataUrl(parsed.mime, parsed.data);
        continue;
      }
      const nextValue = makeDataUrl("image/webp", webp);
      if (byteLength(nextValue) < byteLength(value)) {
        res[key] = nextValue;
        converted += 1;
        imageSavedBytes += byteLength(value) - byteLength(nextValue);
      } else {
        res[key] = makeDataUrl(parsed.mime, parsed.data);
      }
      if (converted % 2 === 0) await yieldToBrowser();
    }

    let splashRemoved = false;
    if (typeof res["src/settings.json"] === "string") {
      try {
        const settings = JSON.parse(res["src/settings.json"]);
        if (settings.splashScreen) {
          settings.splashScreen.totalTime = 0;
          settings.splashScreen.logo = { type: "none" };
          res["src/settings.json"] = JSON.stringify(settings);
          splashRemoved = true;
        }
      } catch {
        // Keep malformed settings unchanged.
      }
    }

    const afterText = JSON.stringify(res);
    zip.file("__res", afterText);
    return {
      converted,
      savedBytes: Math.max(imageSavedBytes, byteLength(beforeText) - byteLength(afterText)),
      splashRemoved,
    };
  }

  async function normalizeLooseDataUrls(zip, obfuscationIndices) {
    const entries = Object.values(zip.files).filter((entry) => {
      return !entry.dir && DATA_URL_EXTENSIONS.has(getExtension(entry.name));
    });
    for (const entry of entries) {
      const bytes = await entry.async("uint8array");
      if (!bytesStartWith(bytes, "data:")) continue;
      const parsed = parseDataUrl(textDecoder.decode(bytes), obfuscationIndices);
      if (parsed) zip.file(entry.name, makeDataUrl(parsed.mime, parsed.data));
    }
  }

  async function detectObfuscationIndices(zip) {
    const indices = [];
    const jsEntries = Object.values(zip.files).filter((entry) => !entry.dir && getExtension(entry.name) === "js");
    for (const entry of jsEntries) {
      const text = await entry.async("string");
      for (const match of text.matchAll(/(?:window\.)?(?:oasjidx|_my)\s*=\s*(\d+)/g)) {
        const value = Number(match[1]);
        if (Number.isInteger(value) && value >= 0 && !indices.includes(value)) indices.push(value);
      }
    }
    for (const fallback of [21, 30]) if (!indices.includes(fallback)) indices.push(fallback);
    return indices;
  }

  async function patchRuntimeObfuscation(zip) {
    const entry = zip.file("index.js");
    if (!entry) return false;
    const before = await entry.async("string");
    const after = before
      .replace(/window\.oasjidx\s*=\s*\d+/g, "window.oasjidx=0")
      .replace(/window\._my\s*=\s*\d+/g, "window._my=0");
    if (after !== before) {
      zip.file("index.js", after);
      return true;
    }
    return false;
  }

  function parseDataUrl(value, obfuscationIndices) {
    const cleanValue = cleanDataUrl(value, obfuscationIndices);
    const comma = cleanValue.indexOf(",");
    if (comma < 0 || !cleanValue.startsWith("data:")) return null;
    const header = cleanValue.slice(5, comma);
    if (!/;base64$/i.test(header)) return null;
    const mime = header.split(";")[0];
    try {
      return { mime, data: base64ToBytes(cleanValue.slice(comma + 1)) };
    } catch {
      return null;
    }
  }

  function cleanDataUrl(value, obfuscationIndices) {
    const original = parseDataUrlSyntax(value);
    if (original && dataUrlLooksUsable(original)) return value;
    const originalMime = original?.mime || null;
    const candidates = [...obfuscationIndices];
    if (original) candidates.push(original.comma + 9, original.comma + 8);

    for (const index of candidates) {
      if (!Number.isInteger(index) || index < 0 || index >= value.length) continue;
      const candidate = `${value.slice(0, index)}${value.slice(index + 1)}`;
      const parts = parseDataUrlSyntax(candidate);
      if (!parts || (originalMime && parts.mime !== originalMime)) continue;
      if (dataUrlLooksUsable(parts)) return candidate;
    }

    const comma = value.indexOf(",");
    if (comma >= 0) {
      const normalized = `${value.slice(0, comma).replace(/;base64\d+$/i, ";base64")}${value.slice(comma)}`;
      const parts = parseDataUrlSyntax(normalized);
      if (parts && dataUrlLooksUsable(parts)) return normalized;
    }
    return value;
  }

  function parseDataUrlSyntax(value) {
    const comma = value.indexOf(",");
    if (comma < 0 || !value.startsWith("data:")) return null;
    const header = value.slice(5, comma);
    const payload = value.slice(comma + 1);
    if (!/;base64$/i.test(header) || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return null;
    try {
      return { comma, mime: header.split(";")[0], data: base64ToBytes(payload) };
    } catch {
      return null;
    }
  }

  function dataUrlLooksUsable(parts) {
    const { mime, data } = parts;
    if (mime === "image/png") return matchesBytes(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (mime === "image/jpeg") return data[0] === 0xff && data[1] === 0xd8;
    if (mime === "image/webp") return ascii(data, 0, 4) === "RIFF" && ascii(data, 8, 12) === "WEBP";
    if (mime === "audio/mp4" || mime === "audio/x-m4a") return ascii(data, 4, 8) === "ftyp";
    if (mime === "audio/mpeg") return ascii(data, 0, 3) === "ID3" || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0);
    return true;
  }

  async function compressImageToWebp(bytes, preset) {
    let bitmap;
    try {
      const blob = new Blob([bytes], { type: "image/png" });
      bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) return null;
      context.drawImage(bitmap, 0, 0);
      try {
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        return await encodeWebp(imageData, {
          quality: preset.quality,
          alpha_quality: preset.alphaQuality,
          method: 6,
          use_sharp_yuv: 1,
        });
      } catch (wasmError) {
        if (!wasmFallbackReported) {
          console.warn("WebP WASM encoder unavailable; using browser encoder.", wasmError);
          wasmFallbackReported = true;
        }
      }
      const webpBlob = await new Promise((resolve) => {
        canvas.toBlob(resolve, "image/webp", preset.quality / 100);
      });
      return webpBlob ? new Uint8Array(await webpBlob.arrayBuffer()) : null;
    } catch {
      return null;
    } finally {
      if (bitmap?.close) bitmap.close();
    }
  }

  function replaceEmbeddedZip(html, zipBytes) {
    const location = findEmbeddedZip(html);
    if (!location) throw new Error("输出模板中的 window.__zip 已丢失。");
    const base64 = bytesToBase64(zipBytes);
    return `${html.slice(0, location.valueStart)}${base64}${html.slice(location.valueEnd)}`;
  }

  function setOrientation(html, orientation) {
    return html.replace(
      /(<meta\s+name=["']ad\.orientation["']\s+content=["'])[^"']*(["'])/i,
      `$1${orientation}$2`,
    );
  }

  async function createOuterZip(html) {
    const zip = new window.JSZip();
    zip.file("index.html", html);
    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } });
  }

  function buildOutputRecords(result) {
    const baseName = state.inputFile.name.replace(/\.[^.]+$/, "");
    return {
      html: { name: `${baseName}-5mb.html`, blob: result.htmlBlob },
      zip: { name: `${baseName}-5mb.zip`, blob: new Blob([result.commonZip], { type: "application/zip" }) },
      landscape: { name: `${baseName}-5mb-landscape.zip`, blob: new Blob([result.landscapeZip], { type: "application/zip" }) },
      portrait: { name: `${baseName}-5mb-portrait.zip`, blob: new Blob([result.portraitZip], { type: "application/zip" }) },
    };
  }

  function renderResults(result, targetBytes) {
    const outputs = state.outputs;
    elements.afterSize.textContent = formatBytes(result.htmlBlob.size);
    elements.htmlName.textContent = outputs.html.name;
    elements.htmlMeta.textContent = `${formatBytes(outputs.html.blob.size)} · ${result.preset.name}预设`;
    elements.zipName.textContent = outputs.zip.name;
    elements.zipMeta.textContent = `${formatBytes(outputs.zip.blob.size)} · 横竖版通用`;
    elements.landscapeName.textContent = outputs.landscape.name;
    elements.landscapeMeta.textContent = formatBytes(outputs.landscape.blob.size);
    elements.portraitName.textContent = outputs.portrait.name;
    elements.portraitMeta.textContent = formatBytes(outputs.portrait.blob.size);
    elements.emptyState.hidden = true;
    elements.resultList.hidden = false;
    elements.downloadAllBtn.disabled = false;

    const underTarget = allOutputsUnder(result, targetBytes);
    const savings = Math.max(0, state.inputFile.size - result.htmlBlob.size);
    const savedPercent = state.inputFile.size ? Math.round((savings / state.inputFile.size) * 100) : 0;
    elements.statusText.textContent = `${result.converted} 张 PNG 已优化，HTML 减少 ${savedPercent}%`;
    const warnings = [];
    if (!underTarget) warnings.push(`最小结果仍超过 ${formatBytes(targetBytes)}，请检查大音频或不可压缩资源。`);
    if (state.inputStats.audioCount > 0) warnings.push(`浏览器版保留了 ${state.inputStats.audioCount} 个 M4A 音频文件。`);
    if (warnings.length) showWarning(warnings.join(" "));
  }

  function allOutputsUnder(result, targetBytes) {
    return result.htmlBlob.size <= targetBytes
      && result.commonZip.byteLength <= targetBytes
      && result.landscapeZip.byteLength <= targetBytes
      && result.portraitZip.byteLength <= targetBytes;
  }

  function downloadOutput(key) {
    const output = state.outputs?.[key];
    if (output) triggerDownload(output.blob, output.name);
  }

  async function downloadAll() {
    if (!state.outputs || state.processing) return;
    elements.downloadAllBtn.disabled = true;
    const previousText = elements.downloadAllBtn.lastChild.textContent;
    elements.downloadAllBtn.lastChild.textContent = " 正在打包";
    try {
      const zip = new window.JSZip();
      for (const output of Object.values(state.outputs)) zip.file(output.name, output.blob);
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      const baseName = state.inputFile.name.replace(/\.[^.]+$/, "");
      triggerDownload(blob, `${baseName}-5mb-outputs.zip`);
    } finally {
      elements.downloadAllBtn.lastChild.textContent = previousText;
      elements.downloadAllBtn.disabled = false;
    }
  }

  function triggerDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function resetInput() {
    clearState();
    elements.fileInput.value = "";
    elements.beforeSize.textContent = "0 B";
    elements.innerSize.textContent = "0 B";
    elements.imageCount.textContent = "0";
    elements.afterSize.textContent = "-";
    elements.clearBtn.disabled = true;
    elements.compressBtn.disabled = true;
    resetMessages();
    resetOutputs();
    setProgress(0, "等待选择 HTML", false);
  }

  function clearState() {
    state.inputFile = null;
    state.inputHtml = "";
    state.zipBytes = null;
    state.zipLocation = null;
    state.inputStats = null;
    state.outputs = null;
  }

  function resetOutputs() {
    state.outputs = null;
    elements.emptyState.hidden = false;
    elements.resultList.hidden = true;
    elements.downloadAllBtn.disabled = true;
    elements.afterSize.textContent = "-";
  }

  function resetMessages() {
    elements.errorState.hidden = true;
    elements.errorState.textContent = "";
    elements.warningState.hidden = true;
    elements.warningState.textContent = "";
  }

  function showError(message) {
    elements.emptyState.hidden = true;
    elements.errorState.textContent = message;
    elements.errorState.hidden = false;
  }

  function showWarning(message) {
    elements.warningState.textContent = message;
    elements.warningState.hidden = false;
  }

  function setControlsDisabled(disabled) {
    elements.fileInput.disabled = disabled;
    elements.targetInput.disabled = disabled;
    elements.presetSelect.disabled = disabled;
    elements.compressBtn.disabled = disabled || !state.inputFile;
    elements.clearBtn.disabled = disabled || !state.inputFile;
  }

  function setProgress(value, text, showValue = true) {
    const normalized = clamp(Number(value) || 0, 0, 100);
    elements.progressBar.style.width = `${normalized}%`;
    elements.progressText.textContent = showValue ? `${Math.round(normalized)}%` : "0%";
    elements.statusText.textContent = text;
  }

  function makeDataUrl(mime, bytes) {
    return `data:${mime};base64,${bytesToBase64(bytes)}`;
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function bytesToBase64(bytes) {
    const chunks = [];
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      chunks.push(String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))));
    }
    return btoa(chunks.join(""));
  }

  function bytesStartWith(bytes, value) {
    if (bytes.length < value.length) return false;
    for (let index = 0; index < value.length; index += 1) {
      if (bytes[index] !== value.charCodeAt(index)) return false;
    }
    return true;
  }

  function matchesBytes(bytes, signature) {
    return signature.every((value, index) => bytes[index] === value);
  }

  function ascii(bytes, start, end) {
    return String.fromCharCode(...bytes.subarray(start, end));
  }

  function byteLength(value) {
    return textEncoder.encode(value).byteLength;
  }

  function getExtension(fileName) {
    const match = /\.([^.\/]+)$/.exec(fileName);
    return match ? match[1].toLowerCase() : "";
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1000)), units.length - 1);
    const value = bytes / (1000 ** index);
    const digits = index === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(digits)} ${units[index]}`;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function yieldToBrowser() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
})();
