import test from 'node:test';
import assert from 'node:assert/strict';
import { compressionArgs, outputName, reduction } from './compression.js';

test('高清保留 AAC，保留帧时序并补齐奇数尺寸', () => {
  const args = compressionArgs('input.mp4', 'output.mp4', '20', 'keep', {codec_name:'aac'});
  assert.equal(args[args.indexOf('-crf') + 1], '20');
  assert.equal(args[args.indexOf('-c:a') + 1], 'copy');
  assert.equal(args[args.indexOf('-fps_mode') + 1], 'passthrough');
  assert.ok(args.includes('pad=ceil(iw/2)*2:ceil(ih/2)*2'));
  assert.ok(!args.includes('-r'));
});
test('移除音频或将非 AAC 转为兼容 MP4 的 AAC', () => {
  const silent = compressionArgs('in', 'out', 28, 'remove', {codec_name:'aac'});
  assert.ok(silent.includes('-an'));
  assert.ok(!silent.includes('-c:a'));
  const opus = compressionArgs('in', 'out', 23, 'keep', {codec_name:'opus'});
  assert.equal(opus[opus.indexOf('-c:a') + 1], 'aac');
  assert.ok(opus.includes('0:a:0?'));
  assert.throws(() => compressionArgs('in', 'out', 0, 'keep'));
});
test('精细压缩保留尺寸、帧率和原 AAC 音频，音频压缩只重编码高码率 AAC', () => {
  const source = {codec_name:'aac',bit_rate:'192000',channels:2,sample_rate:'48000'};
  const fine = compressionArgs('in','out',22,'keep',source);
  assert.equal(fine[fine.indexOf('-preset')+1],'veryslow');
  assert.equal(fine[fine.indexOf('-crf')+1],'22');
  assert.equal(fine[fine.indexOf('-c:a')+1],'copy');
  assert.ok(!fine.includes('-r') && !fine.some(arg => arg.startsWith('scale=')));
  const compact = compressionArgs('in','out',22,'compact',source);
  assert.equal(compact[compact.indexOf('-b:a')+1],'128k');
  assert.equal(compact[compact.indexOf('-ac')+1],'2');
  const small = compressionArgs('in','out',22,'compact',{...source,bit_rate:'64000'});
  assert.equal(small[small.indexOf('-c:a')+1],'copy');
  const unknown = compressionArgs('in','out',22,'compact',{...source,bit_rate:undefined});
  assert.equal(unknown[unknown.indexOf('-c:a')+1],'copy');
});
test('同名视频导出名称不冲突，体积增加不显示负压缩率', () => {
  assert.notEqual(outputName('a.mp4', 1), outputName('a.mov', 2));
  assert.equal(outputName('a/b.mp4', 1), '01-a_b-压缩.mp4');
  assert.equal(reduction(100, 120), '未缩小');
  assert.equal(reduction(100, 10), '减少 90.0%');
});
