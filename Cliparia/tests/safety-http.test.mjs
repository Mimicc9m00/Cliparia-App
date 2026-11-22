import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {request as httpRequest} from 'node:http';
import {run} from '../speech.mjs';

async function startApp(t,jobs,preload,{automationToken=''}={}){
 const folder=await mkdtemp(path.join(tmpdir(),'cliparia-http-'));
 const here=path.dirname(fileURLToPath(import.meta.url));
 await writeFile(path.join(folder,'lives.json'),JSON.stringify(jobs));
 const args=preload?['--import','data:text/javascript,'+encodeURIComponent(preload)]:[];
 const child=spawn(process.execPath,[...args,path.join(here,'..','app.mjs')],{cwd:path.join(here,'..'),windowsHide:true,env:{...process.env,CLIPARIA_DATA:folder,CLIPARIA_TEST:'1',CLIPARIA_BIND:'127.0.0.2',CLIPARIA_PUBLIC_URL:'',CLIPARIA_VAULT_KEY:'1'.repeat(64),CLIPARIA_AUTOMATION_TOKEN:automationToken},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null){const closed=once(child,'close');child.kill();await closed;}await rm(folder,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{
  let output='';
  const timer=setTimeout(()=>reject(Error('O app de teste não iniciou.')),15000);
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('exit',code=>{clearTimeout(timer);reject(Error('App de teste encerrou: '+code+' '+output));});
  child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.includes('Cliparia aberto')){clearTimeout(timer);resolve();}});
  child.stderr.on('data',chunk=>{output+=chunk.toString();});
 });
 const request=(route,body,headers={})=>new Promise((resolve,reject)=>{
  const req=httpRequest('http://127.0.0.2:43871'+(route.startsWith('/')?route:'/api/'+route),{method:body?'POST':'GET',headers:{Host:'127.0.0.1:43871',Origin:'http://127.0.0.1:43871',...(body?{'Content-Type':'application/json'}:{}),...headers}},res=>{
   let text='';res.setEncoding('utf8');res.on('data',chunk=>{text+=chunk;});
   res.on('end',()=>{try{resolve({status:res.statusCode,body:text?JSON.parse(text):undefined});}catch(error){reject(error);}});
  });
  req.setTimeout(10000,()=>req.destroy(Error('Tempo de requisição esgotado.')));
  req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
 });
 return {request,folder};
}

test('recuperação em lote deixa os cortes sem comprovante na fila, prontos para revisão, sem destinos',async t=>{
 const clip={file:'corte.mp4',title:'Corte recuperado',start:0,length:60,recoveredFromDrive:true,drive:{id:'drive-1',size:16},posts:{}};
 const published={...clip,file:'publicado.mp4',posts:{instagram:{state:'Publicado',id:'123'}}};
 const {request}=await startApp(t,[{id:'recuperados',clips:[clip,published]}]);
 assert.equal((await request('posting/recover-review',{})).status,400);
 assert.deepEqual((await request('posting/recover-review',{consent:true})).body,{count:1});
 assert.deepEqual((await request('posting/recover-review',{consent:true})).body,{count:0});
 const state=(await request('state')).body;
 assert.deepEqual(state.jobs[0].clips[0].posting,{order:1,targets:[],recoveryReview:true});
 assert.equal(state.jobs[0].clips[1].posting,undefined);
 assert.equal(state.posting.overview.next,undefined);
 assert.equal(state.posting.enabled,false);
});

test('acionamentos do GitHub exigem token, respeitam pausas e não retornam dados da fila',async t=>{
 const token='a'.repeat(64);
 const {request}=await startApp(t,[],undefined,{automationToken:token});
 assert.equal((await request('automation/posting',{})).status,401);
 assert.equal((await request('automation/continuous',{}, {Authorization:'Bearer '+('b'.repeat(64))})).status,401);
 assert.equal((await request('automation/continuous',undefined,{Authorization:'Bearer '+token})).status,405);
 for(const task of ['continuous','posting']){
  assert.deepEqual(await request('automation/'+task,{}, {Authorization:'Bearer '+token}),{status:202,body:{accepted:true}});
 }
 const state=(await request('state')).body;
 assert.equal(state.posting.enabled,false);
 assert.equal(state.continuous.enabled,false);
});

test('opção global de cortes repetidos e registro importado continuam após limpar o histórico',async t=>{
 const job={id:'archived-vod',mediaKey:'Youtube:abc',scanMode:'vod',clips:[{file:'old.mp4',start:35,length:60,posts:{}}]};
 const {request,folder}=await startApp(t,[job]);
 assert.equal((await request('automation/posting',{})).status,404);
 assert.equal((await request('state')).body.preventDuplicates,true);
 assert.equal((await request('generation/prevent-duplicates',{enabled:'false'})).status,400);
 assert.equal((await request('generation/prevent-duplicates',{enabled:false})).status,200);
 assert.equal((await request('state')).body.preventDuplicates,false);
 assert.equal((await request('history/clear',{scope:'all'})).body.removed,1);
 const saved=JSON.parse(await readFile(path.join(folder,'cortes-gerados.json'),'utf8'));
 assert.equal(saved.enabled,false);
 assert.deepEqual(saved.sources['youtube:abc'],[{start:35,length:60}]);
});

