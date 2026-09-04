(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  const previewCanvas = $("#preview-canvas");
  const sourceCanvas = $("#source-canvas");
  const processedCanvas = $("#processed-canvas");
  const previewContext = previewCanvas.getContext("2d", { willReadFrequently: true });
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const processedContext = processedCanvas.getContext("2d", { willReadFrequently: true });
  const video = $("#source-video");
  const videoFrameCanvas = document.createElement("canvas");
  const videoProcessedCanvas = document.createElement("canvas");
  const videoFrameContext = videoFrameCanvas.getContext("2d", { willReadFrequently: true });
  const credits = window.CutframeCredits;

  const state = {
    mode: "image",
    view: "result",
    zoom: 1,
    imageReady: false,
    videoReady: false,
    pickingColor: false,
    renderingVideo: false,
    rafId: 0,
    videoUrl: "",
    toastTimer: 0,
    imageMeta: { name: "未选择图片", size: "-- x --", time: "--", status: "等待载入" },
    videoMeta: { name: "未选择视频", size: "-- x --", time: "--", status: "等待载入" },
  };

  const modeCopy = {
    image: {
      hash: "image",
      title: "一键抠图",
      upload: "选择图片",
      formats: "PNG / JPG / WEBP",
      drop: "拖放图片到画布",
      action: "一键抠图",
      download: "下载 PNG",
    },
    video: {
      hash: "video",
      title: "绿幕转视频",
      upload: "选择视频",
      formats: "MP4 / MOV / WEBM",
      drop: "拖放绿幕视频到画布",
      action: "更新预览",
      download: "导出 WEBM",
    },
  };

  function refreshIcons() {
    if (window.lucide) window.lucide.createIcons({ attrs: { "aria-hidden": "true" } });
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
  }

  function hexToRgb(hex) {
    const value = hex.replace("#", "");
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16),
    };
  }

  function rgbToHex(r, g, b) {
    return `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  }

  function syncCanvasDimensions(width, height, mode) {
    const workCanvases = mode === "video" ? [videoFrameCanvas, videoProcessedCanvas] : [sourceCanvas, processedCanvas];
    [...workCanvases, previewCanvas].forEach((canvas) => {
      canvas.width = width;
      canvas.height = height;
    });
    $("#canvas-size").textContent = `${width} x ${height}`;
    $("#file-size").textContent = `${width} x ${height}`;
  }

  function processPixels(source, targetCanvas, options) {
    const width = source.width;
    const height = source.height;
    const inputContext = source.getContext("2d", { willReadFrequently: true });
    const outputContext = targetCanvas.getContext("2d", { willReadFrequently: true });
    const imageData = inputContext.getImageData(0, 0, width, height);
    const data = imageData.data;
    const target = hexToRgb(options.color);
    const targetLuminance = target.r * 0.2126 + target.g * 0.7152 + target.b * 0.0722;
    const threshold = options.tolerance * 4.42;
    const softness = Math.max(1, options.softness * 3.2);
    const spill = options.spill / 100;

    for (let index = 0; index < data.length; index += 4) {
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const distance = Math.sqrt((red - target.r) ** 2 + (green - target.g) ** 2 + (blue - target.b) ** 2);
      let edge = Math.max(0, Math.min(1, (distance - threshold) / softness));
      if (options.keepShadow) {
        const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
        const shadowDepth = Math.max(0, Math.min(1, (targetLuminance - luminance - 8) / 58));
        if (distance < threshold + softness * 1.8) edge = Math.max(edge, shadowDepth * 0.42);
      }
      data[index + 3] = Math.round(data[index + 3] * edge);

      if (target.g > target.r * 1.15 && target.g > target.b * 1.15 && spill > 0) {
        const neutral = Math.max(red, blue);
        const greenExcess = Math.max(0, green - neutral);
        data[index + 1] = Math.round(green - greenExcess * spill * (1 - edge * 0.4));
      }
    }

    outputContext.clearRect(0, 0, width, height);
    outputContext.putImageData(imageData, 0, 0);
  }

  function intelligentImageMatte(source, targetCanvas, options) {
    const width = source.width;
    const height = source.height;
    const total = width * height;
    const inputContext = source.getContext("2d", { willReadFrequently: true });
    const outputContext = targetCanvas.getContext("2d", { willReadFrequently: true });
    const imageData = inputContext.getImageData(0, 0, width, height);
    const output = new Uint8ClampedArray(imageData.data);
    const background = hexToRgb(options.color);
    const backgroundMask = new Uint8Array(total);
    let transparentPixels = 0;

    for (let index = 0; index < total; index += 1) {
      if (output[index * 4 + 3] < 128) transparentPixels += 1;
    }
    if (transparentPixels / total > 0.1) {
      outputContext.putImageData(new ImageData(output, width, height), 0, 0);
      return;
    }

    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;
    const nearWhite = background.r + background.g + background.b > 690;
    const tolerance = nearWhite ? Math.max(options.tolerance, 42) : options.tolerance;
    const toleranceSquared = tolerance * tolerance;
    const isBackgroundColor = (offset, thresholdSquared = toleranceSquared) => {
      if (output[offset + 3] < 12) return true;
      const redDistance = output[offset] - background.r;
      const greenDistance = output[offset + 1] - background.g;
      const blueDistance = output[offset + 2] - background.b;
      return redDistance * redDistance + greenDistance * greenDistance + blueDistance * blueDistance <= thresholdSquared;
    };
    const pushIfBackground = (index) => {
      if (backgroundMask[index] || !isBackgroundColor(index * 4)) return;
      backgroundMask[index] = 1;
      queue[tail] = index;
      tail += 1;
    };

    for (let x = 0; x < width; x += 1) {
      pushIfBackground(x);
      pushIfBackground((height - 1) * width + x);
    }
    for (let y = 0; y < height; y += 1) {
      pushIfBackground(y * width);
      pushIfBackground(y * width + width - 1);
    }

    while (head < tail) {
      const index = queue[head];
      head += 1;
      const x = index % width;
      const y = (index - x) / width;
      if (x > 0) pushIfBackground(index - 1);
      if (x < width - 1) pushIfBackground(index + 1);
      if (y > 0) pushIfBackground(index - width);
      if (y < height - 1) pushIfBackground(index + width);
    }

    if (options.removeEnclosed) {
      for (let index = 0; index < total; index += 1) {
        if (!backgroundMask[index] && isBackgroundColor(index * 4)) backgroundMask[index] = 1;
      }
    }
    for (let index = 0; index < total; index += 1) {
      if (backgroundMask[index]) output[index * 4 + 3] = 0;
    }

    const hasTransparentNeighbor = (index, pixels = output) => {
      const x = index % width;
      const y = (index - x) / width;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) return true;
          if (pixels[(nextY * width + nextX) * 4 + 3] === 0) return true;
        }
      }
      return false;
    };

    for (let pass = 0; pass < options.edgeTrim; pass += 1) {
      const multiplier = 1 + 0.25 * (pass + 1);
      const passToleranceSquared = toleranceSquared * multiplier * multiplier;
      const erase = [];
      for (let index = 0; index < total; index += 1) {
        const offset = index * 4;
        if (output[offset + 3] === 0 || !hasTransparentNeighbor(index)) continue;
        if (isBackgroundColor(offset, passToleranceSquared)) erase.push(index);
      }
      for (const index of erase) {
        backgroundMask[index] = 1;
        output[index * 4 + 3] = 0;
      }
    }

    const feathered = new Uint8ClampedArray(output);
    const gaussian = [1, 2, 1, 2, 4, 2, 1, 2, 1];
    for (let index = 0; index < total; index += 1) {
      const offset = index * 4;
      if (output[offset + 3] === 0 || !hasTransparentNeighbor(index)) continue;
      const x = index % width;
      const y = (index - x) / width;
      let alphaSum = 0;
      let weightSum = 0;
      let kernelIndex = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nextX = x + dx;
          const nextY = y + dy;
          const weight = gaussian[kernelIndex];
          kernelIndex += 1;
          const alpha = nextX < 0 || nextX >= width || nextY < 0 || nextY >= height ? 0 : output[(nextY * width + nextX) * 4 + 3];
          alphaSum += alpha * weight;
          weightSum += weight;
        }
      }
      feathered[offset + 3] = Math.round(alphaSum / weightSum);
    }

    const edgeDarkening = Math.max(0, Math.min(1, options.edgeDarkening / 100));
    if (edgeDarkening > 0) {
      for (let index = 0; index < total; index += 1) {
        const offset = index * 4;
        if (feathered[offset + 3] === 0 || !hasTransparentNeighbor(index, feathered)) continue;
        feathered[offset] = Math.round(feathered[offset] * (1 - edgeDarkening));
        feathered[offset + 1] = Math.round(feathered[offset + 1] * (1 - edgeDarkening));
        feathered[offset + 2] = Math.round(feathered[offset + 2] * (1 - edgeDarkening));
      }
    }

    outputContext.clearRect(0, 0, width, height);
    outputContext.putImageData(new ImageData(feathered, width, height), 0, 0);
  }

  function processImage() {
    if (!state.imageReady) return;
    const started = performance.now();
    intelligentImageMatte(sourceCanvas, processedCanvas, {
      color: $("#image-color").value,
      tolerance: Number($("#image-tolerance").value),
      edgeTrim: Number($("#image-softness").value),
      edgeDarkening: Number($("#image-spill").value),
      removeEnclosed: $("#remove-enclosed").checked,
    });
    renderImagePreview();
    state.imageMeta.time = `${Math.max(1, Math.round(performance.now() - started))} ms`;
    if (state.mode === "image") $("#process-time").textContent = state.imageMeta.time;
  }

  function renderImagePreview() {
    previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    previewContext.drawImage(state.view === "source" ? sourceCanvas : processedCanvas, 0, 0);
  }

  function loadImageFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      showToast("请选择 PNG、JPG 或 WEBP 图片");
      return;
    }
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const maxDimension = 1600;
      const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      syncCanvasDimensions(width, height, "image");
      sourceContext.clearRect(0, 0, width, height);
      sourceContext.drawImage(image, 0, 0, width, height);
      state.imageReady = true;
      state.imageMeta = { name: file.name, size: `${width} x ${height}`, time: "--", status: "已载入" };
      $("#file-name").textContent = state.imageMeta.name;
      $("#canvas-state").textContent = file.name.toUpperCase();
      $("#asset-status").textContent = state.imageMeta.status;
      $("#image-empty").hidden = true;
      $("#process-button").disabled = false;
      $("#download-button").disabled = false;
      sampleCornerColor("image");
      processImage();
      URL.revokeObjectURL(url);
      showToast("图片已载入并完成抠图");
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      showToast("无法读取这张图片");
    };
    image.src = url;
  }

  function sampleCornerColor(mode) {
    const canvas = mode === "image" ? sourceCanvas : videoFrameCanvas;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const size = Math.max(2, Math.min(6, Math.floor(Math.min(canvas.width, canvas.height) / 20)));
    const points = [
      [0, 0],
      [canvas.width - size, 0],
      [0, canvas.height - size],
      [canvas.width - size, canvas.height - size],
    ];
    const reds = [];
    const greens = [];
    const blues = [];
    for (const [startX, startY] of points) {
      const sample = context.getImageData(startX, startY, size, size).data;
      for (let offset = 0; offset < sample.length; offset += 4) {
        reds.push(sample[offset]);
        greens.push(sample[offset + 1]);
        blues.push(sample[offset + 2]);
      }
    }
    const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 255;
    const color = rgbToHex(median(reds), median(greens), median(blues));
    setColor(mode, color);
  }

  function setColor(mode, color) {
    const input = $(`#${mode}-color`);
    const output = $(`#${mode}-color-value`);
    input.value = color.toLowerCase();
    output.textContent = color.toUpperCase();
  }

  function updateRangeOutput(input) {
    const output = $(`#${input.id}-output`);
    if (!output) return;
    if (input.id === "image-tolerance") output.textContent = input.value;
    else if (input.id === "image-softness") output.textContent = `${input.value} px`;
    else output.textContent = `${input.value}%`;
  }

  function setMode(mode, updateHash = true) {
    if (!modeCopy[mode]) return;
    state.mode = mode;
    state.pickingColor = false;
    const copy = modeCopy[mode];
    $(".studio").dataset.activeMode = mode;
    $$(".mode-button").forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    $("#panel-title").textContent = copy.title;
    $("#upload-title").textContent = copy.upload;
    $("#upload-formats").textContent = copy.formats;
    $("#drop-text").textContent = copy.drop;
    $("#process-button span").textContent = copy.action;
    $("#download-button span").textContent = copy.download;
    credits?.updateExportCost(mode === "image" ? "image_export" : "video_export", mode === "video" ? video.duration || 0 : 0);
    $(".image-controls").hidden = mode !== "image";
    $(".video-controls").hidden = mode !== "video";
    $(".image-format").hidden = mode !== "image";
    $(".video-format").hidden = mode !== "video";
    $(".image-view-switch").hidden = mode !== "image";
    $(".video-timeline").hidden = mode !== "video";
    $("#image-empty").hidden = mode !== "image" || state.imageReady;
    $("#video-empty").hidden = mode !== "video" || state.videoReady;
    $("#process-button").disabled = mode === "image" ? !state.imageReady : false;
    $("#download-button").disabled = mode === "image" ? !state.imageReady : !state.videoReady;
    $("#primary-shortcut").innerHTML = mode === "video" ? "<kbd>Space</kbd> 播放" : "<kbd>V</kbd> 对比";

    if (mode === "image") {
      window.cancelAnimationFrame(state.rafId);
      video.pause();
      previewCanvas.width = sourceCanvas.width || 1200;
      previewCanvas.height = sourceCanvas.height || 800;
      renderImagePreview();
      $("#file-name").textContent = state.imageMeta.name;
      $("#file-size").textContent = state.imageMeta.size;
      $("#process-time").textContent = state.imageMeta.time;
      $("#asset-status").textContent = state.imageMeta.status;
      $("#canvas-state").textContent = state.imageMeta.name.toUpperCase();
      $("#canvas-size").textContent = state.imageReady ? `${previewCanvas.width} x ${previewCanvas.height}` : "-- x --";
    } else if (state.videoReady) {
      previewCanvas.width = videoFrameCanvas.width;
      previewCanvas.height = videoFrameCanvas.height;
      $("#file-name").textContent = state.videoMeta.name;
      $("#file-size").textContent = state.videoMeta.size;
      $("#process-time").textContent = state.videoMeta.time;
      $("#asset-status").textContent = state.videoMeta.status;
      $("#canvas-state").textContent = state.videoMeta.name.toUpperCase();
      $("#canvas-size").textContent = `${previewCanvas.width} x ${previewCanvas.height}`;
      drawVideoFrame();
    } else {
      previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      $("#canvas-state").textContent = "NO_VIDEO";
      $("#canvas-size").textContent = "-- x --";
      $("#file-name").textContent = state.videoMeta.name;
      $("#file-size").textContent = state.videoMeta.size;
      $("#process-time").textContent = state.videoMeta.time;
      $("#asset-status").textContent = state.videoMeta.status;
    }
    if (updateHash) history.replaceState(null, "", `#${copy.hash}`);
  }

  function loadVideoFile(file) {
    if (!file || !file.type.startsWith("video/")) {
      showToast("请选择 MP4、MOV 或 WEBM 视频");
      return;
    }
    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
    state.videoUrl = URL.createObjectURL(file);
    video.src = state.videoUrl;
    video.load();
    state.videoMeta = { name: file.name, size: "读取中", time: "--", status: "载入中" };
    $("#file-name").textContent = state.videoMeta.name;
    $("#canvas-state").textContent = file.name.toUpperCase();
    $("#asset-status").textContent = "载入中";
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return "00:00";
    const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
    const remain = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${minutes}:${remain}`;
  }

  function drawVideoFrame() {
    if (!state.videoReady || video.readyState < 2) return;
    const started = performance.now();
    videoFrameContext.drawImage(video, 0, 0, videoFrameCanvas.width, videoFrameCanvas.height);
    processPixels(videoFrameCanvas, videoProcessedCanvas, {
      color: $("#video-color").value,
      tolerance: Number($("#video-tolerance").value),
      softness: Number($("#video-softness").value),
      spill: Number($("#video-spill").value),
    });
    previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    previewContext.drawImage(videoProcessedCanvas, 0, 0);
    state.videoMeta.time = `${Math.max(1, Math.round(performance.now() - started))} ms`;
    $("#process-time").textContent = state.videoMeta.time;
    $("#video-current").textContent = formatTime(video.currentTime);
    $("#video-seek").value = video.duration ? String(Math.round((video.currentTime / video.duration) * 1000)) : "0";
    if (!video.paused && !video.ended) state.rafId = window.requestAnimationFrame(drawVideoFrame);
  }

  async function exportVideo() {
    if (!state.videoReady || state.renderingVideo) return;
    if (!previewCanvas.captureStream || !window.MediaRecorder) {
      showToast("当前浏览器不支持视频导出");
      return;
    }
    const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) {
      showToast("当前浏览器不支持 WEBM 编码");
      return;
    }

    const approved = await credits.confirmExport("video_export", video.duration || 0);
    if (!approved) return;

    state.renderingVideo = true;
    const fps = Number($("#video-fps").value);
    const stream = previewCanvas.captureStream(fps);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      try {
        if (!blob.size) throw new Error("empty_video_export");
        const charged = await credits.charge("video_export", video.duration || 0);
        if (!charged.ok) return;
        downloadBlob(blob, `${fileStem(state.videoMeta.name)}-cutframe.webm`);
        showToast(`透明 WEBM 已生成，已使用 ${charged.cost} 积分`);
      } catch (error) {
        console.error("Video export failed", error);
        showToast("视频生成失败，本次未扣积分");
      } finally {
        state.renderingVideo = false;
        $("#export-progress").hidden = true;
        $("#download-button").disabled = false;
      }
    };

    $("#export-progress").hidden = false;
    $("#download-button").disabled = true;
    video.pause();
    video.currentTime = 0;
    try {
      await new Promise((resolve) => video.addEventListener("seeked", resolve, { once: true }));
      recorder.start(250);
      await video.play();
      drawVideoFrame();
      video.addEventListener("timeupdate", updateExportProgress);
      video.addEventListener(
        "ended",
        () => {
          video.removeEventListener("timeupdate", updateExportProgress);
          recorder.stop();
        },
        { once: true },
      );
    } catch (error) {
      console.error("Video export could not start", error);
      if (recorder.state !== "inactive") recorder.stop();
      state.renderingVideo = false;
      $("#export-progress").hidden = true;
      $("#download-button").disabled = false;
      showToast("视频生成失败，本次未扣积分");
    }
  }

  function updateExportProgress() {
    const progress = video.duration ? Math.round((video.currentTime / video.duration) * 100) : 0;
    $("#export-progress-text").textContent = `正在生成视频 ${progress}%`;
    $("#export-progress-bar").style.width = `${progress}%`;
  }

  function fileStem(name) {
    return (name || "cutframe").replace(/\.[^.]+$/, "").replace(/[^\w\u4e00-\u9fa5-]+/g, "-");
  }

  function downloadBlob(blob, name) {
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function canvasToBlob(canvas, type) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas_export_failed"))), type);
    });
  }

  async function downloadImage() {
    const approved = await credits.confirmExport("image_export");
    if (!approved) return;
    try {
      const blob = await canvasToBlob(processedCanvas, "image/png");
      const charged = await credits.charge("image_export");
      if (!charged.ok) return;
      downloadBlob(blob, `${fileStem(state.imageMeta.name)}-cutframe.png`);
      showToast(`透明 PNG 已生成，已使用 ${charged.cost} 积分`);
    } catch (error) {
      console.error("Image export failed", error);
      showToast("图片生成失败，本次未扣积分");
    }
  }

  function setZoom(nextZoom) {
    state.zoom = Math.max(0.6, Math.min(1.4, nextZoom));
    $("#canvas-frame").style.setProperty("--canvas-zoom", state.zoom);
    $("#zoom-value").textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function resetControls() {
    if (state.mode === "image") {
      setColor("image", "#D6D2CC");
      $("#image-tolerance").value = "32";
      $("#image-softness").value = "1";
      $("#image-spill").value = "40";
      $("#remove-enclosed").checked = false;
      $$(".image-controls input[type='range']").forEach(updateRangeOutput);
      processImage();
    } else {
      setColor("video", "#00A94F");
      $("#video-tolerance").value = "30";
      $("#video-softness").value = "8";
      $("#video-spill").value = "38";
      $$(".video-controls input[type='range']").forEach(updateRangeOutput);
      drawVideoFrame();
    }
    showToast("参数已恢复默认");
  }

  $$(".mode-button").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
  $$(".view-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      $$(".view-button").forEach((item) => item.classList.toggle("is-active", item === button));
      renderImagePreview();
    });
  });

  $$("input[type='range']").forEach((input) => {
    input.addEventListener("input", () => {
      updateRangeOutput(input);
      if (state.mode === "image" && input.id.startsWith("image")) processImage();
      if (state.mode === "video" && input.id.startsWith("video")) drawVideoFrame();
    });
  });

  $("#image-color").addEventListener("input", (event) => {
    setColor("image", event.target.value);
    processImage();
  });
  $("#video-color").addEventListener("input", (event) => {
    setColor("video", event.target.value);
    drawVideoFrame();
  });
  $("#remove-enclosed").addEventListener("change", processImage);
  $("#image-eyedropper").addEventListener("click", () => {
    state.pickingColor = "image";
    showToast("点击画面中的背景区域取色");
  });
  $("#video-eyedropper").addEventListener("click", () => {
    state.pickingColor = "video";
    showToast("点击视频中的绿幕区域取色");
  });

  previewCanvas.addEventListener("click", (event) => {
    if (!state.pickingColor) return;
    const rect = previewCanvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(previewCanvas.width - 1, Math.round(((event.clientX - rect.left) / rect.width) * previewCanvas.width)));
    const y = Math.max(0, Math.min(previewCanvas.height - 1, Math.round(((event.clientY - rect.top) / rect.height) * previewCanvas.height)));
    const pixel = (state.pickingColor === "image" ? sourceContext : videoFrameContext).getImageData(x, y, 1, 1).data;
    const color = rgbToHex(pixel[0], pixel[1], pixel[2]);
    setColor(state.pickingColor, color);
    if (state.pickingColor === "image") processImage();
    else drawVideoFrame();
    state.pickingColor = false;
    showToast(`已取样 ${color}`);
  });

  $("#upload-button").addEventListener("click", () => $(state.mode === "image" ? "#image-file" : "#video-file").click());
  $("#header-upload").addEventListener("click", () => $(state.mode === "image" ? "#image-file" : "#video-file").click());
  $("#empty-image-upload").addEventListener("click", () => $("#image-file").click());
  $("#empty-video-upload").addEventListener("click", () => $("#video-file").click());
  $(".menu-button").addEventListener("click", () => {
    const collapsed = document.body.classList.toggle("sidebar-collapsed");
    $(".menu-button").setAttribute("aria-label", collapsed ? "展开侧栏" : "收起侧栏");
    $(".menu-button").setAttribute("title", collapsed ? "展开侧栏" : "收起侧栏");
  });
  $("#image-file").addEventListener("change", (event) => loadImageFile(event.target.files[0]));
  $("#video-file").addEventListener("change", (event) => loadVideoFile(event.target.files[0]));
  $("#process-button").addEventListener("click", () => {
    if (state.mode === "image" && state.imageReady) {
      processImage();
      showToast("抠图结果已更新");
    } else if (state.mode === "image") {
      $("#image-file").click();
    } else if (state.videoReady) {
      drawVideoFrame();
      showToast("绿幕预览已更新");
    } else {
      $("#video-file").click();
    }
  });
  $("#download-button").addEventListener("click", () => (state.mode === "image" ? downloadImage() : exportVideo()));
  $("#reset-button").addEventListener("click", resetControls);
  $("#zoom-out").addEventListener("click", () => setZoom(state.zoom - 0.1));
  $("#zoom-in").addEventListener("click", () => setZoom(state.zoom + 0.1));

  const canvasShell = $("#canvas-shell");
  ["dragenter", "dragover"].forEach((eventName) => {
    canvasShell.addEventListener(eventName, (event) => {
      event.preventDefault();
      canvasShell.classList.add("is-dragging");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    canvasShell.addEventListener(eventName, (event) => {
      event.preventDefault();
      canvasShell.classList.remove("is-dragging");
    });
  });
  canvasShell.addEventListener("drop", (event) => {
    const file = event.dataTransfer.files[0];
    if (state.mode === "image") loadImageFile(file);
    else loadVideoFile(file);
  });

  video.addEventListener("loadedmetadata", () => {
    const maxDimension = 1280;
    const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(2, Math.round((video.videoWidth * scale) / 2) * 2);
    const height = Math.max(2, Math.round((video.videoHeight * scale) / 2) * 2);
    syncCanvasDimensions(width, height, "video");
    state.videoReady = true;
    $("#video-empty").hidden = true;
    $("#play-video").disabled = false;
    $("#video-seek").disabled = false;
    $("#download-button").disabled = false;
    state.videoMeta.size = `${video.videoWidth} x ${video.videoHeight}`;
    state.videoMeta.status = "已载入";
    $("#file-size").textContent = state.videoMeta.size;
    $("#video-duration").textContent = formatTime(video.duration);
    credits?.updateExportCost("video_export", video.duration || 0);
    $("#asset-status").textContent = state.videoMeta.status;
    video.currentTime = Math.min(0.05, video.duration || 0);
  });
  video.addEventListener("seeked", drawVideoFrame);
  video.addEventListener("play", () => {
    $("#play-video").innerHTML = '<i data-lucide="pause"></i>';
    $("#play-video").setAttribute("aria-label", "暂停视频");
    refreshIcons();
    drawVideoFrame();
  });
  video.addEventListener("pause", () => {
    if (state.renderingVideo) return;
    $("#play-video").innerHTML = '<i data-lucide="play"></i>';
    $("#play-video").setAttribute("aria-label", "播放视频");
    refreshIcons();
  });
  video.addEventListener("error", () => showToast("视频无法解码，请尝试 MP4 或 WEBM"));
  $("#play-video").addEventListener("click", () => (video.paused ? video.play() : video.pause()));
  $("#video-seek").addEventListener("input", (event) => {
    if (video.duration) video.currentTime = (Number(event.target.value) / 1000) * video.duration;
  });

  window.addEventListener("keydown", (event) => {
    if (event.target.matches("input, select, button")) return;
    if (event.code === "Space" && state.mode === "video" && state.videoReady) {
      event.preventDefault();
      video.paused ? video.play() : video.pause();
    }
    if (event.key.toLowerCase() === "r") state.mode === "image" ? processImage() : drawVideoFrame();
    if (event.key.toLowerCase() === "v" && state.mode === "image") {
      const nextView = state.view === "result" ? "source" : "result";
      state.view = nextView;
      $$(".view-button").forEach((button) => button.classList.toggle("is-active", button.dataset.view === nextView));
      renderImagePreview();
    }
  });

  window.addEventListener("hashchange", () => setMode(location.hash.slice(1) === "video" ? "video" : "image", false));

  refreshIcons();
  setMode(location.hash.slice(1) === "video" ? "video" : "image", false);
})();
