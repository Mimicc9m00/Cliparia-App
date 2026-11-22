import http from 'node:http';
import https from 'node:https';
import {randomBytes} from 'node:crypto';
import {isIPv4} from 'node:net';
import {pipeline} from 'node:stream/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {openTunnel} from './mobile.mjs';

const lifetime=15*60_000;
const activeHosts=new Set();
const publicReels=new Map();
const idleTime=45*60_000;
let sharedTunnel;
process.once('exit',()=>{for(const active of activeHosts)active.tunnel?.kill();});

function bounds(range,size){
 if(range===undefined)return {start:0,end:size-1,status:200};
 const match=/^bytes=(\d*)-(\d*)$/.exec(range);
 if(!match||!match[1]&&!match[2])return;
 const start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2]));
 const end=match[1]&&match[2]?Math.min(size-1,Number(match[2])):size-1;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||end>=size)return;
 return {start,end,status:206};
}

async function dnsAddresses(host){
 const params=new URLSearchParams({name:host,type:'A'});
 const resolvers=['https://cloudflare-dns.com/dns-query?','https://dns.google/resolve?'];
 const replies=await Promise.allSettled(resolvers.map(async url=>{
  const response=await fetch(url+params,{headers:{Accept:'application/dns-json'},signal:AbortSignal.timeout(4000)});
  if(!response.ok)return [];
  return (await response.json()).Answer?.filter(record=>record.type===1&&isIPv4(record.data)).map(record=>record.data)||[];
 }));
 return [...new Set(replies.flatMap(reply=>reply.status==='fulfilled'?reply.value:[]))];
}
function publicRange(url,size,probe,address){
 return new Promise(resolve=>{
  const options={method:'GET',headers:{Range:'bytes=0-0','X-Cliparia-Probe':probe},agent:false,signal:AbortSignal.timeout(4000)};
  if(address)options.lookup=(_host,{all},done)=>all?done(null,[{address,family:4}]):done(null,address,4);
  const request=https.request(url,options,response=>{
   if(response.statusCode!==206||response.headers['content-range']!==`bytes 0-0/${size}`||response.headers['content-length']!=='1'||!/^video\/mp4\b/i.test(response.headers['content-type']||'')){
    resolve(false);return response.destroy();
   }
   let received=0;
   response.on('data',chunk=>{received+=chunk.length;});
   response.on('error',()=>resolve(false));
   response.on('close',()=>resolve(false));
   response.on('end',()=>resolve(received===1));
   response.resume();
  });
  request.on('error',()=>resolve(false));request.end();
 });
}
async function verifyPublicReel(url,size,probe,{fresh=false}={}){
 // A local lookup before a new tunnel has propagated can cache NXDOMAIN on Windows.
 if(!fresh&&await publicRange(url,size,probe))return;
 const host=new URL(url).hostname;
 const waits=fresh?[2000,4000,8000,8000,0]:[0];
 for(const wait of waits){
  const addresses=await dnsAddresses(host);
  if((await Promise.all(addresses.map(address=>publicRange(url,size,probe,address)))).some(Boolean))return;
  if(wait)await delay(wait);
 }
 throw Error('Não foi possível ler o vídeo pelo endereço público.');
}

export const reelRoute=/^\/reel-[A-Za-z0-9_-]{43}\.mp4$/;
function serve(reels,req,res){
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('Referrer-Policy','no-referrer');
 const stream=reels.get(req.url);
 if(!stream||!['GET','HEAD'].includes(req.method)){res.writeHead(404);return res.end();}
 return stream(req,res);
}
export function servePublicReel(req,res){return serve(publicReels,req,res);}

