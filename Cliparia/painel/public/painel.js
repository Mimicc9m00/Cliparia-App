const ui=Object.fromEntries(['refresh','automation','last-sync','toggle','notice','queue','queued-count','library','library-count','search','shuffle','clips','more',
 'view-title','posting-panel','posting-countdown','lives','live-panel','live-form','live-status','toggle-generation','live-list','add-live','batch-status','batch-link'].map(id=>[id,document.getElementById(id)]));
const labels={youtube:'YouTube',instagram:'Instagram',facebook:'Facebook',tiktok:'TikTok · finalizar no celular'};
const resultLabels={select:'Destinos atualizados',remove:'Corte removido da fila',up:'Ordem atualizada',down:'Ordem atualizada',shuffle:'Fila aleatorizada',enabled:'Postagem automática atualizada','add-live':'Fonte cadastrada no Contínuo','generation-enabled':'Geração de clipes atualizada'};
const copyLabels={pending:'Aguardando transcrição do Drive',retry:'Transcrição será tentada novamente','no-speech':'Sem fala reconhecida',sensitive:'Texto pendente de revisão de conteúdo'};
const nativeDate=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'});
const postingHour=new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'America/Sao_Paulo'});
const sent=new Set();
let snapshot=null,pending=0,view='queue',limit=25,requestNumber=0,batch=null,checkingBatch=false;
let generationChange;

