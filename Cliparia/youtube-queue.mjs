import {createHash} from 'node:crypto';
import {publicationKey} from './publishing.mjs';

export function youtubeMarker(job,clip){
 return 'cliparia-'+createHash('sha256').update(publicationKey(job,clip)).digest('hex').slice(0,32);
}
const normalized=value=>String(value||'').normalize('NFC').trim().replace(/\s+/gu,' ').toLowerCase();
function seconds(video){
 const ms=Number(video.fileDetails?.durationMs);
 if(ms>0)return ms/1000;
 const duration=/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(video.contentDetails?.duration||'');
 return duration?Number(duration[1]||0)*3600+Number(duration[2]||0)*60+Number(duration[3]||0):null;
}
export function classifyYouTubeVideo(video){
 const status=video.status?.uploadStatus,processing=video.processingDetails?.processingStatus;
 if(['rejected','failed','deleted'].includes(status)||processing==='failed')return {id:video.id,state:'Falhou',detail:video.status?.rejectionReason||'O YouTube recusou o vídeo.'};
 if(!video.status?.publishAt&&(processing==='succeeded'||status==='processed'))return {id:video.id,state:'Publicado'};
 return {id:video.id,state:'Em processamento'};
}
export function matchYouTubeClip(job,clip,videos,fields){
 const marker=youtubeMarker(job,clip);
 const marked=videos.filter(video=>video.snippet?.tags?.includes(marker)&&classifyYouTubeVideo(video).state!=='Falhou');
 if(marked.length)return {video:marked.find(v=>classifyYouTubeVideo(v).state==='Publicado')||marked[0]};
 const titles=new Set([clip.title,clip.previousPostTitle,fields.title].map(normalized).filter(Boolean));
 const size=Number(clip.drive?.size);
 const similar=videos.filter(video=>{
  const length=seconds(video);
  return length!==null&&Math.abs(length-clip.length)<=1&&classifyYouTubeVideo(video).state!=='Falhou';
 });
 const sameSize=video=>size>0&&Number(video.fileDetails?.fileSize)===size;
 const sameTitle=video=>titles.has(normalized(video.snippet?.title));
 const exact=similar.filter(video=>sameSize(video)&&sameTitle(video));
 if(exact.length===1)return {video:exact[0]};
 const ignored=new Set(clip.youtubeReview?.ignored||[]);
 const candidates=similar.filter(video=>!ignored.has(video.id)&&(sameSize(video)||sameTitle(video)));
 return {candidates:candidates.map(video=>video.id).sort()};
}