test('configuração do Contínuo é opcional e vale para novos cortes',async t=>{
 const clip={file:'corte.mp4',start:0,length:60,posts:{},drive:{id:'clip-drive',size:100}};
 const {request}=await startApp(t,[{id:'continuous-done',continuousId:'old-source',clips:[clip]}]);
 assert.deepEqual((await request('state')).body.continuous.autoQueue,{enabled:false,targets:[]});
 assert.equal((await request('continuous/auto-queue',{enabled:true,targets:[]})).status,400);
 assert.equal((await request('continuous/auto-queue',{enabled:true,targets:['instagram']})).status,200);
 const configured=(await request('state')).body;
 assert.deepEqual(configured.continuous.autoQueue,{enabled:true,targets:['instagram']});
 assert.equal(configured.jobs[0].clips[0].posting,undefined);
 assert.equal(configured.posting.enabled,false);
 assert.equal((await request('continuous/auto-queue',{enabled:false,targets:['instagram']})).status,200);
 assert.deepEqual((await request('state')).body.continuous.autoQueue,{enabled:false,targets:['instagram']});
});

test('pareamento pelo navegador permite controlar a fila sem acessar a configuração de contas',async t=>{
 const clips=[1,2].map(order=>({file:'clip-'+order+'.mp4',start:order*60,length:60,drive:{id:'drive-'+order,size:1024},posts:{},posting:{order,targets:['kwai']}}));
 const {request}=await startApp(t,[{id:'mobile-queue',clips}]);
 const networks=(await request('networks')).body;
 if(!networks.length){t.skip('Nenhuma interface privada disponível para o pareamento local.');return;}
 const opened=await request('pair/start',{mode:'local',address:networks[0].address});
 assert.equal(opened.status,200,JSON.stringify(opened.body));
 try{
  const url=new URL(opened.body.url),base=url.origin;
  const page=await fetch(base);
  assert.match(await page.text(),/data-mobile="local"/);
  assert.equal((await fetch(base+'/api/state')).status,403);
  const paired=await fetch(base+'/api/pair',{method:'POST',headers:{Origin:base,Authorization:'Bearer '+url.hash.slice(9)}});
  assert.equal(paired.status,200);
  const headers={Cookie:paired.headers.get('set-cookie').split(';')[0],Origin:base,'Content-Type':'application/json'};
  const send=(route,body)=>fetch(base+'/api/'+route,{method:'POST',headers,body:JSON.stringify(body)});
  const review=await (await fetch(base+'/api/state',{headers})).json();
  assert.deepEqual(review.jobs[0].clips.map(clip=>clip.posting.order),[1,2]);
  assert.equal(review.posting.intervalMinutes,15);
  assert.equal(review.accounts.drive,undefined);
  assert.equal(review.posting.overview.rows['mobile-queue/0'].kwai.kind,'manual');
  assert.equal((await send('posting/copy',{job:'mobile-queue',index:0,revision:0,version:0,title:'Vitória revisada',text:'Legenda',tags:'#gta6'})).status,200);
  assert.equal((await (await fetch(base+'/api/state',{headers})).json()).jobs[0].clips[0].postDraft.title,'Vitória revisada');
  assert.equal((await fetch(base+'/api/backup',{headers})).status,404);
  assert.equal((await send('posting/shuffle',{})).status,200);
  assert.equal((await send('posting/countdown',{minutes:20})).status,200);
  assert.equal((await send('posting/enable',{enabled:false})).status,200);
  assert.equal((await send('config',{platform:'drive',id:'x',secret:'y'})).status,404);
  const saved=(await request('state')).body;
  assert.deepEqual(saved.jobs[0].clips.map(clip=>clip.posting.order),[2,1]);
  assert.equal(saved.posting.intervalMinutes,20);
 }finally{await request('pair/stop',{});}
});

