import {test} from 'node:test';
import assert from 'node:assert/strict';
import {needsRecoveredCopy,recoverPostCopy} from '../recovered-copy.mjs';
import {queuePostCopy} from '../post-copy.mjs';

const recovered=()=>({title:'GTA 6 ao vivo na Kick',recoveredFromDrive:true,drive:{id:'drive-file'},start:120,length:60,posts:{},
 posting:{order:8,targets:[],recoveryReview:true}});

test('gera texto com as falas do arquivo recuperado sem mexer na seleção de destinos',async()=>{
 const clip=recovered();
 const posting=clip.posting;
 const job={title:clip.title,writePosts:false};
 await recoverPostCopy({job,clip},async()=>[{start:3,end:6,text:'Ganhei a corrida no GTA 6!'}],{});
 assert.match(clip.title,/^Ganhei a corrida/);
 assert.deepEqual(clip.hashtags,['#gta6','#rockstar','#corrida','#vitoria','#jogos']);
 assert.equal(clip.postSpeech[0].start,123);
 assert.equal(clip.previousPostTitle,'GTA 6 ao vivo na Kick');
 assert.equal(clip.posting,posting);
 assert.deepEqual(clip.posts,{});
 assert.equal(queuePostCopy(job,clip).title,clip.title);
 assert.equal(needsRecoveredCopy(clip),false);
});

test('preserva rascunhos e recibos e indica arquivos sem fala ou com texto sensível',async()=>{
 for(const previous of [{postDraft:{title:'Editado'}},{posts:{youtube:{id:'uploaded-id',state:'Publicado'}}}]){
  const clip={...recovered(),...previous};
  await recoverPostCopy({job:{},clip},()=>assert.fail('o arquivo não deve ser transcrito'),{});
  assert.equal(clip.title,'GTA 6 ao vivo na Kick');
 }
 const silent=recovered(),sensitive=recovered();
 await recoverPostCopy({job:{},clip:silent},async()=>[],{});
 await recoverPostCopy({job:{},clip:sensitive},async()=>[{start:2,end:4,text:'É pornografia.'}],{});
 assert.equal(silent.postCopyRecovery,'no-speech');
 assert.equal(sensitive.postCopyRecovery,'sensitive');
 assert.equal(sensitive.postSpeech,undefined);
});

test('aproveita a transcrição salva e identifica o jogo pelo nome original do corte',async()=>{
 const job={title:'Vídeos recuperados do Drive',writePosts:false};
 const clip={...recovered(),title:'Olha isso!',previousPostTitle:'GTA 6 CHEGOOUUUUU! BISTECONE ON NA KICK',
  postCopyVersion:4,copyBasis:'speech',postSpeech:[{start:122,end:125,text:'Olha isso!'}]};
 await recoverPostCopy({job,clip},()=>assert.fail('a fala já foi transcrita'),{});
 assert.equal(clip.title,'Olha isso! #gta6 #rockstar #jogos');
 assert.deepEqual(clip.hashtags,['#gta6','#rockstar','#jogos']);
 assert.equal(clip.postSpeech[0].start,122);
 assert.equal(needsRecoveredCopy(clip),false);
});
