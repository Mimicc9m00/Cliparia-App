import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {run} from './speech.mjs';
import {withVideoDecode} from './encoder.mjs';

export const safetyVersion=1;
const side=320,area=side*side,frameBytes=area*3;
const modelHash='c15d8273adad2d0a92f014cc69ab2d6c311a06777a55545f2c4eb46f51911f0f';
// NudeNet v3.4 320n label indices. Covered body parts, faces, and bare
// male chests are deliberately excluded from the explicit nudity policy.
const explicitClasses=new Set([2,3,4,6,14]);
let loading;
let inferenceWork=Promise.resolve();
function detector(){
 loading??=(async()=>{
  const ort=await import('./vendor/vision/ort.wasm.min.mjs');
  ort.env.wasm.numThreads=1;
  const model=await readFile(new URL('./vendor/vision/nudenet-320n.onnx',import.meta.url));
  if(createHash('sha256').update(model).digest('hex')!==modelHash)throw Error('Modelo visual inválido.');
  const session=await ort.InferenceSession.create(model,{executionProviders:['wasm']});
  const pixels=new Float32Array(frameBytes);
  const tensor=new ort.Tensor('float32',pixels,[1,3,side,side]);
  return {session,pixels,tensor};
 })().catch(error=>{loading=undefined;throw error;});
 return loading;
}
export function sexualText(value){
 const text=String(value||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
 return /\b(?:porn(?:o|ografia|ografico|ografica)?|pornography|pornographic|hentai|xxx|nudes|onlyfans|sexo explicito|conteudo sexual|cena de sexo|relacao sexual|sexual intercourse|oral sex|anal sex|sexo oral|sexo anal|masturbacao|masturbation|orgasmo|orgasm|boquete|blowjob|handjob|pelada|pelado|nudez|naked|nude scene)\b/u.test(text);
}
export function explicitDetection(output,threshold=.55){
 const {dims,data}=output||{};
 if(!dims||dims.length!==3||dims[0]!==1||dims[1]!==22||dims[2]<1||data?.length!==22*dims[2])throw Error('Resposta inválida do detector visual.');
 const count=dims[2];let best=0;
 for(let i=0;i<count;i++){
  let score=-Infinity,label=-1;
  for(let c=0;c<18;c++){
   const value=data[(4+c)*count+i];
   if(!Number.isFinite(value))throw Error('Resposta inválida do detector visual.');
   if(value>score){score=value;label=c;}
  }
  if(explicitClasses.has(label))best=Math.max(best,score);
 }
 return {blocked:best>=threshold,score:best};
}
export async function detectNudity(raw){
 if(raw.length!==frameBytes)throw Error('Quadro incompleto para verificação.');
 const work=inferenceWork.catch(()=>{}).then(async()=>{
  const {session,pixels,tensor}=await detector();
  for(let i=0;i<area;i++){
   const from=i*3;
   pixels[i]=raw[from]/255;
   pixels[area+i]=raw[from+1]/255;
   pixels[2*area+i]=raw[from+2]/255;
  }
  const outputs=await session.run({[session.inputNames[0]]:tensor});
  return explicitDetection(outputs[session.outputNames[0]]);
 });
 inferenceWork=work;
 return work;
}
export async function screenClip(input,{bytes,codec,text='',duration,revision=0,signal,detect=detectNudity,extract=run}={}){
 const result=(status,reason,extra={})=>({version:safetyVersion,revision,status,reason,checkedAt:Date.now(),...extra});
 if(sexualText(text))return result('blocked','Indício de conteúdo sexual nas falas ou nos textos do clipe.');
 try{
  if(!Number.isFinite(duration)||duration<1||duration>180)throw Error('Duração inválida.');
  const scanSignal=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(180_000)]);
  // Sample the entire exported clip, including the first second. Keep the
  // top-left square padding and RGB normalization used by the model.
  const raw=await withVideoDecode(codec,decode=>extract('ffmpeg',['-nostdin','-v','error',...decode,...input,'-t',String(duration),'-an','-vf','fps=1:start_time=0,scale=320:320:force_original_aspect_ratio=decrease,pad=320:320:0:0:black,format=rgb24','-frames:v',String(Math.ceil(duration)),'-f','rawvideo','pipe:1'],null,bytes,{signal:scanSignal}),scanSignal);
  const frames=raw.length/frameBytes;
  if(!Number.isInteger(frames)||frames<Math.max(1,Math.floor(duration)-1))throw Error('Amostragem incompleta.');
  let lastFrame,lastVerdict;
  for(let i=0;i<frames;i++){
   scanSignal.throwIfAborted();
   const frame=raw.subarray(i*frameBytes,(i+1)*frameBytes);
   const verdict=lastFrame?.equals(frame)?lastVerdict:await detect(frame);
   if(!Number.isFinite(verdict.score)||typeof verdict.blocked!=='boolean')throw Error('Resultado inválido.');
   if(verdict.blocked)return result('blocked','Possível nudez explícita detectada no vídeo.',{atSecond:i,score:verdict.score,framesChecked:i+1});
   lastFrame=frame;
   lastVerdict=verdict;
  }
  scanSignal.throwIfAborted();
  return result('approved','Nenhum indício detectado nas amostras e nos textos analisados.',{framesChecked:frames,sampleEverySeconds:1});
 }catch(error){
  signal?.throwIfAborted();
  return result('error','Verificação de conteúdo incompleta. O envio está bloqueado; tente verificar novamente.');
 }
}
export function assertScreened(clip){
 if(clip.safety?.version!==safetyVersion||clip.safety.revision!==(clip.revision||0))throw Error('Verifique o conteúdo deste clipe antes de enviar.');
 if(clip.safety.status!=='approved')throw Error(clip.safety.reason||'Verificação de conteúdo pendente.');
}
