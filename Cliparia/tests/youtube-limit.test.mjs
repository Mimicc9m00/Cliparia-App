import test from 'node:test';
import assert from 'node:assert/strict';
import {read} from '../social.mjs';

test('lê motivo específico do Google e apresenta limite de uploads sem pedir novo login',async()=>{
 const response=Response.json({error:{code:400,message:'The user has exceeded the number of videos they may upload.',errors:[{reason:'uploadLimitExceeded',domain:'youtube.video'}]}},{status:400});
 await assert.rejects(read(response),error=>{
  assert.equal(error.reason,'uploadLimitExceeded');assert.equal(error.httpStatus,400);
  assert.match(error.message,/limite de uploads/);assert.doesNotMatch(error.message,/autorização/);return true;
 });
});
test('preserva outros erros Google e formatos OAuth/TikTok, inclusive erro em HTTP 200',async()=>{
 await assert.rejects(read(Response.json({error:{code:403,errors:[{reason:'quotaExceeded'}],message:'Quota exceeded'}},{status:403})),{reason:'quotaExceeded'});
 await assert.rejects(read(Response.json({error:'invalid_grant',error_description:'Expired code'},{status:400})),{reason:'invalid_grant'});
 await assert.rejects(read(Response.json({error:{code:'access_token_invalid',message:'Invalid token'}})),{reason:'access_token_invalid'});
 assert.deepEqual(await read(Response.json({error:{code:'ok'},data:{id:'test'}})),{error:{code:'ok'},data:{id:'test'}});
});
