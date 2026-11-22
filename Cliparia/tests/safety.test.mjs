import test from 'node:test';
import assert from 'node:assert/strict';
import {sexualText,explicitDetection,screenClip,assertScreened,safetyVersion} from '../safety.mjs';
import {run} from '../speech.mjs';

function output(label,score=.9){
 const data=new Float32Array(22);data[4+label]=score;
 return {dims:[1,22,1],data};
}
test('triagem textual reconhece conteúdo sexual explícito sem tratar palavrão de gameplay como sexo',()=>{
 for(const text of ['PORNOGRAFIA','cena de sexo','conteúdo sexual explícito','hentai','sexo oral','send nudes'])assert.equal(sexualText(text),true,text);
 for(const text of ['Ganhei a partida, caralho!','Combate no GTA','personagem de sexo feminino','Camisa azul nude','Missão completada'])assert.equal(sexualText(text),false,text);
});
test('detector bloqueia classes explícitas sem bloquear rostos, roupas ou peito masculino',()=>{
 for(const label of [2,3,4,6,14])assert.equal(explicitDetection(output(label)).blocked,true);
 for(const label of [0,1,5,7,8,9,10,11,12,13,15,16,17])assert.equal(explicitDetection(output(label)).blocked,false);
 assert.equal(explicitDetection(output(4,.3)).blocked,false);
 assert.throws(()=>explicitDetection({dims:[1,20,1],data:new Float32Array(20)}),/inválida/);
});
test('analisa o clipe inteiro e bloqueia indício no último quadro',async()=>{
 const size=320*320*3,raw=Buffer.alloc(size*3);
 raw[size*2]=1;
 let calls=0;
 const result=await screenClip([],{duration:3,extract:async()=>raw,detect:async frame=>{calls++;return {blocked:frame[0]===1,score:frame[0]===1?.9:0};}});
 assert.equal(result.status,'blocked');assert.equal(result.atSecond,2);assert.equal(result.framesChecked,3);assert.equal(calls,2);
});
test('erro, arquivo incompleto ou detector inválido bloqueiam o envio',async()=>{
 for(const options of [
  {extract:async()=>{throw Error('Falha no FFmpeg');}},
  {extract:async()=>Buffer.alloc(0)},
  {extract:async()=>Buffer.alloc(320*320*3*2),detect:async()=>({score:NaN,blocked:false})}
 ]){
  const safety=await screenClip([],{duration:2,...options});
  assert.equal(safety.status,'error');assert.throws(()=>assertScreened({safety}),/bloqueado/);
 }
});
test('texto explícito bloqueia antes da análise visual e aprovações vencem ao editar o clipe',async()=>{
 let extracted=false;
 const safety=await screenClip([],{duration:40,text:'cena de sexo explícito',extract:async()=>{extracted=true;}});
 assert.equal(safety.status,'blocked');assert.equal(extracted,false);
 assert.throws(()=>assertScreened({}),/Verifique/);
 const clip={revision:1,safety:{version:safetyVersion,revision:0,status:'approved'}};
 assert.throws(()=>assertScreened(clip));
 clip.safety.revision=1;assert.doesNotThrow(()=>assertScreened(clip));
});
test('FFmpeg e modelo real analisam clipe sintético sem conteúdo sexual',async()=>{
 const bytes=await run('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=10','-t','2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+frag_keyframe+empty_moov','-f','mp4','pipe:1']);
 const safety=await screenClip(['-i','pipe:0'],{bytes,duration:2,text:'Gameplay de corrida'});
 assert.equal(safety.status,'approved',safety.reason);
 assert.equal(safety.framesChecked,2);
});
