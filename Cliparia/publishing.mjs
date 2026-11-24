import fs from 'node:fs';

export const publicationInterval=15*60_000;
export const automaticPlatforms=['youtube','instagram','facebook','tiktok'];
export const publicationPlatforms=[...automaticPlatforms,'kwai'];
const inboxLimit='spam_risk_too_many_pending_share';
const inboxRetryDelay=60*60_000;
const hour=60*60_000;
const fixedPostingWindow=30*60_000;
const brasiliaHour=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',hourCycle:'h23'});

function postingHour(now,direction){
 let at=Math.floor(now/hour)*hour+(direction===1?hour:0);
 while(Number(brasiliaHour.format(at))%8!==0)at+=direction*hour;
 return at;
}

export function fixedPostingNextAt(schedule,now=Date.now()){
 const current=postingHour(now,-1);
 if(schedule.from<=current&&schedule.slotAt!==current&&now<current+fixedPostingWindow)return current;
 return Math.max(schedule.from,postingHour(now,1));
}
export function tiktokInboxApproved(clip,config){
 const approval=clip.posting?.tiktokInbox;
 return config?.mode==='inbox'&&!!config.channel&&approval?.channel===config.channel&&approval.revision===(clip.revision||0);
}
export function tiktokInboxAvailable(account,config){
 return account?.connected&&config?.mode==='inbox'&&!!config.channel&&account.inboxAccount===config.channel&&account.scopes?.split(/[ ,]+/).includes('video.upload');
}
export function clipTargets(job,clip){
 return clip.posting?.targets??[...new Set([...(job.targets||[]),...(clip.extraTargets||[])])];
}
export function awaitingPublication(clip){
 return Number.isSafeInteger(clip.posting?.order)&&(clip.posting.recoveryReview===true||clip.posting.targets.some(p=>clip.posts[p]?.state!=='Publicado'));
}
export function publicationQueue(jobs){
 return jobs.flatMap(job=>job.clips.flatMap((clip,index)=>awaitingPublication(clip)?[{job,clip,index}]:[]))
  .sort((a,b)=>a.clip.posting.order-b.clip.posting.order);
}
export function shufflePublications(queue,random=Math.random){
 const orders=queue.map(({clip})=>clip.posting.order);
 for(let i=orders.length-1;i>0;i--){
  const j=Math.floor(random()*(i+1));
  [orders[i],orders[j]]=[orders[j],orders[i]];
 }
 if(orders.length>1&&queue.every(({clip},i)=>clip.posting.order===orders[i]))orders.push(orders.shift());
 queue.forEach(({clip},i)=>{clip.posting.order=orders[i];});
}
function clearLegacyYouTubeWait(post){
 if(post.state!=='Aguardando limite do YouTube'||post.id)return false;
 Object.assign(post,{state:'Falhou',reason:'uploadLimitExceeded',detail:'O YouTube atingiu o limite de uploads da conta. O corte continua salvo para uma nova tentativa manual.'});
 delete post.retryAt;
 return true;
}
export function deferredInstagramPost(reason='instagram_token_invalid',now=Date.now(),previous){
 if(reason==='instagram_link_unavailable'){
  const attempts=previous?.reason===reason?Math.min(4,(previous.linkAttempts||0)+1):1;
  return {state:'Aguardando link do Instagram',reason,linkAttempts:attempts,retryAt:now+Math.min(30,5*2**(attempts-1))*60_000,detail:'O corte está salvo na fila. Com a publicação automática ativa, o Cliparia tenta novamente quando houver um link público para o vídeo.'};
 }
 if(reason==='instagram_profile_unavailable')return {state:'Aguardando conexão com o Instagram',reason,retryAt:now+5*60_000,detail:'A Meta ficou temporariamente indisponível antes do envio. O corte continua na fila.'};
 return {state:'Aguardando reconexão do Instagram',reason,detail:reason==='instagram_account_access_denied'
  ?'A Meta recusou o acesso deste app ao usuário (código 200). Confira o acesso em Contas → Instagram.'
  :'O corte continua salvo e pode ser enviado após a reconexão.'};
}
function retryPending(post){
 if(!post||post.id)return false;
 return post.state==='Aguardando reconexão do Instagram'&&['instagram_token_invalid','instagram_account_access_denied'].includes(post.reason)||
  post.state==='Aguardando conexão com o Instagram'&&post.reason==='instagram_profile_unavailable'||
  post.state==='Aguardando link do Instagram'&&post.reason==='instagram_link_unavailable'||
  post.state==='Aguardando vaga no TikTok'&&post.reason===inboxLimit;
}
const timedPublication=(job,clip,scheduled)=>scheduled||job.continuousId&&!clip.posting;
export function retryablePost(post){return !post||post.state==='Falhou'||retryPending(post);}
export function publicationKey(job,clip){
 if(clip.recoveredFromDrive&&clip.drive?.id)return 'drive:'+clip.drive.id;
 // Live offsets can restart after history is cleared; use the captured content.
 if(job.scanMode==='live'&&clip.contentHash)return 'content:'+clip.contentHash;
 const source=job.mediaKey||(job.sourcePlatform&&job.mediaId?job.sourcePlatform+':'+job.mediaId:job.url||job.id);
 const normalized=source.replace(/^([^:]+):/,(_,provider)=>provider.toLowerCase()+':');
 return JSON.stringify([normalized,clip.originalStart??clip.start,clip.originalLength??clip.length]);
}
function publishedLink(platform,post){
 if(platform==='youtube'&&/^[\w-]{11}$/.test(post.id||''))return 'https://www.youtube.com/watch?v='+post.id;
 if(platform==='instagram'&&/^https:\/\/www\.instagram\.com\/reel\/[\w-]{1,64}\/$/.test(post.link||''))return post.link;
 if(platform==='kwai'&&post.link){
  const url=URL.parse(post.link);
  if(url?.protocol==='https:'&&!url.username&&!url.password&&!url.port&&['kwai.com','www.kwai.com','m.kwai.com','k.kwai.com','s.kwai.com'].includes(url.hostname))return url.href;
 }
 return '';
}
export function createPublicationMemory(file,{now=Date.now,fixedHours=false}={}){
 const data=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{nextAt:0,slot:null,records:{}};
 data.intervalMinutes??=publicationInterval/60_000;
 data.automatic??={enabled:false,configs:{}};
 const interval=()=>data.intervalMinutes*60_000;
 const save=()=>{fs.writeFileSync(file+'.tmp',JSON.stringify(data));fs.renameSync(file+'.tmp',file);};
 const published=data.published??={};
 let migrated=false;
 if(fixedHours&&!data.fixedPosting){
  data.fixedPosting={from:postingHour(now(),1),slotAt:null};
  migrated=true;
 }
 const fixedPosting=fixedHours?data.fixedPosting:null;
 if(data.cooldowns&&Object.hasOwn(data.cooldowns,'youtube')){delete data.cooldowns.youtube;migrated=true;}
 for(const post of Object.values(data.records))migrated=clearLegacyYouTubeWait(post)||migrated;
 // Clear a legacy countdown only when it matches a later inbox retry and the original sends already had their interval.
 const slotTikTok=data.records[JSON.stringify([data.slot,'tiktok'])];
 if(!data.manuallyRestarted&&data.nextAt>now()&&slotTikTok){
  const waitingForSpace=slotTikTok.reason===inboxLimit;
  const retryAllowedAt=data.cooldowns?.tiktok?.until;
  const acceptedAfterWait=slotTikTok.mode==='inbox'&&slotTikTok.id&&retryAllowedAt&&slotTikTok.startedAt>=retryAllowedAt;
  const retriedAt=waitingForSpace?slotTikTok.retryAt-inboxRetryDelay:acceptedAfterWait?slotTikTok.startedAt:0;
  const lastOtherSend=Math.max(0,...automaticPlatforms.filter(p=>p!=='tiktok').map(p=>{
   const post=data.records[JSON.stringify([data.slot,p])];
   return post?.state==='Publicado'?post.startedAt||0:0;
  }));
  const offset=data.nextAt-(retriedAt+interval());
  if(retriedAt&&lastOtherSend&&lastOtherSend+interval()<=retriedAt&&offset>=0&&offset<=(waitingForSpace?5000:120_000)){
   data.nextAt=now();
   migrated=true;
  }
 }
 if(migrated)save();
 function rememberPublished(key,platform,post,title,source){
  const entry=published[key];
  const link=publishedLink(platform,post)||entry?.posts[platform]?.link||'';
  const next={title:title||entry?.title||post.title,source:source||entry?.source,posts:{...entry?.posts,[platform]:{link}}};
  if(JSON.stringify(entry)===JSON.stringify(next))return false;
  published[key]=next;
  return true;
 }
 // Rebuild the list from older continuous-mode records, even if jobs were cleared.
 for(const [record,post] of Object.entries(data.records)){
  if(post.state!=='Publicado')continue;
  const [canonical,platform]=JSON.parse(record);
  const key=post.publishedKey||canonical;
  if(!published[key]?.posts[platform])rememberPublished(key,platform,post);
 }
 const keyFor=(job,clip,platform)=>JSON.stringify([publicationKey(job,clip),platform]);
 return {
  backup:()=>({records:data.records,published}),
  restore(records,entries){
   let changed=false;
   for(const [key,record] of Object.entries(records)){
    const current=data.records[key];
    if(!current||current.state!=='Publicado'&&record.state==='Publicado'||current.state==='Falhou'&&record.state!=='Falhou'){
     data.records[key]=record;changed=true;
    }
   }
   for(const [key,entry] of Object.entries(entries))for(const [platform,post] of Object.entries(entry.posts)){
    if(!published[key]?.posts[platform])changed=rememberPublished(key,platform,post,entry.title,entry.source)||changed;
   }
   if(changed)save();
  },
  lookup(job,clip,platform){
   if(!job.continuousId&&!clip.posting)return null;
   const record=data.records[keyFor(job,clip,platform)];
   if(!record||record.state==='Falhou'||retryPending(record))return null;
   const {publishedKey,...result}=record;
   if(result.state==='Enviando')result.state=result.id?'Em processamento':'Resultado incerto. Confira o perfil.';
   return result;
  },
  canSend(job,clip,scheduled=false){
   if(fixedPosting&&scheduled){
    const time=now(),current=postingHour(time,-1);
    return time<current+fixedPostingWindow&&fixedPosting.from<=current&&
     (fixedPosting.slotAt!==current||data.slot===publicationKey(job,clip));
   }
   return !timedPublication(job,clip,scheduled)||now()>=data.nextAt||data.slot===publicationKey(job,clip);
  },
  scheduledAt(job,clip){
   if(fixedPosting)return this.canSend(job,clip,true)?0:fixedPostingNextAt(fixedPosting,now());
   return data.slot===publicationKey(job,clip)?0:data.nextAt;
  },
  readyToSend(post){return !post||retryPending(post)&&(!post.retryAt||now()>=post.retryAt);},
  tiktokInboxAt(channel){return data.cooldowns?.tiktok?.channel===channel?data.cooldowns.tiktok.until:0;},
  tiktokInboxReady(channel){return this.tiktokInboxAt(channel)<=now();},
  deferTikTokInbox(job,clip,channel){
   const retryAt=now()+inboxRetryDelay;
   (data.cooldowns??={}).tiktok={channel,until:retryAt};
   const post={state:'Aguardando vaga no TikTok',mode:'inbox',account:channel,reason:inboxLimit,retryAt,detail:'Há vários envios pendentes no TikTok. Conclua os vídeos pela caixa de entrada para liberar espaço.'};
   data.records[keyFor(job,clip,'tiktok')]=post;save();
   return post;
  },
  deferInstagram(job,clip,reason,previous){
   const post=deferredInstagramPost(reason,now(),previous);
   if(job.continuousId||clip.posting){data.records[keyFor(job,clip,'instagram')]=post;save();}
   return post;
  },
  reserve(job,clip,platform,scheduled=false){
   if(!scheduled&&!job.continuousId&&!clip.posting)return;
   const key=publicationKey(job,clip);
   const timed=timedPublication(job,clip,scheduled);
   const fixed=scheduled&&fixedPosting;
   const inboxRetry=scheduled&&platform==='tiktok'&&clip.posts.tiktok?.reason===inboxLimit&&retryPending(clip.posts.tiktok);
   if(timed&&!this.canSend(job,clip,scheduled))throw Error(fixed?'Aguarde o próximo horário de postagem.':'Aguarde o intervalo de '+data.intervalMinutes+' minutos da fila de postagem. Próximo envio a partir de '+new Date(data.nextAt).toLocaleString('pt-BR')+'.');
   if(timed&&!inboxRetry){
    if(data.slot!==key)delete data.manuallyRestarted;
    data.slot=key;
    if(fixed)fixed.slotAt=postingHour(now(),-1);
    else if(!data.manuallyRestarted)data.nextAt=Math.max(data.nextAt,now()+interval());
   }
   data.records[keyFor(job,clip,platform)]={state:'Enviando',startedAt:now()};
   save(); // Persist before contacting a platform, including uncertain outcomes.
   return timed&&!inboxRetry&&!fixed;
  },
  finish(job,clip,scheduled=false){
   if(timedPublication(job,clip,scheduled)&&!data.manuallyRestarted&&data.slot===publicationKey(job,clip)){
    data.nextAt=Math.max(data.nextAt,now()+interval());save();
   }
  },
  setIntervalMinutes(minutes){
   if(!Number.isInteger(minutes)||minutes<1||minutes>1440)throw Error('Escolha um intervalo inteiro entre 1 e 1440 minutos.');
   if(minutes===data.intervalMinutes)return this.status();
   data.intervalMinutes=minutes;
   if(data.nextAt>now())return this.restartCountdown();
   save();
   return this.status();
  },
  restartCountdown(duration=interval()){
   data.nextAt=duration===0?0:now()+duration;
   data.manuallyRestarted=true;
   save();
   return this.status();
  },
  automaticSettings(){return data.automatic;},
  setAutomaticEnabled(enabled){data.automatic.enabled=enabled;save();},
  setAutomaticConfig(platform,config){
   if(config)data.automatic.configs[platform]=config;
   else delete data.automatic.configs[platform];
   if(!Object.keys(data.automatic.configs).length)data.automatic.enabled=false;
   save();
  },
  remember(jobs){
   let changed=false;
   for(const job of jobs){
    for(const clip of job.clips)for(const [platform,post] of Object.entries(clip.posts||{})){
     const key=keyFor(job,clip,platform),old=data.records[key];
     const canonical=publicationKey(job,clip);
     const publishedKey=old?.publishedKey||(job.continuousId||published[canonical]?canonical:JSON.stringify(['studio',job.id,canonical]));
     if(post.state==='Publicado'){
      const title=clip.previousPostTitle&&published[publishedKey]?.title||clip.title;
      changed=rememberPublished(publishedKey,platform,post,title,job.title)||changed;
     }
     if(platform==='youtube')changed=clearLegacyYouTubeWait(post)||changed;
     if(platform==='instagram'&&!post.id&&post.state==='Falhou'&&post.reason==='instagram_upload_processing_failed'&&post.detail?.includes('O endereço HTTPS do Reel ainda não está acessível pela internet.')){
      Object.assign(post,deferredInstagramPost('instagram_link_unavailable',now()));changed=true;
     }
     if(platform==='instagram'&&!post.id&&post.state==='Falhou'&&post.reason==='instagram_connection_interrupted'&&post.detail?.startsWith('Instagram · validar a conta')){
      Object.assign(post,deferredInstagramPost('instagram_profile_unavailable',now()));changed=true;
     }
     if(platform==='instagram'&&post.state==='Falhou'&&(post.reason==='instagram_token_invalid'||/session has expired|validating access token|190\/463/i.test(post.detail||''))){
      if(!post.id){Object.assign(post,deferredInstagramPost());changed=true;}
      else if(post.account){
       post.state='Em processamento';
       post.detail='Aguardando autorização para consultar o Reel existente.';
       delete post.publishRequested;
       changed=true;
      }
     }
     if(!job.continuousId&&!clip.posting&&post.state!=='Publicado'&&!post.id)continue;
     if(!post.state)continue;
     if(old?.state==='Publicado'&&post.state!=='Publicado')continue;
     if(platform==='youtube'&&post.state==='Falhou'&&post.reason==='uploadLimitExceeded'&&!post.id&&old?.id&&!retryablePost(old))continue;
     if(retryPending(post)&&old&&!retryPending(old)&&old.state!=='Falhou')continue;
     const record={...post,startedAt:old?.startedAt||post.startedAt||0,...(publishedKey!==canonical?{publishedKey}:{})};
     if(JSON.stringify(old)!==JSON.stringify(record)){data.records[key]=record;changed=true;}
    }
   }
   if(changed)save();
  },
  publishedClips(){return Object.values(published).reverse();},
  status(){return {intervalMinutes:data.intervalMinutes,nextAt:fixedPosting?fixedPostingNextAt(fixedPosting,now()):data.nextAt,remembered:Object.values(data.records).filter(p=>p.state==='Publicado').length};}
 };
}

