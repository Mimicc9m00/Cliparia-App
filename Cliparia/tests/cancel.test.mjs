import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisSlot} from '../scan.mjs';

test('tarefa cancelada sai da fila sem executar a análise',async()=>{
 const controller=new AbortController();
 let run=false,unlock;
 const active=analysisSlot(()=>new Promise(resolve=>{unlock=resolve;}));
 const queued=analysisSlot(()=>{run=true;},true,controller.signal);
 controller.abort();
 await assert.rejects(queued,{name:'AbortError'});
 unlock();
 await active;
 const next=analysisSlot(()=>42);
 assert.equal(await next,42);
 assert.equal(run,false);
});
