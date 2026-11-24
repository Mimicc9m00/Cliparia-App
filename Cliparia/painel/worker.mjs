const platforms=['youtube','instagram','facebook','tiktok'];
const maxSnapshot=1_800_000;
const headers={
 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
const json=(value,status=200)=>Response.json(value,{status,headers});

async function credentialsEqual(expected,received){
 if(!expected||!received||received.length>256)return false;
 const encoder=new TextEncoder();
 const [a,b]=await Promise.all([expected,received].map(value=>crypto.subtle.digest('SHA-256',encoder.encode(value))));
 const left=new Uint8Array(a),right=new Uint8Array(b);
 let difference=0;
 for(let i=0;i<left.length;i++)difference|=left[i]^right[i];
 return difference===0;
}

function commandFrom(value){
 if(!value||!/^[a-f0-9-]{36}$/i.test(value.id||''))return;
 const {id,action}=value;
 if(action==='shuffle')return {id,action};
 if((action==='enabled'||action==='generation-enabled')&&typeof value.enabled==='boolean')return {id,action,enabled:value.enabled};
 if(action==='add-live'){
  if(typeof value.url!=='string'||value.url.length>2000||!Number.isInteger(value.duration)||value.duration<40||value.duration>180||
   typeof value.follow!=='boolean'||typeof value.captions!=='boolean')return;
  const url=URL.parse(value.url);
  if(!url||url.protocol!=='https:'||url.username||url.password||url.port||
   !['youtube.com','www.youtube.com','m.youtube.com','youtu.be','twitch.tv','www.twitch.tv','kick.com','www.kick.com'].includes(url.hostname))return;
  return {id,action,url:url.href,duration:value.duration,follow:value.follow,captions:value.captions};
 }
 if(!['select','remove','up','down','trash-video','restore-video'].includes(action)||typeof value.job!=='string'||!value.job||value.job.length>140||
  !Number.isSafeInteger(value.index)||value.index<0||!Number.isSafeInteger(value.revision)||value.revision<0)return;
 const command={id,action,job:value.job,index:value.index,revision:value.revision};
 if(action==='trash-video'||action==='restore-video')return value.consent===true?{...command,consent:true}:undefined;
 if(action!=='select')return command;
 if(!Array.isArray(value.targets)||!value.targets.length||value.targets.length>platforms.length||value.targets.some(p=>!platforms.includes(p)))return;
 return {...command,targets:[...new Set(value.targets)]};
}

async function body(request,max){
 const length=Number(request.headers.get('Content-Length'));
 if(length>max)return;
 const reader=request.body?.getReader();
 if(!reader)return;
 const decoder=new TextDecoder();
 let size=0,value='';
 while(true){
  const {done,value:chunk}=await reader.read();
  if(done)break;
  size+=chunk.length;
  if(size>max){await reader.cancel();return;}
  value+=decoder.decode(chunk,{stream:true});
 }
 try{return JSON.parse(value+decoder.decode());}catch{return;}
}

export class ClipariaPanel{
 constructor(ctx){
  this.storage=ctx.storage;
  this.sql=ctx.storage.sql;
  this.sql.exec('CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)');
  this.sql.exec('CREATE TABLE IF NOT EXISTS commands (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, payload TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0)');
 }
 async fetch(request){
  const pathname=new URL(request.url).pathname;
  if(pathname==='/api/state'){
   const stored=this.sql.exec('SELECT payload FROM snapshots WHERE id=1').toArray()[0];
   const pending=this.sql.exec('SELECT COUNT(*) AS count FROM commands WHERE done=0').one().count;
   return json({snapshot:stored?JSON.parse(stored.payload):null,pending});
  }
  if(pathname==='/api/commands'){
   const command=commandFrom(await body(request,4096));
   if(!command)return json({error:'Comando inválido.'},400);
   if(this.sql.exec('SELECT id FROM commands WHERE id=?',command.id).toArray().length)return json({accepted:true},202);
   if(this.sql.exec('SELECT COUNT(*) AS count FROM commands WHERE done=0').one().count>=24)return json({error:'Aguarde os comandos que já estão na fila.'},409);
   this.sql.exec('INSERT INTO commands (id,payload) VALUES (?,?)',command.id,JSON.stringify(command));
   return json({accepted:true},202);
  }
  if(pathname==='/bridge/commands'){
   const commands=this.sql.exec('SELECT payload FROM commands WHERE done=0 ORDER BY seq LIMIT 5').toArray().map(row=>JSON.parse(row.payload));
   return json({commands});
  }
  if(pathname==='/bridge/snapshot'){
   const snapshot=await body(request,maxSnapshot);
   if(!snapshot||!Array.isArray(snapshot.clips)||!Array.isArray(snapshot.results)||snapshot.results.length>12)return json({error:'Estado inválido.'},400);
   this.storage.transactionSync(()=>{
    this.sql.exec('INSERT INTO snapshots (id,payload) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',JSON.stringify(snapshot));
    for(const result of snapshot.results){
     if(/^[a-f0-9-]{36}$/i.test(result?.id||''))this.sql.exec('UPDATE commands SET done=1 WHERE id=?',result.id);
    }
    this.sql.exec('DELETE FROM commands WHERE done=1 AND seq NOT IN (SELECT seq FROM commands WHERE done=1 ORDER BY seq DESC LIMIT 128)');
   });
   return json({ok:true});
  }
  return json({error:'Página indisponível.'},404);
 }
}

async function githubFailure(response,operation){
 const body=await response.json().catch(()=>null);
 const message=typeof body?.message==='string'?body.message:'';
 const reason=/rate limit|abuse detection/i.test(message)?'limite de chamadas':
  /resource not accessible|access.*denied|not authorized|permission/i.test(message)?'permissão insuficiente':
  /saml|single sign-on/i.test(message)?'autorização SSO necessária':
  /bad credentials|requires authentication/i.test(message)?'credencial recusada':
  /user-agent/i.test(message)?'identificação do cliente recusada':'';
 return Error(operation+' do GitHub retornou HTTP '+response.status+(reason?' ('+reason+')':'')+'.');
}

function githubWorkflow(env){
  if(!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY||''))throw Error('Repositório do agendamento inválido.');
  const endpoint='https://api.github.com/repos/'+env.GITHUB_REPOSITORY+'/actions/workflows/cliparia-nuvem.yml';
  const token=env.GITHUB_DISPATCH_TOKEN?.trim();
  const headers={
   ...(token?{Authorization:'Bearer '+token}:{}),Accept:'application/vnd.github+json',
   'Content-Type':'application/json','User-Agent':'Cliparia-Scheduler','X-GitHub-Api-Version':'2026-03-10',
  };
  return {endpoint,headers};
}

