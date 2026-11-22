import {readFile} from 'node:fs/promises';
import {run} from './speech.mjs';
import {adjoiningRegion} from './layout.mjs';

const side=640;
const area=side*side;
const size=area*3;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const defaultLayout={frame:'full'};
let inference;

function loadDetector(){
 inference??=(async()=>{
  const ort=await import('./vendor/vision/ort.wasm.min.mjs');
  ort.env.wasm.numThreads=1;
  const model=await readFile(new URL('./vendor/vision/yunet.onnx',import.meta.url));
  const session=await ort.InferenceSession.create(model,{executionProviders:['wasm']});
  return {ort,session};
 })();
 return inference;
}
function iou(a,b){
 const w=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x));
 const h=Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
 return w*h/Math.max(1e-6,a.w*a.h+b.w*b.h-w*h);
}
function letterbox(width,height){
 const x=Math.max(2,Math.round(Math.min(side,side*width/height)/2)*2);
 const y=Math.max(2,Math.round(Math.min(side,side*height/width)/2)*2);
 return {x:(side-x)/2,y:(side-y)/2,w:x,h:y};
}
function decode(outputs,box,threshold=.68,full=false){
 const candidates=[];
 for(const stride of [8,16,32]){
  const cls=outputs['cls_'+stride].data,obj=outputs['obj_'+stride].data,reg=outputs['bbox_'+stride].data;
  const columns=side/stride;
  for(let i=0;i<cls.length;i++){
   const score=Math.sqrt(clamp(cls[i],0,1)*clamp(obj[i],0,1));
   if(score<threshold)continue;
   const at=i*4;
   const w=Math.exp(reg[at+2])*stride,h=Math.exp(reg[at+3])*stride;
   const x=((i%columns+reg[at])*stride-w/2-box.x)/box.w;
   const y=((Math.floor(i/columns)+reg[at+1])*stride-h/2-box.y)/box.h;
   const face={x,y,w:w/box.w,h:h/box.h,score};
   const cx=x+face.w/2,cy=y+face.h/2;
   if(cx<0||cx>1||cy<0||cy>1||face.w<.019||face.h<.037||face.w>(full?.85:.48)||face.h>(full?.96:.65))continue;
   candidates.push(face);
  }
 }
 const found=[];
 for(const face of candidates.sort((a,b)=>b.score-a.score)){
  if(found.every(keep=>iou(face,keep)<.32))found.push(face);
  if(found.length===8)break;
 }
 return found;
}
const center=r=>[r.x+r.w/2,r.y+r.h/2];
const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
export function webcamInUpperRight(aspect){
 const w=.214,h=clamp(w*aspect/(16/9),.13,.34);
 return splitLayout({x:.997-w,y:.094,w,h});
}

function splitLayout(camera){
 const gameplay=adjoiningRegion(camera,null);
 return gameplay?{frame:'split',camera,gameplay,autoLayout:true}:defaultLayout;
}

// Detect the framed camera in this overlay without relying on a face looking
// straight ahead. Each border has to survive across separate sampled frames.
export function framedUpperRight(frames,width,height){
 if(frames.length<2)return defaultLayout;
 const preset=webcamInUpperRight(width/height).camera;
 const scale=(edge,n)=>Math.round(edge*n);
 const left=scale(preset.x,width),right=scale(preset.x+preset.w,width);
 const top=scale(preset.y,height),bottom=scale(preset.y+preset.h,height);
 const gap=Math.max(1,Math.round(height*.004));
 const strength=(line,from,to,vertical)=>{
  const scores=frames.map(frame=>{
   let strong=0,count=0,sum=0;
   for(let i=from;i<to;i+=2){
    const center=vertical?(i*width+line)*3:(line*width+i)*3;
    const s=vertical?gap*3:gap*width*3;
    let contrast=0;
    for(let channel=0;channel<3;channel++){
     const a=frame[center-s+channel],b=frame[center+s+channel],c=frame[center+channel];
     contrast+=Math.max(Math.abs(a-b),Math.abs(a-c),Math.abs(b-c));
    }
    if(contrast>=76)strong++;
    sum+=Math.min(contrast,165);
    count++;
   }
   const coverage=strong/count;
   return coverage>=.57?coverage*(sum/count):0;
  });
  return median(scores);
 };
 const strongest=(edge,margin,from,to,limit,vertical)=>{
  let best={line:edge,score:0};
  for(let i=Math.max(gap,edge-margin);i<=Math.min(limit-gap-1,edge+margin);i++){
   const score=strength(i,from,to,vertical);
   if(score>best.score)best={line:i,score};
  }
  return best;
 };
 const xMargin=Math.max(2,scale(.023,width)),yMargin=Math.max(2,scale(.027,height));
 const l=strongest(left,xMargin,top+yMargin,bottom-yMargin,width,true);
 const t=strongest(top,yMargin,left+xMargin,right-xMargin,height,false);
 const b=strongest(bottom,yMargin,left+xMargin,right-xMargin,height,false);
 if(Math.min(l.score,t.score,b.score)<52)return defaultLayout;
 const w=(right-l.line)/width,h=(b.line-t.line)/height;
 if(w/h*(width/height)<1.36||w/h*(width/height)>2.23)return defaultLayout;
 return splitLayout({x:l.line/width,y:t.line/height,w,h});
}

