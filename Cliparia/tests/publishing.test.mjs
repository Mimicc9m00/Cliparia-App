import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createPublicationMemory,createAutoPublisher,publicationInterval,publicationKey,publicationQueue,retryablePost,shufflePublications} from '../publishing.mjs';
import {reconcile} from '../cleanup.mjs';

async function setup(t){
 const dir=await mkdtemp(path.join(os.tmpdir(),'cliparia-publications-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 let time=1_000_000;
 const file=path.join(dir,'publicacoes.json');
 const open=()=>createPublicationMemory(file,{now:()=>time});
 return {file,open,advance:ms=>{time+=ms;}};
}
const clip=start=>({start,length:60,drive:{id:'drive-'+start},posts:{}});
const job=(id,clips)=>({id,continuousId:id,mediaKey:'Youtube:Broadcast'+id,clips,targets:['youtube','instagram'],auto:{channel:'yt'},autoInstagram:{channel:'ig'}});
function selectClips(memory,clips,targets=['youtube','instagram']){
 for(const p of targets)if(p!=='tiktok'&&p!=='kwai')memory.setAutomaticConfig(p,{channel:p});
 memory.setAutomaticEnabled(true);
 clips.forEach((c,index)=>{c.posting={order:index+1,targets};});
}

test('lista um corte por vez com os destinos confirmados e mantém a lista após apagar tarefas',async t=>{
 const {open}=await setup(t),memory=open();
 const first={...clip(0),title:'Melhor jogada',posts:{youtube:{state:'Publicado',id:'abcdefghijk'},facebook:{state:'Publicado'},tiktok:{state:'Em processamento'}}};
 const second={...clip(60),title:'Final da partida',posts:{kwai:{state:'Publicado',link:'https://www.kwai.com/video/1'},instagram:{state:'Falhou'}}};
 const continuous={...job('a',[first]),title:'Live de sábado'};
 const studio={...job('b',[second]),continuousId:undefined};
 memory.remember([continuous,studio]);
 memory.remember([]);
 const entries=open().publishedClips();
 assert.equal(entries.length,2);
 assert.deepEqual(entries[0].posts,{kwai:{link:'https://www.kwai.com/video/1'}});
 assert.deepEqual(entries[1],{title:'Melhor jogada',source:'Live de sábado',posts:{youtube:{link:'https://www.youtube.com/watch?v=abcdefghijk'},facebook:{link:''}}});
});

test('recupera publicações do registro antigo do contínuo, mesmo sem tarefa',async t=>{
 const {file,open}=await setup(t),j=job('old',[]),key=publicationKey(j,clip(0));
 const records={
  [JSON.stringify([key,'youtube'])]:{state:'Publicado',id:'abcdefghijk'},
  [JSON.stringify([key,'facebook'])]:{state:'Publicado',title:'Corte antigo'},
  [JSON.stringify([key,'instagram'])]:{state:'Enviando'}
 };
 await writeFile(file,JSON.stringify({nextAt:0,slot:null,records}));
 const [entry]=open().publishedClips();
 assert.equal(entry.title,'Corte antigo');
 assert.deepEqual(Object.keys(entry.posts),['youtube','facebook']);
});

test('confirma publicações mesmo com o arquivo excluído do Drive e mantém apenas o registro',async t=>{
 const {open}=await setup(t),memory=open(),c=clip(0),j=job('removed',[c]);
 c.drive.removed=true;
 c.posts.youtube={id:'abcdefghijk',state:'Enviado'};
 c.posts.facebook={id:'42',state:'Em processamento'};
 j.targets=['youtube'];
 await reconcile(j,c,()=>memory.remember([j]),{
  youtube:async id=>({id,state:'Publicado'}),
  facebook:async (post,save,statusOnly)=>{assert.equal(statusOnly,true);return {...post,state:'Publicado'};},
  remove:()=>assert.fail('O arquivo já foi excluído.')
 });
 const [published]=open().publishedClips();
 assert.deepEqual(Object.keys(published.posts),['youtube','facebook']);
 assert.equal(published.drive,undefined);
});

test('destino acrescentado a um corte segura apenas o arquivo daquele corte',async()=>{
 const first=clip(0),second=clip(60),j=job('destinations',[first,second]);
 j.targets=['youtube'];
 first.extraTargets=['kwai'];
 first.posts.youtube=second.posts.youtube={state:'Publicado'};
 const removed=[];
 const services={remove:async id=>removed.push(id)};
 await reconcile(j,first,()=>{},services);
 await reconcile(j,second,()=>{},services);
 assert.deepEqual(removed,[second.drive.id]);
 first.posts.kwai={state:'Publicado'};
 await reconcile(j,first,()=>{},services);
 assert.deepEqual(removed,[second.drive.id,first.drive.id]);
});

test('salva o intervalo escolhido e reaplica uma contagem que já está ativa',async t=>{
 const env=await setup(t),memory=env.open(),first=clip(0),next=clip(60),j=job('interval',[first,next]);
 assert.throws(()=>memory.setIntervalMinutes(0),/1 e 1440/);
 assert.throws(()=>memory.setIntervalMinutes(1.5),/1 e 1440/);
 assert.equal(memory.setIntervalMinutes(4).nextAt,0);
 memory.reserve(j,first,'youtube');
 env.advance(60_000);
 const changed=memory.setIntervalMinutes(2);
 assert.equal(changed.nextAt,1_180_000);
 memory.finish(j,first);
 assert.deepEqual(env.open().status(),changed);
 env.advance(120_000);
 assert.equal(memory.canSend(j,next),true);
 memory.reserve(j,next,'instagram');
 assert.equal(memory.status().nextAt,1_300_000);
 assert.equal(memory.restartCountdown(0).nextAt,0);
 assert.equal(memory.restartCountdown().nextAt,1_300_000);
});

test('reinicia os 15 minutos a partir do clique e preserva envios já confirmados',async t=>{
 const env=await setup(t),memory=env.open(),first=clip(0),next=clip(60),j=job('reset',[first,next]);
 memory.reserve(j,first,'youtube');
 first.posts.youtube={state:'Publicado',id:'confirmed'};
 memory.remember([j]);
 const original=memory.status();
 env.advance(60_000);
 const restarted=memory.restartCountdown();
 assert.equal(restarted.nextAt,original.nextAt+60_000);
 env.advance(30_000);
 memory.reserve(j,first,'instagram');
 memory.finish(j,first);
 const reopened=env.open();
 assert.deepEqual(reopened.status(),restarted);
 assert.equal(reopened.lookup(j,first,'youtube').id,'confirmed');
 assert.equal(reopened.canSend(j,next),false);
 env.advance(publicationInterval-30_000);
 assert.equal(reopened.canSend(j,next),true);
 reopened.reserve(j,next,'instagram');
 assert.equal(reopened.status().nextAt,restarted.nextAt+publicationInterval);
});

test('zera a espera, preserva o histórico e inicia outro intervalo ao enviar o próximo clipe',async t=>{
 const env=await setup(t),memory=env.open(),first=clip(0),next=clip(60),j=job('clear',[first,next]);
 memory.reserve(j,first,'instagram');
 assert.equal(memory.canSend(j,next),false);

 assert.equal(memory.restartCountdown(0).nextAt,0);
 first.posts.instagram={state:'Publicado',id:'confirmed'};
 memory.remember([j]);
 memory.finish(j,first);

 const reopened=env.open();
 assert.equal(reopened.status().nextAt,0);
 assert.equal(reopened.lookup(j,first,'instagram').id,'confirmed');
 assert.equal(reopened.canSend(j,next),true);
 reopened.reserve(j,next,'instagram');
 assert.equal(reopened.status().nextAt,1_000_000+publicationInterval);
 assert.equal(reopened.canSend(j,clip(120)),false);
});

test('pula o Facebook enquanto a Página precisa ser reconectada',async t=>{
 const {open}=await setup(t),memory=open(),c=clip(0),j=job('reconnect',[c]),sent=[];
 selectClips(memory,[c],['youtube','facebook']);
 let connected=false;
 const tick=createAutoPublisher({
  jobs:[j],editing:new Set(),memory,
  fields:()=>({}),save:()=>{},platformAvailable:p=>p!=='facebook'||connected,
  send:async(_,clip,__,platform)=>{sent.push(platform);clip.posts[platform]={state:'Publicado'};}
 });
 await tick();
 assert.deepEqual(sent,['youtube']);
 assert.equal(c.posts.facebook,undefined);
 connected=true;
 await tick();
 assert.deepEqual(sent,['youtube','facebook']);
});

test('Facebook compartilha os 15 minutos e não repete clipes ao recadastrar a mesma fonte',async t=>{
 const env=await setup(t),memory=env.open(),j=job('facebook',[clip(0),clip(60)]);
 selectClips(memory,j.clips,['youtube','instagram','facebook']);
 const jobs=[j],sent=[];
 const tick=createAutoPublisher({jobs,memory,editing:new Set(),save:()=>memory.remember(jobs),fields:()=>({}),send:async(job,c,_,p)=>{
  memory.reserve(job,c,p,true);sent.push(p);c.posts[p]={state:'Publicado',id:p};memory.remember(jobs);memory.finish(job,c,true);
 }});
 await tick();await tick();assert.deepEqual(sent,['youtube','instagram','facebook']);
 const duplicate={...j,id:'another',continuousId:'another',clips:[clip(0)]};
 assert.equal(env.open().lookup(duplicate,duplicate.clips[0],'facebook').id,'facebook');
 env.advance(publicationInterval);await tick();assert.equal(sent.length,6);
});

test('envia apenas os cortes escolhidos, na ordem da fila e com intervalo global entre Estúdio e Contínuo',async t=>{
 const env=await setup(t),memory=env.open(),first=job('first',[clip(0),clip(60)]),second=job('second',[clip(0)]);
 delete first.continuousId;
 const unselected=job('legacy',[clip(120)]),jobs=[second,unselected,first],sent=[];
 selectClips(memory,[second.clips[0],...first.clips]);
 const tick=createAutoPublisher({jobs,memory,editing:new Set(),save:()=>memory.remember(jobs),fields:()=>({}),send:async(j,c,_,p)=>{
  memory.reserve(j,c,p,true);sent.push([j.id,c.start,p]);c.posts[p]={state:'Publicado',id:'post-'+sent.length};memory.finish(j,c,true);memory.remember(jobs);
 }});
 await tick();await tick();
 assert.deepEqual(sent,[['second',0,'youtube'],['second',0,'instagram']]);
 env.advance(publicationInterval-1);await tick();assert.equal(sent.length,2);
 env.advance(1);await tick();assert.equal(sent.length,4);
 assert.deepEqual(sent[2],['first',0,'youtube']);
 memory.setAutomaticEnabled(false);env.advance(publicationInterval);await tick();assert.equal(sent.length,4);
 memory.setAutomaticEnabled(true);await tick();assert.equal(sent.length,6);
 assert.deepEqual(sent[4],['first',60,'youtube']);
 assert.deepEqual(unselected.clips[0].posts,{});
});

test('embaralha a ordem e ignora destinos manuais no agendador',async t=>{
 const {open}=await setup(t),memory=open(),j=job('mixed',[clip(0),clip(60)]),sent=[];
 selectClips(memory,j.clips,['youtube','tiktok','kwai']);
 shufflePublications(publicationQueue([j]),()=>0);
 const tick=createAutoPublisher({jobs:[j],memory,editing:new Set(),save:()=>{},fields:()=>({}),send:async(_,c,__,p)=>{
  sent.push([c.start,p]);c.posts[p]={state:'Publicado'};
 }});
 await tick();
 assert.deepEqual(sent,[[60,'youtube'],[0,'youtube']]);
 assert.deepEqual(publicationQueue([j]).map(({clip})=>clip.start),[60,0]);
});

test('TikTok espera a vaga, respeita a revisão autorizada e não repete uma entrega aceita',async t=>{
 const env=await setup(t),memory=env.open(),j=job('inbox',[clip(0),clip(60),clip(120)]),sent=[];
 const [first,second,edited]=j.clips;
 selectClips(memory,j.clips,['tiktok']);
 memory.setAutomaticConfig('tiktok',{mode:'inbox',channel:'profile'});
 for(const c of j.clips)c.posting.tiktokInbox={channel:'profile',revision:0};
 edited.revision=1;
 first.posts.tiktok=memory.deferTikTokInbox(j,first,'profile');
 const persisted=env.open();
 const tick=createAutoPublisher({jobs:[j],memory:persisted,editing:new Set(),save:()=>persisted.remember([j]),fields:()=>({}),send:async(_,c,__,p,b)=>{
  sent.push([c.start,b.mode]);c.posts[p]={state:'Abra a caixa de entrada do TikTok',mode:'inbox',id:'inbox-'+c.start};
 }});
 await tick();assert.deepEqual(sent,[]);
 env.advance(60*60_000);await tick();await tick();
 assert.deepEqual(sent,[[0,'inbox'],[60,'inbox']]);
});

test('nova recusa da caixa de entrada do TikTok não atrasa o próximo corte do YouTube',async t=>{
 const env=await setup(t),memory=env.open(),first=clip(0),next=clip(60),j=job('capped-inbox',[first,next]);
 selectClips(memory,j.clips,['youtube','tiktok']);
 memory.setAutomaticConfig('tiktok',{mode:'inbox',channel:'profile'});
 first.posting.tiktokInbox={channel:'profile',revision:0};
 const sent=[];
 memory.reserve(j,first,'youtube',true);
 first.posts.youtube={state:'Publicado',id:'published'};
 first.posts.tiktok=memory.deferTikTokInbox(j,first,'profile');
 memory.finish(j,first,true);
 memory.remember([j]);
 env.advance(60*60_000);
 const tick=createAutoPublisher({jobs:[j],memory,editing:new Set(),save:()=>memory.remember([j]),fields:()=>({}),send:async(job,c,__,p)=>{
  const reserved=memory.reserve(job,c,p,true);
  sent.push([c.start,p]);
  c.posts[p]=p==='tiktok'?memory.deferTikTokInbox(job,c,'profile'):{state:'Publicado',id:'next'};
  if(reserved)memory.finish(job,c,true);
  memory.remember([j]);
 }});
 await tick();
 assert.deepEqual(sent,[[0,'tiktok'],[60,'youtube']]);
 assert.equal(first.posts.tiktok.state,'Aguardando vaga no TikTok');
});

test('libera o intervalo antigo que foi reiniciado somente pela nova tentativa da caixa de entrada',async t=>{
 const env=await setup(t),first=clip(0),next=clip(60),j=job('legacy-inbox',[first,next]);
 const slot=publicationKey(j,first),retryAt=9_000_000;
 const data={slot,intervalMinutes:60,nextAt:retryAt+1,records:{
  [JSON.stringify([slot,'youtube'])]:{state:'Publicado',startedAt:1_000_000},
  [JSON.stringify([slot,'tiktok'])]:{state:'Aguardando vaga no TikTok',reason:'spam_risk_too_many_pending_share',retryAt}
 }};
 env.advance(5_000_000);
 await writeFile(env.file,JSON.stringify(data));
 assert.equal(env.open().canSend(j,next,true),true);
 await writeFile(env.file,JSON.stringify({...data,manuallyRestarted:true}));
 assert.equal(env.open().canSend(j,next,true),false);
});

test('lembra publicações e prazo após reiniciar, limpar histórico e cadastrar outra fonte para o mesmo vídeo',async t=>{
 const env=await setup(t),memory=env.open(),first=job('first',[clip(0)]);
 memory.reserve(first,first.clips[0],'youtube');
 first.clips[0].posts.youtube={state:'Publicado',id:'published'};
 memory.remember([first]);memory.remember([]);
 const reopened=env.open(),duplicate={...job('readded',[clip(0)]),mediaKey:first.mediaKey};
 assert.equal(reopened.lookup(duplicate,duplicate.clips[0],'youtube').id,'published');
 assert.equal(reopened.lookup(duplicate,duplicate.clips[0],'instagram'),null);
 assert.equal(reopened.canSend(duplicate,clip(60)),false);
 env.advance(publicationInterval);
 assert.equal(reopened.canSend(duplicate,clip(60)),true);
});

test('não repete publicação incerta após queda entre reserva e resposta da plataforma',async t=>{
 const env=await setup(t),memory=env.open(),j=job('first',[clip(0)]);
 memory.reserve(j,j.clips[0],'youtube');
 const reopened=env.open();
 assert.match(reopened.lookup(j,j.clips[0],'youtube').state,/incerto/);
 const jobs=[j];let sends=0;
 selectClips(reopened,j.clips,['youtube']);
 const tick=createAutoPublisher({jobs,memory:reopened,editing:new Set(),fields:()=>({}),save:()=>{},send:async()=>{sends++;}});
 await tick();
 assert.equal(sends,0);
 assert.match(j.clips[0].posts.youtube.state,/incerto/);
});

test('importa histórico existente, preserva confirmação e libera só falhas confirmadas',async t=>{
 const {open}=await setup(t),memory=open(),j=job('old',[clip(0)]),c=j.clips[0];
 c.posts={youtube:{state:'Publicado',id:'old'},instagram:{state:'Falhou'}};
 memory.remember([j]);
 assert.equal(memory.lookup(j,c,'youtube').state,'Publicado');
 assert.equal(memory.lookup(j,c,'instagram'),null);
 c.posts.youtube={state:'Enviando'};memory.remember([j]);
 assert.equal(memory.lookup(j,c,'youtube').state,'Publicado');
 assert.equal(memory.status().remembered,1);
});

test('bloqueia reserva concorrente de outro clipe e respeita destino pendente do mesmo clipe',async t=>{
 const {open}=await setup(t),memory=open(),j=job('a',[clip(0),clip(60)]);
 memory.reserve(j,j.clips[0],'youtube');
 assert.throws(()=>memory.reserve(j,j.clips[1],'youtube'),/15 minutos/);
 assert.doesNotThrow(()=>memory.reserve(j,j.clips[0],'instagram'));
 const studio={...j,continuousId:undefined};
 assert.doesNotThrow(()=>memory.reserve(studio,j.clips[1],'youtube'));
 assert.equal(memory.lookup(studio,j.clips[0],'youtube'),null);
});

test('edição do clipe mantém a identidade e IDs de transmissões distinguem maiúsculas',()=>{
 const j=job('a',[]),c={...clip(0),originalStart:0,originalLength:60};
 const before=publicationKey(j,c);
 c.start=10;c.length=40;
 assert.equal(publicationKey(j,c),before);
 assert.notEqual(publicationKey({...j,mediaKey:'Youtube:ABC'},c),publicationKey({...j,mediaKey:'Youtube:abc'},c));
 assert.equal(publicationKey({...j,scanMode:'live'},{...c,contentHash:'hash'}),'content:hash');
});

test('ticks simultâneos não iniciam dois envios e pausa impede iniciar o próximo destino',async t=>{
 const {open}=await setup(t),memory=open(),j=job('a',[clip(0)]),jobs=[j];
 let finish,started,sends=0;
 const firstSend=new Promise(resolve=>{started=resolve;});
 selectClips(memory,j.clips);
 const tick=createAutoPublisher({jobs,memory,editing:new Set(),save:()=>{},fields:()=>({}),send:async(job,c,_,p)=>{
  memory.reserve(job,c,p,true);sends++;started();await new Promise(resolve=>{finish=resolve;});c.posts[p]={state:'Enviado'};
 }});
 const pending=tick();await firstSend;await tick();assert.equal(sends,1);
 memory.setAutomaticEnabled(false);finish();await pending;
 assert.equal(sends,1);
});

test('fila ignora clipes bloqueados ou com verificação incompleta',async t=>{
 const {open}=await setup(t),memory=open(),j=job('a',[clip(0),clip(60),clip(120)]);
 j.clips[0].safety={status:'blocked'};j.clips[1].safety={status:'error'};j.clips[2].safety={status:'checking'};
 selectClips(memory,j.clips);
 let sent=0;
 await createAutoPublisher({jobs:[j],memory,editing:new Set(),save:()=>{},fields:()=>({}),send:async()=>{sent++;}})();
 assert.equal(sent,0);
});

test('recusa do YouTube deixa o corte disponível para tentativa manual e os próximos cortes seguem o intervalo geral',async t=>{
 const env=await setup(t),memory=env.open(),j=job('a',[clip(0),clip(60)]),jobs=[j],sent=[];
 selectClips(memory,j.clips);
 const tick=createAutoPublisher({jobs,memory,editing:new Set(),save:()=>memory.remember(jobs),fields:()=>({}),send:async(job,c,_,p)=>{
  memory.reserve(job,c,p,true);sent.push([c.start,p]);
  if(p==='youtube'&&c.start===0){c.posts[p]={state:'Falhou',reason:'uploadLimitExceeded'};memory.remember(jobs);throw Error('Limite atingido');}
  c.posts[p]={state:'Publicado',id:'post-'+sent.length};memory.remember(jobs);
 }});
 await tick();assert.deepEqual(sent,[[0,'youtube'],[0,'instagram']]);
 assert.ok(retryablePost(j.clips[0].posts.youtube));
 assert.equal(env.open().lookup(j,j.clips[0],'youtube'),null);
 await tick();assert.equal(sent.length,2);
 env.advance(publicationInterval);await tick();
 assert.deepEqual(sent,[[0,'youtube'],[0,'instagram'],[60,'youtube'],[60,'instagram']]);
});

test('remove o contador antigo e libera tentativa manual sem zerar o intervalo geral',async t=>{
 const {file,open}=await setup(t),j=job('legacy',[clip(0)]),c=j.clips[0];
 const wait={state:'Aguardando limite do YouTube',reason:'uploadLimitExceeded',retryAt:5_000_000};
 const record=JSON.stringify([publicationKey(j,c),'youtube']);
 await writeFile(file,JSON.stringify({nextAt:2_000_000,slot:null,cooldowns:{youtube:{until:5_000_000}},records:{[record]:wait}}));
 const memory=open();
 c.posts.youtube={...wait};
 memory.remember([j]);
 assert.equal(c.posts.youtube.state,'Falhou');
 assert.equal(c.posts.youtube.retryAt,undefined);
 assert.ok(retryablePost(c.posts.youtube));
 assert.equal(memory.lookup(j,c,'youtube'),null);
 assert.equal(memory.status().nextAt,2_000_000);
 assert.equal(memory.status().remembered,0);
 const saved=JSON.parse(await readFile(file,'utf8'));
 assert.equal(saved.cooldowns.youtube,undefined);
 assert.equal(saved.records[record].retryAt,undefined);
});

test('registro pendente antigo não sobrescreve um novo envio confirmado',async t=>{
 const {open}=await setup(t),memory=open(),j=job('a',[clip(0)]);
 const stale=job('b',[clip(0)]);stale.mediaKey=j.mediaKey;
 stale.clips[0].posts.youtube={state:'Aguardando limite do YouTube',reason:'uploadLimitExceeded',retryAt:5_000_000};
 memory.reserve(j,j.clips[0],'youtube');
 j.clips[0].posts.youtube={state:'Enviado',id:'accepted'};
 memory.remember([j,stale]);
 assert.equal(memory.lookup(stale,stale.clips[0],'youtube').id,'accepted');
});

test('recupera a falha antiga do link do Instagram e reenvia só depois do prazo',async t=>{
 const {open,advance}=await setup(t),memory=open(),j=job('a',[clip(0),clip(60)]);
 const [failed,accepted]=j.clips;
 selectClips(memory,j.clips,['instagram']);
 const legacy={state:'Falhou',reason:'instagram_upload_processing_failed',detail:'Contêiner 18016358312775704. A tentativa por link HTTPS falhou: O endereço HTTPS do Reel ainda não está acessível pela internet.'};
 failed.posts.instagram={...legacy};
 accepted.posts.instagram={...legacy,state:'Em processamento',id:'1234'};
 memory.remember([j]);
 const first=failed.posts.instagram;
 assert.equal(first.state,'Aguardando link do Instagram');
 assert.equal(first.reason,'instagram_link_unavailable');
 assert.equal(accepted.posts.instagram.id,'1234');
 const retried=[],tick=createAutoPublisher({jobs:[j],memory:open(),editing:new Set(),fields:()=>({}),save:()=>{},send:async(_job,c)=>retried.push(c)});
 await tick();assert.deepEqual(retried,[]);
 advance(5*60_000);await tick();assert.deepEqual(retried,[failed]);
 const next=memory.deferInstagram(j,failed,first.reason,first);
 assert.equal(next.linkAttempts,2);
 assert.equal(next.retryAt-first.retryAt,10*60_000);
});
