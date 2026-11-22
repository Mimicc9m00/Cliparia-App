import fs from 'node:fs';
import crypto from 'node:crypto';
import {isLive} from './media.mjs';
import {publicationPlatforms} from './publishing.mjs';
import {assertScreened} from './safety.mjs';

const pollDelay=60_000;
const defaultLimit=2;
const batchSourceChecks=4;
const activeStatuses=new Set(['Verificando a fonte','Capturando live','Analisando VOD por trechos']);
export function channelLink(url){
 let u;
 try{u=new URL(url);}catch{return false;}
 if(u.protocol!=='https:'||u.username||u.password||u.port)return false;
 const route=u.pathname.replace(/\/+$/,'');
 if(['twitch.tv','www.twitch.tv'].includes(u.hostname))return /^\/[A-Za-z0-9_]+$/.test(route)&&!/^\/(videos|directory|downloads|search)$/i.test(route);
 if(['kick.com','www.kick.com'].includes(u.hostname))return /^\/[A-Za-z0-9_-]+$/.test(route)&&!/^\/(video|videos|clips|categories|search|auth|browse|following|settings|dashboard|login|register)$/i.test(route)&&!u.searchParams.has('clip');
 return ['youtube.com','www.youtube.com','m.youtube.com'].includes(u.hostname)&&/^\/(?:@[^/]+|(?:channel|c|user)\/[^/]+)\/live$/i.test(route);
}
export function createContinuous(file,{sourceInfo,launch,stop,connected,batchOnly=false}){
 const data=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{enabled:false,sources:[]};
 data.limit??=defaultLimit;
 data.autoQueue??={enabled:false,targets:[]};
 const active=new Map();
 const busyKeys=new Set();
 let batchWork;
 const save=()=>{
  fs.writeFileSync(file+'.tmp',JSON.stringify(data));
  fs.renameSync(file+'.tmp',file);
 };
 // Sources completed under the old clip cap need to inspect the remaining
 // video once. Explicitly stopped sources remain stopped.
 if(!data.exhaustiveVersion){
  for(const source of data.sources){
   if(/^Clipagem parada/.test(source.status||''))continue;
   source.done=false;delete source.lastKey;
   source.config={...source.config,liveBlocks:true};
  }
  data.exhaustiveVersion=1;save();
 }
 for(const source of data.sources){
  if(!source.done&&activeStatuses.has(source.status))source.status='Aguardando o próximo lote';
 }
 function update(source,status,delay=0){
  source.status=status;
  source.retryAt=Date.now()+delay;
  save();
 }
 function cancel(source){
  const item=active.get(source.id);
  if(item?.job?.live&&item.job.running){
   try{stop(item.job.id);}catch{/* Capture may have just closed. */}
  }
 }
 async function work(source,item){
  source.checkedAt=Date.now();
  update(source,'Verificando a fonte');
  let key,locked=false;
  try{
   const meta=await sourceInfo(source.url);
   if(item.cancelled)return;
   if(!data.enabled)return update(source,'Pausada');
   if(meta.live_status==='is_upcoming'||meta.live_status==='post_live'){
    return update(source,meta.live_status==='is_upcoming'?'Aguardando a live começar':'Aguardando o replay ficar disponível',pollDelay);
   }
   const live=isLive(meta);
   source.vod=!live;
   if(source.follow&&!live)return update(source,'Aguardando a próxima live do canal',pollDelay);
   key=(meta.extractor_key||meta.extractor||new URL(source.url).hostname)+':'+(meta.id||source.url);
   if(source.lastKey===key)return update(source,'Aguardando a próxima live do canal',pollDelay);
   if(busyKeys.has(key)){
    key=undefined;
    return update(source,'Esta transmissão já está em outra fonte da fila',pollDelay);
   }
   busyKeys.add(key);locked=true;
   update(source,live?'Capturando live':'Analisando VOD por trechos');
   const outcome=await launch(source,meta,key,item,()=>!data.enabled||item.cancelled);
   if(!item.cancelled&&!outcome?.manual){
    if(outcome?.stopped)update(source,data.enabled?'Aguardando o próximo lote':'Pausada · aguardando retomada');
    else{
     source.lastKey=key;
     source.done=!source.follow;
     update(source,source.done?'Concluída':'Aguardando a próxima live do canal',source.done?0:pollDelay);
    }
   }
   return true;
  }catch(error){
   if(!item.cancelled){
    const offline=/not currently live|not live right now|not live streaming|channel is offline|no live streams|não está ao vivo/i.test(error.message);
    update(source,offline?(source.follow?'Canal offline · aguardando nova live':'Canal offline · aguardando a live'):error.message,pollDelay);
   }
   return locked;
  }finally{
   if(locked)busyKeys.delete(key);
   active.delete(source.id);
  }
 }
 function start(source){
  const item={};
  active.set(source.id,item);
  return work(source,item).catch(error=>{console.error('Falha na fila contínua:',error.message);return true;});
 }
 function tick({batch=false}={}){
  if(batchOnly&&!batch||!data.enabled||!connected())return;
  if(batch&&batchWork)return batchWork;
  const available=data.sources.filter(s=>!s.done&&!active.has(s.id)&&(s.retryAt||0)<=Date.now())
   .sort((a,b)=>(batch?0:Number(!!b.vod||/twitch\.tv\/videos\//i.test(b.url))-Number(!!a.vod||/twitch\.tv\/videos\//i.test(a.url)))||(a.checkedAt||0)-(b.checkedAt||0));
  if(batch){
   if(active.size)return;
   batchWork=(async()=>{
    for(const source of available.slice(0,batchSourceChecks)){
     if(!data.enabled||!connected())break;
     if(data.sources.includes(source)&&await start(source))break;
    }
   })().finally(()=>{batchWork=undefined;});
   return batchWork;
  }
  if(!batchWork)available.slice(0,Math.max(0,data.limit-active.size)).forEach(start);
 }
 return {
  tick,
  status(){return {enabled:data.enabled,connected:connected(),simultaneous:data.limit,autoQueue:data.autoQueue,sources:data.sources.map(({id,url,follow,done,status})=>({id,url,follow,done,status,active:active.has(id)}))};},
  setAutoQueue(enabled,targets){
   if(typeof enabled!=='boolean'||!Array.isArray(targets)||targets.some(platform=>!publicationPlatforms.includes(platform)))throw Error('Confira a adição automática e os destinos selecionados.');
   if(enabled&&!targets.length)throw Error('Selecione ao menos um destino para os cortes do Contínuo.');
   data.autoQueue={enabled,targets:[...new Set(targets)]};
   save();
  },
  postingTargets(job,clip){
   if(!data.autoQueue.enabled||!job.continuousId||!clip.drive?.id||clip.drive.removed||clip.posting)return [];
   assertScreened(clip);
   const targets=data.autoQueue.targets.filter(platform=>platform!=='facebook'||clip.length<=90);
   if(!targets.length)throw Error('O Facebook aceita cortes de até 90 segundos.');
   return targets;
  },
  markStopped(id,key){
   const source=data.sources.find(s=>s.id===id);
   if(!source)return;
   source.lastKey=key;
   source.done=!source.follow;
   update(source,source.follow?'Clipagem parada · aguardando outra live':'Clipagem parada',source.follow?pollDelay:0);
  },
  setEnabled(enabled){
   if(typeof enabled!=='boolean')throw Error('Estado inválido para o modo contínuo.');
   data.enabled=enabled;
   if(!enabled)for(const source of data.sources)cancel(source);
   save();tick();
  },
  setLimit(limit){
   if(!Number.isInteger(limit)||limit<1||limit>4)throw Error('Escolha de uma a quatro fontes simultâneas.');
   data.limit=limit;save();tick();
  },
  add(url,config,follow){
   if(data.sources.some(s=>s.url===url))throw Error('Esta fonte já está na fila. Remova-a para cadastrar uma nova configuração.');
   if(follow&&!channelLink(url))throw Error('Para acompanhar novas lives, use o link do canal da Twitch ou da Kick, ou o link do canal do YouTube terminado em /live.');
   const source={id:crypto.randomUUID(),url,config:{...config,liveBlocks:true},follow,status:'Na fila',done:false};
   data.sources.push(source);save();tick();
  },
  remove(id){
   const i=data.sources.findIndex(s=>s.id===id);
   if(i<0)throw Error('Fonte indisponível.');
   const source=data.sources[i],item=active.get(id);
   if(item)item.cancelled=true;
   cancel(source);
   data.sources.splice(i,1);save();
  }
 };
}
