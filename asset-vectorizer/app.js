const $ = (selector) => document.querySelector(selector);

const ui = {
  appTitle: $("#appTitle"),
  fileInput: $("#fileInput"),
  sampleBtn: $("#sampleBtn"),
  analyzeBtn: $("#analyzeBtn"),
  analyzeText: $("#analyzeText"),
  splitBtn: $("#splitBtn"),
  zipBtn: $("#zipBtn"),
  zipText: $("#zipText"),
  clearBtn: $("#clearBtn"),
  pickBgBtn: $("#pickBgBtn"),
  previewCanvas: $("#previewCanvas"),
  dropZone: $("#dropZone"),
  emptyState: $("#emptyState"),
  assetList: $("#assetList"),
  imageMeta: $("#imageMeta"),
  statusText: $("#statusText"),
  selectedText: $("#selectedText"),
  assetCount: $("#assetCount"),
  processTime: $("#processTime"),
  bgSwatch: $("#bgSwatch"),
  bgText: $("#bgText"),
  removeEnclosed: $("#removeEnclosed"),
  exportMode: $("#exportMode"),
  modeButtons: [...document.querySelectorAll(".mode-button")],
  modeNote: $("#modeNote"),
  matteOnly: [...document.querySelectorAll(".matte-only")],
  vfxOnly: [...document.querySelectorAll(".vfx-only")],
  resultHeading: $("#resultHeading"),
  emptyText: $("#emptyText"),
  controls: {
    tolerance: $("#tolerance"),
    edgeTrim: $("#edgeTrim"),
    innerStroke: $("#innerStroke"),
    mergeGap: $("#mergeGap"),
    minArea: $("#minArea"),
    padding: $("#padding"),
    scale: $("#scale"),
    sharpness: $("#sharpness"),
    feather: $("#feather"),
    vfxHueRange: $("#vfxHueRange"),
    vfxBright: $("#vfxBright"),
    vfxRayCount: $("#vfxRayCount"),
  },
  outputs: {
    tolerance: $("#toleranceOut"),
    edgeTrim: $("#edgeTrimOut"),
    innerStroke: $("#innerStrokeOut"),
    mergeGap: $("#mergeGapOut"),
    minArea: $("#minAreaOut"),
    padding: $("#paddingOut"),
    scale: $("#scaleOut"),
    sharpness: $("#sharpnessOut"),
    feather: $("#featherOut"),
    vfxHueRange: $("#vfxHueRangeOut"),
    vfxBright: $("#vfxBrightOut"),
    vfxRayCount: $("#vfxRayCountOut"),
  },
};

const sourceCanvas = document.createElement("canvas");
const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
const processedCanvas = document.createElement("canvas");
const processedCtx = processedCanvas.getContext("2d", { willReadFrequently: true });
const previewCtx = ui.previewCanvas.getContext("2d");

const state = {
  mode: "matte",
  image: null,
  imageName: "",
  imageData: null,
  processedImageData: null,
  bgColor: { r: 255, g: 255, b: 255, a: 255 },
  bgMask: null,
  labels: null,
  components: [],
  groups: [],
  selectedId: null,
  pickingBg: false,
  vfxAnalysis: null,
  draw: {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    scale: 1,
    dpr: 1,
  },
  settings: {
    tolerance: 32,
    edgeTrim: 1,
    innerStroke: 40,
    removeEnclosed: true,
    mergeGap: 8,
    minArea: 120,
    padding: 12,
    scale: 2,
    sharpness: 22,
    feather: 0,
    vfxHueRange: 36,
    vfxBright: 210,
    vfxRayCount: 18,
  },
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const pad2 = (value) => value.toString(16).padStart(2, "0");

function updateControlText() {
  state.settings.tolerance = Number(ui.controls.tolerance.value);
  state.settings.edgeTrim = Number(ui.controls.edgeTrim.value);
  state.settings.innerStroke = Number(ui.controls.innerStroke.value);
  state.settings.removeEnclosed = ui.removeEnclosed.checked;
  state.settings.mergeGap = Number(ui.controls.mergeGap.value);
  state.settings.minArea = Number(ui.controls.minArea.value);
  state.settings.padding = Number(ui.controls.padding.value);
  state.settings.scale = Number(ui.controls.scale.value);
  state.settings.sharpness = Number(ui.controls.sharpness.value);
  state.settings.feather = Number(ui.controls.feather.value);
  state.settings.vfxHueRange = Number(ui.controls.vfxHueRange.value);
  state.settings.vfxBright = Number(ui.controls.vfxBright.value);
  state.settings.vfxRayCount = Number(ui.controls.vfxRayCount.value);

  ui.outputs.tolerance.value = state.settings.tolerance;
  ui.outputs.edgeTrim.value = `${state.settings.edgeTrim} px`;
  ui.outputs.innerStroke.value = `${state.settings.innerStroke}%`;
  ui.outputs.mergeGap.value = `${state.settings.mergeGap} px`;
  ui.outputs.minArea.value = state.settings.minArea;
  ui.outputs.padding.value = `${state.settings.padding} px`;
  ui.outputs.scale.value = `${state.settings.scale}x`;
  ui.outputs.sharpness.value = `${state.settings.sharpness}%`;
  ui.outputs.feather.value = `${state.settings.feather} px`;
  ui.outputs.vfxHueRange.value = `${state.settings.vfxHueRange}°`;
  ui.outputs.vfxBright.value = state.settings.vfxBright;
  ui.outputs.vfxRayCount.value = state.settings.vfxRayCount;
}

function setMode(mode, options = {}) {
  const nextMode = "matte";
  state.mode = nextMode;
  const isVfx = nextMode === "vfx";
  for (const button of ui.modeButtons) {
    const active = button.dataset.mode === nextMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }
  for (const element of ui.matteOnly) element.hidden = isVfx;
  for (const element of ui.vfxOnly) element.hidden = !isVfx;
  ui.splitBtn.hidden = isVfx;
  ui.analyzeText.textContent = isVfx ? "重新拆解" : "重新分离";
  ui.zipText.textContent = isVfx ? "全部 SVG" : "全部 PNG";
  ui.resultHeading.textContent = isVfx ? "矢量素材" : "分离结果";
  ui.emptyText.textContent = isVfx ? "拖入特效参考图" : "载入图片";
  ui.modeNote.textContent = isVfx
    ? "分析主色、爆点和放射方向，生成光条、碎片、爆闪、亮点四类纯 SVG。"
    : "按连通区域分离图片素材。";
  ui.appTitle.textContent = isVfx ? "特效素材拆解" : "图片素材拆解";
  state.selectedId = null;
  state.vfxAnalysis = null;
  if (state.imageData && options.analyze !== false) {
    analyzeImage();
  } else {
    state.groups = [];
    ui.assetCount.textContent = "0";
    ui.zipBtn.disabled = true;
    renderPreview();
    renderAssets();
  }
}

function updateBgUi() {
  const { r, g, b } = state.bgColor;
  const hex = `#${pad2(r)}${pad2(g)}${pad2(b)}`;
  ui.bgSwatch.style.background = hex;
  ui.bgText.textContent = hex;
}

function setStatus(text) {
  ui.statusText.textContent = text;
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function fileToImage(file, name = file.name) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ image, name });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片载入失败"));
    };
    image.src = url;
  });
}

function urlToImage(url, name = "reference.png") {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ image, name });
    image.onerror = () => reject(new Error("图片载入失败"));
    image.src = url;
  });
}

function makeVfxSampleUrl() {
  const centerX = 360;
  const centerY = 235;
  const rays = Array.from({ length: 18 }, (_, index) => {
    const angle = (index / 18) * Math.PI * 2 + (index % 3) * 0.035;
    const length = 88 + (index % 5) * 16;
    const x2 = centerX + Math.cos(angle) * length;
    const y2 = centerY + Math.sin(angle) * length;
    return `<line x1="${centerX}" y1="${centerY}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${index % 4 === 0 ? "#fff" : "#1dff6a"}" stroke-width="${index % 3 === 0 ? 7 : 4}" stroke-linecap="round"/>`;
  }).join("");
  const fragments = [
    "315,166 328,160 338,171 332,184 316,181",
    "409,190 420,183 430,194 423,207 411,205",
    "286,253 299,248 305,262 294,273 282,267",
    "398,294 411,287 421,301 410,313 396,308",
    "342,320 353,314 362,326 354,339 340,335",
  ].map((points) => `<polygon points="${points}" fill="#fff"/>`).join("");
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="480" viewBox="0 0 720 480">',
    '<rect width="720" height="480" fill="#f5bfd0"/>',
    '<path d="M0 86L520 145V480H0Z" fill="#b9d9e8"/>',
    '<circle cx="515" cy="250" r="92" fill="#c18492"/>',
    `<g opacity=".9">${rays}</g>`,
    fragments,
    '<circle cx="360" cy="235" r="44" fill="#fff" opacity=".92"/>',
    '<circle cx="360" cy="235" r="76" fill="none" stroke="#fff" stroke-width="5" opacity=".48"/>',
    '<circle cx="450" cy="170" r="8" fill="#1dff6a"/>',
    '<circle cx="252" cy="205" r="6" fill="#1dff6a"/>',
    '</svg>',
  ].join("");
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function loadSample() {
  setStatus(state.mode === "vfx" ? "载入特效示例..." : "载入示例图...");
  if (state.mode === "vfx") {
    const result = await urlToImage(makeVfxSampleUrl(), "vfx-hit-reference.svg");
    await useImage(result.image, result.name);
    return;
  }
  const response = await fetch("sample.png");
  const blob = await response.blob();
  const file = new File([blob], "sample.png", { type: blob.type || "image/png" });
  const result = await fileToImage(file, "sample.png");
  await useImage(result.image, result.name);
}

