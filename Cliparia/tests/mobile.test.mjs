import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {createReviewSession} from '../mobile.mjs';

async function serve(t,options){
 const origin='https://cliparia-test.trycloudflare.com',host=new URL(origin).host;
 const bearer='r'.repeat(32);
 const server=createServer(createReviewSession({origin,bearer,remote:true,...options}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const call=(path,headers={},method='GET')=>new Promise((resolve,reject)=>{
  const req=request({hostname:'127.0.0.1',port:server.address().port,path,headers:{Host:host,...headers},method},res=>{
   let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);
   res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,data:body?JSON.parse(body):null}));
  });
  req.once('error',reject);req.end();
 });
 const login=()=>call('/api/pair',{Origin:origin,Authorization:'Bearer '+bearer},'POST');
 return {call,login,origin,bearer};
}

test('sessão HTTPS exige origem e token válidos, entrega cookie protegido e mantém o Bearer antigo',async t=>{
 const handle=(req,res,session)=>res.writeHead(session.authenticated?200:403).end(JSON.stringify({authenticated:session.authenticated}));
 const {call,login,origin,bearer}=await serve(t,{handle});
 assert.equal((await call('/api/state')).status,403);
 assert.equal((await call('/api/pair',{Origin:'https://other.example',Authorization:'Bearer '+bearer},'POST')).status,403);
 assert.equal((await call('/api/pair',{Origin:origin,Authorization:'Bearer invalid'},'POST')).status,403);
 assert.equal((await call('/api/state',{Host:'other.example',Authorization:'Bearer '+bearer})).status,403);
 const paired=await login();
 assert.equal(paired.status,200);
 const [cookie]=paired.headers['set-cookie'];
 assert.match(cookie,/HttpOnly; SameSite=Strict; Path=\/; Max-Age=\d+; Secure/);
 assert.ok(!cookie.includes(bearer));
 assert.equal((await call('/api/state',{Cookie:cookie.split(';')[0]})).data.authenticated,true);
 assert.equal((await call('/api/state',{Authorization:'Bearer '+bearer})).data.authenticated,true);
});

test('permite acompanhar uma operação longa sem expor seu resultado a quem não está conectado',async t=>{
 let release,finished;
 const gate=new Promise(resolve=>{release=resolve;});
 const complete=new Promise(resolve=>{finished=resolve;});
 const handle=(req,res,session)=>{
  assert.equal(session.authenticated,true);
  const result=session.runInBackground(async()=>{
   await gate;finished();throw Object.assign(Error('Bloqueado pelo teste.'),{reason:'moderation'});
  });
  res.writeHead(202).end(JSON.stringify(result));
 };
 const {call,login}=await serve(t,{handle});
 const paired=await login(),cookie=paired.headers['set-cookie'][0].split(';')[0];
 const started=await call('/api/posting/add',{Cookie:cookie},'POST');
 assert.equal(started.status,202);
 const route='/api/mobile/task/'+started.data.task;
 assert.equal((await call(route)).status,403);
 assert.deepEqual((await call(route,{Cookie:cookie})).data,{pending:true});
 release();await complete;
 const result=await call(route,{Cookie:cookie});
 assert.equal(result.status,400);
 assert.deepEqual(result.data,{error:'Bloqueado pelo teste.',reason:'moderation'});
});

test('link expirado não libera sessão nem usa o token antigo',async t=>{
 const {call,login,bearer}=await serve(t,{expires:Date.now()-1,handle:()=>assert.fail('Sessão encerrada')});
 assert.equal((await login()).status,403);
 assert.equal((await call('/api/state',{Authorization:'Bearer '+bearer})).status,403);
});