function startRelay(executable,tunnel,protocol,keepAlive){
 const reels=new Map();
 let timer,closed=false;
 const active={reels,executable,origin:undefined,accepting:true,server:http.createServer((req,res)=>{
  if(!active.origin||req.headers.host!==new URL(active.origin).host||req.socket.remoteAddress!=='127.0.0.1'){
   res.writeHead(404);return res.end();
  }
  return serve(reels,req,res);
 })};
 active.stop=()=>{
  if(closed)return;
  closed=true;active.accepting=false;clearTimeout(timer);activeHosts.delete(active);
  if(sharedTunnel===active)sharedTunnel=undefined;
  active.tunnel?.kill();active.server.close();active.server.closeAllConnections();
 };
 active.detach=()=>{
  if(closed||reels.size)return;
  clearTimeout(timer);
  if(!active.accepting||!keepAlive)return active.stop();
  timer=setTimeout(active.stop,idleTime).unref();
 };
 active.attach=()=>clearTimeout(timer);
 active.retire=()=>{
  active.accepting=false;
  if(sharedTunnel===active)sharedTunnel=undefined;
  active.detach();
 };
 active.open=new Promise((resolve,reject)=>{
  active.server.once('error',reject);
  active.server.listen(0,'127.0.0.1',()=>{active.server.removeListener('error',reject);active.server.unref();resolve();});
 }).then(async()=>{
  activeHosts.add(active);
  active.origin=await tunnel(active,executable,active.stop,{protocol});
  if(closed)throw Error('O túnel do Instagram foi encerrado.');
 }).catch(error=>{active.stop();throw error;});
 return active;
}

export async function hostReel(reel,executable,dispose,{tunnel=openTunnel,verify=verifyPublicReel,publicOrigin,keepAlive=tunnel===openTunnel}={}){
 const resource='/reel-'+randomBytes(32).toString('base64url')+'.mp4',probe=randomBytes(24).toString('base64url');
 let closing,timer,requests=0,sent=[],release;
 const downloads=new Map();
 function record(start,end){
  const merged=[];
  for(const [first,last] of [...sent,[start,end]].sort((a,b)=>a[0]-b[0])){
   const tail=merged.at(-1);
   if(tail&&first<=tail[1]+1)tail[1]=Math.max(tail[1],last);
   else merged.push([first,last]);
  }
  sent=merged;
 }
 async function stream(req,res){
  const range=bounds(req.headers.range,reel.size);
  if(!range){res.writeHead(416,{'Content-Range':'bytes */'+reel.size});return res.end();}
  const {start,end,status}=range;
  res.writeHead(status,{'Content-Type':'video/mp4','Content-Length':String(end-start+1),'Accept-Ranges':'bytes',
   ...(status===206?{'Content-Range':`bytes ${start}-${end}/${reel.size}`}:{})});
  if(req.method==='HEAD')return res.end();
  const measuring=req.headers['x-cliparia-probe']!==probe;
  if(measuring)requests++;
  const downloading=Promise.resolve().then(()=>reel.stream(start,end)).then(input=>pipeline(input,res));
  downloads.set(downloading,res);
  try{await downloading;if(measuring)record(start,end);}catch{res.destroy();}
  finally{downloads.delete(downloading);}
 }
 const close=()=>{
  if(closing)return closing;
  clearTimeout(timer);release?.();
  for(const res of downloads.values())res.destroy();
  closing=Promise.allSettled(downloads.keys()).then(dispose);
  return closing;
 };
 async function attach(origin,reels,relay,fresh){
  const url=origin+resource;
  relay?.attach();
  reels.set(resource,stream);
  release=()=>{reels.delete(resource);relay?.detach();};
  try{
   await verify(url,reel.size,probe,{fresh});
   if(relay&&!relay.accepting)throw Error('O túnel do Instagram foi encerrado.');
  }catch(error){release();release=undefined;throw error;}
  timer=setTimeout(()=>void close().catch(()=>{}),lifetime).unref();
  return {url,close,delivery:()=>({requests,bytes:sent.reduce((total,[start,end])=>total+end-start+1,0),size:reel.size})};
 }
 let issue;
 if(publicOrigin){
  try{return await attach(publicOrigin,publicReels,undefined,false);}catch(error){issue=error;}
 }
 if(keepAlive&&sharedTunnel?.executable===executable){
  const active=sharedTunnel;
  try{await active.open;return await attach(active.origin,active.reels,active,false);}
  catch(error){active.retire();issue=error;}
 }
 for(const protocol of ['http2','quic']){
  const active=startRelay(executable,tunnel,protocol,keepAlive);
  if(keepAlive)sharedTunnel=active;
  try{
   await active.open;
   return await attach(active.origin,active.reels,active,true);
  }catch(error){
   active.retire();issue=error;
   if(error.code==='ENOENT')break;
  }
 }
 await close().catch(()=>{});
 throw Object.assign(Error('O Instagram está aguardando um link público para o vídeo.',{cause:issue}),{reason:'instagram_link_unavailable'});
}