async function useImage(image, name) {
  state.image = image;
  state.imageName = name;
  sourceCanvas.width = image.naturalWidth;
  sourceCanvas.height = image.naturalHeight;
  sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
  sourceCtx.drawImage(image, 0, 0);
  state.imageData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  state.processedImageData = null;
  processedCanvas.width = sourceCanvas.width;
  processedCanvas.height = sourceCanvas.height;
  state.bgColor = sampleCornerColor(state.imageData, sourceCanvas.width, sourceCanvas.height);
  state.selectedId = null;
  updateBgUi();
  ui.emptyState.classList.add("is-hidden");
  ui.imageMeta.textContent = `${name} · ${sourceCanvas.width}×${sourceCanvas.height}`;
  renderPreview();
  await analyzeImage();
}

function sampleCornerColor(imageData, width, height) {
  const size = Math.max(2, Math.min(6, Math.floor(Math.min(width, height) / 20)));
  const points = [
    [0, 0],
    [width - size, 0],
    [0, height - size],
    [width - size, height - size],
  ];
  const reds = [];
  const greens = [];
  const blues = [];
  const alphas = [];
  for (const [startX, startY] of points) {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const offset = ((startY + y) * width + startX + x) * 4;
        reds.push(imageData.data[offset]);
        greens.push(imageData.data[offset + 1]);
        blues.push(imageData.data[offset + 2]);
        alphas.push(imageData.data[offset + 3]);
      }
    }
  }
  const median = (values) => {
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] ?? 255;
  };
  return { r: median(reds), g: median(greens), b: median(blues), a: median(alphas) };
}

function samplePixelColor(imageX, imageY) {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const x = clamp(Math.round(imageX), 0, width - 1);
  const y = clamp(Math.round(imageY), 0, height - 1);
  const offset = (y * width + x) * 4;
  const data = state.imageData.data;
  return {
    r: data[offset],
    g: data[offset + 1],
    b: data[offset + 2],
    a: data[offset + 3],
  };
}

function intelligentMatte(imageData, width, height, bgColor, settings) {
  const total = width * height;
  const bgMask = new Uint8Array(total);
  const output = new Uint8ClampedArray(imageData.data);
  let transparentPixels = 0;
  for (let index = 0; index < total; index += 1) {
    if (output[index * 4 + 3] < 128) transparentPixels += 1;
  }
  if (transparentPixels / total > 0.1) {
    for (let index = 0; index < total; index += 1) {
      if (output[index * 4 + 3] < 12) bgMask[index] = 1;
    }
    return { imageData: new ImageData(output, width, height), bgMask };
  }
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const nearWhite = bgColor.r + bgColor.g + bgColor.b > 690;
  const effectiveTolerance = nearWhite ? Math.max(settings.tolerance, 42) : settings.tolerance;
  const toleranceSquared = effectiveTolerance * effectiveTolerance;
  const isBackgroundColor = (offset, thresholdSquared = toleranceSquared) => {
    if (output[offset + 3] < 12) return true;
    const dr = output[offset] - bgColor.r;
    const dg = output[offset + 1] - bgColor.g;
    const db = output[offset + 2] - bgColor.b;
    return dr * dr + dg * dg + db * db <= thresholdSquared;
  };
  const pushIfBg = (index) => {
    if (bgMask[index]) return;
    if (!isBackgroundColor(index * 4)) return;
    bgMask[index] = 1;
    queue[tail] = index;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    pushIfBg(x);
    pushIfBg((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    pushIfBg(y * width);
    pushIfBg(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) pushIfBg(index - 1);
    if (x < width - 1) pushIfBg(index + 1);
    if (y > 0) pushIfBg(index - width);
    if (y < height - 1) pushIfBg(index + width);
  }

  if (settings.removeEnclosed) {
    for (let index = 0; index < total; index += 1) {
      if (!bgMask[index] && isBackgroundColor(index * 4)) bgMask[index] = 1;
    }
  }

  for (let index = 0; index < total; index += 1) {
    if (bgMask[index]) output[index * 4 + 3] = 0;
  }

  const hasTransparentNeighbor = (index, alphaData = output) => {
    const x = index % width;
    const y = (index - x) / width;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) return true;
        if (alphaData[(ny * width + nx) * 4 + 3] === 0) return true;
      }
    }
    return false;
  };

  for (let pass = 0; pass < settings.edgeTrim; pass += 1) {
    const multiplier = 1 + 0.25 * (pass + 1);
    const passToleranceSquared = toleranceSquared * multiplier * multiplier;
    const erase = [];
    for (let index = 0; index < total; index += 1) {
      const offset = index * 4;
      if (output[offset + 3] === 0 || !hasTransparentNeighbor(index)) continue;
      if (isBackgroundColor(offset, passToleranceSquared)) erase.push(index);
    }
    for (const index of erase) {
      bgMask[index] = 1;
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
        const nx = x + dx;
        const ny = y + dy;
        const weight = gaussian[kernelIndex++];
        const alpha = nx < 0 || nx >= width || ny < 0 || ny >= height
          ? 0
          : output[(ny * width + nx) * 4 + 3];
        alphaSum += alpha * weight;
        weightSum += weight;
      }
    }
    feathered[offset + 3] = Math.round(alphaSum / weightSum);
  }

  const strokeStrength = clamp(settings.innerStroke / 100, 0, 1);
  if (strokeStrength > 0) {
    for (let index = 0; index < total; index += 1) {
      const offset = index * 4;
      if (feathered[offset + 3] === 0 || !hasTransparentNeighbor(index, feathered)) continue;
      feathered[offset] = Math.round(feathered[offset] * (1 - strokeStrength));
      feathered[offset + 1] = Math.round(feathered[offset + 1] * (1 - strokeStrength));
      feathered[offset + 2] = Math.round(feathered[offset + 2] * (1 - strokeStrength));
    }
  }

  return { imageData: new ImageData(feathered, width, height), bgMask };
}

function isForeground(index, bgMask, imageData) {
  return !bgMask[index] && imageData.data[index * 4 + 3] > 12;
}

function labelComponents(imageData, bgMask, width, height) {
  const total = width * height;
  const labels = new Int32Array(total);
  const queue = new Int32Array(total);
  const components = [];
  let label = 0;

  for (let index = 0; index < total; index += 1) {
    if (labels[index] || !isForeground(index, bgMask, imageData)) continue;

    label += 1;
    let head = 0;
    let tail = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let area = 0;

    labels[index] = label;
    queue[tail] = index;
    tail += 1;

    while (head < tail) {
      const current = queue[head];
      head += 1;
      const x = current % width;
      const y = (current - x) / width;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      area += 1;

      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const next = ny * width + nx;
          if (labels[next] || !isForeground(next, bgMask, imageData)) continue;
          labels[next] = label;
          queue[tail] = next;
          tail += 1;
        }
      }
    }

    components.push({
      id: label,
      minX,
      minY,
      maxX,
      maxY,
      area,
    });
  }

  return { labels, components };
}

function rectDistance(a, b) {
  const dx = Math.max(0, Math.max(a.minX - b.maxX - 1, b.minX - a.maxX - 1));
  const dy = Math.max(0, Math.max(a.minY - b.maxY - 1, b.minY - a.maxY - 1));
  return Math.hypot(dx, dy);
}

function makeDisjointSet(size) {
  const parent = new Int32Array(size);
  const rank = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) parent[i] = i;
  const find = (value) => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    while (parent[value] !== value) {
      const next = parent[value];
      parent[value] = root;
      value = next;
    }
    return root;
  };
  const union = (a, b) => {
    let rootA = find(a);
    let rootB = find(b);
    if (rootA === rootB) return;
    if (rank[rootA] < rank[rootB]) {
      const temp = rootA;
      rootA = rootB;
      rootB = temp;
    }
    parent[rootB] = rootA;
    if (rank[rootA] === rank[rootB]) rank[rootA] += 1;
  };
  return { find, union };
}

