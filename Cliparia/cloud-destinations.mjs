import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {cloudKey,collectCloudFiles,restoreCloudFiles,seal,unseal} from './cloud-state.mjs';
import {media,writeCloudState} from './drive.mjs';
import {createPublicationMemory,publicationQueue,retryablePost} from './publishing.mjs';
import {accounts,connectFacebook,creator,openVault,tiktokInboxProfile} from './social.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cliparia-destinations-'));
try{
 const id=process.env.CLIPARIA_CLOUD_FILE_ID;
 const bootstrap=process.env.CLIPARIA_CLOUD_DRIVE;
 const key=cloudKey();
 if(!/^[\w-]{5,200}$/.test(id||'')||!bootstrap)throw Error('Configure o acesso ao estado no Drive.');
 restoreCloudFiles(dir,{'contas.dat':bootstrap});
 openVault(dir);
 const response=await media(id,undefined,AbortSignal.timeout(40_000));
 const state=unseal(Buffer.from(await response.arrayBuffer()),key);
 if(state.version!==1||state.running)throw Error('O estado da nuvem ainda não está disponível para configuração.');
 restoreCloudFiles(dir,state.files);
 openVault(dir);
 const memory=createPublicationMemory(path.join(dir,'publicacoes.json'));
 const current=accounts();
 const configs=memory.automaticSettings().configs;
 const tiktokReady=current.tiktok.connected&&(current.tiktok.scopes||'').split(/[ ,]+/).includes('video.upload');
 if(tiktokReady){
  const tiktok=tiktokInboxProfile();
  memory.setAutomaticConfig('tiktok',{channel:tiktok.channel_id,mode:'inbox'});
 }
 let facebookBlocked=false;
 let facebookReady=false;
 const pageToken=process.env.CLIPARIA_FACEBOOK_TOKEN;
 if(pageToken||!current.facebook.connected){
  const saved=unseal(Buffer.from(state.files['contas.dat'],'base64'),key);
  const linkedToken=saved.instagram?.durable&&!saved.instagram.needsReconnect?saved.instagram.token:undefined;
  const candidate=pageToken||linkedToken;
  if(candidate&&saved.facebook?.id){
   try{
    // connectFacebook confirms that this token authorizes the same Page.
    await connectFacebook(saved.facebook.id,candidate.trim());
   }catch{facebookBlocked=true;}
  }
 }
 if(!facebookBlocked&&accounts().facebook.connected){
  try{
   const page=await creator('facebook');
   memory.setAutomaticConfig('facebook',{...configs.facebook,channel:page.channel_id,privacy:'public'});
   facebookReady=true;
  }catch{facebookBlocked=true;}
 }
 const load=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
 const save=(name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
 const jobs=load('lives.json');
 let updated=0;
 for(const {job,clip} of publicationQueue(jobs)){
  if(clip.posting.recoveryReview||!clip.posting.targets.length||!clip.drive?.id||clip.drive.removed||clip.drive.trashed)continue;
  const before=JSON.stringify(clip.posting);
  const eligible=['youtube','instagram','facebook','tiktok'].filter(platform=>configs[platform]&&
   (platform!=='facebook'||facebookReady&&clip.length>=3&&clip.length<=90)&&
   (platform!=='tiktok'||tiktokReady));
  clip.posting.targets=[...new Set([...clip.posting.targets,...eligible])];
  if(eligible.includes('tiktok')){
   clip.posting.tiktokInbox={channel:configs.tiktok.channel,revision:clip.revision||0};
   const previous=clip.posts.tiktok;
   if(previous?.state==='Falhou'&&!previous.id&&(previous.mode==='direct'||previous.reason==='unaudited_client_can_only_post_to_private_accounts'))delete clip.posts.tiktok;
  }
  for(const platform of eligible){
   if(!retryablePost(clip.posts[platform]))continue;
   const known=memory.lookup(job,clip,platform);
   if(known)clip.posts[platform]=known;
  }
  if(before!==JSON.stringify(clip.posting))updated++;
 }
 const continuous=load('continuo.json');
 if(continuous.autoQueue?.enabled){
  if(facebookReady&&!continuous.autoQueue.targets.includes('facebook'))continuous.autoQueue.targets.push('facebook');
  if(tiktokReady&&continuous.autoQueue.targets.includes('tiktok'))continuous.autoQueue.tiktokInbox=configs.tiktok.channel;
  save('continuo.json',continuous);
 }
 memory.setAutomaticEnabled(Object.keys(configs).length>0);
 save('lives.json',jobs);
 await writeCloudState(id,seal({...state,files:collectCloudFiles(dir)},key));
 console.log('Destinos aplicados: '+JSON.stringify({
  youtube:!!configs.youtube,instagram:!!configs.instagram,facebook:facebookReady,
  tiktokInbox:tiktokReady,cortesAtualizados:updated,
 }));
 if(facebookBlocked)console.log('O Facebook recusou a nova autorização da Página. As outras configurações foram salvas.');
}catch(error){
 console.error('Não foi possível configurar os destinos com o estado atual do Cliparia.');
 process.exitCode=1;
}finally{fs.rmSync(dir,{recursive:true,force:true});}
