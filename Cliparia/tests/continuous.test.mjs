import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createContinuous,channelLink} from '../continuous.mjs';
import {safetyVersion} from '../safety.mjs';

const settled=()=>new Promise(resolve=>setImmediate(resolve));
test('adição automática exige modo contínuo, arquivo disponível e aprovação da revisão atual',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'cliparia-continuous-posting-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'queue.json'),services={connected:()=>true};
 const continuous=createContinuous(file,services),job={continuousId:'source-id'};
 const clip={length:60,drive:{id:'clip-id'},revision:2,safety:{version:safetyVersion,revision:2,status:'approved'}};
 assert.deepEqual(continuous.postingTargets(job,clip),[]);
 assert.throws(()=>continuous.setAutoQueue(true,[]),/Selecione ao menos um destino/);
 assert.throws(()=>continuous.setAutoQueue(true,['invalid']),/destinos selecionados/);
 continuous.setAutoQueue(true,['youtube','facebook','youtube']);
 assert.deepEqual(continuous.postingTargets(job,clip),['youtube','facebook']);
 assert.deepEqual(continuous.postingTargets({},clip),[]);
 assert.deepEqual(continuous.postingTargets(job,{...clip,drive:undefined}),[]);
 assert.deepEqual(continuous.postingTargets(job,{...clip,posting:{order:3,targets:['kwai']}}),[]);
 assert.throws(()=>continuous.postingTargets(job,{...clip,revision:3}),/Verifique o conteúdo/);
 assert.throws(()=>continuous.postingTargets(job,{...clip,safety:{...clip.safety,status:'blocked',reason:'Conteúdo bloqueado'}}),/Conteúdo bloqueado/);
 assert.throws(()=>continuous.postingTargets(job,{...clip,safety:{...clip.safety,status:'error'}}),/Verificação de conteúdo pendente/);
 assert.deepEqual(continuous.postingTargets(job,{...clip,length:100}),['youtube']);
 continuous.setAutoQueue(true,['facebook']);
 assert.throws(()=>continuous.postingTargets(job,{...clip,length:100}),/90 segundos/);
 const reopened=createContinuous(file,services);
 assert.deepEqual(reopened.status().autoQueue,{enabled:true,targets:['facebook']});
 reopened.setAutoQueue(false,['facebook']);
 assert.deepEqual(reopened.postingTargets(job,clip),[]);
 assert.deepEqual(createContinuous(file,services).status().autoQueue,{enabled:false,targets:['facebook']});
});

test('fila optativa, persistente e com duas fontes simultâneas',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'cliparia-queue-test-'));
 const file=path.join(temp,'fila.json'),pending=[];
 const services={
  connected:()=>true,stop:()=>{},
  sourceInfo:async url=>({id:new URL(url).pathname,extractor_key:'Youtube',title:url}),
  launch:async source=>new Promise(resolve=>pending.push({source,resolve}))
 };
 try{
  const queue=createContinuous(file,services);
  for(const id of ['aaa','bbb','ccc'])queue.add('https://youtu.be/'+id,{},false);
  await settled();assert.equal(pending.length,0);
  queue.setEnabled(true);
  await settled();assert.equal(pending.length,2);
  pending[0].resolve();
  await settled();
  queue.tick();
  await settled();assert.equal(pending.length,3);
  queue.setEnabled(false);
  pending[1].resolve();pending[2].resolve();
  await settled();
  const reopened=createContinuous(file,services).status();
  assert.equal(reopened.enabled,false);
  assert.equal(reopened.sources.filter(s=>s.done).length,3);
 }finally{await rm(file,{force:true});await rm(temp,{recursive:true,force:true});}
});
test('fonte cadastrada durante um lote só inicia pelo turno único do Contínuo',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'cliparia-batch-add-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const checked=[];
 const queue=createContinuous(path.join(root,'queue.json'),{
  batchOnly:true,connected:()=>true,stop(){},
  async sourceInfo(url){checked.push(url);return {id:'live',extractor_key:'Kick',is_live:true};},
  async launch(){},
 });
 queue.setEnabled(true);
 queue.add('https://kick.com/primeiro',{},false);
 queue.add('https://kick.com/segundo',{},false);
 await settled();
 assert.deepEqual(checked,[]);
 await queue.tick({batch:true});
 assert.deepEqual(checked,['https://kick.com/primeiro']);
});

test('lote processa uma fonte por vez e volta à que ficou incompleta no próximo ciclo',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'cliparia-cloud-source-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'continuo.json'),calls=[];
 const sources=['one','two'].map(id=>({id,url:'https://youtu.be/'+id,config:{},follow:false,done:false}));
 await writeFile(file,JSON.stringify({enabled:true,limit:4,exhaustiveVersion:1,sources}));
 const services={connected:()=>true,sourceInfo:async url=>({id:new URL(url).pathname,extractor_key:'Youtube'}),launch:async source=>{
  calls.push(source.id);
  if(calls.length===1)return {stopped:true};
 }};
 let queue=createContinuous(file,services);
 await queue.tick({batch:true});
 assert.deepEqual(calls,['one']);
 assert.equal(queue.status().sources[0].done,false);
 queue=createContinuous(file,services);
 await queue.tick({batch:true});
 await queue.tick({batch:true});
 assert.deepEqual(calls,['one','two','one']);
 assert.ok(queue.status().sources.every(source=>source.done));
});

