import {run} from './speech.mjs';
import {withVideoDecode} from './encoder.mjs';
import {frameSignature} from './generation-history.mjs';

const picture='fps=1,scale=32:18:flags=fast_bilinear,format=yuv420p';
const difference='tblend=all_mode=difference,signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG';
const sound='aresample=4000,aformat=sample_fmts=s16:channel_layouts=mono,asetnsamples=n=4000:p=0,astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=RMS_level,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level';

export function normalize(values){
 const sorted=[...values].sort((a,b)=>a-b);
 const lower=sorted[Math.floor(values.length*.15)]||0,upper=sorted[Math.floor(values.length*.95)]||0;
 return values.map(value=>Math.max(0,Math.min(1,(value-lower)/(upper-lower||1))));
}

// FFmpeg writes the two light-weight signals to stderr without a second
// decode or buffering the original pixels in Node.js.
export async function scanSignals(source,progress,withVisual=false){
 const codec=source.height>=720?source.codec_name:undefined;
 return withVideoDecode(codec,decode=>readSignals(source,progress,decode,withVisual),source.signal);
}

async function readSignals(source,progress,decode,withVisual){
 const separate=source.audio&&source.audio!==source.video;
 const inputs=source.bytes?source.video:[...clipInput(source,source.video),...(separate?clipInput(source,source.audio):[])];
 const audioPad=(separate?'1':'0')+':a:0';
 const offset=source.windowStart||0;
 const duration=source.duration;
 const cropVideo=source.bytes?'trim=start='+offset+':duration='+duration+',setpts=PTS-STARTPTS,':'';
 const cropAudio=source.bytes?'atrim=start='+offset+':duration='+duration+',asetpts=PTS-STARTPTS,':'';
 const graph='[0:v:0]'+cropVideo+picture+(withVisual?',split[frames][changes];[changes]':',')+difference+'[video]'+(source.audio?';['+audioPad+']'+cropAudio+sound+'[audio]':'');
 const frames=withVisual?['-map','[frames]','-c:v','rawvideo','-threads:v','1','-f','rawvideo','pipe:1']:[];
 const motion=[],rms=[];
 let tail='';
 function read(line){
  const v=line.match(/lavfi\.signalstats\.YAVG=([^\s]+)/);
  if(v){const value=Number(v[1]);if(Number.isFinite(value))motion.push(value);}
  const a=line.match(/lavfi\.astats\.Overall\.RMS_level=([^\s]+)/);
  if(a){const value=Number(a[1]);rms.push(Number.isFinite(value)?32768*10**(value/20):0);}
 }
 const raw=await run('ffmpeg',['-nostdin','-hide_banner','-nostats','-loglevel','info',...decode,...inputs,'-filter_complex_threads','2','-filter_complex',graph,'-map','[video]',...(source.audio?['-map','[audio]']:[]),'-f','null','-',...frames],null,source.bytes,{
  signal:source.signal,
  onStderr(chunk){
   const lines=(tail+chunk).split(/\r\n|\r|\n/);
   tail=lines.pop();
   for(const line of lines)read(line);
   progress?.(Math.max(motion.length,rms.length));
  }
 });
 if(tail)read(tail);
 if(!motion.length||source.audio&&!rms.length)throw Error('O FFmpeg não devolveu as amostras de áudio e vídeo.');
 const signatures=[];
 const frameSize=32*18*3/2;
 for(let offset=0;offset+frameSize<=raw.length;offset+=frameSize)signatures.push(frameSignature(raw.subarray(offset,offset+frameSize)));
 return {motion:normalize([0,...motion]).map((value,i)=>i>0&&motion[i-1]>=2.5?value:0),volume:normalize(rms.map(value=>Math.log1p(value))),levels:rms,visual:signatures.join('')};
}
export function clipInput(source,stream){
 return ['-ss',String(source.windowStart||0),'-t',String(source.duration),...stream];
}
