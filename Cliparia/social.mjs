import * as instagram from './instagram.mjs';
import * as facebook from './facebook.mjs';
import {classifyYouTubeVideo} from './youtube-queue.mjs';
import {trendHashtagScores} from './post-copy.mjs';
import {hostReel} from './reel-host.mjs';
import {tunnelExecutable} from './mobile.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {seal,unseal,cloudKey} from './cloud-state.mjs';
const publicURL=process.env.CLIPARIA_PUBLIC_URL;
export const base=publicURL?new URL(publicURL).origin:'http://127.0.0.1:43871';
if(publicURL&&!base.startsWith('https://'))throw Error('CLIPARIA_PUBLIC_URL precisa usar HTTPS.');
const redirect=p=>p!=='tiktok'?base+'/':base+'/oauth/callback';
const tt='https://open.tiktokapis.com/v2/';
const urls={drive:'https://oauth2.googleapis.com/token',youtube:'https://oauth2.googleapis.com/token',tiktok:tt+'oauth/token/'};
const pending=new Map();
let vault={}, location;
function protect(data,mode){
 if(process.platform!=='win32'){
  const key=cloudKey();
  return mode==='Protect'?seal(JSON.parse(data),key):Buffer.from(JSON.stringify(unseal(data,key)));
 }
 const script="Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::"+mode+"($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))";
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{input:data.toString('base64'),encoding:'utf8',windowsHide:true});
 if(r.status!==0)throw Error('Falha ao acessar o cofre do usuário Windows.');
 return Buffer.from(r.stdout.trim(),'base64');
}
export function openVault(dir){
 location=path.join(dir,'contas.dat');
 vault=fs.existsSync(location)?JSON.parse(protect(fs.readFileSync(location),'Unprotect')):{};
}
export function cloudVault(key,onlyDrive=false){
 if(!vault.drive?.tokens?.refresh)throw Error('Reconecte o Google Drive antes de preparar a execução na nuvem.');
 return seal(onlyDrive?{drive:vault.drive}:vault,key);
}
function save(){
 fs.writeFileSync(location+'.tmp',protect(Buffer.from(JSON.stringify(vault)),'Protect'));fs.renameSync(location+'.tmp',location);
}
export function accounts(){return Object.fromEntries([...Object.keys(urls),'instagram','facebook'].map(p=>[p,{configured:!!vault[p]?.id,connected:['instagram','facebook'].includes(p)?!!vault[p]?.token&&!vault[p]?.needsReconnect:!!vault[p]?.tokens,needsReconnect:!!vault[p]?.needsReconnect,account:vault[p]?.account||vault[p]?.tokens?.account||'',scopes:vault[p]?.tokens?.scopes??(vault[p]?.tokens&&p==="tiktok"?"video.publish":""),...(p==='instagram'?{profileId:vault[p]?.id,durable:!!vault[p]?.durable,reconnectReason:vault[p]?.reconnectReason}:p==='tiktok'?{inboxAccount:vault[p]?.tokens?.inboxAccount}:{})}]))}
export function config(p,id,secret){if(!id||!secret)throw Error('Preencha as duas credenciais.');if(vault[p]?.id!==id||vault[p]?.secret!==secret){vault[p]={id,secret};save();}}
export function disconnect(p){if(['instagram','facebook'].includes(p))delete vault[p];else if(vault[p])delete vault[p].tokens;save();}
export async function connectInstagram(id,token,appId='',appSecret='',pageId=''){
 if(!token||token.length>5000||/\s/.test(token))throw Error('Informe um token de acesso da Meta com permissão de publicação.');
 if(appId||appSecret){
  vault.instagram=await instagram.durableConnection({id,token,pageId},appId,appSecret);
 }else{
  const account=await instagram.profile({id,token});
  vault.instagram={id,token,account:account.creator_nickname};
 }
 save();
}
export function instagramAvailable(){return !!vault.instagram?.token&&!vault.instagram.needsReconnect;}
export function assertInstagramReady(){
 if(!vault.instagram?.token)throw Error('Conecte o Instagram em Contas.');
 if(vault.instagram.needsReconnect)throw vault.instagram.reconnectReason==='instagram_account_access_denied'?instagram.accountAccessDenied():instagram.invalidToken();
}
export const instagramReconnectRequired=instagram.instagramReconnectRequired;
export const checkInstagram=()=>withInstagram(instagram.profile,true);
async function withInstagram(action,verify=false){
 const stored=vault.instagram;
 if(!verify||!stored?.token)assertInstagramReady();
 const credentials=stored.pageToken?{...stored,token:stored.pageToken}:stored;
 try{
  const result=await action(credentials);
  if(verify&&vault.instagram===stored&&stored.needsReconnect){
   delete stored.needsReconnect;delete stored.reconnectReason;save();
  }
  return result;
 }
 catch(error){
  if(!instagramReconnectRequired(error.reason))throw error;
  if(vault.instagram===stored&&(!stored.needsReconnect||stored.reconnectReason!==error.reason)){
   stored.needsReconnect=true;stored.reconnectReason=error.reason;save();
  }
  throw error.reason==='instagram_token_invalid'?instagram.invalidToken():error;
 }
}
async function instagramPublishingCredentials(credentials){
 if(credentials.pageToken||credentials.durable)return credentials;
 const pageToken=await instagram.linkedPageToken(credentials).catch(()=>null);
 if(vault.instagram!==credentials)throw Error('A conexão com o Instagram mudou. Confirme o perfil antes de enviar.');
 if(!pageToken||pageToken===credentials.token)return credentials;
 const pageCredentials={...credentials,token:pageToken};
 await instagram.profile(pageCredentials);
 if(vault.instagram!==credentials)throw Error('A conexão com o Instagram mudou. Confirme o perfil antes de enviar.');
 credentials.pageToken=pageToken;
 save();
 return pageCredentials;
}
export function instagramStatus(post,save,statusOnly){return withInstagram(credentials=>instagram.advance(credentials,post,save,statusOnly));}
export const finishHostedInstagram=instagram.finishHostedReel;
export function findPublishedInstagramReel(link){return withInstagram(credentials=>instagram.findPublishedReel(credentials,link));}
export async function connectFacebook(id,token){
 token=token||vault.instagram?.token;
 if(!token||token.length>5000||/\s/.test(token))throw Error('Informe um token da Meta ou conecte o Instagram para usar a autorização salva.');
 vault.facebook=await facebook.connect(id,token);save();
}
export function facebookNeedsReconnect(){return !!vault.facebook?.needsReconnect;}
async function withFacebook(action){
 const credentials=vault.facebook;
 if(!credentials?.token)throw Error('Conecte sua Página do Facebook em Contas.');
 if(credentials.needsReconnect)throw facebook.invalidToken();
 try{return await action(credentials);}
 catch(error){
  if(error.reason==='facebook_token_invalid'&&vault.facebook===credentials&&!credentials.needsReconnect){
   credentials.needsReconnect=true;
   save();
  }
  throw error;
 }
}
export function facebookStatus(post,save,statusOnly){return withFacebook(credentials=>facebook.advance(credentials,post,save,statusOnly));}
const grantedScopes=value=>typeof value==='string'?value.split(/[ ,]+/).filter(Boolean):[];
const tiktokScope=mode=>mode==='inbox'?'video.upload':'video.publish';
export function assertTikTokMode(mode='direct'){
 if(!['direct','inbox'].includes(mode))throw Error('Escolha o modo de envio do TikTok.');
 const account=accounts().tiktok;
 if(!account.connected)throw Error('Conecte o TikTok em Contas.');
 const scope=tiktokScope(mode);
 if(!grantedScopes(account.scopes).includes(scope)){
  throw Object.assign(Error(mode==='inbox'
   ?'O TikTok ainda não autorizou video.upload. Em Contas → TikTok → Alterar permissões, selecione Finalizar no celular.'
   :'O TikTok ainda não autorizou video.publish para publicação direta.'),{reason:'scope_not_authorized'});
 }
 return mode;
}
export function tiktokInboxProfile(){
 assertTikTokMode('inbox');
 const tokens=vault.tiktok.tokens;
 if(!tokens.inboxAccount){tokens.inboxAccount=crypto.randomUUID();save();}
 return {channel_id:tokens.inboxAccount,creator_nickname:'Conta TikTok conectada'};
}
export function assertTikTokInboxAccount(channel){
 assertTikTokMode('inbox');
 if(!channel||vault.tiktok.tokens.inboxAccount!==channel)throw Error('A conexão do TikTok mudou. Confirme a conta na configuração da fila.');
}
export async function read(res,{tiktokMode}={}){
 const j=await res.json().catch(()=>({}));
 // TikTok OAuth responds with {error: 'invalid_request', error_description: '...'}.
 // Other TikTok APIs respond with {error: {code: '...', message: '...'}}.
 // Both formats must be recognized, including when an API replies with HTTP 200.
 const googleErrors=Array.isArray(j.error?.errors)?j.error.errors:[];
 const googleReason=googleErrors.find(e=>e.reason==='uploadLimitExceeded')?.reason||googleErrors[0]?.reason;
 const reason=typeof j.error==='string'?j.error:googleReason||j.error?.code;
 if(!res.ok||(reason&&reason!=='ok')){
  const description=j.error_description||j.error?.message||j.message;
  const detail=description||(reason&&reason!=='ok'?reason:'HTTP '+res.status);
  const logId=j.error?.log_id||j.log_id;
  const trace=typeof logId==='string'&&/^[a-zA-Z0-9_-]{5,100}$/.test(logId)?' [TikTok log_id: '+logId+']':'';
 const uploadLimit=reason==='uploadLimitExceeded'||/the user has exceeded the number of videos they may upload/i.test(detail);
 const error=Error(uploadLimit?'O YouTube atingiu o limite de uploads da conta. O corte permanece salvo.':'Erro de autorização/API ('+(reason&&reason!=='ok'?reason:'HTTP '+res.status)+'): '+detail+trace);
  if(reason==='unaudited_client_can_only_post_to_private_accounts')error.message=tiktokMode==='inbox'
   ?'O TikTok devolveu uma restrição de publicação direta ao pedido de envio para a caixa de entrada. Confira se Upload (video.upload) está aprovado para o app e para a conta conectada.'+trace
   :'O TikTok recusou a publicação direta porque o aplicativo ainda não passou pela auditoria. Para testar esse modo, a conta deve estar privada e você deve escolher a visibilidade Somente eu (SELF_ONLY). Alterar apenas a visibilidade do vídeo não basta. Outra opção é Finalizar no TikTok, com a permissão video.upload aprovada e autorizada, para concluir a publicação no aplicativo TikTok.'+trace;
  if(reason==='scope_not_authorized'&&tiktokMode==='inbox')error.message='O TikTok não confirmou a permissão video.upload para a caixa de entrada. Confira a aprovação de Upload e reconecte em Finalizar no celular.'+trace;
  error.reason=uploadLimit?'uploadLimitExceeded':reason;
  error.httpStatus=res.status;
  throw error;
 }
 return j;
}
export function login(p,mode='direct'){
 const c=vault[p];if(!c?.id)throw Error('Configure as credenciais do aplicativo primeiro.');
 // PKCE: verificador novo a cada autenticação, com 64 caracteres permitidos pelo RFC 7636.
 const state=crypto.randomUUID(),verifier=crypto.randomBytes(32).toString('hex');
 const scope=mode==='inbox'?'video.upload':mode==='both'?'video.publish,video.upload':'video.publish';
 pending.set(state,{p,verifier,scope,expires:Date.now()+600000});
 const params={redirect_uri:redirect(p),response_type:'code',state,code_challenge_method:'S256'};
 const digest=crypto.createHash('sha256').update(verifier);
 if(p!=='tiktok')Object.assign(params,{client_id:c.id,scope:p==='drive'?'https://www.googleapis.com/auth/drive.file':'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',access_type:'offline',prompt:'select_account consent',code_challenge:digest.digest('base64url')});
 else {
  // TikTok Desktop exige SHA-256 em HEX (Google exige base64url).
  const challenge=digest.digest('hex');
  if(verifier.length<43||verifier.length>128||!/^[A-Za-z0-9._~-]+$/.test(verifier)||!/^[0-9a-f]{64}$/.test(challenge))throw Error('PKCE do TikTok inválido.');
  Object.assign(params,{client_key:c.id,scope,code_challenge:challenge});
 }
 return (p!=='tiktok'?'https://accounts.google.com/o/oauth2/v2/auth?':'https://www.tiktok.com/v2/auth/authorize/?')+new URLSearchParams(params);
}
async function grant(p,body,requested){
 const c=vault[p];
 const previous=c.tokens;
 const data=new URLSearchParams({...body,[p!=='tiktok'?'client_id':'client_key']:c.id,client_secret:c.secret});
 // Não imprima data: inclui client_secret, código OAuth, code_verifier e refresh_token.
 const j=await read(await fetch(urls[p],{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},body:data}));
 if(!j.access_token)throw Error('A API não retornou access_token. Verifique as credenciais, o Redirect URI e o ambiente do aplicativo TikTok.');
 const refresh=body.grant_type==='refresh_token';
 if(vault[p]!==c||refresh&&c.tokens!==previous){
  if(refresh)return;
  throw Error('A configuração da conta mudou durante a conexão. Tente novamente.');
 }
 let scopes=j.scope||requested||c.tokens?.scopes||'';
 if(p==='tiktok'){
  const actual=grantedScopes(typeof j.scope==='string'?j.scope:refresh?accounts().tiktok.scopes:'');
  const missing=grantedScopes(requested).filter(scope=>!actual.includes(scope));
  if(!refresh&&missing.length){
   throw Error('O TikTok não concedeu '+missing.join(' e ')+'. Confira as permissões aprovadas no TikTok for Developers e autorize o modo escolhido novamente.');
  }
  scopes=actual.join(',');
 }
 c.tokens={account:refresh?previous?.account:'',scopes,access:j.access_token,refresh:j.refresh_token||(refresh?previous?.refresh:undefined),expires:Date.now()+j.expires_in*1000,
  ...(p==='tiktok'?{inboxAccount:refresh?previous?.inboxAccount:crypto.randomUUID()}:{})};save();
}
export async function callbackLogin(q){
 const state=q.get('state'),item=pending.get(state);pending.delete(state);
 if(q.has('error'))throw Error('TikTok não autorizou o acesso: '+(q.get('error_description')||q.get('error')||'erro desconhecido'));
 if(!item||item.expires<Date.now()||!q.get('code'))throw Error('Conexão cancelada ou expirada. Inicie a conexão novamente.');
 await grant(item.p,{grant_type:'authorization_code',code:q.get('code'),redirect_uri:redirect(item.p),code_verifier:item.verifier},item.scope);
 if(item.p==='drive'){
  const tokens=vault.drive.tokens;
  try{
   const profile=await read(await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',{headers:{Authorization:'Bearer '+tokens.access},signal:AbortSignal.timeout(8000)}));
   if(vault.drive.tokens===tokens){tokens.account=profile.user?.emailAddress||'';save();}
  }catch{/* Login remains usable if account display information is unavailable. */}
 }
}
const refreshing=new Map();
export async function auth(p){
 const t=vault[p]?.tokens;if(!t)throw Error('Conecte a conta em Contas.');
 if(t.expires<Date.now()+60000){
  if(!refreshing.has(p)){
   const refresh=grant(p,{grant_type:'refresh_token',refresh_token:t.refresh})
    .catch(e=>{if(e.reason==='invalid_grant'&&vault[p]?.tokens===t){disconnect(p);throw Error('Autorização expirada. Reconecte o perfil em Contas.');}throw e;})
    .finally(()=>refreshing.delete(p));
   refreshing.set(p,refresh);
  }
  await refreshing.get(p);
 }
 return {Authorization:'Bearer '+vault[p].tokens.access};
}
async function tik(endpoint,body,tiktokMode,channel){
 const headers={...await auth('tiktok'),'Content-Type':'application/json'};
 if(tiktokMode&&(endpoint==='video/init'||endpoint==='inbox/video/init'))assertTikTokMode(tiktokMode);
 if(channel)assertTikTokInboxAccount(channel);
 return (await read(await fetch(tt+'post/publish/'+endpoint+'/',{method:'POST',headers,body:JSON.stringify(body),...(endpoint==='status/fetch'?{signal:AbortSignal.timeout(15000)}:{})}),{tiktokMode})).data;
}
export async function creator(p){
 if(p==='instagram')return withInstagram(instagram.profile);
 if(p==='facebook')return withFacebook(facebook.profile);
 if(p==='tiktok')return tik('creator_info/query',{});
 const j=await read(await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',{headers:await auth(p)}));
 if(!j.items?.length)throw Error('Crie um canal no YouTube para enviar os cortes.');
 return {creator_nickname:j.items[0].snippet.title,channel_id:j.items[0].id,privacy_level_options:['private','unlisted','public']};
}
export async function publish(p,file,clip,b,onID){
 const local=typeof file==='string';
 const size=local?fs.statSync(file).size:file.size;
 const stream=async(start,end)=>local?fs.createReadStream(file,start===undefined?{}:{start,end}):file.stream(start,end);
 if(!b.consent)throw Error('Confirme o envio.');
 if(p==='instagram')return withInstagram(async credentials=>instagram.sendReel({...await instagramPublishingCredentials(credentials),expected:b.channel},{size,stream},String(b.title||clip.title).slice(0,2200),onID,undefined,undefined,{
  hosted:(reel,dispose)=>hostReel(reel,tunnelExecutable(path.dirname(location)),dispose,{publicOrigin:publicURL?base:undefined,keepAlive:process.env.CLIPARIA_CLOUD_BATCH!=='1'}),preferHosted:b.preferInstagramLink===true
 }));
 if(p==='facebook')return withFacebook(credentials=>facebook.sendReel(credentials,{size,stream},clip,b,onID));
 const tiktokMode=p==='tiktok'?assertTikTokMode(b.mode):undefined;
 const inbox=tiktokMode==='inbox';
 const who=inbox?null:await creator(p);
 if(!inbox&&(!who.privacy_level_options.includes(b.privacy)||!b.title?.trim()))throw Error('Revise título, visibilidade e autorização.');
 if(p==='youtube'){
  if(b.channel&&who.channel_id!==b.channel)throw Error('A conta do YouTube mudou. Revise o corte e confirme o canal.');
  const r=await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',{method:'POST',headers:{...await auth(p),'Content-Type':'application/json','X-Upload-Content-Type':'video/mp4'},body:JSON.stringify({snippet:{title:b.title.slice(0,100),description:String(b.description||'').slice(0,1250),categoryId:'22',...(b.youtubeMarker?{tags:[b.youtubeMarker]}:{})},status:{privacyStatus:b.privacy,selfDeclaredMadeForKids:!!b.kids}})});
  if(!r.ok)await read(r);
  onID(null);
  const j=await read(await fetch(r.headers.get('location'),{method:'PUT',headers:{'Content-Type':'video/mp4','Content-Length':String(size)},duplex:'half',body:await stream()}));
  return {state:'Enviado',id:j.id};
 }
 if(!inbox&&clip.length>who.max_video_post_duration_sec)throw Error('O corte excede a duração permitida para essa conta.');
 const step=Math.min(size,16*1024*1024),count=Math.floor(size/step);
 const {publish_id,upload_url}=await tik(inbox?'inbox/video/init':'video/init',{...(inbox?{}:{post_info:{title:b.title,privacy_level:b.privacy,disable_comment:who.comment_disabled||!b.comment,disable_duet:who.duet_disabled||!b.duet,disable_stitch:who.stitch_disabled||!b.stitch,brand_content_toggle:!!b.brand,brand_organic_toggle:!!b.own}}),source_info:{source:'FILE_UPLOAD',video_size:size,chunk_size:step,total_chunk_count:count}},tiktokMode,inbox?b.channel:undefined);
 onID(publish_id,{mode:tiktokMode});
 for(let i=0;i<count;i++){
  const start=i*step,end=i===count-1?size-1:start+step-1;
  const r=await fetch(upload_url,{method:'PUT',headers:{'Content-Type':'video/mp4','Content-Length':String(end-start+1),'Content-Range':'bytes '+start+'-'+end+'/'+size},body:await stream(start,end),duplex:'half'});
  if(!r.ok)throw Error('Falha ao transferir o vídeo. HTTP '+r.status);
 }
 return {state:'Em processamento',id:publish_id,mode:tiktokMode};
}
export async function postStatus(id,mode){
 const j=await tik('status/fetch',{publish_id:id},mode);
 return {id,state:j.status==='PUBLISH_COMPLETE'?'Publicado':j.status==='SEND_TO_USER_INBOX'?'Abra a caixa de entrada do TikTok':j.status==='FAILED'?'Falhou':'Em processamento',detail:j.fail_reason||''};
}


export async function youtubeStatus(id){
 const u=new URL('https://www.googleapis.com/youtube/v3/videos');
 u.search=new URLSearchParams({id,part:'processingDetails,status'});
 const j=await read(await fetch(u,{headers:await auth('youtube')}));
 const v=j.items?.[0];
 if(!v)throw Error('O canal conectado não confirmou esse vídeo.');
 return classifyYouTubeVideo({...v,id});
}

let gamingHashtags;
export async function youtubeGamingHashtags(){
 if(!vault.youtube?.tokens)return {};
 if(!gamingHashtags||Date.now()>=gamingHashtags.until){
  const params=new URLSearchParams({part:'snippet',chart:'mostPopular',regionCode:'BR',videoCategoryId:'20',maxResults:'30',fields:'items(snippet(title,description))'});
  const promise=(async()=>{
   const headers=await auth('youtube');
   const response=await fetch('https://www.googleapis.com/youtube/v3/videos?'+params,{headers,signal:AbortSignal.timeout(8_000)});
   if(!response.ok)return {};
   const data=await response.json();
   return trendHashtagScores(data.items||[]);
  })().catch(()=>({}));
  gamingHashtags={until:Date.now()+60*60_000,promise};
 }
 return gamingHashtags.promise;
}

let uploadCatalog;
export async function youtubeUploads(expectedChannel,refresh=false){
 const headers=await auth('youtube');
 if(uploadCatalog?.authorization!==headers.Authorization||refresh&&!uploadCatalog?.loading||Date.now()>=(uploadCatalog?.until||0)&&!uploadCatalog?.loading){
  const entry={authorization:headers.Authorization,loading:true};
  uploadCatalog=entry;
  const get=(edge,params)=>fetch('https://www.googleapis.com/youtube/v3/'+edge+'?'+new URLSearchParams(params),{headers,signal:AbortSignal.timeout(30_000)}).then(read);
  entry.promise=(async()=>{
   const channels=await get('channels',{part:'contentDetails',mine:'true'});
   const channel=channels.items?.[0],playlistId=channel?.contentDetails?.relatedPlaylists?.uploads;
   if(!channel?.id||!playlistId)throw Error('Não foi possível identificar a lista de uploads do canal do YouTube.');
   const ids=new Set(),pages=new Set();
   let pageToken;
   do{
    if(pageToken)pages.add(pageToken);
    const page=await get('playlistItems',{part:'contentDetails',playlistId,maxResults:'50',...(pageToken?{pageToken}:{})});
    if(!Array.isArray(page.items)||pages.has(page.nextPageToken))throw Error('O YouTube devolveu uma lista de uploads incompleta.');
    for(const item of page.items)if(item.contentDetails?.videoId)ids.add(item.contentDetails.videoId);
    pageToken=page.nextPageToken;
   }while(pageToken);
   const all=[...ids],videos=[];
   for(let i=0;i<all.length;i+=50){
    const page=await get('videos',{id:all.slice(i,i+50).join(','),part:'snippet,contentDetails,fileDetails,status,processingDetails'});
    if(!Array.isArray(page.items))throw Error('O YouTube devolveu dados incompletos dos vídeos.');
    videos.push(...page.items.filter(v=>v.snippet?.channelId===channel.id));
   }
   return {channel:channel.id,videos};
  })().then(result=>{entry.until=Date.now()+2*60_000;return result;},error=>{entry.until=Date.now()+60_000;throw error;}).finally(()=>{entry.loading=false;});
 }
 const catalog=await uploadCatalog.promise;
 if(expectedChannel&&catalog.channel!==expectedChannel)throw Error('O canal do YouTube mudou. Confira a configuração da fila.');
 return catalog;
}
