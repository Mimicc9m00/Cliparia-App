import test from 'node:test';
import assert from 'node:assert/strict';
import {read} from '../social.mjs';

test('explica exigência de conta privada e SELF_ONLY sem tratar restrição como erro de login',async()=>{
 const code='unaudited_client_can_only_post_to_private_accounts';
 for(const status of [200,403]){
  await assert.rejects(read(Response.json({error:{code,message:'Please review our integration guidelines at https://developers.tiktok.com/doc/content-sharing-guidelines/',log_id:'test_trace_12345'}},{status})),error=>{
   assert.equal(error.reason,code);assert.equal(error.httpStatus,status);
   assert.match(error.message,/conta deve estar privada/);
   assert.match(error.message,/Somente eu \(SELF_ONLY\)/);
   assert.match(error.message,/apenas a visibilidade do vídeo não basta/);
   assert.match(error.message,/video.upload aprovada e autorizada/);
   assert.match(error.message,/test_trace_12345/);
   assert.doesNotMatch(error.message,/Reconecte.*expirada|Erro de autorização/);
   return true;
  });
 }
});

test('mantém diagnóstico de outros erros e ignora identificador de log inválido',async()=>{
 await assert.rejects(read(Response.json({error:{code:'scope_not_authorized',message:'Scope missing',log_id:'unsafe\nvalue'}})),error=>{
  assert.equal(error.reason,'scope_not_authorized');assert.match(error.message,/Scope missing/);
  assert.doesNotMatch(error.message,/unsafe|TikTok log_id/);return true;
 });
});
