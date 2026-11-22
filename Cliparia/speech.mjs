import {httpStatus,responseChunks} from './remote.mjs';
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {createWriteStream, createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';

export const modelName='ggml-base.bin';
const modelURL='https://huggingface.co/ggerganov/whisper.cpp/resolve/main/'+modelName;
const modelHash='60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe';
let installing;
export function run(cmd,args,consume,bytes,opts={}){
 return new Promise((resolve,reject)=>{
  const p=spawn(cmd,args,{cwd:opts.cwd,signal:opts.signal,windowsHide:true,stdio:[bytes?'pipe':'ignore','pipe','pipe']});
  const output=[];let error='',failure;
  if(bytes){p.stdin.on('error',()=>{});p.stdin.end(bytes);}
  p.stdout.on('data',chunk=>{try{if(consume)consume(chunk);else output.push(chunk);}catch(e){failure=e;p.kill();}});
  p.stderr.on('data',chunk=>{const text=chunk.toString();error=(error+text).slice(-3000);opts.onStderr?.(text);opts.progress?.(error);});
  p.once('error',e=>{failure??=e;});
  p.once('close',code=>{
   if(failure)return reject(failure);
   if(code===0)return resolve(Buffer.concat(output));
   const message=cmd+' falhou. '+error.replace(/https?:\/\/\S+/g,'[fluxo]');
   reject(Object.assign(Error(message),{httpStatus:httpStatus(error)}));
  });
 });
}
export async function modelAvailable(dir){
 return fs.stat(path.join(dir,modelName)).then(s=>s.isFile()&&s.size>100000000).catch(()=>false);
}
export function installModel(dir){
 if(installing)return installing;
 installing=(async()=>{
  const filters=String(await run('ffmpeg',['-hide_banner','-filters']));
  if(!/\bwhisper\b/.test(filters))throw Error('Atualize para o FFmpeg Full com o filtro whisper e reabra o Cliparia.');
  const target=path.join(dir,modelName),temp=target+'.download';
  try{
   const r=await fetch(modelURL,{signal:AbortSignal.timeout(10*60*1000)});
   if(!r.ok||!r.body)throw Error('Não foi possível baixar o modelo Whisper.');
   await pipeline(responseChunks(r,'O download do modelo Whisper foi interrompido. Tente novamente.'),createWriteStream(temp));
   const hash=createHash('sha256');
   for await(const bytes of createReadStream(temp))hash.update(bytes);
   if(hash.digest('hex')!==modelHash)throw Error('O arquivo do modelo não corresponde à versão esperada.');
   await fs.rename(temp,target);
  }finally{await fs.rm(temp,{force:true});}
 })().finally(()=>installing=null);
 return installing;
}
function seconds(t){
 const [h,m,s]=t.replace(',','.').split(':').map(Number);
 return h*3600+m*60+s;
}
export function parseSrt(raw){
 return raw.replace(/^\uFEFF/,'').trim().split(/\r?\n\s*\r?\n/).flatMap(block=>{
  const lines=block.split(/\r?\n/),pos=lines.findIndex(l=>l.includes(' --> '));
  if(pos<0)return [];
  const [from,to]=lines[pos].split(' --> ').map(time=>time.trim().split(/\s+/)[0]);
  const text=lines.slice(pos+1).join(' ').trim();
  return text&&seconds(to)>seconds(from)&&!/^\s*[\[(].*[\])]\s*$/.test(text)?[{start:seconds(from),end:seconds(to),text}]:[];
 });
}
export async function transcribe(src,dir,lang,progress){
 if(!src.audio||!await modelAvailable(dir))return [];
 const temp=await fs.mkdtemp(path.join(tmpdir(),'cliparia-speech-'));
 try{
  await fs.link(path.join(dir,modelName),path.join(temp,modelName)).catch(()=>fs.copyFile(path.join(dir,modelName),path.join(temp,modelName)));
  const bounds=(src.audioTrim?'atrim=start='+src.audioTrim.start+':duration='+src.audioTrim.duration+',':'')+'asetpts=N/SR/TB,';
  const filter=bounds+'whisper=model='+modelName+':language='+lang+':queue=15:use_gpu=false:destination=speech.srt:format=srt:max_len=36';
  await run('ffmpeg',['-nostdin','-v','error',...src.audio,'-vn','-af',filter,'-progress','pipe:2','-f','null','-'],null,src.bytes,{cwd:temp,progress,signal:src.signal});
  return parseSrt(await fs.readFile(path.join(temp,'speech.srt'),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;}));
 }finally{await fs.rm(temp,{recursive:true,force:true});}
}
function assTime(sec){
 const t=Math.max(0,Math.round(sec*100));
 return Math.floor(t/360000)+':'+String(Math.floor(t/6000)%60).padStart(2,'0')+':'+String(Math.floor(t/100)%60).padStart(2,'0')+'.'+String(t%100).padStart(2,'0');
}
export function captionsAss(segments,start,len,hook){
 const head=['[Script Info]','ScriptType: v4.00+','PlayResX: 1080','PlayResY: 1920','WrapStyle: 0','[V4+ Styles]','Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding','Style: Caption,Arial,62,&H00FFFFFF,&H0000D7FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,2,2,95,95,240,1','Style: Hook,Arial,74,&H00FFFFFF,&H0000D7FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,7,3,5,60,60,20,1','[Events]','Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'];
 if(hook){
  const words=hook.split(' '),last=words.pop();
  const title=words.join(' ')+' {\\c&H00D7FF&}'+last;
  head.push('Dialogue: 1,0:00:00.00,0:00:02.80,Hook,,0,0,0,,{\\an5\\pos(540,710)}'+title);
 }
 for(const s of segments){
  const a=Math.max(0,s.start-start),b=Math.min(len,s.end-start);
  if(b<=a)continue;
  const words=s.text.replace(/[{}\\\r\n]/g,' ').trim().split(/\s+/);
  const groups=[];
  for(const word of words){
   const row=groups.at(-1);
   if(row&&row.join(' ').length+word.length<32&&row.length<6)row.push(word);
   else groups.push([word]);
  }
  for(const [i,group] of groups.entries()){
   const from=a+(b-a)*i/groups.length,to=a+(b-a)*(i+1)/groups.length;
   const part=(to-from)/group.length;
   for(const [w,word] of group.entries()){
    const text=group.map((x,j)=>j===w?'{\\c&H00D7FF&}'+x+'{\\c}':x).join(' ');
    head.push('Dialogue: 0,'+assTime(from+w*part)+','+assTime(from+(w+1)*part)+',Caption,,0,0,0,,'+text);
   }
  }
 }
 return head.join('\n')+'\n';
}
