import test from 'node:test';
import assert from 'node:assert/strict';
import { compressionArgs, outputRate, outputName, canKeepOriginal } from './compression.js';
const source = {channels:2,sample_rate:'44100',codec_name:'mp3'};
test('保留完整音频，去掉封面与元数据，按指定码率编码',()=>{
  const args=compressionArgs('in.wav','out.mp3','mp3',128,'keep',source);
  assert.equal(args[args.indexOf('-map')+1],'0:a:0');
  assert.ok(args.includes('-vn'));
  assert.equal(args[args.indexOf('-b:a')+1],'128k');
  assert.equal(args[args.indexOf('-ac')+1],'2');
  assert.ok(!args.includes('-t') && !args.includes('-ss'));
});
test('单声道与 Opus 合法采样率，高采样率降到 48 kHz',()=>{
  const args=compressionArgs('in','out','ogg',64,'mono',source);
  assert.equal(args[args.indexOf('-ac')+1],'1');
  assert.equal(args[args.indexOf('-ar')+1],'48000');
  assert.equal(outputRate('mp3',96000),48000);
  assert.equal(outputRate('mp3',8000,320),32000);
  assert.equal(outputRate('mp3',8000,128),16000);
  assert.throws(()=>compressionArgs('in','out','mp3',1,'keep',source));
  assert.throws(()=>compressionArgs('in','out','wav',128,'keep',source));
});
test('保留原文件只在容器、编码、声道和采样率一致时生效',()=>{
  assert.equal(canKeepOriginal('mp3','keep',source,'a.mp3'),true);
  assert.equal(canKeepOriginal('mp3','mono',source,'a.mp3'),false);
  assert.equal(canKeepOriginal('m4a','keep',{...source,codec_name:'aac'},'a.aac'),false);
  assert.equal(canKeepOriginal('ogg','keep',{...source,codec_name:'opus'},'a.ogg'),false);
  assert.equal(canKeepOriginal('mp3','keep',{...source,channels:6},'a.mp3'),false);
});
test('同名文件不会覆盖，扩展名对应编码格式',()=>{
  assert.equal(outputName('a.wav',1,'mp3'),'01-a-压缩.mp3');
  assert.notEqual(outputName('a.wav',1,'m4a'),outputName('a.mp3',2,'m4a'));
});
test('MP3 变码率与 Opus 精细编码保留完整时长和双声道',()=>{
  const mp3=compressionArgs('in','out','mp3',128,'keep',source,'vbr');
  assert.equal(mp3[mp3.indexOf('-q:a')+1],'5');
  assert.ok(!mp3.includes('-b:a'));
  assert.equal(mp3[mp3.indexOf('-ac')+1],'2');
  assert.ok(!mp3.includes('-t') && !mp3.includes('-ss'));
  const opus=compressionArgs('in','out','ogg',96,'keep',source);
  assert.equal(opus[opus.indexOf('-vbr')+1],'on');
  assert.equal(opus[opus.indexOf('-compression_level')+1],'10');
  assert.equal(opus[opus.indexOf('-application')+1],'audio');
  assert.equal(opus[opus.indexOf('-frame_duration')+1],'10');
  assert.throws(()=>compressionArgs('in','out','m4a',128,'keep',source,'vbr'));
});
