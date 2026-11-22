import {test} from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {PassThrough,Readable,Writable} from 'node:stream';
import {profile,sendReel,advance,finishHostedReel,linkedPageToken,normalize} from '../instagram.mjs';
import {reconcile} from '../cleanup.mjs';
import {run} from '../speech.mjs';

const mockUpload=(...args)=>fetch(...args);
const encoded=text=>({size:Buffer.byteLength(text),stream:()=>Readable.from([Buffer.from(text)])});

test('repete a leitura do perfil após queda e falha temporária da Meta',async t=>{
 let reads=0;
 t.mock.method(globalThis,'fetch',async (_url,options)=>{
  assert.equal(options.method,'GET');
  if(++reads===1)throw TypeError('socket closed');
  if(reads===2)return Response.json({error:{code:2,message:'Service temporarily unavailable'}},{status:503});
  return Response.json({id:'123',username:'perfil'});
 });
 assert.equal((await profile({id:'123',token:'testing'})).channel_id,'123');
 assert.equal(reads,3);
});

test('Reel usa envio binário e só é publicado quando o contêiner está pronto',async t=>{
 const log=[];
 let ready=false;
 t.mock.method(globalThis,'fetch',async (input,options)=>{
  const url=new URL(input);
  log.push(url.pathname);
  if(url.hostname==='rupload.facebook.com'){
   assert.equal(options.headers.Authorization,'OAuth sample-local-test-token');
   assert.equal(options.headers.file_size,'4');
   const body=[];
   for await(const chunk of options.body)body.push(chunk);
   assert.equal(Buffer.concat(body).toString(),'reel');
   return Response.json({success:true});
  }
  if(url.pathname==='/v26.0/123'&&options.method==='GET')return Response.json({id:'123',username:'creator'});
  if(url.pathname==='/v26.0/123/media'){
   assert.equal(options.body.get('upload_type'),'resumable');
   assert.equal(options.body.get('media_type'),'REELS');
   assert.equal(options.body.get('caption'),'Minha legenda');
   return Response.json({id:'456',uri:'https://rupload.facebook.com/ig-api-upload/v26.0/456'});
  }
  if(url.pathname==='/v26.0/456')return Response.json({status_code:ready?'FINISHED':'IN_PROGRESS'});
  if(url.pathname==='/v26.0/123/media_publish'){
   assert.equal(options.body.get('creation_id'),'456');
   return Response.json({id:'789'});
  }
  throw Error('Requisição inesperada.');
 });
 const account={id:'123',token:'sample-local-test-token',expected:'123'};
 assert.equal((await profile(account)).creator_nickname,'@creator');
 let receipt;
 let disposed=false;
 let post=await sendReel(account,{size:5},'Minha legenda',(id,details)=>{receipt={id,...details};},async()=>({
  size:4,stream:()=>Readable.from([Buffer.from('reel')]),dispose:async()=>{disposed=true;}
 }),mockUpload);
 assert.deepEqual(receipt,{id:'456',account:'123'});
 assert.equal(disposed,true);
 let saves=0;
 post=await advance(account,post,()=>saves++);
 assert.equal(post.state,'Em processamento');
 assert.equal(saves,0);
 ready=true;
 post=await advance(account,post,()=>saves++);
 assert.equal(saves,1);
 assert.equal(post.state,'Publicado');
 assert.equal(post.mediaId,'789');
 assert.equal(log.filter(l=>l.endsWith('/media_publish')).length,1);
});
test('reconciliação não repete publicação com resposta incerta',async t=>{
 let calls=0;
 t.mock.method(globalThis,'fetch',async (_,opts)=>{
  if(opts.method==='GET')return Response.json({status_code:'FINISHED'});
  calls++;
  throw Error('Conexão caiu');
 });
 const account={id:'123',token:'mock'};
 let post={id:'456',account:'123',state:'Em processamento'};
 post=await advance(account,post,()=>{});
 assert.equal(post.state,'Confirmação pendente');
 await advance(account,post,()=>{});
 assert.equal(calls,1);
});
test('retoma o mesmo contêiner quando a Meta rejeita a publicação por token expirado',async t=>{
 let posts=0;
 t.mock.method(globalThis,'fetch',async (input,options)=>{
  if(options.method==='GET')return Response.json({status_code:'FINISHED'});
  posts++;
  assert.equal(options.body.get('creation_id'),'456');
  if(posts===1)return Response.json({error:{code:190,error_subcode:463,message:'Session has expired'}},{status:401});
  assert.equal(options.headers.Authorization,'Bearer new-page-token');
  return Response.json({id:'789'});
 });
 const post={id:'456',account:'123',state:'Em processamento'};
 let saves=0;
 await assert.rejects(advance({id:'123',token:'expired-token'},post,()=>saves++),{reason:'instagram_token_invalid'});
 assert.equal(post.publishRequested,undefined);
 assert.equal(post.state,'Em processamento');
 assert.equal(saves,2);
 const result=await advance({id:'123',token:'new-page-token'},post,()=>saves++);
 assert.equal(result.id,'456');assert.equal(result.mediaId,'789');assert.equal(posts,2);
});
test('localiza a recusa do upload e preserva a explicação da Meta sem expor o token',async t=>{
 const token='sample-secret-token-for-upload';
 const credentials={id:'123',token};
 t.mock.method(globalThis,'fetch',async input=>{
  const url=new URL(input);
  if(url.hostname==='rupload.facebook.com')return Response.json({
   debug_info:{message:'O tamanho do vídeo não corresponde ao envio. OAuth '+token,code:1363030,fbtrace_id:'TRACE1234'}
  },{status:400});
  if(url.pathname.endsWith('/media'))return Response.json({id:'456',uri:'https://rupload.facebook.com/ig-api-upload/v26.0/456'});
  return Response.json({id:'123',username:'creator'});
 });
 let disposed=false,acknowledged=false;
 await assert.rejects(sendReel(credentials,{size:4},'Legenda',()=>{acknowledged=true;},async()=>({
  size:4,stream:()=>Readable.from([Buffer.from('reel')]),dispose:async()=>{disposed=true;}
 }),mockUpload),error=>{
  assert.match(error.message,/transferir o vídeo.*HTTP 400.*1363030.*TRACE1234/);
  assert.match(error.message,/tamanho do vídeo/);
  assert.ok(!error.message.includes(token));
  assert.equal(error.reason,'meta_1363030');
  return true;
 });
 assert.equal(acknowledged,false);
 assert.equal(disposed,true);
});
test('distingue token expirado de uma recusa sem explicação no preparo',async t=>{
 let expired=true;
 t.mock.method(globalThis,'fetch',async input=>{
  if(expired)return Response.json({error:{code:190,error_subcode:463,message:'Session has expired'}},{status:400});
  if(new URL(input).pathname.endsWith('/media'))return new Response(null,{status:400});
  return Response.json({id:'123',username:'creator'});
 });
 const credentials={id:'123',token:'sample-token'};
 await assert.rejects(profile(credentials),error=>{
  assert.match(error.message,/validar a conta.*190\/463.*Reconecte o Instagram/);
  assert.equal(error.reason,'instagram_token_invalid');
  return true;
 });
 expired=false;
 await assert.rejects(sendReel(credentials,{size:4},'Legenda',()=>{},async()=>({...encoded('reel'),dispose:async()=>{}})),/preparar o Reel \(HTTP 400\).*não informou/);
});
test('tenta formato de compatibilidade uma vez e registra apenas o envio aceito',async t=>{
 let prepared=0,uploads=0,compatible=0,disposed=0,keepRejecting=false;
 t.mock.method(globalThis,'fetch',async (input,options)=>{
  const url=new URL(input);
  if(url.pathname.endsWith('/media')){
   assert.equal(options.body.get('caption'),'Legenda');
   const id=String(100+ ++prepared);
   return Response.json({id,uri:'https://rupload.facebook.com/ig-api-upload/v26.0/'+id});
  }
  if(url.hostname==='rupload.facebook.com'){
   uploads++;
   assert.equal(url.pathname.split('/').at(-1),String(100+uploads));
   const expected=uploads%2?'primeiro':'menor';
   const chunks=[];
   for await(const chunk of options.body)chunks.push(chunk);
   assert.equal(Buffer.concat(chunks).toString(),expected);
   assert.equal(options.headers['Content-Length'],String(expected.length));
   assert.equal(options.headers.file_size,String(expected.length));
   if(uploads%2||keepRejecting)return Response.json({
    debug_info:{type:'ProcessingFailedError',message:'Request processing failed'}
   },{status:400});
   return Response.json({success:true});
  }
  assert.equal(options.method,'GET');
  if(url.searchParams.has('fields')&&url.searchParams.get('fields')==='status_code,status')return Response.json({status_code:'ERROR',status:'Invalid video format'});
  return Response.json({id:'123',username:'creator'});
 });
 const credentials={id:'123',token:'sample-token'};
 const encode=async()=>({...encoded('primeiro'),dispose:async()=>{disposed++;},compatible:async()=>{
  compatible++;
  return encoded('menor');
 }});
 const recorded=[];
 const post=await sendReel(credentials,{size:12},'Legenda',id=>recorded.push(id),encode,mockUpload);
 assert.deepEqual(recorded,['102']);
 assert.equal(post.id,'102');
 assert.deepEqual([prepared,uploads,compatible,disposed],[2,2,1,1]);

 keepRejecting=true;
 await assert.rejects(sendReel(credentials,{size:12},'Legenda',id=>recorded.push(id),encode,mockUpload),/Invalid video format.*Contêiner 104.*também recusou o MP4 de compatibilidade/);
 assert.deepEqual(recorded,['102']);
 assert.deepEqual([prepared,uploads,compatible,disposed],[4,4,2,2]);
});

