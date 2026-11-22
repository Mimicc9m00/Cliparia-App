import {run} from './speech.mjs';

let hardware;
const gpu=['-c:v','h264_nvenc','-preset','p3','-rc','vbr','-cq','21','-b:v','0'];
function testEncoder(){
 hardware??=run('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=size=1280x720:rate=30','-frames:v','2',...gpu,'-f','null','-'],null,null,{signal:AbortSignal.timeout(4000)})
  .then(()=>true,()=>false);
 return hardware;
}
export async function withH264(work,software,signal,accelerated=gpu){
 signal?.throwIfAborted();
 const available=await testEncoder();
 signal?.throwIfAborted();
 if(available){
  try{return await work(accelerated);}
  catch(error){
   // Reuse the original error for denied sources and filter/input errors.
   signal?.throwIfAborted();
   if(!/nvenc|nvcuda|no capable devices|no device available|unsupported device/i.test(error.message))throw error;
   hardware=Promise.resolve(false);
  }
 }
 return work(software);
}

export async function withVideoDecode(codec,work,signal){
 signal?.throwIfAborted();
 // Restrict NVDEC to the H.264 path verified against the same CPU samples.
 if(process.platform==='win32'&&/^(?:h264|avc1)(?:\.|$)/i.test(codec||'')&&await testEncoder()){
  signal?.throwIfAborted();
  try{return await work(['-hwaccel:v','cuda']);}
  catch(error){
   signal?.throwIfAborted();
   if(!/cuda|cuvid|nvdec|hardware accelerator|device setup failed|failed to (?:get|initiali[sz]e) a device/i.test(error.message))throw error;
  }
 }
 return work([]);
}
