import { LoadingManager, MeshStandardMaterial } from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";

const TEXTURE_WAIT_MS = 15_000;

function waitForManagedResources(manager, parse) {
  let loadingStarted = false;
  let finishLoading;
  const warnings = [];
  const loaded = new Promise((resolve) => {
    finishLoading = resolve;
  });

  manager.onStart = () => {
    loadingStarted = true;
  };
  manager.onLoad = () => finishLoading();
  manager.onError = (url) => warnings.push(`无法读取 FBX 引用的外部贴图：${url || "未知路径"}`);

  const result = parse(warnings);
  if (!loadingStarted) return Promise.resolve({ result, warnings });

  return Promise.race([
    loaded,
    new Promise((resolve) => setTimeout(() => {
      warnings.push("等待 FBX 贴图超时，未加载的外部贴图将不会写入导出文件。");
      resolve();
    }, TEXTURE_WAIT_MS)),
  ]).then(() => ({ result, warnings }));
}

function collectStats(root) {
  const stats = {
    animations: root.animations?.length || 0,
    bones: 0,
    meshes: 0,
    skinnedMeshes: 0,
  };
  root.traverse((object) => {
    if (object.isBone) stats.bones += 1;
    if (object.isMesh) stats.meshes += 1;
    if (object.isSkinnedMesh) stats.skinnedMeshes += 1;
  });
  return stats;
}

function toStandardMaterial(source) {
  if (!source || source.isMeshStandardMaterial || source.isMeshBasicMaterial) return source;
  const material = new MeshStandardMaterial({
    alphaMap: source.alphaMap || null,
    alphaTest: source.alphaTest || 0,
    aoMap: source.aoMap || null,
    bumpMap: source.bumpMap || null,
    bumpScale: source.bumpScale ?? 1,
    color: source.color || 0xffffff,
    displacementMap: source.displacementMap || null,
    displacementScale: source.displacementScale ?? 1,
    displacementBias: source.displacementBias ?? 0,
    emissive: source.emissive || 0x000000,
    emissiveMap: source.emissiveMap || null,
    emissiveIntensity: source.emissiveIntensity ?? 1,
    envMap: source.envMap || null,
    lightMap: source.lightMap || null,
    lightMapIntensity: source.lightMapIntensity ?? 1,
    map: source.map || null,
    metalness: source.metalness ?? 0,
    metalnessMap: source.metalnessMap || null,
    normalMap: source.normalMap || null,
    opacity: source.opacity ?? 1,
    roughness: source.roughness ?? Math.min(1, Math.sqrt(2 / ((source.shininess ?? 30) + 2))),
    roughnessMap: source.roughnessMap || null,
    side: source.side,
    transparent: source.transparent || (source.opacity ?? 1) < 1,
    vertexColors: source.vertexColors || false,
  });
  material.name = source.name || "";
  material.userData = { ...source.userData };
  if (source.normalScale) material.normalScale.copy(source.normalScale);
  return material;
}

function normalizeMaterials(root) {
  root.traverse((object) => {
    if (!object.isMesh || !object.material) return;
    object.material = Array.isArray(object.material)
      ? object.material.map(toStandardMaterial)
      : toStandardMaterial(object.material);
  });
}

function parseFbx(loader, source, warnings) {
  const originalWarn = console.warn;
  console.warn = (...args) => {
    const message = args.map(String).join(" ");
    if (message.includes("Z-UP coordinate system")) return;
    if (message.includes("more than 4 skinning weights")) {
      warnings.push("部分顶点超过 4 个蒙皮权重，已按 glTF / Cocos 规范保留影响最大的 4 个权重。");
      return;
    }
    originalWarn(...args);
  };
  try {
    return loader.parse(source, "");
  } finally {
    console.warn = originalWarn;
  }
}

export async function convert(input) {
  const source = input instanceof ArrayBuffer
    ? input
    : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  const manager = new LoadingManager();
  const loader = new FBXLoader(manager);
  const { result: root, warnings } = await waitForManagedResources(manager, (parseWarnings) => parseFbx(loader, source, parseWarnings));

  root.updateMatrixWorld(true);
  normalizeMaterials(root);
  const animations = (root.animations || []).filter((clip) => clip?.tracks?.length);
  const exporter = new GLTFExporter();
  const glb = await exporter.parseAsync(root, {
    animations,
    binary: true,
    includeCustomExtensions: false,
    onlyVisible: false,
    truncateDrawRange: false,
  });

  if (!(glb instanceof ArrayBuffer)) throw new Error("FBX 转换结果不是有效的二进制 GLB。");
  return {
    bytes: new Uint8Array(glb),
    stats: collectStats(root),
    warnings,
  };
}