export function describeQueue(jobs,memory,accounts,busy,available,now=Date.now()){
 const settings=memory.automaticSettings(),rows={};
 let next,attention=0,sending=0,total=0;
 function describe(job,clip,platform){
  const post=clip.posts[platform]||memory.lookup(job,clip,platform);
  if(post?.state==='Publicado')return {kind:'published',label:'Publicado'};
  if(post?.state==='Abra a caixa de entrada do TikTok')return {kind:'attention',label:post.inboxMissing?'Notificação não localizada':'TikTok informou o envio da notificação',action:'review'};
  if(post&&['Enviando','Enviado','Em processamento','Confirmação pendente'].includes(post.state))return {kind:'sending',label:post.state};
  if(!available(job,clip))return {kind:'attention',label:clip.drive?.trashed?'Na lixeira do Drive':'Arquivo indisponível',unavailable:true};
  if(post?.reason==='posting_text_blocked')return {kind:'attention',label:'Texto precisa de revisão',action:'edit'};
  if(post?.state==='Falhou')return {kind:'attention',label:'Falhou',action:platform==='youtube'?'retry-youtube':'review'};
  if(post&&!retryPending(post))return {kind:'attention',label:post.state,action:'review'};
  if(platform==='youtube'&&clip.youtubeReview?.candidates?.length)return {kind:'attention',label:'Possível publicação existente',action:'retry-youtube'};
  if(['blocked','error'].includes(clip.safety?.status))return {kind:'attention',label:clip.safety.status==='blocked'?'Conteúdo bloqueado':'Verificação de conteúdo incompleta',action:'review'};
  if(busy(clip)||clip.safety?.status==='checking')return {kind:'waiting',label:'Corte em revisão'};
  if(platform==='kwai')return {kind:'manual',label:'Publicação manual',action:'review'};
  if(!accounts[platform]?.connected)return {kind:'attention',label:accounts[platform]?.needsReconnect?'Reconexão necessária':'Conta desconectada',action:'accounts'};
  const config=settings.configs[platform];
  if(!config)return platform==='youtube'
   ?{kind:'attention',label:'Configure o envio automático',action:'configure'}
   :{kind:'manual',label:'Publicação manual',action:'review'};
  if(platform==='tiktok'){
   if(!tiktokInboxAvailable(accounts.tiktok,config))return {kind:'attention',label:'Confira a conta do TikTok',action:'configure'};
   if(!tiktokInboxApproved(clip,config))return {kind:'manual',label:'Autorize o envio ao TikTok',action:'select'};
  }
  if(!settings.enabled)return {kind:'waiting',label:'Automático pausado'};
  const inboxAt=platform==='tiktok'?memory.tiktokInboxAt(config.channel):0;
  const at=Math.max(memory.scheduledAt(job,clip)||0,post?.retryAt||0,inboxAt);
  return {kind:'waiting',label:inboxAt>now?'Aguardando vaga no TikTok':post?.retryAt>now?'Aguardando nova tentativa':at>now?'Aguardando intervalo':'Elegível para envio',at};
 }
 for(const {job,clip,index} of publicationQueue(jobs)){
  const platforms=rows[job.id+'/'+index]={};
  const scheduled=[];
  for(const platform of clip.posting.targets){
   const status=platforms[platform]=describe(job,clip,platform);
   if(status.kind!=='published')total++;
   if(status.kind==='attention')attention++;
   if(status.kind==='sending')sending++;
   if(status.at!==undefined)scheduled.push({platform,at:status.at});
  }
  if(!scheduled.length)continue;
  const at=Math.min(...scheduled.map(entry=>entry.at));
  if(!next||Math.max(at,now)<Math.max(next.at,now))next={job:job.id,index,at,platforms:scheduled.filter(entry=>Math.max(entry.at,now)===Math.max(at,now)).map(entry=>entry.platform)};
 }
 return {rows,next,total,attention,sending};
}

