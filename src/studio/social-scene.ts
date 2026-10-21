import type {BroadcastTemplate,ProjectData} from './domain';
import type {LegacyGraphic} from './video/engine';
import {textFields} from './typography-model';
import {installBASocialDirect} from './ba-social-engine';

/** The hidden TV scene supplies clocks/media, never the social glyphs. Its
 * single-line and outline constraints must not reject social editorial text.
 * Presence still selects the native variant. Appointment values remain exact:
 * notably "Tout de suite" controls the BA's no-hour and audio behaviour. */
export function socialSceneData(template:BroadcastTemplate,data:ProjectData):ProjectData{
  const native={...data};
  for(const [key]of textFields(template)){
    if(/^(?:_?(?:jour|heure|day|time)(?:_\d+)?|_next_time)$/.test(key)||!Object.hasOwn(native,key))continue;
    native[key]=String(native[key]??'').trim()?'A':'';
  }
  return native;
}

/** Social layouts have their own renderer. Keep BA timing/media/audio, but do not
 * build or redraw a second, invisible TV SVG + three WebGL/canvas compositions.
 * This adapter is instance-scoped; native TV and broadcast packages are untouched.
 */
export function installSocialScene(graphic:LegacyGraphic,template:BroadcastTemplate){
  const load=graphic.load.bind(graphic),update=graphic.updateAction.bind(graphic);
  graphic.load=(params:any={})=>load({...params,data:socialSceneData(template,params.data||{})});
  graphic.updateAction=(data:ProjectData)=>update(socialSceneData(template,data));
  // Native bitmap sequences are TV-only backplates (hundreds of HTTP requests).
  // The social renderer draws its own backgrounds, so never fetch these images.
  if(template.libraryVersion==='1.7.0'&&typeof graphic._loadBackgroundSequence==='function')graphic._loadBackgroundSequence=async()=>({frames:0});
  if(template.libraryVersion==='1.7.0'&&template.version==='1.0.0'&&['BTV_Evenement','BTV_Semainier'].includes(template.id)){
    // These two engines validate independently of Lottie. SocialRenderer owns
    // the visible composition and fonts: loading the TV JSON, building its SVG
    // and mounting hidden media canvases only duplicates work. Keep the native
    // queue, clock, track/audio preparation, trim adapters and disposal intact.
    graphic._update=async function(this:LegacyGraphic,raw:ProjectData){
      const validation=this.validateData(raw);
      if(!validation.valid)throw Error(validation.errors.join('; '));
      this.pause();this.teardown();this.data=validation.data;this.errors=[];this.warnings=validation.warnings;
      this.animation={currentFrame:0,renderer:{elements:[]},goToAndStop(frame:number){this.currentFrame=frame;},destroy(){}};
      this.state={animation:this.animation,errors:this.errors};
      // Both preparations can finish after a failure or disposal. Wait for both
      // before releasing their nodes, so a late media load cannot escape cleanup.
      const results=await Promise.allSettled([this.prepareTracks(),this.prepareAudio()]);
      const failed=results.find(result=>result.status==='rejected');
      if(this.disposed||failed){
        this.teardown();
        if(this.disposed)throw new DOMException('Aperçu fermé.','AbortError');
        throw (failed as PromiseRejectedResult).reason;
      }
      this.elapsed=0;this.phase='ready';this._draw(0);this.resize();return this.getStatus();
    };
    return;
  }
  if(template.id!=='BTV_BA_1P'||template.version!=='1.0.3'||template.libraryVersion!=='1.7.0')return;
  installBASocialDirect(graphic);
  graphic._build=async function(){
    const container=document.createElement('div');this.shadowRoot!.append(container);
    const animation={currentFrame:0,goToAndStop(frame:number){this.currentFrame=frame;},destroy(){}};
    return {container,animation,adapters:[],canvases:{draw(){}},adaptLogo:{diagnostics:[]}};
  };
}
