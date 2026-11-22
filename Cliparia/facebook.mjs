import {normalize} from './instagram.mjs';

const graph='https://graph.facebook.com/v26.0/';
const numeric=id=>typeof id==='string'&&/^\d+$/.test(id);
export function invalidToken(){
 return Object.assign(Error('Facebook: a autorização da Página expirou ou perdeu a validade. Gere um novo token da Página e use Reconectar em Contas → Facebook.'),{rejected:true,reason:'facebook_token_invalid'});
}
async function json(response){
 const data=await response.json().catch(()=>({}));
 if(!response.ok||data.error||data.success===false){
  const code=Number(data.error?.code??data.error_code??data.debug_info?.code);
  const detail=data.error?.message||data.debug_info?.message||data.message;
  if([102,190].includes(code)||/error validating access token|session has expired|access token.*expired/i.test(detail||''))throw invalidToken();
  const message=[10,200].includes(code)?'Autorize pages_manage_posts, pages_read_engagement e pages_show_list para a página no Meta e reconecte o Facebook.':data.error?.message||'HTTP '+response.status;
  throw Object.assign(Error('Facebook: '+message),{rejected:response.status>=400&&response.status<500,reason:String(code||response.status)});
 }
 return data;
}
function api(credentials,edge,body){
 return fetch(graph+edge,{headers:{Authorization:'Bearer '+credentials.token},method:body?'POST':'GET',body:body?new URLSearchParams(body):undefined,redirect:'error',signal:AbortSignal.timeout(30_000)}).then(json);
}
export async function profile(credentials){
 if(!numeric(credentials.id))throw Error('Informe o ID numérico da Página do Facebook.');
 const info=await api(credentials,'me?fields=id,name');
 if(info.id!==credentials.id)throw Error('O token não pertence à Página do Facebook informada.');
 const page=await api(credentials,credentials.id+'?fields=id,name,is_published');
 if(page.id!==credentials.id||!page.name||typeof page.is_published!=='boolean')throw Error('O token não confirmou uma Página do Facebook.');
 return {channel_id:page.id,creator_nickname:page.name};
}
export async function connect(id,token){
 if(!numeric(id))throw Error('Informe o ID numérico da Página do Facebook.');
 if(!token||token.length>5000||/\s/.test(token))throw Error('Informe um token da Meta com permissão pages_manage_posts.');
 const who=await api({token},'me?fields=id,name');
 if(who.id!==id){
  const permissions=await api({token},'me/permissions');
  const required=['pages_show_list','pages_read_engagement','pages_manage_posts'];
  if(required.some(p=>!permissions.data?.some(item=>item.permission===p&&item.status==='granted')))throw Error('Adicione pages_manage_posts, pages_read_engagement e pages_show_list no Meta, gere um novo token autorizando a Página e tente novamente.');
  const page=await api({token},id+'?fields=id,access_token');
  if(page.id!==id||!page.access_token)throw Error('O token não tem acesso à Página informada. Autorize a Página no Meta.');
  token=page.access_token;
 }
 const credentials={id,token};
 const account=await profile(credentials);
 return {...credentials,account:account.creator_nickname};
}
export async function sendReel(credentials,source,clip,body,onID,encode=s=>normalize(s,true)){
 if(!Number.isFinite(clip.length)||clip.length<3||clip.length>90)throw Error('Reels do Facebook devem ter de 3 a 90 segundos. Ajuste o corte antes de enviar.');
 if(body.privacy!=='public')throw Error('Confirme a publicação pública na Página do Facebook.');
 const account=await profile(credentials);
 if(!body.channel||body.channel!==account.channel_id)throw Error('A Página do Facebook mudou. Confira a página antes de publicar.');
 if(!Number.isSafeInteger(source.size)||source.size<1||source.size>1_000_000_000)throw Error('O Reel precisa ter até 1 GB.');
 const reel=await encode(source);
 try{
  const session=await api(credentials,credentials.id+'/video_reels',{upload_phase:'start'});
  if(!numeric(session.video_id)||typeof session.upload_url!=='string')throw Error('O Facebook não retornou uma sessão de envio válida.');
  const url=new URL(session.upload_url);
  if(url.origin!=='https://rupload.facebook.com'||!/^\/video-upload\/(?:v\d+\.\d+\/)?\d+$/.test(url.pathname)||url.pathname.split('/').at(-1)!==session.video_id||url.username||url.password||url.search||url.hash)throw Error('Endereço de envio do Facebook inválido.');
  const post={state:'Em processamento',id:session.video_id,account:credentials.id,uploaded:false,title:String(body.title||clip.title).slice(0,100),description:String(body.description||clip.description||body.title||clip.title).slice(0,2200)};
  onID(post.id,post);
  const sent=await json(await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20*60_000),duplex:'half',headers:{Authorization:'OAuth '+credentials.token,offset:'0',file_size:String(reel.size),'Content-Length':String(reel.size),'Content-Type':'application/octet-stream'},body:await reel.stream()}));
  if(sent.success!==true)throw Error('O Facebook não confirmou a transferência do vídeo.');
  post.uploaded=true;onID(post.id,post);
  return post;
 }finally{await reel.dispose();}
}
export async function advance(credentials,post,save,statusOnly=false){
 if(post.account!==credentials.id)throw Error('Reconecte a mesma Página usada para enviar este Reel do Facebook.');
 const data=await api(credentials,post.id+'?fields=status');
 const status=data.status;
 if(!status)throw Error('O Facebook ainda não confirmou o estado do Reel.');
 if(status.publishing_phase?.publish_status==='published')return {...post,state:'Publicado',detail:''};
 const phases=[status.uploading_phase,status.processing_phase,status.publishing_phase];
 if(['error','expired','upload_failed'].includes(status.video_status)||phases.some(p=>p?.status==='error'))return {...post,state:'Falhou',detail:phases.find(p=>p?.error)?.error?.message||'O Facebook não conseguiu preparar o Reel.'};
 if(statusOnly)return post;
 if(!post.uploaded)return {...post,detail:'Transferência sem confirmação. Confira o Reel na Página antes de tentar outro envio.'};
 // Facebook's finish phase starts encoding/publishing; waiting for processing
 // to complete here can leave an uploaded Reel stuck forever.
 if(post.publishRequested||status.video_status==='uploading'||status.uploading_phase?.status==='in_progress')return post;
 post.publishRequested=true;save();
 try{
  const published=await api(credentials,credentials.id+'/video_reels',{upload_phase:'finish',video_id:post.id,video_state:'PUBLISHED',title:post.title,description:post.description});
  if(published.success!==true)throw Error('O Facebook não confirmou o pedido de publicação.');
  return {...post,state:'Em processamento',detail:'Publicação solicitada. Aguardando confirmação do Facebook.'};
 }catch(error){
  if(error.reason==='facebook_token_invalid'){
   post.publishRequested=false;
   save();
   throw error;
  }
  return {...post,state:error.rejected?'Falhou':'Confirmação pendente',detail:error.message};
 }
}