test('lote passa por fonte offline, começa uma segunda fonte e conserva o motivo após reiniciar',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'cliparia-cloud-offline-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'continuo.json'),checked=[],launched=[];
 const services={batchOnly:true,connected:()=>true,async sourceInfo(url){
  checked.push(url);
  if(url.endsWith('/offline'))throw Error('Channel is offline');
  return {id:url,is_live:true};
 },async launch(source){launched.push(source.url);return {stopped:true};}};
 const queue=createContinuous(file,services);
 queue.setEnabled(true);
 for(const channel of ['offline','nova','outra'])queue.add('https://kick.com/'+channel,{},false);
 await queue.tick({batch:true});
 assert.deepEqual(checked,['https://kick.com/offline','https://kick.com/nova']);
 assert.deepEqual(launched,['https://kick.com/nova']);
 const [offline,nova,outra]=createContinuous(file,services).status().sources;
 assert.equal(offline.status,'Canal offline · aguardando a live');
 assert.equal(nova.status,'Aguardando o próximo lote');
 assert.equal(outra.status,'Na fila');
});

test('acompanhar novas lives exige um endereço de canal',()=>{
 assert.ok(channelLink('https://www.twitch.tv/canal'));
 assert.ok(channelLink('https://youtube.com/@canal/live'));
 assert.ok(channelLink('https://m.youtube.com/channel/UCcanal/live'));
 assert.ok(channelLink('https://kick.com/canal'));
 assert.ok(channelLink('https://www.kick.com/canal-com_hifen/'));
 assert.ok(!channelLink('https://youtube.com/watch?v=registro'));
 assert.ok(!channelLink('https://www.twitch.tv/videos/10'));
 for(const url of [
  'https://kick.com/',
  'https://kick.com/canal/videos',
  'https://kick.com/canal/videos/01a0251f-ef48-702d-9289-d66922da0e84',
  'https://kick.com/canal/clips/clip_123',
  'https://kick.com/canal?clip=clip_123',
  ...['video','videos','clips','categories','search','auth','browse','following','settings','dashboard','login','register'].map(route=>'https://kick.com/'+route),
  'https://example.com/@canal/live',
  'https://faketwitch.tv/canal',
  'https://kick.com.example.com/canal',
  'https://kick.com@evil.example/canal',
  'http://kick.com/canal',
  'https://kick.com:444/canal',
  'invalid'
 ])assert.equal(channelLink(url),false,url);
});

test('canal Kick aguarda ficar online e acompanha transmissões novas sem repetir a anterior',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'cliparia-kick-follow-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const state=path.join(root,'queue.json'),launches=[];
 let now=Date.now(),broadcast=null;
 t.mock.method(Date,'now',()=>now);
 const services={
  sourceInfo:async()=>{
   if(!broadcast)throw Error('ERROR: [kick:live] canal: The channel is not currently live');
   return {id:broadcast,extractor_key:'Kick',is_live:true};
  },
  launch:async(source,meta,key)=>{launches.push(key);},
  stop:()=>{},connected:()=>true
 };
 const queue=createContinuous(state,services);
 queue.add('https://kick.com/canal',{},true);
 queue.setEnabled(true);
 await settled();
 assert.equal(queue.status().sources[0].status,'Canal offline · aguardando nova live');
 assert.equal(queue.status().sources[0].done,false);
 assert.equal(launches.length,0);

 broadcast='live-1';now+=60_000;
 queue.tick();await settled();
 assert.deepEqual(launches,['Kick:live-1']);
 assert.equal(queue.status().sources[0].status,'Aguardando a próxima live do canal');

 now+=60_000;
 const reopened=createContinuous(state,services);
 reopened.tick();await settled();
 assert.deepEqual(launches,['Kick:live-1']);
 assert.equal(reopened.status().sources[0].done,false);

 broadcast='live-2';now+=60_000;
 reopened.tick();await settled();
 assert.deepEqual(launches,['Kick:live-1','Kick:live-2']);
});

test('parar uma fonte da fila mantém o registro encerrado e não a inicia de novo',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'cliparia-stop-source-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const state=path.join(root,'queue.json');
 let finish,attempts=0;
 const queue=createContinuous(state,{
  sourceInfo:async()=>({id:'v1',extractor_key:'Youtube',is_live:false}),
  launch:()=>{attempts++;return new Promise(resolve=>{finish=resolve;});},
  stop:()=>{},connected:()=>true
 });
 queue.add('https://www.youtube.com/watch?v=1',{},false);
 queue.setEnabled(true);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(attempts,1);
 const id=queue.status().sources[0].id;
 queue.markStopped(id,'Youtube:v1');
 finish({stopped:true,manual:true});
 await new Promise(resolve=>setImmediate(resolve));
 queue.tick();
 assert.equal(attempts,1);
 assert.equal(queue.status().sources[0].status,'Clipagem parada');
 assert.equal(queue.status().sources[0].done,true);
});

test('migra fontes encerradas pela meta antiga uma vez e preserva paradas manuais',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'cliparia-exhaustive-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'queue.json');
 await writeFile(file,JSON.stringify({enabled:false,sources:[
  {id:'old-cap',url:'https://youtu.be/video',config:{count:5},done:true,lastKey:'Youtube:video',status:'Concluída'},
  {id:'manual',url:'https://youtu.be/manual',config:{count:5},done:true,lastKey:'Youtube:manual',status:'Clipagem parada'}
 ]}));
 const launched=[];
 const services={connected:()=>true,stop:()=>{},sourceInfo:async()=>({extractor_key:'Youtube',id:'video'}),launch:async source=>{launched.push(source.id);assert.equal(source.config.liveBlocks,true);}};
 const queue=createContinuous(file,services);
 assert.equal(queue.status().sources[0].done,false);
 assert.equal(queue.status().sources[1].done,true);
 queue.setEnabled(true);await settled();
 assert.deepEqual(launched,['old-cap']);
 assert.equal(queue.status().sources[0].done,true);
 const reopened=createContinuous(file,services);
 reopened.tick();await settled();
 assert.deepEqual(launched,['old-cap']);
});