export function webcamLayout(detections,aspect,confidence=.73,support=.60){
 if(detections.length<2)return defaultLayout;
 const tracks=[];
 for(const [frame,faces] of detections.entries()){
  for(const f of faces){
   const [x,y]=center(f);
   const edge=x<.28||x>.72||y<.23||y>.77;
   if(!edge||f.w>.23||f.h>.34)continue;
   const track=tracks.find(t=>{
    if(t.frames.has(frame))return false;
    const previous=t.faces.at(-1),[px,py]=center(previous);
    return Math.abs(x-px)<.055&&Math.abs(y-py)<.065&&f.w/previous.w>.60&&f.w/previous.w<1.55;
   });
   if(track){track.frames.add(frame);track.faces.push(f);}
   else tracks.push({frames:new Set([frame]),faces:[f]});
  }
 }
 const ranked=tracks.filter(t=>t.frames.size>=Math.max(2,Math.ceil(detections.length*support)))
  .sort((a,b)=>b.frames.size-a.frames.size||median(b.faces.map(f=>f.score))-median(a.faces.map(f=>f.score)));
 const winner=ranked[0];
 if(!winner||median(winner.faces.map(f=>f.score))<confidence)return defaultLayout;
 if(ranked[1]&&ranked[1].frames.size===winner.frames.size&&median(ranked[1].faces.map(f=>f.score))>median(winner.faces.map(f=>f.score))-.06)return defaultLayout;
 const f=Object.fromEntries(['x','y','w','h'].map(k=>[k,median(winner.faces.map(e=>e[k]))]));
 const [cx,cy]=center(f);
 const h=clamp(Math.max(f.h*2.25,f.w*2.55*aspect/1.52),.14,.44),w=clamp(h*1.52/aspect,.13,.46);
 const camera={x:clamp(cx-w/2,0,1-w),y:clamp(cy-h*.43,0,1-h),w,h};
 return splitLayout(camera);
}

function primaryFace(faces,previous){
 const usable=faces.filter(f=>{
  const [x,y]=center(f);
  return f.score>=.70&&f.w>=.04&&f.h>=.08&&(f.h>=.26&&f.w>=.12||x>.25&&x<.75&&y>.15&&y<.85);
 });
 return usable.sort((a,b)=>{
  const weight=f=>f.w*f.h*f.score/(1+(previous?Math.abs(center(f)[0]-previous.x)*3:0));
  return weight(b)-weight(a);
 })[0];
}

export function faceTrack(samples){
 const points=[];
 for(const {time,faces} of samples){
  const face=primaryFace(faces,points.at(-1));
  if(face)points.push({time,x:center(face)[0]});
 }
 if(points.length<2||points.length<Math.ceil(samples.length*.30))return null;
 return points.map((point,i)=>{
  const before=points[i-1],after=points[i+1];
  if(!before||!after||point.time-before.time>4||after.time-point.time>4)return point;
  return {...point,x:point.x*.65+(before.x+after.x)*.175};
 });
}

