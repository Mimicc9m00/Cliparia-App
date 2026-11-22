import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyPostCopy,identifyGame,postFields,postSpeech,postText,queuePostCopy,refreshPostCopy,suggestPost,trendHashtagScores} from '../post-copy.mjs';
import {captionsAss} from '../speech.mjs';

test('writes copy from the current clip and keeps platform templates',()=>{
 const job={title:'GTA 6 ao vivo'};
 const clip={title:'GTA 6 ao vivo · Corte 2',postSpeech:postSpeech([
  {start:4,end:8,text:'Essa missão começou de um jeito inacreditável!'},
  {start:12,end:18,text:'Eu estava jogando Minecraft.'}
 ],0,10)};
 const copy=suggestPost(job,clip);
 assert.match(postText(copy),/missão começou/);
 assert.match(postText(copy),/#gta6/);
 assert.match(postText(copy),/#missao/);
 assert.doesNotMatch(postText(copy),/Minecraft/);
 assert.deepEqual(postFields('youtube',{title:'Meu corte {n}',description:'Créditos'},clip,'2',copy),
  {title:'Meu corte 2 #gta6 #rockstar #missao',description:'Créditos\n\n'+postText(copy)});
 assert.equal(postFields('instagram',{},clip,'2',copy).title,postText(copy));
 assert.equal(postFields('instagram',{},clip,'2',null).title,clip.title);
});

test('uses the source title when speech is absent',()=>{
 const copy=suggestPost({title:'Live de Roblox'}, {title:'Corte 1'});
 assert.deepEqual(copy,{title:'Live de Roblox #roblox #jogos',text:'Live de Roblox',tags:['#roblox','#jogos'],basis:'source',game:'Roblox',gameSource:'title'});
});

test('identifica o jogo pela categoria mesmo quando o nome não é falado',()=>{
 const copy=suggestPost({title:'Mais uma vitória!',categories:['Fortnite']},{postSpeech:[{start:0,end:3,text:'Consegui ganhar essa partida!'}]});
 assert.equal(copy.game,'Fortnite');
 assert.equal(copy.gameSource,'category');
 assert.ok(copy.tags.includes('#fortnite'));
 assert.ok(copy.tags.includes('#jogos'));
});

test('prioriza a fala do clipe e dados específicos do jogo sobre o título genérico',()=>{
 assert.deepEqual(identifyGame({game:'Elden Ring',title:'Minecraft'},'Ganhei no Valorant!'),{tag:'Valorant',source:'speech'});
 assert.deepEqual(identifyGame({game:'Elden Ring',categories:['Gaming'],title:'Minecraft'}),{tag:'EldenRing',source:'game'});
 assert.deepEqual(identifyGame({title:'Hoje tem live',sourceTags:['gameplay','Stardew Valley']}),{tag:'StardewValley',source:'tags'});
 assert.equal(identifyGame({sourceTags:['Minecraft','Fortnite']}),null);
 assert.equal(identifyGame({},'Isso foi engraçado lol!'),null);
 assert.equal(identifyGame({title:'GTA RP com amigos'}).tag,'GTARP');
 assert.equal(identifyGame({categories:['Grand Theft Auto VI']},'Esse GTA está muito bom!').tag,'GTA6');
});

test('categoria ampla, sozinha, deixa a hashtag em branco',()=>{
 const gaming=suggestPost({title:'Ao vivo',categories:['Gaming']},{});
 assert.equal(gaming.game,null);
 assert.deepEqual(gaming.tags,[]);
 const other=suggestPost({title:'Conversando com o público',categories:['Just Chatting']},{});
 assert.equal(other.game,null);
 assert.ok(!other.tags.includes('#jogos'));
});

test('gera nome próprio e descrição com falas do clipe, priorizando seu jogo em vez do título da live',()=>{
 const job={title:'Minecraft ao vivo'};
 const clip={start:40,length:60,title:'Minecraft ao vivo · Corte 1',postSpeech:[
  {start:2,end:8,text:'Agora vamos jogar Roblox.'},
  {start:42,end:48,text:'Chegamos à última missão do GTA 6.'},
  {start:49,end:54,text:'Consegui completar a missão sem perder o carro!'},
  {start:101,end:105,text:'Vamos mudar para Fortnite.'}
 ]};
 applyPostCopy(job,clip);
 assert.match(clip.title,/missão/);
 assert.doesNotMatch(clip.title,/Minecraft|Corte 1/);
 assert.match(clip.description,/GTA 6/);
 assert.match(clip.description,/#gta6/);
 assert.doesNotMatch(clip.description,/Roblox|Fortnite|Minecraft/);
 assert.equal(clip.copyBasis,'speech');
 const copy=suggestPost(job,clip);
 assert.equal(postFields('youtube',{},clip,'1',copy).title,clip.title);
 assert.equal(postFields('youtube',{},clip,'1',copy).description,clip.description);
 assert.equal(postFields('instagram',{},clip,'1',copy).title,clip.description);
});

test('atualiza título e tags ao remover uma fala no ajuste e limita o título da publicação',()=>{
 const job={title:'Live de jogos'};
 const clip={start:0,length:90,postSpeech:[
  {start:1,end:8,text:'Consegui completar a missão do Minecraft!'},
  {start:45,end:55,text:'Ganhei a corrida no GTA 6!'}
 ]};
 applyPostCopy(job,clip);
 clip.start=40;clip.length=50;
 applyPostCopy(job,clip);
 assert.equal(clip.title,'Ganhei a corrida no GTA 6! #gta6 #rockstar #corrida');
 assert.doesNotMatch(clip.description,/Minecraft|#missao/);
 assert.ok(clip.hashtags.includes('#corrida'));
 assert.ok(postFields('youtube',{title:'a'.repeat(150)},clip,'1',suggestPost(job,clip)).title.length<=100);
});

test('fala curta também produz título sem inventar acontecimentos',()=>{
 const copy=suggestPost({title:'Live genérica'},{postSpeech:[{start:0,end:1,text:'Ganhei!'}]});
 assert.equal(copy.title,'Ganhei! #vitoria');
 assert.equal(copy.basis,'speech');
 assert.equal(copy.text,'“Ganhei!”');
});

test('mantém as hashtags mesmo com modelos longos de descrição e legenda',()=>{
 const clip={title:'Corte',postSpeech:[{start:0,end:2,text:'Ganhei a corrida no GTA 6!'}]};
 const copy=suggestPost({},clip);
 for(const platform of ['youtube','instagram']){
  const fields=postFields(platform,{title:'Créditos '.repeat(400),description:'Créditos '.repeat(400)},clip,'1',copy);
  const text=platform==='youtube'?fields.description:fields.title;
  assert.match(text,/#gta6/);
  assert.ok(text.endsWith('#jogos'));
  assert.ok(text.length<=(platform==='youtube'?1250:2200));
 }
});

test('título longo mantém hashtags completas dentro de 100 caracteres, inclusive no envio automático',()=>{
 const clip={title:'Corte',postSpeech:[{start:0,end:10,text:'Essa corrida no GTA 6 foi incrível e eu consegui chegar até o final sem perder nenhuma das disputas pelo primeiro lugar!'}]};
 const copy=suggestPost({},clip);
 assert.ok(copy.title.length<=100);
 assert.ok(copy.title.endsWith('#gta6 #rockstar #corrida'));
 const fields=postFields('youtube',{title:'Meu título personalizado muito longo '.repeat(10)},clip,'1',copy);
 assert.ok(fields.title.length<=100);
 assert.ok(fields.title.endsWith('#gta6 #rockstar #corrida'));
});

test('regeneração não duplica hashtags e preserva hashtag personalizada no título',()=>{
 const clip={title:'Corte',postSpeech:[{start:0,end:2,text:'Ganhei no Fortnite!'}]};
 applyPostCopy({},clip);
 const first=clip.title;
 applyPostCopy({},clip);
 assert.equal(clip.title,first);
 const copy=suggestPost({},clip);
 const fields=postFields('youtube',{title:'Vitória #fortnite #MeuCanal'},clip,'1',copy);
 assert.equal(fields.title,'Vitória #fortnite #vitoria #MeuCanal');
 assert.equal((fields.title.match(/#fortnite/gi)||[]).length,1);
});

test('prioriza GTA 6, Rockstar e lançamento quando o corte fala da estreia',()=>{
 const job={title:'Cortes da live #viral',categories:['Gaming'],sourceTags:['Fortnite','fyp']};
 const clip={postSpeech:[{start:0,end:4,text:'A Rockstar anunciou a data de lançamento do GTA seis!'}]};
 const copy=suggestPost(job,clip);
 assert.deepEqual(copy.tags,['#gta6','#rockstar','#lancamento','#jogos']);
 assert.ok(copy.title.endsWith('#gta6 #rockstar #lancamento'));
 const gameplay=suggestPost({title:'GTA 6 lançamento oficial'},{postSpeech:[{start:0,end:4,text:'Ganhei a corrida quando virei o carro!'}]});
 assert.deepEqual(gameplay.tags,['#gta6','#rockstar','#corrida','#vitoria','#jogos']);
 const talk=suggestPost({title:'Lançamento GTA 6'},{postSpeech:[{start:0,end:2,text:'Fiz um clutch na ranqueada de Valorant!'}]});
 assert.deepEqual(talk.tags,['#valorant','#ranked','#clutch','#jogos']);
});

test('usa tags ligadas ao modo de jogo e aceita nome específico nos metadados',()=>{
 const clip={postSpeech:[{start:0,end:4,text:'Fiz essa construção com redstone no meu mundo survival!'}]};
 assert.deepEqual(suggestPost({categories:['Minecraft']},clip).tags,['#minecraft','#minecraftbuild','#redstone','#minecraftsurvival','#jogos']);
 assert.deepEqual(suggestPost({game:'Subnautica'},{}).tags,['#subnautica','#jogos']);
 assert.deepEqual(suggestPost({game:'Just Chatting'},{}).tags,[]);
});

test('usa o contexto da fala e não converte o nome do canal em hashtag',()=>{
 const clip={postSpeech:[{start:0,end:2,text:'Esse jogo de terror me pegou desprevenido!'}]};
 const copy=suggestPost({url:'https://www.twitch.tv/CanalDeTeste'},clip);
 assert.deepEqual(copy.tags,['#jogosdeterror','#jogos']);
 assert.deepEqual(suggestPost({url:'https://www.twitch.tv/CanalDeTeste'},{}).tags,[]);
});

test('cruza pistas da fala para marcar a cena mesmo sem saber o jogo',()=>{
 const clip={postSpeech:[{start:0,end:2,text:'Procura o vigia. Vamos decifrar essas páginas.'},{start:2,end:5,text:'A pista está naquele poema.'}]};
 const copy=suggestPost({url:'https://www.twitch.tv/CanalDeTeste'},clip);
 assert.deepEqual(copy.tags,['#enigmas','#investigacao','#suspense']);
 assert.match(copy.title,/#enigmas/);
 const unclear=suggestPost({}, {excerpt:'Onde é que eu estou? Espera.'});
 assert.deepEqual(unclear.tags,[]);
});

test('reconhece pistas exclusivas de GTA 6 e o título real da Twitch',()=>{
 const game=suggestPost({title:'Canal (live)'},{excerpt:'Lucia vai usar o pacote vintage de Vice City.'});
 assert.deepEqual(game.tags,['#gta6','#rockstar','#vicecity','#jogos']);
 const mystery=suggestPost({title:'Canal (live)'},{excerpt:'Vamos decifrar essas páginas do Johannes Zuch.'});
 assert.deepEqual(mystery.tags,['#gta6','#rockstar','#tenebraelux','#enigmas','#jogos']);
 const fromTitle=suggestPost({title:'Canal (live)',sourceTitle:'Zerando GTA VI'},{excerpt:'Olha isso!'});
 assert.deepEqual(fromTitle.tags,['#gta6','#rockstar','#jogos']);
});

test('usa o que foi conferido no corte quando a fala cita outro jogo',()=>{
 const clip={excerpt:'E quando eu jogava FIFA?',postContext:{game:'Grand Theft Auto VI',topics:['exploracao']}};
 const copy=suggestPost({title:'Canal (live)'},clip);
 assert.deepEqual(copy.tags,['#gta6','#rockstar','#exploracao','#jogos']);
 assert.equal(copy.gameSource,'clip');
});

test('atualiza uma vez as hashtags antigas e guarda o nome usado em envios anteriores',()=>{
 const oldTitle='A data de lançamento saiu! #GTA6 #jogos';
 const clip={title:oldTitle,description:'Legenda #MelhoresMomentos',posts:{tiktok:{state:'Publicado'}}};
 const job={title:'GTA 6',writePosts:true};
 refreshPostCopy(job,clip);
 assert.equal(clip.previousPostTitle,oldTitle);
 assert.match(clip.title,/#gta6 #rockstar/);
 assert.deepEqual(clip.posts,{tiktok:{state:'Publicado'}});
 refreshPostCopy(job,clip);
 assert.equal(clip.previousPostTitle,oldTitle);
});

test('renders a short highlighted headline independently of spoken captions',()=>{
 const ass=captionsAss([{start:0,end:3,text:'Três vídeos para mostrar.'}],0,40,'TRÊS VÍDEOS');
 assert.match(ass,/Dialogue: 1.*Hook.*TRÊS .*VÍDEOS/);
 assert.match(ass,/Dialogue: 0.*Caption/);
});

test('uma fala sobre a live tem título próprio e não herda as hashtags do GTA',()=>{
 const copy=suggestPost({sourceTitle:'GTA 6 ao vivo',categories:['GTA 6']},{postSpeech:[
  {start:5,end:7,text:'Live gravada? Vamos testar o time-out de uma semana?'},
  {start:7,end:12,text:'O chat não vai acreditar.'}
 ]});
 assert.equal(copy.title,'A live era gravada? #livegravada');
 assert.match(copy.text,/Vamos testar/);
 assert.deepEqual(copy.tags,['#livegravada']);
});

test('popularidade só prioriza assuntos do corte e o texto fica estável na fila',()=>{
 const postTrendTags=trendHashtagScores([
  {snippet:{title:'Vídeo #vitória #Fortnite',description:'#vitoria'}},
  {snippet:{title:'Outro #vitoria #fortnite'}}
 ]);
 assert.deepEqual(postTrendTags,{vitoria:2,fortnite:2});
 const job={writePosts:true,postTrendTags};
 const clip={postSpeech:[{start:0,end:4,text:'Ganhei a corrida no GTA 6!'}]};
 applyPostCopy(job,clip);
 assert.deepEqual(clip.hashtags,['#gta6','#rockstar','#vitoria','#corrida','#jogos']);
 assert.equal(queuePostCopy({...job,postTrendTags:{}},clip).title,clip.title);
 assert.equal(postText(queuePostCopy(job,clip)),clip.description);
});
