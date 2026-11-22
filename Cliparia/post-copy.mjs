const clean=value=>String(value||'').replace(/<[^>]*>|[\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim();
const cut=(value,max)=>value.length<=max?value:value.slice(0,max-1).replace(/\s+\S*$/u,'')+'…';
const hashtag=/#[\p{L}\p{N}_]+/gu;
const withoutTags=value=>value.replace(hashtag,'').replace(/\s+/g,' ').trim();
const fold=value=>clean(value).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const tagWord=value=>fold(value).replace(/[^a-z0-9_]/g,'');
const postCopyVersion=4;
const games=[
 [/\b(?:gta|grand theft auto)\s*(?:6|vi|seis)\b/i,'GTA6'],[/\b(?:gta\s*rp|fivem)\b/i,'GTARP'],[/\b(?:gta|grand theft auto)\s*(?:5|v|cinco)\b/i,'GTA5'],[/\b(?:gta|grand theft auto)\b/i,'GTA'],
 [/\bminecraft\b/i,'Minecraft'],[/\bfortnite\b/i,'Fortnite'],[/\bvalorant\b/i,'Valorant'],
 [/\bleague of legends\b|\b(?:jogando|partida de|ranqueada de)\s+lol\b/i,'LeagueOfLegends'],[/\b(?:counter[ -]?strike\s*2|cs\s*2)\b/i,'CS2'],
 [/\b(?:cs[ :.-]?go|counter[ -]?strike:? global offensive)\b/i,'CSGO'],[/\bcounter[ -]?strike\b/i,'CounterStrike'],
 [/\bwarzone\b/i,'Warzone'],[/\bcall of duty\b/i,'CallOfDuty'],[/\b(?:free fire|freefire)\b/i,'FreeFire'],
 [/\broblox\b/i,'Roblox'],[/\bred dead redemption\s*(?:2|ii)\b/i,'RedDeadRedemption2'],[/\bred dead redemption\b/i,'RedDeadRedemption'],
 [/\belden ring\b/i,'EldenRing'],[/\b(?:ea sports fc\s*\d*|fc\s*(?:24|25|26|27)|fifa\s*\d*)\b/i,'EASportsFC'],
 [/\befootball\b/i,'eFootball'],[/\brocket league\b/i,'RocketLeague'],[/\boverwatch\s*2?\b/i,'Overwatch'],
 [/\bapex legends\b/i,'ApexLegends'],[/\b(?:pubg|playerunknown.?s battlegrounds)\b/i,'PUBG'],
 [/\brainbow six(?: siege)?\b/i,'RainbowSixSiege'],[/\bdead by daylight\b/i,'DeadByDaylight'],
 [/\bdota\s*2\b/i,'Dota2'],[/\bworld of warcraft\b/i,'WorldOfWarcraft'],
 [/\bgenshin impact\b/i,'GenshinImpact'],[/\bhonkai.?star rail\b/i,'HonkaiStarRail'],
 [/\bforza horizon\s*\d*\b/i,'ForzaHorizon'],[/\bthe sims\s*\d*\b/i,'TheSims'],
 [/\bstardew valley\b/i,'StardewValley'],[/\bterraria\b/i,'Terraria'],
 [/\bsea of thieves\b/i,'SeaOfThieves'],[/\bmarvel rivals\b/i,'MarvelRivals'],
 [/\b(?:arc raiders|ark raiders)\b/i,'ArcRaiders'],[/\b(?:hollow knight:? silksong|silksong)\b/i,'Silksong'],
 [/\bphasmophobia\b/i,'Phasmophobia'],[/\blethal company\b/i,'LethalCompany'],
 [/\b(?:enigma do medo|enigma of fear)\b/i,'EnigmaDoMedo']
];
function matchGame(value){
 const text=clean(value);
 const keys=new Set([tagWord(text),...(text.match(hashtag)||[]).map(tagWord)]);
 return games.find(([pattern,tag])=>pattern.test(text)||keys.has(tag.toLowerCase()))?.[1]||(/^lol$/i.test(text)?'LeagueOfLegends':null);
}
const tenebraeClue=/\b(?:tenebrae\s+lux|johannes\s+zuch|jorraine\s+zuki)\b/;
const gta6Clue=/\b(?:jason duval|lucia caminos|port gellhorn|cal hampton|boobie ike|estado de leonida)\b/;
function gameFromSpeech(spoken){
 const text=fold(spoken);
 if(tenebraeClue.test(text)||gta6Clue.test(text)||/\b(?:lucia|jason)\b/.test(text)&&/\b(?:vice city|pacote vintage|leonida)\b/.test(text))return 'GTA6';
 return matchGame(spoken);
}
const broadCategory=/^(?:games?|gaming|jogos|videogames?|video games?|gameplay|just chatting|conversas?|irl|talk shows?(?: & podcasts)?|music|musica|sports?|esportes?|entertainment|entretenimento|other|outros?|unknown|desconhecido|none|n\/a)$/;
export function identifyGame(job,spoken=''){
 // A game named in this clip takes priority when a stream changes games.
 const fromSpeech=gameFromSpeech(spoken);
 if(fromSpeech&&fromSpeech!=='GTA')return {tag:fromSpeech,source:'speech'};
 const sources=[['game',job.game],['category',(job.categories||[]).join(' ')],['title',job.sourceTitle||job.title]];
 for(const [source,value] of sources){
  const category=fold(value);
  const tag=matchGame(value)||(source==='game'&&/^[a-z][a-z0-9]{2,28}$/.test(tagWord(category))&&!broadCategory.test(category)?clean(value):null);
  if(tag&&(!fromSpeech||/^GTA(?:[56]|RP)?$/.test(tag)))return {tag,source};
 }
 if(fromSpeech)return {tag:fromSpeech,source:'speech'};
 // Broad stream tags can mention several games; do not pick one arbitrarily.
 const tags=[...new Set((job.sourceTags||[]).map(matchGame).filter(Boolean))];
 return tags.length===1?{tag:tags[0],source:'tags'}:null;
}
const themes=[
 [/\b(?:lancamentos?(?!\s+(?:de|do|da)\s+(?:granada|foguete|bola|dado|missil))|data de estreia|release date|launch date|chega as lojas)\b/,'lancamento'],
 [/\b(?:novo trailer|trailers?|teaser)\b/,'trailer'],
 [/\b(?:pre[- ]?venda|pre[- ]?compra|pre[- ]?order)\b/,'prevenda'],
 [/\b(?:atualizac(?:ao|oes)|patch notes|novo patch|nova temporada)\b/,'atualizacao'],
 [/\bordem paranormal\b/,'ordemparanormal'],
 [/\b(?:jogos? de terror|survival horror|terror psicologico)\b/,'jogosdeterror'],
 [/\b(?:rpg|mesa de rpg|campanha de rpg)\b/,'rpg'],
 [/\b(?:anime|manga)\b/,'anime'],
 [/\b(?:speed ?run|recorde mundial)\b/,'speedrun'],
 [/\b(?:ranquead[ao]s?|ranked|subi de elo)\b/,'ranked'],
 [/\b(?:clutch|1\s*(?:v|x)\s*[2-5])\b/,'clutch'],
 [/\b(?:campeonato|torneio|esports?)\b/,'campeonato'],
 [/\b(?:gol|gols|golaco|golacos)\b/,'gol'],
 [/\b(?:assalto|heist)\b/,'heist'],
 [/\b(?:corrida|corridas|piloto|volante|dirigindo)\b/,'corrida'],
 [/\b(?:perseguicao|perseguicoes|perseguindo|fug(?:i|ir|indo) da policia)\b/,'perseguicao'],
 [/\b(?:missao|missoes|quest)\b/,'missao'],
 [/\b(?:chefao|boss|batalha|combate)\b/,'combate'],
 [/\b(?:vitoria|ganhei|vencemos|partida ganha)\b/,'vitoria'],
 [/\b(?:entrevista|entrevistad[ao])\b/,'entrevista'],
 [/\b(?:react|reagindo|reagi)\b/,'react'],
 [/\b(?:sinuca|bola na cacapa|mesa de bilhar)\b/,'sinuca'],
 [/\b(?:jet[- ]?ski|moto aquatica)\b/,'jetski'],
 [/\b(?:hilari[oa]s?|engracad[oa]s?|morri de rir|rindo)\b/,'momentosengracados']
];
const relevantGameTags={
 GTA6:['rockstar'],GTA5:['rockstar'],GTA:['rockstar'],GTARP:['fivem'],
 RedDeadRedemption2:['rdr2','rockstargames'],RedDeadRedemption:['rockstargames'],
 Warzone:['callofduty'],CounterStrike:['cs'],LeagueOfLegends:['lol']
};
const gameThemes={
 GTA6:[[tenebraeClue,'tenebraelux'],[/\bvice city\b/,'vicecity']],
 Minecraft:[[/\b(?:criativo|construi|construcao|build)\b/,'minecraftbuild'],[/\bredstone\b/,'redstone'],[/\b(?:survival|sobrevivencia)\b/,'minecraftsurvival']],
 Fortnite:[[/\b(?:sem construcao|zero build)\b/,'fortnitezerobuild'],[/\b(?:battle royale|vitoria royale|victory royale)\b/,'battleroyale']],
 Roblox:[[/\bobby\b/,'robloxobby'],[/\bblox fruits\b/,'bloxfruits'],[/\b(?:dress to impress|dti)\b/,'dresstoimpress']],
 FreeFire:[[/\bbooyah\b/,'booyah'],[/\b(?:capa|sobe capa|headshot)\b/,'freefirebr']],
 Valorant:[[/\bace\b/,'valorantace']],
 CS2:[[/\bace\b/,'cs2ace']],
 GTARP:[[/\b(?:role ?play|rp)\b/,'roleplay']]
};
function topicTags(value,game){
 const text=fold(value);
 const matches=Object.hasOwn(gameThemes,game?.tag)?gameThemes[game.tag]:[];
 return [...matches,...themes].filter(([pattern])=>pattern.test(text)).map(([,tag])=>tag);
}
// Each scene needs two different clues in the clip, so isolated words such as
// "loja", "medo" or "segredo" do not become tags on their own.
const scenes=[
 ['enigmas',/\b(?:decifr\w*|desifr\w*|enigmas?|quebra[- ]cabeca)\b/,/\b(?:paginas?|codigos?|senhas?|simbolos?|poema|numeros?|pistas?)\b/],
 ['investigacao',/\b(?:investig\w*|revel\w*|procur\w*|descobr\w*|decifr\w*|desifr\w*)\b/,/\b(?:pistas?|segredos?|paginas?|poema|vigia|watcher|codigo)\b/],
 ['jogosdeterror',/\b(?:assombr\w*|fantasma|escuridao|jumpscare|susto|medo)\b/,/\b(?:jogo|jogando|fase|personagem|enigma|monstro|jumpscare)\b/],
 ['personalizacao',/\b(?:roupas?|look|figurino|visual)\b/,/\b(?:lojas?|compr\w*|prov\w*|escolh\w*|trocar|customiz\w*)\b/],
 ['exploracao',/\b(?:explor\w*|procur\w*|onde (?:fica|eu estou|e que eu to)|percorrer)\b/,/\b(?:mapa|ilha|marina|caverna|ruinas?|trilha|hotel)\b/],
 ['direcao',/\b(?:carro|moto|caminhao|veiculo|volante)\b/,/\b(?:embreagem|freio|acelera\w*|manobra\w*|estaciona\w*|batida|capot\w*)\b/],
 ['perseguicao',/\b(?:policia|viatura|sirene)\b/,/\b(?:fug\w*|persegu\w*|despist\w*)\b/],
 ['assalto',/\b(?:give me (?:your|the) cash|roub\w*|rend\w*|assalt\w*)\b/,/\b(?:atm|caixa eletronico|banco|dinheiro|cash|cofre)\b/],
 ['pesca',/\b(?:peixe|peixes|pesc\w*)\b/,/\b(?:vara|isca|anzol|fisg\w*|pesc\w*)\b/],
 ['suspense',/\b(?:segredos?|misterios?|pistas?|revel\w*|enigmas?)\b/,/\b(?:vela|vigia|watcher|escuridao|poema|simbolos?)\b/]
];
const liveTopics=[
 ['livegravada','A live era gravada?',/\b(?:live|transmissao) gravada\b/,/\b(?:test\w*|chat|time\s*-?\s*out)\b/],
 ['bastidoresdalive','Os planos para a live antes da viagem',/\b(?:live|transmissao)\b/,/\b(?:viag\w*|viaj\w*)\b.*\b(?:voo|aviao|aeroporto)\b|\b(?:voo|aviao|aeroporto)\b.*\b(?:viag\w*|viaj\w*)\b/]
];
function sceneTags(value){
 const text=fold(value);
 return scenes.filter(([,action,object])=>action.test(text)&&object.test(text)).map(([tag])=>tag);
}
export function trendHashtagScores(items){
 const counts=new Map();
 for(const {snippet} of items){
  const tags=new Set((`${snippet?.title||''} ${snippet?.description||''}`.match(hashtag)||[]).map(tagWord));
  for(const tag of tags)if(tag.length>=2&&tag.length<=29)counts.set(tag,(counts.get(tag)||0)+1);
 }
 return Object.fromEntries([...counts].sort((a,b)=>b[1]-a[1]).slice(0,150));
}
function contextualTags(job,game,spoken,source,observedTopics,liveTopic){
 const local=[...observedTopics,...topicTags(spoken,game),...sceneTags(spoken)];
 const sourceGame=matchGame(source);
 const metadata=!spoken||game&&sourceGame===game.tag?topicTags(source,game):[];
 const popularity=tag=>Object.hasOwn(job.postTrendTags||{},tag)?job.postTrendTags[tag]:0;
 const topics=(local.length?local:metadata).sort((a,b)=>popularity(b)-popularity(a));
 const aliases=Object.hasOwn(relevantGameTags,game?.tag)?relevantGameTags[game.tag]:[];
 const specific=[game?.tag,...aliases,liveTopic,...topics].filter(Boolean);
 const gaming=!!game||!liveTopic&&/\b(?:gaming|games|jogos|video games|videogames|gameplay|dentro do jogo|jogo de terror|tela do jogo|desse jogo|no jogo|do jogo)\b/.test(fold([job.game,source,...(job.categories||[]),spoken].join(' ')));
 const tags=[...new Set(specific.map(tagWord))].slice(0,gaming?4:5);
 if(gaming&&tags.length)tags.push('jogos');
 return tags.map(tag=>'#'+tag);
}
export function postSpeech(segments,start,end){
 return segments.filter(s=>s.end>start&&s.start<end).slice(0,180)
  .map(s=>({start:Math.max(start,s.start),end:Math.min(end,s.end),text:cut(clean(s.text),160)}))
  .filter(s=>s.text);
}
function bestQuote(speech){
 const lines=[];
 let line='',last=-Infinity;
 for(const s of speech||[]){
  const text=clean(s.text).replace(/#\S+/g,'').trim();
  if(s.start-last>1.75&&line){lines.push(line);line='';}
  line=[line,text].filter(Boolean).join(' ');
  if(/[.!?…]$/.test(text)||line.length>=72){lines.push(line);line='';}
  last=s.end;
 }
 if(line)lines.push(line);
 return lines.filter(s=>s.length>=4).sort((a,b)=>score(b)-score(a))[0]||'';
}
function score(s){
 const text=fold(s);
 return Math.min(s.length,48)/12-Math.max(s.length-75,0)/20
  +(/[!?]$/.test(s)?3:0)+(/[.!?]$/.test(s)?2:0)
  +(gameFromSpeech(s)?3:0)+(topicTags(s).length?4:0)+(sceneTags(s).length?2:0)
  -(/^(?:ah|ahn|eh|hum|entao|tipo|mano|cara)\b/.test(text)?3:0);
}
function titleWithTags(value,tags=[],keepExisting=false){
 const title=clean(value).replace(/[<>]/g,'');
 const existing=keepExisting?title.match(hashtag)||[]:[];
 const selected=[],seen=new Set();
 for(const tag of [...tags.slice(0,2),...existing,...tags.slice(2)]){
  const key=tagWord(tag);
  if(seen.has(key)||tag.length>30||selected.length===3)continue;
  seen.add(key);selected.push(tag);
 }
 const suffix=selected.join(' ');
 const text=withoutTags(title)||'Melhores momentos';
 return [cut(text,100-(suffix?suffix.length+1:0)),suffix].filter(Boolean).join(' ');
}
export function suggestPost(job,clip){
 const originalSource=clean(job.sourceTitle||job.title||clip.title).replace(/\s*·\s*Corte\s+\d+$/i,'');
 const source=cut(withoutTags(originalSource)||originalSource,115);
 const speech=postSpeech(clip.postSpeech||[],clip.start??-Infinity,(clip.start??0)+(clip.length??Infinity));
 const quote=bestQuote(speech)||clean(clip.excerpt);
 const spoken=speech.map(s=>s.text).join(' ')||quote;
 const observedGame=matchGame(clip.postContext?.game);
 const observedTopics=(clip.postContext?.topics||[]).filter(tag=>/^[a-z][a-z0-9_]{2,28}$/.test(tag));
 const inferredGame=observedGame?{tag:observedGame,source:'clip'}:identifyGame({...job,title:job.title||source},spoken);
 const spokenContext=fold(spoken);
 const liveTopic=liveTopics.find(([, ,action,object])=>action.test(spokenContext)&&object.test(spokenContext));
 const game=liveTopic&&!['speech','clip'].includes(inferredGame?.source)?null:inferredGame;
 const tags=contextualTags(job,game,spoken,job.sourceTitle||job.title||source,observedTopics,liveTopic?.[0]);
 // Keep the headline and its surrounding speech grounded in this clip.
 // Use source metadata only when no speech was recognized.
 const headline=liveTopic?.[1]||(quote?quote[0].toLocaleUpperCase('pt-BR')+quote.slice(1):source);
 const title=titleWithTags(headline||'Melhores momentos da live',tags);
 const position=speech.findIndex(s=>liveTopic?liveTopic[2].test(fold(s.text)):quote.includes(s.text));
 const nearby=position<0?quote:speech.slice(Math.max(0,position-1),position+3).map(s=>s.text).join(' ');
 const text=quote?'“'+cut(nearby||quote,900)+'”':source||'Melhores momentos da live';
 return {title,text,tags,basis:quote?'speech':'source',game:game?.tag||null,gameSource:game?.source||null};
}
export function applyPostCopy(job,clip){
 const copy=suggestPost(job,clip);
 clip.title=copy.title;
 clip.description=postText(copy);
 clip.hashtags=copy.tags;
 clip.copyBasis=copy.basis;
 clip.game=copy.game;
 clip.gameSource=copy.gameSource;
 clip.postCopyVersion=postCopyVersion;
 return clip;
}
export function refreshPostCopy(job,clip){
 if(!job.writePosts||clip.postDraft||clip.recoveredFromDrive||clip.postCopyVersion===postCopyVersion)return;
 clip.previousPostTitle??=clip.title;
 applyPostCopy(job,clip);
}
export function postText(post){
 return [post.text,post.tags.join(' ')].filter(Boolean).join('\n\n');
}
export function captionWithoutTags(description,tags){
 const suffix=tags.join(' ');
 if(!suffix)return description;
 if(description===suffix)return '';
 return description.endsWith('\n\n'+suffix)?description.slice(0,-suffix.length-2):description;
}
export function validatePostDraft({title,text,tags}){
 if(typeof title!=='string'||typeof text!=='string'||typeof tags!=='string')throw Error('Informe o título, a legenda e as hashtags do corte.');
 const headline=withoutTags(clean(title));
 const caption=text.trim();
 if(!headline||headline.length>100)throw Error('Informe um título de até 100 caracteres.');
 const words=[...title.matchAll(hashtag)].map(match=>match[0]).concat(tags.split(/[\s,#]+/u).filter(Boolean));
 const unique=new Map();
 for(const word of words){
  const tag=word.replace(/^#/,'');
  if(!/^[\p{L}\p{N}_]{1,30}$/u.test(tag))throw Error('Use letras, números ou sublinhado nas hashtags.');
  const key=tag.normalize('NFC').toLocaleLowerCase('pt-BR');
  if(!unique.has(key))unique.set(key,'#'+tag);
 }
 const draft={title:headline,text:caption,tags:[...unique.values()]};
 if(postText(draft).length>1250)throw Error('Use até 1.250 caracteres na legenda, incluindo hashtags.');
 return draft;
}
export function queuePostCopy(job,clip){
 const draft=clip.postDraft;
 if(draft)return {...draft,title:titleWithTags(draft.title,draft.tags),basis:'manual'};
 if(clip.postCopyVersion===postCopyVersion&&Array.isArray(clip.hashtags)&&typeof clip.description==='string'){
  return {title:clip.title,text:captionWithoutTags(clip.description,clip.hashtags),tags:clip.hashtags,basis:clip.copyBasis,game:clip.game,gameSource:clip.gameSource};
 }
 return suggestPost(job,clip);
}
export function overlayHook(speech){
 const quote=bestQuote(speech);
 if(!quote)return '';
 const words=quote.match(/[\p{L}\p{N}]+/gu)||[];
 const start=words.findIndex(w=>w.length>3);
 if(start<0)return '';
 const hook=words.slice(start>0&&start<3?start-1:start,(start>0&&start<3?start-1:start)+3).join(' ');
 return hook.includes(' ')?cut(hook,28).toLocaleUpperCase('pt-BR'):'';
}
export function postFields(platform,config,clip,number,suggestion){
 const custom=config.title?.replaceAll('{n}',number);
 const caption=suggestion?postText(suggestion):'';
 if(suggestion?.basis==='manual'){
  if(platform==='youtube'||platform==='facebook')return {title:suggestion.title,description:caption};
  return {title:caption||suggestion.title};
 }
 const combined=(prefix,max)=>{
  const room=Math.max(0,max-caption.length-2);
  const intro=prefix&&room>1?cut(prefix,room):'';
  return [intro,caption].filter(Boolean).join('\n\n').slice(0,max);
 };
 if(platform==='youtube'||platform==='facebook')return {title:custom?titleWithTags(custom,suggestion?.tags||clip.hashtags||[],true):suggestion?.title||titleWithTags(clip.title,clip.hashtags||[],true),description:combined(config.description,platform==='facebook'?2200:1250)||(platform==='facebook'?clip.description||clip.title:'')};
 return {title:combined(custom,2200)||clip.title};
}