export async function automaticLayout(source,start,duration){
 const {width,height}=source;
 if(!width||!height||width/height<9/16||duration<10)return defaultLayout;
 try{
  const absolute=(source.windowStart||0)+start;
  const sampleW=Math.min(1280,Math.max(640,width)),sampleH=Math.max(2,Math.round(sampleW*height/width));
  const drawBytes=sampleW*sampleH*3,draws=4;
  const scale='scale='+sampleW+':'+sampleH;
  const output=['-an','-pix_fmt','bgr24','-f','rawvideo','pipe:1'];
  const runSample=(args,ms)=>{
   const limit=AbortSignal.timeout(ms);
   const signal=source.signal?AbortSignal.any([source.signal,limit]):limit;
   return run('ffmpeg',['-nostdin','-v','error',...args,...output],null,source.bytes,{signal});
  };
  const frames=[],sampleTimes=[];
  let accessError;
  if(source.bytes){
   const filter='trim=start='+absolute+':duration='+duration+',setpts=PTS-STARTPTS,fps='+draws+'/'+duration+','+scale;
   const raw=await runSample([...source.video,'-vf',filter,'-frames:v',String(draws)],45000);
   for(let i=0;i+drawBytes<=raw.length;i+=drawBytes){frames.push(raw.subarray(i,i+drawBytes));sampleTimes.push((i/drawBytes+.5)*duration/draws);}
  }else{
   const sample=portion=>runSample(['-ss',String(absolute+duration*portion),...source.video,'-vf',scale,'-frames:v','1'],12000);
   for(const portions of [[.12,.38],[.63,.88]]){
    const results=await Promise.allSettled(portions.map(sample));
    for(const [i,result] of results.entries()){
     if(result.status==='fulfilled'&&result.value.length===drawBytes){frames.push(result.value);sampleTimes.push(portions[i]*duration);}
     if(result.status==='rejected'&&result.reason?.httpStatus===403)accessError=result.reason;
    }
   }
  }
  source.signal?.throwIfAborted();
  if(!frames.length&&accessError)throw accessError;
  if(frames.length<2)return defaultLayout;
  const wide=width/height>=1.30;
  const outlined=wide?framedUpperRight(frames,sampleW,sampleH):defaultLayout;
  if(outlined.frame==='split')return outlined;
  const {ort,session}=await loadDetector();
  const pixels=new Float32Array(size);
  const tensor=new ort.Tensor('float32',pixels,[1,3,side,side]);
  const scan=async (raw,region,score,full=false,frameW=sampleW,frameH=sampleH)=>{
   source.signal?.throwIfAborted();
   const {x,y,w,h}=region;
   const pad=letterbox(w*frameW,h*frameH);
   pixels.fill(0);
   for(let row=0;row<pad.h;row++){
    const frameY=Math.min(frameH-1,Math.floor((y+(row+.5)*h/pad.h)*frameH));
    for(let col=0;col<pad.w;col++){
     const frameX=Math.min(frameW-1,Math.floor((x+(col+.5)*w/pad.w)*frameW));
     const from=(frameY*frameW+frameX)*3,to=(row+pad.y)*side+col+pad.x;
     pixels[to]=raw[from];pixels[to+area]=raw[from+1];pixels[to+area*2]=raw[from+2];
    }
   }
   return decode(await session.run({input:tensor}),pad,score,full)
    .map(f=>({...f,x:x+f.x*w,y:y+f.y*h,w:f.w*w,h:f.h*h}));
  };
  const detect=async(region,score,confidence,support)=>{
   const tracks=[];
   for(const frame of frames)tracks.push(await scan(frame,region,score));
   return webcamLayout(tracks,width/height,confidence,support);
  };
  const cropTrack=async coarse=>{
   const span=Math.max(.85,duration/48),sampleWidth=Math.min(480,width),sampleHeight=Math.max(2,Math.round(sampleWidth*height/width));
   const frameBytes=sampleWidth*sampleHeight*3;
   const trackScale='scale='+sampleWidth+':'+sampleHeight;
   const inputs=source.bytes?source.video:['-ss',String(absolute),...source.video];
   const trim=source.bytes?'trim=start='+absolute+':duration='+duration+',setpts=PTS-STARTPTS,':'';
   let track=coarse;
   try{
    const raw=await runSample([...inputs,'-t',String(duration),'-vf',trim+'fps=1/'+span+','+trackScale,'-frames:v',String(Math.ceil(duration/span))],45000);
    const samples=[];
    for(let i=0;i+frameBytes<=raw.length;i+=frameBytes){
     const faces=await scan(raw.subarray(i,i+frameBytes),fullFrame,.62,true,sampleWidth,sampleHeight);
     samples.push({time:Math.min(duration,(i/frameBytes+.5)*span),faces});
    }
    track=faceTrack(samples)||coarse;
   }catch(error){source.signal?.throwIfAborted();}
   return {frame:'face-track',track};
  };
  const fullFrame={x:0,y:0,w:1,h:1},initialFaces=[];
  for(const frame of frames)initialFaces.push(await scan(frame,fullFrame,.68,true));
  const split=wide?webcamLayout(initialFaces,width/height):defaultLayout;
  if(split.frame==='split')return split;
  const strongFull=faceTrack(initialFaces.map((faces,i)=>({time:sampleTimes[i],faces})));
  if(strongFull&&initialFaces.filter(faces=>faces.some(f=>f.h>=.35&&f.w>=.15&&f.score>=.70)).length>=2)return cropTrack(strongFull);
  if(!wide)return strongFull?cropTrack(strongFull):defaultLayout;
  const upperRight=await detect({x:.75,y:.045,w:.25,h:.32},.56,.62,.50);
  if(upperRight.frame==='split')return upperRight;
  const cornerResults=[];
  for(const [x,y] of [[.47,0],[0,0],[.47,.43],[0,.43]]){
   const layout=await detect({x,y,w:.53,h:.57});
   if(layout.frame==='split'&&cornerResults.every(other=>iou(other.camera,layout.camera)<.5))cornerResults.push(layout);
   if(cornerResults.length>1)return defaultLayout;
  }
  if(cornerResults.length)return cornerResults[0];
  return strongFull?cropTrack(strongFull):defaultLayout;
 }catch(error){
  source.signal?.throwIfAborted();
  if([401,403,410].includes(error.httpStatus))throw error;
  return defaultLayout;
 }
}