export function createAutoPublisher({jobs,memory,editing,send,fields,save,platformAvailable=()=>true,clipAvailable=(_job,clip)=>!clip.drive?.removed,verifyYouTube=()=>{},onError=()=>{}}){
 let sending=false;
 return async function tick(){
  const settings=memory.automaticSettings();
  if(sending||!settings.enabled)return;
  sending=true;
  try{
   let youtubeVerified;
   for(const {job,clip} of publicationQueue(jobs)){
    if(!jobs.includes(job)||!clipAvailable(job,clip)||editing.has(clip)||['blocked','error','checking'].includes(clip.safety?.status))continue;
    const selection=clip.posting;
    for(const platform of selection.targets){
     const config=settings.configs[platform];
     if(!config||!memory.readyToSend(clip.posts[platform]))continue;
     const canStart=()=>settings.enabled&&settings.configs[platform]===config&&jobs.includes(job)&&clip.posting===selection&&awaitingPublication(clip)&&!editing.has(clip)&&platformAvailable(platform,config)&&memory.canSend(job,clip,true)&&
      (platform!=='tiktok'||tiktokInboxApproved(clip,config)&&memory.tiktokInboxReady(config.channel));
     if(!settings.enabled||clip.posting!==selection||!awaitingPublication(clip))break;
     const known=memory.lookup(job,clip,platform);
     if(known){clip.posts[platform]=known;save();continue;}
     if(!canStart())continue;
     if(platform==='youtube'){
      youtubeVerified??=Promise.resolve().then(()=>verifyYouTube()).then(()=>true,error=>{onError(error);return false;});
      if(!await youtubeVerified||clip.posts.youtube||clip.youtubeReview?.candidates?.length||!canStart())continue;
     }
     try{await send(job,clip,null,platform,{...config,...fields(platform,config,job,clip),consent:true},canStart);}
     catch(error){onError(error);}
    }
   }
  }catch(error){onError(error);}
  finally{sending=false;}
 };
}
