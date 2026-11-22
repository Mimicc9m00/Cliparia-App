import {createReadStream,createWriteStream,promises as fs} from 'node:fs';
import https from 'node:https';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {run} from './speech.mjs';
import {withH264} from './encoder.mjs';

const graph='https://graph.facebook.com/v26.0/';
const numeric=id=>typeof id==='string'&&/^\d+$/.test(id);
const maxBytes=1_000_000_000;
const instagramMaxBytes=300_000_000;
const hostedReels=new Map();
export async function finishHostedReel(id,check,{budget=120_000,pause=delay}={}){
 const lease=hostedReels.get(id);
 if(!lease)return;
 const until=Date.now()+budget;
 try{
  while(hostedReels.get(id)===lease){
   await check();
   if(hostedReels.get(id)!==lease||Date.now()>=until)break;
   await pause(Math.min(5000,Math.max(0,until-Date.now())));
  }
 }finally{
  if(hostedReels.get(id)===lease){hostedReels.delete(id);await lease.close().catch(()=>{});}
 }
}
const validToken=value=>typeof value==='string'&&value.length>0&&value.length<=5000&&!/\s/.test(value);
export function invalidToken(){
 return Object.assign(Error('A autorização do Instagram expirou ou foi revogada. Reconecte a conta em Contas. Os cortes continuam salvos.'),{reason:'instagram_token_invalid'});
}
export function accountAccessDenied(){
 return Object.assign(Error('A Meta recusou o acesso deste app ao usuário associado ao token (código 200). Abra o Meta for Developers e conclua qualquer confirmação da conta pendente. Confira também o acesso à Página vinculada.'),{reason:'instagram_account_access_denied',rejected:true});
}
export const instagramReconnectRequired=reason=>['instagram_token_invalid','instagram_account_access_denied'].includes(reason);
const temporaryReadError=error=>error.reason==='instagram_connection_interrupted'||error.temporary===true;
function safeDetail(value,token){
 if(typeof value!=='string'||!value.trim()||/<\/?[a-z!]/i.test(value))return '';
 return (token?value.split(token).join('[token]'):value)
  .replace(/https?:\/\/[^\s]+/gi,'[endereço]')
  .replace(/\b(?:Bearer|OAuth)\s+[\w.-]{12,}/gi,'[token]')
  .replace(/\bEAA[\w.-]{12,}/g,'[token]')
  .replace(/\b(?:access_token|appsecret_proof|upload_token)\s*[:=]\s*["']?[^\s"',;&]+/gi,'[token]')
  .replace(/\s+/g,' ').trim().slice(0,360);
}
const safeCode=value=>/^\d{1,10}$/.test(String(value??''))?String(value):'';
async function metaResponse(url,options,phase,token,request=fetch){
 let response,body;
 try{
  response=await request(url,options);
  body=await response.text();
 }catch(cause){
  const detail=response?'resposta incompleta da Meta (HTTP '+response.status+').':'a conexão com a Meta foi interrompida.';
  throw Object.assign(Error('Instagram · '+phase+': '+detail,{cause}),{
   reason:url instanceof URL&&url.hostname==='rupload.facebook.com'?'instagram_upload_interrupted':'instagram_connection_interrupted'
  });
 }
 let data;
 try{data=JSON.parse(body);}catch{data=null;}
 if(response.ok&&data&&!data.error&&data.success!==false)return data;
 if(response.ok&&!data)throw Object.assign(Error('Instagram · '+phase+': a Meta retornou uma resposta inválida.'),{temporary:true});

 const error=data?.error;
 const debug=data?.debug_info||error?.debug_info;
 let inner;
 try{inner=JSON.parse(debug?.message)?.error;}catch{}
 const code=safeCode(inner?.code??error?.code??data?.error_code??debug?.code);
 const subcode=safeCode(inner?.error_subcode??error?.error_subcode??data?.error_subcode??debug?.error_subcode);
 const trace=inner?.fbtrace_id??error?.fbtrace_id??data?.fbtrace_id??debug?.fbtrace_id??response.headers.get('x-fb-trace-id');
 const tags=['HTTP '+response.status];
 if(code)tags.push('código '+code+(subcode?'/'+subcode:''));
 if(typeof trace==='string'&&/^[A-Za-z0-9_-]{5,100}$/.test(trace))tags.push('fbtrace_id '+trace);

 const details=[inner?.error_user_msg,inner?.message,error?.error_user_msg,error?.message,debug?.message,data?.message,data?.error_description,error];
 if(!data&&/^(?:text\/plain|\s*$)/i.test(response.headers.get('content-type')||'')&&body.length<=500)details.push(body);
 const messages=details.map(value=>safeDetail(value,token)).filter(Boolean);
 const generic=/^Request processing failed\.?$/i;
 const detail=messages.find(message=>!generic.test(message))||messages[0];
 const expired=['102','190'].includes(code)||/error validating access token|session has expired|access token.*expired/i.test(detail||'');
 if(code==='200'&&messages.some(message=>/cannot call api for app .+ on behalf of user/i.test(message)))throw accountAccessDenied();
 const unauthorized=/unauthori[sz]ed user request|insufficient permissions/i.test(detail||'')||['10','200'].includes(code);
 const processingFailed=!expired&&response.status===400&&url instanceof URL&&url.hostname==='rupload.facebook.com'&&
  (debug?.type==='ProcessingFailedError'||generic.test(detail||''));
 const message=expired?'Reconecte o Instagram em Contas com um token válido.':unauthorized
  ?'A Meta recusou a autorização. Confira o token da Página vinculada e a permissão instagram_content_publish.'
  :detail||'A Meta não informou o motivo da recusa.';
 throw Object.assign(Error('Instagram · '+phase+' ('+tags.join(', ')+'): '+message),{
  rejected:response.status>=400&&response.status<500,
  temporary:!expired&&!unauthorized&&(response.status>=500||['1','2'].includes(code)||error?.is_transient===true&&response.status!==429&&!['4','17','341'].includes(code)),
  reason:expired?'instagram_token_invalid':unauthorized?'instagram_upload_unauthorized':processingFailed?'instagram_upload_processing_failed':code?'meta_'+code:undefined
 });
}
async function api(credentials,edge,phase,body){
 const headers={Authorization:'Bearer '+credentials.token};
 const request=()=>metaResponse(graph+edge,{headers,method:body?'POST':'GET',body:body?new URLSearchParams(body):undefined,redirect:'error',signal:AbortSignal.timeout(body?30_000:8_000)},phase,credentials.token);
 if(body)return request();
 for(let attempt=0;;attempt++){
  try{return await request();}
  catch(error){
   if(attempt>=2||!temporaryReadError(error))throw error;
   await delay(400*2**attempt);
  }
 }
}
function containerStatus(credentials,id){return api(credentials,id+'?fields=status_code,status','consultar o Reel');}
function reelCode(link){
 if(typeof link!=='string')return;
 const url=URL.parse(link);
 if(url?.protocol!=='https:'||!['instagram.com','www.instagram.com'].includes(url.hostname)||url.username||url.password||url.port)return;
 return url.pathname.match(/^\/(?:reels?|p)\/([\w-]{1,64})\/?$/)?.[1];
}
export async function findPublishedReel(credentials,link){
 const code=reelCode(link);
 if(!code)throw Error('Cole o link HTTPS do Reel publicado no Instagram.');
 const params=new URLSearchParams({fields:'id,permalink,media_product_type',limit:'50'}),cursors=new Set();
 while(true){
  const page=await api(credentials,credentials.id+'/media?'+params,'conferir o Reel publicado');
  const reel=page.data?.find(item=>item.media_product_type==='REELS'&&reelCode(item.permalink)===code&&numeric(item.id));
  if(reel)return {mediaId:reel.id,link:'https://www.instagram.com/reel/'+code+'/',account:credentials.id};
  const next=page.paging?.cursors?.after;
  if(!page.paging?.next||typeof next!=='string'||!next||cursors.has(next))break;
  cursors.add(next);params.set('after',next);
 }
 throw Error('O Reel ainda não foi encontrado no perfil conectado. Confira se o link é de um Reel publicado nessa conta.');
}
export async function profile(credentials){
 if(!numeric(credentials.id))throw Error('Informe o ID numérico da conta profissional do Instagram.');
 const info=await api(credentials,credentials.id+'?fields=id,username','validar a conta').catch(error=>{
  if(temporaryReadError(error))error.reason='instagram_profile_unavailable';
  throw error;
 });
 if(info.id!==credentials.id||!info.username)throw Error('O token não confirmou a conta profissional informada.');
 return {channel_id:info.id,creator_nickname:'@'+info.username};
}
export async function linkedPageToken(credentials,pageId=''){
 if(pageId){
  if(!numeric(pageId))throw Error('Informe o ID numérico da Página do Facebook.');
  const page=await api(credentials,pageId+'?fields=id,access_token,instagram_business_account{id}','consultar a Página informada');
  if(page.id!==pageId)throw Error('A Meta não confirmou o ID da Página informada.');
  if(!page.instagram_business_account?.id)throw Error('A Meta não mostrou o Instagram vinculado a essa Página para o token usado. Autorize a Página ao gerar o token e confira as permissões.');
  if(page.instagram_business_account.id!==credentials.id)throw Error('Essa Página está vinculada a outro Instagram. Confira o ID profissional e o ID da Página.');
  if(!validToken(page.access_token))throw Error('A Meta não liberou um token para essa Página. Gere um novo token de usuário autorizando a Página.');
  return page.access_token;
 }
 const params=new URLSearchParams({fields:'access_token,instagram_business_account{id}',limit:'100'});
 const cursors=new Set();
 while(true){
  const pages=await api(credentials,'me/accounts?'+params,'consultar a Página vinculada');
  const page=pages.data?.find(item=>item.instagram_business_account?.id===credentials.id);
  if(validToken(page?.access_token))return page.access_token;
  const next=pages.paging?.cursors?.after;
  if(!pages.paging?.next||typeof next!=='string'||!next||cursors.has(next))return null;
  cursors.add(next);
  params.set('after',next);
 }
}

async function tokenRequest(endpoint,params,message,authorization){
 // These requests go only to the Meta Graph API. Do not surface URLs or response text from credential exchanges.
 try{
  const response=await fetch(graph+endpoint+'?'+new URLSearchParams(params),{
   headers:authorization?{Authorization:'Bearer '+authorization}:undefined,redirect:'error',signal:AbortSignal.timeout(30_000)
  });
  const result=await response.json();
  if(response.ok&&!result.error)return result;
 }catch{}
 throw Error(message);
}

export async function durableConnection({id,token,pageId=''},appId,appSecret){
 if(!numeric(id)||!numeric(appId)||!/^[a-f\d]{32}$/i.test(appSecret||'')||!validToken(token)){
  throw Error('Confira o ID profissional, o ID do app Meta, o segredo do app e o token de usuário.');
 }
 if(pageId&&!numeric(pageId))throw Error('Informe o ID numérico da Página do Facebook.');
 const exchange=await tokenRequest('oauth/access_token',{
  grant_type:'fb_exchange_token',client_id:appId,client_secret:appSecret,fb_exchange_token:token
 },'A Meta não conseguiu prolongar a autorização. Gere um token de usuário novo para o mesmo app Meta e confira o ID e o segredo do app.');
 if(!validToken(exchange.access_token))throw Error('A Meta não retornou o token de usuário de longa duração.');
 const pageToken=await linkedPageToken({id,token:exchange.access_token},pageId);
 if(!pageToken)throw Error('A Meta não encontrou a Página na lista. Informe o ID da Página do Facebook ou gere um token que autorize a Página com pages_show_list, pages_read_engagement, instagram_basic e instagram_content_publish.');
 const check=await tokenRequest('debug_token',{input_token:pageToken},'A Meta não confirmou a validade do token da Página.',appId+'|'+appSecret);
 const data=check.data;
 if(data?.is_valid!==true||data.type!=='PAGE'||String(data.app_id)!==appId||data.expires_at!==0){
  throw Error('A Meta não confirmou um token de Página sem vencimento fixo. Confira o app e a Página autorizados.');
 }
 if(Array.isArray(data.scopes)&&!data.scopes.includes('instagram_content_publish')){
  throw Error('A autorização da Página não inclui instagram_content_publish. Marque essa permissão e gere um token novo.');
 }
 const account=await profile({id,token:pageToken});
 return {id,token:pageToken,account:account.creator_nickname,durable:true};
}

// Use HTTP/1.1 for the binary upload and keep stream errors inside the request.
function uploadBinary(url,{body,headers,signal}){
 return new Promise((resolve,reject)=>{
  const request=https.request(url,{method:'POST',headers,signal,agent:false},async response=>{
   body.unpipe(request);
   body.destroy();
   request.end();
   try{
     const chunks=[];let length=0;
     for await(const chunk of response){
      length+=chunk.length;
      if(length>64*1024)throw Error('Resposta de upload excedeu 64 KB.');
      chunks.push(chunk);
     }
     if(!response.complete)throw Error('Resposta de upload incompleta.');
     const text=Buffer.concat(chunks).toString('utf8');
     resolve({status:response.statusCode,ok:response.statusCode>=200&&response.statusCode<300,headers:{get:name=>response.headers[name]},text:async()=>text});
   }catch(error){reject(error);}
  });
  request.on('error',reject);
  request.on('close',()=>body.destroy());
  body.on('error',error=>request.destroy(error));
  body.pipe(request);
 });
}

async function transferReel(credentials,title,reel,upload){
 if(!Number.isSafeInteger(reel.size)||reel.size<1||reel.size>instagramMaxBytes)throw Error('O Reel convertido precisa ter até 300 MB.');
 const container=await api(credentials,credentials.id+'/media','preparar o Reel',{media_type:'REELS',upload_type:'resumable',caption:title,share_to_feed:'true'});
 if(!numeric(container.id)||typeof container.uri!=='string')throw Error('A Meta não retornou um endereço de envio para o Reel.');
 const uri=new URL(container.uri);
 if(uri.origin!=='https://rupload.facebook.com'||!uri.pathname.startsWith('/ig-api-upload/')||uri.pathname.split('/').at(-1)!==container.id||uri.username||uri.password)throw Error('Endereço de envio do Instagram inválido.');
 const body=await reel.stream();
 try{
  const response=await metaResponse(uri,{
   method:'POST',signal:AbortSignal.timeout(20*60_000),
   headers:{Authorization:'OAuth '+credentials.token,offset:'0',file_size:String(reel.size),'Content-Length':String(reel.size),'Content-Type':'application/octet-stream'},
   body
  },'transferir o vídeo',credentials.token,upload);
  if(response.success!==true)throw Error('O Instagram não confirmou a transferência do vídeo.');
 }catch(error){
  if(!['instagram_upload_processing_failed','instagram_upload_interrupted'].includes(error.reason))throw error;
  const status=await containerStatus(credentials,container.id).catch(checkError=>{
   if(checkError.reason==='instagram_token_invalid')throw checkError;
   return null;
  });
  if(['FINISHED','PUBLISHED'].includes(status?.status_code))return container.id;
  const detail=status?.status_code==='ERROR'?safeDetail(status.status,credentials.token):'';
  if(detail)error.message+=' Motivo do contêiner: '+detail+'.';
  error.message+=' Contêiner '+container.id+'.';
  throw error;
 }
 return container.id;
}

export async function sendReel(credentials,source,title,onID,encode=source=>normalize(source,true,true),upload=uploadBinary,{hosted,preferHosted=false}={}){
 const account=await profile(credentials);
 if(credentials.expected&&account.channel_id!==credentials.expected)throw Error('A conta do Instagram mudou. Confirme o perfil antes de enviar.');
 if(!Number.isSafeInteger(source.size)||source.size<1||source.size>maxBytes)throw Error('O Reel precisa ter até 1 GB.');
 const reel=await encode(source);
 let retained=false,disposal;
 const dispose=()=>disposal??=Promise.resolve().then(()=>reel.dispose());
 const receipt=(id,uploadMode)=>{
  const fields={account:credentials.id,...(uploadMode?{uploadMode}:{})};
  onID(id,fields);
  return {state:'Em processamento',id,...fields};
 };
 async function fromURL(compatible,previous){
  let lease,id;
  try{
   if(!Number.isSafeInteger(compatible.size)||compatible.size<1||compatible.size>instagramMaxBytes)throw Error('O Reel convertido precisa ter até 300 MB.');
   lease=await hosted(compatible,()=>{if(id)hostedReels.delete(id);return dispose();});
   const response=await api(credentials,credentials.id+'/media','preparar o Reel por link HTTPS',{media_type:'REELS',video_url:lease.url,caption:title,share_to_feed:'true'});
   if(!numeric(response.id))throw Error('A Meta não retornou o contêiner do Reel por link.');
   id=response.id;
  }catch(error){
   await lease?.close().catch(()=>{});
   if(instagramReconnectRequired(error.reason)||['instagram_upload_unauthorized','instagram_link_unavailable'].includes(error.reason))throw error;
   const problem=previous||Object.assign(Error('Instagram · enviar o vídeo'),{reason:'instagram_upload_processing_failed'});
   const detail=safeDetail(error.message,credentials.token);
   problem.message+=' A tentativa por link HTTPS falhou'+(detail?': '+detail:'.')+' O corte pode ser baixado em Revisar e publicar.';
   throw problem;
  }
  retained=true;hostedReels.set(id,lease);
  return receipt(id,'hosted');
 }
 try{
  if(hosted&&preferHosted&&reel.compatible)return await fromURL(await reel.compatible());
  let id;
  try{id=await transferReel(credentials,title,reel,upload);}
  catch(error){
   if(error.reason==='instagram_upload_interrupted'){
    id=await transferReel(credentials,title,reel,upload);
   }else{
    if(error.reason!=='instagram_upload_processing_failed'||!reel.compatible)throw error;
    const compatible=await reel.compatible();
    try{id=await transferReel(credentials,title,compatible,upload);}
    catch(retry){
     if(retry.reason==='instagram_upload_processing_failed'&&hosted)return await fromURL(compatible,retry);
     if(retry.reason==='instagram_upload_processing_failed')retry.message+=' A Meta também recusou o MP4 de compatibilidade. Você pode baixar o corte em Revisar e publicar e enviá-lo pelo aplicativo do Instagram.';
     throw retry;
    }
   }
  }
  return receipt(id);
 }finally{if(!retained)await dispose();}
}
export async function normalize(source,vertical=false,instagram=false){
 const dir=await fs.mkdtemp(path.join(tmpdir(),'cliparia-reel-'));
 const input=path.join(dir,'original.mp4'),output=path.join(dir,'reel.mp4');
 const fallback=path.join(dir,'reel-compatibilidade.mp4');
 const dispose=async()=>{
  for(const file of [input,output,fallback])await fs.rm(file,{force:true});
  await fs.rmdir(dir);
 };
 let silent=false,videoDuration;
 async function render(file,compatibility=false){
  const [width,height]=compatibility?[720,1280]:[1080,1920];
  const padding=vertical||compatibility?`pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,`:'';
  const filter=`${instagram?'bwdif=mode=send_frame:deint=interlaced,':''}scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,${padding}setsar=1,fps=30${compatibility?',setpts=PTS-STARTPTS':''}`;
  const cpu=['-c:v','libx264','-preset','veryfast','-crf','20',...(instagram?['-x264-params','open-gop=0:scenecut=0']:[])];
  const gpu=['-c:v','h264_nvenc','-preset','p5','-rc','vbr','-cq','19','-b:v','0',...(instagram?['-forced-idr','1','-no-scenecut','1']:[])];
  const audio=silent?['-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-map','0:v:0','-map','1:a:0']:['-map','0:v:0','-map','0:a:0?'];
  const convert=codec=>run('ffmpeg',['-nostdin','-y','-v','error','-i',input,...audio,'-vf',filter,
   ...codec,'-pix_fmt','yuv420p','-maxrate',compatibility?'2500k':'20M','-bufsize',compatibility?'5M':'40M','-g','60','-flags','+cgop',
   ...(compatibility?['-af','aresample=async=1:first_pts=0,apad']:[]),...(silent||compatibility?['-shortest']:[]),
   ...((silent||compatibility)&&videoDuration?['-t',String(videoDuration)]:[]),
   '-c:a','aac','-ar','48000','-ac','2','-b:a',instagram?'120k':'128k','-use_editlist','0','-movflags','+faststart',file]);
  if(compatibility)await convert([...cpu,'-profile:v','main','-level:v','4.0','-bf','0']);
  else await withH264(convert,cpu,undefined,gpu);
  const {size}=await fs.stat(file);
  if(!size||size>maxBytes)throw Error('O Reel convertido excede o tamanho aceito pela Meta.');
  return {size,stream:(start,end)=>createReadStream(file,start===undefined?{}:{start,end})};
 }
 try{
  try{
   await pipeline(await source.stream(),createWriteStream(input));
   if((await fs.stat(input)).size!==source.size)throw Error('Tamanho divergente');
  }catch{
   throw Error('A leitura do arquivo do Reel foi interrompida ou o tamanho está incorreto. Confira o corte e tente novamente.');
  }
  if(instagram){
   const info=JSON.parse(await run('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type,duration','-of','json',input]));
   const video=info.streams?.find(stream=>stream.codec_type==='video');
   videoDuration=Number(video?.duration??info.format?.duration);
   if(!video||!Number.isFinite(videoDuration)||videoDuration<3||videoDuration>900)throw Error('O Reel do Instagram precisa ter vídeo com duração de 3 segundos a 15 minutos.');
   silent=!info.streams.some(stream=>stream.codec_type==='audio');
  }
  return {...await render(output),compatible:()=>render(fallback,true),dispose};
 }catch(error){await dispose();throw error;}
}
export async function advance(credentials,post,save,statusOnly=false){
 if(post.account!==credentials.id)throw Error('Reconecte a mesma conta do Instagram usada para enviar este Reel.');
 const status=await containerStatus(credentials,post.id);
 const current=hostedReels.get(post.id);
 if(current?.delivery)post.delivery=current.delivery();
 if(['PUBLISHED','FINISHED','ERROR','EXPIRED'].includes(status.status_code)){
  const hosted=hostedReels.get(post.id);
  if(hosted){hostedReels.delete(post.id);await hosted.close().catch(()=>{});}
 }
 if(status.status_code==='PUBLISHED')return {...post,state:'Publicado',detail:''};
 if(status.status_code==='ERROR'||status.status_code==='EXPIRED'){
  let detail=safeDetail(status.status,credentials.token)||'O Instagram não conseguiu preparar o Reel.';
  if(post.uploadMode!=='hosted')return {...post,state:'Falhou',detail};
  const delivery=post.delivery;
  if(delivery){
   if(!delivery.requests)detail+=' Nenhuma solicitação de vídeo foi registrada no link.';
   else if(delivery.bytes===delivery.size)detail+=' O Cliparia serviu o arquivo completo pelo link.';
   else detail+=' O link serviu '+delivery.bytes+' de '+delivery.size+' bytes do vídeo.';
  }
  return {...post,state:'Falhou',reason:'instagram_hosted_media_failed',detail};
 }
 if(statusOnly||status.status_code!=='FINISHED'||post.publishRequested)return post;
 post.publishRequested=true;
 save();
 try{
  const published=await api(credentials,credentials.id+'/media_publish','publicar o Reel',{creation_id:post.id});
  if(!numeric(published.id))throw Error('A Meta não devolveu o ID da publicação.');
  return {...post,state:'Publicado',mediaId:published.id,detail:''};
 }catch(error){
  if(instagramReconnectRequired(error.reason)&&error.rejected){
   delete post.publishRequested;
   save();
   throw error;
  }
  return {...post,state:error.rejected?'Falhou':'Confirmação pendente',detail:error.message};
 }
}
