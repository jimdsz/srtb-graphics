import {COMMERCIAL_FPS,DEFAULT_COMMERCIAL_DATA,commercialPageStyle} from './model';
import type {CommercialAudio,CommercialData,CommercialLogo,CommercialPage} from './model';
import {COMMERCIAL_EXAMPLE_ASSETS} from './example-assets';

export const COMMERCIAL_EXAMPLE_TITLE='Exemple · Service commercial Bénin TV';
export const COMMERCIAL_EXAMPLE_VOICE_NAME='Voix française · synthèse neuronale Kokoro';
export const COMMERCIAL_EXAMPLE_MUSIC_NAME='Lumière douce · musique originale';
export const COMMERCIAL_EXAMPLE_CHAPTER_FRAMES=[253,235,235,262] as const;
const readingDuration=COMMERCIAL_EXAMPLE_CHAPTER_FRAMES.reduce((sum,frames)=>sum+frames,0)/COMMERCIAL_FPS;

const examplePage=(title:string,body:string,kind:number,center=false):CommercialPage=>{
  const page={title,body};
  return {...page,style:{...commercialPageStyle(page,kind),align:center?'center':'left'}};
};

/** The four narration chapters end on these frame-aligned boundaries. */
export function createCommercialExampleData(voice:CommercialAudio,logo:CommercialLogo,music:CommercialAudio|null=null):CommercialData {
  return {
    ...structuredClone(DEFAULT_COMMERCIAL_DATA),
    issuer:'Service commercial Bénin TV',textMode:'summary',theme:'vert',
    duration:40,durationMode:'voice',sequenceTiming:'manual',demo:false,
    signatureEnabled:true,signatureVolume:.4,
    voice:{...voice,end:Math.min(voice.duration,readingDuration)},music:music?{...music}:null,logo:{...logo},
    sequences:[
      {id:crypto.randomUUID(),layout:'central',duration:COMMERCIAL_EXAMPLE_CHAPTER_FRAMES[0]/COMMERCIAL_FPS,pages:[
        examplePage('Faites-vous connaître','Mettez en lumière vos projets,\nvos événements et vos offres\navec Bénin TV.',0,true),
      ]},
      {id:crypto.randomUUID(),layout:'columns',duration:COMMERCIAL_EXAMPLE_CHAPTER_FRAMES[1]/COMMERCIAL_FPS,pages:[
        examplePage('Le message','L’essentiel de votre annonce.\nDes mots clairs et directs.',1),
        examplePage('Votre identité','Le logo de votre marque.\nVotre identité en lumière.',2),
      ]},
      {id:crypto.randomUUID(),layout:'final',duration:COMMERCIAL_EXAMPLE_CHAPTER_FRAMES[2]/COMMERCIAL_FPS,pages:[
        examplePage('Donnez vie au message','Une voix posée.\nUne musique discrète.\nUne présentation soignée.',3,true),
      ]},
      {id:crypto.randomUUID(),layout:'central',duration:COMMERCIAL_EXAMPLE_CHAPTER_FRAMES[3]/COMMERCIAL_FPS,pages:[
        examplePage('Service commercial','Rapprochez-vous du service commercial\nde Bénin TV pour préparer\nvotre prochaine annonce.',0,true),
      ]},
    ],
  };
}

/** Only authenticated, explicitly listed product assets are attached to this example. */
export async function prepareCommercialExample(signal:AbortSignal):Promise<CommercialData> {
  const {newCommercialAudio}=await import('./media');
  const {inspectCommercialAudio}=await import('./audio');
  signal.throwIfAborted();
  const response=await fetch(COMMERCIAL_EXAMPLE_ASSETS.logo,{signal,credentials:'same-origin'});
  if(!response.ok)throw Error('Le logo de l’exemple est indisponible. Réessayez dans un instant.');
  let image:ImageBitmap|undefined;
  try{
    image=await createImageBitmap(await response.blob());
    signal.throwIfAborted();
    if(!image.width||!image.height)throw Error('Le logo de l’exemple est illisible.');
  }finally{
    image?.close();
  }
  const voice=await inspectCommercialAudio(COMMERCIAL_EXAMPLE_ASSETS.voice,signal);
  signal.throwIfAborted();
  const music=await inspectCommercialAudio(COMMERCIAL_EXAMPLE_ASSETS.music,signal);
  signal.throwIfAborted();
  const voiceSetting=newCommercialAudio(COMMERCIAL_EXAMPLE_ASSETS.voice,COMMERCIAL_EXAMPLE_VOICE_NAME,voice.duration,true);
  return createCommercialExampleData(
    voiceSetting,
    {url:COMMERCIAL_EXAMPLE_ASSETS.logo,name:'Logo officiel Bénin TV',presentation:'adaptive',crop:true,mode:'original',position:'bottom-right',scale:1.1,opacity:1,offsetX:0,offsetY:0,plate:'showcase',motion:'fade',delay:0},
    {...newCommercialAudio(COMMERCIAL_EXAMPLE_ASSETS.music,COMMERCIAL_EXAMPLE_MUSIC_NAME,music.duration,false),delay:0,volume:.14,loop:false,fadeIn:2,fadeOut:2},
  );
}
