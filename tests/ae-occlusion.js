const moduleUrl='/library/v1.7.0/BTV_Semainier/graphic-v2.mjs',configUrl='/library/v1.7.0/BTV_Semainier/config.mjs';
const {default:Template}=await import(/* @vite-ignore */moduleUrl);
const {DEFAULTS,CONFIG}=await import(/* @vite-ignore */configUrl);
customElements.define('semainier-occlusion',Template);
const instances=[];
document.querySelector('#run').onclick=async()=>{
 const result=document.querySelector('#result');result.textContent='Chargement…';
 try {
  for(const g of instances){await g.dispose();g.remove();}instances.length=0;
  const time=Number(document.querySelector('#time').value),records=[];
  const source='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#33444f"/><path d="M0 0L1920 1080M0 1080L1920 0" stroke="#597a8b" stroke-width="8"/><circle cx="960" cy="540" r="120" fill="#7899a9"/></svg>');
  for(const kind of ['empty','media']){
   const data={...DEFAULTS};if(kind==='media')for(const spec of CONFIG.media)data[spec.field]=source;
   const g=document.createElement('semainier-occlusion');instances.push(g);document.querySelector('#'+kind).append(g);
   await g.load({data,previewMuted:true});await g.goToTime({seconds:time});
   records.push({kind,time,targets:g.shadowRoot.querySelectorAll('foreignObject').length,status:g.getStatus()});
  }
  result.textContent=JSON.stringify(records,null,2);
 }catch(error){result.textContent=String(error);}
};
