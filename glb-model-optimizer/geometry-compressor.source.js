import { WebIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { draco, meshopt } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

const io = new WebIO().registerExtensions(ALL_EXTENSIONS);
let dependenciesReady;

async function prepareDependencies() {
  if (!dependenciesReady) {
    dependenciesReady = Promise.all([
      MeshoptEncoder.ready,
      MeshoptDecoder.ready,
      globalThis.DracoEncoderModule?.(),
      globalThis.DracoDecoderModule?.(),
    ]).then(([, , dracoEncoder, dracoDecoder]) => {
      if (!dracoEncoder?.ExpertEncoder || !dracoDecoder?.Decoder) {
        throw new Error("Draco 编解码器加载失败，请刷新页面后重试。");
      }
      io.registerDependencies({
        "draco3d.encoder": dracoEncoder,
        "draco3d.decoder": dracoDecoder,
        "meshopt.encoder": MeshoptEncoder,
        "meshopt.decoder": MeshoptDecoder,
      });
    });
  }
  return dependenciesReady;
}

export async function compress(input, method) {
  if (!["meshopt", "draco"].includes(method)) {
    throw new Error(`不支持的网格压缩方式：${method}`);
  }

  await prepareDependencies();
  const document = await io.readBinary(input instanceof Uint8Array ? input : new Uint8Array(input));
  if (method === "meshopt") {
    await document.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  } else {
    await document.transform(draco({ method: "edgebreaker" }));
  }
  return io.writeBinary(document);
}
