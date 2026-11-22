import {applyPostCopy,postSpeech} from './post-copy.mjs';
import {sexualText} from './safety.mjs';

export function needsRecoveredCopy(clip){
 return clip.recoveredFromDrive===true&&!!clip.drive?.id&&!clip.drive.removed&&!clip.drive.trashed&&
  !clip.postDraft&&!clip.postCopyRecoveryVersion&&(!clip.postCopyVersion||clip.copyBasis==='speech'&&clip.postSpeech?.length)&&
  !Object.values(clip.posts).some(post=>post?.id||post?.state==='Publicado');
}

export async function recoverPostCopy({job,clip},readSpeech,postTrendTags){
 if(!needsRecoveredCopy(clip))return;
 const revision=clip.revision;
 const saved=clip.postSpeech?.length?clip.postSpeech:null;
 const segments=saved||await readSpeech(job,clip);
 if(!needsRecoveredCopy(clip)||clip.revision!==revision)return;
 if(sexualText(segments.map(segment=>segment.text).join(' '))){clip.postCopyRecovery='sensitive';return;}
 const start=clip.start||0;
 const speech=saved||postSpeech(segments,0,clip.length).map(segment=>({...segment,start:segment.start+start,end:segment.end+start}));
 if(!speech.length){clip.postCopyRecovery='no-speech';return;}
 clip.postSpeech=speech;
 clip.previousPostTitle??=clip.title;
 applyPostCopy({...job,sourceTitle:clip.previousPostTitle||job.sourceTitle,postTrendTags},clip);
 clip.postCopyRecoveryVersion=1;
 delete clip.postCopyRecovery;
 delete clip.postCopyRetryAt;
}
