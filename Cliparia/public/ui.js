const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock=n=>[Math.floor(n/3600),Math.floor(n/60)%60,n%60].map(x=>String(x).padStart(2,'0')).join(':');
const labels={private:'Privado',public:'Público',unlisted:'Não listado',SELF_ONLY:'Somente eu',PUBLIC_TO_EVERYONE:'Público',MUTUAL_FOLLOW_FRIENDS:'Amigos',FOLLOWER_OF_CREATOR:'Seguidores'};
let state,last='',notice;
let refreshRequested=0,refreshApplied=0;
const collapsedClipLists=new Set();
const remoteReview=document.body.dataset.mobile==='remote';
const mobile=!!document.body.dataset.mobile||new URLSearchParams(location.search).get('mobile')==='1';
if(mobile&&!document.body.dataset.mobile)document.body.dataset.mobile='server';
async function apiResponse(response){
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Object.assign(Error(result.error||'Não foi possível concluir. Confira a conexão com o Cliparia.'),{status:response.status,reason:result.reason});
 return result;
}
async function api(name,b){
 const response=await fetch('/api/'+name,b?{method:'POST',headers:{'Content-Type':'application/json',...(remoteReview?{Prefer:'respond-async'}:{})},body:JSON.stringify(b)}:{});
 const result=await apiResponse(response);
 if(response.status!==202||!result.task)return result;
 const end=Date.now()+25*60_000;
 while(Date.now()<end){
  await new Promise(resolve=>setTimeout(resolve,2000));
  const status=await apiResponse(await fetch('/api/mobile/task/'+encodeURIComponent(result.task)));
  if(!status.pending)return status;
 }
 throw Error('A operação ainda está em andamento. Consulte o estado na fila.');
}
function msg(t){$('toast').textContent=t;$('toast').hidden=false;clearTimeout(notice);notice=setTimeout(()=>$('toast').hidden=true,6000);}
function modal(html){$('dialogbody').innerHTML=html+'<p class="error" id="err" role="alert"></p>';if(!$('modal').open)$('modal').showModal();}
function youtubeNotice(){const url=mobile?'https://m.youtube.com/terms':'https://www.youtube.com/t/terms';return 'Ao autorizar o envio, confirme que os vídeos cumprem os <a href="'+url+'" target="_blank" rel="noreferrer">Termos de Serviço e as Diretrizes da Comunidade do YouTube</a>. Respeite os direitos autorais e de privacidade de terceiros.';}
function report(e){if($('modal').open)$('err').textContent=e.message;else msg(e.message);}
function continuousTab(){return location.hash==='#continuo';}
function tab(){
 const a=!mobile&&location.hash==='#contas',c=continuousTab(),p=location.hash==='#publicados',q=location.hash==='#postagem';
 for(const [id,section,current] of [['accounts','links',a],['continuous-tab','continuous',c],['published-tab','published',p],['posting-tab','posting',q],['studio','desk',!a&&!c&&!p&&!q]]){
  $(section).hidden=!current;
  const button=$(id);
  button.classList.toggle('active',current);
  if(current)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
 }
 $(c?'continuous-entry':'studio-entry').append($('studio-form'));
 $('form-title').textContent=c?'Adicionar uma fonte':'Importar uma live ou VOD';
 $('follow-label').hidden=!c;$('live-blocks-label').hidden=true;
 $('count').closest('label').hidden=c;$('count').required=!c;$('count').disabled=c;
 $('count-label').textContent='Quantidade máxima';
 $('submit-source').textContent=c?'Adicionar fonte':'Gerar cortes';
 $('mode-info').textContent=c?'Gera todos os destaques identificados, sem limite total de cortes. VODs são verificados até o fim, em trechos de até 15 minutos. Lives continuam sendo analisadas enquanto houver transmissão.':'O Cliparia verifica trechos de até 15 minutos e avança enquanto ainda faltarem cortes.';
}
$('studio').onclick=()=>location.hash='estudio';$('continuous-tab').onclick=()=>location.hash='continuo';$('posting-tab').onclick=()=>location.hash='postagem';$('published-tab').onclick=()=>location.hash='publicados';$('accounts').onclick=()=>location.hash='contas';onhashchange=tab;tab();
$('close').onclick=()=>$('modal').close();
const name=p=>({drive:'Google Drive',youtube:'YouTube',tiktok:'TikTok',instagram:'Instagram',facebook:'Facebook',kwai:'Kwai'}[p]);
function renderPublished(clips,jobs){
 const pending=jobs.flatMap(job=>job.clips).find(clip=>Object.values(clip.posts).some(post=>post.id&&['Enviado','Em processamento','Confirmação pendente','Abra a caixa de entrada do TikTok'].includes(post.state)));
 $('published-clips').innerHTML=clips.map(clip=>{
  const platforms=Object.entries(clip.posts).map(([platform,post])=>{
   const label=esc(name(platform)||platform);
   return post.link?'<a href="'+esc(post.link)+'" target="_blank" rel="noopener noreferrer">'+label+'</a>':'<span>'+label+'</span>';
  });
  return '<article><h2>'+esc(clip.title||'Corte sem título')+'</h2>'+(clip.source?'<p>'+esc(clip.source)+'</p>':'')+'<div class="actions published-platforms">'+platforms.join('')+'</div></article>';
 }).join('')||'<div class="empty">'+(pending?'Há envios aguardando confirmação da plataforma.'+(pending.syncError?' '+esc(pending.syncError):''):'Nenhuma publicação confirmada ainda.')+'</div>';
}
function clipRow(job,clip,index){
 const key=esc(job.id+'/'+index);
 let controls='<button data-review="'+key+'">Revisar ↗</button>';
 if(clip.drive?.trashed){
  controls='<span class="status">Na lixeira do Drive</span><button data-drive-restore="'+key+'">Restaurar vídeo</button>';
 }else if(clip.drive?.removed){
  controls='<span class="status">Publicado · excluído do Drive</span>';
 }else if(clip.drive&&!remoteReview){
  controls+='<button data-drive-trash="'+key+'">Apagar do Drive</button>';
 }
 if(!clip.drive?.removed)controls+=isQueued(clip)?'<button data-open-queue>Ver na fila de postagem</button>':'<button data-queue-select="'+key+'">Selecionar para postagem</button>';
 return '<div class="clip"><time>'+clock(clip.start)+'</time><strong>'+esc(clip.title)+'</strong><span>'+clip.length+' s</span>'+controls+'</div>';
}
function isQueued(clip){return Number.isSafeInteger(clip.posting?.order)&&(clip.posting.recoveryReview===true||clip.posting.targets.some(p=>clip.posts[p]?.state!=='Publicado'));}
function postStatus(platform,post,key,check=false){
 const mode=platform==='tiktok'?({inbox:' · Celular',direct:' · Publicação direta'}[post.mode]||''):platform==='instagram'&&post.uploadMode==='hosted'?' · Link HTTPS':'';
 const label=platform==='tiktok'&&post.state==='Abra a caixa de entrada do TikTok'?(post.inboxMissing?'Notificação não localizada':'TikTok informou o envio da notificação'):post.state;
 return '<div class="status">'+esc(name(platform))+mode+' · '+esc(label)+' '+esc(post.detail||'')+
  (platform==='kwai'&&post.link?' <a href="'+esc(post.link)+'" target="_blank" rel="noopener noreferrer">Abrir no Kwai</a>':'')+
  (platform==='instagram'&&post.link?' <a href="'+esc(post.link)+'" target="_blank" rel="noopener noreferrer">Abrir no Instagram</a>':'')+
  (check&&platform==='tiktok'&&post.id&&['Em processamento','Abra a caixa de entrada do TikTok'].includes(post.state)?' <button data-status="'+esc(key)+'">Consultar envio</button>':'')+'</div>';
}
function renderClipList(job){
 if(!job.clips.length)return '';
 const rows=job.clips.map((clip,index)=>{
  const posts=Object.entries(clip.posts).map(([p,post])=>postStatus(p,post)).join('');
  return '<div class="clip-group">'+clipRow(job,clip,index)+(clip.excerpt?'<p class="excerpt">'+esc(clip.excerpt)+'</p>':'')+
   (clip.autoQueueNotice?'<p class="error">'+esc(clip.autoQueueNotice)+'</p>':'')+posts+'</div>';
 }).join('');
 return '<details class="disclosure clip-list"'+(collapsedClipLists.has(job.id)?'':' open')+'><summary data-clips-job="'+esc(job.id)+'">'+job.clips.length+(job.clips.length===1?' clipe':' clipes')+'</summary>'+rows+'</details>';
}
async function refresh(){
 const request=++refreshRequested;
 const next=await api('state');
 if(request<refreshApplied)return;
 refreshApplied=request;
 const serialized=JSON.stringify(next);if(serialized===last)return;state=next;last=serialized;
 const studioJobs=state.jobs.filter(j=>!j.continuousId),continuousJobs=state.jobs.filter(j=>j.continuousId);
 $('total').textContent=studioJobs.length+' no estúdio';
 $('clear-studio').hidden=remoteReview||!studioJobs.some(j=>!j.historyBusy);
 $('clear-continuous').hidden=remoteReview||!continuousJobs.some(j=>!j.historyBusy);
 $('continuous-total').textContent=continuousJobs.reduce((sum,j)=>sum+j.clips.length,0)+' cortes';
 renderContinuous(state.continuous);
 renderPosting();
 renderPublished(state.published||[],state.jobs);
 if(!mobile){
  $('model-status').textContent=state.hasModel?'Modelo de legendas instalado.':'';$('install-model').hidden=state.hasModel;
  $('prevent-duplicates').checked=state.preventDuplicates!==false;
  $('prevent-duplicates').disabled=typeof state.preventDuplicates!=='boolean';
 }
 const renderJobs=jobs=>jobs.map(j=>'<article><h3>'+esc(j.title)+'</h3>'+(j.stage?'<p>'+esc(j.stage)+'</p>':'')+(!mobile&&j.duplicatesSkipped?'<p>Trechos repetidos ignorados.</p>':'')+(!mobile&&j.count?progressView(j):'')+(remoteReview?'':j.running?'<button data-stop="'+esc(j.id)+'"'+(j.stopRequested?' disabled':'')+'>'+(j.stopRequested?'Parando…':'Parar clipagem')+'</button>':!j.historyBusy?'<button data-remove-history="'+esc(j.id)+'">Apagar do histórico</button>':'')+renderClipList(j)+'</article>').join('');
 $('jobs').innerHTML=renderJobs(studioJobs)||'<div class="empty">Os cortes do Estúdio aparecem aqui.</div>';
 $('continuous-jobs').innerHTML=renderJobs(continuousJobs)||'<div class="empty">Os cortes das fontes da fila aparecem aqui.</div>';
 for(const button of document.querySelectorAll('[data-review]')){
  const [id,index]=button.dataset.review.split('/'),clip=state.jobs.find(j=>j.id===id)?.clips[index];
  if(!clip)continue;
  const notice=document.createElement('p');notice.textContent=safetyLabel(clip);
  button.parentElement.after(notice);
 }
 for(const container of [$('jobs'),$('continuous-jobs')]){
  const list=container===$('jobs')?studioJobs:continuousJobs;
  [...container.querySelectorAll('article')].forEach((article,index)=>{
   const blocked=list[index]?.blockedClips||[];
   if(!blocked.length)return;
   const notice=document.createElement('p');notice.textContent=blocked.length+' trechos não liberados pela proteção de conteúdo. '+blocked.at(-1).safety.reason;
   article.querySelector('h3').after(notice);
  });
 }
 $('providers').innerHTML=Object.entries(state.accounts).map(([p,a])=>{
  if(['instagram','facebook'].includes(p)){
   const description=a.reconnectReason==='instagram_account_access_denied'?'A Meta recusou o acesso do app a este perfil (código 200).':
    a.needsReconnect?'Autorização expirada. Reconecte para retomar os envios.':
    a.connected?esc(a.account)+(a.durable?' · token de longa duração':''):p==='facebook'?'Página · Reels públicos':'Conta profissional · Reels';
   const check=p==='instagram'&&a.configured?'<button data-instagram-check>Verificar conexão</button>':'';
   const disconnect=a.configured?'<button data-disconnect="'+p+'">Desconectar</button>':'';
   return '<article class="provider"><div><h2>'+name(p)+'</h2><p>'+description+'</p></div><div class="actions"><button class="action" data-meta-connect="'+p+'">'+(a.configured?'Reconectar':'Conectar '+name(p))+'</button>'+check+disconnect+'</div></article>';
  }
  return '<article class="provider"><div><h2>'+name(p)+'</h2><p>'+(a.connected?(a.account?esc(a.account):'Conexão salva neste Windows')+(p==='tiktok'?' · '+tiktokAccessText(a):''):a.configured?'Credenciais configuradas':'Configure o aplicativo para conectar seu perfil')+'</p></div><div class="actions"><button data-config="'+p+'">Configurar</button><button class="action" data-'+(a.connected?'disconnect':'login')+'="'+p+'">'+(a.connected?'Desconectar':'Conectar conta')+'</button>'+(a.connected&&p==='tiktok'?'<button data-login="tiktok">Alterar permissões</button>':'')+'</div></article>';
 }).join('');
}
function progressView(j){
 const progress=j.progress;
 const bar=j.running||progress===100?'<progress aria-label="Progresso da clipagem" max="100"'+(progress==null?'':' value="'+progress+'"')+'></progress>':'';
 const count=j.continuousId||j.liveBlocks?j.clips.length+' cortes prontos':j.clips.length+' de até '+j.count+' cortes prontos';
 return bar+'<p>'+count+'</p>';
}
function safetyLabel(clip){
 const labels={approved:'Verificação concluída: nenhum indício detectado nas amostras.',blocked:'Envio bloqueado',error:'Verificação incompleta · envio bloqueado',checking:'Verificando conteúdo…'};
 return clip.safety?(labels[clip.safety.status]||'Verificação pendente')+(clip.safety.status==='blocked'||clip.safety.status==='error'?' · '+clip.safety.reason:''):'Conteúdo ainda não verificado. O envio exige verificação.';
}
function canRetryPost(post){return !post||post.state==='Falhou'||!post.id&&['Aguardando reconexão do Instagram','Aguardando conexão com o Instagram','Aguardando link do Instagram','Aguardando vaga no TikTok'].includes(post.state);}
function tiktokAccessText(account){
 const scopes=account.scopes.split(/[ ,]+/);
 return [scopes.includes('video.upload')?'Envio ao celular autorizado':'Envio ao celular pendente',scopes.includes('video.publish')?'Publicação direta autorizada':''].filter(Boolean).join(' · ');
}
const postingPlatforms=['youtube','tiktok','instagram','facebook','kwai'];
function configureAutomatic(){
 const configs=state.posting.configs;
 const platforms=state.posting.platforms??['youtube','instagram','facebook'];
 const options=platforms.map(p=>'<option value="'+p+'"'+(!state.accounts[p]?.connected&&!configs[p]?' disabled':'')+'>'+name(p)+(p==='tiktok'?' · Caixa de entrada':'')+(configs[p]?' · configurado':'')+'</option>').join('');
 modal('<h2>Configurar postagem automática</h2><p>No TikTok, a fila envia os cortes autorizados à caixa de entrada. Você conclui a publicação no aplicativo.</p><form id="enable-auto" class="stack"><label>Plataforma<select name="platform" required><option value="">Selecione uma plataforma</option>'+options+'</select></label><div id="enable-auto-options" class="stack"></div><div class="actions"><button class="action" disabled>Salvar configuração</button><button type="button" id="disable-auto" hidden>Desativar nesta plataforma</button></div></form>');
 const form=$('enable-auto'),select=form.elements.platform,detail=$('enable-auto-options'),button=form.querySelector('button'),disable=$('disable-auto');
 let account,request=0;
 select.onchange=async()=>{
  const platform=select.value,current=++request;
  disable.hidden=!configs[platform];
  account=null;button.disabled=true;detail.textContent=platform?'Consultando a conta…':'';
  if(!platform)return;
  try{
   const who=await api('creator',{platform,...(platform==='tiktok'?{mode:'inbox'}:{})});
   if(current!==request||!form.isConnected)return;
   account=who;
   if(platform==='tiktok'){
    detail.innerHTML='<p>'+esc(who.creator_nickname)+'</p><label><input name="consent" type="checkbox" required> Ativar o envio à caixa de entrada para os cortes que eu autorizar na fila.</label>';
    button.disabled=false;
    return;
   }
   const config=configs[platform];
   const youtube=platform==='youtube',facebook=platform==='facebook';
   detail.innerHTML='<p>'+esc(who.creator_nickname)+'</p>'+(youtube?'<label>Visibilidade<select name="privacy" required><option value="">Selecione</option><option value="private">Privado</option><option value="unlisted">Não listado</option><option value="public">Público</option></select></label><label>Conteúdo para crianças<select name="kids" required><option value="">Selecione</option><option value="yes">Sim</option><option value="no">Não</option></select></label><p>'+youtubeNotice()+'</p>':'')+
    '<label>'+(youtube||facebook?'Título padrão':'Legenda padrão')+'<input name="title" maxlength="'+(youtube||facebook?100:2200)+'" placeholder="Opcional · use {n} para numerar os cortes"></label>'+(youtube||facebook?'<label>Descrição padrão<textarea name="description" maxlength="'+(youtube?1250:2200)+'"></textarea></label>':'')+
    '<label><input name="consent" type="checkbox" required> Autorizo '+(facebook?'a publicação pública automática':'o envio automático')+' dos cortes que eu colocar na fila para a conta exibida.</label>';
   if(config?.channel===who.channel_id){
    form.elements.title.value=config.title||'';
    if(form.elements.description)form.elements.description.value=config.description||'';
    if(youtube){form.elements.privacy.value=config.privacy;form.elements.kids.value=config.kids?'yes':'no';}
   }
   button.disabled=false;
  }catch(error){if(current===request&&form.isConnected)detail.textContent=error.message;}
 };
 disable.onclick=async()=>{
  const platform=select.value;
  disable.disabled=true;
  try{await api('posting/disable-platform',{platform});$('modal').close();await refresh();msg('Postagem automática desativada no '+name(platform)+'.');}
  catch(error){report(error);}
  finally{disable.disabled=false;}
 };
 form.onsubmit=async event=>{
  event.preventDefault();
  if(!account)return;
  const fields=new FormData(form),platform=fields.get('platform'),kids=fields.get('kids');
  button.disabled=select.disabled=true;
  try{
   await api('posting/configure',{platform,channel:account.channel_id,privacy:platform==='facebook'?'public':fields.get('privacy'),kids:kids===null?null:kids==='yes',title:fields.get('title'),description:fields.get('description'),consent:fields.has('consent')});
   if(form.isConnected)$('modal').close();
   await refresh();msg('Configuração salva para '+name(platform)+'.');
  }catch(error){report(error);}
  finally{button.disabled=select.disabled=false;}
 };
}
function selectForPosting(job,index,clip){
 const selected=clip.posting?.targets??['youtube',...(job.targets||[]),...(clip.extraTargets||[])];
 const channel=state.posting?.configs.tiktok?.channel;
 const account=state.accounts.tiktok;
 const inboxAvailable=!!channel&&account?.connected&&account.inboxAccount===channel&&account.scopes?.split(/[ ,]+/).includes('video.upload')&&canRetryPost(clip.posts.tiktok);
 const revision=clip.revision||0;
 const inboxChecked=clip.posting?.tiktokInbox?.channel===channel&&clip.posting?.tiktokInbox?.revision===revision;
 const targets=postingPlatforms.filter(p=>p!=='facebook'||clip.length<=90).map(p=>'<label><input type="checkbox" name="targets" value="'+p+'"'+(selected.includes(p)?' checked':'')+'> '+name(p)+(p==='kwai'||p==='tiktok'&&!inboxAvailable?' · manual':p==='youtube'?' · automático':'')+'</label>').join('');
 const inbox=inboxAvailable?'<div id="tiktok-inbox-permission" hidden><video controls preload="none" src="/video/'+esc(job.id)+'/'+index+'?v='+revision+'"></video><label><input type="checkbox" name="tiktokInbox"'+(inboxChecked?' checked':'')+'> Autorizo enviar este corte automaticamente à caixa de entrada da conta TikTok conectada.</label></div>':'';
 modal('<h2>Destinos do corte</h2><p>'+esc(clip.title)+'</p><form id="select-posting" class="stack"><fieldset class="destinations"><legend>Onde você quer postar?</legend><div class="actions">'+targets+'</div>'+inbox+'</fieldset>'+(clip.length>90?'<p>O Facebook aceita cortes de até 90 segundos.</p>':'')+'<p>O Cliparia exclui o vídeo do Drive após confirmar a publicação em todos os destinos escolhidos.</p><button class="action">'+(isQueued(clip)?'Salvar destinos':'Verificar e adicionar à fila')+'</button><p id="posting-safety-progress" role="status" hidden></p></form>');
 const form=$('select-posting'),progress=$('posting-safety-progress'),fields=form.querySelector('fieldset');
 if(inboxAvailable){
  const target=fields.querySelector('[value="tiktok"]'),permission=$('tiktok-inbox-permission');
  const show=()=>{permission.hidden=!target.checked;form.elements.tiktokInbox.disabled=!target.checked;};
  target.onchange=show;show();
 }
 const isOpen=()=>form.isConnected&&$('modal').open;
 form.onsubmit=async event=>{
  event.preventDefault();
  const button=event.submitter;
  const selection=new FormData(event.currentTarget),targets=selection.getAll('targets');
  if(!targets.length){report(Error('Escolha pelo menos um destino.'));return;}
  button.disabled=fields.disabled=true;
  $('err').textContent='';
  progress.textContent=isQueued(clip)?'Validando o corte e os destinos…':'Verificando imagens, falas e textos do corte…';
  progress.hidden=false;
  try{
   await api('posting/add',{job:job.id,index,revision,targets,tiktokInbox:selection.has('tiktokInbox'),tiktokAccount:channel});
   if(isOpen())$('modal').close();
   await refresh();
   const saved=state.jobs.find(j=>j.id===job.id)?.clips[index];
   msg(saved&&isQueued(saved)?'Seleção salva na fila de postagem.':'Já publicado nos destinos selecionados.');
  }catch(error){
   if(isOpen())report(error);else msg(error.message);
   await refresh().catch(()=>{});
  }
  finally{button.disabled=fields.disabled=false;progress.hidden=true;}
 };
}
$('new').onsubmit=async e=>{
 e.preventDefault();
 const button=e.submitter;
 button.disabled=true;
 try{
  const queued=continuousTab();
  await api(queued?'continuous/add':'analyze',{follow:queued&&$('follow-source').checked,liveBlocks:queued&&$('live-blocks').checked,url:$('url').value.trim(),count:Number($('count').value),duration:Number($('duration').value),frame:$('frame').value,captions:$('captions').checked,writePosts:$('write-posts').checked,language:$('language').value});
  if(queued)msg('Fonte adicionada.');$('follow-source').checked=false;$('live-blocks').checked=false;
  $('url').value='';await refresh();
 }catch(e){if(/modelo de (transcrição|legendas)/i.test(e.message))$('transcription-settings').open=true;report(e);}finally{button.disabled=false;}
};
async function editQueueCopy(key){
 const [job,index]=key.split('/');
 const clip=state.jobs.find(item=>item.id===job)?.clips[index];
 if(!clip)return;
 const selection={job,index,revision:clip.revision||0,version:clip.postDraftVersion||0};
 modal('<h2>Editar texto da publicação</h2><p>As alterações valem para os próximos envios deste corte.</p><form id="queue-copy-form" class="stack"><label>Título<input name="title" maxlength="100" required></label><label>Legenda<textarea name="text" maxlength="1250" rows="5"></textarea></label><label>Hashtags<input name="tags" placeholder="#gta6 #rockstar" maxlength="1200"></label><div class="actions"><button class="action" type="submit">Salvar texto</button><button type="button" id="reset-queue-copy">Usar texto automático</button></div></form>');
 const form=$('queue-copy-form'),reset=$('reset-queue-copy');
 function fill(copy){
  form.elements.title.value=copy.title.replace(/#[\p{L}\p{N}_]+/gu,'').trim();
  form.elements.text.value=copy.text;
  form.elements.tags.value=copy.tags.join(' ');
 }
 reset.hidden=!clip.postDraft;
 if(clip.postDraft)fill(clip.postDraft);
 else{
  form.inert=true;
  try{
   const copy=await api('post-copy',selection);
   if(!form.isConnected)return;
   fill(copy);
  }finally{form.inert=false;}
 }
 async function save(reset=false){
  const buttons=[...form.querySelectorAll('button')];
  const fields=Object.fromEntries(new FormData(form));
  buttons.forEach(button=>button.disabled=true);
  try{
   await api('posting/copy',{...selection,...fields,reset});
   $('modal').close();await refresh();
   msg(reset?'Texto automático restaurado.':'Texto salvo para os próximos envios.');
  }catch(error){report(error);}
  finally{buttons.forEach(button=>button.disabled=false);}
 }
 form.onsubmit=e=>{e.preventDefault();void save();};
 reset.onclick=()=>void save(true);
}
$('restore-backup').onclick=()=>{
 modal('<h2>Restaurar backup</h2><p>O Cliparia importa os dados do arquivo para o histórico atual. Se houver cortes novos para postar, o envio automático fica pausado para revisão.</p><form class="stack" id="backup-form"><label>Arquivo JSON do Cliparia<input name="backup" type="file" accept=".json,application/json" required></label><button class="action">Restaurar</button></form>');
 $('backup-form').onsubmit=async event=>{
  event.preventDefault();
  const file=event.currentTarget.elements.backup.files[0],button=event.submitter;
  if(!file)return;
  button.disabled=true;
  try{
   if(file.size>32*1024*1024)throw Error('O arquivo de backup excede 32 MB.');
   const response=await fetch('/api/backup/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:file});
   const result=await apiResponse(response);
   $('modal').close();await refresh();
   msg('Backup restaurado. '+result.clips+' cortes recuperados · '+result.queued+' adições à fila.');
  }catch(error){report(error);}
  finally{button.disabled=false;}
 };
};
document.addEventListener('click',async e=>{
 const summary=e.target.closest('summary[data-clips-job]');
 if(summary){
  if(summary.parentElement.open)collapsedClipLists.add(summary.dataset.clipsJob);
  else collapsedClipLists.delete(summary.dataset.clipsJob);
 }
 const d=e.target.dataset;
 try{
 if(d.postEdit){await editQueueCopy(d.postEdit);return;}
 if(d.openAccounts!==undefined){location.hash='contas';return;}
 if(d.configureQueue!==undefined){configureAutomatic();return;}
 if(d.instagramCheck!==undefined){
  const button=e.target;
  button.disabled=true;
  try{await api('instagram/check',{});msg('A Meta confirmou o perfil do Instagram.');}
  finally{button.disabled=false;await refresh();}
 }
 if(d.metaConnect==='instagram'){
  modal(`<h2>Conectar Instagram</h2>
   <form class="stack" id="ig-connect">
    <label>ID da conta profissional<input id="ig-id" inputmode="numeric" pattern="[0-9]+" value="${esc(state.accounts.instagram.profileId)}" required></label>
    <label>Tipo de conexão<select id="ig-mode"><option value="durable">Gerar token de longa duração</option><option value="page">Usar token da Página já gerado</option></select></label>
    <fieldset id="ig-meta-app">
     <legend>Aplicativo no Meta for Developers</legend>
     <p>Em Configurações do app → Básico, copie o ID e o segredo do app. O Cliparia usa o segredo para a troca com a Meta e salva só a autorização da Página.</p>
     <label>ID do app da Meta<input id="ig-app-id" inputmode="numeric" pattern="[0-9]+" required></label>
     <label>Segredo do app da Meta<input type="password" id="ig-app-secret" maxlength="32" autocomplete="off" required></label>
     <label>ID da Página do Facebook (opcional)<input id="ig-page-id" inputmode="numeric" pattern="[0-9]+" autocomplete="off"></label>
    </fieldset>
    <p id="ig-token-help"></p>
    <label><span id="ig-token-label"></span><input type="password" id="ig-token" maxlength="5000" autocomplete="off" required></label>
    <button class="action">Validar e conectar</button>
   </form>`);
  const durable=()=>$('ig-mode').value==='durable';
  const showMode=()=>{
   const long=durable();
   $('ig-meta-app').hidden=$('ig-meta-app').disabled=!long;
   $('ig-token-label').textContent=long?'Token novo de usuário da Meta':'Token da Página vinculada';
   $('ig-token-help').textContent=long
    ?'Gere um token de usuário novo no Explorador da Graph API do mesmo app, com instagram_basic, instagram_content_publish, pages_show_list e pages_read_engagement. Selecione a Página vinculada ao seu Instagram.'
    :'Use o token da Página gerado a partir de um token de usuário de longa duração. Confira a validade no depurador da Meta.';
  };
  $('ig-mode').onchange=showMode;
  showMode();
  $('ig-connect').onsubmit=async ev=>{
   ev.preventDefault();ev.submitter.disabled=true;
   const secret=$('ig-app-secret'),token=$('ig-token');
   try{
    const credentials=durable()?{appId:$('ig-app-id').value,appSecret:secret.value,pageId:$('ig-page-id').value}:{};
    await api('instagram/connect',{id:$('ig-id').value,token:token.value,...credentials});
    token.value='';$('modal').close();await refresh();
   }catch(error){report(error);}
   finally{secret.value='';ev.submitter.disabled=false;}
  };
 }
 if(d.metaConnect==='facebook'){
  modal('<h2>Conectar Facebook</h2><p>Conecte a Página onde os Reels serão públicos. No Meta, autorize pages_manage_posts, pages_read_engagement e pages_show_list e gere um novo token com acesso à Página.</p><form class="stack" id="fb-connect"><label>ID da Página do Facebook<input id="fb-id" inputmode="numeric" pattern="[0-9]+" required></label><label>Token de usuário ou da Página<input type="password" id="fb-token" autocomplete="off"></label><p>Deixe o token vazio para tentar usar a autorização já salva do Instagram. Ela precisa incluir a permissão de publicar na Página.</p><button class="action">Validar e conectar</button></form>');
  $('fb-connect').onsubmit=async ev=>{ev.preventDefault();ev.submitter.disabled=true;try{
   await api('facebook/connect',{id:$('fb-id').value,token:$('fb-token').value});$('modal').close();await refresh();
  }catch(error){report(error);ev.submitter.disabled=false;}};
 }
 if(d.config){modal('<h2>Configurar '+name(d.config)+'</h2><p>'+(d.config==='drive'?'Ative Google Drive API no Google Cloud e informe as credenciais OAuth Desktop. Ao conectar, selecione o Gmail que guardará os cortes.':d.config==='youtube'?'Use um cliente OAuth do tipo Desktop no Google Cloud com YouTube Data API v3 habilitada.':'Use um aplicativo Desktop no TikTok for Developers com Login Kit e Content Posting API (Upload ou Direct Post). Cadastre http://127.0.0.1:43871/oauth/callback como redirecionamento.')+'</p><form class="stack" id="cfg"><label>Client ID / Client Key<input id="cid" required></label><label>Client Secret<input type="password" id="secret" required></label><button class="action">Salvar credenciais</button></form>');
 $('cfg').onsubmit=async e=>{e.preventDefault();try{await api('config',{platform:d.config,id:$('cid').value,secret:$('secret').value});$('modal').close();await refresh();}catch(e){report(e);}};}
 if(d.removeSource){await api('continuous/remove',{id:d.removeSource});await refresh();}
 if(Object.hasOwn(d,'openQueue')){if($('modal').open)$('modal').close();location.hash='postagem';}
 if(d.queueSelect||d.queueRemove){
  const [id,index]=(d.queueSelect||d.queueRemove).split('/');
  const job=state.jobs.find(j=>j.id===id),clip=job?.clips[index];
  if(!clip)return;
  if(d.queueSelect)selectForPosting(job,Number(index),clip);
  else{
   await api('posting/remove',{job:id,index:Number(index),revision:clip.revision||0});
   await refresh();msg('Corte retirado da fila de postagem.');
  }
 }
 if(d.youtubeRetry){
  const [id,index]=d.youtubeRetry.split('/');
  const clip=state.jobs.find(job=>job.id===id)?.clips[index];
  if(!clip)return;
  if(clip.youtubeReview?.candidates?.length&&!confirm('Confira o possível vídeo repetido. Você quer liberar o envio automático deste corte?'))return;
  await api('posting/retry-youtube',{job:id,index:Number(index),revision:clip.revision||0,consent:true});
  await refresh();msg('Corte disponível para postagem automática no YouTube.');
 }
 if(d.stop){await api('stop',{job:d.stop});await refresh();msg('Parando a clipagem. O envio ao Drive já iniciado pode terminar.');}
 if(d.removeHistory&&confirm('Apagar esta tarefa do histórico do Cliparia? Os arquivos já salvos no Drive serão mantidos.')){
  await api('history/remove',{job:d.removeHistory});await refresh();msg('Tarefa apagada do histórico.');
 }
 if(d.clearHistory&&confirm('Limpar as tarefas encerradas desta aba? Os arquivos já salvos no Drive serão mantidos.')){
  const r=await api('history/clear',{scope:d.clearHistory});await refresh();msg(r.removed+' registro(s) apagado(s).'+(r.kept?' Tarefas em andamento ou com cortes na fila foram mantidas.':''));
 }
 if(d.driveTrash||d.driveRestore){
  const [job,index]=(d.driveTrash||d.driveRestore).split('/');
  const clip=state.jobs.find(j=>j.id===job)?.clips[index];
  if(!clip)return;
  const restore=!!d.driveRestore;
  const question=restore
   ?'Restaurar “'+clip.title+'” do Drive? Envios automáticos já autorizados poderão ser retomados.'
   :'Mover “'+clip.title+'” para a lixeira do Drive? O corte ficará indisponível no Cliparia enquanto estiver lá.';
  if(!confirm(question))return;
  const button=e.target;
  button.disabled=true;
  try{
   await api('drive/'+(restore?'restore':'trash'),{job,index:Number(index),revision:clip.revision||0,consent:true});
   msg(restore?'Vídeo restaurado.':'Vídeo movido para a lixeira do Drive.');
   await refresh();
  }finally{button.disabled=false;}
 }
 if(d.login==='tiktok'){
  modal('<h2>Conectar TikTok</h2><p>Escolha as permissões habilitadas no seu aplicativo TikTok.</p><form class="stack" id="ttlogin"><label>Modo de envio<select id="ttmode"><option value="inbox">Finalizar no celular · video.upload</option><option value="direct">Publicar diretamente · video.publish</option><option value="both">Usar os dois modos</option></select></label><button class="action">Autorizar no TikTok</button></form>');
  $('ttlogin').onsubmit=async e=>{e.preventDefault();try{location.href=(await api('login',{platform:'tiktok',mode:$('ttmode').value})).url;}catch(e){report(e);}};
 }else if(d.login)location.href=(await api('login',{platform:d.login})).url;
 if(d.disconnect){await api('disconnect',{platform:d.disconnect});await refresh();}
 if(d.status){
  const [job,index]=d.status.split('/');
  const {post}=await api('status',{platform:'tiktok',job,index});
  await refresh();
  if(post?.state==='Abra a caixa de entrada do TikTok')msg(post.inboxMissing?'O TikTok ainda informa que enviou a notificação.':'O TikTok informou o envio da notificação.');
  else if(post)msg('TikTok · '+post.state);
 }
 if(d.review||d.postReview){
 const [job,index]=(d.review||d.postReview).split('/'),project=state.jobs.find(j=>j.id===job),c=project.clips[index],revision=c.revision||0,src='/video/'+job+'/'+index+'?v='+revision;
 const forPosting=!!d.postReview;
 const targets=forPosting?c.posting?.targets||[]:[];
 const allowed=p=>targets.includes(p);
 const kwaiPending=targets.includes('kwai')&&!c.posts.kwai;
 const igPost=c.posts.instagram;
 const instagramHandoff=allowed('instagram')&&igPost?.state==='Falhou'&&(igPost.uploadMode==='hosted'||igPost.reason==='instagram_upload_processing_failed');
 const ttPost=c.posts.tiktok;
 const inboxNotified=allowed('tiktok')&&ttPost?.id&&ttPost.state==='Abra a caixa de entrada do TikTok';
 const inboxHelp=inboxNotified?'<button id="tiktok-inbox-help">'+(ttPost.inboxMissing?'Baixar para o TikTok':'Não recebi a notificação')+'</button>':'';
 const tiktokScopes=state.accounts.tiktok.scopes.split(/[ ,]+/);
 const canUseTikTok=allowed('tiktok')&&state.accounts.tiktok.connected&&canRetryPost(c.posts.tiktok);
 const inboxButton=canUseTikTok?(tiktokScopes.includes('video.upload')?'<button id="inbox">Finalizar no TikTok</button>':mobile?'':'<button data-login="tiktok">Autorizar envio ao celular</button>'):'';
 let copy;
 const writer=async()=>{
  copy??=await api('post-copy',{job,index,revision});
  return [copy.text,copy.tags.join(' ')].filter(Boolean).join('\n\n');
 };
 const fillCopy=async(field,force=false,titleField)=>{
  try{
   const old=field.value;
   const oldTitle=titleField?.value;
   const text=await writer();
   if(field.isConnected&&(force||field.value===old))field.value=text.slice(0,field.maxLength);
   if(titleField?.isConnected&&(force||titleField.value===oldTitle))titleField.value=copy.title.slice(0,titleField.maxLength);
  }catch(error){report(error);}
 };
 const handoff=()=>{
  $('copy-handoff').onclick=async()=>{
   try{await navigator.clipboard.writeText($('handoff-text').value);msg('Legenda e hashtags copiadas.');}
   catch{$('handoff-text').select();msg('Selecione e copie a legenda para colar no aplicativo.');}
  };
  fillCopy($('handoff-text'));
 };
 const destinations=['tiktok','instagram','facebook'].filter(allowed).map(p=>{
  const disabled=p==='tiktok'?(!canUseTikTok||!tiktokScopes.includes('video.publish')):(!allowed(p)||!state.accounts[p].connected||!canRetryPost(c.posts[p]));
  const label=p==='tiktok'?'TikTok · Publicação direta':name(p);
  return '<button data-dest="'+p+'" '+(disabled?'disabled':'')+'>'+label+'</button>';
 }).join('');
 const controls=forPosting?destinations+inboxButton+inboxHelp+(kwaiPending?'<button id="kwai-manual">Publicar no Kwai</button>':'')+(instagramHandoff?'<button id="instagram-manual">Baixar para o Instagram</button>':''):isQueued(c)?'<button data-open-queue>Ver na fila de postagem</button>':'<button class="action" data-queue-select="'+esc(d.review)+'">Selecionar para postagem</button>';
 modal('<h2>'+esc(c.title||'Revisar corte')+'</h2><p>'+clock(c.start)+' – '+clock(c.start+c.length)+'</p><video controls src="'+src+'"></video><div class="stack"><div class="actions">'+controls+'</div><div id="opts"></div></div>');
 const safetyNote=document.createElement('p');safetyNote.textContent=safetyLabel(c);
 const check=document.createElement('button');check.type='button';check.textContent='Verificar conteúdo';
 $('dialogbody').querySelector('video').after(safetyNote,check);
 if(allowed('youtube')){
  const note=document.createElement('p');note.textContent='O YouTube publica automaticamente pela fila.';
  check.after(note);
 }
 check.onclick=async()=>{
  check.disabled=true;safetyNote.textContent='Verificando imagens e falas…';
  try{const result=await api('safety/check',{job,index,revision});c.safety=result.safety;safetyNote.textContent=safetyLabel(c);await refresh();}
  catch(error){report(error);}finally{check.disabled=false;}
 };
 if(instagramHandoff)$('instagram-manual').onclick=()=>{
  const opts=$('opts');opts.dataset.request='instagram-manual';
  opts.innerHTML='<p>Baixe o vídeo, copie a legenda e crie o Reel no aplicativo do Instagram.</p><a class="download" href="'+src+'&download=1" download>Baixar MP4</a><label>Legenda e hashtags<textarea id="handoff-text" maxlength="2200"></textarea></label><button type="button" id="copy-handoff">Copiar legenda e hashtags</button>'+(state.accounts.instagram.connected?'<form id="instagram-confirm" class="stack"><label>Link do Reel publicado<input id="instagram-link" type="url" placeholder="https://www.instagram.com/reel/..." required></label><button class="action" type="submit">Conferir e registrar publicação</button></form>':'');
  handoff();
  if($('instagram-confirm'))$('instagram-confirm').onsubmit=async event=>{
   event.preventDefault();const button=event.submitter;button.disabled=true;
   try{
    await api('instagram/confirm',{job,index,revision,link:$('instagram-link').value.trim(),consent:true});
    $('modal').close();msg('Reel confirmado no Instagram.');await refresh();
   }catch(error){report(error);}
   finally{button.disabled=false;}
  };
 };
 if(kwaiPending){
  $('kwai-manual').onclick=()=>{
   const opts=$('opts');
   opts.dataset.request='kwai';
   opts.innerHTML='<form id="kwai-confirm" class="stack"><p>Baixe o clipe e publique no app do Kwai. Depois copie o link do vídeo publicado e cole aqui.</p><a class="button" href="'+src+'&download=1" download>Baixar MP4 para o Kwai</a><label>Legenda e hashtags<textarea id="handoff-text" maxlength="2200"></textarea></label><button type="button" id="copy-handoff">Copiar legenda e hashtags</button><label>Link do vídeo publicado<input id="kwai-link" type="url" placeholder="https://www.kwai.com/..." required></label><label><input type="checkbox" id="kwai-consent" required> Confirmei a publicação no Kwai. Se os outros destinos já estiverem publicados, o Cliparia poderá excluir o arquivo do Drive.</label><button class="action">Confirmar publicação no Kwai</button></form>';
   handoff();
   $('kwai-confirm').onsubmit=async ev=>{ev.preventDefault();ev.submitter.disabled=true;try{
    await api('kwai/confirm',{job,index,revision,link:$('kwai-link').value.trim(),consent:$('kwai-consent').checked});
    $('modal').close();msg('Publicação no Kwai registrada.');await refresh();
   }catch(error){report(error);ev.submitter.disabled=false;}};
  };
 }

 if(!forPosting&&!mobile&&c.drive&&c.length>40&&Object.values(c.posts).every(p=>p.state==='Falhou'))addTrim(job,index,c);
 if(inboxNotified)$('tiktok-inbox-help').onclick=async event=>{
  const button=event.currentTarget,opts=$('opts');
  opts.dataset.request='tiktok-inbox-help';
  if(!ttPost.inboxMissing){
   button.disabled=true;
   try{
    await api('tiktok/inbox-missing',{job,index,revision,receipt:ttPost.id});
    ttPost.inboxMissing=true;button.textContent='Baixar para o TikTok';
    await refresh();
   }catch(error){report(error);return;}finally{button.disabled=false;}
  }
  if(!opts.isConnected||opts.dataset.request!=='tiktok-inbox-help')return;
  opts.innerHTML='<p>O TikTok informou que enviou a notificação. Se ela continuar ausente, baixe o vídeo e a legenda para usar no aplicativo.</p><a class="download" href="'+src+'&download=1" download>Baixar MP4</a><label>Legenda e hashtags<textarea id="handoff-text" maxlength="2200"></textarea></label><button type="button" id="copy-handoff">Copiar legenda e hashtags</button>';
  handoff();
 };
 if($('inbox'))$('inbox').onclick=()=>{
  const opts=$('opts');opts.dataset.request='inbox';
  opts.innerHTML='<p>O vídeo será enviado à caixa de entrada da conta TikTok conectada. Abra a notificação no celular para editar a legenda, escolher o público e publicar. Copie o texto antes de enviar o rascunho.</p><label>Legenda e hashtags<textarea id="handoff-text" maxlength="2200"></textarea></label><button type="button" id="copy-handoff">Copiar legenda e hashtags</button><button id="senddraft" class="action">Enviar para a caixa de entrada</button>';
  handoff();
  $('senddraft').onclick=async e=>{e.target.disabled=true;try{await api('publish',{platform:'tiktok',mode:'inbox',consent:true,job,index,revision});$('modal').close();msg('Vídeo transferido. Acompanhe a confirmação do TikTok na fila.');await refresh();}catch(err){report(err);e.target.disabled=false;await refresh();}};
 };
 if(forPosting&&c.posts.tiktok?.mode!=='inbox'&&(c.posts.tiktok?.reason==='unaudited_client_can_only_post_to_private_accounts'||/unaudited_client_can_only_post_to_private_accounts/i.test(c.posts.tiktok?.detail||''))){
  const notice=document.createElement('p');notice.textContent='O TikTok bloqueou a publicação direta deste aplicativo sem auditoria. Nesse modo, são exigidas conta privada e visibilidade Somente eu. Para concluir no aplicativo TikTok, use Finalizar no TikTok com video.upload autorizado.';
  safetyNote.after(notice);
 }
 if(forPosting&&targets.length&&!kwaiPending&&!targets.some(p=>state.accounts[p]?.connected))$('opts').textContent='Conecte um perfil na aba Contas para publicar.';
 for(const btn of document.querySelectorAll('[data-dest]'))btn.onclick=async()=>{
 const p=btn.dataset.dest;const opts=$('opts');opts.textContent='Consultando perfil…';const key=opts.dataset.request=String(Math.random());
 try{const who=await api('creator',{platform:p});if(opts.dataset.request!==key)return;
 opts.innerHTML='<form class="stack" id="publish"><strong>'+name(p)+' · '+esc(who.creator_nickname)+'</strong>'+(['youtube','facebook'].includes(p)?'<label>Título<input id="caption" maxlength="100" required value="'+esc(c.title.slice(0,100))+'"></label>':'<label>Legenda<textarea id="caption" maxlength="2200">'+esc(c.title)+'</textarea></label>')+'<button type="button" id="suggest-post">Gerar legenda e hashtags</button>'+(p==='facebook'?'<p>Reel público na Página acima · até 90 segundos.</p><label>Visibilidade<select id="privacy" required><option value="">Escolha uma opção</option><option value="public">Público</option></select></label>':p==='instagram'?'<p>O vídeo será publicado como Reel nesta conta.</p>':'<label>Visibilidade<select required id="privacy"><option value="">Escolha uma opção</option>'+who.privacy_level_options.map(x=>'<option value="'+esc(x)+'">'+esc(labels[x]||x)+'</option>').join('')+'</select></label>')+ (p==='instagram'?'':['youtube','facebook'].includes(p)?'<label>Descrição<textarea id="desc" maxlength="2200"></textarea></label>'+(p==='youtube'?'<label><input id="kids" type="checkbox"> Conteúdo para crianças</label>':''):[['comment','Comentários',who.comment_disabled],['duet','Dueto',who.duet_disabled],['stitch','Costura',who.stitch_disabled],['own','Promove minha marca'],['brand','Parceria paga']].map(([id,n,off])=>'<label><input type="checkbox" id="'+id+'" '+(off?'disabled':'')+'> '+n+'</label>').join(''))+'<label><input type="checkbox" required id="consent"> Autorizo publicar este corte no perfil acima.'+(p==='tiktok'?' Concordo com a <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer">confirmação de uso de música</a> e, para publicidade, com a <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer">política de conteúdo de marca</a>.':'')+'</label>'+(p==='youtube'?'<p>'+youtubeNotice()+'</p>':'')+'<button class="action">Publicar no '+name(p)+'</button></form>';
 const postField=['youtube','facebook'].includes(p)?$('desc'):$('caption');
 if(p==='youtube')postField.maxLength=1250;
 if(p==='tiktok'){
  $('publish').querySelector('button.action').textContent='Publicar diretamente no TikTok';
  const note=document.createElement('p');note.textContent='Aplicativos sem auditoria do TikTok exigem conta privada e visibilidade Somente eu para publicação direta. A visibilidade deve ser escolhida por você. Para levantar essa restrição, o aplicativo precisa passar pela auditoria do TikTok.';
  $('publish').prepend(note);
  const alternative=document.createElement('button');alternative.type='button';
  if($('inbox')){
   alternative.textContent='Finalizar no aplicativo TikTok';alternative.onclick=()=>$('inbox').click();
  }else{
   const help=document.createElement('p');help.textContent='Para usar o envio à caixa de entrada, habilite Upload (video.upload) no TikTok for Developers e autorize essa permissão novamente em Contas.';
   note.after(help);alternative.textContent='Alterar permissões do TikTok';alternative.dataset.login='tiktok';
  }
  note.after(alternative);
 }
 const titleField=['youtube','facebook'].includes(p)?$('caption'):null;
 if((project.writePosts||c.postDraft)&&c.description)postField.value=c.description.slice(0,postField.maxLength);
 $('suggest-post').textContent=c.postDraft?'Usar texto salvo na fila':'Gerar título, legenda e hashtags';
 $('suggest-post').onclick=()=>fillCopy(postField,true,titleField);
 if(project.writePosts||c.postDraft)fillCopy(postField,false,titleField);
 $('publish').onsubmit=async ev=>{ev.preventDefault();const button=ev.submitter;button.disabled=true;try{
 if($('brand')?.checked&&$('privacy').value==='SELF_ONLY')throw Error('Parcerias pagas precisam de visibilidade compatível.');
 const b={platform:p,job,index,revision,title:$('caption').value,description:$('desc')?.value,channel:who.channel_id,privacy:$('privacy')?.value};for(const id of ['kids','consent','comment','duet','stitch','own','brand'])b[id]=!!$(id)?.checked;
 if(p==='tiktok')b.mode='direct';
 const {post}=await api('publish',b);$('modal').close();msg(post?.state==='Aguardando link do Instagram'?post.detail:'Enviado ao '+name(p)+'.');await refresh();
 }catch(e){button.disabled=false;report(e);await refresh();}};
 }catch(e){report(e);}
 };
 }
 }catch(e){report(e);}
});
function addTrim(job,index,c,src){
 const form=document.createElement('form');
 form.className='stack trim';
 form.innerHTML='<h3>Ajustar início e fim</h3><p>As posições são relativas ao vídeo atual. A duração mínima é de 40 segundos.</p><div class="row"><label>Início (s)<input id="trim-from" type="number" min="0" max="'+(c.length-40)+'" value="0" required></label><label>Fim (s)<input id="trim-to" type="number" min="40" max="'+c.length+'" value="'+c.length+'" required></label></div><div class="actions"><button type="button" id="trim-preview">Prévia do ajuste</button><button class="action">Salvar ajuste</button></div>';
 const video=$('dialogbody').querySelector('video');
 video.after(form);
 const from=()=>$('trim-from').valueAsNumber,to=()=>$('trim-to').valueAsNumber;
 let preview=false;
 video.ontimeupdate=()=>{if(preview&&video.currentTime>=to()){video.pause();preview=false;}};
 $('trim-preview').onclick=()=>{video.currentTime=from();preview=true;video.play().catch(report);};
 form.onsubmit=async e=>{
  e.preventDefault();const button=e.submitter;
  if(to()-from()<40){report(Error('Mantenha pelo menos 40 segundos.'));return;}
  if(from()===0&&to()===c.length)return;
  button.disabled=true;
  try{await api('trim',{job,index,revision:c.revision||0,from:from(),to:to()});await refresh();$('modal').close();msg('Ajuste salvo.');}
  catch(err){report(err);button.disabled=false;}
 };
}

$('check-publications').onclick=async e=>{
 const button=e.currentTarget;
 button.disabled=true;
 try{await api('publications/check',{});await refresh();msg('Verificação concluída.');}
 catch(error){report(error);}
 finally{button.disabled=false;}
};
$('install-model').onclick=async()=>{
 const button=$('install-model'),status=$('model-status');
 button.disabled=true;status.textContent='Baixando o modelo Whisper (148 MB)…';
 try{await api('model',{});await refresh();}catch(e){status.textContent=e.message;}finally{button.disabled=false;}
};
$('prevent-duplicates').onchange=async event=>{
 const option=event.currentTarget;
 option.disabled=true;
 try{await api('generation/prevent-duplicates',{enabled:option.checked});await refresh();}
 catch(error){option.checked=state.preventDuplicates;report(error);}
 finally{option.disabled=false;}
};
$('pair').onclick=async()=>{
 try{
  const networks=await api('networks');
  networks.sort((a,b)=>Number(!/wi.?fi|wireless/i.test(a.name))-Number(!/wi.?fi|wireless/i.test(b.name)));
  modal('<h2>Acesso pelo celular</h2><p>Gere um link que expira em uma hora. Quem tiver o link pode revisar, publicar e controlar a fila. Mantenha o Cliparia aberto no PC.</p><form id="pair-form" class="stack"><label>Conexão<select id="pair-mode"><option value="remote">Pela internet · HTTPS</option>'+(networks.length?'<option value="local">Na mesma rede Wi-Fi</option>':'')+'</select></label><label id="pair-interface" hidden>Rede do PC<select id="pair-ip">'+networks.map(n=>'<option value="'+esc(n.address)+'">'+esc(n.name)+' · '+esc(n.address)+'</option>').join('')+'</select></label><p id="pair-hint"></p><button class="action">Gerar link para o celular</button></form><div id="pair-result" role="status"></div><button id="stop-pair">Encerrar acesso do celular</button>');
  const mode=$('pair-mode');
  const showMode=()=>{
   const local=mode.value==='local';
   $('pair-interface').hidden=!local;
   $('pair-hint').textContent=local?'Use uma rede local de confiança.':'Usa um túnel temporário da Cloudflare. O cloudflared precisa estar disponível no PC.';
  };
  mode.onchange=showMode;showMode();
  $('pair-form').onsubmit=async e=>{
   e.preventDefault();const output=$('pair-result'),button=e.submitter;
   button.disabled=true;output.textContent='Criando o link…';$('err').textContent='';
   try{
    const {url,qr}=await api('pair/start',{mode:mode.value,address:$('pair-ip').value});
    output.innerHTML='<p>Abra o link no navegador ou cole-o no app Android.</p>'+(qr?'<img class="pair-qr" alt="QR para abrir o Cliparia no celular" src="data:image/png;base64,'+qr+'">':'')+'<label>Link de acesso<input id="pair-url" readonly value="'+esc(url)+'"></label><button type="button" id="copy-pair">Copiar link</button>';
    $('copy-pair').onclick=async()=>{try{await navigator.clipboard.writeText(url);msg('Link copiado.');}catch{$('pair-url').select();}};
   }catch(err){
    output.textContent='';
    if(/Instale o cloudflared/.test(err.message))output.innerHTML='<p>Instale o cloudflared e reabra o Cliparia. No Windows, use <code>winget install --id Cloudflare.cloudflared --exact</code> no Terminal. <a href="https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/" target="_blank" rel="noreferrer">Download oficial</a>.</p>';
    report(err);
   }finally{button.disabled=false;}
  };
  $('stop-pair').onclick=async()=>{
   try{await api('pair/stop',{});$('pair-result').textContent='Acesso encerrado.';}catch(e){report(e);}
  };
 }catch(e){report(e);}
};
let renderedContinuousQueue;
function renderContinuous(queue){
 if(!queue)return;
 const toggle=$('continuous-toggle');$('continuous-limit').value=String(queue.simultaneous);
 toggle.textContent=queue.enabled?'Pausar modo contínuo':'Ativar modo contínuo';
 toggle.disabled=!queue.enabled&&!queue.connected;
 $('continuous-state').textContent=!queue.connected?'Conecte o Google Drive na aba Contas.':queue.enabled?'Ativo · até '+queue.simultaneous+' fontes simultâneas':'Pausado';
 const settings=queue.autoQueue||{enabled:false,targets:[]};
 const rendered=JSON.stringify(settings);
 if(rendered!==renderedContinuousQueue){
  renderedContinuousQueue=rendered;
  const form=$('continuous-auto-queue');
  form.elements.enabled.checked=settings.enabled;
  for(const input of form.querySelectorAll('[name="targets"]'))input.checked=settings.targets.includes(input.value);
  $('continuous-auto-queue-state').textContent=settings.enabled?'Ativa para '+settings.targets.map(name).join(', '):'Adição automática desativada';
 }
 $('continuous-sources').innerHTML=queue.sources.map(source=>'<article class="queue-source"><div><strong>'+esc(source.url)+'</strong><p>'+esc(source.status)+(source.follow?' · Acompanhando canal':'')+'</p></div><button data-remove-source="'+esc(source.id)+'">Remover</button></article>').join('')||'<div class="empty">Adicione uma live, um VOD ou um canal para começar.</div>';
}
function queuePlatform(platform,post,status,key,available){
 if(!status)return postStatus(platform,post||{state:'Aguardando envio'},key,true);
 const mode=platform==='tiktok'&&post?.mode==='inbox'?' · Celular':platform==='instagram'&&post?.uploadMode==='hosted'?' · Link HTTPS':'';
 const link=post?.link&&['kwai','instagram'].includes(platform)?'<a href="'+esc(post.link)+'" target="_blank" rel="noopener noreferrer">Abrir no '+name(platform)+'</a>':'';
 let action='';
 if(status.action==='accounts')action=mobile?'<span>Conecte a conta no PC</span>':'<button type="button" class="queue-inline" data-open-accounts>Ver conta</button>';
 if(status.action==='configure')action='<button type="button" class="queue-inline" data-configure-queue>Configurar</button>';
 if(status.action==='edit')action='<button type="button" class="queue-inline" data-post-edit="'+esc(key)+'">Editar texto</button>';
 if(available&&status.action==='select')action='<button type="button" class="queue-inline" data-queue-select="'+esc(key)+'">Autorizar envio</button>';
 if(available&&status.action==='review')action='<button type="button" class="queue-inline" data-post-review="'+esc(key)+'">Revisar</button>';
 if(platform==='tiktok'&&post?.id&&['Em processamento','Abra a caixa de entrada do TikTok'].includes(post.state))action+='<button type="button" class="queue-inline" data-status="'+esc(key)+'">Consultar envio</button>';
 return '<div class="queue-destination"><span class="queue-destination-name">'+name(platform)+mode+'</span><span class="queue-badge" data-kind="'+esc(status.kind)+'">'+esc(status.label)+'</span>'+
  (post?.detail?'<span class="queue-destination-detail">'+esc(post.detail)+'</span>':'')+
  (action||link?'<div class="queue-destination-actions">'+link+action+'</div>':'')+'</div>';
}
const searchText=value=>String(value||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const queueTime=new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
function renderPosting(){
 const settings=state.posting;
 $('check-youtube-queue').disabled=!state.accounts.youtube?.connected;
 const queue=state.jobs.flatMap(job=>job.clips.flatMap((clip,index)=>isQueued(clip)?[{job,clip,index}]:[])).sort((a,b)=>a.clip.posting.order-b.clip.posting.order);
 const overview=settings?.overview;
 const query=searchText($('queue-search').value.trim()),kind=$('queue-status-filter').value,selectedPlatform=$('queue-platform-filter').value;
 const next=overview?.next,nextClip=next&&state.jobs.find(job=>job.id===next.job)?.clips[next.index];
 $('queue-pending-count').textContent=overview?.total??0;
 $('queue-sending-count').textContent=overview?.sending??0;
 $('queue-attention-count').textContent=overview?.attention??0;
 $('queue-next-title').textContent=nextClip?(nextClip.postDraft?.title||nextClip.title):settings?.enabled?'Nenhum corte elegível agora':'Envio automático pausado';
 $('queue-next-detail').textContent=next?next.platforms.map(name).join(' · ')+' · '+(next.at>Date.now()?queueTime.format(next.at):'Elegível agora'):'';
 const visible=queue.map((entry,position)=>({...entry,position})).filter(({job,clip,index})=>{
  if(query&&!searchText([clip.postDraft?.title||clip.title,...(clip.postDraft?.tags||clip.hashtags||[]),job.title].join(' ')).includes(query))return false;
  const statuses=overview?.rows[job.id+'/'+index];
  if(clip.posting.recoveryReview)return selectedPlatform==='all'&&['all','manual'].includes(kind);
  return clip.posting.targets.some(p=>(selectedPlatform==='all'||selectedPlatform===p)&&(kind==='all'||statuses?.[p]?.kind===kind));
 });
 $('posting-total').textContent=visible.length===queue.length?queue.length+(queue.length===1?' corte':' cortes'):visible.length+' de '+queue.length+' cortes';
 $('posting-empty').hidden=visible.length>0;
 $('posting-empty').textContent=queue.length?'Nenhum corte corresponde à busca ou aos filtros.':'Escolha os cortes que quer postar nas abas Estúdio ou Contínuo.';
 $('posting-shuffle').disabled=queue.length<2;
 $('posting-items').innerHTML=visible.map(({job,clip,index,position})=>{
  const key=job.id+'/'+index;
  const available=!clip.drive?.removed&&!Object.values(overview?.rows[key]||{}).some(status=>status.unavailable);
  const possible=clip.youtubeReview?.candidates||[];
  const youtubeFailed=clip.posts.youtube?.state==='Falhou'&&clip.posts.youtube.reason!=='posting_text_blocked';
  const platforms=clip.posting.recoveryReview?'<p class="queue-source-line">Recuperado do Drive · confira a publicação anterior e selecione os destinos</p>':clip.posting.targets.map(p=>{
   const row=queuePlatform(p,clip.posts[p],overview?.rows[key]?.[p],key,available);
   return p==='youtube'&&possible.length?row+possible.filter(id=>/^[\w-]{11}$/.test(id)).map(id=>'<a href="https://www.youtube.com/watch?v='+id+'" target="_blank" rel="noopener noreferrer">Conferir vídeo no YouTube</a>').join(' '):row;
  }).join('');
  const retry=available&&clip.posting.targets.includes('youtube')&&(youtubeFailed||possible.length)?'<button data-youtube-retry="'+esc(key)+'">'+(possible.length?'Liberar envio ao YouTube':'Agendar nova tentativa no YouTube')+'</button>':'';
  const review=available?'<button class="posting-primary" data-post-review="'+esc(key)+'">'+(clip.posting.targets.every(p=>p==='youtube')?'Revisar corte':'Revisar e publicar')+'</button><button data-post-edit="'+esc(key)+'">Editar texto</button><button data-queue-select="'+esc(key)+'">Alterar destinos</button>'+retry:clip.drive?.trashed?'<button data-drive-restore="'+esc(key)+'">Restaurar vídeo</button>':'';
  const title=clip.postDraft?.title||clip.title||'Corte sem título',tags=(clip.postDraft?.tags||[]).join(' ');
  return '<li value="'+(position+1)+'"><article><h3>'+esc(title)+'</h3><p class="queue-source-line">'+esc(job.title)+' · '+clip.length+' s'+(clip.postDraft?' · Texto editado':'')+'</p>'+
   (tags?'<p class="queue-tags">'+esc(tags)+'</p>':'')+(clip.syncError?'<p class="queue-error">'+esc(clip.syncError)+'</p>':'')+'<div class="queue-destinations">'+platforms+'</div>'+
   '<div class="actions posting-actions">'+review+'<button data-queue-remove="'+esc(key)+'">Retirar da fila</button></div></article></li>';
 }).join('');
 if(!settings){
  $('posting-configure').disabled=$('posting-toggle').disabled=true;
  $('posting-state').textContent='Atualize o servidor do Cliparia para usar os controles da fila.';
  return;
 }
 const input=$('countdown-minutes');
 if(input.defaultValue!==String(settings.intervalMinutes)){
  const previous=input.defaultValue;
  if(input.value===previous)input.value=String(settings.intervalMinutes);
  input.defaultValue=String(settings.intervalMinutes);
 }
 const configured=Object.keys(settings.configs).map(name);
 $('posting-configure').disabled=false;
 $('posting-toggle').disabled=!configured.length;
 $('posting-toggle').textContent=settings.enabled?'Pausar postagem automática':'Ativar postagem automática';
 $('posting-state').textContent=configured.length?(settings.enabled?'Automático ativo em ':'Automático pausado em ')+configured.join(', '):'Configure pelo menos uma plataforma para ativar a postagem automática.';
 renderPostingCountdown();
}
$('queue-search').oninput=()=>{if(state)renderPosting();};
for(const id of ['queue-status-filter','queue-platform-filter'])$(id).onchange=()=>{if(state)renderPosting();};
function renderPostingCountdown(){
 const settings=state?.posting;
 const timer=$('posting-countdown');
 const remaining=Math.ceil(((settings?.nextAt||0)-Date.now())/1000);
 timer.hidden=!settings?.enabled||remaining<=0;
 if(!timer.hidden)timer.textContent='Intervalo para um novo corte · '+(remaining<3600?clock(remaining).slice(3):clock(remaining));
}
$('posting-configure').onclick=configureAutomatic;
$('check-youtube-queue').onclick=async event=>{
 const button=event.currentTarget;button.disabled=true;
 try{
  const result=await api('posting/check-youtube',{});await refresh();
  msg(result.published+' publicados · '+result.waiting+' aguardando envio · '+result.processing+' em processamento ou a confirmar · '+result.review+' possíveis repetidos · '+result.failed+' falharam.');
 }catch(error){report(error);}
 finally{button.disabled=!state.accounts.youtube?.connected;}
};
$('posting-toggle').onclick=async()=>{
 const button=$('posting-toggle');button.disabled=true;
 try{await api('posting/enable',{enabled:!state.posting.enabled});await refresh();}
 catch(error){report(error);}
 finally{button.disabled=!Object.keys(state?.posting?.configs||{}).length;}
};
$('posting-shuffle').onclick=async()=>{
 try{await api('posting/shuffle',{});await refresh();msg('Ordem da fila embaralhada.');}
 catch(error){report(error);}
};
const restartCountdownButton=$('restart-countdown'),clearCountdownButton=$('clear-countdown');
const countdownForm=$('countdown-settings');
async function updateCountdown(route,body,message){
 const buttons=[...countdownForm.querySelectorAll('button')];
 for(const button of buttons)button.disabled=true;
 try{
  await api('posting/'+route,body);
  await refresh();
  msg(message);
 }catch(error){report(error);}
 finally{for(const button of buttons)button.disabled=false;}
}
countdownForm.onsubmit=event=>{
 event.preventDefault();
 void updateCountdown('countdown',{minutes:$('countdown-minutes').valueAsNumber},'Intervalo salvo.');
};
restartCountdownButton.onclick=()=>updateCountdown('restart-countdown',{},'Contagem reiniciada.');
clearCountdownButton.onclick=()=>updateCountdown('clear-countdown',{},'Contagem zerada.');
$('continuous-limit').onchange=async e=>{try{await api('continuous/limit',{limit:Number(e.target.value)});await refresh();}catch(error){report(error);}};
$('continuous-auto-queue').onsubmit=async event=>{
 event.preventDefault();
 const button=event.submitter,fields=new FormData(event.currentTarget);
 button.disabled=true;
 try{
  const enabled=fields.has('enabled');
  await api('continuous/auto-queue',{enabled,targets:fields.getAll('targets')});
  renderedContinuousQueue=undefined;
  await refresh();
  msg(enabled?'Cortes aprovados serão adicionados à fila.':'Adição automática desativada.');
 }catch(error){report(error);}
 finally{button.disabled=false;}
};
$('continuous-toggle').onclick=async e=>{
 const button=e.currentTarget;
 button.disabled=true;
 try{await api('continuous/enable',{enabled:!state.continuous.enabled});await refresh();}catch(error){report(error);}finally{button.disabled=!state?.continuous?.enabled&&!state?.continuous?.connected;}
};
async function init(){
 if(mobile){
  $('studio-form').hidden=true;$('accounts').hidden=true;$('pair').hidden=true;$('studio').textContent='Cortes';$('posting-tab').textContent='Fila';$('continuous-controls').hidden=true;
  $('desk-title').textContent='Revisar cortes';$('jobs-title').textContent='Cortes disponíveis';
  const token=location.hash.startsWith('#revisao=')?location.hash.slice(9):'';
  if(token){
   const res=await fetch('/api/pair',{method:'POST',headers:{Authorization:'Bearer '+token}});
   history.replaceState(null,'',location.pathname+location.search+'#postagem');tab();
   if(!res.ok)throw Error('O link expirou. Gere outro no PC.');
  }
 }
 await refresh();
 const updateScreen=()=>{
  if(document.hidden)return;
  void refresh().catch(e=>{if(mobile&&e.status===403){$('mobile-connection').hidden=false;$('mobile-connection').textContent=e.message;}});
 };
 setInterval(updateScreen,mobile?6500:2000);
 setInterval(renderPostingCountdown,1000);
 document.addEventListener('visibilitychange',updateScreen);
}

init().catch(e=>{if(mobile){$('mobile-connection').hidden=false;$('mobile-connection').textContent=e.message;}else $('jobs').textContent=e.message;report(e);});
