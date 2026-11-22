const blocks=12;
export function probeRanges(total){
 const duration=18;
 const end=Math.max(0,Math.floor(total)-duration);
 return Array.from({length:blocks},(_,i)=>({offset:Math.round(end*(i+.5)/blocks),duration}));
}
export function hotRanges(total,length,heatmap=[],probes=[]){
 const end=Math.floor(total);
 if(end<=Math.max(150,length+30))return [{offset:0,duration:end}];
 const anchors=probes.slice();
 for(const h of heatmap){
  const heat=Number(h.value),start=Number(h.start_time),stop=Number(h.end_time);
  if(!Number.isFinite(heat)||heat<.64||!(stop>start)||start>=end)continue;
  anchors.push({at:Math.min(end-1,Math.max(0,(start+stop)/2)),score:2+heat});
 }
 const span=Math.max(70,length+28);
 const selected=[];
 for(const {at,score} of anchors.sort((a,b)=>b.score-a.score||a.at-b.at)){
  if(!Number.isFinite(at)||!Number.isFinite(score))continue;
  const offset=Math.max(0,Math.min(Math.floor(at-span*.34),end-span));
  if(selected.some(other=>Math.abs(other.offset-offset)<span*.60))continue;
  selected.push({offset,duration:Math.min(span,end-offset)});
  if(selected.length>=10)break;
 }
 return selected;
}
