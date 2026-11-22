import {auth} from './social.mjs';
import {responseChunks} from './remote.mjs';
const api='https://www.googleapis.com/drive/v3/files';
async function checked(res){
 if(!res.ok){const e=await res.json().catch(()=>({}));throw Error(e.error?.message||'Google Drive respondeu '+res.status);}
 return res;
}
async function request(url,opts={}){
 return checked(await fetch(url,{...opts,headers:{...await auth('drive'),...opts.headers}}));
}
export async function folder(signal){
 const q="trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='cliparia' and value='cuts' }";
 const list=await (await request(api+'?'+new URLSearchParams({q,fields:'files(id)'}),{signal})).json();
 if(list.files.length)return list.files[0].id;
 const result=await request(api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Cliparia · Cortes',mimeType:'application/vnd.google-apps.folder',appProperties:{cliparia:'cuts'}}),signal});
 return (await result.json()).id;
}
export function upload(parent,name,bytes){return send('',{name,parents:[parent],mimeType:'video/mp4'},bytes);}
export async function createCloudState(bytes){
 const created=await request(api+'?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Cliparia · estado criptografado',mimeType:'application/octet-stream',appProperties:{cliparia:'cloud-state'}}),signal:AbortSignal.timeout(30_000)});
 const {id}=await created.json();
 await writeCloudState(id,bytes);
 return id;
}
export async function writeCloudState(id,bytes){
 await request('https://www.googleapis.com/upload/drive/v3/files/'+encodeURIComponent(id)+'?uploadType=media',{method:'PATCH',headers:{'Content-Type':'application/octet-stream'},body:bytes,signal:AbortSignal.timeout(30_000)});
}
export function replace(id,bytes){return send('/'+encodeURIComponent(id),{},bytes);}
async function send(file,metadata,bytes){
 const init=await request('https://www.googleapis.com/upload/drive/v3/files'+file+'?uploadType=resumable&fields=id,size',{method:file?'PATCH':'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':'video/mp4','X-Upload-Content-Length':String(bytes.length)},body:JSON.stringify(metadata)});
 const session=init.headers.get('location');
 if(!session)throw Error('O Drive não iniciou a transferência.');
 let pos=0,errors=0;
 const progressed=res=>Number((res.headers.get('range')||'').match(/bytes=0-(\d+)$/)?.[1]??-1)+1;
 while(pos<bytes.length){
  const end=Math.min(pos+8*1024*1024,bytes.length);
  let res=await fetch(session,{method:'PUT',headers:{'Content-Type':'video/mp4','Content-Range':'bytes '+pos+'-'+(end-1)+'/'+bytes.length},body:bytes.subarray(pos,end),redirect:'manual'}).catch(()=>null);
  if(!res||res.status>=500||res.status===429){
   if(++errors>3)throw Error('Envio ao Drive interrompido.');
   await new Promise(ok=>setTimeout(ok,errors*1000));
   res=await fetch(session,{method:'PUT',headers:{'Content-Length':'0','Content-Range':'bytes */'+bytes.length},redirect:'manual'});
  }
  if(res.status===308){const next=progressed(res);if(next===pos&&++errors>3)throw Error('O Drive deixou de confirmar os blocos.');pos=next;continue;}
  const item=await (await checked(res)).json();
  if(!item.id||Number(item.size)!==bytes.length)throw Error('O Drive não confirmou o arquivo completo.');
  return {id:item.id,size:bytes.length};
 }
 throw Error('Transferência incompleta no Drive.');
}
export async function media(id,range,signal){
 const r=await request(api+'/'+encodeURIComponent(id)+'?alt=media',{signal,headers:{'Accept-Encoding':'identity',...(range?{Range:range}:{})}});
 if(range&&r.status!==206){await r.body?.cancel().catch(()=>{});throw Error('O Drive não confirmou a faixa solicitada.');}
 return r;
}
export function mediaChunks(response){return responseChunks(response,'A transferência do vídeo no Google Drive foi interrompida. Tente abrir ou enviar o corte novamente.');}
export async function remove(id){
 await request(api+'/'+encodeURIComponent(id),{method:'DELETE'});
}

export async function setTrashed(id,trashed){
 const url=api+'/'+encodeURIComponent(id)+'?fields=id,trashed&supportsAllDrives=true';
 const response=await request(url,{
  method:'PATCH',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({trashed}),signal:AbortSignal.timeout(20_000),redirect:'error'
 });
 const item=await response.json();
 if(item.id!==id||item.trashed!==trashed)throw Error('O Drive não confirmou a alteração na lixeira.');
}