function groupComponents(components, mergeGap, minArea) {
  const useful = components.filter((component) => component.area >= 3);
  const dsu = makeDisjointSet(useful.length);

  for (let i = 0; i < useful.length; i += 1) {
    for (let j = i + 1; j < useful.length; j += 1) {
      if (rectDistance(useful[i], useful[j]) <= mergeGap) {
        dsu.union(i, j);
      }
    }
  }

  const grouped = new Map();
  for (let i = 0; i < useful.length; i += 1) {
    const root = dsu.find(i);
    const component = useful[i];
    if (!grouped.has(root)) {
      grouped.set(root, {
        id: 0,
        labels: [],
        labelSet: new Set(),
        minX: component.minX,
        minY: component.minY,
        maxX: component.maxX,
        maxY: component.maxY,
        area: 0,
        partCount: 0,
      });
    }
    const group = grouped.get(root);
    group.labels.push(component.id);
    group.labelSet.add(component.id);
    group.minX = Math.min(group.minX, component.minX);
    group.minY = Math.min(group.minY, component.minY);
    group.maxX = Math.max(group.maxX, component.maxX);
    group.maxY = Math.max(group.maxY, component.maxY);
    group.area += component.area;
    group.partCount += 1;
  }

  return [...grouped.values()]
    .filter((group) => group.area >= minArea)
    .sort((a, b) => (a.minY === b.minY ? a.minX - b.minX : a.minY - b.minY))
    .map((group, index) => ({ ...group, id: index + 1 }));
}

function componentToGroup(component) {
  return {
    id: 0,
    labels: [component.id],
    labelSet: new Set([component.id]),
    minX: component.minX,
    minY: component.minY,
    maxX: component.maxX,
    maxY: component.maxY,
    area: component.area,
    partCount: 1,
  };
}

function sortAndNumberGroups(groups) {
  return groups
    .sort((a, b) => (a.minY === b.minY ? a.minX - b.minX : a.minY - b.minY))
    .map((group, index) => ({ ...group, id: index + 1 }));
}

function updateSplitButton() {
  const selected = state.groups.find((asset) => asset.id === state.selectedId);
  const canSplit = Boolean(selected && selected.partCount > 1);
  ui.splitBtn.disabled = !canSplit;
  ui.splitBtn.title = canSplit
    ? `将选中素材拆成 ${selected.partCount} 个独立元素`
    : "请选择包含多个元素的素材";
}

function splitSelectedAsset() {
  const selected = state.groups.find((asset) => asset.id === state.selectedId);
  if (!selected || selected.partCount <= 1) {
    setStatus("当前素材没有可拆分的独立元素");
    updateSplitButton();
    return;
  }

  const componentById = new Map(state.components.map((component) => [component.id, component]));
  const splitGroups = selected.labels
    .map((label) => componentById.get(label))
    .filter(Boolean)
    .map(componentToGroup);
  if (splitGroups.length <= 1) {
    setStatus("当前素材没有可拆分的独立元素");
    updateSplitButton();
    return;
  }

  const selectedLabel = splitGroups[0].labels[0];
  state.groups = sortAndNumberGroups([
    ...state.groups.filter((asset) => asset.id !== selected.id),
    ...splitGroups,
  ]);
  state.selectedId = state.groups.find((asset) => asset.labels[0] === selectedLabel)?.id ?? null;
  ui.assetCount.textContent = state.groups.length;
  ui.zipBtn.disabled = false;
  setStatus(`已将 ${getAssetName(selected)} 拆成 ${splitGroups.length} 个独立 PNG 元素`);
  renderPreview();
  renderAssets();
}

function rgbToHsv(r, g, b) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return { h: hue, s: max === 0 ? 0 : delta / max, v: max };
}

function hueDistance(a, b) {
  const distance = Math.abs(a - b) % 360;
  return Math.min(distance, 360 - distance);
}

function pixelGradient(data, width, height, x, y) {
  const offset = (y * width + x) * 4;
  const rightX = Math.min(width - 1, x + 1);
  const downY = Math.min(height - 1, y + 1);
  const right = (y * width + rightX) * 4;
  const down = (downY * width + x) * 4;
  return Math.max(
    Math.abs(data[offset] - data[right]),
    Math.abs(data[offset + 1] - data[right + 1]),
    Math.abs(data[offset + 2] - data[right + 2]),
    Math.abs(data[offset] - data[down]),
    Math.abs(data[offset + 1] - data[down + 1]),
    Math.abs(data[offset + 2] - data[down + 2]),
  );
}

function percentile(values, ratio, fallback = 0) {
  if (!values.length) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))];
}

function findEffectHue(imageData, bgMask, width, height) {
  const bins = Array.from({ length: 24 }, () => ({ energy: 0, count: 0, border: 0 }));
  const data = imageData.data;
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 260000)));
  const borderX = width * 0.06;
  const borderY = height * 0.06;

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const index = y * width + x;
      const offset = index * 4;
      if (data[offset + 3] < 20 || bgMask[index]) continue;
      const hsv = rgbToHsv(data[offset], data[offset + 1], data[offset + 2]);
      if (hsv.s < 0.28 || hsv.v < 0.28) continue;
      const gradient = pixelGradient(data, width, height, x, y) / 255;
      const bin = bins[Math.min(bins.length - 1, Math.floor(hsv.h / 15))];
      bin.energy += hsv.s * hsv.s * hsv.v * (0.2 + gradient * 1.8);
      bin.count += 1;
      if (x < borderX || x > width - borderX || y < borderY || y > height - borderY) {
        bin.border += 1;
      }
    }
  }

  let bestIndex = 8;
  let bestScore = -1;
  bins.forEach((bin, index) => {
    if (!bin.count) return;
    const borderRatio = bin.border / bin.count;
    const score = (bin.energy / Math.pow(bin.count, 0.32)) * (1 - borderRatio * 0.72);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return { hue: bestIndex * 15 + 7.5, score: Math.max(0, bestScore) };
}

function findEffectCenter(points, width, height) {
  if (!points.length) return { x: width / 2, y: height / 2 };
  const cellSize = Math.max(4, Math.ceil(Math.max(width, height) / 64));
  const gridWidth = Math.ceil(width / cellSize);
  const gridHeight = Math.ceil(height / cellSize);
  const grid = new Float32Array(gridWidth * gridHeight);
  for (const point of points) {
    const gx = Math.min(gridWidth - 1, Math.floor(point.x / cellSize));
    const gy = Math.min(gridHeight - 1, Math.floor(point.y / cellSize));
    grid[gy * gridWidth + gx] += point.weight;
  }

  let bestX = width / 2;
  let bestY = height / 2;
  let bestScore = -1;
  for (let gy = 0; gy < gridHeight; gy += 1) {
    for (let gx = 0; gx < gridWidth; gx += 1) {
      let score = 0;
      for (let dy = -2; dy <= 2; dy += 1) {
        const ny = gy + dy;
        if (ny < 0 || ny >= gridHeight) continue;
        for (let dx = -2; dx <= 2; dx += 1) {
          const nx = gx + dx;
          if (nx < 0 || nx >= gridWidth) continue;
          const distance = Math.hypot(dx, dy);
          score += grid[ny * gridWidth + nx] / (1 + distance * 0.7);
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestX = Math.min(width - 1, (gx + 0.5) * cellSize);
        bestY = Math.min(height - 1, (gy + 0.5) * cellSize);
      }
    }
  }
  return { x: bestX, y: bestY };
}

function collectVfxColorPoints(imageData, bgMask, width, height, targetHue, hueRange) {
  const data = imageData.data;
  const points = [];
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 320000)));
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const index = y * width + x;
      const offset = index * 4;
      if (data[offset + 3] < 20 || bgMask[index]) continue;
      const hsv = rgbToHsv(data[offset], data[offset + 1], data[offset + 2]);
      if (hsv.s < 0.3 || hsv.v < 0.28 || hueDistance(hsv.h, targetHue) > hueRange) continue;
      const gradient = pixelGradient(data, width, height, x, y) / 255;
      const weight = hsv.s * (0.55 + hsv.v) * (0.35 + gradient * 1.5);
      points.push({
        x,
        y,
        r: data[offset],
        g: data[offset + 1],
        b: data[offset + 2],
        weight,
      });
    }
  }
  return points;
}

