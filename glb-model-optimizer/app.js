(() => {
  "use strict";

  const GLB_MAGIC = 0x46546c67;
  const JSON_CHUNK = 0x4e4f534a;
  const BIN_CHUNK = 0x004e4942;
  const STRUCTURE_KEYS = ["scenes", "nodes", "meshes", "materials", "textures", "images", "accessors", "bufferViews"];
  const STRUCTURE_LABELS = {
    scenes: "场景",
    nodes: "节点",
    meshes: "网格",
    materials: "材质",
    textures: "贴图引用",
    images: "图像",
    accessors: "访问器",
    bufferViews: "数据视图",
  };
  const SUPPORTED_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
  const textDecoder = new TextDecoder("utf-8");
  const textEncoder = new TextEncoder();

  const elements = {
    afterSize: document.querySelector("#afterSize"),
    beforeSize: document.querySelector("#beforeSize"),
    clearBtn: document.querySelector("#clearBtn"),
    downloadBtn: document.querySelector("#downloadBtn"),
    dropZone: document.querySelector("#dropZone"),
    emptyState: document.querySelector("#emptyState"),
    errorState: document.querySelector("#errorState"),
    fileInput: document.querySelector("#fileInput"),
    geometryCount: document.querySelector("#geometryCount"),
    geometryMethodHint: document.querySelector("#geometryMethodHint"),
    geometryMethodSelect: document.querySelector("#geometryMethodSelect"),
    geometryReductionHint: document.querySelector("#geometryReductionHint"),
    geometryReductionSelect: document.querySelector("#geometryReductionSelect"),
    geometryMemoryAfter: document.querySelector("#geometryMemoryAfter"),
    geometryMemoryBefore: document.querySelector("#geometryMemoryBefore"),
    maxSizeSelect: document.querySelector("#maxSizeSelect"),
    memoryAfter: document.querySelector("#memoryAfter"),
    memoryBefore: document.querySelector("#memoryBefore"),
    optimizeBtn: document.querySelector("#optimizeBtn"),
    outputMeta: document.querySelector("#outputMeta"),
    outputName: document.querySelector("#outputName"),
    progressBar: document.querySelector("#progressBar"),
    progressText: document.querySelector("#progressText"),
    qualityInput: document.querySelector("#qualityInput"),
    qualityValue: document.querySelector("#qualityValue"),
    resizeCount: document.querySelector("#resizeCount"),
    resultState: document.querySelector("#resultState"),
    statusText: document.querySelector("#statusText"),
    structureBadge: document.querySelector("#structureBadge"),
    structureGrid: document.querySelector("#structureGrid"),
    textureCount: document.querySelector("#textureCount"),
    warningState: document.querySelector("#warningState"),
  };

  const state = {
    inputFile: null,
    parsed: null,
    analysis: null,
    output: null,
    processing: false,
  };

  elements.fileInput.addEventListener("change", () => {
    const [file] = elements.fileInput.files;
    if (file) loadFile(file);
  });
  elements.qualityInput.addEventListener("input", () => {
    elements.qualityValue.textContent = `${elements.qualityInput.value}%`;
    invalidateOutput();
  });
  elements.maxSizeSelect.addEventListener("change", invalidateOutput);
  elements.geometryReductionSelect.addEventListener("change", () => {
    updateGeometryReductionHint();
    invalidateOutput();
  });
  elements.geometryMethodSelect.addEventListener("change", () => {
    updateGeometryMethodHint();
    updateGeometryReductionHint();
    invalidateOutput();
    setControlsDisabled(false);
  });
  elements.optimizeBtn.addEventListener("click", optimizeModel);
  elements.clearBtn.addEventListener("click", resetAll);
  elements.downloadBtn.addEventListener("click", downloadOutput);

  for (const eventName of ["dragenter", "dragover"]) {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (!state.processing) elements.dropZone.classList.add("is-dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.remove("is-dragging");
    });
  }
  elements.dropZone.addEventListener("drop", (event) => {
    if (state.processing) return;
    const [file] = event.dataTransfer.files;
    if (file) loadFile(file);
  });

  async function loadFile(file) {
    resetMessages();
    resetResult();
    if (!/\.glb$/i.test(file.name)) {
      showError("请选择 .glb 格式的模型文件。");
      return;
    }

    setControlsDisabled(true);
    setProgress(2, "正在读取 GLB…");
    try {
      const parsed = parseGlb(await file.arrayBuffer());
      validateDocument(parsed);
      const analysis = analyzeImages(parsed);
      const geometry = analyzeGeometry(parsed.json);
      state.inputFile = file;
      state.parsed = parsed;
      state.analysis = analysis;
      elements.beforeSize.textContent = formatBytes(file.size);
      elements.textureCount.textContent = String(parsed.json.textures?.length || parsed.json.images?.length || 0);
      elements.geometryCount.textContent = `${formatInteger(geometry.vertices)} 顶点`;
      elements.geometryMemoryBefore.textContent = formatMemory(geometry.memoryBytes);
      elements.geometryMemoryAfter.textContent = "-";
      elements.dropZone.querySelector("strong").textContent = file.name;
      elements.dropZone.querySelector("span:last-child").textContent = `${formatInteger(geometry.vertices)} 顶点 · ${analysis.candidates.length} 张可处理贴图 · ${formatBytes(file.size)}`;
      elements.emptyState.hidden = false;
      elements.emptyState.querySelector("strong").textContent = "模型已就绪";
      elements.emptyState.querySelector("span").textContent = "选择网格减面和贴图尺寸后开始处理。";
      if (analysis.unsupported.length) {
        showWarning(`${analysis.unsupported.length} 张非 PNG/JPEG/WebP 贴图将原样保留。`);
      }
      const readyText = analysis.candidates.length
        ? `已读取 ${formatInteger(geometry.vertices)} 个顶点、${analysis.candidates.length} 张内嵌贴图`
        : `已读取 ${formatInteger(geometry.vertices)} 个顶点；没有贴图，仍可压缩网格`;
      setProgress(0, readyText, false);
    } catch (error) {
      state.inputFile = null;
      state.parsed = null;
      state.analysis = null;
      elements.beforeSize.textContent = "0 B";
      elements.geometryMemoryBefore.textContent = "-";
      elements.geometryMemoryAfter.textContent = "-";
      showError(errorMessage(error));
      setProgress(0, "无法读取 GLB", false);
    } finally {
      setControlsDisabled(false);
    }
  }

  async function optimizeModel() {
    if (!state.inputFile || !state.parsed || state.processing) return;
    state.processing = true;
    resetMessages();
    resetResult();
    setControlsDisabled(true);

    const maxSize = Number(elements.maxSizeSelect.value);
    const quality = Number(elements.qualityInput.value) / 100;
    const geometryMethod = elements.geometryMethodSelect.value;
    const geometryReduction = Number(elements.geometryReductionSelect.value);
    const json = JSON.parse(JSON.stringify(state.parsed.json));
    const candidates = state.analysis.candidates;
    const replacements = [];
    let resized = 0;
    let skipped = state.analysis.unsupported.length;
    let decodedBefore = 0;
    let decodedAfter = 0;

    try {
      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        setProgress(
          4 + (index / Math.max(1, candidates.length)) * 68,
          `正在处理贴图 ${index + 1} / ${candidates.length}`,
        );

        const sourceBytes = readCandidateBytes(state.parsed, candidate);
        const decoded = await decodeImage(sourceBytes, candidate.mime);
        const sourceMemory = decoded.width * decoded.height * 4;
        decodedBefore += sourceMemory * candidate.imageIndexes.length;

        const scale = Math.min(1, maxSize / Math.max(decoded.width, decoded.height));
        const width = Math.max(1, Math.round(decoded.width * scale));
        const height = Math.max(1, Math.round(decoded.height * scale));
        decodedAfter += width * height * 4 * candidate.imageIndexes.length;

        if (scale < 1) {
          const encoded = await resizeAndEncode(decoded, width, height, candidate.mime, quality);
          replacements.push({ ...candidate, bytes: encoded });
          resized += candidate.imageIndexes.length;
        } else {
          skipped += candidate.imageIndexes.length;
        }
        decoded.close?.();
        if ((index + 1) % 4 === 0) await yieldToBrowser();
      }

      setProgress(74, "正在重建贴图数据…");
      applyDataUriReplacements(json, replacements);
      const binaryReplacements = replacements.filter((item) => item.source === "bufferView");
      const binary = rebuildBinary(state.parsed, json, binaryReplacements);
      let outputBytes = buildGlb(state.parsed, json, binary);

      if (isGeometryCompressionMethod(geometryMethod)) {
        if (!window.GeometryCompressor?.compress) throw new Error("网格压缩模块加载失败，请刷新页面后重试。");
        setProgress(82, `正在执行 ${geometryMethodLabel(geometryMethod)} 网格压缩…`);
        outputBytes = await window.GeometryCompressor.compress(outputBytes, geometryMethod);
      } else if (geometryMethod === "cocos") {
        if (!window.GeometryCompressor?.compress) throw new Error("网格优化模块加载失败，请刷新页面后重试。");
        setProgress(82, "正在执行 Cocos 兼容网格优化…");
        outputBytes = await window.GeometryCompressor.compress(outputBytes, geometryMethod, { ratio: geometryReduction });
      }

      setProgress(96, "正在校验模型结构…");
      const verified = parseGlb(outputBytes.buffer);
      validateDocument(verified);
      const beforeCounts = structureCounts(state.parsed.json);
      const afterCounts = structureCounts(verified.json);
      const geometryBefore = analyzeGeometry(state.parsed.json);
      const geometryAfter = analyzeGeometry(verified.json);
      verifyStructure(beforeCounts, afterCounts, geometryMethod);
      verifyCompressionExtension(verified.json, geometryMethod);

      const baseName = state.inputFile.name.replace(/\.glb$/i, "");
      const suffix = [
        isGeometryCompressionMethod(geometryMethod) ? geometryMethod : null,
        geometryMethod === "cocos" && geometryReduction < 0.999 ? `mesh${Math.round(geometryReduction * 100)}` : null,
        candidates.length ? `max${maxSize}` : null,
      ]
        .filter(Boolean)
        .join(".");
      const outputName = `${baseName}.${suffix || "optimized"}.glb`;
      const blob = new Blob([outputBytes], { type: "model/gltf-binary" });
      state.output = { blob, name: outputName };
      renderResult({
        afterCounts,
        beforeCounts,
        decodedAfter,
        decodedBefore,
        geometryAfter,
        geometryBefore,
        geometryReduction,
        maxSize,
        geometryMethod,
        outputName,
        outputSize: blob.size,
        resized,
        skipped,
      });
      const resultParts = [];
      if (isGeometryCompressionMethod(geometryMethod)) resultParts.push(`${geometryMethodLabel(geometryMethod)} 网格压缩完成`);
      else if (geometryMethod === "cocos") resultParts.push(`Cocos 兼容标准 GLB 已完成，几何保留约 ${Math.round(geometryReduction * 100)}%`);
      if (resized) resultParts.push(`${resized} 张贴图已缩小`);
      setProgress(100, resultParts.join("，") || "模型处理完成");
    } catch (error) {
      state.output = null;
      showError(errorMessage(error));
      setProgress(0, "压缩失败", false);
    } finally {
      state.processing = false;
      setControlsDisabled(false);
    }
  }

  function parseGlb(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.byteLength < 20) throw new Error("文件太小，不是有效的 GLB 2.0 文件。");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("文件头不是 GLB 格式。");
    if (view.getUint32(4, true) !== 2) throw new Error("仅支持 GLB 2.0 模型。");
    const declaredLength = view.getUint32(8, true);
    if (declaredLength !== bytes.byteLength) throw new Error("GLB 文件长度与文件头记录不一致，文件可能已损坏。");

    const chunks = [];
    let offset = 12;
    while (offset < bytes.byteLength) {
      if (offset + 8 > bytes.byteLength) throw new Error("GLB 区块头不完整。");
      const length = view.getUint32(offset, true);
      const type = view.getUint32(offset + 4, true);
      const start = offset + 8;
      const end = start + length;
      if (end > bytes.byteLength) throw new Error("GLB 区块超出文件范围。");
      chunks.push({ type, data: bytes.slice(start, end) });
      offset = end;
    }
    if (offset !== bytes.byteLength) throw new Error("GLB 区块没有正确对齐。");

    const jsonIndex = chunks.findIndex((chunk) => chunk.type === JSON_CHUNK);
    if (jsonIndex < 0) throw new Error("GLB 缺少 JSON 区块。");
    let json;
    try {
      const jsonText = textDecoder.decode(chunks[jsonIndex].data).replace(/[\u0000\u0020]+$/g, "");
      json = JSON.parse(jsonText);
    } catch {
      throw new Error("GLB 的 JSON 数据无效。");
    }
    const binIndex = chunks.findIndex((chunk) => chunk.type === BIN_CHUNK);
    return { bytes, chunks, json, jsonIndex, binIndex };
  }

  function validateDocument(parsed) {
    const { json } = parsed;
    if (json.asset?.version !== "2.0") throw new Error("仅支持 glTF 2.0 模型。");
    const bufferViews = json.bufferViews || [];
    const binChunk = parsed.binIndex >= 0 ? parsed.chunks[parsed.binIndex].data : null;
    const declaredBinaryLength = json.buffers?.[0]?.byteLength || 0;
    if (declaredBinaryLength > 0 && !binChunk) throw new Error("GLB 缺少内嵌二进制区块。");
    if (binChunk && declaredBinaryLength > binChunk.byteLength) throw new Error("GLB 二进制区块长度不足。");

    const ranges = [];
    for (let index = 0; index < bufferViews.length; index += 1) {
      const bufferView = bufferViews[index];
      if ((bufferView.buffer || 0) !== 0) continue;
      const start = bufferView.byteOffset || 0;
      const length = bufferView.byteLength;
      if (!Number.isInteger(start) || start < 0 || !Number.isInteger(length) || length < 0) {
        throw new Error(`bufferView ${index} 的范围无效。`);
      }
      if (start + length > declaredBinaryLength) throw new Error(`bufferView ${index} 超出二进制区块范围。`);
      if (length > 0) ranges.push({ start, end: start + length, index });
    }
    ranges.sort((a, b) => a.start - b.start || a.end - b.end);
    for (let index = 1; index < ranges.length; index += 1) {
      if (ranges[index].start < ranges[index - 1].end) {
        throw new Error(`bufferView ${ranges[index - 1].index} 与 ${ranges[index].index} 存在重叠，已停止处理以防模型损坏。`);
      }
    }
  }

  function analyzeImages(parsed) {
    const images = parsed.json.images || [];
    const groups = new Map();
    const unsupported = [];

    images.forEach((image, imageIndex) => {
      let source;
      let key;
      let mime;
      let bufferViewIndex = null;
      let dataUri = null;

      if (Number.isInteger(image.bufferView)) {
        bufferViewIndex = image.bufferView;
        const bufferView = parsed.json.bufferViews?.[bufferViewIndex];
        if (!bufferView) throw new Error(`图像 ${imageIndex} 引用了不存在的 bufferView。`);
        if ((bufferView.buffer || 0) !== 0) throw new Error(`图像 ${imageIndex} 不在 GLB 内嵌二进制区块中。`);
        source = "bufferView";
        key = `bufferView:${bufferViewIndex}`;
        const bytes = readBufferViewBytes(parsed, bufferViewIndex);
        mime = normalizeMime(image.mimeType) || sniffImageMime(bytes);
      } else if (typeof image.uri === "string") {
        if (!image.uri.startsWith("data:")) {
          throw new Error(`图像 ${imageIndex} 使用外部文件 ${image.uri}，请先在导出时勾选“嵌入贴图”。`);
        }
        dataUri = parseDataUri(image.uri);
        source = "dataUri";
        key = `dataUri:${imageIndex}`;
        mime = normalizeMime(dataUri.mime) || sniffImageMime(dataUri.bytes);
      } else {
        throw new Error(`图像 ${imageIndex} 没有可读取的内嵌数据。`);
      }

      if (!SUPPORTED_MIMES.has(mime)) {
        unsupported.push({ imageIndex, mime: mime || "未知格式" });
        return;
      }
      const existing = groups.get(key);
      if (existing) {
        if (existing.mime !== mime) throw new Error(`共享 bufferView 的图像格式不一致：${existing.mime} / ${mime}。`);
        existing.imageIndexes.push(imageIndex);
      } else {
        groups.set(key, { source, mime, bufferViewIndex, imageIndexes: [imageIndex], dataUri });
      }
    });
    return { candidates: [...groups.values()], unsupported };
  }

  function analyzeGeometry(json) {
    let vertices = 0;
    let primitives = 0;
    const referencedBufferViews = new Set();
    for (const mesh of json.meshes || []) {
      for (const primitive of mesh.primitives || []) {
        primitives += 1;
        const positionIndex = primitive.attributes?.POSITION;
        if (Number.isInteger(positionIndex)) vertices += json.accessors?.[positionIndex]?.count || 0;
        for (const accessorIndex of Object.values(primitive.attributes || {})) {
          const accessor = json.accessors?.[accessorIndex];
          if (Number.isInteger(accessor?.bufferView)) referencedBufferViews.add(accessor.bufferView);
        }
        const indexAccessor = json.accessors?.[primitive.indices];
        if (Number.isInteger(indexAccessor?.bufferView)) referencedBufferViews.add(indexAccessor.bufferView);
      }
    }
    const memoryBytes = [...referencedBufferViews].reduce(
      (total, index) => total + (json.bufferViews?.[index]?.byteLength || 0),
      0,
    );
    return { memoryBytes, primitives, vertices };
  }

  function readCandidateBytes(parsed, candidate) {
    return candidate.source === "bufferView"
      ? readBufferViewBytes(parsed, candidate.bufferViewIndex)
      : candidate.dataUri.bytes;
  }

  function readBufferViewBytes(parsed, bufferViewIndex) {
    if (parsed.binIndex < 0) throw new Error("GLB 缺少内嵌二进制区块。");
    const bufferView = parsed.json.bufferViews[bufferViewIndex];
    const start = bufferView.byteOffset || 0;
    return parsed.chunks[parsed.binIndex].data.slice(start, start + bufferView.byteLength);
  }

  async function decodeImage(bytes, mime) {
    const blob = new Blob([bytes], { type: mime });
    if ("createImageBitmap" in window) {
      try {
        const bitmap = await createImageBitmap(blob);
        return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
      } catch {
        // Safari can reject some valid embedded images; the HTMLImageElement path is more tolerant.
      }
    }

    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("浏览器无法解码其中一张贴图。"));
        image.src = url;
      });
      return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }

  async function resizeAndEncode(decoded, width, height, mime, quality) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("浏览器无法创建贴图处理画布。");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(decoded.source, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
    canvas.width = 1;
    canvas.height = 1;
    if (!blob) throw new Error(`浏览器无法写出 ${mime} 贴图。`);
    if (normalizeMime(blob.type) !== mime) {
      throw new Error(`当前浏览器不支持写出 ${mime} 贴图，请使用最新版 Safari、Chrome 或 Edge。`);
    }
    return new Uint8Array(await blob.arrayBuffer());
  }

  function applyDataUriReplacements(json, replacements) {
    for (const replacement of replacements) {
      if (replacement.source !== "dataUri") continue;
      const imageIndex = replacement.imageIndexes[0];
      json.images[imageIndex].uri = `data:${replacement.mime};base64,${bytesToBase64(replacement.bytes)}`;
    }
  }

  function rebuildBinary(parsed, json, replacements) {
    if (parsed.binIndex < 0) {
      if (replacements.length) throw new Error("找不到需要替换的二进制贴图区块。");
      return null;
    }
    const originalLength = parsed.json.buffers?.[0]?.byteLength || parsed.chunks[parsed.binIndex].data.byteLength;
    const original = parsed.chunks[parsed.binIndex].data.subarray(0, originalLength);
    const ranges = replacements.map((replacement) => {
      const bufferView = parsed.json.bufferViews[replacement.bufferViewIndex];
      const start = bufferView.byteOffset || 0;
      const oldLength = bufferView.byteLength;
      const paddingLength = ((oldLength - replacement.bytes.byteLength) % 4 + 4) % 4;
      const paddedLength = replacement.bytes.byteLength + paddingLength;
      const padded = new Uint8Array(paddedLength);
      padded.set(replacement.bytes);
      return {
        bufferViewIndex: replacement.bufferViewIndex,
        start,
        end: start + oldLength,
        bytes: padded,
        dataLength: replacement.bytes.byteLength,
      };
    }).sort((a, b) => a.start - b.start);

    for (let index = 1; index < ranges.length; index += 1) {
      if (ranges[index].start < ranges[index - 1].end) throw new Error("待替换的贴图区块存在重叠。");
    }

    const totalDelta = ranges.reduce((sum, range) => sum + range.bytes.byteLength - (range.end - range.start), 0);
    const output = new Uint8Array(original.byteLength + totalDelta);
    let inputOffset = 0;
    let outputOffset = 0;
    for (const range of ranges) {
      output.set(original.subarray(inputOffset, range.start), outputOffset);
      outputOffset += range.start - inputOffset;
      output.set(range.bytes, outputOffset);
      outputOffset += range.bytes.byteLength;
      inputOffset = range.end;
    }
    output.set(original.subarray(inputOffset), outputOffset);

    const replacementByView = new Map(ranges.map((range) => [range.bufferViewIndex, range]));
    for (let index = 0; index < json.bufferViews.length; index += 1) {
      const originalView = parsed.json.bufferViews[index];
      if ((originalView.buffer || 0) !== 0) continue;
      const oldOffset = originalView.byteOffset || 0;
      const shift = ranges.reduce(
        (sum, range) => sum + (range.end <= oldOffset ? range.bytes.byteLength - (range.end - range.start) : 0),
        0,
      );
      const newOffset = oldOffset + shift;
      if (newOffset === 0 && originalView.byteOffset === undefined) delete json.bufferViews[index].byteOffset;
      else json.bufferViews[index].byteOffset = newOffset;
      const replacement = replacementByView.get(index);
      if (replacement) json.bufferViews[index].byteLength = replacement.dataLength;
    }
    json.buffers[0].byteLength = output.byteLength;
    return output;
  }

  function buildGlb(parsed, json, binary) {
    const rebuiltChunks = parsed.chunks.map((chunk, index) => {
      if (index === parsed.jsonIndex) return { type: JSON_CHUNK, data: padBytes(textEncoder.encode(JSON.stringify(json)), 0x20) };
      if (index === parsed.binIndex && binary) return { type: BIN_CHUNK, data: padBytes(binary, 0x00) };
      return chunk;
    });
    const totalLength = 12 + rebuiltChunks.reduce((sum, chunk) => sum + 8 + chunk.data.byteLength, 0);
    const output = new Uint8Array(totalLength);
    const view = new DataView(output.buffer);
    view.setUint32(0, GLB_MAGIC, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, totalLength, true);
    let offset = 12;
    for (const chunk of rebuiltChunks) {
      view.setUint32(offset, chunk.data.byteLength, true);
      view.setUint32(offset + 4, chunk.type, true);
      output.set(chunk.data, offset + 8);
      offset += 8 + chunk.data.byteLength;
    }
    return output;
  }

  function structureCounts(json) {
    return Object.fromEntries(STRUCTURE_KEYS.map((key) => [key, Array.isArray(json[key]) ? json[key].length : 0]));
  }

  function verifyStructure(before, after, geometryMethod) {
    const changesGeometry = geometryMethod === "cocos" || isGeometryCompressionMethod(geometryMethod);
    const stableKeys = changesGeometry
      ? STRUCTURE_KEYS.filter((key) => !["accessors", "bufferViews"].includes(key))
      : STRUCTURE_KEYS;
    const changed = stableKeys.filter((key) => before[key] !== after[key]);
    if (changed.length) throw new Error(`结构校验失败：${changed.map((key) => STRUCTURE_LABELS[key]).join("、")}数量发生变化。`);
  }

  function verifyCompressionExtension(json, geometryMethod) {
    if (!isGeometryCompressionMethod(geometryMethod)) {
      const extensions = new Set([...(json.extensionsUsed || []), ...(json.extensionsRequired || [])]);
      const incompatible = ["EXT_meshopt_compression", "KHR_draco_mesh_compression", "KHR_mesh_quantization"]
        .filter((extension) => extensions.has(extension));
      if (incompatible.length) {
        throw new Error(`Cocos 兼容检查失败：标准 GLB 不应包含 ${incompatible.join("、")}。`);
      }
      return;
    }
    const expected = geometryMethod === "meshopt" ? "EXT_meshopt_compression" : "KHR_draco_mesh_compression";
    const extensions = new Set([...(json.extensionsUsed || []), ...(json.extensionsRequired || [])]);
    if (!extensions.has(expected)) throw new Error(`网格压缩校验失败：输出文件缺少 ${expected} 扩展。`);
  }

  function renderResult(result) {
    elements.afterSize.textContent = formatBytes(result.outputSize);
    elements.resizeCount.textContent = `${result.resized} / ${result.skipped}`;
    elements.geometryCount.textContent = `${formatInteger(result.geometryBefore.vertices)} → ${formatInteger(result.geometryAfter.vertices)} 顶点`;
    elements.geometryMemoryBefore.textContent = formatMemory(result.geometryBefore.memoryBytes);
    elements.geometryMemoryAfter.textContent = formatMemory(result.geometryAfter.memoryBytes);
    elements.memoryBefore.textContent = formatMemory(result.decodedBefore);
    elements.memoryAfter.textContent = formatMemory(result.decodedAfter);
    elements.outputName.textContent = result.outputName;
    const saved = Math.max(0, state.inputFile.size - result.outputSize);
    const percent = state.inputFile.size ? Math.round((saved / state.inputFile.size) * 100) : 0;
    const meta = [formatBytes(result.outputSize), `文件减少 ${percent}%`];
    meta.push(geometryMethodLabel(result.geometryMethod));
    if (result.geometryMethod === "cocos") meta.push(`几何保留约 ${Math.round(result.geometryReduction * 100)}%`);
    if (state.analysis.candidates.length) meta.push(`贴图最长边 ${result.maxSize}px`);
    elements.outputMeta.textContent = meta.join(" · ");
    elements.structureGrid.replaceChildren(...STRUCTURE_KEYS.map((key) => {
      const item = document.createElement("div");
      item.className = "structure-item";
      const label = document.createElement("span");
      label.textContent = STRUCTURE_LABELS[key];
      const value = document.createElement("strong");
      value.textContent = `${result.beforeCounts[key]} → ${result.afterCounts[key]}`;
      item.append(label, value);
      return item;
    }));
    elements.structureBadge.textContent = result.geometryMethod === "cocos"
      ? "Cocos 兼容标准 GLB + 几何优化"
      : !isGeometryCompressionMethod(result.geometryMethod)
        ? "数量与顺序保持不变"
        : "模型结构与压缩扩展有效";
    elements.structureBadge.classList.add("is-valid");
    elements.emptyState.hidden = true;
    elements.resultState.hidden = false;
    elements.downloadBtn.disabled = false;
  }

  function normalizeMime(value) {
    if (typeof value !== "string") return "";
    const mime = value.toLowerCase().split(";")[0].trim();
    return mime === "image/jpg" ? "image/jpeg" : mime;
  }

  function sniffImageMime(bytes) {
    if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return "image/png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
    if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
    if (bytes.length >= 12 && bytes[0] === 0xab && ascii(bytes, 1, 4) === "KTX") return "image/ktx2";
    return "";
  }

  function parseDataUri(uri) {
    const match = /^data:([^;,]+)((?:;[^,]*)?),(.*)$/s.exec(uri);
    if (!match || !/;base64(?:;|$)/i.test(match[2])) throw new Error("仅支持 Base64 编码的内嵌 data URI 贴图。");
    try {
      return { mime: match[1], bytes: base64ToBytes(match[3]) };
    } catch {
      throw new Error("GLB 中有一张 Base64 贴图数据无效。");
    }
  }

  function base64ToBytes(base64) {
    const binary = atob(base64.replace(/\s/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function bytesToBase64(bytes) {
    const parts = [];
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      parts.push(String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length))));
    }
    return btoa(parts.join(""));
  }

  function padBytes(bytes, fill) {
    if (bytes.byteLength % 4 === 0) return bytes;
    const output = new Uint8Array(align4(bytes.byteLength));
    output.fill(fill);
    output.set(bytes);
    return output;
  }

  function align4(value) {
    return (value + 3) & ~3;
  }

  function ascii(bytes, start, end) {
    if (bytes.length < end) return "";
    return String.fromCharCode(...bytes.subarray(start, end));
  }

  function downloadOutput() {
    if (!state.output) return;
    const url = URL.createObjectURL(state.output.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = state.output.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function invalidateOutput() {
    if (!state.output || state.processing) return;
    resetResult();
    setProgress(0, "设置已更改，请重新开始压缩", false);
  }

  function updateGeometryMethodHint() {
    const method = elements.geometryMethodSelect.value;
    const hints = {
      cocos: "输出为合法标准 GLB，可直接导入 Cocos Creator；会执行网格去重和减面，不写入压缩扩展。",
      meshopt: "输出使用 EXT_meshopt_compression，仅适用于支持该扩展的运行时；导入 Cocos 编辑器会失败。",
      draco: "输出使用 KHR_draco_mesh_compression，仅适用于支持该扩展的运行时；导入 Cocos 编辑器会失败。",
      none: "不处理网格，只缩小内嵌 PNG、JPEG 或 WebP 贴图。",
    };
    elements.geometryMethodHint.textContent = hints[method];
  }

  function updateGeometryReductionHint() {
    const enabled = elements.geometryMethodSelect.value === "cocos";
    const ratio = Number(elements.geometryReductionSelect.value);
    elements.geometryReductionSelect.disabled = !enabled;
    elements.geometryReductionHint.textContent = enabled
      ? ratio >= 0.999
        ? "只做无损去重和索引整理，不主动删除三角形。"
        : `只对 Cocos 标准 GLB 生效；目标保留约 ${Math.round(ratio * 100)}% 几何，可明显降低网格内存。`
      : "仅 Cocos 标准 GLB 使用；Meshopt / Draco 模式由运行时扩展负责压缩。";
  }

  function geometryMethodLabel(method) {
    return method === "cocos" ? "Cocos 兼容" : method === "meshopt" ? "Meshopt" : method === "draco" ? "Draco" : "未压缩网格";
  }

  function isGeometryCompressionMethod(method) {
    return method === "meshopt" || method === "draco";
  }

  function resetAll() {
    if (state.processing) return;
    state.inputFile = null;
    state.parsed = null;
    state.analysis = null;
    elements.fileInput.value = "";
    elements.beforeSize.textContent = "0 B";
    elements.geometryCount.textContent = "0";
    elements.geometryMemoryBefore.textContent = "-";
    elements.geometryMemoryAfter.textContent = "-";
    elements.textureCount.textContent = "0";
    elements.dropZone.querySelector("strong").textContent = "拖入 GLB 模型";
    elements.dropZone.querySelector("span:last-child").textContent = "支持无贴图 GLB，文件仅在本地处理";
    elements.emptyState.querySelector("strong").textContent = "先选择需要优化的 GLB 模型";
    elements.emptyState.querySelector("span").textContent = "输出文件可重新导入 Cocos，再构建 HTML。";
    resetMessages();
    resetResult();
    setProgress(0, "等待选择 GLB", false);
    setControlsDisabled(false);
  }

  function resetResult() {
    state.output = null;
    elements.afterSize.textContent = "-";
    elements.geometryMemoryAfter.textContent = "-";
    elements.resizeCount.textContent = "0 / 0";
    elements.memoryBefore.textContent = "-";
    elements.memoryAfter.textContent = "-";
    elements.emptyState.hidden = false;
    elements.resultState.hidden = true;
    elements.downloadBtn.disabled = true;
    elements.structureBadge.classList.remove("is-valid");
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
    elements.maxSizeSelect.disabled = disabled;
    elements.geometryMethodSelect.disabled = disabled;
    elements.geometryReductionSelect.disabled = disabled || elements.geometryMethodSelect.value !== "cocos";
    elements.qualityInput.disabled = disabled;
    const hasWork = Boolean(state.inputFile) && (elements.geometryMethodSelect.value !== "none" || Boolean(state.analysis?.candidates.length));
    elements.optimizeBtn.disabled = disabled || !state.inputFile || !hasWork;
    elements.clearBtn.disabled = disabled || !state.inputFile;
    if (disabled) elements.downloadBtn.disabled = true;
    else elements.downloadBtn.disabled = !state.output;
  }

  function setProgress(value, text, showValue = true) {
    const normalized = Math.max(0, Math.min(100, Number(value) || 0));
    elements.progressBar.style.width = `${normalized}%`;
    elements.progressText.textContent = showValue ? `${Math.round(normalized)}%` : "0%";
    elements.statusText.textContent = text;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1000)), units.length - 1);
    const value = bytes / (1000 ** index);
    return `${value.toFixed(index === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[index]}`;
  }

  function formatMemory(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 MiB";
    const mib = bytes / (1024 ** 2);
    return `${mib >= 100 ? mib.toFixed(0) : mib.toFixed(1)} MiB`;
  }

  function formatInteger(value) {
    return new Intl.NumberFormat("zh-CN").format(Number(value) || 0);
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : "处理模型时发生未知错误。";
  }

  function yieldToBrowser() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  updateGeometryMethodHint();
  updateGeometryReductionHint();
})();