test('resposta truncada no upload binário é tratada e o envio usa outro contêiner',async t=>{
 let uploads=0,prepared=0;
 t.mock.method(https,'request',(_url,options,callback)=>{
  assert.equal(options.headers['Content-Length'],'4');
  const chunks=[];
  const request=new Writable({
   autoDestroy:false,
   write(chunk,_encoding,done){chunks.push(chunk);done();}
  });
  request.once('finish',()=>{
   assert.equal(Buffer.concat(chunks).toString(),'reel');
   const response=new PassThrough();
   const truncated=++uploads===1;
   response.statusCode=truncated?400:200;
   response.headers=truncated?{'content-length':'500'}:{};
   response.complete=!truncated;
   callback(response);
   if(truncated){
    response.write('resposta parcial');
    setImmediate(()=>response.destroy(Error('resposta abortada')));
   }else response.end(JSON.stringify({success:true}));
  });
  return request;
 });
 t.mock.method(globalThis,'fetch',async input=>{
  if(!String(input).endsWith('/media'))return Response.json({id:'123',username:'creator'});
  const id=String(100+ ++prepared);
  return Response.json({id,uri:'https://rupload.facebook.com/ig-api-upload/v26.0/'+id});
 });
 const ids=[];
 const post=await sendReel({id:'123',token:'sample-token'},{size:4},'Legenda',id=>ids.push(id),
  async()=>({...encoded('reel'),dispose:async()=>{}}));
 assert.deepEqual(ids,['102']);
 assert.equal(post.id,'102');
 assert.equal(uploads,2);
});

