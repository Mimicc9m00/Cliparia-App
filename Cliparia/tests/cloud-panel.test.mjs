import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPanelCommands,panelSnapshot} from '../cloud-panel.mjs';
import worker,{ClipariaPanel} from '../painel/worker.mjs';

const clip=(order)=>({title:'Corte',length:60,revision:2,drive:{id:'drive-file',accessToken:'private'},
 posting:{order,targets:['youtube']},posts:{youtube:{state:'Falhou',detail:'private',id:'private'}}});

test('o painel não exporta credenciais do Drive nem detalhes de integração',()=>{
 const jobs=[{id:'job',clips:[clip(1)]}];
 const nextAt=Date.now()+900_000;
 const snapshot=panelSnapshot(jobs,{nextAt,automatic:{enabled:true,configs:{youtube:{channel:'private'}}}});
 assert.equal(snapshot.nextAt,nextAt);
 assert.equal(panelSnapshot([],{}).nextAt,0);
 assert.deepEqual(snapshot.platforms,['youtube']);
 assert.equal(snapshot.clips[0].drive,'drive-file');
 assert.deepEqual(snapshot.clips[0].posts,{youtube:'Falhou'});
 assert.doesNotMatch(JSON.stringify(snapshot),/private|accessToken/);
});

test('comandos repetidos não trocam a ordem duas vezes e seleção usa a revisão normal',async()=>{
 const jobs=[{id:'job',clips:[clip(1),clip(2)]}];
 let selection;
 const dependencies={jobs,memory:{automaticSettings:()=>({configs:{youtube:{}}})},save(){},
  changeSelection(command){selection=command;throw Error('bloqueado');}};
 const command={id:'first',action:'down',job:'job',index:0,revision:2};
 const select={id:'second',action:'select',job:'job',index:1,revision:2,targets:['youtube']};
 const results=await applyPanelCommands([command,command,select],[],dependencies);
 await applyPanelCommands([command],results,dependencies);
 assert.deepEqual(jobs[0].clips.map(item=>item.posting.order),[2,1]);
 assert.deepEqual(selection.targets,['youtube']);
 assert.equal(selection.revision,2);
 assert.deepEqual(results.map(result=>result.ok),[true,false]);
});

test('a legenda longa não esconde hashtags e o painel mostra a legenda editada',()=>{
 const text='Falando sobre GTA 6. '.repeat(40);
 const generated={...clip(1),description:text+'\n\n#gta6 #rockstar',hashtags:['#gta6','#rockstar']};
 const manual={...clip(2),postDraft:{title:'Meu título',text:'Minha legenda',tags:['#lancamento']}};
 const {clips}=panelSnapshot([{id:'job',clips:[generated,manual]}],{});
 assert.equal(clips[0].description.length,420);
 assert.deepEqual(clips[0].hashtags,['#gta6','#rockstar']);
 assert.equal(clips[1].description,'Minha legenda');
 assert.deepEqual(clips[1].hashtags,['#lancamento']);
});

test('cadastro de live reaproveita a fila do Contínuo e não duplica o comando',async()=>{
 const added=[];
 const command={id:'live',action:'add-live',url:'https://kick.com/canal',duration:65,follow:true,captions:false};
 const results=await applyPanelCommands([command,command],[],{jobs:[],addSource:source=>added.push(source)});
 assert.deepEqual(added,[command]);
 assert.deepEqual(results,[{id:'live',action:'add-live',ok:true,review:false}]);
});

test('o painel só coloca links HTTPS de plataformas suportadas na fila',async()=>{
 const inserted=[];
 const panel=new ClipariaPanel({storage:{sql:{exec(sql,...args){
  if(sql.startsWith('INSERT'))inserted.push(JSON.parse(args[1]));
  return {toArray:()=>[],one:()=>({count:0})};
 }}}});
 const command={id:'d0c4340f-18f3-4202-b29c-c29cd80f05a9',action:'add-live',duration:60,follow:false,captions:true};
 const send=url=>panel.fetch(new Request('https://panel.example/api/commands',{method:'POST',body:JSON.stringify({...command,url})}));
 assert.equal((await send('http://127.0.0.1/')).status,400);
 assert.equal((await send('https://kick.com@example.com/canal')).status,400);
 assert.equal((await send('https://kick.com/canal')).status,202);
 assert.deepEqual(inserted,[{...command,url:'https://kick.com/canal'}]);
});

