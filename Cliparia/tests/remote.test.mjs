import test from 'node:test';
import assert from 'node:assert/strict';
import {Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {httpStatus,mediaFormats,remoteAccess,transferInterrupted} from '../remote.mjs';
import {mediaChunks} from '../drive.mjs';
import {inputFor,liveInput} from '../live.mjs';

const denied=()=>Object.assign(Error('Server returned 403 Forbidden'),{httpStatus:403});

test('corte interrompido rejeita a transferência e permite abrir outro corte',async()=>{
 const mismatch=Object.assign(Error('Response body length does not match content-length header'),{code:'UND_ERR_RES_CONTENT_LENGTH_MISMATCH'});
 let upstream;
 const incomplete=new Response(new ReadableStream({start(controller){upstream=controller;controller.enqueue(Buffer.from('mp'));}}),{headers:{'Content-Length':'4'}});
 const destination=new Writable({write(chunk,encoding,done){upstream.error(new TypeError('terminated',{cause:mismatch}));done();}});
 await assert.rejects(pipeline(mediaChunks(incomplete),destination),error=>transferInterrupted(error)&&/Google Drive/.test(error.message)&&error.cause.cause===mismatch);

 const received=[];
 const next=new Response('mp4!',{status:206,headers:{'Content-Length':'4','Content-Range':'bytes 0-3/8'}});
 await pipeline(mediaChunks(next),new Writable({write(chunk,encoding,done){received.push(chunk);done();}}));
 assert.equal(Buffer.concat(received).toString(),'mp4!');
});

test('rejeita um corpo curto mesmo quando a origem encerra a leitura normalmente',async()=>{
 const response=new Response('mp',{headers:{'Content-Length':'4'}});
 await assert.rejects(async()=>{for await(const chunk of mediaChunks(response))assert.equal(chunk.byteLength,2);},transferInterrupted);
});

test('renova a URL, testa outro formato e reutiliza o formato que funciona',async()=>{
 const formats=[];
 const read=remoteAccess({id:'broadcast',number:0},async format=>{
  formats.push(format);
  return {id:'broadcast',number:formats.length};
 });
 assert.equal(await read(async m=>{if(m.number<2)throw denied();return m.number;}),2);
 assert.equal(await read(m=>m.number),2);
 assert.deepEqual(formats,[mediaFormats.standard,mediaFormats.compatible]);
});
test('para ao alcançar o limite ou se a transmissão mudou',async()=>{
 let reloads=0;
 const read=remoteAccess({id:'vod'},async()=>{reloads++;return {id:'vod'};});
 await assert.rejects(read(()=>{throw denied();}),/já tentou renovar/);
 assert.equal(reloads,2);
 const changed=remoteAccess({id:'first'},async()=>({id:'second'}));
 await assert.rejects(changed(()=>{throw denied();}),/mudou de transmissão/);
});
test('não repete quando a captura já recebeu mídia ou quando o erro é diferente',async()=>{
 let reloads=0;
 const read=remoteAccess({id:'vod'},async()=>{reloads++;return {id:'vod'};});
 await assert.rejects(read(()=>{throw Object.assign(denied(),{receivedMedia:true});}),/403/);
 await assert.rejects(read(()=>{throw Error('Filtro inválido');}),/Filtro inválido/);
 assert.equal(reloads,0);
});
test('reconhece diagnósticos HTTP e respeita os cabeçalhos da faixa',()=>{
 assert.equal(httpStatus('Error: Server returned 403 Forbidden'),403);
 assert.equal(httpStatus('HTTP Error 401'),401);
 assert.equal(httpStatus('frame number: 403'),undefined);
 const args=inputFor({url:'https://cdn.example/v',http_headers:{'User-Agent':'faixa',Referer:'https://example.com'}},{http_headers:{'user-agent':'geral',Host:'example.com',Range:'bytes=0-100'}});
 const headers=args[args.indexOf('-headers')+1];
 assert.match(headers,/user-agent: faixa/i);
 assert.match(headers,/referer: https:\/\/example\.com/i);
 assert.doesNotMatch(headers,/geral|host:|range:/i);
 const preview=liveInput({url:'https://cdn.example/live.m3u8',protocol:'m3u8_native',vcodec:'h264',acodec:'none'},{videoOnly:true});
 assert.equal(preview.args.at(-1),'https://cdn.example/live.m3u8');
});