test('Instagram pausa a autorização expirada e reconecta usando o token duradouro da Página',async t=>{
 const job={id:'job-ig',targets:['instagram'],clips:[{
  file:'reel.mp4',title:'Corte',start:0,length:60,posts:{instagram:{state:'Falhou',detail:'Instagram · validar a conta (HTTP 401, código 190/463)'}}
 }]};
 const {request}=await startApp(t,[job],`
  import assert from 'node:assert/strict';
  let originalCalls=0;
  globalThis.fetch=async (input,options)=>{
   const url=new URL(input),auth=options?.headers?.Authorization;
   const secret='a'.repeat(32);
   assert.equal(url.origin,'https://graph.facebook.com');
   assert.equal(options.redirect,'error');
   if(url.pathname.endsWith('/oauth/access_token')){
    assert.equal(url.searchParams.get('grant_type'),'fb_exchange_token');
    assert.equal(url.searchParams.get('client_id'),'7');
    assert.equal(url.searchParams.get('client_secret'),secret);
    const token=url.searchParams.get('fb_exchange_token');
    assert.ok(['recente-teste','expira-teste'].includes(token));
    return Response.json({access_token:token==='recente-teste'?'usuario-longo':'usuario-expiravel'});
   }
   if(url.pathname.endsWith('/me/accounts')){
    assert.ok(['Bearer usuario-longo','Bearer usuario-expiravel'].includes(auth));
    if(auth==='Bearer usuario-longo')return Response.json({data:[]});
    return Response.json({data:[{access_token:'pagina-alheia',instagram_business_account:{id:'999'}},
     {access_token:'pagina-expiravel',instagram_business_account:{id:'123'}}]});
   }
   if(url.pathname.endsWith('/99')||url.pathname.endsWith('/98')){
    assert.equal(auth,'Bearer usuario-longo');
    assert.equal(url.searchParams.get('fields'),'id,access_token,instagram_business_account{id}');
    const id=url.pathname.split('/').at(-1);
    return Response.json({id,access_token:id==='99'?'pagina-correta':'pagina-alheia',instagram_business_account:{id:id==='99'?'123':'321'}});
   }
   if(url.pathname.endsWith('/debug_token')){
    assert.equal(auth,'Bearer 7|'+secret);
    return Response.json({data:{is_valid:true,type:'PAGE',app_id:'7',expires_at:url.searchParams.get('input_token')==='pagina-correta'?0:1000,scopes:['instagram_content_publish']}});
   }
   assert.ok(url.pathname.endsWith('/123'));
   if(auth==='Bearer original-teste'){
    if(++originalCalls===1)return Response.json({id:'123',username:'perfil'});
    assert.equal(originalCalls,2);
    return Response.json({error:{code:190,error_subcode:463,message:'Session has expired'}},{status:401});
   }
   assert.equal(auth,'Bearer pagina-correta');
   return Response.json({id:'123',username:'perfil'});
  };
 `);
 assert.equal((await request('instagram/connect',{id:'123',token:'original-teste'})).status,200);
 const before=await request('creator',{platform:'instagram'});
 assert.equal(before.body.reason,'instagram_token_invalid');
 assert.doesNotMatch(before.body.error,/190|401/);
 let state=(await request('state')).body;
 assert.equal(state.accounts.instagram.needsReconnect,true);
 assert.equal(state.jobs[0].clips[0].posts.instagram.state,'Aguardando reconexão do Instagram');
 assert.equal((await request('creator',{platform:'instagram'})).body.reason,'instagram_token_invalid');
 const invalid=await request('instagram/connect',{id:'123',token:'expira-teste',appId:'7',appSecret:'a'.repeat(32)});
 assert.match(invalid.body.error,/sem vencimento fixo/);
 assert.equal((await request('state')).body.accounts.instagram.needsReconnect,true);

 const credentials={id:'123',token:'recente-teste',appId:'7',appSecret:'a'.repeat(32)};
 assert.match((await request('instagram/connect',credentials)).body.error,/não encontrou a Página na lista/);
 assert.match((await request('instagram/connect',{...credentials,pageId:'98'})).body.error,/outro Instagram/);
 assert.equal((await request('instagram/connect',{...credentials,pageId:'99'})).status,200);
 state=(await request('state')).body;
 assert.equal(state.accounts.instagram.connected,true);
 assert.equal(state.accounts.instagram.durable,true);
 assert.equal(state.accounts.instagram.needsReconnect,false);
 assert.doesNotMatch(JSON.stringify(state),/pagina-correta|recente-teste|usuario-longo|aaaaaaaaaaaaaaaa/);
 assert.equal((await request('creator',{platform:'instagram'})).body.channel_id,'123');
});

test('Instagram distingue a recusa de acesso e verifica a autorização salva sem enviar o corte',async t=>{
 const job={id:'job-meta-access',clips:[{
  file:'reel.mp4',title:'Corte',start:0,length:60,posting:{order:1,targets:['instagram']},
  posts:{instagram:{state:'Falhou',reason:'instagram_connection_interrupted',detail:'Instagram · validar a conta: a conexão com a Meta foi interrompida.'}}
 }]};
 const {request}=await startApp(t,[job],`
  import assert from 'node:assert/strict';
  let checks=0;
  globalThis.fetch=async(input,options)=>{
   assert.equal(options.method,'GET');
   assert.equal(new URL(input).pathname,'/v26.0/123');
   if(++checks===2)return Response.json({error:{code:200,message:'Cannot call API for app 987654 on behalf of user 456789'}},{status:400});
   return Response.json({id:'123',username:'perfil'});
  };
 `);
 assert.equal((await request('state')).body.jobs[0].clips[0].posts.instagram.state,'Aguardando conexão com o Instagram');
 assert.equal((await request('instagram/connect',{id:'123',token:'original-teste'})).status,200);
 const denied=await request('instagram/check',{});
 assert.equal(denied.status,400);
 assert.equal(denied.body.reason,'instagram_account_access_denied');
 assert.doesNotMatch(denied.body.error,/987654|456789|original-teste/);
 let state=(await request('state')).body;
 assert.equal(state.accounts.instagram.reconnectReason,'instagram_account_access_denied');
 assert.equal(state.accounts.instagram.connected,false);
 assert.equal(state.jobs[0].clips[0].posts.instagram.state,'Aguardando reconexão do Instagram');
 assert.equal((await request('creator',{platform:'instagram'})).body.reason,'instagram_account_access_denied');
 assert.equal((await request('instagram/check',{})).body.channel_id,'123');
 state=(await request('state')).body;
 assert.equal(state.accounts.instagram.connected,true);
 assert.equal(state.jobs[0].clips[0].posts.instagram.id,undefined);
});

