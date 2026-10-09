self.window = self;
importScripts('../cocos-html-compressor/vendor/pako_inflate.min.js');
const inflate = self.pako.inflate;
importScripts('../gif-to-cocos-tool/vendor/pako_deflate.min.js', '../gif-to-cocos-tool/vendor/UPNG.js');
self.pako.inflate = inflate;
const metrics = import('./compression.js');
self.onmessage = async ({ data: { rgba, png, width, height, colors, maxError } }) => {
  try {
    if (png) {
      const source = self.UPNG.decode(png);
      if (colors === 0 && source.depth === 16) {
        self.postMessage({ encoded: png, usedLossless: true }, [png]);
        return;
      }
      rgba = self.UPNG.toRGBA8(source)[0];
    }
    let encoded = self.UPNG.encode([rgba], width, height, colors);
    let usedLossless = colors === 0;
    if (colors > 0) {
      const { pixelError } = await metrics;
      const decoded = self.UPNG.toRGBA8(self.UPNG.decode(encoded))[0];
      if (pixelError(new Uint8Array(rgba), new Uint8Array(decoded)) > maxError) {
        encoded = self.UPNG.encode([rgba], width, height, 0);
        usedLossless = true;
      }
    }
    self.postMessage({ encoded, usedLossless }, [encoded]);
  } catch (error) {
    self.postMessage({ error: error.message || 'PNG 编码失败' });
  }
};
