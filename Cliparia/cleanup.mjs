import {postStatus,youtubeStatus,instagramStatus,instagramAvailable,instagramReconnectRequired,facebookStatus} from './social.mjs';
import {remove} from './drive.mjs';
import {clipTargets,pendingPublication} from './publishing.mjs';
const platforms=['youtube','tiktok','instagram','facebook'];
export const hasPendingPublication=clip=>platforms.some(p=>pendingPublication(clip.posts[p]));
export const tiktokInboxNotified=post=>!!post?.id&&post.state==='Abra a caixa de entrada do TikTok';
const tiktokChecks=new WeakMap();
export async function refreshTikTok(clip,save,status=postStatus){
 const post=clip.posts.tiktok;
 if(!pendingPublication(post))throw Error('Não há uma entrega do TikTok aguardando confirmação neste corte.');
 const existing=tiktokChecks.get(post);
 if(existing)return existing;
 const work=(async()=>{
  const result=await status(post.id,post.mode);
  if(clip.posts.tiktok!==post)return clip.posts.tiktok;
  const updated={...post,...result};
  if(['Publicado','Falhou'].includes(updated.state))delete updated.inboxMissing;
  clip.posts.tiktok=updated;save();
  return updated;
 })().finally(()=>tiktokChecks.delete(post));
 tiktokChecks.set(post,work);
 return work;
}
export async function reconcile(job,clip,save,services={youtube:youtubeStatus,tiktok:postStatus,instagram:instagramStatus,instagramAvailable,facebook:facebookStatus,remove}){
 const hasDriveFile=!!clip.drive&&!clip.drive.removed;
 let firstError;
 for(const p of platforms){
  const post=clip.posts[p];
  if(!pendingPublication(post)||p==='instagram'&&services.instagramAvailable?.()===false)continue;
  try{
   if(p==='tiktok'){await refreshTikTok(clip,save,services[p]);continue;}
   clip.posts[p]=['instagram','facebook'].includes(p)?await services[p](post,save,!hasDriveFile||post.restoreStatusOnly===true):await services[p](post.id);
   save();
  }
  catch(error){if(p!=='instagram'||!instagramReconnectRequired(error.reason))firstError??=error;}
 }
 const targets=clipTargets(job,clip);
 if(hasDriveFile&&!clip.preserveDrive&&targets.length&&targets.every(p=>clip.posts[p]?.state==='Publicado')){
  await services.remove(clip.drive.id);
  clip.drive.removed=true;save();
 }
 if(firstError)throw firstError;
}
