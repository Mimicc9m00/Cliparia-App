import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {Readable} from 'node:stream';
import {hostReel,servePublicReel} from '../reel-host.mjs';

test('link temporário do Reel serve somente o arquivo autorizado e aceita faixas',async t=>{
 const origin='https://reel-test.trycloudflare.com';
 const host=new URL(origin).host,bytes=Buffer.from('mp4 de teste');
 let port,disposed=0;
 const lease=await hostReel({size:bytes.length,stream:(start,end)=>Readable.from([bytes.subarray(start,end+1)])},'fake',async()=>{disposed++;},{
  tunnel:async active=>{port=active.server.address().port;return origin;},verify:async()=>{}
 });
 t.after(()=>lease.close());
 const resource=new URL(lease.url).pathname;
 const call=(path=resource,method='GET',headers={})=>new Promise((resolve,reject)=>{
  const req=request({hostname:'127.0.0.1',port,path,method,headers:{Host:host,...headers}},res=>{
   let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);
   res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));
  });
  req.on('error',reject);req.end();
 });
 const head=await call(resource,'HEAD');
 assert.equal(head.status,200);assert.equal(head.body,'');assert.equal(head.headers['content-length'],String(bytes.length));
 assert.deepEqual(lease.delivery(),{requests:0,bytes:0,size:bytes.length});
 const range=await call(resource,'GET',{Range:'bytes=0-2'});
 assert.equal(range.status,206);assert.equal(range.body,'mp4');assert.equal(range.headers['content-range'],`bytes 0-2/${bytes.length}`);
 assert.equal((await call(resource,'GET',{Range:'bytes=-5'})).body,'teste');
 await call(resource,'GET',{Range:'bytes=1-2'});
 assert.deepEqual(lease.delivery(),{requests:3,bytes:8,size:bytes.length});
 assert.equal((await call()).body,bytes.toString());
 assert.deepEqual(lease.delivery(),{requests:4,bytes:bytes.length,size:bytes.length});
 assert.equal((await call(resource,'GET',{Range:'bytes=999-'})).status,416);
 assert.deepEqual([(await call('/api/state')).status,(await call(resource,'POST')).status,(await call(resource,'GET',{Host:'other.example'})).status],[404,404,404]);
 await lease.close();await lease.close();assert.equal(disposed,1);
 await assert.rejects(call(),{code:'ECONNREFUSED'});
});

test('troca o túnel que não abriu publicamente e preserva o mesmo arquivo',async t=>{
 const origins=['https://unreachable.trycloudflare.com','https://ready.trycloudflare.com'];
 const checked=[],protocols=[];
 let opened=0,stopped=0,disposed=0;
 const lease=await hostReel({size:1},'fake',async()=>{disposed++;},{
  tunnel:async(active,_executable,onClose,{protocol})=>{
   protocols.push(protocol);
   active.tunnel={kill(){stopped++;onClose();}};
   return origins[opened++];
  },
  verify:async url=>{
   checked.push(new URL(url).origin);
   if(checked.length===1)throw Error('Ainda indisponível');
  }
 });
 t.after(()=>lease.close());
 assert.deepEqual(checked,origins);
 assert.deepEqual(protocols,['http2','quic']);
 assert.equal(stopped,1);
 assert.equal(disposed,0);
 assert.equal(new URL(lease.url).origin,origins[1]);
 await lease.close();
 assert.equal(stopped,2);
 assert.equal(disposed,1);
});

test('domínio fixo entrega só o vídeo autorizado e a sondagem não conta como entrega à Meta',async t=>{
 const server=createServer(servePublicReel);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.close();server.closeAllConnections();});
 const local='http://127.0.0.1:'+server.address().port,origin='https://cliparia.example';
 const bytes=Buffer.from('conteúdo do Reel');
 const reel={size:bytes.length,stream:(start,end)=>Readable.from([bytes.subarray(start,end+1)])};
 const lease=await hostReel(reel,'unused',()=>{}, {
  publicOrigin:origin,tunnel:()=>assert.fail('O domínio fixo já funcionou.'),
  verify:async(url,_size,probe)=>{
   assert.equal(new URL(url).origin,origin);
   const response=await fetch(local+new URL(url).pathname,{headers:{Range:'bytes=0-0','X-Cliparia-Probe':probe}});
   assert.equal(response.status,206);
   assert.equal(await response.text(),'c');
  }
 });
 const url=local+new URL(lease.url).pathname;
 assert.deepEqual(lease.delivery(),{requests:0,bytes:0,size:bytes.length});
 assert.equal((await fetch(local+'/api/state')).status,404);
 assert.equal(await (await fetch(url)).text(),bytes.toString());
 await lease.close();
 assert.equal((await fetch(url)).status,404);
});

test('reutiliza um túnel saudável com links independentes e troca o túnel indisponível',async t=>{
 const bytes=Buffer.from('teste');
 const reel={size:bytes.length,stream:(start,end)=>Readable.from([bytes.subarray(start,end+1)])};
 let opened=0,available=true,retired=0;
 const options={keepAlive:true,tunnel:async(active,_exe,onClose)=>{
  active.tunnel={kill(){retired++;onClose();}};
  return `https://gateway-${++opened}.trycloudflare.com`;
 },verify:async(_url,_size,_probe,{fresh})=>{
  if(!available&&!fresh)throw Error('Túnel indisponível');
 }};
 const leases=[];
 const start=async()=>{
  const lease=await hostReel(reel,'reuse-test',()=>{},options);
  leases.push(lease);
  return lease;
 };
 t.after(()=>Promise.all(leases.map(lease=>lease.close())));
 const a=await start();
 const b=await start();
 assert.equal(opened,1);
 assert.equal(new URL(a.url).origin,new URL(b.url).origin);
 assert.notEqual(a.url,b.url);
 available=false;
 const replacement=await start();
 assert.equal(opened,2);
 assert.notEqual(new URL(a.url).origin,new URL(replacement.url).origin);
 assert.equal(retired,0);
 await Promise.all([a.close(),b.close()]);
 assert.equal(retired,1);
});
