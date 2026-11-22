export const windowSeconds=900;
export function* ranges(duration,minimum,start=0){
 for(let offset=start;offset+minimum<=duration;offset+=windowSeconds){
  yield {offset,duration:Math.min(windowSeconds,Math.floor(duration-offset))};
 }
}
export function* fullVodRanges(duration,minimum){
 if(!Number.isFinite(duration)||!Number.isFinite(minimum)||minimum<1||minimum>=windowSeconds)throw Error('Intervalo inválido para análise completa.');
 const end=Math.floor(duration),step=windowSeconds-minimum;
 for(let offset=0;offset+minimum<=end;offset+=step){
  yield {offset,duration:Math.min(windowSeconds,end-offset)};
  if(offset+windowSeconds>=end)break;
 }
}
export async function scanCompleteVod(job,total,minimum,analyze,{shouldStop=()=>false,signal}={}){
 const plan=[...fullVodRanges(total,minimum)];
 if(job.completeScanTotal!==total){job.completeScanIndex=0;job.completeScanTotal=total;}
 job.completeScanIndex??=0;
 job.completeScanFinished=false;
 while(job.completeScanIndex<plan.length&&!shouldStop()){
  signal?.throwIfAborted();
  await analyze(plan[job.completeScanIndex],job.completeScanIndex,plan.length);
  signal?.throwIfAborted();
  job.completeScanIndex++;
 }
 job.completeScanFinished=job.completeScanIndex>=plan.length;
 return job.completeScanFinished;
}
const waiting=[];
const lastLiveTurn=new WeakMap();
let liveTurn=0;
let active=false;
function drain(){
 if(active||!waiting.length)return;
 active=true;
 let index=waiting.findIndex(task=>task.vod);
 if(index<0){
  index=0;
  if(waiting[0].liveJob){
   let oldest=lastLiveTurn.get(waiting[0].liveJob)??0;
   for(let i=1;waiting[i]?.liveJob;i++){
    const turn=lastLiveTurn.get(waiting[i].liveJob)??0;
    if(turn<oldest){index=i;oldest=turn;}
   }
  }
 }
 const [next]=waiting.splice(index,1);
 next.signal?.removeEventListener('abort',next.abort);
 Promise.resolve().then(()=>{
  next.signal?.throwIfAborted();
  if(next.liveJob)lastLiveTurn.set(next.liveJob,++liveTurn);
  return next.work();
 }).then(next.resolve,next.reject).finally(()=>{active=false;drain();});
}
export function analysisSlot(work,vod=false,signal,liveJob){
 return new Promise((resolve,reject)=>{
  signal?.throwIfAborted();
  const task={work,vod,signal,liveJob,resolve,reject};
  task.abort=()=>{
   const index=waiting.indexOf(task);
   if(index>=0)waiting.splice(index,1);
   reject(signal.reason);
  };
  signal?.addEventListener('abort',task.abort,{once:true});
  waiting.push(task);drain();
 });
}
