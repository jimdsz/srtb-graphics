const $=id=>document.getElementById(id);
const hash=location.hash.slice(1);if(/^[a-f\d]{64}$/.test(hash)){sessionStorage.setItem('graphics-connector-owner',hash);history.replaceState(null,'',location.pathname);}
let busy=false,picking=false,stopped=false,polling=false,pairExpires=0,pollTimer,refreshId=0;
const rows=new Map();
async function api(route,method='GET',data){
 const token=sessionStorage.getItem('graphics-connector-owner');if(!token)throw Error('Ouvrez cette fenêtre en lançant le connecteur Graphics sur votre poste.');
 const response=await fetch('/v1'+route,{method,credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(route==='/roots/pick'?125000:15000),headers:{Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
 const result=await response.json();if(!response.ok)throw Error(result.error||'Action indisponible.');return result;
}
function controls(){document.querySelectorAll('button').forEach(b=>{b.disabled=stopped||busy&&b.id!=='cancel-pick'||b.dataset.unavailable==='true'||b.id==='pick'&&picking;});$('cancel-pick').hidden=!picking;$('picker-help').hidden=!picking;$('message').setAttribute('aria-busy',String(busy||picking));}
async function run(label,work){if(busy||stopped)return;busy=true;controls();$('message').textContent=label;try{const message=await work();if(!stopped)$('message').textContent=typeof message==='string'?message:'À jour.';}catch(e){$('message').textContent=e.name==='TimeoutError'?'La demande prend trop de temps. Réessayez ou vérifiez le réseau.':e.message;}finally{busy=false;controls();}}
function button(label,action){const b=document.createElement('button');b.textContent=label;b.onclick=()=>void run('Action en cours…',action);return b;}
function render(roots){
 const list=$('roots'),present=new Set(roots.map(r=>r.id));
 for(const [id,row]of rows)if(!present.has(id)){row.article.remove();rows.delete(id);}
 $('empty').hidden=roots.length>0;
 const scanning=roots.some(root=>root.state==='scanning');
 for(const root of roots){
  let row=rows.get(root.id);
  if(!row){
   const article=document.createElement('article'),name=document.createElement('strong'),location=document.createElement('small'),status=document.createElement('p'),progress=document.createElement('progress');
   progress.setAttribute('aria-label','Indexation en cours');
   const scan=button('Indexer les médias',async()=>{await api('/roots/'+root.id+'/scan','POST');await refresh();});
   const stop=button('Arrêter la recherche',async()=>{await api('/roots/'+root.id+'/stop','POST');await refresh();});
   const label=document.createElement('label');label.textContent='Sous-dossiers exclus (un chemin relatif par ligne)';const input=document.createElement('textarea');label.append(input);
   const exclusions=button('Conserver les exclusions',async()=>{await api('/roots/'+root.id+'/exclusions','POST',{exclusions:input.value.split(/\r?\n/).map(v=>v.trim().replaceAll('\\','/')).filter(Boolean)});row.dirty=false;await refresh();});
   const remove=button('Retirer cet accès',async()=>{if(!confirm('Retirer l’accès à cet emplacement ? Aucun média ne sera supprimé.'))return;await api('/roots/'+root.id,'DELETE');await refresh();});
   row={article,name,location,status,progress,scan,stop,input,exclusions,dirty:false};rows.set(root.id,row);input.addEventListener('input',()=>{row.dirty=true;});
   const advanced=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Gérer ce dossier';advanced.append(summary,label,exclusions,remove);
   article.append(name,location,status,progress,scan,stop,advanced);list.append(article);
  }
  row.name.textContent=root.name;row.location.textContent=root.path;
  row.status.textContent=root.state==='scanning'?'Recherche en cours · '+(root.found||0)+' médias · '+(root.visited||0)+' entrées parcourues':root.files+' médias indexés'+(root.partial?' · index partiel':'')+(root.message?' · '+root.message:'');
  row.progress.hidden=root.state!=='scanning';row.scan.textContent=root.scanQueue?.length?'Reprendre l’indexation':root.updatedAt?'Actualiser l’index':'Indexer les médias';row.scan.dataset.unavailable=String(scanning);row.stop.hidden=root.state!=='scanning';row.stop.dataset.unavailable=String(root.state!=='scanning');row.exclusions.dataset.unavailable=String(root.state==='scanning');
  if(!row.dirty)row.input.value=root.exclusions.join('\n');
 }
 controls();
}
async function refresh(){const id=++refreshId,answer=await api('/roots');if(id===refreshId&&!stopped)render(answer.roots);}
function clearPair(){pairExpires=0;$('code').textContent='';$('code-time').textContent='';$('copy').hidden=true;}
function tickCode(){if(!pairExpires)return;const seconds=Math.ceil((pairExpires-Date.now())/1000);if(seconds<=0){clearPair();$('code-time').textContent='Code expiré. Vous pouvez en générer un nouveau.';}else $('code-time').textContent='Expire dans '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');}
function schedule(){clearTimeout(pollTimer);if(stopped||document.hidden)return;pollTimer=setTimeout(async()=>{if(!busy&&!polling){polling=true;try{await refresh();}catch(e){if(!stopped)$('message').textContent=e instanceof TypeError?'Le connecteur ne répond plus. Rouvrez-le sur ce poste.':e.message;}finally{polling=false;}}schedule();},2000);}
document.addEventListener('visibilitychange',schedule);
$('pick').onclick=async()=>{
 if(picking||stopped)return;picking=true;controls();$('message').textContent='Choisissez le dossier dans la fenêtre qui vient de s’ouvrir.';
 try{const result=await api('/roots/pick','POST');if(stopped)return;await refresh();$('message').textContent=result.cancelled?'Choix annulé. Vous pouvez choisir un autre dossier.':'Dossier autorisé. Cliquez sur « Indexer les médias », puis continuez dans Graphics.';}
 catch(e){if(!stopped)$('message').textContent=e.name==='TimeoutError'?'Le choix a expiré. Réessayez.':e.message;}
 finally{picking=false;controls();}
};
$('cancel-pick').onclick=()=>void api('/roots/pick/cancel','POST').catch(e=>{$('message').textContent=e.message;});
$('refresh').onclick=()=>void run('Actualisation…',refresh);
$('pair').onclick=()=>void run('Préparation du code…',async()=>{const {code,expires}=await api('/pairing','POST');pairExpires=expires;$('code').textContent=code.slice(0,6)+' '+code.slice(6);$('copy').hidden=false;tickCode();});
$('continue').onclick=()=>{
 if(busy||stopped)return;
 // Continue in this setup tab: no blocked popup and no existing draft replaced.
 // Send only a one-use code in a fragment, never the owner's capability.
 void run('Ouverture de Graphics…',async()=>{const {code}=await api('/pairing','POST');window.location.assign('https://srtb-graphics.pages.dev/graphics#connect-media='+code);return 'Ouverture de Graphics…';});
};
$('copy').onclick=()=>void run('Copie du code…',async()=>{await navigator.clipboard.writeText($('code').textContent);});
$('revoke').onclick=()=>void run('Déconnexion…',async()=>{await api('/disconnect','POST');clearPair();});
$('quit').onclick=()=>void run('Arrêt du connecteur…',async()=>{await api('/shutdown','POST');stopped=true;clearTimeout(pollTimer);clearPair();sessionStorage.removeItem('graphics-connector-owner');$('message').textContent='Connecteur arrêté. Vos emplacements sont conservés. Rouvrez l’application pour les retrouver.';});
setInterval(tickCode,1000);void run('Ouverture des emplacements…',refresh);schedule();
