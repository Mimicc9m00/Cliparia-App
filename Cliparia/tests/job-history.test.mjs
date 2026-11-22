import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openJobHistory} from '../job-history.mjs';

test('recupera uma cópia válida do histórico e preserva o arquivo danificado',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cliparia-history-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'lives.json'),damaged=Buffer.alloc(128);
 fs.writeFileSync(file,damaged);
 assert.throws(()=>openJobHistory(file),/nenhuma cópia local válida/);
 assert.deepEqual(fs.readFileSync(file),damaged);
 const jobs=[{id:'live-test',clips:[{posts:{}}]}];
 fs.writeFileSync(file+'.bak',JSON.stringify(jobs));
 const history=openJobHistory(file);
 assert.deepEqual(history.jobs,jobs);
 const preserved=fs.readdirSync(dir).find(name=>name.startsWith('lives.json.corrupt-'));
 assert.deepEqual(fs.readFileSync(path.join(dir,preserved)),damaged);
 history.jobs.push({id:'new',clips:[]});
 history.save();
 assert.equal(openJobHistory(file).jobs.length,2);
});
