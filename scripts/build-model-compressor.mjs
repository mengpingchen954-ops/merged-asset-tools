import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const vendorDir = "glb-model-optimizer/vendor";
await mkdir(vendorDir, { recursive: true });

await build({
  entryPoints: ["glb-model-optimizer/geometry-compressor.source.js"],
  bundle: true,
  format: "iife",
  globalName: "GeometryCompressor",
  minify: true,
  outfile: `${vendorDir}/geometry-compressor.js`,
  plugins: [{
    name: "ignore-node-only-io",
    setup(builder) {
      builder.onResolve({ filter: /^node:(fs|path)$/ }, (args) => ({ path: args.path, namespace: "empty-node" }));
      builder.onLoad({ filter: /.*/, namespace: "empty-node" }, () => ({ contents: "export {};", loader: "js" }));
    },
  }],
});

await build({
  entryPoints: ["glb-model-optimizer/fbx-converter.source.js"],
  bundle: true,
  format: "iife",
  globalName: "FbxConverter",
  minify: true,
  outfile: `${vendorDir}/fbx-converter.js`,
});
const fbxBundlePath = `${vendorDir}/fbx-converter.js`;
const fbxBundle = await readFile(fbxBundlePath, "utf8");
await writeFile(
  fbxBundlePath,
  fbxBundle
    .replace(/[ \t]+(?=\r?\n)/g, "")
    .replace(/^ +(?=\t)/gm, ""),
);

await copyFile(
  "node_modules/draco3dgltf/draco_encoder_gltf_nodejs.js",
  `${vendorDir}/draco_encoder.js`,
);
await copyFile(
  "node_modules/draco3dgltf/draco_encoder.wasm",
  `${vendorDir}/draco_encoder.wasm`,
);
await copyFile(
  "node_modules/draco3dgltf/draco_decoder_gltf_nodejs.js",
  `${vendorDir}/draco_decoder.js`,
);
await copyFile(
  "node_modules/draco3dgltf/draco_decoder_gltf.wasm",
  `${vendorDir}/draco_decoder_gltf.wasm`,
);
await copyFile(
  "node_modules/@gltf-transform/core/LICENSE.md",
  `${vendorDir}/GLTF-TRANSFORM.LICENSE.md`,
);
await copyFile(
  "node_modules/meshoptimizer/LICENSE.md",
  `${vendorDir}/MESHOPTIMIZER.LICENSE.md`,
);
await copyFile(
  "node_modules/three/LICENSE",
  `${vendorDir}/THREE.LICENSE.txt`,
);
await writeFile(
  `${vendorDir}/DRACO.LICENSE.txt`,
  "Draco 3D Data Compression\nCopyright 2016 The Draco Authors\n\nLicensed under the Apache License, Version 2.0 (the \"License\");\nyou may not use this file except in compliance with the License.\nYou may obtain a copy of the License at\n\n    http://www.apache.org/licenses/LICENSE-2.0\n\nUnless required by applicable law or agreed to in writing, software\ndistributed under the License is distributed on an \"AS IS\" BASIS,\nWITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.\nSee the License for the specific language governing permissions and\nlimitations under the License.\n",
);
