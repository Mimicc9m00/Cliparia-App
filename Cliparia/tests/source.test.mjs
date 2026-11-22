import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceURL,isLive} from '../media.mjs';
import {liveInput} from '../live.mjs';

test('aceita canais e replays públicos da Kick nos dois hosts oficiais',()=>{
 for(const url of [
  'https://kick.com/meu-canal',
  'https://www.kick.com/meu_canal/',
  'https://kick.com/meu-canal/videos/01a0251f-ef48-702d-9289-d66922da0e84',
  'https://www.kick.com/meu-canal?utm_source=share'
 ])assert.equal(sourceURL(url),url);
});

test('conserva fontes do YouTube e da Twitch',()=>{
 for(const url of [
  'https://youtube.com/watch?v=live',
  'https://www.youtube.com/@canal/live',
  'https://m.youtube.com/watch?v=live',
  'https://youtu.be/live',
  'https://twitch.tv/canal',
  'https://www.twitch.tv/videos/10'
 ])assert.equal(sourceURL(url),url);
});

test('links da Kick respeitam as restrições de origem da captura',()=>{
 for(const url of [
  'http://kick.com/canal',
  'https://kick.com.example/canal',
  'https://fakekick.com/canal',
  'https://player.kick.com/canal',
  'https://kick.com@localhost/canal',
  'https://usuario:senha@kick.com/canal',
  'https://kick.com:8443/canal',
  'file:///kick.com/canal',
  'kick.com/canal'
 ])assert.throws(()=>sourceURL(url),/link HTTPS.*Kick/);
});

test('live Kick com HLS combinado segue para a captura com imagem e áudio',()=>{
 const meta={
  id:'123735729',extractor_key:'Kick',is_live:true,
  http_headers:{'User-Agent':'yt-dlp',Referer:'https://kick.com/'},
  formats:[{
   url:'https://stream.example.test/live.m3u8',protocol:'m3u8_native',
   vcodec:'avc1.64002a',acodec:'mp4a.40.2',height:1080,fps:60
  }]
 };
 assert.equal(isLive(meta),true);
 const input=liveInput(meta);
 assert.equal(input.separate,false);
 assert.equal(input.videoMap,'0:v:0');
 assert.equal(input.audioMap,'0:a:0');
 assert.ok(input.args.includes(meta.formats[0].url));
 assert.match(input.args[input.args.indexOf('-headers')+1],/referer: https:\/\/kick.com\//);
});
