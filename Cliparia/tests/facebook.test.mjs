import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {connect,sendReel,advance} from '../facebook.mjs';
import {reconcile} from '../cleanup.mjs';
import {postFields,suggestPost} from '../post-copy.mjs';

const credentials={id:'123',token:'sample-page-token'};
const page={id:'123',name:'Página de teste',is_published:true};
const body={channel:'123',privacy:'public',title:'Vitória #jogos',description:'Corrida #GTA6 #jogos'};
const encoded=()=>({size:4,stream:()=>Readable.from([Buffer.from('reel')]),dispose:async()=>{}});

test('converte token de usuário em token da Página e valida a identidade',async t=>{
 const calls=[];
 t.mock.method(globalThis,'fetch',async(input,options)=>{
  const url=new URL(input);calls.push(url);
  assert.equal(url.searchParams.has('access_token'),false);
  if(url.pathname.endsWith('/me/permissions'))return Response.json({data:['pages_show_list','pages_read_engagement','pages_manage_posts'].map(permission=>({permission,status:'granted'}))});
  if(url.pathname.endsWith('/me'))return Response.json({id:options.headers.Authorization==='Bearer user-token'?'999':'123'});
  if(url.searchParams.get('fields')==='id,access_token')return Response.json({id:'123',access_token:'sample-page-token'});
  return Response.json(page);
 });
 assert.deepEqual(await connect('123','user-token'),{...credentials,account:page.name});
 assert.equal(calls.length,5);
});

test('não salva conexão com permissão de publicação ausente',async t=>{
 t.mock.method(globalThis,'fetch',async input=>Response.json(String(input).includes('/permissions')?{data:[]}:{id:'999'}));
 await assert.rejects(connect('123','user-token'),/pages_manage_posts/);
});

test('token expirado durante a publicação permite retomar o mesmo Reel após reconectar',async t=>{
 let expired=true,finishes=0,saves=0;
 t.mock.method(globalThis,'fetch',async(_,options)=>{
  if(options.method==='GET')return Response.json({status:{video_status:'ready'}});
  finishes++;
  return expired?Response.json({error:{code:190,error_subcode:463,message:'Session has expired'}},{status:400}):Response.json({success:true});
 });
 const post={id:'456',account:'123',uploaded:true,state:'Em processamento'};
 const save=()=>saves++;
 await assert.rejects(advance(credentials,post,save),{reason:'facebook_token_invalid',message:/Reconectar/});
 assert.equal(post.publishRequested,false);
 assert.equal(finishes,1);
 assert.equal(saves,2);
 expired=false;
 const result=await advance({...credentials,token:'new-page-token'},post,save);
 assert.equal(result.id,post.id);
 assert.equal(result.publishRequested,true);
 assert.equal(finishes,2);
});

test('Reel usa upload binário, finaliza sem esperar a codificação e aguarda confirmação pública',async t=>{
 let ready=false,published=false,finishes=0,disposed=false;
 const receipts=[];
 t.mock.method(globalThis,'fetch',async(input,options)=>{
  const url=new URL(input);
  assert.equal(url.searchParams.has('access_token'),false);
  if(url.hostname==='rupload.facebook.com'){
   assert.equal(receipts[0].uploaded,false);
   assert.equal(options.headers.Authorization,'OAuth sample-page-token');
   assert.equal(options.headers.file_size,'4');
   let bytes='';for await(const chunk of options.body)bytes+=chunk.toString();assert.equal(bytes,'reel');
   return Response.json({success:true});
  }
  if(url.pathname.endsWith('/me')||url.pathname.endsWith('/123'))return Response.json(page);
  if(url.pathname.endsWith('/456'))return Response.json({status:{video_status:ready?'ready':'processing',processing_phase:{status:ready?'completed':'in_progress'},publishing_phase:{publish_status:published?'published':'draft'}}});
  if(options.body?.get('upload_phase')==='start')return Response.json({video_id:'456',upload_url:'https://rupload.facebook.com/video-upload/v26.0/456'});
  if(options.body?.get('upload_phase')==='finish'){
   finishes++;assert.equal(options.body.get('title'),body.title);assert.equal(options.body.get('description'),body.description);assert.equal(options.body.get('video_state'),'PUBLISHED');
   return Response.json({success:true});
  }
  throw Error('Requisição inesperada');
 });
 let post=await sendReel(credentials,{size:5},{length:60},body,(id,fields)=>receipts.push({...fields,id}),async()=>({...encoded(),dispose:async()=>{disposed=true;}}));
 assert.equal(disposed,true);assert.equal(receipts[1].uploaded,true);
 let saved=0;
 post=await advance(credentials,post,()=>saved++);assert.equal(finishes,1);
 ready=true;post=await advance(credentials,post,()=>saved++);
 assert.equal(finishes,1);assert.equal(saved,1);assert.equal(post.state,'Em processamento');
 await advance(credentials,post,()=>{});assert.equal(finishes,1);
 published=true;post=await advance(credentials,post,()=>{});assert.equal(post.state,'Publicado');
});

