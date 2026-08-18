const tabs = [...document.querySelectorAll(".tool-tab")];
const frames = [...document.querySelectorAll(".tool-frame")];
const statusText = document.querySelector("#toolStatus");
const headingText = document.querySelector("#toolHeading");
const descriptionText = document.querySelector("#toolDescription");
const reloadButton = document.querySelector("#reloadTool");
const openButton = document.querySelector("#openTool");
const toolList = document.querySelector(".tool-tabs");
const resetOrderButton = document.querySelector("#resetToolOrder");
const orderStatus = document.querySelector("#toolOrderStatus");
const toolOrderStorageKey = "merged-asset-tools:tool-order";
const defaultToolOrder = tabs.map((tab) => tab.dataset.tool);
let draggedToolItem = null;
let draggedToolStartIndex = -1;

const toolLabels = {
  cocos: "Cocos HTML 压缩",
  gif: "序列帧压缩",
  "green-screen": "绿幕视频转序列帧",
  extractor: "构建包素材提取",
  model: "FBX / GLB 模型压缩",
  vfx: "特效贴图生成",
  vector: "一键抠图",
};

const toolDescriptions = {
  cocos: "拖入 Cocos 单文件 HTML，压缩内嵌图片与 MP3 并导出 5MB 提交包。",
  gif: "本地处理 GIF、MP4 和 PNG 序列，导出 PNG 序列帧或 Cocos 资源。",
  "green-screen": "拖入任意纯色背景 MP4、MOV 或 GIF，在浏览器本地抠像并导出透明 PNG 序列 ZIP。",
  extractor: "导入单文件 HTML，一键提取并打包下载 UI 图片、图标、音效与音乐，同时保留玩法拆解能力。",
  model: "本地导入 FBX 或 GLB，默认输出可直接导入 Cocos Creator 3.8.3 的标准 GLB，并通过减面降低模型内存。",
  vfx: "上传特效参考图，生成光条、碎片、爆闪和柔光四类透明 PNG 粒子贴图。",
  vector: "载入图片后自动抠图分离素材，支持 SVG、PNG 和批量导出。",
};

function currentToolItems() {
  return [...toolList.querySelectorAll(".tool-item")];
}

function currentToolOrder() {
  return currentToolItems().map((item) => item.dataset.tool);
}

function announceOrderChange(message) {
  orderStatus.textContent = "";
  window.requestAnimationFrame(() => {
    orderStatus.textContent = message;
  });
}

function updateOrderControls() {
  const items = currentToolItems();
  items.forEach((item, index) => {
    const tool = item.dataset.tool;
    const handle = item.querySelector(".tool-order-handle");
    handle.setAttribute(
      "aria-label",
      `调整“${toolLabels[tool]}”的顺序，当前第 ${index + 1} 项；可拖动或使用上下方向键`,
    );
  });

  resetOrderButton.disabled = currentToolOrder().every(
    (tool, index) => tool === defaultToolOrder[index],
  );
}

function saveToolOrder() {
  try {
    window.localStorage.setItem(toolOrderStorageKey, JSON.stringify(currentToolOrder()));
  } catch {
    // localStorage may be unavailable in a restricted browser; reordering still works for this page view.
  }
  updateOrderControls();
}

function normalizedStoredOrder() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(toolOrderStorageKey));
    if (!Array.isArray(saved)) return defaultToolOrder;

    const knownTools = saved.filter(
      (tool, index) => defaultToolOrder.includes(tool) && saved.indexOf(tool) === index,
    );
    return [...knownTools, ...defaultToolOrder.filter((tool) => !knownTools.includes(tool))];
  } catch {
    return defaultToolOrder;
  }
}

function applyToolOrder(order) {
  const itemsByTool = new Map(currentToolItems().map((item) => [item.dataset.tool, item]));
  order.forEach((tool) => {
    const item = itemsByTool.get(tool);
    if (item) toolList.append(item);
  });
  updateOrderControls();
}

function moveToolWithKeyboard(item, key) {
  const items = currentToolItems();
  const index = items.indexOf(item);
  let nextIndex = index;

  if (key === "ArrowUp") nextIndex = Math.max(0, index - 1);
  if (key === "ArrowDown") nextIndex = Math.min(items.length - 1, index + 1);
  if (key === "Home") nextIndex = 0;
  if (key === "End") nextIndex = items.length - 1;
  if (nextIndex === index) return;

  const reference = items[nextIndex];
  if (nextIndex < index) toolList.insertBefore(item, reference);
  else toolList.insertBefore(item, reference.nextElementSibling);

  saveToolOrder();
  item.querySelector(".tool-order-handle").focus();
  announceOrderChange(`${toolLabels[item.dataset.tool]}已移至第 ${nextIndex + 1} 项`);
}

function moveDraggedTool(clientY) {
  if (!draggedToolItem) return;

  const otherItems = currentToolItems().filter((item) => item !== draggedToolItem);
  const nextItem = otherItems.find((item) => {
    const rect = item.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2;
  });
  toolList.insertBefore(draggedToolItem, nextItem || null);
}

function finishNativeDrag() {
  if (!draggedToolItem) return;

  const item = draggedToolItem;
  const startIndex = draggedToolStartIndex;
  draggedToolItem = null;
  draggedToolStartIndex = -1;
  item.classList.remove("is-dragging");

  const position = currentToolItems().indexOf(item);
  if (position === startIndex) return;
  saveToolOrder();
  announceOrderChange(`${toolLabels[item.dataset.tool]}已移至第 ${position + 1} 项`);
}

