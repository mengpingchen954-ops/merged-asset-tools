export const formats = {
  mp3: { codec:'libmp3lame', sourceCodec:'mp3', mime:'audio/mpeg', label:'MP3', help:'MP3 适合多数播放器与游戏引擎。' },
  m4a: { codec:'aac', sourceCodec:'aac', mime:'audio/mp4', label:'M4A / AAC', help:'M4A 使用 AAC 编码，适合手机与多数现代播放器。' },
  ogg: { codec:'libopus', sourceCodec:'opus', mime:'audio/ogg', label:'OGG / Opus', help:'OGG 使用 Opus 编码，适合现代浏览器；导入游戏引擎前确认支持 Opus。' },
};
export const bitrates = [32,64,96,128,192,256,320];
const mp3Rates = [8000,11025,12000,16000,22050,24000,32000,44100,48000];
const opusRates = [8000,12000,16000,24000,48000];

export function outputRate(format, sourceRate, bitrate = 128) {
  if (!formats[format] || !Number.isFinite(sourceRate) || sourceRate <= 0) throw new Error('音频采样率无效');
  if (sourceRate > 48000) return 48000;
  const allowed = format === 'ogg' ? opusRates : mp3Rates;
  const minRate = format === 'mp3' ? (bitrate > 160 ? 32000 : bitrate > 64 ? 16000 : 8000) : 8000;
  return allowed.find(rate => rate >= sourceRate && rate >= minRate) || 48000;
}

export function compressionArgs(input, output, format, bitrate, channels, source, encoding = 'fixed') {
  if (!formats[format] || !bitrates.includes(Number(bitrate)) || !['keep','mono'].includes(channels) || !['fixed','vbr'].includes(encoding) || (encoding === 'vbr' && format !== 'mp3')) throw new Error('音频压缩参数无效');
  if (!source?.channels || !source.sample_rate) throw new Error('无法读取音频声道或采样率');
  const count = channels === 'mono' ? 1 : Math.min(2, source.channels);
  return ['-i',input,'-map','0:a:0','-vn','-map_metadata','-1','-c:a',formats[format].codec,
    ...(encoding === 'vbr' ? ['-q:a','5'] : ['-b:a',`${bitrate}k`]),
    // ponytail: core 0.12.10 can crash on stereo Opus 20 ms frames; use 10 ms until the bundled core is upgraded.
    ...(format === 'ogg' ? ['-vbr','on','-compression_level','10','-application','audio','-frame_duration','10'] : []),
    '-ac',String(count),'-ar',String(outputRate(format,Number(source.sample_rate),Number(bitrate))),
    ...(format === 'm4a' ? ['-movflags','+faststart'] : []),output];
}

export function canKeepOriginal(format, channels, source, filename, bitrate = 128) {
  return channels === 'keep' && source.codec_name === formats[format]?.sourceCodec && source.channels <= 2 &&
    outputRate(format,Number(source.sample_rate),Number(bitrate)) === Number(source.sample_rate) &&
    (format === 'mp3' ? /\.mp3$/i : format === 'm4a' ? /\.m4a$/i : /\.ogg$/i).test(filename);
}

export function outputName(name, number, format) {
  if (!formats[format]) throw new Error('输出格式无效');
  const stem = name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || 'audio';
  return `${String(number).padStart(2,'0')}-${stem}-压缩.${format}`;
}