test('rejeita endereço de upload externo sem transmitir token ou vídeo',async t=>{
 let disposed=false,external=0;
 t.mock.method(globalThis,'fetch',async input=>{
  const url=new URL(input);
  if(url.hostname!=='graph.facebook.com')external++;
  return Response.json(url.pathname.endsWith('/video_reels')?{video_id:'456',upload_url:'https://example.com/video-upload/456'}:page);
 });
 await assert.rejects(sendReel(credentials,{size:4},{length:60},body,()=>{},async()=>({...encoded(),dispose:async()=>{disposed=true;}})),/Endereço/);
 assert.equal(external,0);assert.equal(disposed,true);
});

test('não repete publicação quando a resposta cai e preserva arquivo até confirmação',async t=>{
 let finishes=0,removed=0;
 t.mock.method(globalThis,'fetch',async(input,options)=>{
  if(options.method==='GET')return Response.json({status:{video_status:'ready'}});
  finishes++;throw Error('Conexão interrompida');
 });
 const clip={drive:{id:'drive'},posts:{facebook:{id:'456',account:'123',uploaded:true,state:'Em processamento',...body}}};
 const job={targets:['facebook','instagram']};
 const services={facebook:(post,save)=>advance(credentials,post,save),remove:async()=>{removed++;}};
 await reconcile(job,clip,()=>{},services);
 assert.equal(clip.posts.facebook.state,'Confirmação pendente');
 await reconcile(job,clip,()=>{},services);assert.equal(finishes,1);assert.equal(removed,0);
 clip.posts.instagram={state:'Publicado'};
 services.facebook=async post=>({...post,state:'Publicado'});
 await reconcile(job,clip,()=>{},services);assert.equal(removed,1);
});

test('vídeo longo, público ausente e troca de Página bloqueiam antes do upload',async t=>{
 let uploads=0;
 t.mock.method(globalThis,'fetch',async input=>{if(String(input).includes('video_reels'))uploads++;return Response.json(page);});
 await assert.rejects(sendReel(credentials,{size:4},{length:91},body,()=>{},encoded),/90 segundos/);
 await assert.rejects(sendReel(credentials,{size:4},{length:60},{...body,privacy:'private'},()=>{},encoded),/pública/);
 await assert.rejects(sendReel(credentials,{size:4},{length:60},{...body,channel:'999'},()=>{},encoded),/Página.*mudou/);
 assert.equal(uploads,0);
});

test('upload sem confirmação não é publicado na retomada',async t=>{
 let finishes=0;
 t.mock.method(globalThis,'fetch',async(_,options)=>{if(options.method==='POST')finishes++;return Response.json({status:{video_status:'ready'}});});
 const post=await advance(credentials,{id:'456',account:'123',uploaded:false,state:'Em processamento'},()=>{});
 assert.match(post.detail,/sem confirmação/);assert.equal(finishes,0);
});

test('Facebook mantém título e legenda fundamentados no clipe com hashtags completas',()=>{
 const clip={title:'Corte',postSpeech:[{start:0,end:2,text:'Ganhei a corrida no GTA 6!'}]};
 const fields=postFields('facebook',{title:'Título '.repeat(40),description:'Créditos '.repeat(400)},clip,'1',suggestPost({},clip));
 assert.ok(fields.title.length<=100);assert.match(fields.title,/#gta6 #rockstar #corrida/);
 assert.ok(fields.description.length<=2200);assert.match(fields.description,/Ganhei a corrida/);assert.ok(fields.description.endsWith('#jogos'));
});
