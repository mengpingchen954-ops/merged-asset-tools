const DEFAULT_OPTIONS = {
  quality: 75,
  target_size: 0,
  target_PSNR: 0,
  method: 4,
  sns_strength: 50,
  filter_strength: 60,
  filter_sharpness: 0,
  filter_type: 1,
  partitions: 0,
  segments: 4,
  pass: 1,
  show_compressed: 0,
  preprocessing: 0,
  autofilter: 0,
  partition_limit: 0,
  alpha_compression: 1,
  alpha_filtering: 1,
  alpha_quality: 100,
  lossless: 0,
  exact: 0,
  image_hint: 0,
  emulate_jpeg_size: 0,
  thread_level: 1,
  low_memory: 0,
  near_lossless: 100,
  use_delta_palette: 0,
  use_sharp_yuv: 0,
};

let encoderPromise;

async function loadEncoderVariant(modulePath, wasmPath) {
  const [{ default: createEncoderModule }, response] = await Promise.all([
    import(modulePath),
    fetch(new URL(wasmPath, import.meta.url)),
  ]);
  if (!response.ok) throw new Error(`WebP WASM request failed with ${response.status}.`);
  const wasmBinary = await response.arrayBuffer();
  return createEncoderModule({ noInitialRun: true, wasmBinary });
}

async function createEncoder() {
  try {
    return await loadEncoderVariant("./webp_enc_simd.js", "./webp_enc_simd.wasm");
  } catch (simdError) {
    try {
      return await loadEncoderVariant("./webp_enc.js", "./webp_enc.wasm");
    } catch (baseError) {
      throw new AggregateError([simdError, baseError], "WebP WASM encoder could not be loaded.");
    }
  }
}

export async function encodeWebp(imageData, options = {}) {
  if (!encoderPromise) encoderPromise = createEncoder();
  const encoder = await encoderPromise;
  const result = encoder.encode(
    imageData.data,
    imageData.width,
    imageData.height,
    { ...DEFAULT_OPTIONS, ...options },
  );
  if (!result) throw new Error("WebP WASM encoding failed.");
  return new Uint8Array(result);
}