test('seleciona somente o token da Página vinculada ao Instagram cadastrado',async t=>{
 t.mock.method(globalThis,'fetch',async input=>{
  const params=new URL(input).searchParams;
  if(!params.has('after'))return Response.json({
   data:[{instagram_business_account:{id:'999'},access_token:'other'}],
   paging:{next:'https://example.test/ignored',cursors:{after:'page-two'}}
  });
  assert.equal(params.get('after'),'page-two');
  return Response.json({data:[{instagram_business_account:{id:'123'},access_token:'linked'}]});
 });
 assert.equal(await linkedPageToken({id:'123',token:'user'}),'linked');
});

test('erro de autorização dentro de debug_info não repete a conversão',async t=>{
 t.mock.method(globalThis,'fetch',async input=>{
  const url=new URL(input);
  if(url.hostname==='rupload.facebook.com')return Response.json({
   error:{message:'Request processing failed'},
   debug_info:{type:'ProcessingFailedError',message:JSON.stringify({error:{code:10,fbtrace_id:'TRACE1234',message:'unauthorized user request'}})}
  },{status:400});
  if(url.pathname.endsWith('/media'))return Response.json({id:'456',uri:'https://rupload.facebook.com/ig-api-upload/v26.0/456'});
  return Response.json({id:'123',username:'creator'});
 });
 const encode=async()=>({...encoded('reel'),dispose:async()=>{},compatible:()=>assert.fail('Erro de autorização')});
 await assert.rejects(sendReel({id:'123',token:'sample-token'},{size:4},'Legenda',()=>assert.fail('Envio recusado'),encode,mockUpload),error=>{
  assert.equal(error.reason,'instagram_upload_unauthorized');
  assert.match(error.message,/código 10, fbtrace_id TRACE1234/);
  return true;
 });
});
test('consulta o contêiner após HTTP 400 e reaproveita o Reel que já ficou pronto',async t=>{
 let uploads=0,checks=0;
 t.mock.method(globalThis,'fetch',async (input,options)=>{
  const url=new URL(input);
  if(url.hostname==='rupload.facebook.com'){
   uploads++;
   return Response.json({debug_info:{type:'ProcessingFailedError',message:'Request processing failed'}},{status:400});
  }
  if(url.pathname.endsWith('/media'))return Response.json({id:'456',uri:'https://rupload.facebook.com/ig-api-upload/v26.0/456'});
  if(url.pathname.endsWith('/456')){
   checks++;
   assert.equal(options.method,'GET');
   assert.equal(url.searchParams.get('fields'),'status_code,status');
   return Response.json({status_code:'FINISHED'});
  }
  return Response.json({id:'123',username:'creator'});
 });
 const receipts=[];
 const post=await sendReel({id:'123',token:'sample-token'},{size:4},'Legenda',id=>receipts.push(id),
  async()=>({...encoded('reel'),compatible:()=>assert.fail('A Meta já preparou o Reel.'),dispose:async()=>{}}),mockUpload);
 assert.deepEqual(receipts,['456']);assert.equal(post.id,'456');
 assert.equal(uploads,1);assert.equal(checks,1);
});
test('usa link temporário após as recusas binárias e o encerra quando o contêiner fica pronto',async t=>{
 let binary=0,created=0,closed=0,disposed=0,ready=false;
 const url='https://video-test.trycloudflare.com/reel-test.mp4';
 t.mock.method(globalThis,'fetch',async (input,options)=>{
  const target=new URL(input);
  if(target.hostname==='rupload.facebook.com'){
   binary++;
   return Response.json({debug_info:{type:'ProcessingFailedError',message:'Request processing failed'}},{status:400});
  }
  if(target.pathname.endsWith('/media')){
   const id=String(100+ ++created);
   if(created===3){
    assert.equal(options.body.get('video_url'),url);
    assert.equal(options.body.has('upload_type'),false);
    return Response.json({id});
   }
   assert.equal(options.body.get('upload_type'),'resumable');
   return Response.json({id,uri:'https://rupload.facebook.com/ig-api-upload/v26.0/'+id});
  }
  if(target.pathname.endsWith('/media_publish')){assert.equal(closed,1);return Response.json({id:'999'});}
  if(target.searchParams.get('fields')==='status_code,status')return Response.json({status_code:ready?'FINISHED':'IN_PROGRESS'});
  return Response.json({id:'123',username:'creator'});
 });
 const credentials={id:'123',token:'sample-token'};
 const encode=async()=>({...encoded('reel'),compatible:async()=>encoded('reel seguro'),dispose:async()=>{disposed++;}});
 const hosted=async(reel,dispose)=>{
  assert.equal(reel.size,Buffer.byteLength('reel seguro'));
  return {url,close:async()=>{closed++;await dispose();}};
 };
 const ids=[];
 const post=await sendReel(credentials,{size:4},'Legenda',id=>ids.push(id),encode,mockUpload,{hosted});
 assert.equal(post.uploadMode,'hosted');assert.deepEqual(ids,['103']);assert.deepEqual([binary,created,closed,disposed],[2,3,0,0]);
 assert.equal((await advance(credentials,post,()=>{})).state,'Em processamento');
 assert.equal(closed,0);
 let result;
 await finishHostedReel(post.id,async()=>{result=await advance(credentials,post,()=>{});},
  {pause:async()=>{assert.equal(closed,0);ready=true;}});
 assert.equal(result.state,'Publicado');
 assert.deepEqual([closed,disposed],[1,1]);
});
test('fecha o link ao alcançar o limite do lote e conserva o recibo para conferir depois',async t=>{
 const credentials={id:'123',token:'sample-token'};
 t.mock.method(globalThis,'fetch',async input=>new URL(input).pathname.endsWith('/media')?
  Response.json({id:'456'}):Response.json({id:'123',username:'creator'}));
 let closed=0,checks=0;
 const post=await sendReel(credentials,{size:4},'Legenda',()=>{},
  async()=>({...encoded('reel'),compatible:async()=>encoded('reel'),dispose:async()=>{}}),mockUpload,
  {preferHosted:true,hosted:async()=>({url:'https://test.trycloudflare.com/reel.mp4',close:async()=>{closed++;}})});
 await finishHostedReel(post.id,async()=>{checks++;},{budget:0});
 assert.deepEqual([checks,closed],[1,1]);
 assert.equal(post.id,'456');
 assert.equal(post.state,'Em processamento');
});
test('uma nova tentativa após recusa binária pode ir direto ao link e mantém o erro sanitizado',async t=>{
 const url='https://video-test.trycloudflare.com/reel-secret.mp4';
 let closed=0,disposed=0;
 t.mock.method(globalThis,'fetch',async (input,options)=>{
  if(!String(input).endsWith('/media'))return Response.json({id:'123',username:'creator'});
  assert.equal(options.body.get('video_url'),url);
  return Response.json({error:{message:'Could not fetch '+url}},{status:400});
 });
 const encode=async()=>({...encoded('reel'),compatible:async()=>encoded('reel seguro'),dispose:async()=>{disposed++;}});
 await assert.rejects(sendReel({id:'123',token:'sample-token'},{size:4},'Legenda',()=>assert.fail('Reel recusado'),encode,()=>assert.fail('Não repete o binário'),{
  preferHosted:true,hosted:async(reel,dispose)=>({url,close:async()=>{closed++;await dispose();}})
 }),error=>{
  assert.equal(error.reason,'instagram_upload_processing_failed');
  assert.match(error.message,/link HTTPS falhou/);assert.ok(!error.message.includes('reel-secret'));return true;
 });
 assert.deepEqual([closed,disposed],[1,1]);
});
test('preserva o código da Meta e diferencia uma falha após entregar todo o arquivo',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({status_code:'ERROR',status:'Error: Media upload has failed with error code 2207077'}));
 const post=await advance({id:'123',token:'sample-token'},{id:'456',account:'123',state:'Em processamento',uploadMode:'hosted',delivery:{requests:1,bytes:400,size:400}},()=>{});
 assert.equal(post.state,'Falhou');
 assert.equal(post.reason,'instagram_hosted_media_failed');
 assert.match(post.detail,/2207077.*serviu o arquivo completo/);
});
test('mantém a indisponibilidade do link separada de um vídeo recusado pela Meta',async t=>{
 t.mock.method(globalThis,'fetch',async input=>{
  assert.ok(!String(input).endsWith('/media'),'O link indisponível não deve chegar à Meta.');
  return Response.json({id:'123',username:'creator'});
 });
 let disposed=0;
 const encode=async()=>({...encoded('reel'),compatible:async()=>encoded('reel seguro'),dispose:async()=>{disposed++;}});
 const unavailable=Object.assign(Error('Link indisponível'),{reason:'instagram_link_unavailable'});
 await assert.rejects(sendReel({id:'123',token:'sample-token'},{size:4},'Legenda',()=>assert.fail('Não há contêiner'),encode,undefined,{
  preferHosted:true,hosted:async()=>{throw unavailable;}
 }),error=>error===unavailable);
 assert.equal(disposed,1);
});
test('MP4 de compatibilidade mantém o áudio e o vídeo nos parâmetros do Reel',async()=>{
 const sample=await run('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=24',
  '-f','lavfi','-i','anoisesrc=sample_rate=48000:seed=1','-t','4','-c:v','libx264','-c:a','aac','-movflags','+frag_keyframe+empty_moov','-f','mp4','pipe:1']);
 const reel=await normalize({size:sample.length,stream:()=>Readable.from([sample])},true,true);
 try{
  const fallback=await reel.compatible(),chunks=[];
  for await(const chunk of fallback.stream())chunks.push(chunk);
  const bytes=Buffer.concat(chunks);
  assert.equal(bytes.length,fallback.size);
  assert.ok(bytes.indexOf('moov')>0&&bytes.indexOf('moov')<bytes.indexOf('mdat'));
  const {streams,format}=JSON.parse(await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json','-i','pipe:0'],null,bytes));
  const [video,audio]=streams;
  assert.deepEqual([video.codec_name,video.profile,video.width,video.height,video.pix_fmt,video.r_frame_rate,video.has_b_frames],['h264','Main',720,1280,'yuv420p','30/1',0]);
  assert.deepEqual([audio.codec_name,audio.sample_rate,audio.channels],['aac','48000',2]);
  assert.ok(Number(audio.bit_rate)<=128_000);
  assert.ok(Math.abs(Number(format.duration)-4)<.15,JSON.stringify({total:format.duration,video:video.duration,audio:audio.duration,start:video.start_time}));
 }finally{await reel.dispose();}
});
test('Drive aguarda a publicação no Instagram e a confirmação manual do Kwai',async()=>{
 const clip={drive:{id:'drive'},posts:{instagram:{id:'456',state:'Em processamento'}}};
 const job={targets:['instagram','kwai']};
 let removed=0;
 const services={instagram:async post=>({...post,state:'Publicado'}),remove:async()=>{removed++;}};
 await reconcile(job,clip,()=>{},services);
 assert.equal(removed,0);
 clip.posts.kwai={state:'Publicado',detail:'Confirmado manualmente'};
 await reconcile(job,clip,()=>{},services);
 assert.equal(removed,1);
 assert.equal(clip.drive.removed,true);
});
