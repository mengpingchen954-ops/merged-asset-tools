(() => {
  "use strict";

  const TYPE_LABELS = {
    streak: "光条",
    fragment: "碎片",
    flash: "中心爆闪",
    dot: "柔光粒子",
  };

  const elements = {
    analysisText: document.querySelector("#vfxAnalysisText"),
    autoColorBtn: document.querySelector("#vfxAutoColorBtn"),
    brightnessInput: document.querySelector("#vfxBrightnessInput"),
    brightnessValue: document.querySelector("#vfxBrightnessValue"),
    centerMarker: document.querySelector("#vfxCenterMarker"),
    colorInput: document.querySelector("#vfxColorInput"),
    colorValue: document.querySelector("#vfxColorValue"),
    compositeCanvas: document.querySelector("#compositeCanvas"),
    compositePreview: document.querySelector("#compositePreview"),
    dropZone: document.querySelector("#vfxDropZone"),
    emptyState: document.querySelector("#vfxEmptyState"),
    errorState: document.querySelector("#vfxErrorState"),
    fileInput: document.querySelector("#vfxFileInput"),
    fileName: document.querySelector("#vfxFileName"),
    reference: document.querySelector("#vfxReference"),
    referenceImage: document.querySelector("#vfxReferenceImage"),
    removeBtn: document.querySelector("#vfxRemoveBtn"),
    playPreviewBtn: document.querySelector("#playPreviewBtn"),
    previewStateText: document.querySelector("#previewStateText"),
    reseedBtn: document.querySelector("#reseedBtn"),
    sizeSelect: document.querySelector("#vfxSizeSelect"),
    softnessInput: document.querySelector("#vfxSoftnessInput"),
    softnessValue: document.querySelector("#vfxSoftnessValue"),
    statusText: document.querySelector("#vfxStatusText"),
    textureGrid: document.querySelector("#textureGrid"),
    variantSelect: document.querySelector("#vfxVariantSelect"),
    zipBtn: document.querySelector("#vfxZipBtn"),
  };

  const state = {
    analysis: null,
    file: null,
    image: null,
    objectUrl: "",
    textures: [],
    renderTimer: 0,
    previewFrame: 0,
    seedOffset: 0,
  };

  document.querySelectorAll(".mode-button").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });
  window.addEventListener("message", (event) => {
    if (event.origin === window.location.origin && event.data?.type === "set-mode") {
      setMode(event.data.mode === "model" ? "model" : "vfx");
    }
  });

  elements.fileInput.addEventListener("change", () => {
    const [file] = elements.fileInput.files;
    if (file) loadReference(file);
  });
  elements.removeBtn.addEventListener("click", resetVfx);
  elements.playPreviewBtn.addEventListener("click", playCompositePreview);
  elements.reseedBtn.addEventListener("click", () => {
    state.seedOffset += 104729;
    renderTextures();
  });
  elements.autoColorBtn.addEventListener("click", () => {
    if (!state.analysis) return;
    elements.colorInput.value = state.analysis.colorHex;
    syncControls();
    scheduleRender();
  });
  elements.zipBtn.addEventListener("click", downloadZip);

  [elements.sizeSelect, elements.variantSelect].forEach((input) => {
    input.addEventListener("change", scheduleRender);
  });
  [elements.colorInput, elements.brightnessInput, elements.softnessInput].forEach((input) => {
    input.addEventListener("input", () => {
      syncControls();
      scheduleRender();
    });
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
    const [file] = event.dataTransfer.files;
    if (file) loadReference(file);
  });

  function setMode(mode) {
    const selectedMode = mode === "model" ? "model" : "vfx";
    document.querySelectorAll(".mode-button").forEach((button) => {
      const active = button.dataset.mode === selectedMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll("[data-mode-panel]").forEach((panel) => {
      const active = panel.dataset.modePanel === selectedMode;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
  }

  async function loadReference(file) {
    clearError();
    if (!file.type.startsWith("image/") && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
      showError("请选择 PNG、JPG 或 WebP 特效图片。");
      return;
    }

    elements.statusText.textContent = "正在分析特效原图...";
    try {
      const image = await decodeImage(file);
      const analysis = analyzeReference(image);
      revokeObjectUrl();
      state.objectUrl = URL.createObjectURL(file);
      state.file = file;
      state.image = image;
      state.analysis = analysis;
      elements.referenceImage.src = state.objectUrl;
      elements.fileName.textContent = file.name;
      elements.analysisText.textContent = `${image.naturalWidth} × ${image.naturalHeight} · 参考色 ${analysis.colorHex.toUpperCase()} · ${analysis.directions.length} 个主要方向`;
      elements.centerMarker.style.left = `${analysis.center.x * 100}%`;
      elements.centerMarker.style.top = `${analysis.center.y * 100}%`;
      elements.reference.hidden = false;
      elements.dropZone.hidden = true;
      elements.autoColorBtn.disabled = false;
      elements.colorInput.value = analysis.colorHex;
      syncControls();
      renderTextures();
    } catch (error) {
      showError(error instanceof Error ? error.message : "无法读取这张图片。");
    }
  }

  function decodeImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("图片解码失败，请换一张 PNG、JPG 或 WebP。"));
      };
      image.src = url;
    });
  }

  function analyzeReference(image) {
    const maxEdge = 256;
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const background = sampleBackground(pixels, width, height);
    const scores = new Float32Array(width * height);
    const samples = [];

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixelIndex = y * width + x;
        const offset = pixelIndex * 4;
        const alpha = pixels[offset + 3] / 255;
        if (alpha < 0.04) continue;
        const red = pixels[offset];
        const green = pixels[offset + 1];
        const blue = pixels[offset + 2];
        const luminance = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
        const difference = colorDistance(red, green, blue, background) / 441.67;
        const chroma = (Math.max(red, green, blue) - Math.min(red, green, blue)) / 255;
        const score = alpha * Math.min(1, luminance * 0.54 + difference * 0.72 + chroma * 0.18);
        scores[pixelIndex] = score;
        if ((x + y) % 2 === 0) samples.push(score);
      }
    }

    samples.sort((a, b) => a - b);
    const threshold = Math.max(0.2, samples[Math.floor(samples.length * 0.82)] || 0.2);
    let totalWeight = 0;
    let centerX = 0;
    let centerY = 0;
    let colorRed = 0;
    let colorGreen = 0;
    let colorBlue = 0;
    let colorWeight = 0;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixelIndex = y * width + x;
        const score = scores[pixelIndex];
        if (score < threshold) continue;
        const offset = pixelIndex * 4;
        const weight = (score - threshold + 0.04) ** 2;
        totalWeight += weight;
        centerX += (x + 0.5) * weight;
        centerY += (y + 0.5) * weight;
        const red = pixels[offset];
        const green = pixels[offset + 1];
        const blue = pixels[offset + 2];
        const saturation = (Math.max(red, green, blue) - Math.min(red, green, blue)) / 255;
        const tintWeight = weight * (0.15 + saturation ** 1.5);
        colorRed += red * tintWeight;
        colorGreen += green * tintWeight;
        colorBlue += blue * tintWeight;
        colorWeight += tintWeight;
      }
    }

    if (!totalWeight) {
      centerX = width / 2;
      centerY = height / 2;
      totalWeight = 1;
    }
    const center = { x: centerX / totalWeight / width, y: centerY / totalWeight / height };
    const color = colorWeight
      ? [colorRed / colorWeight, colorGreen / colorWeight, colorBlue / colorWeight]
      : [255, 255, 255];
    const normalizedColor = normalizeEffectColor(color);
    const directions = analyzeDirections(scores, width, height, center, threshold);
    return {
      background,
      center,
      color: normalizedColor,
      colorHex: rgbToHex(normalizedColor),
      directions,
      seed: hashString(`${width}:${height}:${rgbToHex(normalizedColor)}:${Math.round(center.x * 100)}:${Math.round(center.y * 100)}`),
    };
  }

  function sampleBackground(pixels, width, height) {
    const radius = Math.max(2, Math.round(Math.min(width, height) * 0.08));
    const regions = [
      [0, 0],
      [width - radius, 0],
      [0, height - radius],
      [width - radius, height - radius],
    ];
    const colors = regions.map(([startX, startY]) => {
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      for (let y = startY; y < Math.min(height, startY + radius); y += 1) {
        for (let x = startX; x < Math.min(width, startX + radius); x += 1) {
          const offset = (y * width + x) * 4;
          if (pixels[offset + 3] < 20) continue;
          red += pixels[offset];
          green += pixels[offset + 1];
          blue += pixels[offset + 2];
          count += 1;
        }
      }
      return count ? [red / count, green / count, blue / count] : [0, 0, 0];
    });
    colors.sort((a, b) => brightness(a) - brightness(b));
    return colors[Math.floor(colors.length / 2)];
  }

  function analyzeDirections(scores, width, height, center, threshold) {
    const bins = new Float64Array(24);
    const centerX = center.x * width;
    const centerY = center.y * height;
    const maxRadius = Math.hypot(width, height);
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const score = scores[y * width + x];
        if (score < threshold) continue;
        const deltaX = x - centerX;
        const deltaY = y - centerY;
        const radius = Math.hypot(deltaX, deltaY);
        if (radius < Math.min(width, height) * 0.06) continue;
        const angle = (Math.atan2(deltaY, deltaX) + Math.PI * 2) % (Math.PI * 2);
        const bin = Math.floor((angle / (Math.PI * 2)) * bins.length) % bins.length;
        bins[bin] += (score - threshold + 0.02) * (0.35 + radius / maxRadius);
      }
    }
    const ranked = [...bins.keys()].sort((a, b) => bins[b] - bins[a]);
    const selected = [];
    for (const bin of ranked) {
      if (bins[bin] <= 0) break;
      if (selected.some((value) => circularBinDistance(value, bin, bins.length) < 2)) continue;
      selected.push(bin);
      if (selected.length === 5) break;
    }
    if (!selected.length) selected.push(0, 6, 12, 18);
    return selected.map((bin) => ((bin + 0.5) / bins.length) * Math.PI * 2);
  }

  function circularBinDistance(a, b, length) {
    const distance = Math.abs(a - b);
    return Math.min(distance, length - distance);
  }

  function scheduleRender() {
    if (!state.analysis) return;
    window.clearTimeout(state.renderTimer);
    elements.statusText.textContent = "正在重新生成贴图...";
    state.renderTimer = window.setTimeout(renderTextures, 80);
  }

  function renderTextures() {
    if (!state.analysis) return;
    clearError();
    const size = Number(elements.sizeSelect.value);
    const variants = Number(elements.variantSelect.value);
    const color = hexToRgb(elements.colorInput.value);
    const brightnessScale = Number(elements.brightnessInput.value) / 100;
    const softness = Number(elements.softnessInput.value) / 100;
    const types = ["streak", "fragment", "flash", "dot"];
    const textures = [];

    for (const type of types) {
      for (let variant = 0; variant < variants; variant += 1) {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const seed = state.analysis.seed + state.seedOffset + type.length * 911 + variant * 3571;
        const angle = state.analysis.directions[variant % state.analysis.directions.length] || 0;
        const options = { angle, brightness: brightnessScale, color, seed, size, softness, variant };
        drawTexture(canvas, type, options);
        const alpha = measureAlpha(canvas);
        if (!alpha.visiblePixels || !alpha.transparentPixels) {
          throw new Error(`${TYPE_LABELS[type]}贴图生成异常，请重新调整参数。`);
        }
        textures.push({ alpha, canvas, name: `hit-${type}-${String(variant + 1).padStart(2, "0")}.png`, type, variant });
      }
    }

    state.textures = textures;
    elements.textureGrid.replaceChildren(...textures.map(createTextureCard));
    elements.emptyState.hidden = true;
    elements.compositePreview.hidden = false;
    elements.textureGrid.hidden = false;
    elements.zipBtn.disabled = false;
    elements.statusText.textContent = `已生成 ${textures.length} 张 ${size} × ${size} 透明 PNG · 参考色 ${elements.colorInput.value.toUpperCase()}`;
    window.cancelAnimationFrame(state.previewFrame);
    state.previewFrame = window.requestAnimationFrame(playCompositePreview);
  }

  function drawTexture(canvas, type, options) {
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (type === "streak") drawStreak(context, options);
    if (type === "fragment") drawFragment(context, options);
    if (type === "flash") drawFlash(context, options);
    if (type === "dot") drawDot(context, options);
  }

  function drawStreak(context, options) {
    const { angle, brightness: light, color, seed, size, softness, variant } = options;
    const random = mulberry32(seed);
    const center = size / 2;
    const length = size * (0.58 + random() * 0.27);
    const thickness = size * (0.022 + random() * 0.022);
    const tilt = angle + (random() - 0.5) * 0.18;
    context.save();
    context.translate(center, center);
    context.rotate(tilt);
    const start = -length * (0.16 + variant * 0.035);
    const end = length * 0.72;
    const gradient = context.createLinearGradient(start, 0, end, 0);
    gradient.addColorStop(0, rgba(color, 0));
    gradient.addColorStop(0.18, rgba(color, 0.55 * light));
    gradient.addColorStop(0.5, rgba(color, 0.95 * light));
    gradient.addColorStop(1, rgba(color, 0));
    context.globalCompositeOperation = "lighter";
    context.filter = `blur(${Math.max(1, size * (0.008 + softness * 0.025))}px)`;
    context.fillStyle = gradient;
    taperedShape(context, start, end, thickness * (3.4 + softness * 2.2));
    context.filter = `blur(${Math.max(0.3, size * (0.002 + softness * 0.006))}px)`;
    context.fillStyle = gradient;
    taperedShape(context, start, end, thickness * 1.35);
    const core = context.createLinearGradient(start, 0, end, 0);
    core.addColorStop(0, "rgba(255,255,255,0)");
    core.addColorStop(0.3, `rgba(255,255,255,${Math.min(1, 0.72 * light)})`);
    core.addColorStop(0.72, `rgba(255,255,255,${Math.min(1, 0.98 * light)})`);
    core.addColorStop(1, "rgba(255,255,255,0)");
    context.filter = "none";
    context.fillStyle = core;
    taperedShape(context, start, end, Math.max(1, thickness * 0.28));
    context.restore();
  }

  function taperedShape(context, start, end, halfWidth) {
    const length = end - start;
    context.beginPath();
    context.moveTo(start, 0);
    context.lineTo(start + length * 0.38, -halfWidth);
    context.lineTo(end, 0);
    context.lineTo(start + length * 0.38, halfWidth);
    context.closePath();
    context.fill();
  }

  function drawFragment(context, options) {
    const { angle, brightness: light, color, seed, size, softness } = options;
    const random = mulberry32(seed);
    const center = size / 2;
    const length = size * (0.34 + random() * 0.24);
    const width = size * (0.055 + random() * 0.06);
    context.save();
    context.translate(center, center);
    context.rotate(angle + (random() - 0.5) * 0.55);
    const points = [
      [-length * 0.52, width * (random() - 0.2)],
      [-length * 0.22, -width * (0.45 + random())],
      [length * 0.55, -width * (0.12 + random() * 0.35)],
      [length * 0.22, width * (0.55 + random() * 0.8)],
    ];
    context.globalCompositeOperation = "lighter";
    context.filter = `blur(${Math.max(1, size * (0.008 + softness * 0.022))}px)`;
    context.fillStyle = rgba(color, Math.min(1, 0.72 * light));
    polygon(context, points, 1.45 + softness * 1.2);
    context.filter = `blur(${Math.max(0.2, size * softness * 0.004)}px)`;
    const gradient = context.createLinearGradient(-length / 2, -width, length / 2, width);
    gradient.addColorStop(0, rgba(color, 0.06));
    gradient.addColorStop(0.45, rgba(color, Math.min(1, 0.78 * light)));
    gradient.addColorStop(1, "rgba(255,255,255,0.96)");
    context.fillStyle = gradient;
    polygon(context, points, 1);
    context.restore();
  }

  function polygon(context, points, scale) {
    context.beginPath();
    points.forEach(([x, y], index) => {
      if (index === 0) context.moveTo(x * scale, y * scale);
      else context.lineTo(x * scale, y * scale);
    });
    context.closePath();
    context.fill();
  }

  function drawFlash(context, options) {
    const { brightness: light, color, seed, size, softness, variant } = options;
    const random = mulberry32(seed);
    const center = size / 2;
    const glowRadius = size * (0.26 + softness * 0.13);
    context.save();
    context.globalCompositeOperation = "lighter";
    const glow = context.createRadialGradient(center, center, 0, center, center, glowRadius);
    glow.addColorStop(0, `rgba(255,255,255,${Math.min(1, light)})`);
    glow.addColorStop(0.12, rgba(color, Math.min(1, 0.92 * light)));
    glow.addColorStop(0.42, rgba(color, 0.35 * light));
    glow.addColorStop(1, rgba(color, 0));
    context.fillStyle = glow;
    context.fillRect(0, 0, size, size);

    const rayCount = 7 + variant * 2;
    for (let ray = 0; ray < rayCount; ray += 1) {
      const angle = (ray / rayCount) * Math.PI * 2 + random() * 0.34;
      const length = size * (0.28 + random() * 0.32);
      const width = size * (0.006 + random() * 0.012);
      context.save();
      context.translate(center, center);
      context.rotate(angle);
      const rayGradient = context.createLinearGradient(0, 0, length, 0);
      rayGradient.addColorStop(0, rgba(color, Math.min(1, 0.85 * light)));
      rayGradient.addColorStop(0.28, rgba(color, 0.45 * light));
      rayGradient.addColorStop(1, rgba(color, 0));
      context.filter = `blur(${size * (0.002 + softness * 0.006)}px)`;
      context.fillStyle = rayGradient;
      taperedShape(context, 0, length, width);
      context.restore();
    }
    context.restore();
  }

  function drawDot(context, options) {
    const { brightness: light, color, seed, size, softness, variant } = options;
    const random = mulberry32(seed);
    const center = size / 2;
    const radius = size * (0.18 + variant * 0.035 + random() * 0.035);
    context.save();
    context.globalCompositeOperation = "lighter";
    const glow = context.createRadialGradient(center, center, 0, center, center, radius * (1.4 + softness));
    glow.addColorStop(0, `rgba(255,255,255,${Math.min(1, 0.96 * light)})`);
    glow.addColorStop(0.08 + softness * 0.08, rgba(color, Math.min(1, 0.9 * light)));
    glow.addColorStop(0.34 + softness * 0.16, rgba(color, 0.36 * light));
    glow.addColorStop(1, rgba(color, 0));
    context.fillStyle = glow;
    context.fillRect(0, 0, size, size);
    if (variant % 2 === 1) {
      context.filter = `blur(${size * 0.004}px)`;
      context.fillStyle = `rgba(255,255,255,${Math.min(1, 0.72 * light)})`;
      context.beginPath();
      context.arc(center, center, Math.max(1, size * 0.018), 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function createTextureCard(texture) {
    const card = document.createElement("article");
    card.className = "texture-card";
    card.dataset.visiblePixels = String(texture.alpha.visiblePixels);
    card.dataset.transparentPixels = String(texture.alpha.transparentPixels);
    card.dataset.maxAlpha = String(texture.alpha.maxAlpha);
    const preview = document.createElement("div");
    preview.className = "texture-preview checkerboard";
    preview.appendChild(texture.canvas);
    const info = document.createElement("div");
    info.className = "texture-info";
    const copy = document.createElement("div");
    copy.className = "texture-copy";
    const title = document.createElement("strong");
    title.textContent = `${TYPE_LABELS[texture.type]} ${texture.variant + 1}`;
    const meta = document.createElement("span");
    meta.textContent = `${texture.canvas.width} × ${texture.canvas.height} · PNG`;
    copy.append(title, meta);
    const download = document.createElement("button");
    download.className = "texture-download";
    download.type = "button";
    download.title = `下载 ${texture.name}`;
    download.setAttribute("aria-label", `下载 ${texture.name}`);
    download.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M5 20h14" /></svg>';
    download.addEventListener("click", () => downloadCanvas(texture));
    info.append(copy, download);
    card.append(preview, info);
    return card;
  }

  function measureAlpha(canvas) {
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let visiblePixels = 0;
    let transparentPixels = 0;
    let maxAlpha = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      const alpha = pixels[index];
      if (alpha) visiblePixels += 1;
      else transparentPixels += 1;
      if (alpha > maxAlpha) maxAlpha = alpha;
    }
    return { maxAlpha, transparentPixels, visiblePixels };
  }

  function playCompositePreview() {
    if (!state.textures.length) return;
    window.cancelAnimationFrame(state.previewFrame);
    const canvas = elements.compositeCanvas;
    const context = canvas.getContext("2d");
    const start = performance.now();
    const duration = 920;
    elements.previewStateText.textContent = "播放中";

    const renderFrame = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      drawCompositeFrame(context, canvas, progress);
      if (progress < 1) {
        state.previewFrame = window.requestAnimationFrame(renderFrame);
      } else {
        elements.previewStateText.textContent = "播放完成";
      }
    };
    state.previewFrame = window.requestAnimationFrame(renderFrame);
  }

  function drawCompositeFrame(context, canvas, progress) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.globalCompositeOperation = "lighter";

    const dot = state.textures.find((texture) => texture.type === "dot");
    const flash = state.textures.find((texture) => texture.type === "flash");
    const streaks = state.textures.filter((texture) => texture.type === "streak");
    const fragments = state.textures.filter((texture) => texture.type === "fragment");
    const burst = easeOutCubic(Math.min(1, progress / 0.42));
    const fade = 0.08 + 0.92 * (1 - easeInCubic(Math.max(0, (progress - 0.42) / 0.58)));

    if (dot) drawCompositeSprite(context, dot.canvas, centerX, centerY, 0, 0.45 + burst * 1.2, Math.min(1, fade * 0.86));
    if (flash) drawCompositeSprite(context, flash.canvas, centerX, centerY, 0, 0.34 + burst * 1.12, Math.min(1, fade * 1.12));

    const directions = state.analysis?.directions || [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
    for (let index = 0; index < Math.max(6, streaks.length * 3); index += 1) {
      const texture = streaks[index % streaks.length];
      const angle = directions[index % directions.length] + index * 0.73;
      const distance = burst * (18 + (index % 3) * 15);
      drawCompositeSprite(
        context,
        texture.canvas,
        centerX + Math.cos(angle) * distance,
        centerY + Math.sin(angle) * distance,
        angle * 0.22,
        0.34 + burst * 0.44,
        fade * (0.55 + (index % 2) * 0.22),
      );
    }

    for (let index = 0; index < Math.max(8, fragments.length * 4); index += 1) {
      const texture = fragments[index % fragments.length];
      const angle = directions[index % directions.length] + index * 0.61;
      const distance = burst * (36 + (index % 4) * 22);
      drawCompositeSprite(
        context,
        texture.canvas,
        centerX + Math.cos(angle) * distance,
        centerY + Math.sin(angle) * distance,
        angle + progress * (index % 2 ? 1.8 : -1.5),
        0.16 + burst * 0.18,
        fade * 0.82,
      );
    }
    context.restore();
  }

  function drawCompositeSprite(context, source, x, y, rotation, scale, alpha) {
    if (!source || alpha <= 0) return;
    const width = source.width * scale;
    const height = source.height * scale;
    context.save();
    context.translate(x, y);
    context.rotate(rotation);
    context.globalAlpha = Math.max(0, Math.min(1, alpha));
    context.drawImage(source, -width / 2, -height / 2, width, height);
    context.restore();
  }

  function easeOutCubic(value) {
    return 1 - (1 - value) ** 3;
  }

  function easeInCubic(value) {
    return value ** 3;
  }

  async function downloadCanvas(texture) {
    const blob = await canvasToBlob(texture.canvas);
    downloadBlob(blob, texture.name);
  }

  async function downloadZip() {
    if (!state.textures.length) return;
    elements.zipBtn.disabled = true;
    elements.statusText.textContent = "正在打包透明 PNG...";
    try {
      const files = await Promise.all(state.textures.map(async (texture) => ({
        name: texture.name,
        bytes: new Uint8Array(await (await canvasToBlob(texture.canvas)).arrayBuffer()),
      })));
      files.push({
        name: "effect-config.json",
        bytes: new TextEncoder().encode(JSON.stringify(buildEffectConfig(), null, 2)),
      });
      const zip = makeZip(files);
      const baseName = (state.file?.name || "hit-effect").replace(/\.[^.]+$/, "");
      downloadBlob(zip, `${baseName}-particle-textures.zip`);
      elements.statusText.textContent = `已打包 ${state.textures.length} 张透明 PNG 和参数 JSON`;
    } catch {
      showError("打包失败，请尝试单张下载。");
    } finally {
      elements.zipBtn.disabled = !state.textures.length;
    }
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG 生成失败")), "image/png");
    });
  }

  function buildEffectConfig() {
    return {
      version: 1,
      source: state.file?.name || "effect-reference",
      analysis: {
        color: elements.colorInput.value.toUpperCase(),
        center: state.analysis.center,
        directionsDegrees: state.analysis.directions.map((angle) => Math.round((angle * 180 / Math.PI) * 10) / 10),
      },
      output: {
        size: Number(elements.sizeSelect.value),
        variantsPerType: Number(elements.variantSelect.value),
        brightness: Number(elements.brightnessInput.value) / 100,
        softness: Number(elements.softnessInput.value) / 100,
        seedOffset: state.seedOffset,
      },
      cocos: {
        streak: { blend: "ADD", files: textureNames("streak") },
        fragment: { blend: "NORMAL_OR_ADD", files: textureNames("fragment") },
        flash: { blend: "ADD", files: textureNames("flash") },
        dot: { blend: "ADD", files: textureNames("dot") },
      },
    };
  }

  function textureNames(type) {
    return state.textures.filter((texture) => texture.type === type).map((texture) => texture.name);
  }

  function makeZip(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const date = dosDateTime();
    for (const file of files) {
      const name = encoder.encode(file.name);
      const crc = crc32(file.bytes);
      const local = new ArrayBuffer(30);
      writeZipHeader(new DataView(local), [
        [4, 0x04034b50], [2, 20], [2, 0x0800], [2, 0], [2, date.time], [2, date.day],
        [4, crc], [4, file.bytes.length], [4, file.bytes.length], [2, name.length], [2, 0],
      ]);
      localParts.push(local, name, file.bytes);
      const central = new ArrayBuffer(46);
      writeZipHeader(new DataView(central), [
        [4, 0x02014b50], [2, 20], [2, 20], [2, 0x0800], [2, 0], [2, date.time], [2, date.day],
        [4, crc], [4, file.bytes.length], [4, file.bytes.length], [2, name.length], [2, 0], [2, 0],
        [2, 0], [2, 0], [4, 0], [4, offset],
      ]);
      centralParts.push(central, name);
      offset += 30 + name.length + file.bytes.length;
    }
    const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
    const end = new ArrayBuffer(22);
    writeZipHeader(new DataView(end), [
      [4, 0x06054b50], [2, 0], [2, 0], [2, files.length], [2, files.length],
      [4, centralSize], [4, offset], [2, 0],
    ]);
    return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
  }

  function writeZipHeader(view, values) {
    let offset = 0;
    for (const [bytes, value] of values) {
      if (bytes === 2) view.setUint16(offset, value, true);
      else view.setUint32(offset, value, true);
      offset += bytes;
    }
  }

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      table[index] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date = new Date()) {
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      day: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
  }

  function resetVfx() {
    window.clearTimeout(state.renderTimer);
    revokeObjectUrl();
    state.analysis = null;
    state.file = null;
    state.image = null;
    state.textures = [];
    state.seedOffset = 0;
    window.cancelAnimationFrame(state.previewFrame);
    elements.fileInput.value = "";
    elements.reference.hidden = true;
    elements.referenceImage.removeAttribute("src");
    elements.dropZone.hidden = false;
    elements.autoColorBtn.disabled = true;
    elements.textureGrid.replaceChildren();
    elements.textureGrid.hidden = true;
    elements.compositePreview.hidden = true;
    elements.compositeCanvas.getContext("2d").clearRect(0, 0, elements.compositeCanvas.width, elements.compositeCanvas.height);
    elements.previewStateText.textContent = "待播放";
    elements.emptyState.hidden = false;
    elements.zipBtn.disabled = true;
    elements.statusText.textContent = "等待上传特效参考图";
    clearError();
  }

  function syncControls() {
    elements.colorValue.textContent = elements.colorInput.value.toUpperCase();
    elements.brightnessValue.textContent = `${elements.brightnessInput.value}%`;
    elements.softnessValue.textContent = `${elements.softnessInput.value}%`;
  }

  function revokeObjectUrl() {
    if (!state.objectUrl) return;
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = "";
  }

  function showError(message) {
    elements.errorState.textContent = message;
    elements.errorState.hidden = false;
    elements.statusText.textContent = "生成失败";
  }

  function clearError() {
    elements.errorState.textContent = "";
    elements.errorState.hidden = true;
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function normalizeEffectColor(color) {
    const [red, green, blue] = color;
    const maximum = Math.max(red, green, blue);
    if (maximum < 1) return [255, 255, 255];
    const boost = Math.min(1.55, 235 / maximum);
    return [red, green, blue].map((value) => Math.round(Math.min(255, Math.max(0, value * boost))));
  }

  function colorDistance(red, green, blue, background) {
    return Math.hypot(red - background[0], green - background[1], blue - background[2]);
  }

  function brightness(color) {
    return color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
  }

  function rgbToHex(color) {
    return `#${color.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
  }

  function hexToRgb(hex) {
    const normalized = hex.replace("#", "");
    return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
  }

  function rgba(color, alpha) {
    return `rgba(${color[0]},${color[1]},${color[2]},${Math.max(0, Math.min(1, alpha))})`;
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    let value = seed >>> 0;
    return () => {
      value += 0x6d2b79f5;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
  }

  syncControls();
  const initialMode = new URLSearchParams(window.location.search).get("mode") === "model" ? "model" : "vfx";
  document.querySelector(".mode-switch")?.setAttribute("hidden", "");
  document.title = initialMode === "model" ? "GLB 模型压缩" : "特效贴图生成";
  setMode(initialMode);
})();
