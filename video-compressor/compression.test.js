import test from 'node:test';
import assert from 'node:assert/strict';
import { compressionArgs, outputName, reduction } from './compression.js';

test('高清保留 AAC，保留帧时序并补齐奇数尺寸', () => {
  const args = compressionArgs('input.mp4', 'output.mp4', '20', 'keep', 'aac');
  assert.equal(args[args.indexOf('-crf') + 1], '20');
  assert.equal(args[args.indexOf('-c:a') + 1], 'copy');
  assert.equal(args[args.indexOf('-fps_mode') + 1], 'passthrough');
  assert.ok(args.includes('pad=ceil(iw/2)*2:ceil(ih/2)*2'));
  assert.ok(!args.includes('-r'));
});
test('移除音频或将非 AAC 转为兼容 MP4 的 AAC', () => {
  const silent = compressionArgs('in', 'out', 28, 'remove', 'aac');
  assert.ok(silent.includes('-an'));
  assert.ok(!silent.includes('-c:a'));
  const opus = compressionArgs('in', 'out', 23, 'keep', 'opus');
  assert.equal(opus[opus.indexOf('-c:a') + 1], 'aac');
  assert.ok(opus.includes('0:a:0?'));
  assert.throws(() => compressionArgs('in', 'out', 0, 'keep'));
});
test('同名视频导出名称不冲突，体积增加不显示负压缩率', () => {
  assert.notEqual(outputName('a.mp4', 1), outputName('a.mov', 2));
  assert.equal(outputName('a/b.mp4', 1), '01-a_b-压缩.mp4');
  assert.equal(reduction(100, 120), '未缩小');
  assert.equal(reduction(100, 10), '减少 90.0%');
});
