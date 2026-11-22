import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {monitor,inputFor,liveInput} from './live.mjs';
import {adjoiningRegion,cropRegion} from './layout.mjs';
import {automaticLayout,webcamInUpperRight} from './vision.mjs';
import {hotRanges,probeRanges} from './scout.mjs';
import {overlayHook,postSpeech,applyPostCopy} from './post-copy.mjs';
import {run,transcribe,captionsAss,modelAvailable} from './speech.mjs';
import * as drive from './drive.mjs';
import {rankedMoments,selectMoments,probeMoments} from './highlights.mjs';
import {scanSignals,clipInput} from './signals.mjs';
import {withH264} from './encoder.mjs';
import {ranges,analysisSlot,scanCompleteVod} from './scan.mjs';
import {mediaFormats,remoteAccess} from './remote.mjs';
import {screenClip} from './safety.mjs';
import {frameSignature,visualRange} from './generation-history.mjs';

export const minimum=40;
const batchLimit=768*1024*1024;
const sourceHosts=['youtube.com','www.youtube.com','m.youtube.com','youtu.be','twitch.tv','www.twitch.tv','kick.com','www.kick.com'];
export function sourceURL(value){
 const message='Cole um link HTTPS do YouTube, da Twitch ou da Kick.';
 let url;
 try{url=new URL(value);}catch{throw Error(message);}
 if(url.protocol!=='https:'||!sourceHosts.includes(url.hostname)||url.username||url.password||url.port)throw Error(message);
 return url.href;
}
export function isLive(meta){return !!meta.is_live||meta.live_status==='is_live';}
export async function sourceInfo(url,format=mediaFormats.standard,signal){
 return JSON.parse(await run('yt-dlp',['--ignore-config','--no-cache-dir','--no-playlist','--no-warnings','--socket-timeout','20','--retries','1','--js-runtimes','node',...(format===mediaFormats.compatible?['--check-formats']:[]),'-f',format,'-J','--',url],null,null,{signal}));
}
function streams(meta){
 const formats=meta.requested_formats||[meta];
 const v=formats.find(f=>f.vcodec&&f.vcodec!=='none'),a=formats.find(f=>f.acodec&&f.acodec!=='none');
 if(!v)throw Error('Vídeo indisponível.');
 const video=inputFor(v,meta),audio=a===v?video:a?inputFor(a,meta):null;
 const candidate=(meta.formats||[]).filter(f=>f.vcodec&&f.vcodec!=='none'&&/^https?$|^m3u8/.test(f.protocol||'')&&!f.has_drm&&/^https?:\/\//.test(f.url||'')&&f.height>=144&&f.height<=360&&f.height<v.height)
  .sort((x,y)=>Number(y.acodec&&y.acodec!=='none')-Number(x.acodec&&x.acodec!=='none')||y.height-x.height)[0];
 const light=candidate?inputFor(candidate,meta):null;
 const sameLanguage=!a?.language||candidate?.language===a.language;
 const analysis=light?{video:light,audio:sameLanguage&&candidate.acodec&&candidate.acodec!=='none'?light:audio,height:candidate.height,codec_name:candidate.vcodec}:null;
 return {video,audio,analysis,width:v.width,height:v.height,codec_name:v.vcodec,duration:meta.duration};
}
export async function previewSource(url,at=0,{resolveSource=sourceInfo}={}){
 url=sourceURL(url);
 const meta=await resolveSource(url);
 if(meta.live_status==='is_upcoming')throw Error('A live ainda não começou.');
 return remoteAccess(meta,format=>resolveSource(url,format))(current=>{
  const live=isLive(current);
  const input=live?liveInput(current,{videoOnly:true}):null;
  const seek=live?[]:['-ss',String(Math.min(at,Math.max(0,(Number(current.duration)||1)-1)))];
  return run('ffmpeg',['-nostdin','-v','error',...seek,...(input?input.args:streams(current).video),'-map','0:v:0','-an','-vf','scale=768:-2','-frames:v','1','-f','image2pipe','-c:v','mjpeg','pipe:1']);
 });
}

async function samples(args,size,measure,bytes,onCount,signal){
 let tail=Buffer.alloc(0);const values=[];
 await run('ffmpeg',['-nostdin','-v','error',...args,'pipe:1'],chunk=>{
  const data=Buffer.concat([tail,chunk]);let pos=0;
  for(;pos+size<=data.length;pos+=size)values.push(measure(data.subarray(pos,pos+size)));
  tail=Buffer.from(data.subarray(pos));onCount?.(values.length);
 },bytes,{signal});
 const sorted=[...values].sort((a,b)=>a-b);
 const lo=sorted[Math.floor(values.length*.15)]||0,hi=sorted[Math.floor(values.length*.95)]||0;
 return values.map(v=>Math.max(0,Math.min(1,(v-lo)/(hi-lo||1))));
}
const reactions=/\b(?:olha|nossa|caramba|mano|consegui|ganhei|perdi|morri|calma|espera|cuidado|mentira|socorro|agora|incr[ií]vel|imposs[ií]vel|wow|watch|look|crazy|wait|won|no way|what|help)\b/giu;
export function trackingCrop(points){
 const round=n=>Number(n.toFixed(4));
 let position=round(points.at(-1).x);
 for(let i=points.length-2;i>=0;i--){
  const from=points[i],to=points[i+1];
  const at=round(from.time),until=round(to.time),elapsed=Math.max(.01,round(to.time-from.time));
  const movement=round(to.x-from.x);
  position='if(lt(t,'+until+'),'+round(from.x)+'+('+movement+')*clip((t-'+at+')/'+elapsed+',0,1),'+position+')';
 }
 return "crop=w='trunc(ih*9/32)*2':h='trunc(ih/2)*2':x='clip(iw*("+position+")-ow/2,0,iw-ow)':y=0";
}

function videoFilters(job,src,subtitle,start){
 const w=18*Math.max(1,Math.round((Math.min(src.width||720,src.height||720,1080))/18)),h=w*16/9;
 const fill=(width,height)=>'scale='+width+':'+height+':force_original_aspect_ratio=increase:force_divisible_by=2,crop='+width+':'+height+',setsar=1';
 const fit=(width,height)=>'scale='+width+':'+height+':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1';
 let graph;
 if(job.frame==='split'){
  const camera=job.camera,game=adjoiningRegion(camera,job.gameplay);
  if(!game)graph='[0:v]'+cropRegion(camera)+','+fill(w,h);
  else{
   const a=2*Math.round(h*.37/2),b=h-a;
   const panel=(width,height)=>fit(width,height)+',pad='+width+':'+height+':(ow-iw)/2:(oh-ih)/2:color=black';
   if(job.autoLayout){
    graph='[0:v]split[cam][game];[cam]'+cropRegion(camera)+','+fill(w,a)+'[top];[game]'+cropRegion(game)+','+fill(w,b)+'[bottom];[top][bottom]vstack=inputs=2';
   }else{
   graph='[0:v]split[cam][game];[cam]'+cropRegion(camera)+','+panel(w,a)+'[top];[game]'+cropRegion(game)+','+panel(w,b)+'[bottom];[top][bottom]vstack=inputs=2';
   }
  }
 }else if(job.frame==='face-track'){
  graph='[0:v]'+trackingCrop(job.track)+','+fill(w,h);
 }else if(job.frame==='full'){
  graph='[0:v]split[b][f];[b]'+fill(180,320)+',gblur=sigma=10,scale='+w+':'+h+'[bg];[f]'+fit(w,h)+'[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1';
 }else if(job.frame==='native'||src.width*16===src.height*9){
  graph='[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1';
 }else{
  graph='[0:v]'+fill(w,h);
 }
 if(src.bytes&&start>0){graph='[0:v]trim=start='+start+',setpts=PTS-STARTPTS[clip];'+graph.replace('[0:v]','[clip]');}
 return ['-filter_complex_threads','2','-filter_complex',graph+(subtitle?',ass=captions.ass':'')+'[out]','-map','[out]'];
}
const softwareH264=['-c:v','libx264','-threads','4','-preset','veryfast','-crf','18'];
function encode(inputs,duration,mapping,visual,bytes,cwd,signal){
 return withH264(codec=>encodeOnce(inputs,duration,mapping,visual,bytes,cwd,codec,signal),softwareH264,signal);
}
async function encodeOnce(inputs,duration,mapping,visual,bytes,cwd,codec,signal){
 const parts=[];let size=0;
 await run('ffmpeg',['-nostdin','-v','error',...inputs,'-t',String(duration),...mapping,...visual,...codec,'-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+frag_keyframe+empty_moov+default_base_moof','-f','mp4','pipe:1'],b=>{
  size+=b.length;if(size>batchLimit)throw Error('O corte excedeu a memória de exportação.');parts.push(b);
 },bytes,{cwd,signal});
 if(size<512)throw Error('O codificador não produziu um corte válido.');
 const encoded=Buffer.concat(parts,size);
 const timing=JSON.parse(await run('ffprobe',['-v','error','-select_streams','v:0','-show_entries','packet=pts_time,duration_time','-of','json','-i','pipe:0'],null,encoded,{signal}));
 const end=(timing.packets||[]).reduce((max,p)=>Math.max(max,Number(p.pts_time||0)+Number(p.duration_time||0)),0);
 if(end<minimum-.04||end<duration-.3){
  throw Object.assign(Error('A fonte terminou antes de completar a duração escolhida.'),{reason:'clip_source_short'});
 }
 return encoded;
}
export async function exportClip(job,src,start,len,speech){
 let layout=job;
 if(job.frame==='auto')layout={...job,...await automaticLayout(src,start,len)};
 if(job.frame==='webcam-top-right')layout={...job,...webcamInUpperRight((src.width||16)/(src.height||9))};
 const temp=await fs.mkdtemp(path.join(tmpdir(),'cliparia-export-'));
 try{
  const subtitle=job.captions&&speech.some(s=>s.end>start&&s.start<start+len);
  if(subtitle)await fs.writeFile(path.join(temp,'captions.ass'),captionsAss(speech,start,len,layout.autoLayout?overlayHook(postSpeech(speech,start,start+len)):''));
  const separate=src.audio&&src.audio!==src.video;
  start+=src.windowStart||0;
  const seek=src.bytes?[]:['-ss',String(start)];
  const inputs=[...seek,...src.video,...(separate?[...seek,...src.audio]:[])];
  const sound=src.audio?['-map',(separate?'1':'0')+':a:0']:['-an'];
  const audioSeek=src.bytes&&src.audio&&start>0?['-af','atrim=start='+start+',asetpts=PTS-STARTPTS']:[];
  return await encode(inputs,len,[...videoFilters(layout,src,subtitle,start),...sound],audioSeek,src.bytes,temp,src.signal);
 }finally{await fs.rm(temp,{recursive:true,force:true});}
}
export async function trimClip(clip,from,to,inputURL){
 if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to>clip.length||to-from<minimum)throw Error('Ajuste o intervalo para manter pelo menos 40 segundos dentro do corte.');
 const inputs=['-ss',String(from),'-i',inputURL];
 const bytes=await encode(inputs,to-from,['-map','0:v:0','-map','0:a:0?'],[]);
 return drive.replace(clip.drive.id,bytes);
}
const clock=seconds=>new Date(Math.floor(seconds)*1000).toISOString().slice(11,19);
const atWindow=(src,range)=>({...src,windowStart:range.offset,duration:range.duration});
function scanArgs(src,stream){
 const offset=String(src.windowStart||0),duration=String(src.duration);
 return src.bytes?[...stream,'-ss',offset,'-t',duration]:['-ss',offset,'-t',duration,...stream];
}
async function fallbackSignals(source,onVideo,onAudio,withVisual){
 let previous;
 const levels=[],signatures=[];
 const motion=await samples([...scanArgs(source,source.video),'-an','-vf','fps=1,scale=32:18,format=gray','-f','rawvideo'],576,frame=>{
  let d=0;if(previous)for(let i=0;i<frame.length;i++)d+=Math.abs(previous[i]-frame[i]);
  if(withVisual)signatures.push(frameSignature(frame));
  previous=Buffer.from(frame);
  return d;
 },source.bytes,onVideo,source.signal);
 const volume=source.audio?await samples([...scanArgs(source,source.audio),'-vn','-ac','1','-ar','4000','-f','s16le'],8000,payload=>{
  let squares=0;for(let i=0;i<payload.length;i+=2)squares+=payload.readInt16LE(i)**2;
  const level=Math.sqrt(squares/4000);
  levels.push(level);
  return Math.log1p(level);
 },source.bytes,onAudio,source.signal):[];
 return {motion,volume,levels,visual:signatures.join('')};
}
async function measureSignals(src,onCount,withVisual){
 if(src.analysis){
  try{return await scanSignals({...src,...src.analysis},onCount,withVisual);}
  catch{src.signal?.throwIfAborted();}
 }
 try{return await scanSignals(src,onCount,withVisual);}
 catch(error){
  src.signal?.throwIfAborted();
  if(error.httpStatus)throw error;
  return fallbackSignals(src,onCount,onCount,withVisual);
 }
}