function refineEffectGeometry(points, initialCenter, width, height) {
  if (!points.length) {
    return {
      center: initialCenter,
      extent: Math.min(width, height) * 0.25,
    };
  }
  let center = initialCenter;
  let distances = points.map((point) => Math.hypot(point.x - center.x, point.y - center.y));
  let extent = Math.max(12, percentile(distances, 0.94, Math.min(width, height) * 0.25));
  let sumX = 0;
  let sumY = 0;
  let sumWeight = 0;
  for (const point of points) {
    const distance = Math.hypot(point.x - center.x, point.y - center.y);
    if (distance > extent * 0.42) continue;
    const weight = point.weight / (1 + distance / Math.max(1, extent * 0.2));
    sumX += point.x * weight;
    sumY += point.y * weight;
    sumWeight += weight;
  }
  if (sumWeight > 0) {
    center = {
      x: center.x * 0.35 + (sumX / sumWeight) * 0.65,
      y: center.y * 0.35 + (sumY / sumWeight) * 0.65,
    };
  }
  distances = points.map((point) => Math.hypot(point.x - center.x, point.y - center.y));
  extent = clamp(
    percentile(distances, 0.95, extent),
    Math.min(width, height) * 0.08,
    Math.hypot(width, height) * 0.48,
  );
  return { center, extent };
}

function averageEffectColor(points) {
  if (!points.length) return "#24f778";
  let red = 0;
  let green = 0;
  let blue = 0;
  let weightSum = 0;
  for (const point of points) {
    red += point.r * point.weight;
    green += point.g * point.weight;
    blue += point.b * point.weight;
    weightSum += point.weight;
  }
  let channels = [red / weightSum, green / weightSum, blue / weightSum];
  const max = Math.max(...channels);
  if (max < 210) channels = channels.map((channel) => channel * (210 / Math.max(1, max)));
  return `#${channels.map((channel) => pad2(clamp(Math.round(channel), 0, 255))).join("")}`;
}

function analyzeRayDirections(points, center, extent, maxRays) {
  const binCount = 144;
  const profile = new Float32Array(binCount);
  const twoPi = Math.PI * 2;
  for (const point of points) {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const distance = Math.hypot(dx, dy);
    if (distance < extent * 0.1 || distance > extent * 1.2) continue;
    const angle = (Math.atan2(dy, dx) + twoPi) % twoPi;
    const bin = Math.min(binCount - 1, Math.floor((angle / twoPi) * binCount));
    profile[bin] += point.weight * Math.pow(distance / extent, 1.25);
  }
  const smooth = new Float32Array(binCount);
  for (let index = 0; index < binCount; index += 1) {
    for (let offset = -2; offset <= 2; offset += 1) {
      smooth[index] += profile[(index + offset + binCount) % binCount] * (3 - Math.abs(offset));
    }
  }
  const peak = Math.max(...smooth);
  const candidates = [];
  for (let index = 0; index < binCount; index += 1) {
    const value = smooth[index];
    if (
      value >= peak * 0.2 &&
      value >= smooth[(index - 1 + binCount) % binCount] &&
      value >= smooth[(index + 1) % binCount]
    ) {
      candidates.push({ index, value });
    }
  }
  candidates.sort((a, b) => b.value - a.value);
  const selected = [];
  const minSpacing = Math.max(3, Math.floor(binCount / (maxRays * 1.35)));
  for (const candidate of candidates) {
    const tooClose = selected.some((item) => {
      const direct = Math.abs(item.index - candidate.index);
      return Math.min(direct, binCount - direct) < minSpacing;
    });
    if (!tooClose) selected.push(candidate);
    if (selected.length >= maxRays) break;
  }
  if (selected.length < 6) {
    const fallbackCount = Math.min(maxRays, 12);
    selected.length = 0;
    for (let index = 0; index < fallbackCount; index += 1) {
      selected.push({ index: Math.floor((index / fallbackCount) * binCount), value: peak || 1 });
    }
  }
  const directions = selected.map((item) => {
    const angle = ((item.index + 0.5) / binCount) * twoPi;
    const nearby = points
      .map((point) => {
        const dx = point.x - center.x;
        const dy = point.y - center.y;
        const pointAngle = (Math.atan2(dy, dx) + twoPi) % twoPi;
        const angleDelta = Math.abs(Math.atan2(Math.sin(pointAngle - angle), Math.cos(pointAngle - angle)));
        return angleDelta < twoPi / binCount * 2.5 ? Math.hypot(dx, dy) : 0;
      })
      .filter((value) => value > 0);
    return {
      angle,
      strength: peak > 0 ? item.value / peak : 0.75,
      length: clamp(percentile(nearby, 0.9, extent * 0.75) / extent, 0.46, 1.08),
    };
  });
  return directions.sort((a, b) => a.angle - b.angle);
}

function labelBinaryMask(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const components = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let sumX = 0;
    let sumY = 0;
    const points = [];
    visited[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = (index - x) / width;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      sumX += x;
      sumY += y;
      if (points.length < 1800) points.push({ x, y });
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const next = ny * width + nx;
          if (!mask[next] || visited[next]) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    components.push({
      area: tail,
      minX,
      minY,
      maxX,
      maxY,
      centerX: sumX / tail,
      centerY: sumY / tail,
      points,
    });
  }
  return components;
}

function cross(origin, a, b) {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

function convexHull(points) {
  if (points.length <= 3) return points;
  const unique = [...new Map(points.map((point) => [`${point.x},${point.y}`, point])).values()]
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (unique.length <= 3) return unique;
  const lower = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper = [];
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function normalizeFragmentPoints(component, seed) {
  let hull = component ? convexHull(component.points) : [];
  if (hull.length > 10) {
    const step = hull.length / 9;
    hull = Array.from({ length: 9 }, (_, index) => hull[Math.floor(index * step)]);
  }
  if (hull.length < 5) {
    const count = 7;
    hull = Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
      const wobble = 0.78 + ((Math.sin(seed + index * 2.17) + 1) / 2) * 0.24;
      return { x: Math.cos(angle) * wobble, y: Math.sin(angle) * wobble };
    });
  }
  const minX = Math.min(...hull.map((point) => point.x));
  const minY = Math.min(...hull.map((point) => point.y));
  const maxX = Math.max(...hull.map((point) => point.x));
  const maxY = Math.max(...hull.map((point) => point.y));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const scale = 88 / Math.max(width, height);
  const offsetX = 64 - ((minX + maxX) / 2) * scale;
  const offsetY = 64 - ((minY + maxY) / 2) * scale;
  return hull.map((point) => ({
    x: point.x * scale + offsetX,
    y: point.y * scale + offsetY,
  }));
}

function findFragmentShape(imageData, bgMask, width, height, center, extent, brightThreshold) {
  const data = imageData.data;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * 4;
      if (bgMask[index] || data[offset + 3] < 20) continue;
      const hsv = rgbToHsv(data[offset], data[offset + 1], data[offset + 2]);
      const distance = Math.hypot(x - center.x, y - center.y);
      if (
        hsv.v * 255 >= brightThreshold &&
        hsv.s < 0.48 &&
        distance > extent * 0.12 &&
        distance < extent * 1.12 &&
        pixelGradient(data, width, height, x, y) > 8
      ) {
        mask[index] = 1;
      }
    }
  }
  const components = labelBinaryMask(mask, width, height)
    .map((component) => {
      const boxWidth = component.maxX - component.minX + 1;
      const boxHeight = component.maxY - component.minY + 1;
      const compactness = component.area / (boxWidth * boxHeight);
      const distance = Math.hypot(component.centerX - center.x, component.centerY - center.y);
      return { ...component, boxWidth, boxHeight, compactness, distance };
    })
    .filter(
      (component) =>
        component.area >= 4 &&
        component.area <= Math.max(80, extent * extent * 0.045) &&
        component.boxWidth <= extent * 0.34 &&
        component.boxHeight <= extent * 0.34 &&
        component.compactness >= 0.14,
    )
    .sort((a, b) => {
      const scoreA = a.area * a.compactness * (1 - Math.min(0.75, Math.abs(a.distance / extent - 0.48)));
      const scoreB = b.area * b.compactness * (1 - Math.min(0.75, Math.abs(b.distance / extent - 0.48)));
      return scoreB - scoreA;
    });
  return components[0] ?? null;
}

function makeStreakSvg(color, aspect) {
  const waist = clamp(6.5 - aspect * 0.12, 3.5, 6.5);
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="64" viewBox="0 0 256 64">',
    '<defs>',
    `<linearGradient id="streak" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${color}" stop-opacity="0"/><stop offset=".18" stop-color="${color}" stop-opacity=".35"/><stop offset=".5" stop-color="#fff"/><stop offset=".82" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>`,
    '<filter id="soft" x="-10%" y="-80%" width="120%" height="260%"><feGaussianBlur stdDeviation="4"/></filter>',
    '</defs>',
    `<path d="M6 32C58 ${32 - waist} 89 ${32 - waist * 0.7} 128 32C167 ${32 + waist * 0.7} 198 ${32 + waist} 250 32C198 ${32 - waist} 167 ${32 - waist * 0.7} 128 32C89 ${32 + waist * 0.7} 58 ${32 + waist} 6 32Z" fill="url(#streak)" opacity=".72" filter="url(#soft)"/>`,
    `<path d="M10 32C66 ${32 - waist * 0.42} 103 ${32 - waist * 0.2} 128 32C153 ${32 + waist * 0.2} 190 ${32 + waist * 0.42} 246 32C190 ${32 - waist * 0.42} 153 ${32 - waist * 0.2} 128 32C103 ${32 + waist * 0.2} 66 ${32 + waist * 0.42} 10 32Z" fill="url(#streak)"/>`,
    '<ellipse cx="128" cy="32" rx="28" ry="2.2" fill="#fff" opacity=".9"/>',
    '</svg>',
  ].join("");
}

