import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyYouTubeVideo,matchYouTubeClip,youtubeMarker} from '../youtube-queue.mjs';

const job={id:'one',mediaKey:'Youtube:source'};
const clip={title:'Partida final',start:5,length:60,drive:{size:9000}};
function uploaded(id,fields={}){
 return {id,snippet:{title:'Partida final'},fileDetails:{fileSize:'9000'},contentDetails:{duration:'PT1M'},status:{uploadStatus:'processed'},...fields};
}

test('título e duração isolam uma possível duplicidade sem confirmar o upload',()=>{
 const video=uploaded('abcdefghijk',{fileDetails:{fileSize:'9180'}});
 assert.deepEqual(matchYouTubeClip(job,clip,[video],{}),{candidates:[video.id]});
 const released={...clip,youtubeReview:{ignored:[video.id]}};
 assert.deepEqual(matchYouTubeClip(job,released,[video],{}),{candidates:[]});
});
test('reconhece o mesmo arquivo e o marcador dos envios automáticos',()=>{
 const sameFile=uploaded('abcdefghijk');
 assert.equal(matchYouTubeClip(job,clip,[sameFile],{}).video,sameFile);
 assert.equal(matchYouTubeClip(job,{...clip,title:'Partida final #valorant #ranked',previousPostTitle:clip.title},[sameFile],{}).video,sameFile);
 assert.equal(classifyYouTubeVideo(sameFile).state,'Publicado');
 const transplanted=uploaded('bcdefghijkl',{snippet:{title:'Título editado',tags:[youtubeMarker(job,clip)]},fileDetails:{fileSize:'242'},status:{uploadStatus:'uploaded'}});
 assert.equal(matchYouTubeClip(job,clip,[transplanted],{}).video,transplanted);
 assert.equal(classifyYouTubeVideo(transplanted).state,'Em processamento');
 const rejected={...transplanted,status:{uploadStatus:'rejected'}};
 assert.deepEqual(matchYouTubeClip(job,clip,[rejected],{}),{candidates:[]});
});
