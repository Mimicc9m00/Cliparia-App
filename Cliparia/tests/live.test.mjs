import test from 'node:test';
import assert from 'node:assert/strict';
import {liveInput} from '../live.mjs';

const url = 'https://example.test/live.m3u8';
const video = {url: url+'?v=1', protocol:'m3u8_native',vcodec:'avc1',acodec:'none',height:1080,fps:60};
const audio = {url: url+'?a=1', protocol:'m3u8_native',vcodec:'none',acodec:'mp4a',abr:128};
const combined = {url: url+'?b=1', protocol:'m3u8_native',vcodec:'avc1',acodec:'mp4a',height:720,fps:30};

test('HLS combinado usa uma entrada e os dois canais',()=>{
 const input=liveInput({formats:[combined]});
 assert.equal(input.separate,false);
 assert.equal(input.args.filter(x=>x==='-i').length,1);
 assert.equal(input.audioMap,'0:a:0');
});
test('HLS com faixas separadas usa duas entradas e preserva a qualidade selecionada',()=>{
 const input=liveInput({requested_formats:[video,audio],formats:[combined,video,audio]});
 assert.equal(input.separate,true);
 assert.equal(input.args.filter(x=>x==='-i').length,2);
 assert.equal(input.audioMap,'1:a:0');
 assert.ok(input.args.includes(video.url));
 assert.ok(input.args.includes(audio.url));
});
test('sem requested_formats, mantém 1080p em vez de escolher HLS 720p',()=>{
 const input=liveInput({formats:[video,audio,combined]});
 assert.ok(input.args.includes(video.url));
 assert.equal(input.separate,true);
});
test('aceita formatos HTTPS diretos sem passar opções exclusivas HLS',()=>{
 const v={...video,url:'https://example.test/video.mp4',protocol:'https'};
 const a={...audio,url:'https://example.test/audio.m4a',protocol:'https'};
 const input=liveInput({requested_formats:[v,a]});
 assert.equal(input.args.filter(x=>x==='-live_start_index').length,0);
 assert.equal(input.separate,true);
});
test('falha de forma específica se faltar audio',()=>{
 assert.throws(()=>liveInput({formats:[video]}),/faixa de áudio/);
});