function makeFragmentSvg(color, points) {
  const pointText = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">',
    '<defs>',
    `<linearGradient id="fragment" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".72" stop-color="#fff"/><stop offset="1" stop-color="${color}" stop-opacity=".58"/></linearGradient>`,
    '</defs>',
    `<polygon points="${pointText}" fill="url(#fragment)" stroke="${color}" stroke-opacity=".34" stroke-width="2" stroke-linejoin="round"/>`,
    '</svg>',
  ].join("");
}

function makeFlashSvg(color, directions) {
  const rays = directions
    .map((direction, index) => {
      const inner = 30 + (index % 3) * 3;
      const length = 68 + direction.length * 48;
      const x1 = 128 + Math.cos(direction.angle) * inner;
      const y1 = 128 + Math.sin(direction.angle) * inner;
      const x2 = 128 + Math.cos(direction.angle) * length;
      const y2 = 128 + Math.sin(direction.angle) * length;
      const opacity = 0.34 + direction.strength * 0.54;
      const strokeWidth = 1 + direction.strength * 1.8;
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${index % 4 === 0 ? "#fff" : color}" stroke-width="${strokeWidth.toFixed(1)}" opacity="${opacity.toFixed(2)}"/>`;
    })
    .join("");
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">',
    '<defs>',
    `<radialGradient id="flash"><stop offset="0" stop-color="#fff"/><stop offset=".2" stop-color="#fff" stop-opacity=".98"/><stop offset=".52" stop-color="${color}" stop-opacity=".48"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`,
    '<filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter>',
    '</defs>',
    `<g stroke-linecap="round" filter="url(#glow)" opacity=".5">${rays}</g>`,
    `<g stroke-linecap="round">${rays}</g>`,
    '<circle cx="128" cy="128" r="58" fill="url(#flash)" opacity=".72"/>',
    '<circle cx="128" cy="128" r="21" fill="#fff"/>',
    '</svg>',
  ].join("");
}

function makeDotSvg(color, softness) {
  const middle = clamp(0.28 + softness * 0.22, 0.32, 0.56).toFixed(2);
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">',
    '<defs>',
    `<radialGradient id="dot"><stop offset="0" stop-color="#fff"/><stop offset="${middle}" stop-color="${color}" stop-opacity=".92"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`,
    '</defs>',
    '<circle cx="64" cy="64" r="58" fill="url(#dot)"/>',
    '</svg>',
  ].join("");
}

function analyzeVfxReference(imageData, bgMask, width, height, settings) {
  const hueResult = findEffectHue(imageData, bgMask, width, height);
  let points = collectVfxColorPoints(
    imageData,
    bgMask,
    width,
    height,
    hueResult.hue,
    settings.vfxHueRange,
  );
  if (points.length < 12) {
    points = collectVfxColorPoints(imageData, bgMask, width, height, hueResult.hue, 90);
  }
  const initialCenter = findEffectCenter(points, width, height);
  const geometry = refineEffectGeometry(points, initialCenter, width, height);
  const directions = analyzeRayDirections(
    points,
    geometry.center,
    geometry.extent,
    settings.vfxRayCount,
  );
  const color = averageEffectColor(points);
  const fragment = findFragmentShape(
    imageData,
    bgMask,
    width,
    height,
    geometry.center,
    geometry.extent,
    settings.vfxBright,
  );
  const fragmentPoints = normalizeFragmentPoints(fragment, hueResult.hue + points.length * 0.013);
  const coreSamples = [];
  const data = imageData.data;
  const coreLimit = geometry.extent * 0.34;
  for (let y = Math.max(0, Math.floor(geometry.center.y - coreLimit)); y <= Math.min(height - 1, Math.ceil(geometry.center.y + coreLimit)); y += 1) {
    for (let x = Math.max(0, Math.floor(geometry.center.x - coreLimit)); x <= Math.min(width - 1, Math.ceil(geometry.center.x + coreLimit)); x += 1) {
      const distance = Math.hypot(x - geometry.center.x, y - geometry.center.y);
      if (distance > coreLimit) continue;
      const offset = (y * width + x) * 4;
      const hsv = rgbToHsv(data[offset], data[offset + 1], data[offset + 2]);
      if (data[offset + 3] > 20 && hsv.v * 255 >= settings.vfxBright && hsv.s < 0.52) {
        coreSamples.push(distance);
      }
    }
  }
  const coreRadius = clamp(
    percentile(coreSamples, 0.72, geometry.extent * 0.09),
    geometry.extent * 0.035,
    geometry.extent * 0.2,
  );
  const aspect = geometry.extent / Math.max(2, coreRadius);
  const confidence = clamp(
    0.34 + Math.min(0.34, points.length / 1800) + Math.min(0.26, directions.length / 60),
    0.34,
    0.94,
  );
  const assets = [
    {
      id: 1,
      kind: "streak",
      name: "hit-streak",
      label: "光条",
      width: 256,
      height: 64,
      meta: `主色 ${color} · 细长比 ${aspect.toFixed(1)}`,
      svg: makeStreakSvg(color, aspect),
    },
    {
      id: 2,
      kind: "fragment",
      name: "hit-fragment",
      label: "碎片",
      width: 128,
      height: 128,
      meta: fragment ? `参考轮廓 · ${fragment.area} px` : "参考颜色 · 自动补形",
      svg: makeFragmentSvg(color, fragmentPoints),
    },
    {
      id: 3,
      kind: "flash",
      name: "hit-flash",
      label: "爆闪",
      width: 256,
      height: 256,
      meta: `${directions.length} 条放射方向 · 中心 ${Math.round(coreRadius)} px`,
      svg: makeFlashSvg(color, directions),
    },
    {
      id: 4,
      kind: "dot",
      name: "hit-dot",
      label: "亮点",
      width: 128,
      height: 128,
      meta: `径向柔光 · 置信度 ${Math.round(confidence * 100)}%`,
      svg: makeDotSvg(color, coreRadius / Math.max(1, geometry.extent)),
    },
  ];
  return {
    assets,
    center: geometry.center,
    extent: geometry.extent,
    color,
    directions,
    confidence,
    hue: hueResult.hue,
    pointCount: points.length,
  };
}

async function analyzeImage() {
  if (!state.imageData) return;
  updateControlText();
  setStatus("正在分离素材...");
  ui.analyzeBtn.disabled = true;
  ui.splitBtn.disabled = true;
  ui.zipBtn.disabled = true;
  await nextFrame();

  const start = performance.now();
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const matteSettings = state.mode === "vfx"
    ? { ...state.settings, edgeTrim: 0, innerStroke: 0, removeEnclosed: false }
    : state.settings;
  const matte = intelligentMatte(
    state.imageData,
    width,
    height,
    state.bgColor,
    matteSettings,
  );
  state.bgMask = matte.bgMask;
  state.processedImageData = matte.imageData;
  processedCtx.putImageData(matte.imageData, 0, 0);
  if (state.mode === "vfx") {
    state.labels = null;
    state.components = [];
    state.vfxAnalysis = analyzeVfxReference(
      state.imageData,
      matte.bgMask,
      width,
      height,
      state.settings,
    );
    state.groups = state.vfxAnalysis.assets;
    state.selectedId = state.groups[0]?.id ?? null;
    const elapsed = Math.round(performance.now() - start);
    ui.assetCount.textContent = state.groups.length;
    ui.processTime.textContent = `${elapsed} ms`;
    setStatus(
      `特效拆解完成：主色 ${state.vfxAnalysis.color}，检测到 ${state.vfxAnalysis.directions.length} 条放射方向`,
    );
    ui.analyzeBtn.disabled = false;
    ui.zipBtn.disabled = state.groups.length === 0;
    renderPreview();
    renderAssets();
    return;
  }
  state.vfxAnalysis = null;
  const labeled = labelComponents(matte.imageData, state.bgMask, width, height);
  state.labels = labeled.labels;
  state.components = labeled.components;
  state.groups = groupComponents(
    labeled.components,
    state.settings.mergeGap,
    state.settings.minArea,
  );
  if (!state.groups.some((group) => group.id === state.selectedId)) {
    state.selectedId = state.groups[0]?.id ?? null;
  }

  const elapsed = Math.round(performance.now() - start);
  ui.assetCount.textContent = state.groups.length;
  ui.processTime.textContent = `${elapsed} ms`;
  setStatus(`智能抠图完成，已分离 ${state.groups.length} 个素材`);
  ui.analyzeBtn.disabled = false;
  ui.zipBtn.disabled = state.groups.length === 0;
  renderPreview();
  renderAssets();
}

