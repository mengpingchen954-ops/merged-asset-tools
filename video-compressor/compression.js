export const presets = {
  22: { label: '精细压缩', preset: 'veryslow', help: '推荐：更精细地编码，在接近高清画质的同时减小体积；处理时间更长。' },
  20: { label: '高清', help: '优先保留画质，适合动画、文字与细节较多的视频。' },
  23: { label: '均衡', help: '兼顾体积和画质，适合日常参考视频。' },
  28: { label: '小体积', help: '进一步减小体积，文字、纹理和运动细节可能变模糊。' },
};

export function compressionArgs(input, output, quality, audio, sourceAudio) {
  if (!Object.hasOwn(presets, quality) || !['keep', 'compact', 'remove'].includes(audio)) throw new Error('压缩参数无效');
  const copyAudio = sourceAudio?.codec_name === 'aac' && (audio === 'keep' || !(Number(sourceAudio.bit_rate) > 128000));
  return ['-i', input, '-map', '0:v:0', ...(audio === 'remove' ? ['-an'] : ['-map', '0:a:0?']),
    '-c:v', 'libx264', '-preset', presets[quality].preset || 'slow', '-crf', String(quality),
    '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough',
    ...(audio !== 'remove' ? (copyAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '128k',
      ...(audio === 'compact' && sourceAudio ? ['-ac', String(Math.min(2, sourceAudio.channels)), '-ar', String(Math.min(48000, Number(sourceAudio.sample_rate)))] : [])]) : []),
    '-movflags', '+faststart', output];
}

export function outputName(name, number) {
  const stem = name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || 'video';
  return `${String(number).padStart(2, '0')}-${stem}-压缩.mp4`;
}

export function formatSize(bytes) {
  return bytes < 1e6 ? `${(bytes / 1000).toFixed(1)} KB` : `${(bytes / 1e6).toFixed(2)} MB`;
}

export function reduction(before, after) {
  return after >= before ? '未缩小' : `减少 ${(100 * (1 - after / before)).toFixed(1)}%`;
}
