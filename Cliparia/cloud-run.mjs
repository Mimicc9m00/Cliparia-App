import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {cloudKey,collectCloudFiles,restoreCloudFiles,seal,unseal} from './cloud-state.mjs';
import {openVault} from './social.mjs';
import {media,writeCloudState} from './drive.mjs';
import {modelName} from './speech.mjs';
import {panelSnapshot} from './cloud-panel.mjs';

async function panelRequest(route,body){
 const url=process.env.CLIPARIA_PANEL_URL,token=process.env.CLIPARIA_PANEL_TOKEN;
 if(!/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(url||'')||!/^[a-f0-9]{64}$/.test(token||''))throw Error('Confira a configuração do painel remoto.');
 const response=await fetch(url+'/bridge/'+route,{
  method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15_000),redirect:'error',
 });
 if(!response.ok)throw Error('O painel remoto respondeu HTTP '+response.status+'.');
 return response.json();
}

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cliparia-cloud-'));
try{
 if(process.platform==='win32')throw Error('Execute o lote na imagem Linux do Cliparia.');
 const id=process.env.CLIPARIA_CLOUD_FILE_ID||'',bootstrap=process.env.CLIPARIA_CLOUD_DRIVE||'',key=cloudKey();
 if(!/^[\w-]{5,200}$/.test(id)||!bootstrap)throw Error('Configure o arquivo de estado e o acesso ao Drive nos Secrets.');
 restoreCloudFiles(dir,{'contas.dat':bootstrap});
 openVault(dir);
 const response=await media(id,undefined,AbortSignal.timeout(40_000));
 const state=unseal(Buffer.from(await response.arrayBuffer()),key);
 if(state.version!==1)throw Error('Versão de estado incompatível.');
 if(state.running)throw Error('O lote anterior ficou inconclusivo. Confira os envios antes de liberar outra execução.');
 restoreCloudFiles(dir,state.files);
 const panelEnabled=!!(process.env.CLIPARIA_PANEL_URL||process.env.CLIPARIA_PANEL_TOKEN);
 const readLocal=(name,fallback)=>{
  const file=path.join(dir,name);
  return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):fallback;
 };
 const syncPanel=()=>panelRequest('snapshot',panelSnapshot(readLocal('lives.json',[]),readLocal('publicacoes.json',{}),
  readLocal('panel-results.json',[]),readLocal('continuo.json',{})));
 const syncOnly=process.env.CLIPARIA_PANEL_SYNC_ONLY==='true';
 if(syncOnly){
  await syncPanel();
  console.log('Painel atualizado a partir do estado criptografado do Drive.');
 }else{
 if(panelEnabled){
  const {commands}=await panelRequest('commands');
  if(!Array.isArray(commands)||commands.length>5)throw Error('O painel remoto enviou uma lista inválida.');
  if(commands.length)fs.writeFileSync(path.join(dir,'panel-commands.json'),JSON.stringify(commands));
 }
 const model='/opt/cliparia-model/'+modelName;
 if(fs.existsSync(model))fs.copyFileSync(model,path.join(dir,modelName));
 openVault(dir);
 await writeCloudState(id,seal({...state,running:true},key));
 const app=fileURLToPath(new URL('./app.mjs',import.meta.url));
 const outcome=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[app],{env:{...process.env,CLIPARIA_DATA:dir,CLIPARIA_CLOUD_BATCH:'1',CLIPARIA_BIND:'127.0.0.1',CLIPARIA_PUBLIC_URL:''},stdio:'ignore'});
  child.once('error',reject);
  child.once('exit',resolve);
 });
 openVault(dir);
 await writeCloudState(id,seal({version:1,running:outcome!==0,files:collectCloudFiles(dir)},key));
 if(outcome!==0)throw Error('O lote encerrou com erro. O estado foi preservado para revisão.');
 const jobs=JSON.parse(fs.readFileSync(path.join(dir,'lives.json'),'utf8'));
 const clips=jobs.flatMap(job=>job.clips);
 if(process.env.CLIPARIA_CLOUD_COPY_ONLY==='true'){
  console.log('Revisão de texto concluída. Cortes recuperados com transcrição: '+clips.filter(clip=>clip.recoveredFromDrive&&clip.copyBasis==='speech').length+'.');
 }else console.log('Lote concluído e estado atualizado no Drive. Cortes no histórico: '+clips.length+'.');
 if(panelEnabled)await syncPanel();
 }
}catch(error){
 console.error(error.message);
 process.exitCode=1;
}finally{fs.rmSync(dir,{recursive:true,force:true});}
