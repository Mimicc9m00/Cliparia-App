const outcome=/\b(?:consegui|ganhei|vencemos|perdemos|viramos|zeramos|morri|matei|eliminei|virada|clutch|recorde|imposs[ií]vel|acertou|derrotamos|no way|we won|i won|i did it|i got it|i died|world record)\b/iu;
const reaction=/(?:meu deus|n[aã]o acredito|que isso|que foi isso|caramba|socorro|nossa|incr[ií]vel|oh my god|what just happened|holy|wow)/iu;
const sizeOf=(...arrays)=>Math.max(...arrays.map(a=>a.length));
const cap=value=>Math.max(0,Math.min(1,value));
function averages(values){
 const sum=[0];
 for(const v of values)sum.push(sum.at(-1)+v);
 return (from,to)=>{
  const a=Math.max(0,Math.min(values.length,from)),b=Math.max(a,Math.min(values.length,to));
  return (sum[b]-sum[a])/Math.max(1,b-a);
 };
}
function speechEvents(speech){
 const repeated=new Set();
 return speech.flatMap(part=>{
  const text=part.text.trim();
  if(text.length<4)return [];
  const key=text.toLowerCase().replace(/[^\p{L} ]/gu,'').replace(/\s+/g,' ');
  if(repeated.has(key))return [];
  repeated.add(key);
  return outcome.test(text)||reaction.test(text)?[{at:Math.floor((part.start+part.end)/2),text,outcome:outcome.test(text)}]:[];
 });
}
export function rankedMoments({motion=[],volume=[],levels=[],heatmap=[],speech=[],duration},length){
 const seconds=duration??sizeOf(motion,volume,levels);
 if(seconds<length)return [];
 const image=Array.from({length:seconds},(_,i)=>motion[i]||0);
 const sound=Array.from({length:seconds},(_,i)=>levels.length&&levels[i]<35?0:volume[i]||0);
 const replay=Array(seconds).fill(0);
 for(const h of heatmap){
  const power=cap(Number(h.value)||0);
  for(let i=Math.max(0,Math.floor(h.start_time));i<Math.min(seconds,Math.ceil(h.end_time));i++)replay[i]=Math.max(replay[i],power);
 }
 const avgImage=averages(image),avgSound=averages(sound),avgReplay=averages(replay),words=speechEvents(speech);
 const replayFloor=avgReplay(0,seconds);
 const candidates=[];
 for(let t=1;t<seconds-1;t++){
  const v=avgImage(t-2,t+4),a=avgSound(t-2,t+4),h=avgReplay(t-1,t+3);
  const vBefore=avgImage(t-20,t-5),vAfter=avgImage(t+7,t+22);
  const aBefore=avgSound(t-20,t-5),aAfter=avgSound(t+7,t+22);
  const baseline=(before,after)=>t<8?after:t+8>=seconds?before:(before+after)/2;
  const dv=Math.max(0,v-baseline(vBefore,vAfter)),da=Math.max(0,a-baseline(aBefore,aAfter));
  let overlaps=0,visualSeconds=0,audioSeconds=0;
  for(let i=Math.max(0,t-3);i<Math.min(seconds,t+5);i++){
   const visible=image[i]>=.48,sounded=sound[i]>=.55;
   if(visible)visualSeconds++;
   if(sounded)audioSeconds++;
   if(visible&&sounded)overlaps++;
  }
  const speechHit=words.find(word=>Math.abs(word.at-t)<=3);
  const replayHit=h>=.73&&h-replayFloor>=.24&&h-avgReplay(t-28,t-8)>=.16;
  const audiovisual=overlaps>=3&&visualSeconds>=4&&audioSeconds>=4&&dv>=.17&&da>=.20;
  const visualEvent=visualSeconds>=6&&v>=.73&&dv>=.44&&avgImage(t-3,t)>=.43&&avgImage(t+1,t+4)>=.43;
  const speaking=!!speechHit&&(speechHit.outcome||da>=.12||dv>=.18||h>=.48);
  const evidence=speaking?'fala':replayHit?'replay':audiovisual?'ação e reação':visualEvent?'ação visual':null;
  const probe=!evidence&&(audioSeconds>=4&&da>=.22||overlaps>=2&&dv>=.13&&da>=.13);
  if(!evidence&&!probe)continue;
  const start=Math.max(0,Math.min(t-Math.round(length*.30),seconds-length));
  const score=(evidence?1:0)+(speaking?.46:0)+(replayHit?.54:0)+(audiovisual?.48:0)+(visualEvent?.25:0)+dv*.24+da*.23+h*.28+overlaps*.035;
  candidates.push({start,at:t,score,evidence,text:speechHit?.text||''});
 }
 return candidates.sort((a,b)=>b.score-a.score||a.at-b.at);
}
export function selectMoments(ranked,length,count,excluded=[],allow=()=>true){
 const result=[];
 if(count<=0)return result;
 for(const moment of ranked){
  if(!moment.evidence||excluded.concat(result).some(other=>Math.abs(other.start-moment.start)<length)||!allow(moment))continue;
  result.push(moment);
  if(result.length>=count)break;
 }
 return result;
}
export function probeMoments(ranked,selected,seconds){
 const points=[];
 for(const moment of ranked){
  if(moment.evidence||selected.some(hit=>Math.abs(hit.at-moment.at)<25))continue;
  const start=Math.max(0,Math.min(moment.at-5,seconds-12));
  if(points.every(i=>Math.abs(i-start)>=25))points.push(start);
  if(points.length>=2)break;
 }
 return points;
}
export function captionBounds(levels,start,length){
 if(!levels.length)return {start,duration:length};
 let first=-1,last=-1;
 for(let i=start;i<start+length&&i<levels.length;i++){
  if(levels[i]>=5){if(first<0)first=i;last=i;}
 }
 if(first<0)return {start,duration:levels.length>=start+length-1?0:length};
 const from=Math.max(start,first-2),to=Math.min(start+length,last+3);
 return {start:from,duration:to-from};
}