function getAssetName(asset) {
  if (asset?.kind) return asset.name;
  return `asset-${String(asset.id).padStart(2, "0")}`;
}

function assetDimensions(asset) {
  if (asset?.kind) {
    return { x0: 0, y0: 0, width: asset.width, height: asset.height };
  }
  const pad = state.settings.padding;
  return {
    x0: asset.minX - pad,
    y0: asset.minY - pad,
    width: asset.maxX - asset.minX + 1 + pad * 2,
    height: asset.maxY - asset.minY + 1 + pad * 2,
  };
}

function makeAssetCanvas(asset, options = {}) {
  const pad = options.padding ?? state.settings.padding;
  const scale = options.scale ?? state.settings.scale;
  const feather = options.feather ?? state.settings.feather;
  const sharpness = options.sharpness ?? state.settings.sharpness;
  const bounds = {
    x0: asset.minX - pad,
    y0: asset.minY - pad,
    width: asset.maxX - asset.minX + 1 + pad * 2,
    height: asset.maxY - asset.minY + 1 + pad * 2,
  };
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = Math.max(1, bounds.width);
  cropCanvas.height = Math.max(1, bounds.height);
  const cropCtx = cropCanvas.getContext("2d", { willReadFrequently: true });
  const output = cropCtx.createImageData(cropCanvas.width, cropCanvas.height);
  const mask = new Uint8Array(cropCanvas.width * cropCanvas.height);
  const source = (state.processedImageData ?? state.imageData).data;
  const sourceWidth = sourceCanvas.width;
  const sourceHeight = sourceCanvas.height;

  for (let y = 0; y < cropCanvas.height; y += 1) {
    const sy = bounds.y0 + y;
    for (let x = 0; x < cropCanvas.width; x += 1) {
      const sx = bounds.x0 + x;
      const destIndex = y * cropCanvas.width + x;
      const destOffset = destIndex * 4;
      if (sx < 0 || sx >= sourceWidth || sy < 0 || sy >= sourceHeight) continue;
      const label = state.labels[sy * sourceWidth + sx];
      if (!asset.labelSet.has(label)) continue;
      const sourceOffset = (sy * sourceWidth + sx) * 4;
      output.data[destOffset] = source[sourceOffset];
      output.data[destOffset + 1] = source[sourceOffset + 1];
      output.data[destOffset + 2] = source[sourceOffset + 2];
      output.data[destOffset + 3] = source[sourceOffset + 3];
      mask[destIndex] = 1;
    }
  }

  if (feather > 0) {
    applyFeather(output, mask, cropCanvas.width, cropCanvas.height, feather);
  }

  cropCtx.putImageData(output, 0, 0);

  if (scale === 1 && sharpness === 0) return cropCanvas;

  const scaledCanvas = document.createElement("canvas");
  scaledCanvas.width = Math.max(1, Math.round(cropCanvas.width * scale));
  scaledCanvas.height = Math.max(1, Math.round(cropCanvas.height * scale));
  const scaledCtx = scaledCanvas.getContext("2d", { willReadFrequently: true });
  scaledCtx.imageSmoothingEnabled = true;
  scaledCtx.imageSmoothingQuality = "high";
  scaledCtx.drawImage(cropCanvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
  if (sharpness > 0) {
    sharpenCanvas(scaledCanvas, sharpness / 100);
  }
  return scaledCanvas;
}

function applyFeather(imageData, mask, width, height, radius) {
  const sourceAlpha = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i += 1) {
    sourceAlpha[i] = imageData.data[i * 4 + 3];
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!mask[index]) continue;
      let nearest = radius + 1;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const distance = Math.hypot(dx, dy);
          if (distance > radius) continue;
          if (!mask[ny * width + nx]) nearest = Math.min(nearest, distance);
        }
      }
      if (nearest <= radius) {
        const factor = clamp((nearest + 0.6) / (radius + 0.6), 0.18, 1);
        imageData.data[index * 4 + 3] = Math.round(sourceAlpha[index] * factor);
      }
    }
  }
}

function sharpenCanvas(canvas, strength) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const src = imageData.data;
  const out = new Uint8ClampedArray(src);
  const width = canvas.width;
  const height = canvas.height;
  const amount = clamp(strength, 0, 1.4);
  const getChannel = (x, y, channel, fallbackOffset) => {
    const nx = clamp(x, 0, width - 1);
    const ny = clamp(y, 0, height - 1);
    const offset = (ny * width + nx) * 4;
    if (src[offset + 3] < 8) return src[fallbackOffset + channel];
    return src[offset + channel];
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (src[offset + 3] < 8) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        const center = src[offset + channel] * (1 + amount * 4);
        const sides =
          getChannel(x - 1, y, channel, offset) +
          getChannel(x + 1, y, channel, offset) +
          getChannel(x, y - 1, channel, offset) +
          getChannel(x, y + 1, channel, offset);
        out[offset + channel] = clamp(Math.round(center - sides * amount), 0, 255);
      }
    }
  }
  imageData.data.set(out);
  ctx.putImageData(imageData, 0, 0);
}

function buildRunPath(asset, pad = state.settings.padding) {
  const x0 = asset.minX - pad;
  const y0 = asset.minY - pad;
  const width = asset.maxX - asset.minX + 1 + pad * 2;
  const height = asset.maxY - asset.minY + 1 + pad * 2;
  const sourceWidth = sourceCanvas.width;
  const sourceHeight = sourceCanvas.height;
  const path = [];

  for (let y = 0; y < height; y += 1) {
    let runStart = -1;
    for (let x = 0; x <= width; x += 1) {
      let inside = false;
      if (x < width) {
        const sx = x0 + x;
        const sy = y0 + y;
        if (sx >= 0 && sx < sourceWidth && sy >= 0 && sy < sourceHeight) {
          inside = asset.labelSet.has(state.labels[sy * sourceWidth + sx]);
        }
      }
      if (inside && runStart < 0) {
        runStart = x;
      } else if (!inside && runStart >= 0) {
        path.push(`M${runStart} ${y}H${x}V${y + 1}H${runStart}Z`);
        runStart = -1;
      }
    }
  }
  return {
    d: path.join(""),
    width,
    height,
  };
}

function averageAssetColor(asset) {
  const source = (state.processedImageData ?? state.imageData).data;
  const width = sourceCanvas.width;
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let y = asset.minY; y <= asset.maxY; y += 1) {
    for (let x = asset.minX; x <= asset.maxX; x += 1) {
      const label = state.labels[y * width + x];
      if (!asset.labelSet.has(label)) continue;
      const offset = (y * width + x) * 4;
      const alpha = source[offset + 3] / 255;
      if (alpha < 0.1) continue;
      r += source[offset] * alpha;
      g += source[offset + 1] * alpha;
      b += source[offset + 2] * alpha;
      count += alpha;
    }
  }
  if (!count) return "#222b26";
  return `#${pad2(Math.round(r / count))}${pad2(Math.round(g / count))}${pad2(Math.round(b / count))}`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function makeSvgString(asset) {
  if (asset?.kind) return asset.svg;
  const canvas = makeAssetCanvas(asset);
  const raster = canvas.toDataURL("image/png");
  const path = buildRunPath(asset);
  const title = getAssetName(asset);

  if (ui.exportMode.value === "silhouette") {
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${path.width}" height="${path.height}" viewBox="0 0 ${path.width} ${path.height}">`,
      `<title>${escapeXml(title)}</title>`,
      `<path d="${path.d}" fill="${averageAssetColor(asset)}"/>`,
      "</svg>",
    ].join("");
  }

  const clipId = `clip-${title}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${path.width} ${path.height}">`,
    `<title>${escapeXml(title)}</title>`,
    "<defs>",
    `<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><path d="${path.d}"/></clipPath>`,
    "</defs>",
    `<image href="${raster}" x="0" y="0" width="${path.width}" height="${path.height}" preserveAspectRatio="none" clip-path="url(#${clipId})"/>`,
    "</svg>",
  ].join("");
}

