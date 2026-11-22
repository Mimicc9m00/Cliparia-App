const standard='bv*+ba/b';
const compatible='b[height<=1080]/b/bv*+ba';
export const mediaFormats={standard,compatible};

export function httpStatus(message){
 const match=String(message).match(/(?:HTTP(?:\/\d(?:\.\d)?)?(?:\s+error)?|server returned)\s*:?\s*(\d{3})\b/i);
 return match?Number(match[1]):undefined;
}
export function accessError(){
 return Error('A plataforma recusou o acesso à mídia (HTTP 403). O Cliparia já tentou renovar o link e abrir outro formato disponível. Verifique se a live ou o VOD está público e atualize o yt-dlp antes de tentar de novo.');
}

export async function* responseChunks(response,message){
 const encoding=response.headers.get('content-encoding');
 const length=response.headers.get('content-length');
 const expected=(!encoding||encoding.toLowerCase()==='identity')&&length!==null?Number(length):null;
 let received=0;
 try{
  if(!response.body)throw Error('Resposta sem corpo.');
  // Read directly from the Fetch stream so a premature close rejects the
  // consumer's read instead of emitting an error on a detached Node stream.
  for await(const chunk of response.body){
   received+=chunk.byteLength;
   if(expected!==null&&received>expected)throw Error('Resposta maior que o tamanho informado.');
   yield chunk;
  }
  if(expected!==null&&received!==expected)throw Error('Resposta menor que o tamanho informado.');
 }catch(cause){throw Object.assign(Error(message,{cause}),{code:'CLIPARIA_TRANSFER_INTERRUPTED'});}
}

export function transferInterrupted(error){
 for(let cause=error;cause;cause=cause.cause){
  if(['CLIPARIA_TRANSFER_INTERRUPTED','UND_ERR_RES_CONTENT_LENGTH_MISMATCH'].includes(cause.code))return true;
 }
 return false;
}

// Keep the most recently working URLs for the next stage. Attempts are
// bounded for each read, and a channel URL must resolve to the same broadcast.
export function remoteAccess(initial,reload,onRetry=()=>{}){
 let current=initial;
 let format=standard;
 return async function read(operation){
  const choices=[format,...(format===standard?[compatible]:[standard])];
  for(let i=0;;i++){
   try{
    return await operation(current);
   }catch(error){
    if(error.httpStatus!==403||error.receivedMedia)throw error;
    if(i===choices.length)throw accessError();
   }
   let next;
   while(!next&&i<choices.length){
    onRetry(i);
    try{next=await reload(choices[i]);}
    catch(error){
     if(error.httpStatus!==403&&!/requested format is not available|no video formats found/i.test(error.message))throw error;
     if(++i===choices.length)throw accessError();
    }
   }
   if(initial.id&&next.id!==initial.id)throw Error('A fonte mudou de transmissão. Abra o link da live ou do VOD que deseja analisar.');
   if(!!(initial.is_live||initial.live_status==='is_live')!==!!(next.is_live||next.live_status==='is_live')){
    throw Error('A live mudou de estado. Se já terminou, tente abrir o replay quando estiver disponível.');
   }
   current=next;
   format=choices[i];
  }
 };
}
