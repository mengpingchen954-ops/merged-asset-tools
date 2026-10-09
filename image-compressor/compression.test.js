import test from 'node:test';
import assert from 'node:assert/strict';
import { detectImage, validateImage, chooseResult, chooseSmallest, outputName, pixelError } from './compression.js';

function png(animated = false) {
  const data = new Uint8Array(animated ? 53 : 33);
  data.set([137,80,78,71,13,10,26,10]);
  const view = new DataView(data.buffer);
  view.setUint32(8,13); data.set([73,72,68,82],12);
  view.setUint32(16,300); view.setUint32(20,200);
  if (animated) { view.setUint32(33,8); data.set([97,99,84,76],37); }
  return data;
}
test('读取尺寸与实际格式，拒绝动画与像素超限', () => {
  assert.deepEqual(validateImage(detectImage(png())),{mime:'image/png',width:300,height:200,animated:false});
  assert.throws(()=>validateImage(detectImage(png(true))), /动画/);
  assert.throws(()=>validateImage({width:10000,height:10000}), /图片过大/);
  assert.throws(()=>detectImage(new Uint8Array([1,2,3])), /仅支持/);
  assert.throws(()=>detectImage(png().subarray(0,24)), /损坏/);
});
test('保持格式时不会变大，转换格式则遵守用户选择', () => {
  const original = new Blob(['123']); const bigger = new Blob(['12345']);
  assert.equal(chooseResult(original,bigger,'image/png','image/png').blob,original);
  assert.equal(chooseResult(original,bigger,'image/png','image/webp').blob,bigger);
});
test('输出扩展名匹配实际编码，同名图片不会覆盖', () => {
  assert.equal(outputName('a.png',1,'image/webp'),'01-a-压缩.webp');
  assert.notEqual(outputName('a.png',1,'image/png'),outputName('a.jpg',2,'image/png'));
  assert.throws(()=>outputName('a',1,'image/gif'));
});
test('画质检查忽略全透明 RGB，检出可见色差和透明度变化', () => {
  assert.equal(pixelError([255,0,0,0],[0,255,0,0]),0);
  assert.equal(pixelError([255,0,0,255],[255,0,0,255]),0);
  assert.ok(pixelError([255,0,0,255],[0,255,0,255])>100);
  assert.ok(pixelError([255,0,0,255],[255,0,0,0])>100);
});
test('智能模式保留原文件兜底，选择带正确格式的最小候选',()=>{
  const original=new Blob(['12345']);
  const webp={blob:new Blob(['12']),mime:'image/webp',checkedQuality:.9};
  assert.equal(chooseSmallest(original,'image/png',[webp]).mime,'image/webp');
  assert.equal(chooseSmallest(original,'image/png',[webp]).checkedQuality,.9);
  assert.equal(chooseSmallest(original,'image/png',[{blob:new Blob(['123456']),mime:'image/webp'}]).blob,original);
});
test('透明边缘同时检查白底与黑底误差',()=>{
  assert.ok(pixelError([0,0,0,255],[0,0,0,0])>200);
  assert.equal(pixelError([0,0,0,0],[255,255,255,0]),0);
});