function makeToolSortable(tab) {
  const item = document.createElement("div");
  item.className = "tool-item";
  item.dataset.tool = tab.dataset.tool;

  const handle = document.createElement("button");
  handle.className = "tool-order-handle";
  handle.type = "button";
  handle.draggable = true;
  handle.title = "拖动调整顺序；也可用方向键移动";
  handle.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="8" cy="6" r="1"></circle>
      <circle cx="16" cy="6" r="1"></circle>
      <circle cx="8" cy="12" r="1"></circle>
      <circle cx="16" cy="12" r="1"></circle>
      <circle cx="8" cy="18" r="1"></circle>
      <circle cx="16" cy="18" r="1"></circle>
    </svg>`;

  tab.replaceWith(item);
  item.append(tab, handle);

  handle.addEventListener("keydown", (event) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    moveToolWithKeyboard(item, event.key);
  });

  handle.addEventListener("dragstart", (event) => {
    draggedToolItem = item;
    draggedToolStartIndex = currentToolItems().indexOf(item);
    item.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.dataset.tool);
    event.dataTransfer.setDragImage(item, item.offsetWidth - 18, item.offsetHeight / 2);
  });

  handle.addEventListener("dragend", finishNativeDrag);

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.pointerType === "mouse") return;

    const startY = event.clientY;
    let hasMoved = false;
    handle.setPointerCapture(event.pointerId);
    handle.focus();

    const handlePointerMove = (moveEvent) => {
      if (!hasMoved && Math.abs(moveEvent.clientY - startY) < 5) return;
      hasMoved = true;
      item.classList.add("is-dragging");

      const listRect = toolList.getBoundingClientRect();
      if (moveEvent.clientY < listRect.top + 32) toolList.scrollTop -= 12;
      if (moveEvent.clientY > listRect.bottom - 32) toolList.scrollTop += 12;

      draggedToolItem = item;
      moveDraggedTool(moveEvent.clientY);
    };

    const finishPointerMove = () => {
      handle.removeEventListener("pointermove", handlePointerMove);
      handle.removeEventListener("pointerup", finishPointerMove);
      handle.removeEventListener("pointercancel", finishPointerMove);
      item.classList.remove("is-dragging");
      draggedToolItem = null;

      if (!hasMoved) return;
      saveToolOrder();
      const position = currentToolItems().indexOf(item) + 1;
      announceOrderChange(`${toolLabels[item.dataset.tool]}已移至第 ${position} 项`);
    };

    handle.addEventListener("pointermove", handlePointerMove);
    handle.addEventListener("pointerup", finishPointerMove);
    handle.addEventListener("pointercancel", finishPointerMove);
  });
}

tabs.forEach(makeToolSortable);
applyToolOrder(normalizedStoredOrder());

resetOrderButton.addEventListener("click", () => {
  try {
    window.localStorage.removeItem(toolOrderStorageKey);
  } catch {
    // The visible order can still be reset when storage is unavailable.
  }
  applyToolOrder(defaultToolOrder);
  announceOrderChange("已恢复默认工具顺序");
});

function activeToolFromHash() {
  const value = window.location.hash.replace(/^#/, "");
  return Object.hasOwn(toolLabels, value) ? value : "vector";
}

function setActiveTool(tool) {
  for (const tab of tabs) {
    const isActive = tab.dataset.tool === tool;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  }

  for (const frame of frames) {
    const isActive = frame.dataset.tool === tool;
    frame.classList.toggle("is-active", isActive);
    if (isActive && !frame.getAttribute("src")) {
      frame.setAttribute("src", frame.dataset.src);
    }
  }

  statusText.textContent = toolLabels[tool];
  headingText.textContent = toolLabels[tool];
  descriptionText.textContent = toolDescriptions[tool];
  document.body.dataset.activeTool = tool;
  if (window.location.hash !== `#${tool}`) {
    history.replaceState(null, "", `#${tool}`);
  }
}

function getActiveFrame() {
  return frames.find((frame) => frame.classList.contains("is-active"));
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => setActiveTool(tab.dataset.tool));
});

reloadButton.addEventListener("click", () => {
  const frame = getActiveFrame();
  if (!frame) return;
  if (!frame.getAttribute("src")) frame.setAttribute("src", frame.dataset.src);
  else if (frame.contentWindow) frame.contentWindow.location.reload();
});

openButton.addEventListener("click", () => {
  const frame = getActiveFrame();
  if (!frame) return;
  window.open(frame.getAttribute("src") || frame.dataset.src, "_blank", "noopener");
});

toolList.addEventListener("dragover", (event) => {
  if (!draggedToolItem) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";

  const listRect = toolList.getBoundingClientRect();
  if (event.clientY < listRect.top + 32) toolList.scrollTop -= 12;
  if (event.clientY > listRect.bottom - 32) toolList.scrollTop += 12;
  moveDraggedTool(event.clientY);
});

toolList.addEventListener("drop", (event) => {
  event.preventDefault();
  finishNativeDrag();
});

window.addEventListener("hashchange", () => setActiveTool(activeToolFromHash()));
window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin || event.data?.type !== "open-tool") return;
  if (!Object.hasOwn(toolLabels, event.data.tool)) return;
  setActiveTool(event.data.tool);
  const frame = getActiveFrame();
  frame?.contentWindow?.postMessage(
    { type: "set-mode", mode: event.data.mode },
    window.location.origin,
  );
});
setActiveTool(activeToolFromHash());
