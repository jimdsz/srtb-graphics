/** Qualification-only extraction of original vector assets; no replacement artwork. */
export async function extractOptions(save:(name:string,body:string)=>Promise<void>){
  const base='/library/v1.7.0/BTV_BA_1P/',original=await fetch(base+'lib/lottie-template.json').then(r=>r.json());
  const lottie=(await import(/* @vite-ignore */base+'lib/lottie-web.esm.mjs')).default;
  const suivi=await fetch('/library/v1.7.0/BTV_BA_TDS_SUIVI_DE/lib/lottie-template.json').then(r=>r.json());
  for(const kind of ['ba-sponsors','ba-mentions','suivi-mentions']){
    const data=structuredClone(kind==='suivi-mentions'?suivi:original);
    const layer=kind==='ba-sponsors'?data.layers.find((l:any)=>l.ind===27):kind==='ba-mentions'?data.assets.find((a:any)=>a.nm==='BA1P_Typo_PACK').layers.find((l:any)=>l.nm==='MENTIONS'):data.layers.find((l:any)=>l.ind===23);
    delete layer.parent;layer.hd=false;layer.ip=0;layer.op=10000;layer.st=0;
    layer.ks={o:{a:0,k:100},r:{a:0,k:0},p:{a:0,k:[960,540,0]},a:{a:0,k:[0,0,0]},s:{a:0,k:[100,100,100]}};
    if(kind==='ba-sponsors')data.assets.find((a:any)=>a.nm==='Sponsor_logos').layers=data.assets.find((a:any)=>a.nm==='Sponsor_logos').layers.filter((l:any)=>l.ty!==2);
    data.layers=[layer];data.op=10000;
    const host=document.createElement('div');host.style.cssText='width:1920px;height:1080px;position:absolute;left:-20000px';document.body.append(host);
    const animation=lottie.loadAnimation({container:host,renderer:'svg',loop:false,autoplay:false,animationData:data});
    try{
      await new Promise<void>(resolve=>animation.addEventListener('DOMLoaded',()=>resolve()));animation.goToAndStop(100,true);
      const native=host.querySelector('svg')!,box=native.querySelector<SVGGElement>('g')!.getBBox(),svg=native.cloneNode(true) as SVGElement;
      // The native 1920×1080 viewport mask must not crop the extracted asset.
      svg.querySelector('g')?.removeAttribute('clip-path');
      if(!(box.width>0&&box.height>0))throw Error('Option vectorielle vide : '+kind);
      svg.setAttribute('xmlns','http://www.w3.org/2000/svg');svg.setAttribute('viewBox',`${box.x-2} ${box.y-2} ${box.width+4} ${box.height+4}`);svg.setAttribute('width',String(Math.ceil(box.width+4)));svg.setAttribute('height',String(Math.ceil(box.height+4)));svg.removeAttribute('style');
      await save(kind+'-uncropped.svg',new XMLSerializer().serializeToString(svg));
    }finally{animation.destroy();host.remove();}
  }
}
