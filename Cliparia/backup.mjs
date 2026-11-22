import {publicationKey,publicationPlatforms,awaitingPublication} from './publishing.mjs';
import {validatePostDraft} from './post-copy.mjs';

export const backupLimit=32*1024*1024;
const format='cliparia-backup';
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const identifier=value=>typeof value==='string'&&/^[a-z\d_-]{1,160}$/i.test(value);
const text=(value,max=5000)=>typeof value==='string'?value.slice(0,max):undefined;
const seconds=value=>Number.isFinite(value)&&value>=0&&value<1e9?value:undefined;
const whole=value=>Number.isSafeInteger(value)&&value>=0?value:undefined;
const fields=(value,keys,convert)=>Object.fromEntries(keys.map(key=>[key,convert(value[key])]).filter(([,entry])=>entry!==undefined));
const platforms=value=>Array.isArray(value)?[...new Set(value.filter(p=>publicationPlatforms.includes(p)))]:[];
const safeKey=value=>typeof value==='string'&&value.length<=4096&&!['__proto__','constructor','prototype'].includes(value);
const requireBackup=condition=>{if(!condition)throw Error('O arquivo contém dados incompatíveis com o backup do Cliparia.');};

function httpsLink(value,hosts){
 const url=typeof value==='string'&&value.length<=3000?URL.parse(value):null;
 return url?.protocol==='https:'&&!url.username&&!url.password&&!url.port&&hosts.includes(url.hostname)?url.href:undefined;
}
const postHosts={
 youtube:['youtube.com','www.youtube.com','youtu.be'],
 instagram:['instagram.com','www.instagram.com'],
 tiktok:['www.tiktok.com','tiktok.com','vm.tiktok.com'],
 facebook:['facebook.com','www.facebook.com','fb.watch'],
 kwai:['kwai.com','www.kwai.com','m.kwai.com','k.kwai.com','s.kwai.com']
};
function savedPost(value,platform){
 requireBackup(object(value)&&typeof value.state==='string'&&value.state.length<=100);
 const post=fields(value,['state','detail','reason','mode','uploadMode','publishedKey','title','description','id','mediaId','account'],text);
 for(const key of ['id','mediaId','account']){
  if(post[key]&&!/^[\w~.:-]{1,200}$/.test(post[key]))delete post[key];
 }
 if(!safeKey(post.publishedKey))delete post.publishedKey;
 const link=httpsLink(value.link,postHosts[platform]);
 if(link)post.link=link;
 Object.assign(post,fields(value,['retryAt','startedAt'],whole));
 for(const key of ['publishRequested','uploaded','inboxMissing'])if(typeof value[key]==='boolean')post[key]=value[key];
 if(post.state==='Enviando')post.state=post.id?'Em processamento':'Envio interrompido. Confira o perfil.';
 if(post.id&&['instagram','facebook'].includes(platform)&&['Em processamento','Confirmação pendente','Enviado'].includes(post.state))post.restoreStatusOnly=true;
 return post;
}
function savedClip(value){
 requireBackup(object(value)&&typeof value.file==='string'&&/^[\w-][\w.-]{0,110}\.mp4$/i.test(value.file)&&seconds(value.start)!==undefined&&seconds(value.length)>0&&object(value.posts));
 const clip={...fields(value,['file','title','description','copyBasis','contentHash','game','gameSource','excerpt','previousPostTitle'],text),
  ...fields(value,['start','length','originalStart','originalLength'],seconds),...fields(value,['revision','postDraftVersion','postCopyVersion','postCopyRecoveryVersion'],whole)};
 clip.posts=Object.fromEntries(Object.entries(value.posts).filter(([p,post])=>publicationPlatforms.includes(p)&&post).map(([p,post])=>[p,savedPost(post,p)]));
 if(object(value.posting)){
  const targets=platforms(value.posting.targets);
  if(targets.length)clip.posting={targets,...fields(value.posting,['order'],whole)};
  else if(value.recoveredFromDrive===true&&value.posting.recoveryReview===true)clip.posting={targets,recoveryReview:true,...fields(value.posting,['order'],whole)};
 }
 if(object(value.drive)){
  requireBackup(identifier(value.drive.id)&&whole(value.drive.size)>0);
  clip.drive={id:value.drive.id,size:value.drive.size,removed:value.drive.removed===true,trashed:value.drive.trashed===true};
 }
 if(Array.isArray(value.postSpeech))clip.postSpeech=value.postSpeech.slice(0,180).filter(s=>object(s)&&seconds(s.start)!==undefined&&seconds(s.end)>s.start&&typeof s.text==='string')
  .map(s=>({start:s.start,end:s.end,text:text(s.text,500)}));
 if(Array.isArray(value.hashtags))clip.hashtags=value.hashtags.filter(tag=>typeof tag==='string'&&/^#[\p{L}\p{N}_]{1,30}$/u.test(tag)).slice(0,100);
 if(object(value.postContext))clip.postContext={game:text(value.postContext.game,160),topics:Array.isArray(value.postContext.topics)?value.postContext.topics.filter(topic=>typeof topic==='string'&&/^[a-z][a-z0-9_]{2,28}$/.test(topic)).slice(0,10):[]};
 if(object(value.postDraft)&&Array.isArray(value.postDraft.tags))clip.postDraft=validatePostDraft({...value.postDraft,tags:value.postDraft.tags.join(' ')});
 if(object(value.youtubeReview))clip.youtubeReview=Object.fromEntries(['candidates','ignored'].map(key=>[key,Array.isArray(value.youtubeReview[key])?value.youtubeReview[key].filter(id=>typeof id==='string'&&/^[\w-]{11}$/.test(id)):[]]));
 if(Array.isArray(value.extraTargets))clip.extraTargets=platforms(value.extraTargets);
 if(value.captioned===true)clip.captioned=true;
 if(clip.drive&&value.recoveredFromDrive===true)clip.recoveredFromDrive=true;
 if(clip.recoveredFromDrive&&['no-speech','sensitive'].includes(value.postCopyRecovery))clip.postCopyRecovery=value.postCopyRecovery;
 // Existing receipts can suppress duplicate sends immediately. A restored receipt
 // alone must never be the basis for removing a file on Drive.
 if(Object.keys(clip.posts).length||value.preserveDrive===true)clip.preserveDrive=true;
 return clip;
}
function savedJob(value){
 requireBackup(object(value)&&identifier(value.id)&&Array.isArray(value.clips));
 const job={id:value.id,...fields(value,['title','sourcePlatform','mediaId','mediaKey','game','sourceTitle','language','continuousId','stage'],text)};
 if(!safeKey(job.mediaKey))delete job.mediaKey;
 job.url=httpsLink(value.url,['youtube.com','www.youtube.com','m.youtube.com','youtu.be','twitch.tv','www.twitch.tv','kick.com','www.kick.com']);
 if(['live','vod'].includes(value.scanMode))job.scanMode=value.scanMode;
 for(const key of ['count','duration','progress'])if(whole(value[key])!==undefined)job[key]=value[key];
 for(const key of ['categories','sourceTags'])if(Array.isArray(value[key]))job[key]=value[key].filter(item=>typeof item==='string').slice(0,150).map(item=>item.slice(0,300));
 job.targets=platforms(value.targets);job.writePosts=value.writePosts===true;job.running=false;
 job.clips=value.clips.map(savedClip);
 requireBackup(new Set(job.clips.map(clip=>clip.file.toLowerCase())).size===job.clips.length);
 if(value.running||value.resumeOnRestart){job.stage='Cortes recuperados de uma análise interrompida.';delete job.progress;}
 return job;
}

export function exportBackup(jobs,memory,generation){
 return {format,version:1,createdAt:new Date().toISOString(),jobs,publications:memory.backup(),generation:generation.backup()};
}
export function readBackup(value){
 requireBackup(object(value)&&value.format===format&&value.version===1&&Array.isArray(value.jobs)&&object(value.publications?.records)&&object(value.publications.published)&&object(value.generation));
 const jobs=value.jobs.map(savedJob);
 requireBackup(new Set(jobs.map(job=>job.id.toLowerCase())).size===jobs.length);
 const records=Object.create(null),published=Object.create(null),generation=Object.create(null);
 for(const [key,raw] of Object.entries(value.publications.records)){
  let parts;
  try{parts=JSON.parse(key);}catch{}
  requireBackup(safeKey(key)&&Array.isArray(parts)&&parts.length===2&&safeKey(parts[0])&&publicationPlatforms.includes(parts[1]));
  records[key]=savedPost(raw,parts[1]);
 }
 for(const [key,raw] of Object.entries(value.publications.published)){
  requireBackup(safeKey(key)&&object(raw)&&object(raw.posts));
  const posts=Object.fromEntries(Object.entries(raw.posts).filter(([p,post])=>publicationPlatforms.includes(p)&&object(post))
   .map(([p,post])=>[p,{link:httpsLink(post.link,postHosts[p])||''}]));
  published[key]={title:text(raw.title),source:text(raw.source),posts};
 }
 for(const [key,rows] of Object.entries(value.generation)){
  requireBackup(safeKey(key)&&Array.isArray(rows));
  generation[key]=rows.map(row=>{
   requireBackup(object(row));
   const result={...fields(row,['start','length'],seconds)};
   if(typeof row.hash==='string'&&/^[\w-]{1,160}$/.test(row.hash))result.hash=row.hash;
   if(typeof row.visual==='string'&&row.visual.length<=12000&&/^[\da-f]+$/i.test(row.visual)&&row.visual.length%16===0)result.visual=row.visual;
   requireBackup(result.hash||result.visual||result.start!==undefined&&result.length>0);
   return result;
  });
 }
 return {jobs,records,published,generation};
}

export function mergeBackup(backup,jobs,memory,generation,busy){
 const byId=new Map(jobs.map(job=>[job.id,job]));
 let restoredJobs=0,restoredClips=0;
 let order=jobs.reduce((last,job)=>job.clips.reduce((max,clip)=>Math.max(max,clip.posting?.order||0),last),0);
 const queued=[];
 const copyReceipt=(clip,platform,receipt)=>{
  const old=clip.posts[platform];
  if(!receipt||old?.state==='Publicado')return;
  if(!old||old.state==='Falhou'&&receipt.state!=='Falhou'){
   clip.posts[platform]=receipt;clip.preserveDrive=true;
  }
 };
 memory.restore(backup.records,backup.published);
 generation.restore(backup.generation);
 for(const restored of backup.jobs){
  let job=byId.get(restored.id);
  if(!job){
   job={...restored,clips:[]};jobs.push(job);restoredJobs++;
  }
  const byFile=new Map(job.clips.map(clip=>[clip.file,clip]));
  for(const incoming of restored.clips){
   let clip=byFile.get(incoming.file);
   if(clip&&(busy(clip)||publicationKey(restored,incoming)!==publicationKey(job,clip)))continue;
   if(!clip){
    clip=incoming;job.clips.push(clip);restoredClips++;
   }else{
    for(const [platform,receipt] of Object.entries(incoming.posts))copyReceipt(clip,platform,receipt);
   }
   if(!clip.drive?.removed&&Number.isSafeInteger(incoming.posting?.order)&&(clip===incoming||!Number.isSafeInteger(clip.posting?.order))){
    queued.push({clip,order:incoming.posting.order});
    clip.posting={targets:incoming.posting.targets,...(incoming.posting.recoveryReview?{recoveryReview:true}:{})};
   }
   const targets=clip.posting?.targets||[];
   for(const platform of targets)copyReceipt(clip,platform,memory.lookup(job,clip,platform));
  }
 }
 queued.sort((a,b)=>a.order-b.order);
 for(const {clip} of queued)clip.posting.order=++order;
 return {jobs:restoredJobs,clips:restoredClips,queued:queued.filter(({clip})=>awaitingPublication(clip)).length};
}
