import {createHash} from 'node:crypto';
import {seal,unseal,restoreCloudFiles} from './cloud-state.mjs';
import {driveAuthorization,openVault,restoreDriveAuthorization} from './social.mjs';

export function createCloudDrive(dir,key,bootstrap,panelRequest){
 const original=unseal(Buffer.from(bootstrap,'base64'),key).drive;
 if(!original?.id||!original.tokens?.refresh)throw Error('Configure a autorização do Google Drive para os lotes.');
 // A new GitHub secret takes precedence over a previously cached authorization.
 const fingerprint=createHash('sha256').update(bootstrap).digest('hex');
 let previous,reported,known=original;
 function restore(drive){
  known=drive;
  restoreCloudFiles(dir,{'contas.dat':seal({drive},key).toString('base64')});
  openVault(dir);
 }
 async function report(issue,drive=known){
  if(!panelRequest)return;
  const serialized=JSON.stringify(drive);
  if(serialized===previous&&issue===reported)return;
  const payload={issue,fingerprint,authorization:seal({drive},key).toString('base64')};
  try{
   await panelRequest('drive',payload);
   previous=serialized;
   reported=issue;
  }catch{console.warn('Não foi possível sincronizar a autorização do Drive com o painel.');}
 }
 async function remember(){
  const current=driveAuthorization();
  if(!current?.tokens?.refresh)return;
  known=current;
  const expires=current.tokens.refreshExpires;
  await report(Number.isFinite(expires)&&expires<=Date.now()+24*60*60_000?'expiring':null);
 }
 return {
  async read(fetchState){
   let drive=original;
   if(panelRequest){
    try{
     const saved=await panelRequest('drive');
     if(saved?.fingerprint===fingerprint){
      const cached=unseal(Buffer.from(saved.authorization,'base64'),key).drive;
      if(cached?.id===original.id&&cached.tokens?.refresh){
       drive=cached;
       previous=JSON.stringify(cached);
       reported=saved.issue;
      }
     }
    }catch{console.warn('Usando a autorização do Drive configurada no GitHub.');}
   }
   restore(drive);
   let state;
   try{state=await fetchState();}
   catch(error){
    if(error.reason!=='oauth_reconnect'||drive.tokens.refresh===original.tokens.refresh)throw error;
    restore(original);
    state=await fetchState();
   }
   await remember();
   return state;
  },
  restoreIntoVault(){openVault(dir);restoreDriveAuthorization(known);},
  remember,
  async reportError(error){
   if(error.reason==='oauth_reconnect'&&error.platform==='drive')await report('reconnect');
  },
 };
}
