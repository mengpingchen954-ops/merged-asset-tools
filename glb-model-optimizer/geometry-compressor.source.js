import { PropertyType, WebIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, draco, reorder, simplify, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

const io = new WebIO().registerExtensions(ALL_EXTENSIONS);
let dependenciesReady;

async function prepareDependencies() {
  if (!dependenciesReady) {
    dependenciesReady = Promise.all([
      MeshoptEncoder.ready,
      MeshoptDecoder.ready,
      MeshoptSimplifier.ready,
      globalThis.DracoEncoderModule?.(),
      globalThis.DracoDecoderModule?.(),
    ]).then(([, , , dracoEncoder, dracoDecoder]) => {
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

export async function compress(input, method, options = {}) {
  if (!["cocos", "meshopt", "draco"].includes(method)) {
    throw new Error(`不支持的网格压缩方式：${method}`);
  }

  await prepareDependencies();
  const document = await io.readBinary(input instanceof Uint8Array ? input : new Uint8Array(input));
  if (method === "cocos") {
    const ratio = Math.max(0.5, Math.min(1, Number(options.ratio) || 0.8));
    await document.transform(weld());
    if (ratio < 0.999) {
      await document.transform(simplify({
        simplifier: MeshoptSimplifier,
        ratio,
        error: 0.001,
      }));
    }
    await document.transform(
      reorder({ encoder: MeshoptEncoder, target: "size" }),
      dedup({ propertyTypes: [PropertyType.ACCESSOR] }),
    );
  } else if (method === "meshopt") {
    // Keep float accessors for Cocos/Web runtimes that support Meshopt but not KHR_mesh_quantization.
    await document.transform(reorder({ encoder: MeshoptEncoder, target: "size" }));
    document
      .createExtension(EXTMeshoptCompression)
      .setRequired(true)
      .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  } else {
    await document.transform(draco({ method: "edgebreaker" }));
  }
  return io.writeBinary(document);
}
