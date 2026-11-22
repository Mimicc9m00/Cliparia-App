import fs from 'node:fs';

function transmissionKey(job){
 const key=job.mediaKey||(job.sourcePlatform&&job.mediaId?job.sourcePlatform+':'+job.mediaId:'');
 // IDs are case-sensitive even when the extractor name is not.
 if(key&&!/^[^:]+:https?:\/\//i.test(key))return key.replace(/^([^:]+):/,(_,extractor)=>extractor.toLowerCase()+':');
 const url=URL.parse(job.url);
 if(!url)return '';
 const host=url.hostname.replace(/^(?:www|m)\./,'');
 if(host==='youtube.com'||host==='youtu.be'){
  const id=host==='youtu.be'?url.pathname.split('/')[1]:url.pathname==='/watch'?url.searchParams.get('v'):
   url.pathname.match(/^\/(?:live|shorts)\/([\w-]+)\/?$/)?.[1];
  if(id&&/^[\w-]{11}$/.test(id))return 'youtube:'+id;
 }
 if(host==='twitch.tv'){
  const id=url.pathname.match(/^\/videos\/(\d+)\/?$/)?.[1];
  if(id)return 'twitchvod:'+id;
 }
 if(host==='kick.com'){
  const id=url.pathname.match(/^\/(?:[\w-]+\/)?(?:video|videos)\/([a-f\d-]{36})\/?$/i)?.[1];
  if(id)return 'kickvod:'+id;
 }
 return '';
}

function clipRecord(job,clip,visual=''){
 const start=clip.originalStart??clip.start,length=clip.originalLength??clip.length;
 const timeline=job.scanMode==='vod'&&Number.isFinite(start)&&Number.isFinite(length)&&start>=0&&length>0;
 return {...(timeline?{start,length}:{}),...(clip.contentHash?{hash:clip.contentHash}:{}),...(visual?{visual}:{})};
}

function overlapping(first,second){
 if(first.start===undefined||second.start===undefined)return false;
 const common=Math.min(first.start+first.length,second.start+second.length)-Math.max(first.start,second.start);
 return common>=Math.min(first.length,second.length)*.75&&common>=Math.max(first.length,second.length)*.55;
}

// Build a 64-bit difference hash from a 32 × 18 luminance plane.
export function frameSignature(frame){
 let hex='';
 for(let y=1;y<17;y+=2){
  let row=0;
  for(let x=3;x<27;x+=3)row=(row<<1)|Number(frame[y*32+x]>frame[y*32+x+3]);
  hex+=row.toString(16).padStart(2,'0');
 }
 return hex;
}

export function visualRange(visual,start,length){
 return visual?.slice(start*16,(start+length)*16)||'';
}

function words(visual){
 return Uint32Array.from(visual?.match(/.{8}/g)||[],value=>parseInt(value,16));
}

function bitCount(value){
 value-=value>>>1&0x55555555;
 value=(value&0x33333333)+(value>>>2&0x33333333);
 return Math.imul((value+(value>>>4))&0x0f0f0f0f,0x01010101)>>>24;
}

function visualDistance(a,index,b,other){
 return bitCount(a[index*2]^b[other*2])+bitCount(a[index*2+1]^b[other*2+1]);
}

function sameSequence(a,b){
 const first=a.length/2,second=b.length/2;
 const minimum=Math.max(24,Math.ceil(Math.min(first,second)*.75),Math.ceil(Math.max(first,second)*.55));
 if(minimum>Math.min(first,second))return false;
 for(let shift=minimum-first;shift<=second-minimum;shift++){
  const from=Math.max(0,-shift),end=Math.min(first,second-shift);
  const samples=Math.ceil((end-from)/4),required=Math.ceil(samples*.7);
  let matches=0,misses=0;
  const distinct=[];
  for(let index=from;index<end;index+=4){
   if(visualDistance(a,index,b,index+shift)>8){
    if(++misses>samples-required)break;
    continue;
   }
   matches++;
   if(distinct.length<4&&distinct.every(old=>visualDistance(a,index,a,old)>10))distinct.push(index);
   if(matches>=required&&distinct.length>=4)return true;
  }
 }
 return false;
}

export function createGenerationHistory(file,jobs=[]){
 const data=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{enabled:true,sources:{}};
 const sequences=new WeakMap();
 const save=()=>{fs.writeFileSync(file+'.tmp',JSON.stringify(data));fs.renameSync(file+'.tmp',file);};
 function remember(job,clip,visual){
  const key=transmissionKey(job),record=clipRecord(job,clip,visual);
  if(!key||!Object.keys(record).length)return false;
  const saved=data.sources[key]??=[];
  const existing=saved.find(entry=>(entry.hash&&entry.hash===record.hash&&entry.start===record.start)||
   (entry.start!==undefined&&entry.start===record.start&&entry.length===record.length));
  if(existing){
   if(!record.visual||existing.visual)return false;
   existing.visual=record.visual;
  }else saved.push(record);
  return true;
 }
 let imported=false;
 for(const job of jobs)for(const clip of job.clips)imported=remember(job,clip)||imported;
 if(imported)save();
 return {
  enabled:()=>data.enabled,
  backup:()=>data.sources,
  restore(sources){
   let changed=false;
   for(const [key,rows] of Object.entries(sources)){
    const saved=data.sources[key]??=[];
    const known=new Set(saved.map(row=>JSON.stringify([row.start,row.length,row.hash,row.visual])));
    for(const row of rows){
     const id=JSON.stringify([row.start,row.length,row.hash,row.visual]);
     if(known.has(id))continue;
     known.add(id);saved.push(row);changed=true;
    }
   }
   if(changed)save();
  },
  setEnabled(enabled){
   if(typeof enabled!=='boolean')throw Error('Informe se a proteção contra cortes repetidos deve ficar ativa.');
   if(data.enabled!==enabled){data.enabled=enabled;save();}
  },
  remember(job,clip,visual){if(remember(job,clip,visual))save();},
  duplicate(job,clip,visual){
   const saved=data.sources[transmissionKey(job)];
   if(!data.enabled||!saved)return false;
   const candidate=clipRecord(job,clip,visual);
   if(saved.some(record=>(candidate.hash&&candidate.hash===record.hash)||overlapping(record,candidate)))return true;
   if(!visual||!saved.some(record=>record.visual&&(candidate.start===undefined||record.start===undefined)))return false;
   const frames=words(visual);
   return saved.some(record=>{
    if(!record.visual||candidate.start!==undefined&&record.start!==undefined)return false;
    if(!sequences.has(record))sequences.set(record,words(record.visual));
    return sameSequence(frames,sequences.get(record));
   });
  }
 };
}
