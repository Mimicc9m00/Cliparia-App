import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import * as drive from './drive.mjs';
import * as social from './social.mjs';
import {reconcile,hasPendingPublication,refreshTikTok,tiktokInboxNotified} from './cleanup.mjs';
import {applyPanelCommands} from './cloud-panel.mjs';
import {stopLive} from './live.mjs';
import {postFields,postSpeech,suggestPost,applyPostCopy,refreshPostCopy,queuePostCopy,validatePostDraft,postText} from './post-copy.mjs';
import {needsRecoveredCopy,recoverPostCopy} from './recovered-copy.mjs';
import {generate,minimum,previewSource,sourceURL,sourceInfo,trimClip,recordingPath} from './media.mjs';
import {createContinuous} from './continuous.mjs';
import {createGenerationHistory} from './generation-history.mjs';
import {createPublicationMemory,createAutoPublisher,retryablePost,automaticPlatforms,publicationPlatforms,clipTargets,awaitingPublication,publicationQueue,shufflePublications,describeQueue,tiktokInboxAvailable} from './publishing.mjs';
import {installModel,modelAvailable,run,transcribe} from './speech.mjs';
import {screenClip,assertScreened,sexualText,safetyVersion} from './safety.mjs';
import {networkOptions,startPair,stopPair,pairingQR,tunnelExecutable} from './mobile.mjs';
import {transferInterrupted} from './remote.mjs';
import {classifyYouTubeVideo,matchYouTubeClip,youtubeMarker} from './youtube-queue.mjs';
import {exportBackup,readBackup,mergeBackup,backupLimit} from './backup.mjs';
import {reelRoute,servePublicReel} from './reel-host.mjs';
import {openJobHistory} from './job-history.mjs';
import {cloudKey,collectCloudFiles,seal} from './cloud-state.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const dir=process.env.CLIPARIA_DATA||path.join(process.env.LOCALAPPDATA||os.homedir(),'Cliparia');
const cloudBatch=process.env.CLIPARIA_CLOUD_BATCH==='1';
fs.mkdirSync(dir,{recursive:true});
if(!cloudBatch&&fs.existsSync(path.join(dir,'cloud-detached')))throw Error('Esta base foi transferida para o lote na nuvem. Use outra pasta de dados para evitar envios duplicados.');
social.openVault(dir);
const history=openJobHistory(path.join(dir,'lives.json'));
const {jobs}=history;
const generationHistory=createGenerationHistory(path.join(dir,'cortes-gerados.json'),jobs);
const publicationMemory=createPublicationMemory(path.join(dir,'publicacoes.json'));
publicationMemory.remember(jobs);
function save(){publicationMemory.remember(jobs);history.save();}
async function checkpointCloudBatch(){
 await drive.writeCloudState(process.env.CLIPARIA_CLOUD_FILE_ID,seal({version:1,running:true,files:collectCloudFiles(dir)},cloudKey()));
}
function recover(){
 for(const j of jobs){
  if(j.running||j.resumeOnRestart){
   j.resumeOnRestart=!j.stopRequested&&!j.continuousId&&j.scanMode==='vod';
   j.running=false;j.live=false;j.progress=null;j.stage=j.stopRequested?'Clipagem interrompida.':j.continuousId?'Interrompida · aguardando a fila contínua':'Análise interrompida. Envie o link novamente.';
   j.stopRequested=false;
   if(/^[a-f\d-]{36}$/i.test(j.id)){
    try{fs.rmSync(recordingPath(dir,j.id),{force:true});}catch(e){console.error('Falha ao limpar uma captura temporária:',e.code);}
   }
  }
  for(const c of j.clips){
   for(const post of Object.values(c.posts))if(post.state==='Enviando')post.state=post.id?'Em processamento':'Envio interrompido. Confira o perfil.';
   if(awaitingPublication(c)||!Object.keys(c.posts).length)refreshPostCopy(j,c);
  }
 }
 save();
}
function fail(msg){throw Error(msg);}
async function body(req){
 let text='';for await(const chunk of req){text+=chunk;if(text.length>13000)fail('Dados muito grandes.');}
 return JSON.parse(text||'{}');
}
async function backupBody(req){
 const chunks=[];
 let size=0;
 for await(const chunk of req){
  size+=chunk.length;
  if(size>backupLimit)fail('O arquivo de backup excede 32 MB.');
  chunks.push(chunk);
 }
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,''));}
 catch{fail('O arquivo selecionado não é um backup JSON válido.');}
}
function json(res,data){res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));}
function findClip(id,i){
 const job=jobs.find(j=>j.id===id),clip=job?.clips[Number(i)];
 if(!clip?.file)fail('Corte indisponível.');
 return {job,clip,file:path.join(dir,job.id,clip.file)};
}
function clipAvailable(job,clip){
 return clip.drive?!clip.drive.removed:fs.existsSync(path.join(dir,job.id,clip.file));
}
async function serveVideo(req,res,file,clip){
 res.setHeader('Cache-Control','private, no-store');
 if(clip.drive){
  if(clip.drive.removed)fail(clip.drive.trashed?'O corte está na lixeira do Drive.':'O corte já foi excluído do Drive.');
  const controller=new AbortController();
  const disconnect=()=>{if(!res.writableFinished)controller.abort();};
  res.once('close',disconnect);
  try{
   const r=await drive.media(clip.drive.id,req.headers.range,controller.signal);res.statusCode=r.status;
   for(const k of ['content-type','content-range','accept-ranges'])if(r.headers.has(k))res.setHeader(k,r.headers.get(k));
   if(!r.headers.has('content-encoding')||r.headers.get('content-encoding').toLowerCase()==='identity'){
    if(r.headers.has('content-length'))res.setHeader('content-length',r.headers.get('content-length'));
   }
   await pipeline(drive.mediaChunks(r),res).catch(()=>res.destroy());
  }finally{res.off('close',disconnect);}
  return;
 }
 const size=fs.statSync(file).size;let start=0,end=size-1;
 const m=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
 if(m){
  start=Number(m[1]);end=Math.min(end,m[2]?Number(m[2]):end);
  if(start>end){res.writeHead(416,{'Content-Range':'bytes */'+size});return res.end();}
  res.statusCode=206;res.setHeader('Content-Range','bytes '+start+'-'+end+'/'+size);
 }
 res.setHeader('Content-Type','video/mp4');res.setHeader('Accept-Ranges','bytes');res.setHeader('Content-Length',end-start+1);
 return pipeline(fs.createReadStream(file,{start,end}),res).catch(()=>res.destroy());
}
const editing=new Set();
const checkingSafety=new Map();
const runningJobs=new Map();
function historyBusy(job){
 return job.running||job.clips.some(c=>awaitingPublication(c)||editing.has(c)||checkingSafety.has(c)||active.has(c)||Object.values(c.posts||{}).some(post=>post.state==='Enviando'));
}
function clearHistory(scope,id){
 if(!['all','studio','continuous'].includes(scope))fail('Histórico inválido.');
 const belongs=job=>(scope==='all'||(scope==='continuous')===!!job.continuousId)&&(!id||job.id===id);
 const entries=jobs.filter(belongs);
 if(id&&!entries.length)fail('Tarefa não encontrada.');
 if(id&&historyBusy(entries[0]))fail('Aguarde os trabalhos em andamento e retire os cortes da fila de postagem antes de apagar.');
 const removable=new Set(entries.filter(job=>!historyBusy(job)));
 for(let i=jobs.length-1;i>=0;i--)if(removable.has(jobs[i]))jobs.splice(i,1);
 if(removable.size)save();
 return {removed:removable.size,kept:entries.length-removable.size};
}
function cancelJob(id){
 const job=jobs.find(j=>j.id===id),controller=runningJobs.get(id);
 if(!job||!controller)fail('Não há clipagem em andamento nessa tarefa.');
 if(controller.signal.aborted)return;
 if(job.continuousId)continuous.markStopped(job.continuousId,job.mediaKey);
 job.stopRequested=true;
 job.stage='Parando a clipagem…';
 save();
 controller.abort(new DOMException('Clipagem interrompida.','AbortError'));
}

