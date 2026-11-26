import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {seal,unseal,restoreCloudFiles} from '../cloud-state.mjs';
import {createCloudDrive} from '../cloud-drive.mjs';
import {auth,driveAuthorization} from '../social.mjs';
import {writeCloudState} from '../drive.mjs';

function testKey(t){
 const previous=process.env.CLIPARIA_VAULT_KEY;
 const platform=Object.getOwnPropertyDescriptor(process,'platform');
 const key=randomBytes(32);
 Object.defineProperty(process,'platform',{...platform,value:'linux'});
 process.env.CLIPARIA_VAULT_KEY=key.toString('hex');
 t.after(()=>{
  Object.defineProperty(process,'platform',platform);
  if(previous===undefined)delete process.env.CLIPARIA_VAULT_KEY;
  else process.env.CLIPARIA_VAULT_KEY=previous;
 });
 return key;
}

test('estado criptografado exige a chave correta e rejeita alterações',()=>{
 const key=randomBytes(32),state={version:1,running:true,files:{'lives.json':'W10='}};
 const packed=seal(state,key);
 assert.deepEqual(unseal(packed,key),state);
 assert.throws(()=>unseal(packed,randomBytes(32)));
 packed[packed.length-1]^=1;
 assert.throws(()=>unseal(packed,key));
});

test('restauração de lote recusa caminhos externos antes de escrever',()=>{
 assert.throws(()=>restoreCloudFiles('.',{'contas.dat':'AA==','../arquivo':'AA=='}),/inválido/);
});

test('o próximo lote usa a autorização renovada e um novo Secret substitui a anterior',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'cliparia-drive-access-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const key=testKey(t);
 const token=value=>({id:'client',secret:'client-secret',tokens:{refresh:value,access:'antigo',expires:0}});
 const bootstrap=seal({drive:token('original')},key).toString('base64');
 const nextBootstrap=seal({drive:token('nova-autorizacao')},key).toString('base64');
 let saved;
 const calls=[];
 const panel=async(_route,value)=>{if(value)saved=value;return saved;};
 t.mock.method(globalThis,'fetch',async(url,{body})=>{
  assert.equal(url,'https://oauth2.googleapis.com/token');
  calls.push(body.get('refresh_token'));
  return body.get('refresh_token')==='original'
   ?Response.json({access_token:'renovado',refresh_token:'rotacionado',expires_in:3600,refresh_token_expires_in:1800})
   :Response.json({error:'invalid_grant'},{status:400});
 });
 const first=createCloudDrive(dir,key,bootstrap,panel);
 assert.deepEqual(await first.read(()=>auth('drive')),{Authorization:'Bearer renovado'});
 assert.equal(saved.issue,'expiring');
 assert.equal(unseal(Buffer.from(saved.authorization,'base64'),key).drive.tokens.refresh,'rotacionado');
 assert.equal((await createCloudDrive(dir,key,bootstrap,panel).read(()=>auth('drive'))).Authorization,'Bearer renovado');
 const newConnection=createCloudDrive(dir,key,nextBootstrap,panel);
 let rejection;
 await assert.rejects(newConnection.read(()=>auth('drive')),error=>{
  rejection=error;
  return error.reason==='oauth_reconnect'&&error.platform==='drive';
 });
 await newConnection.reportError(rejection);
 assert.equal(saved.issue,'reconnect');
 assert.deepEqual(calls,['original','nova-autorizacao']);
 assert.equal(driveAuthorization().tokens,undefined);
});

test('repetir a gravação da fila após erro transitório usa os mesmos bytes',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'cliparia-drive-write-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const key=testKey(t);
 const bootstrap=seal({drive:{id:'client',tokens:{refresh:'refresh',access:'access',expires:Date.now()+3600_000}}},key).toString('base64');
 await createCloudDrive(dir,key,bootstrap).read(()=>auth('drive'));
 const payload=Buffer.from('estado criptografado');
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.match(url,/\/upload\/drive\/v3\/files\/arquivo/);
  calls.push(options);
  return new Response(null,{status:calls.length===1?503:200});
 });
 await writeCloudState('arquivo',payload);
 assert.equal(calls.length,2);
 assert.ok(calls.every(call=>call.method==='PATCH'&&call.body===payload));
});
