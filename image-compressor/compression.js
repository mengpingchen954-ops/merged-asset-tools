export const presets = {
  high: { label: '高清', colors: 256, quality: .9, maxError: 2 },
  balanced: { label: '均衡', colors: 128, quality: .82, maxError: 4 },
  small: { label: '小体积', colors: 64, quality: .65, maxError: 8 },
};
export const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export function outputName(name, number, mime) {
  if (!extensions[mime]) throw new Error('不支持的图片格式');
  const stem = name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || 'image';
  return `${String(number).padStart(2, '0')}-${stem}-压缩.${extensions[mime]}`;
}

export function detectImage(bytes) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset, size) => String.fromCharCode(...bytes.subarray(offset, offset + size));
  if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((value, i) => bytes[i] === value)) {
    let animated = false;
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = data.getUint32(offset);
      if (ascii(offset + 4, 4) === 'acTL') animated = true;
      if (length > bytes.length - offset - 12) throw new Error('PNG 文件损坏');
      offset += length + 12;
    }
    return { mime: 'image/png', width: data.getUint32(16), height: data.getUint32(20), animated };
  }
  if (bytes.length >= 12 && ascii(0,4) === 'RIFF' && ascii(8,4) === 'WEBP') {
    let animated = false;
    let width, height;
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const type = ascii(offset,4);
      const length = data.getUint32(offset + 4, true);
      const start = offset + 8;
      if (length > bytes.length - start) throw new Error('WebP 文件损坏');
      if (type === 'ANIM' || type === 'ANMF') animated = true;
      if (type === 'VP8X' && length >= 10) {
        animated ||= !!(bytes[start] & 2);
        width = 1 + bytes[start+4] + bytes[start+5]*256 + bytes[start+6]*65536;
        height = 1 + bytes[start+7] + bytes[start+8]*256 + bytes[start+9]*65536;
      } else if (type === 'VP8 ' && length >= 10 && width === undefined) {
        width = data.getUint16(start+6,true) & 0x3fff;
        height = data.getUint16(start+8,true) & 0x3fff;
      } else if (type === 'VP8L' && length >= 5 && width === undefined) {
        const bits = data.getUint32(start+1,true);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
      }
      offset = start + length + (length % 2);
    }
    return { mime: 'image/webp', width, height, animated };
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    for (let offset = 2; offset + 1 < bytes.length;) {
      if (bytes[offset++] !== 255) continue;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = data.getUint16(offset);
      if (length < 2 || length > bytes.length - offset) throw new Error('JPG 文件损坏');
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length >= 7) {
        return { mime: 'image/jpeg', width: data.getUint16(offset+5), height: data.getUint16(offset+3), animated: false };
      }
      offset += length;
    }
    throw new Error('无法读取 JPG 尺寸');
  }
  throw new Error('仅支持 PNG、JPG 和 WebP 图片');
}

export function validateImage(info) {
  if (info.animated) throw new Error('动画图片暂不支持压缩，请使用序列帧工具');
  if (!info.width || !info.height) throw new Error('无法读取图片尺寸，文件可能损坏');
  if (info.width * info.height > 24e6 || info.width > 16384 || info.height > 16384) throw new Error('图片过大，请使用不超过 2400 万像素、单边 16384 像素的图片');
  return info;
}

export function chooseResult(original, candidate, sourceMime, targetMime) {
  return sourceMime === targetMime && original.size <= candidate.size ? { blob: original, keptOriginal: true } : { blob: candidate, keptOriginal: false };
}

export function pixelError(source, result) {
  if (source.length !== result.length || !source.length) throw new Error('图片像素不一致');
  let sum = 0;
  for (let i = 0; i < source.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) {
      const delta = (source[i+channel]*source[i+3] - result[i+channel]*result[i+3]) / 255;
      sum += delta*delta;
    }
    const alpha = source[i+3] - result[i+3];
    sum += alpha*alpha;
  }
  return Math.sqrt(sum/source.length);
}
