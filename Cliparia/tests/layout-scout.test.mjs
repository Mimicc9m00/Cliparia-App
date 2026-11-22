import test from 'node:test';
import assert from 'node:assert/strict';
import {region,adjoiningRegion,overlaps} from '../layout.mjs';
import {hotRanges,probeRanges} from '../scout.mjs';
import {parseSrt} from '../speech.mjs';

test('painel inferior é separado da webcam e webcam grande vira painel único',()=>{
 const small=region({x:.72,y:.71,w:.26,h:.28});
 const game=adjoiningRegion(small);
 assert.ok(game&&!overlaps(small,game));
 assert.equal(adjoiningRegion(region({x:.26,y:.1,w:.7,h:.7})),null);
 const manual=region({x:0,y:0,w:.67,h:.62});
 assert.equal(adjoiningRegion(small,manual),manual);
 assert.equal(adjoiningRegion(small,small),null);
});
test('mapa de replay leva a análise a lugares fortes fora do início',()=>{
 const plan=hotRanges(900,40,[{start_time:713,end_time:721,value:.94},{start_time:210,end_time:214,value:.76}]);
 assert.ok(plan[0].offset>650&&plan[0].offset<713);
 assert.ok(plan[1].offset>150&&plan[1].offset<210);
});
test('sondagens cobrem um VOD longo e os escores determinam a próxima janela',()=>{
 const probes=probeRanges(900);
 assert.ok(probes[0].offset>0&&probes.at(-1).offset>820);
 const plan=hotRanges(900,40,[],[{at:60,score:1.1},{at:708,score:1.7}]);
 assert.ok(plan[0].offset>600);
 assert.deepEqual(hotRanges(900,40),[]);
});
test('legendas aceitam arquivos com BOM e parâmetros depois do timestamp',()=>{
 assert.deepEqual(parseSrt('\uFEFF1\n00:00:02,100 --> 00:00:04,400 align:start\nMeu Deus!\n'),[{start:2.1,end:4.4,text:'Meu Deus!'}]);
});
