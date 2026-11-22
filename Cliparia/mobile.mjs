import http from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';
import {existsSync,promises as fs} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {run} from './speech.mjs';

const port=43872;
const lifetime=60*60*1000;
const privateIPv4=/^(192\.168\.|172\.(1[6-9]|2\d|3[01])\.|10\.)\d/;
const cookieName='cliparia_review';
const remoteOrigin=/https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com(?=[\s|]|$)/i;
let pair;
export function networkOptions(){
 return Object.entries(os.networkInterfaces()).flatMap(([name,entries])=>entries
  .filter(e=>e.family==='IPv4'&&!e.internal&&privateIPv4.test(e.address))
  .map(e=>({name,address:e.address})));
}
export function stopPair(){
 if(!pair)return;
 const previous=pair;
 pair=null;clearTimeout(previous.timer);
 previous.tunnel?.kill();
 previous.server.close();
 previous.server.closeAllConnections();
}
const token=()=>crypto.randomBytes(24).toString('base64url');
function respond(res,status,body){
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
 res.end(JSON.stringify(body));
}
export function createReviewSession({origin,bearer=token(),expires=Date.now()+lifetime,remote=false,handle}){
 const host=new URL(origin).host,session=token(),tasks=new Map();
 function runInBackground(work){
  const now=Date.now();
  for(const [id,task] of tasks)if(task.doneAt&&now-task.doneAt>10*60_000)tasks.delete(id);
  if(tasks.size>=24)return {error:'Há muitas operações iniciadas pelo celular. Aguarde antes de tentar novamente.'};
  const task={},id=crypto.randomUUID();tasks.set(id,task);
  void Promise.resolve().then(work).then(result=>{task.result=result;},error=>{
   task.error={error:error.message||'Não foi possível concluir.',reason:error.reason};
  }).finally(()=>{task.doneAt=Date.now();});
  return {task:id};
 }
 return function review(req,res){
  res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; form-action 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'");
  const forbidden=()=>respond(res,403,{error:'Acesso encerrado. Gere um novo link em Celular no Cliparia.'});
  const address=req.socket.remoteAddress||'';
  if(Date.now()>=expires||req.headers.host!==host||(remote?address!=='127.0.0.1':!privateIPv4.test(address)))return forbidden();
  const uri=req.url?.startsWith('/')&&!req.url.startsWith('//')&&URL.parse(req.url,origin);
  if(!uri||uri.origin!==origin)return forbidden();
  const route=uri.pathname;
  const authorized=req.headers.authorization==='Bearer '+bearer;
  if(route==='/api/pair'&&req.method==='POST'){
   if(!authorized||req.headers.origin!==origin)return forbidden();
   res.setHeader('Set-Cookie',cookieName+'='+session+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+Math.max(0,Math.floor((expires-Date.now())/1000))+(remote?'; Secure':''));
   return respond(res,200,{ok:true});
  }
  const hasCookie=(req.headers.cookie||'').split(/;\s*/).includes(cookieName+'='+session);
  const authenticated=authorized||hasCookie;
  if(route.startsWith('/api/mobile/task/')&&req.method==='GET'){
   if(!authenticated)return forbidden();
   const id=route.slice('/api/mobile/task/'.length),task=tasks.get(id);
   if(!task)return respond(res,404,{error:'Operação indisponível. Atualize a fila.'});
   if(!task.doneAt)return respond(res,200,{pending:true});
   return respond(res,task.error?400:200,task.error||task.result);
  }
  return handle(req,res,{origin,authenticated,remote,runInBackground});
 };
}

export function tunnelExecutable(folder){
 const portable=path.join(folder,'cloudflared.exe');
 return process.env.CLIPARIA_CLOUDFLARED||(existsSync(portable)?portable:'cloudflared');
}

export function openTunnel(active,executable,onClose=()=>{},{protocol}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,['tunnel','--no-autoupdate',...(protocol?['--protocol',protocol]:[]),'--url','http://127.0.0.1:'+active.server.address().port],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  active.tunnel=child;
  let tail='',settled=false,origin,registered=false;
  const timer=setTimeout(()=>fail(Error('A Cloudflare não liberou o link HTTPS a tempo. Confira a conexão e tente novamente.')),45_000);
  function fail(error){if(!settled){settled=true;clearTimeout(timer);reject(error);}}
  function read(chunk){
   if(settled)return;
   tail=(tail+chunk).slice(-4000);
   origin??=tail.match(remoteOrigin)?.[0];
   registered||=tail.includes('Registered tunnel connection');
   if(origin&&registered){settled=true;clearTimeout(timer);resolve(origin.toLowerCase());}
  }
  child.stdout.on('data',read);child.stderr.on('data',read);
  child.on('error',error=>fail(Object.assign(Error(error.code==='ENOENT'?'Instale o cloudflared no PC para gerar o link pela internet.':'O Cliparia não conseguiu iniciar o cloudflared.'),{code:error.code})));
  child.once('close',()=>{
   fail(Error('O túnel da Cloudflare encerrou antes de liberar o acesso.'));
   onClose();
  });
 });
}

export async function startPair(address,handle,{remote=false,executable='cloudflared'}={}){
 if(!remote&&!networkOptions().some(e=>e.address===address))throw Error('Selecione uma interface da sua rede local.');
 stopPair();
 const active={server:http.createServer((req,res)=>{
  if(pair!==active||!active.review)return respond(res,503,{error:'A conexão está sendo preparada.'});
  void active.review(req,res);
 })};
 pair=active;
 try{
  const bind=remote?'127.0.0.1':address;
  try{await listen(active.server,bind,remote?0:port);}
  catch(error){if(remote||error.code!=='EADDRINUSE')throw error;await listen(active.server,bind,0);}
  if(pair!==active)throw Error('A conexão foi encerrada.');
  const origin=remote?await openTunnel(active,executable,()=>{if(pair===active&&active.review)stopPair();}):'http://'+address+':'+active.server.address().port;
  if(pair!==active)throw Error('A conexão foi encerrada.');
  const bearer=token(),expires=Date.now()+lifetime;
  active.review=createReviewSession({origin,bearer,expires,remote,handle});
  active.timer=setTimeout(()=>{if(pair===active)stopPair();},lifetime).unref();
  return origin+'/#revisao='+bearer;
 }catch(error){
  if(pair===active)stopPair();else if(active.server.listening)active.server.close();
  throw error;
 }
}

function listen(server,address,port){
 return new Promise((resolve,reject)=>{
  const onError=error=>{server.removeListener('listening',onListening);reject(error);};
  const onListening=()=>{server.removeListener('error',onError);resolve();};
  server.once('error',onError);
  server.listen(port,address,onListening);
 });
}

process.once('exit',stopPair);

export async function pairingQR(url){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cliparia-qr-'));
 try{
  await fs.writeFile(path.join(dir,'pair.txt'),url,'utf8');
  const png=await run('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','qrencodesrc=textfile=pair.txt:q=256:Q=320:level=M','-frames:v','1','-c:v','png','-f','image2pipe','pipe:1'],null,null,{cwd:dir});
  return png.toString('base64');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
}