let starting=false,previewing=false;
const assets={'/':['index.html','text/html'],'/ui.js':['ui.js','text/javascript'],'/style.css':['style.css','text/css']};
const automationToken=process.env.CLIPARIA_AUTOMATION_TOKEN||'';
const automationRoutes=['/api/automation/continuous','/api/automation/posting'];
const automationDigest=value=>crypto.createHash('sha256').update(value).digest();
const automationAuthorization=/^[a-f\d]{64}$/i.test(automationToken)?automationDigest('Bearer '+automationToken):null;
const backgroundRoutes=new Set(['/api/posting/add','/api/publish','/api/safety/check','/api/publications/check','/api/kwai/confirm','/api/instagram/confirm','/api/posting/check-youtube']);
const localReviewOnly=new Set(['/api/stop','/api/history/remove','/api/history/clear','/api/drive/trash']);
const mobileRoutes=new Set([...Object.keys(assets),...backgroundRoutes,...localReviewOnly,'/api/state','/api/posting/remove','/api/posting/shuffle','/api/posting/enable','/api/posting/countdown','/api/posting/restart-countdown','/api/posting/clear-countdown','/api/posting/configure','/api/posting/disable-platform','/api/posting/retry-youtube','/api/post-copy','/api/posting/copy','/api/creator','/api/status','/api/tiktok/inbox-missing','/api/drive/restore']);
async function state(mobile){
 const accounts=social.accounts();
 const published=publicationMemory.publishedClips();
 const posting={...publicationMemory.status(),...publicationMemory.automaticSettings(),platforms:automaticPlatforms,overview:describeQueue(jobs,publicationMemory,accounts,clip=>editing.has(clip)||checkingSafety.has(clip),clipAvailable)};
 if(!mobile)return {jobs:jobs.map(j=>({...j,historyBusy:historyBusy(j)})),accounts,published,hasModel:await modelAvailable(dir),preventDuplicates:generationHistory.enabled(),continuous:continuous.status(),posting};
 const reviews=jobs.map(j=>({
  running:!!j.running,stopRequested:!!j.stopRequested,stage:j.stage,historyBusy:historyBusy(j),
  id:j.id,title:j.title,targets:j.targets,continuousId:j.continuousId,writePosts:j.writePosts,clips:j.clips.map(c=>({
   title:c.title,description:c.description,hashtags:c.hashtags,copyBasis:c.copyBasis,postDraft:c.postDraft,postDraftVersion:c.postDraftVersion,safety:c.safety,start:c.start,length:c.length,revision:c.revision,posts:c.posts,posting:c.posting,youtubeReview:c.youtubeReview,extraTargets:c.extraTargets,excerpt:c.excerpt,syncError:c.syncError,autoQueueNotice:c.autoQueueNotice,drive:c.drive?{removed:c.drive.removed,trashed:c.drive.trashed}:undefined
  }))
 }));
 return {jobs:reviews,published,posting,accounts:{youtube:accounts.youtube,tiktok:accounts.tiktok,instagram:accounts.instagram,facebook:accounts.facebook}};
}
function automaticFields(platform,config,job,clip){
 if(platform==='tiktok')return {mode:'inbox',channel:config.channel};
 const useCopy=job.writePosts||clip.postDraft||clip.recoveredFromDrive&&clip.copyBasis==='speech';
 return postFields(platform,config,clip,String(job.clips.indexOf(clip)+1),useCopy?queuePostCopy(job,clip):null);
}
async function verifyYouTubeQueue(refresh=false){
 const config=publicationMemory.automaticSettings().configs.youtube;
 const {videos}=await social.youtubeUploads(config?.channel,refresh);
 const byId=new Map(videos.map(video=>[video.id,video]));
 const counts={published:0,processing:0,review:0,waiting:0,failed:0};
 let changed=false;
 for(const job of jobs)for(const clip of job.clips){
  if(!Number.isSafeInteger(clip.posting?.order)||!clip.posting.targets.includes('youtube')||clip.posts.youtube?.state==='Enviando')continue;
  const current=clip.posts.youtube,known=publicationMemory.lookup(job,clip,'youtube');
  const receipt=current?.state==='Publicado'?current:known||current;
  let post=receipt,candidates=[];
  if(receipt?.id&&receipt.state!=='Publicado'){
   const video=byId.get(receipt.id);
   if(video)post={...receipt,...classifyYouTubeVideo(video)};
  }else if(!receipt?.id){
   const match=matchYouTubeClip(job,clip,videos,automaticFields('youtube',config||{},job,clip));
   if(match.video)post=classifyYouTubeVideo(match.video);
   else if(!receipt||retryablePost(receipt))candidates=match.candidates;
  }
  if(post&&JSON.stringify(post)!==JSON.stringify(current)){clip.posts.youtube=post;changed=true;}
  if(JSON.stringify(clip.youtubeReview?.candidates||[])!==JSON.stringify(candidates)){
   clip.youtubeReview={...clip.youtubeReview,candidates};changed=true;
  }
  const outcome=candidates.length?'review':post?.state==='Publicado'?'published':post?.state==='Falhou'?'failed':post?'processing':'waiting';
  counts[outcome]++;
 }
 if(changed)save();
 return counts;
}
async function automaticConfig(platform,b){
 if(platform==='tiktok'){
  if(b.consent!==true)fail('Autorize o envio à caixa de entrada da conta TikTok conectada.');
  social.assertTikTokInboxAccount(b.channel);
  return {channel:b.channel,mode:'inbox'};
 }
 const label={youtube:'o canal do YouTube',instagram:'a conta profissional do Instagram',facebook:'a Página do Facebook'}[platform];
 if(!label||b.consent!==true)fail('Confirme a conta e autorize o envio automático.');
 if(platform==='youtube'&&(!['private','unlisted','public'].includes(b.privacy)||typeof b.kids!=='boolean'))fail('Escolha a visibilidade e indique se o vídeo é feito para crianças.');
 if(platform==='facebook'&&b.privacy!=='public')fail('Autorize a publicação pública na Página do Facebook.');
 const who=await social.creator(platform);
 if(!b.channel||who.channel_id!==b.channel)fail('Confira '+label+' antes de ativar o envio automático.');
 const title=String(b.title||'').trim(),description=String(b.description||'');
 if(platform==='youtube')return {channel:who.channel_id,privacy:b.privacy,kids:b.kids,title:title.replace(/[<>]/g,'').trim().slice(0,100),description:description.slice(0,1250)};
 if(platform==='facebook')return {channel:who.channel_id,privacy:'public',title:title.slice(0,100),description:description.slice(0,2200)};
 return {channel:who.channel_id,title:title.slice(0,2200)};
}
function assertPostingAvailable(job,clip,file,revision){
 if(!jobs.includes(job))fail('Essa tarefa foi apagada do histórico.');
 checkRevision(clip,revision);
 if(editing.has(clip)||active.has(clip)||Object.values(clip.posts).some(post=>post.state==='Enviando'))fail('Aguarde o trabalho em andamento neste corte.');
 if(clip.drive?.removed||!clip.drive&&!fs.existsSync(file))fail('O arquivo do corte está indisponível.');
}
async function changePostingSelection(b,remove){
 const {job,clip,file}=findClip(b.job,b.index);
 if(remove){
  checkRevision(clip,b.revision);
  if(clip.posting?.order!==undefined){clip.posting={...clip.posting};delete clip.posting.order;delete clip.posting.tiktokInbox;save();}
  return;
 }
 assertPostingAvailable(job,clip,file,b.revision);
 const targets=Array.isArray(b.targets)?[...new Set(b.targets)]:[];
 if(!targets.length||targets.some(p=>!publicationPlatforms.includes(p)))fail('Escolha pelo menos um destino válido.');
 if(targets.includes('facebook')&&clip.length>90)fail('O Facebook exige cortes de até 90 segundos.');
 const previous=clip.posting;
 const inboxConfig=publicationMemory.automaticSettings().configs.tiktok;
 const inboxRequested=b.tiktokInbox===true;
 if(inboxRequested&&(!targets.includes('tiktok')||!inboxConfig||b.tiktokAccount!==inboxConfig.channel))fail('Confira a configuração do envio para o TikTok e abra a seleção novamente.');
 const needsText=needsRecoveredCopy(clip)&&!['no-speech','sensitive'].includes(clip.postCopyRecovery);
 await ensureSafety(job,clip,needsText||!awaitingPublication(clip)||clip.safety?.status!=='approved');
 assertPostingAvailable(job,clip,file,b.revision);
 if(clip.posting!==previous)fail('A seleção do corte mudou durante a verificação. Abra a fila novamente.');
 if(inboxRequested){
  if(inboxConfig!==publicationMemory.automaticSettings().configs.tiktok)fail('A configuração do TikTok mudou. Abra a seleção novamente.');
  social.assertTikTokInboxAccount(inboxConfig.channel);
 }
 setPostingSelection(job,clip,targets,inboxRequested?{channel:inboxConfig.channel,revision:clip.revision||0}:undefined);
 save();
}
function setPostingSelection(job,clip,targets,tiktokInbox){
 const order=awaitingPublication(clip)?clip.posting.order:(publicationQueue(jobs).at(-1)?.clip.posting.order||0)+1;
 clip.posting={order,targets,...(tiktokInbox?{tiktokInbox}:{})};
 if(tiktokInbox&&clip.posts.tiktok?.state==='Falhou')delete clip.posts.tiktok;
 if(tiktokInbox&&clip.posts.tiktok?.state==='Aguardando vaga no TikTok'&&clip.posts.tiktok.account!==tiktokInbox.channel)delete clip.posts.tiktok;
 delete clip.autoQueueNotice;
 refreshPostCopy(job,clip);
 for(const p of targets){
  if(!retryablePost(clip.posts[p]))continue;
  const known=publicationMemory.lookup(job,clip,p);
  if(known)clip.posts[p]=known;
 }
}
async function prepare(b){
 const url=sourceURL(b.url);
 if(!Number.isInteger(b.count)||b.count<5||b.count>20)fail('Escolha de 5 a 20 cortes.');
 if(!Number.isInteger(b.duration)||b.duration<minimum||b.duration>180)fail('Escolha entre 40 e 180 segundos.');
 if(!social.accounts().drive.connected)fail('Conecte seu Google Drive na aba Contas antes de gerar cortes.');
 const frame=['native','webcam-top-right'].includes(b.frame)?b.frame:'auto';
 if(b.captions&&!await modelAvailable(dir))fail('Instale o modelo de legendas ou desmarque as legendas para continuar.');
 if(b.writePosts!==false&&!await modelAvailable(dir))fail('Instale o modelo de transcrição para criar título, descrição e hashtags com as falas de cada clipe.');
 if(!await modelAvailable(dir))fail('Instale o modelo de transcrição em Instalar legendas locais para verificar as falas antes de gerar os clipes.');
 return {url,targets:[],frame,writePosts:b.writePosts!==false,captions:!!b.captions,language:['auto','pt','en','es'].includes(b.language)?b.language:'auto',count:b.count,duration:b.duration};
}
async function addContinuousSource(body){
 const {url,...settings}=await prepare({...body,count:5});
 continuous.add(url,settings,body.follow===true);
}
function makeJob(settings){
 const job={...settings,id:crypto.randomUUID(),title:'Nova live',clips:[]};
 jobs.unshift(job);
 return job;
}
async function execute(job,options){
 if(!jobs.includes(job))return;
 const controller=new AbortController();
 runningJobs.set(job.id,controller);
 job.stopRequested=false;
 job.running=true;job.resumeOnRestart=false;job.live=false;job.stage='Na fila';job.progress=0;
 save();
 try{
  if(job.writePosts)job.postTrendTags=await social.youtubeGamingHashtags();
  const outcome=await generate(job,dir,(stage,progress)=>{
   if(!controller.signal.aborted){job.stage=stage;if(progress!==undefined)job.progress=progress;}
   save();
  },job.continuousId?clip=>{
   if(controller.signal.aborted||options?.shouldStop?.())return;
   try{
    const targets=continuous.postingTargets(job,clip);
    if(targets.length){
     const inbox=publicationMemory.automaticSettings().configs.tiktok;
     const consent=continuous.status().autoQueue.tiktokInbox;
     const approved=targets.includes('tiktok')&&consent===inbox?.channel&&tiktokInboxAvailable(social.accounts().tiktok,inbox);
     setPostingSelection(job,clip,targets,approved?{channel:consent,revision:clip.revision||0}:undefined);
    }
   }catch(error){clip.autoQueueNotice='Revise a adição automática. '+error.message;}
  }:undefined,{...options,signal:controller.signal,generationHistory});
  controller.signal.throwIfAborted();
  return outcome;
 }catch(error){
  job.progress=null;
  if(controller.signal.aborted){job.stage='Clipagem interrompida.';return {stopped:true,manual:true};}
  job.stage=error.message;throw error;
 }finally{runningJobs.delete(job.id);job.running=false;job.stopRequested=false;job.live=false;save();}
}
async function start(b){
 if(starting||jobs.some(j=>j.running&&!j.continuousId))fail('Já existe uma análise em andamento no Estúdio.');
 starting=true;
 try{
  const settings=await prepare(b);
  void execute(makeJob(settings)).catch(()=>{});
 }finally{starting=false;}
}
const continuous=createContinuous(path.join(dir,'continuo.json'),{
 sourceInfo:url=>sourceInfo(url,undefined,cloudBatch?AbortSignal.timeout(30_000):undefined),stop:stopLive,
 connected:()=>social.accounts().drive.connected,batchOnly:cloudBatch,
 launch(source,meta,key,item,shouldStop){
  const same=jobs.find(j=>j.continuousId===source.id&&j.mediaKey===key);
  const job=same||makeJob({...source.config,url:source.url,continuousId:source.id,mediaKey:key});
  item.job=job;
  return execute(job,{knownMeta:meta,shouldStop,batch:cloudBatch});
 }
});
async function trim(b){
 const {job,clip}=findClip(b.job,b.index);
 if(!clip.drive||clip.drive.removed||Object.values(clip.posts).some(post=>post.state!=='Falhou'))fail('O corte só pode ser ajustado antes do primeiro envio.');
 checkRevision(clip,b.revision);
 if(editing.has(clip))fail('Aguarde a alteração em andamento neste corte.');
 if(checkingSafety.has(clip))fail('Aguarde a verificação de conteúdo antes de ajustar.');
 editing.add(clip);
 try{
  const source='http://127.0.0.1:43871/video/'+encodeURIComponent(b.job)+'/'+Number(b.index);
  clip.drive=await trimClip(clip,b.from,b.to,source);
  if(clip.postSpeech)clip.postSpeech=postSpeech(clip.postSpeech,clip.start+b.from,clip.start+b.to);
  delete clip.excerpt;
  if(!clip.recoveredFromDrive)delete clip.previousPostTitle;
  delete clip.postContext;
  clip.length=b.to-b.from;clip.start+=b.from;clip.revision=(clip.revision||0)+1;
  delete clip.safety;
  if(job.writePosts||clip.recoveredFromDrive&&clip.copyBasis==='speech'){
   applyPostCopy(clip.recoveredFromDrive?{...job,sourceTitle:clip.previousPostTitle||job.sourceTitle}:job,clip);
  }
  save();
 }finally{editing.delete(clip);void autoTick();}
}
async function changeDriveTrash(b,trashed){
 if(!Number.isInteger(b.index)||b.index<0)fail('Informe o corte.');
 const {clip}=findClip(b.job,b.index);
 checkRevision(clip,b.revision);
 if(b.consent!==true)fail(trashed?'Confirme que deseja mover o vídeo para a lixeira do Drive.':'Confirme que deseja restaurar o vídeo do Drive.');
 if(!clip.drive?.id)fail('Este corte não está salvo no Drive.');
 if(clip.drive.removed&&!clip.drive.trashed)fail('O arquivo já foi excluído do Drive.');
 if(editing.has(clip)||checkingSafety.has(clip)||active.has(clip)||Object.values(clip.posts).some(post=>post.state==='Enviando')){
  fail('Aguarde o ajuste, a verificação ou o envio em andamento neste corte.');
 }
 if(!!clip.drive.trashed===trashed)return;
 editing.add(clip);
 try{
  await drive.setTrashed(clip.drive.id,trashed);
  if(trashed){
   clip.drive.removed=true;
   clip.drive.trashed=true;
  }else{
   delete clip.drive.removed;
   delete clip.drive.trashed;
  }
  delete clip.syncError;
  save();
 }finally{editing.delete(clip);}
}
async function postingAction(route,b){
 if(route==='/api/posting/check-youtube')return verifyYouTubeQueue(true);
 if(route==='/api/publications/check'){await tick();return {ok:true};}
 if(route==='/api/posting/add'){await changePostingSelection(b,false);return {ok:true};}
 const {job,clip,file}=findClip(b.job,b.index);
 checkRevision(clip,b.revision);
 if(route==='/api/safety/check'){
  await ensureSafety(job,clip,true).catch(()=>{});
  return {safety:clip.safety};
 }
 if(route==='/api/publish'){
  if(b.platform==='youtube')fail('O YouTube publica pela fila automática. Configure o canal na aba Fila de postagem.');
  if(!['tiktok','instagram','facebook'].includes(b.platform))fail('Plataforma inválida.');
  await publish(job,clip,file,b.platform,b);
  const post=clip.posts[b.platform];
  return b.platform==='instagram'&&post?.reason==='instagram_link_unavailable'?{ok:true,post}:{ok:true};
 }
 if(route==='/api/instagram/confirm'){
  assertPostingAvailable(job,clip,file,b.revision);
  const previous=clip.posts.instagram;
  if(!awaitingPublication(clip)||!clip.posting.targets.includes('instagram')||previous?.state!=='Falhou'||b.consent!==true)fail('Confirme a publicação de um corte do Instagram que falhou na fila.');
  const selection=clip.posting;
  const verified=await social.findPublishedInstagramReel(b.link);
  assertPostingAvailable(job,clip,file,b.revision);
  if(clip.posting!==selection||clip.posts.instagram!==previous)fail('O corte mudou durante a confirmação. Abra a fila novamente.');
  if(jobs.some(j=>j.clips.some(other=>other!==clip&&other.posts.instagram?.mediaId===verified.mediaId))||publicationMemory.publishedClips().some(entry=>entry.posts.instagram?.link===verified.link))fail('Esse Reel já está registrado no Cliparia.');
  clip.posts.instagram={...verified,state:'Publicado',detail:'Publicação manual confirmada no Instagram.'};save();
  void sync(job,clip);
  return {ok:true};
 }
 if(!clipTargets(job,clip).includes('kwai')||clip.posting&&!awaitingPublication(clip)||clip.drive?.removed||clip.posts.kwai||editing.has(clip))fail('Este corte não está aguardando confirmação do Kwai.');
 let link;
 try{link=new URL(b.link);}catch{fail('Cole o link do vídeo publicado no Kwai.');}
 if(link.protocol!=='https:'||!['kwai.com','www.kwai.com','m.kwai.com','k.kwai.com','s.kwai.com'].includes(link.hostname)||link.pathname==='/'||link.port||link.username||link.password||b.consent!==true)fail('Cole o link HTTPS do vídeo publicado no Kwai e confirme a postagem manual.');
 clip.posts.kwai={state:'Publicado',link:link.href,detail:'Confirmado manualmente'};save();
 await sync(job,clip);
 return {ok:true};
}
async function handle(req,res,mobile){
 try{
  if(!mobile&&![new URL(social.base).host,'127.0.0.1:43871'].includes(req.headers.host))fail('Host inválido.');
  const origin=mobile?.origin||social.base,u=new URL(req.url,origin),route=u.pathname;
  res.setHeader('X-Content-Type-Options','nosniff');
  if(!mobile&&reelRoute.test(route))return await servePublicReel(req,res);
  if(!mobile&&automationRoutes.includes(route)){
   res.setHeader('Cache-Control','no-store');
   if(!automationAuthorization){res.statusCode=404;return res.end();}
   if(req.method!=='POST'){res.setHeader('Allow','POST');res.statusCode=405;return res.end();}
   if(!crypto.timingSafeEqual(automationAuthorization,automationDigest(req.headers.authorization||''))){res.statusCode=401;return res.end();}
   if(route.endsWith('/continuous'))continuous.tick();
   else void autoTick();
   res.statusCode=202;return json(res,{accepted:true});
  }
  if(mobile){
   if((mobile.remote&&localReviewOnly.has(route))||(!mobileRoutes.has(route)&&!route.startsWith('/video/'))){res.statusCode=404;return json(res,{error:'Esta função fica disponível no Cliparia do PC.'});}
   const publicAsset=req.method==='GET'&&Object.hasOwn(assets,route);
   if(!publicAsset&&!mobile.authenticated){res.statusCode=403;return json(res,{error:'Abra um novo link de revisão gerado no PC.'});}
  }
  if(req.method==='GET'){
   if(route==='/api/state'){res.setHeader('Cache-Control','no-store');return json(res,await state(mobile));}
   if(route==='/api/backup'){
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Disposition','attachment; filename="cliparia-backup-'+new Date().toISOString().slice(0,10)+'.json"');
    return json(res,exportBackup(jobs,publicationMemory,generationHistory));
   }
   if(route==='/api/networks')return json(res,networkOptions());
   if(!mobile&&(route==='/oauth/callback'||(route==='/'&&u.searchParams.has('state')))){
    await social.callbackLogin(u.searchParams);res.writeHead(303,{Location:'/#contas'});return res.end();
   }
   if(route.startsWith('/video/')){
    const [,,id,i]=route.split('/');const {job,file,clip}=findClip(id,i);
    if(u.searchParams.get('download')==='1')await ensureSafety(job,clip);
    if(u.searchParams.get('download')==='1')res.setHeader('Content-Disposition','attachment; filename="cliparia-corte-'+(Number(i)+1)+'.mp4"');
    return await serveVideo(req,res,file,clip);
   }
   if(!Object.hasOwn(assets,route)){res.writeHead(404);return res.end();}
   const [name,mime]=assets[route];
   res.setHeader('Content-Type',mime+'; charset=utf-8');res.setHeader('X-Frame-Options','DENY');res.setHeader('Cache-Control','no-cache');
   const content=fs.readFileSync(path.join(here,'public',name));
   return res.end(mobile&&route==='/'?content.toString().replace('<body>','<body data-mobile="'+(mobile.remote?'remote':'local')+'">'):content);
  }
  const native=!req.headers.origin&&req.headers['x-cliparia-client']==='android'&&!!req.headers.authorization;
  if(req.method!=='POST'||(!native&&req.headers.origin!==origin)||req.headers['content-type']!=='application/json')fail('Origem inválida.');
  if(route==='/api/backup/restore'){
   const backup=readBackup(await backupBody(req));
   const restored=mergeBackup(backup,jobs,publicationMemory,generationHistory,clip=>editing.has(clip)||checkingSafety.has(clip)||active.has(clip)||Object.values(clip.posts).some(post=>post.state==='Enviando'));
   if(restored.queued)publicationMemory.setAutomaticEnabled(false);
   save();
   return json(res,restored);
  }
  const b=await body(req),p=b.platform;
  if(backgroundRoutes.has(route)){
   const action=()=>postingAction(route,b);
   if(mobile?.remote&&req.headers.prefer==='respond-async'){
    const result=mobile.runInBackground(action);
    res.statusCode=result.task?202:429;
    return json(res,result);
   }
   return json(res,await action());
  }
  if(route==='/api/frame'){
   if(previewing)fail('A prévia anterior ainda está sendo carregada.');
   previewing=true;
   try{
    const frame=await previewSource(b.url,Number.isFinite(b.at)?Math.max(0,b.at):0);
    if(!frame.length)fail('A fonte ainda não entregou um quadro para a prévia.');
    res.setHeader('Content-Type','image/jpeg');res.setHeader('Cache-Control','no-store');return res.end(frame);
   }finally{previewing=false;}
  }
  if(route==='/api/pair/start'){
   const url=await startPair(b.address,handle,{remote:b.mode==='remote',executable:tunnelExecutable(dir)});
   return json(res,{url,qr:await pairingQR(url).catch(()=>null)});
  }
  if(route==='/api/pair/stop')stopPair();
  else if(route==='/api/model'){if(!await modelAvailable(dir))await installModel(dir);}
  else if(route==='/api/generation/prevent-duplicates')generationHistory.setEnabled(b.enabled);
  else if(route==='/api/analyze')await start(b);
  else if(route==='/api/continuous/add')await addContinuousSource(b);
  else if(route==='/api/continuous/enable')continuous.setEnabled(b.enabled);
  else if(route==='/api/continuous/limit')continuous.setLimit(b.limit);
  else if(route==='/api/continuous/auto-queue')continuous.setAutoQueue(b.enabled,b.targets);
  else if(route==='/api/continuous/remove')continuous.remove(b.id);
  else if(route==='/api/posting/countdown')return json(res,publicationMemory.setIntervalMinutes(b.minutes));
  else if(route==='/api/posting/restart-countdown')return json(res,publicationMemory.restartCountdown());
  else if(route==='/api/posting/clear-countdown'){const status=publicationMemory.restartCountdown(0);void autoTick();return json(res,status);}
 else if(route==='/api/posting/recover-review'){
   if(b.consent!==true)fail('Confirme a recuperação para revisão.');
   let order=publicationQueue(jobs).at(-1)?.clip.posting.order||0,count=0;
   for(const job of jobs)for(const clip of job.clips){
    if(!clip.recoveredFromDrive||!clipAvailable(job,clip)||awaitingPublication(clip)||Object.keys(clip.posts).length)continue;
    clip.posting={order:++order,targets:[],recoveryReview:true};count++;
   }
   if(count){publicationMemory.setAutomaticEnabled(false);save();}
   return json(res,{count});
 }
 else if(route==='/api/posting/remove')await changePostingSelection(b,true);
  else if(route==='/api/posting/retry-youtube'){
   const {job,clip,file}=findClip(b.job,b.index);
   assertPostingAvailable(job,clip,file,b.revision);
   if(!awaitingPublication(clip)||!clip.posting.targets.includes('youtube')||b.consent!==true)fail('Confirme a nova tentativa para um corte na fila do YouTube.');
   const post=clip.posts.youtube;
   if(post&&post.state!=='Falhou'||publicationMemory.lookup(job,clip,'youtube'))fail('Este corte já tem um envio registrado no YouTube.');
   const candidates=clip.youtubeReview?.candidates||[];
   if(post?.state!=='Falhou'&&!candidates.length)fail('Este corte já está aguardando o envio automático.');
   if(candidates.length)clip.youtubeReview={candidates:[],ignored:[...new Set([...(clip.youtubeReview?.ignored||[]),...candidates])]};
   delete clip.posts.youtube;save();
  }
  else if(route==='/api/posting/shuffle'){shufflePublications(publicationQueue(jobs));save();}
  else if(route==='/api/post-copy'){
   const {job,clip}=findClip(b.job,b.index);
   checkRevision(clip,b.revision);
   return json(res,b.generated===true?suggestPost(job,clip):queuePostCopy(job,clip));
  }
  else if(route==='/api/posting/copy'){
   const {job,clip,file}=findClip(b.job,b.index);
   assertPostingAvailable(job,clip,file,b.revision);
   if(!awaitingPublication(clip))fail('Coloque o corte na fila para editar o texto da publicação.');
   if((clip.postDraftVersion||0)!==b.version)fail('O texto foi atualizado em outra sessão. Abra o editor novamente.');
   if(b.reset===true)delete clip.postDraft;
   else{
    const draft=validatePostDraft(b);
    if(sexualText(draft.title+' '+postText(draft)))fail('Texto bloqueado por indício de conteúdo sexual.');
    clip.postDraft=draft;
   }
   for(const platform of clip.posting.targets)if(clip.posts[platform]?.reason==='posting_text_blocked')delete clip.posts[platform];
   clip.postDraftVersion=(clip.postDraftVersion||0)+1;save();
  }
  else if(route==='/api/trim')await trim(b);
  else if(route==='/api/drive/trash'||route==='/api/drive/restore')await changeDriveTrash(b,route==='/api/drive/trash');
  else if(route==='/api/stop')cancelJob(b.job);
  else if(route==='/api/history/remove'){if(typeof b.job!=='string'||!b.job)fail('Informe a tarefa.');return json(res,clearHistory('all',b.job));}
  else if(route==='/api/history/clear')return json(res,clearHistory(b.scope||'all'));
  else if(route==='/api/posting/configure'||route==='/api/posting/disable-platform'){
   if(!automaticPlatforms.includes(p))fail('Esta plataforma não tem envio automático no Cliparia.');
   publicationMemory.setAutomaticConfig(p,route==='/api/posting/configure'?await automaticConfig(p,b):null);
  }else if(route==='/api/posting/enable'){
   if(typeof b.enabled!=='boolean')fail('Informe se a postagem automática deve ficar ativa.');
   if(b.enabled&&!Object.keys(publicationMemory.automaticSettings().configs).length)fail('Configure pelo menos uma plataforma para a postagem automática.');
   publicationMemory.setAutomaticEnabled(b.enabled);
   if(b.enabled)void autoTick();
  }else if(route==='/api/instagram/connect'){
   await social.connectInstagram(String(b.id||'').trim(),String(b.token||'').trim(),String(b.appId||'').trim(),String(b.appSecret||'').trim(),String(b.pageId||'').trim());
   void tick().catch(()=>{});
  }else if(route==='/api/facebook/connect'){
   await social.connectFacebook(String(b.id||'').trim(),String(b.token||'').trim());
  }else if(route==='/api/instagram/check'){
   try{return json(res,await social.checkInstagram());}
   catch(error){
    if(social.instagramReconnectRequired(error.reason)){
     let changed=false;
     for(const {job,clip} of publicationQueue(jobs)){
      const post=clip.posts.instagram;
      if(!clip.posting.targets.includes('instagram')||!post||post.id||!['instagram_profile_unavailable','instagram_token_invalid','instagram_account_access_denied'].includes(post.reason)||post.reason===error.reason)continue;
      clip.posts.instagram=publicationMemory.deferInstagram(job,clip,error.reason);changed=true;
     }
     if(changed)save();
    }
    throw error;
   }
  }else if(route==='/api/tiktok/inbox-missing'){
   const {clip}=findClip(b.job,b.index);
   checkRevision(clip,b.revision);
   const post=clip.posts.tiktok;
   if(!awaitingPublication(clip)||!clip.posting.targets.includes('tiktok')||!tiktokInboxNotified(post)||post.id!==b.receipt)fail('O envio do TikTok mudou. Abra a fila novamente.');
   if(!post.inboxMissing){post.inboxMissing=true;save();}
  }else{
   const accountRoutes=['/api/login','/api/config','/api/disconnect'];
   if(!(accountRoutes.includes(route)?['youtube','tiktok','drive','instagram','facebook']:['youtube','tiktok','instagram','facebook']).includes(p))fail('Plataforma inválida.');
   if(['instagram','facebook'].includes(p)&&['/api/config','/api/login'].includes(route))fail('Use Conectar '+p+' em Contas.');
   if(route==='/api/config')social.config(p,b.id?.trim(),b.secret?.trim());
   else if(route==='/api/disconnect')social.disconnect(p);
   else if(route==='/api/login')return json(res,{url:social.login(p,b.mode)});
   else if(route==='/api/creator')return json(res,p==='tiktok'&&b.mode==='inbox'?social.tiktokInboxProfile():await social.creator(p));
   else if(route==='/api/status'){
    const {job,clip}=findClip(b.job,b.index);
    if(p==='tiktok'){
     const post=await refreshTikTok(clip,save);
     if(post?.state==='Publicado')void sync(job,clip);
     return json(res,{post});
    }
    if(!clip.drive)fail('Envio indisponível.');
    await sync(job,clip);
   }else fail('Rota inválida.');
  }
  return json(res,{ok:true});
 }catch(e){if(res.headersSent)return res.destroy();res.statusCode=400;return json(res,{error:e.message,reason:typeof e.reason==='string'?e.reason:undefined});}
}
const server=http.createServer((req,res)=>handle(req,res));
function safetyInput(job,clip){
 if(!clip.drive)return ['-i',path.join(dir,job.id,clip.file)];
 const {address,port}=server.address();
 const host=['0.0.0.0','::'].includes(address)?'127.0.0.1':address.includes(':')?'['+address+']':address;
 return ['-headers','Host: 127.0.0.1:'+port+'\r\n','-i','http://'+host+':'+port+'/video/'+encodeURIComponent(job.id)+'/'+job.clips.indexOf(clip)];
}
async function clipSpeech(input,language,signal){
 const audio=await run('ffprobe',['-v','error','-select_streams','a:0','-show_entries','stream=index','-of','csv=p=0',...input],null,null,{signal:AbortSignal.any([signal,AbortSignal.timeout(30_000)])});
 if(!audio.toString().trim())return [];
 if(!await modelAvailable(dir))throw Error('Modelo de transcrição indisponível.');
 return transcribe({audio:input,signal},dir,language||'auto');
}
async function backfillRecoveredCopy(budget){
 const ordered=publicationQueue(jobs);
 const jobOrder=new Map();
 for(const {job,clip} of ordered)if(!jobOrder.has(job))jobOrder.set(job,clip.posting.order);
 const queue=ordered.filter(({clip})=>needsRecoveredCopy(clip)&&
  !['no-speech','sensitive'].includes(clip.postCopyRecovery)&&!(clip.postCopyRetryAt>Date.now()))
  .sort((a,b)=>Number(!!a.clip.posting.recoveryReview)-Number(!!b.clip.posting.recoveryReview)||
   Number(!!b.clip.postSpeech?.length)-Number(!!a.clip.postSpeech?.length)||jobOrder.get(a.job)-jobOrder.get(b.job));
 if(!queue.length||!await modelAvailable(dir))return;
 const trends=await social.youtubeGamingHashtags();
 const elapsed=AbortSignal.timeout(budget);
 for(const row of queue){
  if(elapsed.aborted)break;
  const signal=AbortSignal.any([elapsed,AbortSignal.timeout(75_000)]);
  try{
   await recoverPostCopy(row,(job,clip)=>clipSpeech(safetyInput(job,clip),job.language,signal),trends);
  }catch{
   if(elapsed.aborted)break;
   row.clip.postCopyRecovery='retry';
   row.clip.postCopyRetryAt=Date.now()+15*60_000;
  }
  save();
 }
}
async function ensureSafety(job,clip,force=false){
 if(editing.has(clip))fail('Aguarde a alteração do corte antes de verificar.');
 if(clip.drive?.removed)fail('O vídeo precisa estar disponível para verificar o corte.');
 if(checkingSafety.has(clip))return checkingSafety.get(clip);
 if(!force&&clip.safety?.version===safetyVersion&&clip.safety.revision===(clip.revision||0)){assertScreened(clip);return;}
 const work=Promise.resolve().then(async()=>{
  clip.safety={version:safetyVersion,revision:clip.revision||0,status:'checking',reason:'Verificando imagens e falas do clipe.'};save();
  let speech=[];
  try{
   const input=safetyInput(job,clip);
   const text=[clip.title,clip.description].join(' ');
   if(!sexualText(text))speech=await clipSpeech(input,job.language,AbortSignal.timeout(180_000));
   clip.safety=await screenClip(input,{duration:clip.length,revision:clip.revision||0,text:[text,...speech.map(s=>s.text)].join(' ')});
  }catch(error){
   clip.safety={version:safetyVersion,revision:clip.revision||0,status:'error',reason:'Não foi possível verificar o clipe. Instale o modelo de transcrição, confira o arquivo e tente novamente.'};
  }
  if(clip.safety.status==='approved'&&needsRecoveredCopy(clip)){
   await recoverPostCopy({job,clip},()=>speech,await social.youtubeGamingHashtags());
  }
  save();assertScreened(clip);
 }).finally(()=>checkingSafety.delete(clip));
 checkingSafety.set(clip,work);
 return work;
}
function checkRevision(clip,revision){
 if((clip.revision||0)!==(revision??0))fail('O corte mudou. Abra a revisão de novo.');
}
async function publish(job,clip,file,p,b,canStart){
 if(!jobs.includes(job))fail('Essa tarefa foi apagada do histórico.');
 if(editing.has(clip))fail('Aguarde a alteração do corte antes de publicar.');
 const selection=clip.posting;
 const selected=()=>clip.posting===selection&&(selection?awaitingPublication(clip)&&selection.targets.includes(p):!job.targets||clipTargets(job,clip).includes(p));
 if(!clipAvailable(job,clip)||!selected())fail('Este destino não está disponível para o corte.');
 const source=clip.drive?{size:clip.drive.size,async *stream(start,end){
  const response=await drive.media(clip.drive.id,start===undefined?undefined:'bytes='+start+'-'+end);
  yield* drive.mediaChunks(response);
 }}:file||path.join(dir,job.id,clip.file);
 if(!retryablePost(clip.posts[p]))fail('Esse corte já tem um envio para a plataforma.');
 const known=publicationMemory.lookup(job,clip,p);
 if(known){clip.posts[p]=known;save();return;}
 if(p==='instagram')social.assertInstagramReady();
 const tiktokMode=p==='tiktok'?social.assertTikTokMode(canStart?'inbox':b.mode):undefined;
 if(!canStart&&sexualText([b.title,b.description].filter(Boolean).join(' ')))fail('Envio bloqueado: indício de conteúdo sexual no título ou na legenda.');
 await ensureSafety(job,clip);
 if(canStart&&!canStart())return;
 if(!jobs.includes(job)||editing.has(clip)||!clipAvailable(job,clip)||!selected())fail('O corte mudou durante a verificação.');
 if(p==='instagram')social.assertInstagramReady();
 const previous=clip.posts[p];
 if(!retryablePost(previous))fail('Esse corte já tem um envio para a plataforma.');
 if(p==='instagram')b={...b,preferInstagramLink:['instagram_upload_processing_failed','instagram_link_unavailable'].includes(previous?.reason)||previous?.uploadMode==='hosted'};
 if(canStart)b={...b,...automaticFields(p,publicationMemory.automaticSettings().configs[p],job,clip)};
 if(canStart&&sexualText([b.title,b.description].filter(Boolean).join(' '))){
  clip.posts[p]={state:'Falhou',reason:'posting_text_blocked',detail:'Revise o título ou a legenda antes de enviar.'};save();
  fail('Envio bloqueado: indício de conteúdo sexual no título ou na legenda.');
 }
 publicationMemory.reserve(job,clip,p,!!canStart);
 clip.posts[p]={state:'Enviando',...(tiktokMode?{mode:tiktokMode}:{})};save();
 let initiated=false;
 try{
  if(cloudBatch)await checkpointCloudBatch();
  clip.posts[p]=await social.publish(p,source,clip,b,(id,fields)=>{initiated=true;Object.assign(clip.posts[p],fields,{id});save();});
 }
 catch(e){
  if(p==='tiktok'&&canStart&&!initiated&&e.reason==='spam_risk_too_many_pending_share'){
   clip.posts[p]=publicationMemory.deferTikTokInbox(job,clip,b.channel);
   return;
  }
  if(p==='instagram'&&!initiated&&e.reason==='instagram_link_unavailable'){
   clip.posts[p]=publicationMemory.deferInstagram(job,clip,e.reason,previous);
   return;
  }
  if(p==='instagram'&&!initiated&&(social.instagramReconnectRequired(e.reason)||e.reason==='instagram_profile_unavailable')){
   clip.posts[p]=publicationMemory.deferInstagram(job,clip,e.reason);
   throw e;
  }
  if(transferInterrupted(e))e=Error(initiated?'A transferência foi interrompida antes da confirmação. Confira o status da publicação.':'A transferência do vídeo foi interrompida. O corte continua disponível para tentar novamente.',{cause:e});
  clip.posts[p].state=initiated?(['tiktok','instagram','facebook'].includes(p)?'Em processamento':'Resultado incerto. Confira o canal.'):'Falhou';
  if(typeof e.reason==='string')clip.posts[p].reason=e.reason;
  clip.posts[p].detail=e.message;throw e;
 }finally{publicationMemory.finish(job,clip,!!canStart);save();}
 if(cloudBatch&&p==='instagram'&&clip.posts[p].uploadMode==='hosted'){
  await social.finishHostedInstagram(clip.posts[p].id,()=>sync(job,clip));
 }else if(cloudBatch)await sync(job,clip);
 else void sync(job,clip);
}
const autoTick=createAutoPublisher({jobs,memory:publicationMemory,editing,send:publish,save,
 platformAvailable:(platform,config)=>platform==='tiktok'?tiktokInboxAvailable(social.accounts().tiktok,config):social.accounts()[platform].connected,
 clipAvailable,
 verifyYouTube:verifyYouTubeQueue,
 fields:(platform,config,job,clip)=>({...automaticFields(platform,config,job,clip),...(platform==='youtube'?{youtubeMarker:youtubeMarker(job,clip)}:{})}),
 onError:error=>console.error('Falha no envio automático:',error.message)
});
const active=new Set();
async function sync(j,c){
 if(!jobs.includes(j)||active.has(c)||editing.has(c))return;active.add(c);
 try{
  const pendingMeta=['instagram','facebook'].filter(p=>p==='instagram'?social.instagramAvailable():!social.facebookNeedsReconnect());
  if(c.drive&&!c.drive.removed&&pendingMeta.some(p=>c.posts[p]?.id&&!['Publicado','Falhou'].includes(c.posts[p].state)&&!c.posts[p].publishRequested))await ensureSafety(j,c);
  await reconcile(j,c,save);if(c.syncError){delete c.syncError;save();}
 }
 catch(e){if(c.syncError!==e.message){c.syncError=e.message;save();}}
 finally{active.delete(c);}
}
let publicationCheck;
function tick(){
 if(publicationCheck)return publicationCheck;
 publicationCheck=(async()=>{
  for(const j of jobs)for(const c of j.clips){
   const targets=clipTargets(j,c);
   if(hasPendingPublication(c)||c.drive&&!c.drive.removed&&!c.preserveDrive&&targets.length&&targets.every(p=>c.posts[p]?.state==='Publicado'))await sync(j,c);
  }
 })().finally(()=>{publicationCheck=undefined;});
 return publicationCheck;
}
if(!cloudBatch){
 setInterval(()=>tick().catch(()=>{}),60000).unref();
 setInterval(()=>void autoTick(),5000).unref();
}
server.on('error',err=>{console.error(err.code==='EADDRINUSE'?'O Cliparia já está aberto em '+social.base:err.message);process.exitCode=1;});
server.listen(43871,process.env.CLIPARIA_BIND||'127.0.0.1',()=>{
 recover();
 if(cloudBatch){
  void (async()=>{
   if(!social.accounts().drive.connected)throw Error('Conecte o Google Drive antes de executar na nuvem.');
   if(process.env.CLIPARIA_CLOUD_COPY_ONLY==='true'){
    await backfillRecoveredCopy(10*60_000);
    return;
   }
   const panelCommands=path.join(dir,'panel-commands.json');
   if(fs.existsSync(panelCommands)){
    const resultsFile=path.join(dir,'panel-results.json');
    const results=fs.existsSync(resultsFile)?JSON.parse(fs.readFileSync(resultsFile,'utf8')):[];
    const commands=JSON.parse(fs.readFileSync(panelCommands,'utf8'));
    const updated=await applyPanelCommands(commands,results,{jobs,memory:publicationMemory,changeSelection:changePostingSelection,addSource:addContinuousSource,save});
    fs.writeFileSync(resultsFile,JSON.stringify(updated));
    await checkpointCloudBatch();
   }
   await tick();
   await continuous.tick({batch:true});
   await backfillRecoveredCopy(120_000);
   await checkpointCloudBatch();
   await autoTick();
   await tick();
   save();
  })().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>server.close());
  return;
 }
 void tick().catch(()=>{});
 const pending=jobs.filter(j=>j.resumeOnRestart).reverse();
 if(pending.length){
  starting=true;
  void (async()=>{try{for(const j of pending)await execute(j).catch(()=>{});}finally{starting=false;}})();
 }
 continuous.tick();
 setInterval(()=>continuous.tick(),3000).unref();
 console.log('Cliparia aberto em '+social.base+' — mantenha esta janela aberta.');
 if(process.platform==='win32'&&!process.env.CLIPARIA_TEST)spawn('explorer.exe',[social.base],{windowsHide:true});
});
