import {automaticPlatforms,awaitingPublication,canTrashPendingClip,fixedPostingNextAt,publicationQueue,shufflePublications} from './publishing.mjs';
import {captionWithoutTags} from './post-copy.mjs';
import {needsRecoveredCopy} from './recovered-copy.mjs';

const sourceStatuses=new Set([
 'Na fila','Verificando a fonte','Capturando live','Analisando VOD por trechos','Concluída','Pausada',
 'Aguardando a live começar','Aguardando o replay ficar disponível','Aguardando a próxima live do canal',
 'Esta transmissão já está em outra fonte da fila','Aguardando o próximo lote','Pausada · aguardando retomada',
 'Canal offline · aguardando nova live','Canal offline · aguardando a live','Clipagem parada','Clipagem parada · aguardando outra live',
]);

function sourceLabel(value){
 const url=URL.parse(value);
 if(!url)return 'Link indisponível';
 const video=url.pathname==='/watch'&&url.searchParams.get('v');
 return (url.hostname.replace(/^www\./,'')+url.pathname+(video&&/^[\w-]+$/.test(video)?'?v='+video:'')).slice(0,200);
}

function panelCopy(clip){
 const tags=clip.postDraft?.tags||clip.hashtags||[];
 const hashtags=Array.isArray(tags)?tags.filter(tag=>typeof tag==='string'&&/^#[\p{L}\p{N}_]{1,40}$/u.test(tag)).slice(0,15):[];
 const description=clip.postDraft?.text??captionWithoutTags(String(clip.description||''),hashtags);
 return {
  description:description.slice(0,420),
  hashtags,
 };
}

export function panelSnapshot(jobs,publications,results=[],continuous={}){
 const now=Date.now();
 const queue=publicationQueue(jobs);
 const queued=new Set(queue.map(({clip})=>clip));
 const other=jobs.flatMap(job=>job.clips.flatMap((clip,index)=>!queued.has(clip)&&clip.drive?.id&&(!clip.drive.removed||clip.drive.trashed)?[{job,clip,index}]:[]));
 return {
  updatedAt:now,enabled:publications.automatic?.enabled===true,
  nextAt:publications.fixedPosting?fixedPostingNextAt(publications.fixedPosting):Number.isSafeInteger(publications.nextAt)&&publications.nextAt>0?publications.nextAt:0,
  fixedHours:!!publications.fixedPosting,
  platforms:automaticPlatforms.filter(platform=>publications.automatic?.configs?.[platform]),
  total:queue.length+other.length,results:results.slice(-12),
  generation:{enabled:continuous.enabled===true,autoQueue:continuous.autoQueue?.enabled===true,
   sources:(continuous.sources||[]).map(source=>({
    label:sourceLabel(source.url),follow:source.follow===true,
    status:sourceStatuses.has(source.status)?source.status:'Não foi possível consultar a fonte',
    clips:jobs.filter(job=>job.continuousId===source.id).reduce((count,job)=>count+job.clips.length,0),
   })),
  },
  clips:[...queue,...other].map(({job,clip,index})=>({
   job:job.id,index,revision:clip.revision||0,title:String(clip.postDraft?.title||clip.title||'Corte sem título').slice(0,180),
   ...panelCopy(clip),
   ...(queued.has(clip)&&needsRecoveredCopy(clip)?{copyRecovery:clip.postCopyRecovery||'pending'}:{}),
   seconds:Math.round(clip.length||0),queued:queued.has(clip),review:clip.posting?.recoveryReview===true,
   targets:clip.posting?.targets?.filter(platform=>automaticPlatforms.includes(platform))||[],
   posts:Object.fromEntries(automaticPlatforms.filter(platform=>clip.posts[platform]?.state).map(platform=>[platform,clip.posts[platform].state])),
   safety:clip.safety?.status||'',drive:!clip.drive?.removed&&!clip.drive?.trashed&&/^[\w-]{5,200}$/.test(clip.drive?.id||'')?clip.drive.id:'',
   ...(clip.drive?.trashed?{trashed:true}:canTrashPendingClip(job,clip,publications.records,now)?{canTrash:true}:{}),
  })),
 };
}

export async function applyPanelCommands(commands,results,{jobs,memory,changeSelection,addSource,setGenerationEnabled,changeTrash,save}){
 const applied=new Set(results.map(result=>result.id));
 for(const command of commands){
  if(applied.has(command.id))continue;
  applied.add(command.id);
  let ok=true,review=false;
  try{
   if(command.action==='add-live'){
    await addSource(command);
   }else if(command.action==='generation-enabled'){
    if(typeof command.enabled!=='boolean')throw Error();
    setGenerationEnabled(command.enabled);
   }else if(command.action==='shuffle'){
    shufflePublications(publicationQueue(jobs));
    save();
   }else if(command.action==='enabled'){
    if(typeof command.enabled!=='boolean'||command.enabled&&!Object.keys(memory.automaticSettings().configs).length)throw Error();
    memory.setAutomaticEnabled(command.enabled);
   }else if(command.action==='trash-video'||command.action==='restore-video'){
    if(command.consent!==true)throw Error();
    await changeTrash(command,command.action==='trash-video');
   }else if(command.action==='select'||command.action==='remove'){
    const configs=memory.automaticSettings().configs;
    if(command.action==='select'&&(!Array.isArray(command.targets)||command.targets.some(p=>!automaticPlatforms.includes(p)||!configs[p])))throw Error();
    const tiktokInbox=command.action==='select'&&command.targets.includes('tiktok');
    await changeSelection({...command,tiktokInbox,tiktokAccount:tiktokInbox?configs.tiktok.channel:undefined},command.action==='remove');
   }else if(command.action==='up'||command.action==='down'){
    const queue=publicationQueue(jobs);
    const position=queue.findIndex(({job,clip,index})=>job.id===command.job&&index===command.index&&(clip.revision||0)===command.revision);
    const current=queue[position]?.clip, neighbor=queue[position+(command.action==='up'?-1:1)]?.clip;
    if(!current||!neighbor||!awaitingPublication(current))throw Error();
    [current.posting.order,neighbor.posting.order]=[neighbor.posting.order,current.posting.order];
    save();
   }else throw Error();
  }catch{
   ok=false;
   const clip=jobs.find(job=>job.id===command.job)?.clips[command.index];
   review=command.action==='select'&&clip?.safety?.status!=='approved';
  }
  results.push({id:command.id,action:command.action,ok,review});
 }
 return results.slice(-64);
}
