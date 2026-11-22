import test from 'node:test';
import assert from 'node:assert/strict';
import {ranges,analysisSlot,fullVodRanges,scanCompleteVod} from '../scan.mjs';

test('separa a mídia em trechos de até 15 minutos e ignora sobra menor que um corte',()=>{
 assert.deepEqual([...ranges(1820,40)],[{offset:0,duration:900},{offset:900,duration:900}]);
 assert.deepEqual([...ranges(1900,40,900)],[{offset:900,duration:900},{offset:1800,duration:100}]);
 assert.deepEqual([...ranges(900.9,40)],[{offset:0,duration:900}]);
});
test('um VOD em espera passa antes de outro trecho de live',async()=>{
 const order=[];
 let release;
 const gate=new Promise(resolve=>{release=resolve;});
 const first=analysisSlot(async()=>{order.push('live-1');await gate;});
 const second=analysisSlot(()=>order.push('live-2'));
 const vod=analysisSlot(()=>order.push('vod'),true);
 release();
 await Promise.all([first,second,vod]);
 assert.deepEqual(order,['live-1','vod','live-2']);
});

test('alterna entre lives do Contínuo prontas mantendo um bloco em análise por vez',async()=>{
 const a={},b={},c={},order=[];
 let release;
 const gate=new Promise(resolve=>{release=resolve;});
 const first=analysisSlot(async()=>{order.push('A1');await gate;},false,undefined,a);
 const block=(label,job)=>analysisSlot(()=>order.push(label),false,undefined,job);
 const pending=[block('A2',a),block('B1',b),block('C1',c),block('A3',a),block('B2',b)];
 await Promise.resolve();
 assert.deepEqual(order,['A1']);
 release();
 await Promise.all([first,...pending]);
 assert.deepEqual(order,['A1','B1','C1','A2','B2','A3']);
});

test('análise completa cobre também cortes que atravessam as bordas dos trechos de 15 minutos',()=>{
 for(const minimum of [40,60,180])for(const total of [180,901,1820,3600]){
  const plan=[...fullVodRanges(total,minimum)];
  assert.equal(plan[0].offset,0);
  assert.equal(plan.at(-1).offset+plan.at(-1).duration,total);
  assert.ok(plan.every(r=>r.duration<=900));
  for(let start=0;start+minimum<=total;start+=17)assert.ok(plan.some(r=>r.offset<=start&&r.offset+r.duration>=start+minimum),'trecho sem cobertura: '+start);
 }
});

test('modo completo continua após trecho vazio e após ultrapassar a antiga meta de clipes',async()=>{
 const job={count:5,clips:Array.from({length:5},()=>({}))},seen=[];
 await scanCompleteVod(job,3000,60,async(range,index)=>{
  seen.push(range.offset);
  if(index>0)job.clips.push(...Array.from({length:8},()=>({})));
 });
 assert.deepEqual(seen,[0,840,1680,2520]);
 assert.equal(job.clips.length,29);
 assert.equal(job.completeScanFinished,true);
});

test('pausa e retomada preservam o cursor e erro de análise não marca trecho como concluído',async()=>{
 const job={count:5,clips:Array.from({length:10},()=>({}))},seen=[];
 let paused=false;
 const first=await scanCompleteVod(job,2000,60,async range=>{seen.push(range.offset);paused=true;},{shouldStop:()=>paused});
 assert.equal(first,false);assert.equal(job.completeScanIndex,1);
 paused=false;
 await assert.rejects(scanCompleteVod(job,2000,60,async()=>{throw Error('Conexão caiu');}),/Conexão/);
 assert.equal(job.completeScanIndex,1);assert.equal(job.completeScanFinished,false);
 await scanCompleteVod(job,2000,60,async range=>{seen.push(range.offset);});
 assert.deepEqual(seen,[0,840,1680]);assert.equal(job.completeScanFinished,true);
});
