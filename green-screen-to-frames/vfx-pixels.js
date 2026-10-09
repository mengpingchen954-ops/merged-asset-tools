// ponytail: A black render cannot reveal its original alpha; this constructs a soft matte.
export function processVfxPixels(pixels, { mode = "transparent", blackLevel = 0, gain = 1 } = {}) {
  if (!["transparent", "additive"].includes(mode)
    || !Number.isFinite(blackLevel) || blackLevel < 0 || blackLevel >= 1
    || !Number.isFinite(gain) || gain < 0 || gain > 2
    || pixels.length % 4 !== 0) throw new Error("特效处理参数不正确。");

  for (let offset = 0; offset < pixels.length; offset += 4) {
    const sourceAlpha = pixels[offset + 3] / 255;
    const red = Math.min(1, Math.max(0, (pixels[offset] / 255 - blackLevel) / (1 - blackLevel)) * gain);
    const green = Math.min(1, Math.max(0, (pixels[offset + 1] / 255 - blackLevel) / (1 - blackLevel)) * gain);
    const blue = Math.min(1, Math.max(0, (pixels[offset + 2] / 255 - blackLevel) / (1 - blackLevel)) * gain);
    const maximum = Math.max(red, green, blue);

    if (mode === "additive") {
      pixels[offset] = Math.round(red * sourceAlpha * 255);
      pixels[offset + 1] = Math.round(green * sourceAlpha * 255);
      pixels[offset + 2] = Math.round(blue * sourceAlpha * 255);
      pixels[offset + 3] = 255;
    } else {
      pixels[offset] = maximum ? Math.round(red / maximum * 255) : 0;
      pixels[offset + 1] = maximum ? Math.round(green / maximum * 255) : 0;
      pixels[offset + 2] = maximum ? Math.round(blue / maximum * 255) : 0;
      pixels[offset + 3] = Math.round(maximum * sourceAlpha * 255);
    }
  }
  return pixels;
}