test('TikTok verifica a permissão concedida e usa a rota da caixa de entrada no modo celular',async t=>{
 const job={id:'job-tiktok',targets:['tiktok'],clips:[{
  file:'clip.mp4',title:'Corte',start:0,length:60,revision:0,posts:{},drive:{id:'drive-test',size:1024},
  safety:{version:1,revision:0,status:'approved'}
 }]};
 const {request}=await startApp(t,[job],`
  import assert from 'node:assert/strict';
  globalThis.fetch=async (input,options)=>{
   const url=new URL(input);
   assert.equal(url.origin,'https://open.tiktokapis.com');
   if(url.pathname==='/v2/oauth/token/'){
    const code=options.body.get('code');
    assert.ok(['direct','partial','unconfirmed','inbox'].includes(code));
    const scope=code==='unconfirmed'?undefined:code==='inbox'?'video.upload':'video.publish';
    return Response.json({access_token:'testing-'+code,scope,expires_in:3600});
   }
   assert.equal(url.pathname,'/v2/post/publish/inbox/video/init/');
   assert.equal(options.headers.Authorization,'Bearer testing-inbox');
   assert.deepEqual(JSON.parse(options.body),{source_info:{source:'FILE_UPLOAD',video_size:1024,chunk_size:1024,total_chunk_count:1}});
   return Response.json({error:{code:'unaudited_client_can_only_post_to_private_accounts',log_id:'test_inbox_trace'}},{status:403});
  };
 `);
 assert.equal((await request('config',{platform:'tiktok',id:'demo',secret:'dummy'})).status,200);
 const connect=async(mode,code,scope)=>{
  const url=new URL((await request('login',{platform:'tiktok',mode})).body.url);
  assert.equal(url.searchParams.get('scope'),scope);
  return request('/oauth/callback?code='+code+'&state='+url.searchParams.get('state'));
 };
 assert.equal((await connect('direct','direct','video.publish')).status,303);
 assert.match((await connect('inbox','partial','video.upload')).body.error,/não concedeu video\.upload/);
 assert.match((await connect('inbox','unconfirmed','video.upload')).body.error,/não concedeu video\.upload/);
 const send={platform:'tiktok',mode:'inbox',job:job.id,index:0,revision:0,consent:true};
 const preflight=await request('publish',send);
 assert.equal(preflight.body.reason,'scope_not_authorized');
 assert.match(preflight.body.error,/Finalizar no celular/);
 let state=(await request('state')).body;
 assert.equal(state.accounts.tiktok.scopes,'video.publish');
 assert.deepEqual(state.jobs[0].clips[0].posts,{});

 assert.equal((await connect('inbox','inbox','video.upload')).status,303);
 const rejected=await request('publish',send);
 assert.equal(rejected.body.reason,'unaudited_client_can_only_post_to_private_accounts');
 assert.match(rejected.body.error,/caixa de entrada.*video\.upload.*test_inbox_trace/);
 assert.doesNotMatch(rejected.body.error,/SELF_ONLY|conta deve estar privada/);
 state=(await request('state')).body;
 assert.equal(state.accounts.tiktok.scopes,'video.upload');
 assert.equal(state.jobs[0].clips[0].posts.tiktok.mode,'inbox');
 assert.equal(state.jobs[0].clips[0].posts.tiktok.state,'Falhou');
});