function renderPreview() {
  const canvas = ui.previewCanvas;
  const stage = ui.dropZone;
  const rect = stage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(320, Math.floor(rect.width));
  const height = Math.max(320, Math.floor(rect.height));
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  if (canvas.style.width !== `${width}px`) canvas.style.width = `${width}px`;
  if (canvas.style.height !== `${height}px`) canvas.style.height = `${height}px`;
  previewCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  previewCtx.clearRect(0, 0, width, height);

  if (!state.image) {
    ui.emptyState.classList.remove("is-hidden");
    return;
  }

  const scale = Math.min(width / sourceCanvas.width, height / sourceCanvas.height);
  const drawWidth = sourceCanvas.width * scale;
  const drawHeight = sourceCanvas.height * scale;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;
  state.draw = { x, y, width: drawWidth, height: drawHeight, scale, dpr };

  previewCtx.save();
  previewCtx.imageSmoothingEnabled = true;
  previewCtx.imageSmoothingQuality = "high";
  previewCtx.drawImage(state.processedImageData ? processedCanvas : state.image, x, y, drawWidth, drawHeight);
  previewCtx.restore();

  if (!state.groups.length) return;

  if (state.mode === "vfx" && state.vfxAnalysis) {
    const analysis = state.vfxAnalysis;
    const centerX = x + analysis.center.x * scale;
    const centerY = y + analysis.center.y * scale;
    previewCtx.save();
    previewCtx.strokeStyle = analysis.color;
    previewCtx.fillStyle = analysis.color;
    previewCtx.globalAlpha = 0.88;
    previewCtx.lineWidth = 1.4;
    const guideRadius = Math.max(10, analysis.extent * scale);
    previewCtx.beginPath();
    previewCtx.arc(centerX, centerY, Math.max(7, guideRadius * 0.08), 0, Math.PI * 2);
    previewCtx.stroke();
    for (const direction of analysis.directions) {
      previewCtx.globalAlpha = 0.2 + direction.strength * 0.38;
      previewCtx.beginPath();
      previewCtx.moveTo(centerX, centerY);
      previewCtx.lineTo(
        centerX + Math.cos(direction.angle) * guideRadius * direction.length,
        centerY + Math.sin(direction.angle) * guideRadius * direction.length,
      );
      previewCtx.stroke();
    }
    previewCtx.globalAlpha = 1;
    previewCtx.fillRect(centerX - 3, centerY - 1, 6, 2);
    previewCtx.fillRect(centerX - 1, centerY - 3, 2, 6);
    previewCtx.restore();
    return;
  }

  previewCtx.save();
  previewCtx.lineWidth = 1.5;
  previewCtx.font = "12px Inter, sans-serif";
  previewCtx.textBaseline = "top";
  for (const asset of state.groups) {
    const selected = asset.id === state.selectedId;
    const bx = x + asset.minX * scale;
    const by = y + asset.minY * scale;
    const bw = (asset.maxX - asset.minX + 1) * scale;
    const bh = (asset.maxY - asset.minY + 1) * scale;
    previewCtx.strokeStyle = selected ? "#ef4444" : "#28a9f4";
    previewCtx.fillStyle = selected ? "rgba(239, 68, 68, 0.12)" : "rgba(40, 169, 244, 0.12)";
    previewCtx.fillRect(bx, by, bw, bh);
    previewCtx.strokeRect(bx, by, bw, bh);
    previewCtx.fillStyle = selected ? "#ef4444" : "#28a9f4";
    const tag = String(asset.id).padStart(2, "0");
    const labelWidth = previewCtx.measureText(tag).width + 10;
    previewCtx.fillRect(bx, Math.max(0, by - 18), labelWidth, 18);
    previewCtx.fillStyle = "#ffffff";
    previewCtx.fillText(tag, bx + 5, Math.max(0, by - 16));
  }
  previewCtx.restore();
}

