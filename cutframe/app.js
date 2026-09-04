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

  const state = {
    mode: "image",
    view: "result",
    zoom: 1,
    imageReady: true,
    videoReady: false,
    pickingColor: false,
    renderingVideo: false,
    rafId: 0,
    videoUrl: "",
    toastTimer: 0,
    imageMeta: { name: "DEMO_01.PNG", size: "1200 x 800", time: "18 ms", status: "示例" },
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

  function drawDemo() {
    const width = 1200;
    const height = 800;
    syncCanvasDimensions(width, height, "image");
    sourceContext.fillStyle = "#d6d2cc";
    sourceContext.fillRect(0, 0, width, height);

    sourceContext.fillStyle = "rgba(25, 25, 25, .13)";
    sourceContext.beginPath();
    sourceContext.ellipse(620, 620, 365, 52, -0.03, 0, Math.PI * 2);
    sourceContext.fill();

    sourceContext.fillStyle = "#151515";
    sourceContext.beginPath();
    sourceContext.moveTo(290, 500);
    sourceContext.bezierCurveTo(355, 470, 390, 345, 475, 300);
    sourceContext.bezierCurveTo(560, 255, 650, 360, 730, 420);
    sourceContext.bezierCurveTo(800, 470, 950, 490, 1010, 550);
    sourceContext.lineTo(982, 610);
    sourceContext.bezierCurveTo(760, 632, 535, 634, 318, 608);
    sourceContext.closePath();
    sourceContext.fill();

    sourceContext.fillStyle = "#ff641e";
    sourceContext.beginPath();
    sourceContext.moveTo(430, 460);
    sourceContext.bezierCurveTo(475, 370, 535, 342, 605, 385);
    sourceContext.lineTo(750, 500);
    sourceContext.lineTo(654, 548);
    sourceContext.lineTo(510, 520);
    sourceContext.closePath();
    sourceContext.fill();

    sourceContext.strokeStyle = "#f1ede7";
    sourceContext.lineWidth = 15;
    sourceContext.lineCap = "round";
    [[492, 414, 626, 460], [478, 449, 606, 490], [470, 486, 575, 515]].forEach((line) => {
      sourceContext.beginPath();
      sourceContext.moveTo(line[0], line[1]);
      sourceContext.lineTo(line[2], line[3]);
      sourceContext.stroke();
    });

    sourceContext.fillStyle = "#f4f1ed";
    sourceContext.beginPath();
    sourceContext.moveTo(280, 566);
    sourceContext.bezierCurveTo(490, 594, 760, 592, 1004, 556);
    sourceContext.lineTo(982, 627);
    sourceContext.bezierCurveTo(742, 660, 500, 655, 310, 624);
    sourceContext.closePath();
    sourceContext.fill();

    sourceContext.fillStyle = "#ff641e";
    sourceContext.fillRect(785, 579, 95, 12);
    sourceContext.fillStyle = "#111111";
    sourceContext.font = "800 23px Manrope, sans-serif";
    sourceContext.fillText("CF-01", 840, 455);

    processImage();
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

  function processImage() {
    if (!state.imageReady) return;
    const started = performance.now();
    processPixels(sourceCanvas, processedCanvas, {
      color: $("#image-color").value,
      tolerance: Number($("#image-tolerance").value),
      softness: Number($("#image-softness").value),
      spill: Number($("#image-spill").value),
      keepShadow: $("#keep-shadow").checked,
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
    const points = [
      [2, 2],
      [canvas.width - 3, 2],
      [2, canvas.height - 3],
      [canvas.width - 3, canvas.height - 3],
    ];
    const colors = points.map(([x, y]) => context.getImageData(x, y, 1, 1).data);
    const color = rgbToHex(
      colors.reduce((sum, item) => sum + item[0], 0) / colors.length,
      colors.reduce((sum, item) => sum + item[1], 0) / colors.length,
      colors.reduce((sum, item) => sum + item[2], 0) / colors.length,
    );
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
    if (output) output.textContent = `${input.value}%`;
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
    $(".image-controls").hidden = mode !== "image";
    $(".video-controls").hidden = mode !== "video";
    $(".image-format").hidden = mode !== "image";
    $(".video-format").hidden = mode !== "video";
    $(".image-view-switch").hidden = mode !== "image";
    $(".video-timeline").hidden = mode !== "video";
    $("#video-empty").hidden = mode !== "video" || state.videoReady;
    $("#download-button").disabled = mode === "video" && !state.videoReady;
    $("#primary-shortcut").innerHTML = mode === "video" ? "<kbd>Space</kbd> 播放" : "<kbd>V</kbd> 对比";

    if (mode === "image") {
      window.cancelAnimationFrame(state.rafId);
      video.pause();
      previewCanvas.width = sourceCanvas.width;
      previewCanvas.height = sourceCanvas.height;
      renderImagePreview();
      $("#file-name").textContent = state.imageMeta.name;
      $("#file-size").textContent = state.imageMeta.size;
      $("#process-time").textContent = state.imageMeta.time;
      $("#asset-status").textContent = state.imageMeta.status;
      $("#canvas-state").textContent = state.imageMeta.name.toUpperCase();
      $("#canvas-size").textContent = `${previewCanvas.width} x ${previewCanvas.height}`;
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

    state.renderingVideo = true;
    const fps = Number($("#video-fps").value);
    const stream = previewCanvas.captureStream(fps);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      downloadBlob(blob, `${fileStem(state.videoMeta.name)}-cutframe.webm`);
      state.renderingVideo = false;
      $("#export-progress").hidden = true;
      $("#download-button").disabled = false;
      showToast("透明 WEBM 已生成");
    };

    $("#export-progress").hidden = false;
    $("#download-button").disabled = true;
    video.pause();
    video.currentTime = 0;
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

  function downloadImage() {
    processedCanvas.toBlob((blob) => {
      if (!blob) return;
      downloadBlob(blob, `${fileStem(state.imageMeta.name)}-cutframe.png`);
      showToast("透明 PNG 已生成");
    }, "image/png");
  }

  function setZoom(nextZoom) {
    state.zoom = Math.max(0.6, Math.min(1.4, nextZoom));
    $("#canvas-frame").style.setProperty("--canvas-zoom", state.zoom);
    $("#zoom-value").textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function resetControls() {
    if (state.mode === "image") {
      setColor("image", "#D6D2CC");
      $("#image-tolerance").value = "22";
      $("#image-softness").value = "10";
      $("#image-spill").value = "28";
      $("#keep-shadow").checked = true;
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
  $("#keep-shadow").addEventListener("change", processImage);
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
  $(".menu-button").addEventListener("click", () => {
    const collapsed = document.body.classList.toggle("sidebar-collapsed");
    $(".menu-button").setAttribute("aria-label", collapsed ? "展开侧栏" : "收起侧栏");
    $(".menu-button").setAttribute("title", collapsed ? "展开侧栏" : "收起侧栏");
  });
  $("#image-file").addEventListener("change", (event) => loadImageFile(event.target.files[0]));
  $("#video-file").addEventListener("change", (event) => loadVideoFile(event.target.files[0]));
  $("#process-button").addEventListener("click", () => {
    if (state.mode === "image") {
      processImage();
      showToast("抠图结果已更新");
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
  drawDemo();
  setMode(location.hash.slice(1) === "video" ? "video" : "image", false);
})();