test('status das lives mostra o progresso sem exportar consultas ou erros sensíveis',()=>{
 const jobs=[{id:'job',continuousId:'one',clips:[clip(1)]}];
 const snapshot=panelSnapshot(jobs,{},[],{enabled:true,autoQueue:{enabled:true},sources:[
  {id:'one',url:'https://www.youtube.com/watch?v=video&token=private',status:'Analisando VOD por trechos'},
  {id:'two',url:'https://kick.com/canal?token=private',status:'Erro na requisição token=private',follow:true},
 ]});
 assert.equal(snapshot.generation.enabled,true);
 assert.deepEqual(snapshot.generation.sources,[
  {label:'youtube.com/watch?v=video',status:'Analisando VOD por trechos',clips:1,follow:false},
  {label:'kick.com/canal',status:'Não foi possível consultar a fonte',clips:0,follow:true},
 ]);
 assert.doesNotMatch(JSON.stringify(snapshot),/private/);
});

test('o painel exige senha e origem do mesmo site, e separa a credencial da integração',async()=>{
 let accessed=0;
 const env={PANEL_PASSWORD:'browser',PANEL_BRIDGE_TOKEN:'integration',PANEL:{
  idFromName:()=>0,get:()=>({fetch:()=>{accessed++;return Response.json({ok:true});}}),
 }};
 const request=(path,options)=>worker.fetch(new Request('https://panel.example'+path,options),env);
 const authorization='Basic '+btoa('cliparia:browser');
 assert.equal((await request('/api/state')).status,401);
 assert.equal((await request('/bridge/commands',{headers:{Authorization:authorization}})).status,401);
 const headers={Authorization:authorization,'Content-Type':'application/json',Origin:'https://other.example'};
 assert.equal((await request('/api/commands',{method:'POST',headers})).status,403);
 assert.equal(accessed,0);
 assert.equal((await request('/api/commands',{method:'POST',headers:{...headers,Origin:'https://panel.example'}})).status,200);
 assert.equal((await request('/bridge/commands',{headers:{Authorization:'Bearer integration'}})).status,200);
 assert.equal(accessed,2);
});

test('o cron do painel dispara o GitHub apenas quando não existe outro lote recente',async t=>{
 const scheduledTime=Date.now();
 const env={GITHUB_REPOSITORY:'owner/cliparia',GITHUB_DISPATCH_TOKEN:'teste'};
 let runs=[{status:'in_progress',created_at:new Date(scheduledTime-30*60_000).toISOString()}];
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  calls.push({url,method:options.method,body:options.body,redirect:options.redirect});
  return options.method==='POST'?new Response(null,{status:204}):Response.json({workflow_runs:runs});
 });
 await worker.scheduled({scheduledTime},{});
 assert.equal(calls.length,0);
 await worker.scheduled({scheduledTime},env);
 assert.equal(calls.length,1);
 runs=[{status:'completed',created_at:new Date(scheduledTime-15*60_000).toISOString()}];
 await worker.scheduled({scheduledTime},env);
 assert.equal(calls.length,3);
 assert.ok(calls.every(call=>call.redirect==='manual'));
 assert.match(calls[2].url,/\/cliparia-nuvem\.yml\/dispatches$/);
 assert.deepEqual(JSON.parse(calls[2].body),{ref:'main',inputs:{painel_somente:false}});
});

test('o painel mostra o lote ativo apenas depois do login e só expõe seu estado',async t=>{
 let consulted=0;
 t.mock.method(globalThis,'fetch',async()=>{
  consulted++;
  return Response.json({workflow_runs:[{id:42,status:'in_progress',conclusion:null,created_at:'2026-11-22T12:43:01Z',other:'private'}]});
 });
 const env={PANEL_PASSWORD:'browser',GITHUB_REPOSITORY:'owner/cliparia',GITHUB_DISPATCH_TOKEN:'private'};
 const url='https://panel.example/api/batch';
 assert.equal((await worker.fetch(new Request(url),env)).status,401);
 const result=await worker.fetch(new Request(url,{headers:{Authorization:'Basic '+btoa('cliparia:browser')}}),env);
 assert.equal(consulted,1);
 assert.deepEqual(await result.json(),{status:'in_progress',conclusion:null,startedAt:'2026-11-22T12:43:01Z',url:'https://github.com/owner/cliparia/actions/runs/42'});
});
