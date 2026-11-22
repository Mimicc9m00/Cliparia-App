import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {createGenerationHistory,visualRange} from '../generation-history.mjs';
import {selectMoments} from '../highlights.mjs';
import {scanSignals} from '../signals.mjs';
import {generate} from '../media.mjs';
import {run} from '../speech.mjs';

async function historyFile(t){
 const folder=await mkdtemp(path.join(tmpdir(),'cliparia-cortes-'));
 t.after(()=>rm(folder,{recursive:true,force:true}));
 return path.join(folder,'cortes-gerados.json');
}
const studio={sourcePlatform:'Youtube',mediaId:'VideoAbC',scanMode:'vod'};
const continuous={mediaKey:'YOUTUBE:VideoAbC',scanMode:'vod'};

test('reaproveita o histórico antigo e pula o mesmo trecho entre Estúdio e Contínuo mesmo após limpar o histórico',async t=>{
 const file=await historyFile(t);
 const oldJob={...studio,url:'https://youtu.be/VideoAbC',clips:[{start:110,length:40,originalStart:100,originalLength:60,drive:{removed:true}}]};
 const history=createGenerationHistory(file,[oldJob]);
 assert.equal(history.enabled(),true);
 const readded={...continuous,url:'https://www.youtube.com/watch?v=VideoAbC'};
 assert.equal(history.duplicate(readded,{start:98,length:60}),true);
 assert.equal(history.duplicate(readded,{start:160,length:60}),false);
 assert.equal(history.duplicate({...continuous,mediaKey:'Youtube:videoabc'},{start:100,length:60}),false);

 const fresh=createGenerationHistory(file,[]);
 const moments=[{start:101,evidence:'replay'},{start:240,evidence:'ação visual'}];
 const picks=selectMoments(moments,60,1,[],moment=>!fresh.duplicate(readded,{start:moment.start,length:60}));
 assert.deepEqual(picks,[moments[1]]);
 assert.equal(fresh.duplicate(readded,{start:240,length:60}),false);
 fresh.remember(readded,{start:240,length:60});
 assert.equal(createGenerationHistory(file,[]).duplicate(studio,{start:248,length:60}),true);
});

test('compara o conteúdo de lives com relógios de captura diferentes e conserva trechos distintos',async t=>{
 const file=await historyFile(t);
 const live={...studio,scanMode:'live'};
 const sameStream={...continuous,scanMode:'live'};
 const samples=Array.from({length:150},(_,i)=>createHash('sha256').update(String(i)).digest('hex').slice(0,16)).join('');
 const history=createGenerationHistory(file,[{...live,clips:[{start:100,length:60,contentHash:'hash-antigo'}]}]);
 assert.equal(history.duplicate(sameStream,{start:600,length:60,contentHash:'hash-antigo'}),true);
 assert.equal(history.duplicate(sameStream,{start:100,length:60}),false);
 history.remember(live,{start:400,length:60,contentHash:'hash-original'},visualRange(samples,10,60));
 const reopened=createGenerationHistory(file,[]);
 assert.equal(reopened.duplicate(sameStream,{start:2,length:60},visualRange(samples,20,60)),true);
 assert.equal(reopened.duplicate(continuous,{start:200,length:60},visualRange(samples,20,60)),true);
 assert.equal(reopened.duplicate(sameStream,{start:400,length:60},visualRange(samples,90,60)),false);
 assert.equal(reopened.duplicate({...sameStream,mediaKey:'Youtube:outra-live'},{start:2,length:60},visualRange(samples,20,60)),false);

 const staticFrame='1234567812345678'.repeat(60);
 history.remember(live,{start:10,length:60},staticFrame);
 assert.equal(history.duplicate(sameStream,{start:10,length:60},staticFrame),false);
});

test('desativar é opcional e a escolha permanece após reiniciar',async t=>{
 const file=await historyFile(t);
 const history=createGenerationHistory(file,[]);
 assert.throws(()=>history.setEnabled('false'),/proteção/);
 history.setEnabled(false);
 history.remember(studio,{start:60,length:60});
 const reopened=createGenerationHistory(file,[]);
 assert.equal(reopened.enabled(),false);
 assert.equal(reopened.duplicate(continuous,{start:60,length:60}),false);
 reopened.setEnabled(true);
 assert.equal(createGenerationHistory(file,[]).duplicate(continuous,{start:60,length:60}),true);
});

test('aproveita links diretos antigos sem tratar o mesmo canal como a mesma transmissão',async t=>{
 const file=await historyFile(t);
 const clips=[{start:60,length:60}];
 const history=createGenerationHistory(file,[{url:'https://youtu.be/aBCdef12345?t=32',scanMode:'vod',clips},
  {url:'https://kick.com/some-channel',scanMode:'vod',clips}]);
 assert.equal(history.duplicate({sourcePlatform:'Youtube',mediaId:'aBCdef12345',scanMode:'vod'},clips[0]),true);
 assert.equal(history.duplicate({url:'https://kick.com/some-channel',scanMode:'vod'},clips[0]),false);
});

test('a triagem FFmpeg devolve assinaturas de imagem com as mesmas métricas',async()=>{
 const input=['-f','lavfi','-i','testsrc2=size=192x108:rate=24[out0];sine=frequency=400:sample_rate=8000[out1]'];
 const source={video:input,audio:input,duration:6};
 const baseline=await scanSignals(source);
 const withVisual=await scanSignals(source,undefined,true);
 assert.equal(withVisual.visual.length,6*16);
 assert.ok(new Set(withVisual.visual.match(/.{16}/g)).size>1);
 assert.deepEqual(withVisual.motion,baseline.motion);
 assert.deepEqual(withVisual.volume,baseline.volume);
});

test('geração real pula um trecho de VOD salvo na outra fila antes de transcrever ou enviar ao Drive',async t=>{
 const file=await historyFile(t);
 const history=createGenerationHistory(file,[{...studio,clips:[{start:0,length:40}]}]);
 const bytes=await run('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=128x72:rate=4','-t','45','-c:v','mpeg4','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1']);
 const server=createServer((req,res)=>{
  res.setHeader('Content-Type','video/mp4');
  res.setHeader('Content-Length',bytes.length);
  res.end(bytes);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const meta={id:'VideoAbC',extractor_key:'Youtube',title:'Replay de teste',duration:45,
  url:'http://127.0.0.1:'+server.address().port+'/test.mp4',vcodec:'mpeg4',acodec:'none',height:72,width:128,
  heatmap:[{start_time:12,end_time:22,value:1}]};
 const job={...continuous,continuousId:'source',duration:40,count:5,clips:[],url:'https://www.youtube.com/watch?v=VideoAbC'};
 const stages=[];
 await generate(job,path.dirname(file),stage=>stages.push(stage),()=>assert.fail('O corte repetido não deve chegar ao Drive.'),{knownMeta:meta,generationHistory:history});
 assert.equal(job.completeScanFinished,true);
 assert.equal(job.duplicatesSkipped,true);
 assert.equal(job.clips.length,0);
 assert.ok(stages.every(stage=>!stage.startsWith('Transcrevendo')&&!stage.startsWith('Renderizando')));
});