test('fila automática do TikTok envia só o corte autorizado e espera a confirmação do celular',async t=>{
 const job={id:'auto-tiktok',clips:[0,1].map(index=>({
  file:index+'.mp4',title:'Corte '+index,start:index*60,length:60,revision:0,posts:{},
  posting:{order:index+1,targets:['tiktok']},safety:{version:1,revision:0,status:'approved'}
 }))};
 const {request,folder}=await startApp(t,[job],`
  import assert from 'node:assert/strict';
  let uploads=0,checks=0;
  globalThis.fetch=async(input,options)=>{
   const url=new URL(input);
   if(url.pathname==='/v2/oauth/token/')return Response.json({access_token:'testing-inbox',scope:'video.upload',expires_in:3600});
   if(url.pathname==='/test-upload'){
    assert.equal(options.method,'PUT');
    const bytes=[];for await(const chunk of options.body)bytes.push(chunk);
    assert.equal(Buffer.concat(bytes).toString(),'corte autorizado');
    return new Response(null,{status:201});
   }
   if(url.pathname==='/v2/post/publish/status/fetch/')return Response.json({data:{status:++checks===1?'SEND_TO_USER_INBOX':'PUBLISH_COMPLETE'}});
   assert.equal(url.pathname,'/v2/post/publish/inbox/video/init/');
   assert.equal(++uploads,1);
   assert.equal(options.headers.Authorization,'Bearer testing-inbox');
   assert.deepEqual(JSON.parse(options.body),{source_info:{source:'FILE_UPLOAD',video_size:16,chunk_size:16,total_chunk_count:1}});
   return Response.json({data:{publish_id:'v_inbox_file~v2.12345',upload_url:'https://open-upload.tiktokapis.com/test-upload'}});
  };
 `);
 const media=path.join(folder,job.id);
 await mkdir(media);
 await writeFile(path.join(media,'0.mp4'),'corte anterior');
 await writeFile(path.join(media,'1.mp4'),'corte autorizado');
 await request('config',{platform:'tiktok',id:'demo',secret:'dummy'});
 const login=new URL((await request('login',{platform:'tiktok',mode:'inbox'})).body.url);
 assert.equal((await request('/oauth/callback?code=inbox&state='+login.searchParams.get('state'))).status,303);
 const {channel_id:channel}=(await request('creator',{platform:'tiktok',mode:'inbox'})).body;
 const settings={platform:'tiktok',channel,mode:'direct',consent:true};
 assert.equal((await request('posting/configure',settings)).status,200);
 const clip={job:job.id,index:1,revision:0};
 const selection={...clip,targets:['tiktok'],tiktokInbox:true};
 assert.equal((await request('posting/add',{...selection,tiktokAccount:'outra-conta'})).status,400);
 assert.equal((await request('posting/add',{...selection,tiktokAccount:channel})).status,200);
 let state=(await request('state')).body;
 assert.deepEqual(state.posting.configs.tiktok,{channel,mode:'inbox'});
 assert.ok(state.posting.platforms.includes('tiktok'));
 assert.equal(state.posting.overview.rows[job.id+'/0'].tiktok.label,'Autorize o envio ao TikTok');
 assert.equal((await request('posting/enable',{enabled:true})).status,200);
 for(let i=0;i<40;i++){
  state=(await request('state')).body;
  if(state.jobs[0].clips[1].posts.tiktok?.state==='Abra a caixa de entrada do TikTok')break;
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 assert.deepEqual(state.jobs[0].clips[0].posts,{});
 assert.equal(state.jobs[0].clips[1].posts.tiktok.state,'Abra a caixa de entrada do TikTok');
 assert.equal(state.published.length,0);
 const completed=await request('status',{...clip,platform:'tiktok'});
 assert.equal(completed.body.post.state,'Publicado');
});

test('TikTok preserva o relato de notificação ausente até confirmar a publicação',async t=>{
 const receipt='v_inbox_file~v2.12345';
 const job={id:'missing-inbox',clips:[{
  file:'clip.mp4',title:'Corte',start:0,length:60,revision:0,drive:{id:'drive-test',size:1024},
  posting:{order:1,targets:['tiktok','kwai']},
  posts:{tiktok:{id:receipt,mode:'inbox',state:'Abra a caixa de entrada do TikTok'}}
 }]};
 const {request}=await startApp(t,[job],`
  import assert from 'node:assert/strict';
  let checks=0;
  globalThis.fetch=async (input,options)=>{
   const url=new URL(input);
   assert.equal(url.origin,'https://open.tiktokapis.com');
   if(url.pathname==='/v2/oauth/token/')return Response.json({access_token:'testing-inbox',scope:'video.upload',expires_in:3600});
   assert.equal(url.pathname,'/v2/post/publish/status/fetch/');
   assert.deepEqual(JSON.parse(options.body),{publish_id:'v_inbox_file~v2.12345'});
   return Response.json({data:{status:++checks===1?'SEND_TO_USER_INBOX':'PUBLISH_COMPLETE'},error:{code:'ok'}});
  };
 `);
 const clip={job:job.id,index:0,revision:0};
 const readClip=async()=>(await request('state')).body.jobs[0].clips[0];
 assert.equal((await request('tiktok/inbox-missing',{...clip,receipt:'another-receipt'})).status,400);
 assert.equal((await request('tiktok/inbox-missing',{...clip,receipt})).status,200);
 assert.equal((await readClip()).posts.tiktok.inboxMissing,true);
 assert.equal((await request('config',{platform:'tiktok',id:'demo',secret:'dummy'})).status,200);
 const login=new URL((await request('login',{platform:'tiktok',mode:'inbox'})).body.url);
 assert.equal((await request('/oauth/callback?code=inbox&state='+login.searchParams.get('state'))).status,303);
 const first=await request('status',{...clip,platform:'tiktok'});
 assert.equal(first.body.post.id,receipt);
 assert.equal(first.body.post.state,'Abra a caixa de entrada do TikTok');
 assert.equal(first.body.post.inboxMissing,true);
 assert.equal((await request('publish',{...clip,platform:'tiktok',mode:'inbox',consent:true})).status,400);
 const complete=await request('status',{...clip,platform:'tiktok'});
 assert.equal(complete.body.post.state,'Publicado');
 assert.equal(complete.body.post.inboxMissing,undefined);
 assert.equal((await readClip()).drive.removed,undefined);
});

test('fila HTTP persiste seleção e embaralhamento, protege o histórico e só envia o primeiro corte selecionado',async t=>{
 const sample=(title,length=60)=>({file:title+'.mp4',title,start:0,length,revision:0,posts:{},drive:{id:title,size:1024},safety:{version:1,revision:0,status:'approved'}});
 const studio={id:'studio',title:'Estúdio',targets:[],clips:[sample('Estudio'),sample('Longo',100)]};
 const continuous={id:'continuous',continuousId:'source',title:'Contínuo',targets:['youtube'],auto:{channel:'page',privacy:'private'},clips:[sample('Continuo'),sample('NaoSelecionado')]};
 const {request,folder}=await startApp(t,[studio,continuous],`
  import assert from 'node:assert/strict';
  import {readFile} from 'node:fs/promises';
  import path from 'node:path';
  import {setTimeout as delay} from 'node:timers/promises';
  let firstRead=true;
  globalThis.fetch=async (input,options)=>{
   const url=new URL(input);
   if(url.href==='https://oauth2.googleapis.com/token')return Response.json({access_token:'test-token',expires_in:3600});
   if(url.pathname==='/youtube/v3/channels')return Response.json({items:[{id:'page',snippet:{title:'Canal de teste'},contentDetails:{relatedPlaylists:{uploads:'playlist-test'}}}]});
   if(url.pathname==='/youtube/v3/playlistItems'){
    assert.equal(url.searchParams.get('playlistId'),'playlist-test');
    return Response.json({items:[]});
   }
   if(url.pathname==='/drive/v3/about')return Response.json({user:{emailAddress:'drive@example.invalid'}});
   if(url.pathname.startsWith('/drive/v3/files/')){
    assert.equal(url.searchParams.get('alt'),'media');
    assert.equal(options.headers.Authorization,'Bearer test-token');
    if(firstRead){firstRead=false;await delay(350);}
    const bytes=await readFile(path.join(process.env.CLIPARIA_DATA,'silent.mp4'));
    const range=options.headers.Range?.match(/^bytes=([0-9]+)-([0-9]*)$/);
    if(!range)return new Response(bytes,{headers:{'Content-Type':'video/mp4','Content-Length':bytes.length}});
    const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),bytes.length-1):bytes.length-1;
    return new Response(bytes.subarray(start,end+1),{status:206,headers:{'Content-Type':'video/mp4','Content-Length':end-start+1,'Content-Range':'bytes '+start+'-'+end+'/'+bytes.length}});
   }
   assert.equal(url.pathname,'/upload/youtube/v3/videos');
   assert.equal(options.headers.Authorization,'Bearer test-token');
   assert.equal(JSON.parse(options.body).snippet.title,'Corrida na marina #gta6 #marina');
   assert.equal(JSON.parse(options.body).snippet.description,'Escapou pela água.\\n\\n#gta6 #marina');
   assert.match(JSON.parse(options.body).snippet.tags[0],/^cliparia-[a-f0-9]{32}$/);
   return Response.json({error:{message:'Resposta simulada da fila'}},{status:400});
  };
 `);
 const silent=await run('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=navy:s=160x90:r=1','-t','60','-an','-c:v','libx264','-movflags','+frag_keyframe+empty_moov','-f','mp4','pipe:1']);
 await writeFile(path.join(folder,'silent.mp4'),silent);
 assert.equal((await request('config',{platform:'drive',id:'demo-drive',secret:'dummy'})).status,200);
 const driveLogin=new URL((await request('login',{platform:'drive'})).body.url);
 assert.equal((await request('/?code=dummy&state='+driveLogin.searchParams.get('state'))).status,303);
 assert.equal((await request('state')).body.posting.enabled,false);
 assert.match((await request('posting/enable',{enabled:true})).body.error,/Configure/);
 const pick=(job,index,targets)=>request('posting/add',{job,index,revision:0,targets});
 assert.match((await pick('studio',1,['facebook'])).body.error,/90 segundos/);
 const pending=pick('studio',0,['youtube','tiktok']);
 let checking;
 for(let i=0;i<20;i++){
  checking=(await request('state')).body.jobs[0].clips[0];
  if(checking.safety.status==='checking')break;
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 assert.equal(checking.safety.status,'checking');
 assert.equal(checking.posting,undefined);
 const approved=await pending;
 assert.equal(approved.status,200,JSON.stringify(approved.body));
 assert.equal((await pick('continuous',0,['youtube'])).status,200);
 assert.equal((await pick('continuous',0,['youtube'])).status,200);
 assert.match((await request('history/remove',{job:'studio'})).body.error,/fila de postagem/);
 assert.equal((await request('posting/shuffle',{})).status,200);
 const stored=JSON.parse(await readFile(path.join(folder,'lives.json'),'utf8'));
 assert.ok(stored[1].clips[0].posting.order<stored[0].clips[0].posting.order);
 assert.deepEqual(stored[0].clips[0].posting.targets,['youtube','tiktok']);
 assert.equal(stored[0].clips[0].safety.status,'approved');
 assert.equal(stored[0].clips[0].safety.framesChecked,60);
 assert.equal(stored[1].clips[1].posting,undefined);

 assert.equal((await request('config',{platform:'youtube',id:'demo',secret:'dummy'})).status,200);
 const url=new URL((await request('login',{platform:'youtube'})).body.url);
 assert.equal((await request('/?code=dummy&state='+url.searchParams.get('state'))).status,303);
 const config={platform:'youtube',channel:'page',privacy:'private',kids:false,consent:true};
 assert.equal((await request('posting/configure',config)).status,200);
 const edit={job:'continuous',index:0,revision:0,version:0,title:'Corrida na marina',text:'Escapou pela água.',tags:'#gta6#marina #GTA6'};
 assert.equal((await request('posting/copy',edit)).status,200);
 assert.match((await request('posting/copy',edit)).body.error,/outra sessão/);
 assert.deepEqual((await request('post-copy',edit)).body.tags,['#gta6','#marina']);
 const reviewed=await request('posting/check-youtube',{});
 assert.deepEqual(reviewed.body,{published:0,processing:0,review:0,waiting:2,failed:0});
 assert.equal((await request('state')).body.posting.enabled,false);
 assert.equal((await request('posting/enable',{enabled:true})).status,200);
 let result;
 for(let i=0;i<30;i++){
  result=(await request('state')).body;
  if(result.jobs[1].clips[0].posts.youtube?.state==='Falhou')break;
  await new Promise(resolve=>setTimeout(resolve,30));
 }
 assert.match(result.jobs[1].clips[0].posts.youtube.detail,/Resposta simulada da fila/);
 assert.deepEqual(result.jobs[0].clips[0].posts,{});
 assert.deepEqual(result.jobs[1].clips[1].posts,{});
 assert.ok(result.posting.nextAt>Date.now());
 assert.equal((await request('posting/enable',{enabled:false})).status,200);
 assert.equal((await request('posting/retry-youtube',{job:'continuous',index:0,revision:0,consent:true})).status,200);
 assert.equal((await request('posting/remove',{job:'studio',index:0,revision:0})).status,200);
 const after=(await request('state')).body;
 assert.equal(after.posting.enabled,false);
 assert.equal(after.jobs[1].clips[0].posts.youtube,undefined);
 assert.equal(after.jobs[0].clips[0].posting.order,undefined);
 assert.equal(after.jobs[0].historyBusy,false);
 assert.deepEqual(after.jobs[0].clips[0].drive,studio.clips[0].drive);
});

test('backup restaura metadados e recibos sem duplicar a fila ou permitir caminhos externos',async t=>{
 const job={id:'backup-job',title:'Arquivo',mediaKey:'Youtube:archive',scanMode:'vod',url:'https://www.youtube.com/watch?v=abcdefghijk',writePosts:true,clips:[
  {file:'01.mp4',title:'Publicado',start:0,length:60,drive:{id:'already-published',size:512,removed:true},posts:{youtube:{state:'Publicado',id:'abcdefghijk'}}},
  {file:'02.mp4',title:'Pendente',start:80,length:60,drive:{id:'queued-drive',size:512},posting:{order:1,targets:['kwai']},posts:{},postDraft:{title:'Texto próprio',text:'Minha legenda',tags:['#gta6']}}
 ]};
 const {request}=await startApp(t,[job]);
 const exported=await request('backup');
 assert.equal(exported.status,200);
 assert.equal(exported.body.format,'cliparia-backup');
 assert.equal(exported.body.generation['youtube:archive'].length,2);
 assert.match(JSON.stringify(exported.body.publications.records),/abcdefghijk/);
 const invalid=structuredClone(exported.body);
 invalid.jobs[0].clips[0].file='../secreto.mp4';
 assert.equal((await request('backup/restore',invalid)).status,400);
 assert.equal((await request('posting/remove',{job:job.id,index:1,revision:0})).status,200);
 assert.equal((await request('history/remove',{job:job.id})).status,200);
 const restored=await request('backup/restore',exported.body);
 assert.deepEqual(restored.body,{jobs:1,clips:2,queued:1});
 const state=(await request('state')).body;
 assert.equal(state.jobs[0].clips[0].posts.youtube.state,'Publicado');
 assert.equal(state.published.length,1);
 assert.deepEqual(state.jobs[0].clips[1].postDraft,job.clips[1].postDraft);
 assert.equal(state.jobs[0].clips[1].posting.order,1);
 assert.deepEqual((await request('backup/restore',exported.body)).body,{jobs:0,clips:0,queued:0});
});

test('adicionar à fila bloqueia conteúdo sexual e falhas de leitura mesmo com aprovação anterior',async t=>{
 const cached={version:1,revision:0,status:'approved'};
 const sample={file:'broken.mp4',title:'Corte',start:0,length:60,revision:0,posts:{},safety:cached};
 const job={id:'stage-safety',targets:[],clips:[{...sample,title:'Corte com cena de sexo explícito'},sample]};
 const {request,folder}=await startApp(t,[job]);
 await mkdir(path.join(folder,job.id));
 await writeFile(path.join(folder,job.id,sample.file),'Arquivo de vídeo inválido para o teste.');
 const pick=(index,targets)=>request('posting/add',{job:job.id,index,revision:0,targets});
 const blocked=await pick(0,['kwai']);
 assert.equal(blocked.status,400);
 assert.match(blocked.body.error,/Indício de conteúdo sexual/);
 const unreadable=await pick(1,['youtube','tiktok']);
 assert.equal(unreadable.status,400);
 assert.match(unreadable.body.error,/Não foi possível verificar/);
 const clips=(await request('state')).body.jobs[0].clips;
 assert.deepEqual(clips.map(clip=>clip.safety.status),['blocked','error']);
 assert.ok(clips.every(clip=>!clip.posting&&!Object.keys(clip.posts).length));
});

test('HTTP exige análise para clipe antigo e direciona a publicação do YouTube à fila automática',async t=>{
 const job={id:'old-job',title:'Live antiga',continuousId:'old-source',mediaKey:'Youtube:old',targets:['youtube'],clips:[{file:'old.mp4',title:'Corte antigo',start:0,length:60,revision:0,posts:{}}]};
 const {request}=await startApp(t,[job]);
 const params={job:'old-job',index:0,revision:0,platform:'youtube',consent:true,title:'cena de sexo explícito'};
 const manual=await request('publish',params);
 assert.equal(manual.status,400);assert.match(manual.body.error,/YouTube publica pela fila automática/);
 const check=await request('safety/check',{job:'old-job',index:0,revision:0});
 assert.equal(check.body.safety.status,'error');
 const state=await request('state');
 assert.equal(state.body.accounts.facebook.connected,false);
 const fb=await request('facebook/connect',{id:'invalid-page',token:'dummy-local-token'});
 assert.equal(fb.status,400);assert.match(fb.body.error,/ID numérico.*Página/);
 const fbCreator=await request('creator',{platform:'facebook'});
 assert.match(fbCreator.body.error,/Conecte.*Facebook/);
 const fbConfig=await request('config',{platform:'facebook',id:'123',secret:'dummy'});
 assert.match(fbConfig.body.error,/Conectar facebook/);
 assert.equal(state.body.jobs[0].clips[0].safety.status,'error');
 assert.deepEqual(state.body.jobs[0].clips[0].posts,{});
});

test('confirma no perfil conectado um Reel publicado manualmente após falha do upload',async t=>{
 const clips=[0,60].map(start=>({file:start+'.mp4',start,length:60,title:'Corte',revision:0,drive:{id:'drive-'+start,size:100},
  posts:{instagram:{state:'Falhou',id:'1234',uploadMode:'hosted',detail:'Media upload has failed with error code 2207077'}},
  posting:{order:start+1,targets:['instagram','youtube']}}));
 const {request}=await startApp(t,[{id:'confirm-ig',clips}],`
  import assert from 'node:assert/strict';
  globalThis.fetch=async(input,options)=>{
   const url=new URL(input);
   assert.equal(url.hostname,'graph.facebook.com');assert.equal(options.method,'GET');
   if(url.pathname.endsWith('/123'))return Response.json({id:'123',username:'perfil-teste'});
   assert.ok(url.pathname.endsWith('/123/media'));
   assert.equal(url.searchParams.get('fields'),'id,permalink,media_product_type');
   return Response.json({data:[
    {id:'789',permalink:'https://www.instagram.com/p/reel-code/',media_product_type:'REELS'},
    {id:'790',permalink:'https://www.instagram.com/p/image/',media_product_type:'FEED'}
   ]});
  };
 `);
 assert.equal((await request('instagram/connect',{id:'123',token:'test-token'})).status,200);
 const confirm=(index,code)=>request('instagram/confirm',{job:'confirm-ig',index,revision:0,link:'https://www.instagram.com/reel/'+code+'/?share=1',consent:true});
 assert.match((await confirm(0,'image')).body.error,/perfil conectado/);
 assert.equal((await confirm(0,'reel-code')).status,200);
 const state=(await request('state')).body;
 assert.deepEqual(state.jobs[0].clips[0].posts.instagram,{state:'Publicado',mediaId:'789',account:'123',link:'https://www.instagram.com/reel/reel-code/',detail:'Publicação manual confirmada no Instagram.'});
 assert.equal(state.published[0].posts.instagram.link,'https://www.instagram.com/reel/reel-code/');
 assert.match((await confirm(1,'reel-code')).body.error,/já está registrado/);
});

test('a lixeira confirma no Drive, preserva o histórico e bloqueia publicação até restaurar',async t=>{
 const sample={file:'corte.mp4',title:'Corte',start:40,length:60,revision:2,posts:{facebook:{state:'Publicado',id:'post-protegido'}}};
 const job={id:'trash-job',targets:['youtube','facebook'],clips:[
  {...sample,drive:{id:'drive-app-file',size:1024}},
  {...sample,drive:{id:'drive-rejected-file',size:1024}},
  {...sample,drive:{id:'deleted-file',size:1024,removed:true}},
  sample
 ]};
 const {request,folder}=await startApp(t,[job],`
  import assert from 'node:assert/strict';
  const changes=[];
  globalThis.fetch=async (input,options)=>{
   const url=new URL(input);
   if(url.href==='https://oauth2.googleapis.com/token')return Response.json({access_token:'token-teste',expires_in:3600});
   assert.equal(options.headers.Authorization,'Bearer token-teste');
   if(url.pathname==='/drive/v3/about')return Response.json({user:{emailAddress:'test@example.invalid'}});
   const id=url.pathname.split('/').at(-1);
   assert.equal(url.origin,'https://www.googleapis.com');
   assert.equal(options.method,'PATCH');
   assert.equal(url.searchParams.get('fields'),'id,trashed');
   if(id==='drive-rejected-file')return Response.json({error:{message:'Arquivo sem permissão'}},{status:403});
   assert.equal(id,'drive-app-file');
   const {trashed}=JSON.parse(options.body);
   assert.equal(trashed,changes.length===0);
   changes.push(trashed);
   assert.ok(changes.length<=2);
   return Response.json({id,trashed});
  };
 `);
 assert.equal((await request('config',{platform:'drive',id:'demo',secret:'dummy'})).status,200);
 const login=await request('login',{platform:'drive'});
 const state=new URL(login.body.url).searchParams.get('state');
 assert.equal((await request('/oauth/callback?code=dummy&state='+state)).status,303);

 const params={job:job.id,index:0,revision:2,consent:true,id:'arquivo-forjado'};
 assert.match((await request('drive/trash',{...params,consent:false})).body.error,/Confirme/);
 assert.match((await request('drive/trash',{...params,revision:1})).body.error,/mudou/);
 assert.match((await request('drive/trash',{...params,index:1})).body.error,/sem permissão/);
 assert.match((await request('drive/restore',{...params,index:2})).body.error,/já foi excluído/);
 assert.match((await request('drive/trash',{...params,index:3})).body.error,/não está salvo/);
 assert.equal((await request('drive/trash',params)).status,200);
 assert.equal((await request('drive/trash',params)).status,200);
 const stored=JSON.parse(await readFile(path.join(folder,'lives.json'),'utf8'))[0];
 assert.deepEqual(stored.clips[0].drive,{...job.clips[0].drive,removed:true,trashed:true});
 assert.deepEqual(stored.clips[0].posts,sample.posts);
 assert.deepEqual(stored.clips[1].drive,job.clips[1].drive);
 assert.match((await request('publish',{...params,platform:'facebook'})).body.error,/não está disponível/);
 assert.match((await request('/video/'+job.id+'/0')).body.error,/na lixeira/);
 assert.equal((await request('drive/restore',params)).status,200);
 assert.equal((await request('drive/restore',params)).status,200);
 const current=await request('state');
 assert.deepEqual(current.body.jobs[0].clips[0].drive,job.clips[0].drive);
 assert.deepEqual(current.body.jobs[0].clips[0].posts,sample.posts);
});
