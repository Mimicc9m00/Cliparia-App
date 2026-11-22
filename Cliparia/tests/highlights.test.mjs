import test from 'node:test';
import assert from 'node:assert/strict';
import {rankedMoments,selectMoments,probeMoments,captionBounds} from '../highlights.mjs';
import {captionsAss,parseSrt} from '../speech.mjs';


const signal=n=>({motion:Array(n).fill(.05),volume:Array(n).fill(.05),levels:Array(n).fill(150),duration:n});
test('descarta uma batida isolada, volume constante e uma troca única de cena',()=>{
 const input=signal(180);
 input.volume.fill(.77);
 input.volume[70]=1;
 input.motion[70]=1;
 assert.deepEqual(selectMoments(rankedMoments(input,40),40,5),[]);
 assert.deepEqual(selectMoments(rankedMoments({motion:Array(180).fill(.9),volume:Array(180).fill(.9)},40),40,5),[]);
});
test('prioriza ação sustentada com reação e mantém espaço para o contexto',()=>{
 const input=signal(180);
 input.motion[21]=1;input.volume[21]=1;
 input.motion.fill(.93,104,111);input.volume.fill(.92,103,111);
 const picks=selectMoments(rankedMoments(input,40),40,5);
 assert.equal(picks.length,1);
 assert.equal(picks[0].evidence,'ação e reação');
 assert.ok(picks[0].start<104&&picks[0].start+40>111);
});
test('ranking usa replay e frases de resultado, mas deixa pico só de áudio como candidato a conferir',()=>{
 const input=signal(220);
 input.volume.fill(.88,44,51);
 input.heatmap=[{start_time:148,end_time:159,value:.92}];
 const ranked=rankedMoments(input,40);
 assert.equal(selectMoments(ranked,40,5).length,1);
 assert.equal(selectMoments(ranked,40,5)[0].evidence,'replay');
 assert.equal(probeMoments(ranked,[],220).length,1);
 input.speech=[{start:46,end:48,text:'Não acredito, conseguimos virar!'}];
 assert.deepEqual(new Set(selectMoments(rankedMoments(input,40),40,5).map(x=>x.evidence)),new Set(['fala','replay']));
});
test('limita as legendas ao áudio detectável e conserva margem e timestamps',()=>{
 const levels=Array(120).fill(0);
 levels.fill(100,21,31);
 assert.deepEqual(captionBounds(levels,10,40),{start:19,duration:14});
 assert.deepEqual(captionBounds([],10,40),{start:10,duration:40});
 assert.deepEqual(captionBounds(Array(100).fill(0),10,40),{start:10,duration:0});
});

test('legendas ficam limitadas e alinhadas ao trecho exportado',()=>{
 const speech=parseSrt('1\n00:00:39,000 --> 00:00:42,000\nOlha isso!\n\n2\n00:01:40,000 --> 00:01:42,000\nFicou fora');
 const ass=captionsAss(speech,40,40);
 assert.match(ass,/Dialogue: 0,0:00:00\.00,/);
 assert.match(ass,/Olha/);
 assert.doesNotMatch(ass,/Ficou fora/);
});
