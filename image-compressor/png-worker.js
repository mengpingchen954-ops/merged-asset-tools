self.window = self;
importScripts('../cocos-html-compressor/vendor/pako_inflate.min.js');
const inflate = self.pako.inflate;
importScripts('../gif-to-cocos-tool/vendor/pako_deflate.min.js', '../gif-to-cocos-tool/vendor/UPNG.js');
self.pako.inflate = inflate;
const deflate = self.pako.deflate;
self.pako.deflate = data => deflate(data, {level:9});
const metrics = import('./compression.js?v=2');
self.onmessage = async ({ data: { rgba, png, width, height, colors, maxError, adaptive } }) => {
  try {
    if (png) {
      const source = self.UPNG.decode(png);
      if (colors === 0 && source.depth === 16) {
        self.postMessage({ encoded: png, usedLossless: true }, [png]);
        return;
      }
      rgba = self.UPNG.toRGBA8(source)[0];
    }
    let encoded;
    let usedLossless = colors === 0;
    let usedColors = colors;
    if (colors > 0) {
      const { pixelError } = await metrics;
      for (const count of adaptive ? [64,128,256] : [colors]) {
        const candidate = self.UPNG.encode([rgba], width, height, count);
        const decoded = self.UPNG.toRGBA8(self.UPNG.decode(candidate))[0];
        if (pixelError(new Uint8Array(rgba), new Uint8Array(decoded)) <= maxError && (!encoded || candidate.byteLength < encoded.byteLength)) {
          encoded = candidate;
          usedColors = count;
        }
      }
      if (!encoded) {
        encoded = self.UPNG.encode([rgba], width, height, 0);
        usedLossless = true;
      }
    } else encoded = self.UPNG.encode([rgba], width, height, 0);
    self.postMessage({ encoded, usedLossless, usedColors }, [encoded]);
  } catch (error) {
    self.postMessage({ error: error.message || 'PNG 编码失败' });
  }
};