function renderVfxAssets() {
  ui.assetList.textContent = "";
  const selected = state.groups.find((asset) => asset.id === state.selectedId);
  ui.selectedText.textContent = selected ? `已选择 ${selected.label}` : "未选择素材";
  const fragment = document.createDocumentFragment();
  for (const asset of state.groups) {
    const card = document.createElement("article");
    card.className = `asset-card is-vfx${asset.id === state.selectedId ? " is-selected" : ""}`;
    card.dataset.assetId = String(asset.id);

    const preview = document.createElement("div");
    preview.className = "asset-preview";
    const image = document.createElement("img");
    image.alt = `${asset.label}矢量素材`;
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(asset.svg)}`;
    preview.append(image);

    const info = document.createElement("div");
    info.className = "asset-info";
    const title = document.createElement("div");
    title.className = "asset-title";
    title.innerHTML = `<strong>${asset.label}</strong><span class="asset-kind">${asset.kind.toUpperCase()}</span>`;
    const meta = document.createElement("div");
    meta.className = "asset-meta";
    meta.textContent = `${asset.width}×${asset.height} · ${asset.meta}`;
    const actions = document.createElement("div");
    actions.className = "asset-actions";
    actions.innerHTML = [
      `<button type="button" class="small-button primary" data-action="svg" data-id="${asset.id}"><i data-lucide="file-code-2"></i><span>SVG</span></button>`,
      `<button type="button" class="small-button" data-action="png" data-id="${asset.id}"><i data-lucide="file-image"></i><span>PNG</span></button>`,
    ].join("");
    info.append(title, meta, actions);
    card.append(preview, info);
    fragment.append(card);
  }
  ui.assetList.append(fragment);
  updateSplitButton();
  window.lucide?.createIcons();
}

function renderAssets() {
  if (state.mode === "vfx") {
    renderVfxAssets();
    return;
  }
  ui.assetList.textContent = "";
  ui.selectedText.textContent = state.selectedId
    ? `已选择 ${getAssetName(state.groups.find((asset) => asset.id === state.selectedId))}`
    : "未选择素材";

  const fragment = document.createDocumentFragment();
  for (const asset of state.groups) {
    const card = document.createElement("article");
    card.className = `asset-card${asset.id === state.selectedId ? " is-selected" : ""}`;
    card.dataset.assetId = String(asset.id);

    const preview = document.createElement("div");
    preview.className = "asset-preview";
    const image = document.createElement("img");
    const previewCanvas = makeAssetCanvas(asset, {
      padding: state.settings.padding,
      scale: 1,
      sharpness: Math.min(state.settings.sharpness, 38),
      feather: state.settings.feather,
    });
    image.alt = getAssetName(asset);
    image.src = previewCanvas.toDataURL("image/png");
    preview.append(image);

    const info = document.createElement("div");
    info.className = "asset-info";
    const title = document.createElement("div");
    title.className = "asset-title";
    title.innerHTML = `<strong>${getAssetName(asset)}</strong><span>${asset.partCount} 块</span>`;
    const dims = assetDimensions(asset);
    const meta = document.createElement("div");
    meta.className = "asset-meta";
    meta.textContent = `${dims.width}×${dims.height} · ${asset.area} px`;
    const actions = document.createElement("div");
    actions.className = "asset-actions";
    actions.innerHTML = [
      `<button type="button" class="small-button primary" data-action="svg" data-id="${asset.id}"><i data-lucide="file-code-2"></i><span>SVG</span></button>`,
      `<button type="button" class="small-button" data-action="png" data-id="${asset.id}"><i data-lucide="file-image"></i><span>PNG</span></button>`,
    ].join("");
    info.append(title, meta, actions);
    card.append(preview, info);
    fragment.append(card);
  }
  ui.assetList.append(fragment);
  updateSplitButton();
  window.lucide?.createIcons();
}

function selectAsset(id) {
  state.selectedId = id;
  renderPreview();
  renderAssets();
}

function pointToImage(event) {
  const rect = ui.previewCanvas.getBoundingClientRect();
  const cx = event.clientX - rect.left;
  const cy = event.clientY - rect.top;
  const { x, y, scale } = state.draw;
  return {
    x: (cx - x) / scale,
    y: (cy - y) / scale,
  };
}

function pickAssetAt(imageX, imageY) {
  if (state.mode === "vfx") return;
  const found = [...state.groups]
    .reverse()
    .find(
      (asset) =>
        imageX >= asset.minX &&
        imageX <= asset.maxX &&
        imageY >= asset.minY &&
        imageY <= asset.maxY,
    );
  if (found) selectAsset(found.id);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function downloadText(text, filename, type = "image/svg+xml;charset=utf-8") {
  downloadBlob(new Blob([text], { type }), filename);
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

async function canvasToPngBytes(canvas) {
  const blob = await canvasToPngBlob(canvas);
  if (!blob) return new Uint8Array();
  return new Uint8Array(await blob.arrayBuffer());
}

async function downloadPng(asset) {
  if (asset?.kind) {
    const canvas = await vectorSvgToCanvas(asset);
    const blob = await canvasToPngBlob(canvas);
    if (blob) downloadBlob(blob, `${getAssetName(asset)}.png`);
    return;
  }
  const canvas = makeAssetCanvas(asset);
  const blob = await canvasToPngBlob(canvas);
  if (blob) downloadBlob(blob, `${getAssetName(asset)}.png`);
}

function vectorSvgToCanvas(asset) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(new Blob([asset.svg], { type: "image/svg+xml" }));
    image.onload = () => {
      const scale = Math.max(1, state.settings.scale);
      const canvas = document.createElement("canvas");
      canvas.width = asset.width * scale;
      canvas.height = asset.height * scale;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("SVG 转 PNG 失败"));
    };
    image.src = url;
  });
}

function getAssetById(id) {
  return state.groups.find((asset) => asset.id === id);
}

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

const crcTable = buildCrcTable();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function writeHeader(view, values) {
  let offset = 0;
  for (const [bytes, value] of values) {
    if (bytes === 2) {
      view.setUint16(offset, value, true);
    } else {
      view.setUint32(offset, value, true);
    }
    offset += bytes;
  }
}

function makeZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, day } = dosDateTime();

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = typeof file.content === "string" ? encoder.encode(file.content) : file.content;
    const crc = crc32(dataBytes);
    const localHeader = new ArrayBuffer(30);
    writeHeader(new DataView(localHeader), [
      [4, 0x04034b50],
      [2, 20],
      [2, 0x0800],
      [2, 0],
      [2, time],
      [2, day],
      [4, crc],
      [4, dataBytes.length],
      [4, dataBytes.length],
      [2, nameBytes.length],
      [2, 0],
    ]);
    localParts.push(localHeader, nameBytes, dataBytes);

    const centralHeader = new ArrayBuffer(46);
    writeHeader(new DataView(centralHeader), [
      [4, 0x02014b50],
      [2, 20],
      [2, 20],
      [2, 0x0800],
      [2, 0],
      [2, time],
      [2, day],
      [4, crc],
      [4, dataBytes.length],
      [4, dataBytes.length],
      [2, nameBytes.length],
      [2, 0],
      [2, 0],
      [2, 0],
      [2, 0],
      [4, 0],
      [4, offset],
    ]);
    centralParts.push(centralHeader, nameBytes);
    offset += 30 + nameBytes.length + dataBytes.length;
  }

  const centralSize = centralParts.reduce((size, part) => size + part.byteLength, 0);
  const end = new ArrayBuffer(22);
  writeHeader(new DataView(end), [
    [4, 0x06054b50],
    [2, 0],
    [2, 0],
    [2, files.length],
    [2, files.length],
    [4, centralSize],
    [4, offset],
    [2, 0],
  ]);
  return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
}

async function downloadZip() {
  if (!state.groups.length) return;
  ui.zipBtn.disabled = true;
  setStatus(state.mode === "vfx" ? "正在打包 SVG..." : "正在打包 PNG...");
  try {
    if (state.mode === "vfx") {
      const files = state.groups.map((asset) => ({
        name: `${getAssetName(asset)}.svg`,
        content: asset.svg,
      }));
      const zip = makeZip(files);
      const base = state.imageName.replace(/\.[^.]+$/, "") || "effect";
      downloadBlob(zip, `${base}-vfx-svg.zip`);
      setStatus(`已打包 ${files.length} 个纯矢量 SVG`);
      return;
    }
    const files = await Promise.all(
      state.groups.map(async (asset) => ({
        name: `${getAssetName(asset)}.png`,
        content: await canvasToPngBytes(makeAssetCanvas(asset)),
      })),
    );
    const zip = makeZip(files);
    const base = state.imageName.replace(/\.[^.]+$/, "") || "assets";
    downloadBlob(zip, `${base}-png-assets.zip`);
    setStatus(`已打包 ${files.length} 个 PNG`);
  } catch {
    setStatus(state.mode === "vfx" ? "SVG 打包失败" : "PNG 打包失败");
  } finally {
    ui.zipBtn.disabled = state.groups.length === 0;
  }
}

let analyzeTimer = 0;
let renderTimer = 0;

function scheduleAnalyze() {
  window.clearTimeout(analyzeTimer);
  analyzeTimer = window.setTimeout(() => analyzeImage(), 180);
}

function scheduleRenderAssets() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => {
    renderPreview();
    renderAssets();
  }, 120);
}

function resetAll() {
  state.image = null;
  state.imageName = "";
  state.imageData = null;
  state.processedImageData = null;
  state.bgMask = null;
  state.labels = null;
  state.components = [];
  state.groups = [];
  state.selectedId = null;
  state.vfxAnalysis = null;
  ui.assetList.textContent = "";
  ui.imageMeta.textContent = "等待载入图片";
  ui.assetCount.textContent = "0";
  ui.processTime.textContent = "0 ms";
  updateSplitButton();
  ui.zipBtn.disabled = true;
  ui.selectedText.textContent = "未选择素材";
  setStatus(state.mode === "vfx" ? "等待特效参考图" : "准备就绪");
  renderPreview();
}

function bindEvents() {
  ui.fileInput.addEventListener("change", async () => {
    const file = ui.fileInput.files?.[0];
    if (!file) return;
    setStatus("载入图片...");
    const result = await fileToImage(file);
    await useImage(result.image, result.name);
    ui.fileInput.value = "";
  });

  ui.sampleBtn.addEventListener("click", () => {
    loadSample().catch((error) => setStatus(error.message));
  });
  ui.analyzeBtn.addEventListener("click", () => analyzeImage());
  ui.splitBtn.addEventListener("click", splitSelectedAsset);
  ui.zipBtn.addEventListener("click", downloadZip);
  ui.clearBtn.addEventListener("click", resetAll);
  for (const button of ui.modeButtons) {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  }

  ui.pickBgBtn.addEventListener("click", () => {
    if (!state.image) return;
    state.pickingBg = !state.pickingBg;
    ui.dropZone.classList.toggle("is-picking", state.pickingBg);
    setStatus(state.pickingBg ? "点击画布取背景色" : "准备就绪");
  });

  ui.removeEnclosed.addEventListener("change", () => {
    updateControlText();
    scheduleAnalyze();
  });

  for (const [key, input] of Object.entries(ui.controls)) {
    input.addEventListener("input", () => {
      updateControlText();
      if (
        [
          "tolerance",
          "edgeTrim",
          "innerStroke",
          "mergeGap",
          "minArea",
          "vfxHueRange",
          "vfxBright",
          "vfxRayCount",
        ].includes(key)
      ) {
        scheduleAnalyze();
      } else {
        scheduleRenderAssets();
      }
    });
  }

  ui.exportMode.addEventListener("change", () => {
    setStatus(ui.exportMode.value === "silhouette" ? "导出模式: 纯剪影" : "导出模式: 保留颜色");
  });

  ui.previewCanvas.addEventListener("click", async (event) => {
    if (!state.image) return;
    const point = pointToImage(event);
    if (
      point.x < 0 ||
      point.y < 0 ||
      point.x >= sourceCanvas.width ||
      point.y >= sourceCanvas.height
    ) {
      return;
    }
    if (state.pickingBg) {
      state.bgColor = samplePixelColor(point.x, point.y);
      state.pickingBg = false;
      ui.dropZone.classList.remove("is-picking");
      updateBgUi();
      await analyzeImage();
      return;
    }
    pickAssetAt(point.x, point.y);
  });

  ui.assetList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (button) {
      const asset = getAssetById(Number(button.dataset.id));
      if (!asset) return;
      if (button.dataset.action === "svg") {
        downloadText(makeSvgString(asset), `${getAssetName(asset)}.svg`);
      } else {
        downloadPng(asset);
      }
      return;
    }
    const card = event.target.closest(".asset-card");
    if (card) selectAsset(Number(card.dataset.assetId));
  });

  ui.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    ui.dropZone.classList.add("is-picking");
  });

  ui.dropZone.addEventListener("dragleave", () => {
    if (!state.pickingBg) ui.dropZone.classList.remove("is-picking");
  });

  ui.dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    if (!state.pickingBg) ui.dropZone.classList.remove("is-picking");
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    const result = await fileToImage(file);
    await useImage(result.image, result.name);
  });

  if (ui.dropZone && typeof ResizeObserver !== "undefined") {
    const resizeObserver = new ResizeObserver(() => renderPreview());
    resizeObserver.observe(ui.dropZone);
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type === "set-mode") setMode(event.data.mode);
  });
}

updateControlText();
updateBgUi();
bindEvents();
window.lucide?.createIcons();
window.AssetVectorizer = {
  stats: () => ({
    mode: state.mode,
    count: state.groups.length,
    imageName: state.imageName,
    selectedId: state.selectedId,
    parts: state.groups.map((asset) => asset.partCount),
    kinds: state.groups.map((asset) => asset.kind).filter(Boolean),
    color: state.vfxAnalysis?.color ?? null,
    rayCount: state.vfxAnalysis?.directions.length ?? 0,
  }),
  splitSelected: splitSelectedAsset,
  setMode,
  loadUrl: async (url, name = "reference.png") => {
    const result = await urlToImage(url, name);
    await useImage(result.image, result.name);
    return window.AssetVectorizer.stats();
  },
  makeSvg: (id) => {
    const asset = getAssetById(Number(id));
    return asset ? makeSvgString(asset) : "";
  },
};
setMode(state.mode, { analyze: false });
resetAll();
