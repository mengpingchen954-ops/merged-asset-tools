const tabs = [...document.querySelectorAll(".tool-tab")];
const frames = [...document.querySelectorAll(".tool-frame")];
const statusText = document.querySelector("#toolStatus");
const headingText = document.querySelector("#toolHeading");
const descriptionText = document.querySelector("#toolDescription");
const reloadButton = document.querySelector("#reloadTool");
const openButton = document.querySelector("#openTool");

const toolLabels = {
  cocos: "Cocos HTML 压缩",
  gif: "序列帧压缩",
  "green-screen": "绿幕视频转序列帧",
  vector: "一键抠图",
};

const toolDescriptions = {
  cocos: "拖入 Cocos 单文件 HTML，压缩内嵌图片与 MP3 并导出 5MB 提交包。",
  gif: "本地处理 GIF、MP4 和 PNG 序列，导出 PNG 序列帧或 Cocos 资源。",
  "green-screen": "拖入任意纯色背景 MP4，在浏览器本地抠像并导出透明 PNG 序列 ZIP。",
  vector: "载入图片后自动抠图分离素材，支持 SVG、PNG 和批量导出。",
};

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
    frame.classList.toggle("is-active", frame.dataset.tool === tool);
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
  if (frame?.contentWindow) frame.contentWindow.location.reload();
});

openButton.addEventListener("click", () => {
  const frame = getActiveFrame();
  if (!frame) return;
  window.open(frame.getAttribute("src"), "_blank", "noopener");
});

window.addEventListener("hashchange", () => setActiveTool(activeToolFromHash()));
setActiveTool(activeToolFromHash());