export function recordingPath(dir,id){return path.join(dir,'cliparia-gravacao-'+id+'.ts');}
async function completeReplay(meta,resolveSource,signal){
 if(!/^youtube$/i.test(meta.extractor_key||meta.extractor||'')||!meta.webpage_url)return;
 // Once YouTube exposes the archive, include material before the user
 // started capturing. A replay still processing is not a seekable source.
 const vod=await Promise.resolve().then(()=>resolveSource(sourceURL(meta.webpage_url),undefined,signal)).catch(()=>null);
 signal?.throwIfAborted();
 if(vod&&!isLive(vod)&&vod.live_status!=='post_live'&&vod.id===meta.id&&Number(vod.duration)>0)return vod;
}
export async function generate(job,dir,update,onClip,{knownMeta,shouldStop,signal,resolveSource=sourceInfo,generationHistory,batch=false}={}){
 update('Identificando a melhor fonte disponível',1);
 signal?.throwIfAborted();
 const meta=knownMeta||await resolveSource(job.url,undefined,signal);
 signal?.throwIfAborted();
 if(meta.live_status==='is_upcoming')throw Error('A live ainda não começou.');
 if(meta.live_status==='post_live')throw Error('O replay da live ainda está sendo processado pela plataforma.');
 if(job.mediaId&&meta.id&&job.mediaId!==meta.id)throw Error('O link passou a apontar para outra transmissão. Adicione a nova fonte.');
 job.mediaId=meta.id||job.mediaId;
 job.title=meta.title||'Minha live';
 job.sourcePlatform=meta.extractor_key||meta.extractor||new URL(job.url).hostname;
 if(/^TwitchStream$/i.test(job.sourcePlatform)&&typeof meta.description==='string'&&meta.description.trim())job.sourceTitle=meta.description.trim().slice(0,300);
 job.categories=Array.isArray(meta.categories)?meta.categories:[];
 job.game=typeof meta.game==='string'?meta.game:'';
 job.sourceTags=Array.isArray(meta.tags)?meta.tags:[];
 let parent;
 function driveFolder(){
  if(!parent){parent=drive.folder(signal);parent.catch(()=>{});}
  return parent;
 }
 const len=job.duration;
 const exhaustive=!!job.continuousId;
 const unlimitedLive=exhaustive||job.liveBlocks;
 const live=isLive(meta);
 const remote=(first,url)=>remoteAccess(first,format=>resolveSource(url,format,signal),attempt=>{
  update(attempt===0?'HTTP 403 · renovando o endereço da mídia':'HTTP 403 · tentando outro formato disponível');
 });
 const remoteVod=async(vod,url)=>{
  const read=remote(vod,url),src=streams(vod),total=Number(src.duration);
  if(!Number.isFinite(total)||total<len)throw Error('O VOD é mais curto que a duração de corte escolhida.');
  const heatmap=Array.isArray(vod.heatmap)?vod.heatmap:[];
  if(exhaustive){
   let processed=0;
   await scanCompleteVod(job,total,len,async(range,index,totalRanges)=>{
    const replay=heatmap.filter(h=>h.end_time>range.offset&&h.start_time<range.offset+range.duration)
     .map(h=>({...h,start_time:Math.max(0,h.start_time-range.offset),end_time:Math.min(range.duration,h.end_time-range.offset)}));
    await analysisSlot(async()=>{
     update('VOD · analisando '+clock(range.offset)+' a '+clock(range.offset+range.duration)+' · buscando todos os destaques',Math.floor(index/totalRanges*100));
     await render(atWindow(src,range),range.offset,Infinity,replay,false,operation=>read(current=>operation(atWindow({...streams(current),signal},range))));
    },true,signal);
    processed++;
   },{shouldStop:()=>shouldStop?.()||batch&&processed>=1,signal});
   update(job.completeScanFinished?'VOD inteiro verificado · destaques encontrados disponíveis':'Análise do VOD pausada · continuará deste trecho',job.completeScanFinished?100:null);
   return;
  }
  const sample=async()=>{
   const points=[];
   let analyzed=0,lastError;
   for(const part of probeRanges(total)){
    if(shouldStop?.())break;
    signal?.throwIfAborted();
    update('VOD · verificando amostra em '+clock(part.offset));
    try{
     const metrics=await analysisSlot(()=>read(current=>measureSignals(atWindow({...streams(current),signal},part))),true,signal);
     analyzed++;
     const best=rankedMoments({...metrics,duration:part.duration},12)[0];
     if(best)points.push({at:part.offset+best.at,score:best.score});
    }catch(error){
     signal?.throwIfAborted();
     lastError=error;
    }
   }
   if(!analyzed&&lastError&&!shouldStop?.())throw lastError;
   return hotRanges(total,len,[],points);
  };
  if(!job.scoutPlan){
   const initial=hotRanges(total,len,heatmap);
   job.scoutFromHeat=initial.length>0&&total>Math.max(150,len+30);
   job.scoutPlan=(initial.length?initial:await sample()).filter(r=>r.offset+r.duration>(job.scanCursor||0));
   job.scoutIndex=0;
   update('VOD · pontos promissores identificados',3);
  }
  while(job.clips.length<job.count&&!shouldStop?.()){
   if(job.scoutIndex>=job.scoutPlan.length){
    if(!job.scoutFromHeat)break;
    const extra=await sample();
    if(shouldStop?.())break;
    job.scoutFromHeat=false;
    job.scoutPlan.push(...extra.filter(r=>!job.scoutPlan.some(old=>Math.abs(old.offset-r.offset)<Math.min(old.duration,r.duration)*.55)));
    update('VOD · comparação de outras partes concluída');
    if(job.scoutIndex>=job.scoutPlan.length)break;
   }
   const range=job.scoutPlan[job.scoutIndex];
   const context=atWindow(src,range);
   const replay=heatmap.filter(h=>h.end_time>range.offset&&h.start_time<range.offset+range.duration)
    .map(h=>({...h,start_time:Math.max(0,h.start_time-range.offset),end_time:Math.min(range.duration,h.end_time-range.offset)}));
   await analysisSlot(async()=>{
    update('VOD · analisando ponto promissor '+clock(range.offset)+' a '+clock(range.offset+range.duration),Math.floor(job.scoutIndex/job.scoutPlan.length*100));
    const previous=job.clips.filter(c=>(c.originalStart??c.start)>=range.offset&&(c.originalStart??c.start)<range.offset+range.duration).length;
    await render(context,range.offset,job.count-job.clips.length+previous,replay,false,operation=>read(current=>operation(atWindow({...streams(current),signal},range))));
    job.scoutIndex++;
    update('Trecho promissor verificado · '+job.clips.length+' cortes prontos',Math.floor(job.scoutIndex/job.scoutPlan.length*100));
   },true,signal);
  }
 };
 const readLive=remote(meta,job.url);
 const render=async(src,offset,count,heatmap,batch=false,withInput=operation=>operation(src))=>{
  const seconds=Math.floor(src.duration);
  if(!Number.isFinite(seconds))throw Error('Duração indisponível.');
  if(seconds<len){if(batch)return;throw Error('O VOD é mais curto que a duração de corte escolhida.');}
  let reported=-1;
  const progress=(label,start,end,value)=>{
   if(batch)return;
   const n=5*Math.floor((start+(end-start)*Math.min(1,value/seconds))/5);
   if(n!==reported){reported=n;update('VOD · '+clock(offset)+' a '+clock(offset+seconds)+' · '+label+' ('+n+'% do trecho)');}
  };

  update((batch?'Live':'VOD')+' · buscando momentos fortes');
  const metrics=await withInput(current=>measureSignals(current,n=>progress('Triagem de áudio e vídeo',5,85,n),!!generationHistory));
  const speechFor=(start,duration)=>withInput(async current=>{
   if(!current.audio)return [];
   const windowStart=(current.windowStart||0)+start;
   const input=current.bytes
    ?{...current,audioTrim:{start:windowStart,duration}}
    :{...current,audio:clipInput({windowStart,duration},current.audio)};
   return (await transcribe(input,dir,job.language)).map(s=>({...s,start:s.start+start,end:s.end+start}));
  });
  const exclude=batch?[]:job.clips.map(c=>({start:(c.originalStart??c.start)-offset}));
  const limit=Math.max(0,count-exclude.filter(c=>c.start>=0&&c.start<seconds).length);
  let ranked=rankedMoments({...metrics,heatmap,duration:seconds},len);
  const shortlist=limit+(limit>0&&job.captions?2:0);
  const checked=new Map();
  const allow=({start})=>{
   if(!generationHistory?.enabled())return true;
   if(!checked.has(start)){
    const duplicate=generationHistory.duplicate(job,{start:Math.floor(offset+start),length:len},visualRange(metrics.visual,start,len));
    checked.set(start,duplicate);
    if(duplicate)job.duplicatesSkipped=true;
   }
   return !checked.get(start);
  };
  let picks=selectMoments(ranked,len,shortlist,exclude,allow);
  if(!picks.length&&job.captions&&await modelAvailable(dir)){
   const probes=probeMoments(ranked,picks,seconds);
   if(probes.length)update('Verificando reações no áudio');
   const speech=[];
   for(const point of probes)speech.push(...await speechFor(point,12));
   if(speech.length){
    ranked=rankedMoments({...metrics,heatmap,speech,duration:seconds},len);
    picks=selectMoments(ranked,len,shortlist,exclude,allow);
   }
  }
  if(!picks.length){update('Nenhum destaque forte neste trecho');return;}
  // Keep one upload in flight. Encode the next clip while Drive receives
  // the preceding one, without reserving more than two media buffers.
  let sending,index=job.clips.length,accepted=0;
  try{
   for(const moment of picks){
    if(accepted>=limit)break;
    const {start}=moment;
    signal?.throwIfAborted();
    const absoluteStart=Math.floor(offset+start);
    if(!batch&&job.clips.some(c=>(c.originalStart??c.start)===absoluteStart))continue;
    const i=index;
    let speech=[];
    if(job.captions){
     const bounds={start,duration:len};
     if(bounds.duration>0){
      update('Gerando legendas para o trecho em '+clock(absoluteStart));
      speech=await speechFor(bounds.start,bounds.duration);
      if(!speech.length&&(bounds.start!==start||bounds.duration!==len))speech=await speechFor(start,len);
     }
     speech=speech.filter(part=>part.end>start&&part.start<start+len);
     if(!speech.length){update('Trecho sem fala reconhecida · procurando outro destaque');continue;}
    }
    if(!job.captions){
     if(!await modelAvailable(dir))throw Error('Instale o modelo de transcrição para gerar títulos, descrições e hashtags com as falas dos clipes.');
     update('Transcrevendo o clipe para verificar conteúdo'+(job.writePosts?' e criar os textos da publicação':''));
     speech=await speechFor(start,len);
    }
    update('Renderizando corte '+(i+1));
    const file='corte-'+String(i+1).padStart(2,'0')+'.mp4';
    const frame=['native','webcam-top-right'].includes(job.frame)?job.frame:'auto';
    let bytes;
    try{bytes=await withInput(current=>exportClip({...job,frame},current,start,len,speech));}
    catch(error){
     if(!exhaustive||error.reason!=='clip_source_short')throw error;
     update('Trecho sem vídeo suficiente · procurando outro destaque');
     continue;
    }
    const contentHash=createHash('sha256').update(bytes).digest('hex');
    const visual=visualRange(metrics.visual,start,len);
    update('Verificando imagens e falas do corte '+(i+1));
    const safety=await screenClip(['-i','pipe:0'],{bytes,codec:'h264',duration:len,signal,text:[job.title,...speech.map(s=>s.text)].join(' ')});
    if(safety.status!=='approved'){
     job.blockedClips??=[];
     job.blockedClips.push({start:absoluteStart,length:len,safety});
     if(job.blockedClips.length>200)job.blockedClips.shift();
     update('Corte não liberado · '+safety.reason);
     continue;
    }
    await sending;
    signal?.throwIfAborted();
    if(generationHistory?.duplicate(job,{start:absoluteStart,length:len,contentHash},visual)){
     job.duplicatesSkipped=true;
     update('Trecho repetido · procurando outro destaque');
     continue;
    }
    update('Enviando corte '+(i+1)+' ao Drive');
    const parentId=await driveFolder();
    index++;accepted++;
    signal?.throwIfAborted();
    const reason=speech.find(s=>s.start>=start+len*.15&&s.start<start+len*.65&&reactions.test(s.text));
    reactions.lastIndex=0;
    const clip={file,start:absoluteStart,originalStart:absoluteStart,length:len,title:job.title.slice(0,83)+' · Corte '+(i+1),posts:{},excerpt:reason?.text?.slice(0,140)||'',revision:0,postSpeech:postSpeech(speech,start,start+len).map(s=>({...s,start:s.start+offset,end:s.end+offset})),captioned:job.captions&&speech.length>0,highlight:moment.evidence};
    clip.originalLength=len;
    clip.safety=safety;
    clip.contentHash=contentHash;
    if(job.writePosts)applyPostCopy(job,clip);
    sending=drive.upload(parentId,clip.title.slice(0,100).replace(/[\\/:*?"<>|]/g,' ')+' · '+job.id.slice(0,8)+' · '+file,bytes).then(stored=>{
     clip.drive=stored;
     job.clips.push(clip);
     onClip?.(clip);
     update('Corte '+(i+1)+' disponível no Drive');
     generationHistory?.remember(job,clip,visual);
    });
    sending.catch(()=>{});
   }
  }finally{await sending;}

 };
 const completed=(message)=>{
  const detail=job.clips.length===0?(job.duplicatesSkipped?'Nenhum corte novo.':'Nenhum destaque com sinal suficiente.'):job.clips.length<job.count?'Cortes encontrados disponíveis no Drive.':'Cortes disponíveis no Drive.';
  update((message?message+' · ':'')+detail,100);
 };
 if(live){
  job.scanMode='live';
  const result=await readLive(current=>monitor(job,liveInput(current),async(block,start,count)=>{
   if(block.duration<len)return;
   const input=['-i','pipe:0'];
   const info=JSON.parse(await run('ffprobe',['-v','error','-show_streams','-of','json',...input],null,block.bytes,{signal}));
   const video=info.streams.find(s=>s.codec_type==='video');
   if(!video)throw Error('O bloco capturado não tem vídeo.');
   const source={video:input,audio:info.streams.some(s=>s.codec_type==='audio')?input:null,bytes:block.bytes,signal,...video};
   for(const range of ranges(block.duration,len)){
    const remaining=exhaustive?Infinity:job.liveBlocks?count:job.count-job.clips.length;
    if(remaining<=0)break;
    await analysisSlot(async()=>{
     update('Live · analisando o trecho de '+clock(start+range.offset)+' a '+clock(start+range.offset+range.duration),null);
     await render(atWindow(source,range),start+range.offset,remaining,[],true);
    },false,signal,exhaustive?job:undefined);
   }
  },update,Math.max(120,len+15),{shouldStop,signal,maxTotal:unlimitedLive?Infinity:job.count,...(batch?{batchMs:(Math.max(120,len+15)+10)*1000}:{})}));
  if(!result.stopped&&!result.interrupted&&!job.clips.length){
   const vod=await completeReplay(meta,resolveSource,signal);
   if(vod){
    job.scanMode='vod';
    await remoteVod(vod,sourceURL(meta.webpage_url));
    if(batch&&!job.completeScanFinished)return {stopped:true};
    completed('Replay analisado por trechos');
   }
  }
  return result;
 }
 job.scanMode='vod';
 update('VOD pronto · aguardando análise por trechos',null);
 await remoteVod(meta,job.url);
 if(shouldStop?.()||batch&&!job.completeScanFinished)return {stopped:true};
 completed(exhaustive?'VOD inteiro analisado':'VOD analisado por trechos');
}
