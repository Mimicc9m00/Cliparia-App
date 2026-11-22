import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {seal,unseal,restoreCloudFiles} from '../cloud-state.mjs';

test('estado criptografado exige a chave correta e rejeita alterações',()=>{
 const key=randomBytes(32),state={version:1,running:true,files:{'lives.json':'W10='}};
 const packed=seal(state,key);
 assert.deepEqual(unseal(packed,key),state);
 assert.throws(()=>unseal(packed,randomBytes(32)));
 packed[packed.length-1]^=1;
 assert.throws(()=>unseal(packed,key));
});

test('restauração de lote recusa caminhos externos antes de escrever',()=>{
 assert.throws(()=>restoreCloudFiles('.',{'contas.dat':'AA==','../arquivo':'AA=='}),/inválido/);
});