function node(tag,text,className){
 const item=document.createElement(tag);
 if(text)item.textContent=text;
 if(className)item.className=className;
 return item;
}
function inform(message,error=false){
 ui.notice.textContent=message;
 ui.notice.dataset.error=String(error);
}
function button(label,action){
 const item=node('button',label);
 item.type='button';
 item.addEventListener('click',action);
 return item;
}
async function send(command,control){
 const id=crypto.randomUUID();
 if(control)control.disabled=true;
 try{
  const response=await fetch('/api/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,...command})});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'O painel recusou a alteração.');
  sent.add(id);
  inform('Alteração recebida. O Cliparia aplica a mudança no próximo lote.');
  return id;
 }catch(error){
  inform(error.message||'Não foi possível salvar a alteração.',true);
  return false;
 }finally{if(control)control.disabled=false;}
}
function card(clip,queue){
 const item=node('article');
 const meta=node('div','','meta');
 const posting=Object.entries(clip.posts).map(([platform,state])=>labels[platform]+' · '+state);
 if(clip.review)meta.append(node('span','Para revisão'));
 if(copyLabels[clip.copyRecovery])meta.append(node('span',copyLabels[clip.copyRecovery]));
 if(clip.seconds)meta.append(node('span',clip.seconds+' s'));
 if(clip.safety==='blocked')meta.append(node('span','Conteúdo bloqueado','danger'));
 for(const state of posting)meta.append(node('span',state));
 item.append(node('h2',clip.title),meta);
 if(clip.description)item.append(node('p',clip.description));
 if(clip.hashtags?.length){
  const tags=node('div','','meta');
  tags.setAttribute('aria-label','Hashtags da legenda');
  for(const tag of clip.hashtags)tags.append(node('span',tag));
  item.append(tags);
 }
 const controls=node('div','','actions');
 if(clip.drive){
  const link=node('a','Ver no Drive','link');
  link.href='https://drive.google.com/file/d/'+encodeURIComponent(clip.drive)+'/view';
  link.target='_blank';link.rel='noopener noreferrer';controls.append(link);
 }
 const target={job:clip.job,index:clip.index,revision:clip.revision};
 if(clip.queued){
  const position=queue.indexOf(clip);
  const up=button('Subir',event=>send({action:'up',...target},event.currentTarget));
  const down=button('Descer',event=>send({action:'down',...target},event.currentTarget));
  up.disabled=position<=0;down.disabled=position>=queue.length-1;
  const remove=button('Retirar da fila',event=>send({action:'remove',...target},event.currentTarget));
  controls.append(up,down,remove);
 }
 if(controls.childElementCount)item.append(controls);
 if(!clip.drive||!snapshot.platforms.length)return item;
 const details=node('details');
 const current=clip.targets.map(platform=>labels[platform]).join(', ');
 details.append(node('summary',current?'Destinos · '+current:'Escolher destinos'));
 const form=node('form');
 const options=node('div','','destinations');
 for(const platform of snapshot.platforms){
  const label=node('label');
  const check=node('input');check.type='checkbox';check.name='target';check.value=platform;check.checked=clip.targets.includes(platform);
  label.append(check,document.createTextNode(labels[platform]));options.append(label);
 }
 const save=node('button',clip.queued?'Salvar destinos':'Adicionar à fila','primary');
 save.type='submit';form.append(options,save);
 form.addEventListener('submit',async event=>{
  event.preventDefault();
  const targets=new FormData(form).getAll('target');
  if(!targets.length)return inform('Escolha pelo menos um destino.',true);
  if(await send({action:'select',...target,targets},save))details.open=false;
 });
 details.append(form);item.append(details);
 return item;
}
function renderCountdown(){
 const timer=ui['posting-countdown'];
 timer.hidden=!snapshot?.enabled||!Number.isSafeInteger(snapshot.nextAt);
 if(timer.hidden)return;
 const seconds=Math.ceil((snapshot.nextAt-Date.now())/1000);
 if(seconds<=0){
  timer.textContent=(snapshot.fixedHours?'Horário de postagem liberado':'Intervalo liberado')+' · '+(batch?.status==='in_progress'?'Lote em andamento':'Aguardando o próximo lote');
  return;
 }
 if(snapshot.fixedHours){
  const countdown=[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(value=>String(value).padStart(2,'0')).join(':');
  timer.textContent='Próximo corte às '+postingHour.format(snapshot.nextAt)+' (Brasília) · '+countdown;
  return;
 }
 const minutes=Math.floor(seconds/60);
 const time=String(minutes).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
 timer.textContent='Intervalo para um novo corte · '+time;
}
function renderGenerationControl(){
 const generation=snapshot?.generation;
 const control=ui['toggle-generation'];
 control.disabled=!generation||!!generationChange;
 control.textContent=generation?.enabled?'Pausar geração':'Retomar geração';
 if(generationChange){
  ui['live-status'].textContent=generationChange.enabled?'Retomada pendente para o próximo lote':'Pausa pendente para o próximo lote';
 }else if(generation){
  ui['live-status'].textContent=generation.enabled?(generation.autoQueue?'Geração ativa · Envio automático à fila ativo':'Geração ativa'):'Geração pausada';
 }else ui['live-status'].textContent='Aguardando sincronização';
}
function render(){
 for(const name of ['queue','library','lives'])ui[name].setAttribute('aria-pressed',String(view===name));
 ui['view-title'].textContent={queue:'Fila de postagem',library:'Biblioteca de cortes',lives:'Lives e replays'}[view];
 ui['posting-panel'].hidden=view==='lives';
 ui['live-panel'].hidden=view!=='lives';
 renderCountdown();
 const generation=snapshot?.generation;
 ui['add-live'].disabled=!generation;
 renderGenerationControl();
 ui['live-list'].replaceChildren(...(generation?.sources||[]).map(source=>{
  const item=node('article');
  item.append(node('h2',source.label),node('p',source.status),node('div',source.clips+' '+(source.clips===1?'corte':'cortes')+(source.follow?' · Acompanha o canal':''),'meta'));
  return item;
 }));
 if(generation&&!generation.sources.length)ui['live-list'].append(node('p','Nenhuma fonte cadastrada.'));
 if(!snapshot){ui.automation.textContent='Aguardando dados';return;}
 ui.automation.textContent=snapshot.enabled?'Postagem automática ativa':'Postagem automática pausada';
 ui.toggle.textContent=snapshot.enabled?'Pausar postagem':'Ativar postagem';
 ui.toggle.disabled=!snapshot.enabled&&!snapshot.platforms.length;
 ui['last-sync'].textContent='Última atualização em '+nativeDate.format(snapshot.updatedAt)+(pending?' · Alterações pendentes: '+pending:'');
 const queue=snapshot.clips.filter(clip=>clip.queued);
 const library=snapshot.clips.filter(clip=>!clip.queued);
 ui['queued-count'].textContent=queue.length;
 ui['library-count'].textContent=library.length;
 ui.shuffle.disabled=queue.length<2;
 ui.shuffle.hidden=view!=='queue';
 const search=ui.search.value.trim().toLocaleLowerCase('pt-BR');
 const visible=(view==='queue'?queue:library).filter(clip=>!search||[clip.title,clip.description,...(clip.hashtags||[])].join(' ').toLocaleLowerCase('pt-BR').includes(search));
 ui.clips.replaceChildren(...visible.slice(0,limit).map(clip=>card(clip,queue)));
 if(!visible.length)ui.clips.append(node('p',search?'Nenhum corte encontrado.':view==='queue'?'A fila está vazia.':'Nenhum corte disponível.'));
 ui.more.hidden=visible.length<=limit;
}
async function refresh(force=false){
 if(!force&&ui.clips.querySelector('details[open]'))return;
 const request=++requestNumber;
 try{
  const response=await fetch('/api/state');
  if(!response.ok)throw Error('Não foi possível consultar a fila.');
  const data=await response.json();
  if(request!==requestNumber)return;
  const changed=force||data.snapshot?.updatedAt!==snapshot?.updatedAt||pending!==data.pending;
  snapshot=data.snapshot;pending=data.pending;
  if(!snapshot){inform('O primeiro lote ainda precisa sincronizar a fila.');render();return;}
  if(generationChange&&(snapshot.generation?.enabled===generationChange.enabled||snapshot.results.some(result=>result.id===generationChange.id))){
   generationChange=null;
   renderGenerationControl();
  }
  for(const result of snapshot.results){
   if(!sent.delete(result.id))continue;
   if(result.ok)inform(resultLabels[result.action]||'Alteração aplicada.');
   else if(result.action==='add-live')inform('O Cliparia recusou a fonte. Confira se o link já está cadastrado e use um link de canal ao marcar o acompanhamento.',true);
   else inform(result.review?'O corte não entrou na fila. Confira a verificação de conteúdo.':'O Cliparia recusou a alteração. Atualize a seleção e tente novamente.',true);
  }
  if(changed)render();
 }catch(error){if(request===requestNumber)inform(error.message,true);}
}
async function refreshBatch(){
 if(checkingBatch)return;
 checkingBatch=true;
 const status=ui['batch-status'],link=ui['batch-link'];
 try{
  const response=await fetch('/api/batch');
  if(!response.ok)throw Error();
  const previous=batch;
  batch=await response.json();
  let text='Nenhum lote executado';
  if(batch){
   text=batch.status==='in_progress'?'Lote em andamento':batch.status!=='completed'?'Lote na fila do GitHub':
    ({success:'Último lote concluído',skipped:'Último lote ignorado',cancelled:'Último lote cancelado'}[batch.conclusion]||'Último lote terminou com erro');
   const started=Date.parse(batch.startedAt);
   if(Number.isFinite(started))text+=' · '+nativeDate.format(started);
   link.href=batch.url;
  }
  if(status.textContent!==text)status.textContent=text;
  link.hidden=!batch;
  if(batch?.status==='completed'&&(previous?.status!=='completed'||previous.url!==batch.url))void refresh();
 }catch{
  batch=null;
  status.textContent='Estado do lote temporariamente indisponível';
  link.hidden=true;
 }finally{checkingBatch=false;}
}
ui.refresh.addEventListener('click',()=>{void refresh(true);void refreshBatch();});
ui.toggle.addEventListener('click',event=>send({action:'enabled',enabled:!snapshot.enabled},event.currentTarget));
ui['toggle-generation'].addEventListener('click',async()=>{
 if(!snapshot?.generation||generationChange)return;
 const change={enabled:!snapshot.generation.enabled};
 generationChange=change;
 renderGenerationControl();
 change.id=await send({action:'generation-enabled',enabled:change.enabled});
 if(!change.id)generationChange=null;
 renderGenerationControl();
 if(change.id)void refresh(true);
});
ui.shuffle.addEventListener('click',event=>send({action:'shuffle'},event.currentTarget));
for(const name of ['queue','library','lives'])ui[name].addEventListener('click',()=>{view=name;limit=25;render();});
ui['live-form'].addEventListener('submit',async event=>{
 event.preventDefault();
 const data=new FormData(ui['live-form']);
 const accepted=await send({action:'add-live',url:String(data.get('url')).trim(),duration:Number(data.get('duration')),
  captions:data.has('captions'),follow:data.has('follow')},ui['add-live']);
 if(accepted)ui['live-form'].reset();
});
ui.search.addEventListener('input',()=>{limit=25;render();});
ui.more.addEventListener('click',()=>{limit+=25;render();});
void refresh(true);
void refreshBatch();
setInterval(refresh,30000);
setInterval(refreshBatch,30000);
setInterval(renderCountdown,1000);
