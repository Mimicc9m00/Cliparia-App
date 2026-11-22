import {httpStatus} from './remote.mjs';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const running=new Map();
export function stopLive(id){
 const stop=running.get(id);if(!stop)throw Error('A captura já encerrou.');stop();
}
export function inputFor(f,meta={}){
 const fields=new Map();
 for(const [key,value] of [...Object.entries(meta.http_headers||{}),...Object.entries(f.http_headers||{})]){
  const name=key.toLowerCase();
  if(/^[a-z0-9-]+$/.test(name)&&!['range','host','content-length','connection'].includes(name)&&typeof value==='string'&&!/[\r\n]/.test(value))fields.set(name,value);
 }
 const headers=[...fields].map(([key,value])=>key+': '+value+'\r\n').join('');
 if(!/^https?:\/\//.test(f.url||''))throw Error('Fluxo de mídia indisponível.');
 return ['-rw_timeout','45000000',...(headers?['-headers',headers]:[]),'-i',f.url];
}
// A live can expose a combined HLS stream or separate video/audio streams
// (HLS or HTTPS/DASH). yt-dlp's requested_formats preserves its best-quality
// selection, including the case where the top-level JSON is a merged format.
function usable(f){
 return f&&typeof f.url==='string'&&/^https?:\/\//i.test(f.url)&&!f.has_drm;
}
function hasVideo(f){
 return usable(f)&&f.vcodec!=='none'&&(
  (typeof f.vcodec==='string'&&f.vcodec!=='unknown')||
  Number(f.width)>0||Number(f.height)>0
 );
}
function hasAudio(f){
 return usable(f)&&f.acodec!=='none'&&(
  (typeof f.acodec==='string'&&f.acodec!=='unknown')||
  Number(f.abr)>0||f.audio_ext&&f.audio_ext!=='none'
 );
}
function quality(f){
 return Number(f.height||0)*100000+Number(f.fps||0)*1000+Number(f.tbr||f.vbr||0);
}
function best(list){return [...list].sort((a,b)=>quality(b)-quality(a))[0];}
export function liveInput(meta,{videoOnly=false}={}){
 const requested=Array.isArray(meta.requested_formats)?meta.requested_formats:[];
 const available=[...requested,meta,...(Array.isArray(meta.formats)?meta.formats:[])].filter(usable);
 if(!available.length)throw Error('A plataforma não disponibilizou um endereço de mídia para essa live. Atualize o yt-dlp e tente novamente.');

 // Use the formats actually selected by yt-dlp when they include both tracks.
 let video=best(requested.filter(hasVideo));
 let audio=best(requested.filter(f=>f!==video&&hasAudio(f)))||(video&&hasAudio(video)?video:null);
 if(!video){
  // Favor the highest-resolution video while using a combined stream when
  // it offers equal quality. Never silently downgrade a 1080p live to 360p.
  const combined=best(available.filter(f=>hasVideo(f)&&hasAudio(f)));
  const bestVideo=best(available.filter(hasVideo));
  video=bestVideo&&combined&&quality(bestVideo)>quality(combined)?bestVideo:(combined||bestVideo);
  audio=video&&hasAudio(video)?video:null;
 }
 if(video&&!audio){
  // Some providers publish video-only HLS alongside a separate audio playlist.
  audio=best(available.filter(f=>f!==video&&hasAudio(f)))||null;
 }
 if(!video)throw Error('A plataforma não disponibilizou imagem para essa live. Verifique se a transmissão está pública e em andamento.');
 if(!videoOnly&&!audio)throw Error('Encontrei a imagem da live, mas não uma faixa de áudio compatível. Atualize o yt-dlp e confira a transmissão.');

 // -live_start_index is an HLS demuxer option, not a generic HTTP/DASH option.
 // It must be set before each HLS input independently.
 function inputArgs(f){
  return [...(/^m3u8/.test(f.protocol||'')?['-live_start_index','-1']:[]),...inputFor(f,meta)];
 }
 if(videoOnly)return {args:inputArgs(video),videoMap:'0:v:0'};
 return {
  args:[...inputArgs(video),...(audio!==video?inputArgs(audio):[])],
  videoMap:'0:v:0',audioMap:audio===video?'0:a:0':'1:a:0',
  separate:audio!==video
 };
}
// FFmpeg assigns PID 256 to video and 4096 to the PMT. Split at a video
// random-access point, keeping program tables so each RAM block is decodable.
export async function* blocks(source,seconds=180,minBlock=40){
 let tail=Buffer.alloc(0),parts=[],size=0,first,last,pat,pmt;
 const wrap=2**33;
 for await(const chunk of source){
  const data=Buffer.concat([tail,chunk]);let begin=0,i=0;
  for(;i+188<=data.length;i+=188){
   const p=data.subarray(i,i+188);if(p[0]!==0x47)throw Error('Transporte MPEG-TS inválido.');
   const pid=((p[1]&31)<<8)|p[2];
   if(pid===0)pat=Buffer.from(p);if(pid===4096)pmt=Buffer.from(p);
   if(pid!==256||!(p[1]&64))continue;
   const hasAdapt=!!(p[3]&32),idx=hasAdapt?5+p[4]:4;
   if(idx+14>188||p[idx+2]!==1||!(p[idx+7]&128))continue;
   const a=idx+9;
   const pts=(p[a]&14)*2**29+p[a+1]*2**22+(p[a+2]&254)*2**14+p[a+3]*128+(p[a+4]>>1);
   first??=pts;last=pts;
   const elapsed=((pts-first+wrap)%wrap)/90000;
   if((elapsed>=seconds||(size+i-begin>=128*1024*1024&&elapsed>=minBlock))&&elapsed<seconds+300&&hasAdapt&&p[4]&&p[5]&64){
    parts.push(data.subarray(begin,i));
    yield {bytes:Buffer.concat(parts),duration:elapsed};
    parts=[pat,pmt].filter(Boolean);size=parts.length*188;first=pts;begin=i;
   }
  }
  const portion=data.subarray(begin,i);parts.push(portion);size+=portion.length;
  if(size>768*1024*1024)throw Error('O bloco ao vivo excedeu a memória de captura.');
  tail=Buffer.from(data.subarray(i));
 }
 if(first!=null&&size>0){const duration=((last-first+wrap)%wrap)/90000;if(duration>=1&&duration<seconds+300)yield {bytes:Buffer.concat(parts),duration};}
}
function openCapture(job,input){
 const args=Array.isArray(input)?{args:input,videoMap:'0:v:0',audioMap:'0:a:0'}:input;
 const p=spawn('ffmpeg',['-hide_banner','-loglevel','error',...args.args,'-map',args.videoMap,'-map',args.audioMap,'-c','copy','-f','mpegts','-mpegts_start_pid','256','-mpegts_pmt_start_pid','4096','pipe:1'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let stopped=false,timer,spawnError,ffmpegError='';
 p.stderr.on('data',chunk=>{ffmpegError=(ffmpegError+chunk.toString()).slice(-3000);});
 p.stdin.on('error',()=>{});
 p.on('error',e=>{spawnError=e;});
 const closed=new Promise(resolve=>p.once('close',resolve));
 const kill=()=>p.kill();
 const stop=()=>{if(stopped)return;stopped=true;p.stdin.end('q\n');timer=setTimeout(kill,8000);};
 const result=async()=>{
  const code=await closed;
  if(spawnError)throw spawnError;
  const status=httpStatus(ffmpegError);
  return {stopped,interrupted:code!==0&&!stopped,httpStatus:status,error:'A conexão com a transmissão caiu'+(status?' (HTTP '+status+')':'')+'. Confira se ela está disponível e se o yt-dlp está atualizado.'};
 };
 running.set(job.id,stop);process.once('exit',kill);job.live=true;
 return {
  stream:p.stdout,stop,kill,result,
  async dispose(){kill();await closed;clearTimeout(timer);running.delete(job.id);process.removeListener('exit',kill);}
 };
}
export async function captureFull(job,input,destination,update){
 const folder=path.dirname(destination);
 const free=async()=>{const disk=await fs.statfs(folder);return disk.bavail*disk.bsize;};
 if(await free()<1024**3)throw Error('Libere pelo menos 1 GB para gravar a live antes da análise.');
 const file=await fs.open(destination,'wx');
 const capture=openCapture(job,input);
 let bytes=0,checked=0,spaceLow=false;
 try{
  update('Gravando a live · seleção dos destaques após encerrar',null);
  for await(const chunk of capture.stream){
   let written=0;
   while(written<chunk.length){
    const result=await file.write(chunk,written,chunk.length-written);
    if(!result.bytesWritten)throw Error('O disco parou de gravar a captura.');
    written+=result.bytesWritten;
   }
   bytes+=written;
   if(bytes-checked>=32*1024**2){
    checked=bytes;
    if(!spaceLow&&await free()<512*1024**2){spaceLow=true;capture.stop();}
   }
  }
  const result=await capture.result();
  if(!bytes)throw Object.assign(Error(result.interrupted?result.error:'A live encerrou antes de entregar vídeo.'),{httpStatus:result.httpStatus});
  return {...result,spaceLow};
 }finally{await capture.dispose();await file.close();}
}
export async function monitor(job,input,consume,update,seconds=180,{shouldStop=()=>false,maxTotal=Infinity,signal,batchMs}={}){
 const capture=openCapture(job,input);
 const batchTimer=batchMs?setTimeout(capture.stop,batchMs).unref():undefined;
 const abort=()=>capture.kill();
 signal?.addEventListener('abort',abort,{once:true});
 const initialOffset=job.capturedSeconds||0;
 let error,work=Promise.resolve(),offset=initialOffset;
 try{
  update('Ao vivo · formando o próximo bloco de destaques',null);
  signal?.throwIfAborted();
  if(shouldStop())capture.stop();
  for await(const block of blocks(capture.stream,seconds,job.duration)){
   await work;
   signal?.throwIfAborted();
   if(error)throw error;
   if(job.clips.length>=maxTotal)continue;
   const start=offset;
   offset+=block.duration;
   work=Promise.resolve().then(()=>consume(block,start,job.count)).then(()=>{
    job.capturedSeconds=offset;
    if(job.clips.length>=maxTotal){capture.stop();return;}
    update('Ao vivo · formando o próximo bloco de destaques',null);
   }).catch(e=>{error=e;capture.stop();});
  }
  const result=await capture.result();
  await work;
  signal?.throwIfAborted();
  if(error)throw error;
  if(result.interrupted)throw Object.assign(Error(result.error+' Os cortes concluídos permanecem no Drive.'),{httpStatus:result.httpStatus,receivedMedia:offset>initialOffset});
  update(job.clips.length===0?'Captura encerrada · nenhum destaque completo com a duração escolhida.':'Captura encerrada · cortes no Drive',100);
  return result;
 }finally{clearTimeout(batchTimer);signal?.removeEventListener('abort',abort);await capture.dispose();await work;}
}
