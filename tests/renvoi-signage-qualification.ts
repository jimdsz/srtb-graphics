// Local-only browser fixture: exercises the real export compositor, never an API.
import {getTemplate,templateDefaults} from '../src/studio/domain';
import {prepareGraphic} from '../src/studio/video/engine';
import {RENVOI_AD,RENVOI_RATING} from '../src/studio/renvoi-signage';

export async function qualifyRenvoiSignage(){
  if(location.origin!=='http://127.0.0.1:5198')throw Error('Local qualification only');
  const template=getTemplate('BTV_Renvoi'),base={...templateDefaults(template),variant:'2L',title:'STREET ART',title2:'SANS FRONTIÈRES',_audio_enabled:false};
  const frames=[0,64,69,74,125,185,188,191,202,249],records:any[]=[],images:Record<string,string>={};
  const pixels=new Map<string,Uint8ClampedArray>();
  for(const rating of [false,true])for(const ad of [false,true]){
    const key=`${Number(rating)}${Number(ad)}`,prepared=await prepareGraphic(template,{...base,[RENVOI_RATING]:rating,[RENVOI_AD]:ad},7.4,true,new AbortController().signal);
    try{
      for(const frame of frames){
        const canvas=await prepared.frame(frame,null),data=canvas.getContext('2d')!.getImageData(0,0,1920,1080).data;
        pixels.set(`${key}:${frame}`,new Uint8ClampedArray(data));
        if(frame===125)images[key]=canvas.toDataURL('image/png');
      }
    }finally{await prepared.dispose();}
  }
  // The complete title/carton pixels must stay identical. Only the original
  // pictogram boxes at the bottom right may differ; neither may outlive its AE layer.
  for(const frame of frames){
    const off=pixels.get(`00:${frame}`)!,rating=pixels.get(`10:${frame}`)!,ad=pixels.get(`01:${frame}`)!,both=pixels.get(`11:${frame}`)!;
    let ratingPixels=0,adPixels=0,outside=0,compositionErrors=0;
    for(let i=0;i<off.length;i+=4){
      const r=[0,1,2,3].some(c=>off[i+c]!==rating[i+c]),a=[0,1,2,3].some(c=>off[i+c]!==ad[i+c]);
      if(r)ratingPixels++;if(a)adPixels++;
      if(r||a){const x=(i/4)%1920,y=Math.floor(i/4/1920);if(x<1660||x>1815||y<945||y>1010)outside++;}
      for(let c=0;c<4;c++)if(both[i+c]!==(r?rating:a?ad:off)[i+c])compositionErrors++;
    }
    if(outside||compositionErrors)throw Error(`Frame ${frame}: unrelated pixels changed ${outside}/${compositionErrors}`);
    if(frame===125&&(!ratingPixels||!adPixels))throw Error('An enabled pictogram did not render');
    if((frame<=64||frame>=191)&&(ratingPixels||adPixels))throw Error('Native signalétique timing changed');
    records.push({frame,ratingPixels,adPixels,outside,compositionErrors});
  }
  return {records,images};
}