async function batchStatus(url,env){
 const cache=globalThis.caches?.default;
 const key=new Request(url.origin+'/api/batch');
 try{
  const stored=await cache?.match(key);
  if(stored)return json(await stored.json());
  const {endpoint,headers}=githubWorkflow(env);
  const response=await fetch(endpoint+'/runs?per_page=1',{headers,redirect:'manual',signal:AbortSignal.timeout(5000)});
  if(!response.ok)return json({error:'Estado do lote indisponível.'},502);
  const run=(await response.json()).workflow_runs?.[0];
  const result=run&&Number.isSafeInteger(run.id)?{
   status:run.status,conclusion:run.conclusion,startedAt:run.run_started_at||run.created_at,
   url:'https://github.com/'+env.GITHUB_REPOSITORY+'/actions/runs/'+run.id,
  }:null;
  if(cache)await cache.put(key,Response.json(result,{headers:{'Cache-Control':'public, max-age=20'}}));
  return json(result);
 }catch{return json({error:'Estado do lote indisponível.'},502);}
}

async function dispatchScheduled(event,env){
  if(!env.GITHUB_DISPATCH_TOKEN?.trim())return 'sem credencial';
  const {endpoint,headers}=githubWorkflow(env);
  const recent=await fetch(endpoint+'/runs?per_page=10',{headers,redirect:'manual',signal:AbortSignal.timeout(12000)});
  if(!recent.ok)throw await githubFailure(recent,'A consulta aos lotes');
  const {workflow_runs:runs}=await recent.json();
  const utilityTitles=['Cliparia · Sincronizar painel','Cliparia · Transcrever cortes recuperados'];
  if(runs.some(run=>run.status!=='completed'||run.conclusion!=='skipped'&&!utilityTitles.includes(run.display_title)&&
   Date.parse(run.created_at)>event.scheduledTime-12*60_000))return 'lote recente ou ativo';
  const dispatch=await fetch(endpoint+'/dispatches',{
   method:'POST',headers,body:JSON.stringify({ref:'main',inputs:{painel_somente:false}}),redirect:'manual',signal:AbortSignal.timeout(12000),
  });
  if(!dispatch.ok)throw await githubFailure(dispatch,'O disparo do lote');
  return 'lote disparado';
}

export default {
 async scheduled(event,env){
  const outcome=await dispatchScheduled(event,env);
  console.log('Agendamento do Cliparia: '+outcome+'.');
 },
 async fetch(request,env){
  const url=new URL(request.url);
  const route=url.pathname;
  const authorization=request.headers.get('Authorization');
  if(route.startsWith('/bridge/')){
   const allowed=route==='/bridge/commands'&&request.method==='GET'||route==='/bridge/snapshot'&&request.method==='POST';
   if(!allowed)return json({error:'Página indisponível.'},404);
   if(!env.PANEL_BRIDGE_TOKEN||!await credentialsEqual('Bearer '+env.PANEL_BRIDGE_TOKEN,authorization))return json({error:'Sem acesso.'},401);
  }else{
   if(!env.PANEL_PASSWORD)return json({error:'Painel em configuração.'},503);
   if(!await credentialsEqual('Basic '+btoa('cliparia:'+env.PANEL_PASSWORD),authorization)){
    return new Response('Entre com o usuário cliparia e a senha do painel.',{status:401,headers:{...headers,'WWW-Authenticate':'Basic realm="Cliparia", charset="UTF-8"'}});
   }
   if(route==='/api/commands'&&request.method==='POST'){
    if(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Origem inválida.'},403);
   }else if(request.method!=='GET'&&request.method!=='HEAD')return json({error:'Método inválido.'},405);
   else if(route==='/api/batch')return batchStatus(url,env);
   else if(route.startsWith('/api/')&&route!=='/api/state')return json({error:'Página indisponível.'},404);
   else if(!route.startsWith('/api/')){
    const response=await env.ASSETS.fetch(request);
    const privateHeaders=new Headers(response.headers);
    for(const [name,value] of Object.entries(headers))privateHeaders.set(name,value);
    return new Response(response.body,{status:response.status,headers:privateHeaders});
   }
  }
  return env.PANEL.get(env.PANEL.idFromName('queue')).fetch(request);
 },
};
