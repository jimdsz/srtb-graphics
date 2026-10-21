import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {build} from 'esbuild';
const root=resolve(import.meta.dirname,'..');
const original=await readFile(resolve(root,'public/library/v1.7.0/BTV_BA_1P/graphic.mjs'),'utf8');
if(createHash('sha256').update(original).digest('hex')!=='8c454acd5377678fb575222177c037380e42729a0415e7b3d67290802501bdd7')throw Error('BA source changed: requalify the editor adapter.');
const originalConfig=await readFile(resolve(root,'public/library/v1.7.0/BTV_BA_1P/config.mjs'),'utf8');
if(createHash('sha256').update(originalConfig).digest('hex')!=='57966f23bca37af92b9df90a7735eea92db220efee63606e9506894218388aca')throw Error('BA config changed: requalify the editorial adapter.');
const pairCheck='if(!!day!==!!hour)throw Error(`Diffusion${i} : jour et heure doivent être renseignés ensemble.`);';
// Unknown time is a legitimate editorial state, never replace it with 00.
// Empty day + time is a hidden appointment; an orphan hour remains ambiguous.
const immediateCheck="const immediate=day.toLocaleLowerCase('fr-FR')==='tout de suite';if(immediate&&(hour||i!==1||[2,3].some(n=>config['_jour_'+n]||config['_heure_'+n])))throw Error('Une annonce Tout de suite doit être seule et sans horaire.');if(!day&&hour)throw Error(`Diffusion${i} : indiquez le libellé associé à cette heure, ou laissez les deux champs vides.`);";
if(!originalConfig.includes(pairCheck))throw Error('BA appointment validator not found.');
const originalAudio=await readFile(resolve(root,'public/library/v1.7.0/BTV_BA_1P/audio.mjs'),'utf8');
if(createHash('sha256').update(originalAudio).digest('hex')!=='346d252119707e28d06f9d1d7c8267b96f84ae218d47a0418670e152be192831')throw Error('BA audio changed: requalify the voice adapter.');
const voiceLayout=(await build({entryPoints:[resolve(root,'src/studio/ba-voice-placement.ts')],bundle:true,write:false,format:'esm',target:'es2022'})).outputFiles[0].text;
const audioClock=(await build({entryPoints:[resolve(root,'src/studio/ba-audio-clock.ts')],bundle:true,write:false,format:'esm',target:'es2022'})).outputFiles[0].text;
function exact(source,before,after){if(!source.includes(before))throw Error('BA adapter anchor not found: '+before);return source.replace(before,after);}
let portableAudio=exact(originalAudio,'export const AUDIO_DEFAULTS = Object.freeze({',"export const AUDIO_DEFAULTS = Object.freeze({\n    _audio_social_direct_enabled: false,\n    _studio_ba_voice_fit: 'source',");
portableAudio=exact(portableAudio,"        if (key.endsWith('_enabled'))", "        if (key === '_studio_ba_voice_fit') { if (!['source','fit-complete','manual'].includes(config[key])) throw error('Placement vocal invalide.', 'AUDIO_CONFIG'); }\n        else if (key.endsWith('_enabled'))");
// Replacing a voice clears its marks and explicitly disables the track. Do not
// block the silent draft or invent a tiny passage; activation validates again.
portableAudio=exact(portableAudio,"voice: ['intro','outro'].map(phase => {", "voice: (config._audio_voice_enabled === false ? [] : ['intro','outro']).map(phase => {");
// Social BA uses one optional announcement on the excerpt clock. Filter the
// unused TV windows BEFORE validation, without touching immutable TV defaults.
portableAudio=exact(portableAudio,'    for (const insertions of Object.values(plan))',"    if(config._audio_social_direct_enabled){plan.bed=[];plan.voice=plan.voice.filter(item=>item.id==='voice-intro').map(item=>({...item,minimumIn:0,maximumEnd:86400}));}\n    for (const insertions of Object.values(plan))");
portableAudio=exact(portableAudio,'    return plan;','    const duck=config._audio_social_direct_enabled?undefined:baVoiceDucking(config);if(duck){plan.bed[0].envelope=duck.intro;plan.bed[1].envelope=duck.outro;}\n    return plan;');
portableAudio=exact(portableAudio,'this.context.decodeAudioData(bytes)','decodeBAAudio(bytes)');
portableAudio=exact(portableAudio,'next[kind].buffer.duration+0.00001','next[kind].buffer.duration+Math.max(0.00001,1/next[kind].buffer.sampleRate)+1e-12');
portableAudio=exact(portableAudio,'export default AudioEngine;','installBAScheduledAudio(AudioEngine,{dbToGain,envelopeDbAt});\nexport default AudioEngine;');
portableAudio="import {decodeBAAudio,installBAScheduledAudio} from './studio-audio-clock.mjs';\nimport {baVoiceDucking} from './studio-voice-layout.mjs';\n"+portableAudio;
const portableConfig=exact(originalConfig.replace(pairCheck,immediateCheck),"    if(!config._jour_1)throw Error('La première date de diffusion est obligatoire.');",'    // The operator may explicitly hide the complete appointment block.')
  .replace('visibility(get(pair[1]),!!day);','visibility(get(pair[1]),!!day&&!!hour);')
  .replace("from './audio.mjs'","from './studio-audio.mjs'");
let portable=original.replace('const next=normalizeConfig(raw,this.data),','const next=normalizeTextConfig(raw,this.data,normalizeConfig),')
  .replace('validateTextWidths(configured.data);','applyTextEditing(configured.data,next,validateTextWidths);')
  .replace("from './config.mjs'","from './studio-config.mjs'")
  .replace("from './audio.mjs'","from './studio-audio.mjs'")
  .replace("const changedAudio=initial||reload||", "const changedAudio=initial||reload||next._studio_ba_voice_fit!==this.data._studio_ba_voice_fit||");
if(portable===original||!portable.includes('normalizeTextConfig(raw'))throw Error('BA editor patch not applied.');
// Schedule before drawing: a costly canvas frame must not make the audio clock
// look late or drop the beginning of a voice. IN/OUT also establish their clock
// synchronously, before their next animation frame.
portable=exact(portable,'const mediaFrame=this.state.phase',"this.audio.sync(times.main,{playing:true,muted:this.muted});const mediaFrame=this.state.phase");
portable=exact(portable,'this._drawnMediaFrame=mediaFrame;}this.audio.sync(times.main,{playing:true,muted:this.muted});','this._drawnMediaFrame=mediaFrame;}');
// A device can report `running` while its clock is still at zero. Never start
// the performance/graphics clock before audio is actually advancing. Stops,
// seeks and disposal during this wait must not resurrect a pending IN.
portable=exact(portable,'this.audio.stop();this.media.pause();this._offset=', 'this.audio.stop();const audioGeneration=this.audio.generation;this.media.pause();this._offset=');
portable=exact(portable,'this._drawnFrame=null;this._drawnMediaFrame=null;',"if(this.state.disposed||audioGeneration!==this.audio.generation)throw new DOMException('Lecture annulée.','AbortError');if(!this.muted)await this.audio.unlock();if(this.state.disposed||audioGeneration!==this.audio.generation)throw new DOMException('Lecture annulée.','AbortError');this._drawnFrame=null;this._drawnMediaFrame=null;");
portable=exact(portable,'this._inDone=deferred();completion=this._inDone.promise;if(!this.muted)void this.audio.unlock().catch(e=>this._error(e));',"this._inDone=deferred();completion=this._inDone.promise;this.audio.sync(start,{playing:true,muted:this.muted,discontinuity:true});");
portable=exact(portable,'this._pending?.abort();let completion;', 'this._pending?.abort();if(args.skipAnimation)this.audio?.stop();let completion;');
portable=exact(portable,"await this._queue(()=>{if(!this.state.loaded||['ready','stopped'].includes(this.state.phase))", "await this._queue(async()=>{if(!this.state.loaded||['ready','stopped'].includes(this.state.phase))");
portable=exact(portable,"const wasRunning=this._running;this.scene.container.style.visibility='visible';this._beginOut('manual');", "const wasRunning=this._running,audioGeneration=this.audio.generation;if(!wasRunning&&!this.muted)await this.audio.unlock();if(this.state.disposed||audioGeneration!==this.audio.generation)throw new DOMException('Lecture annulée.','AbortError');this.scene.container.style.visibility='visible';this._beginOut('manual');");
portable=exact(portable,'this._outReason=reason;',"this._outReason=reason;this.audio.sync(64.8,{playing:true,muted:this.muted,discontinuity:true});");
portable="import {normalizeTextConfig,applyTextEditing} from './studio-text-layout.mjs';\n"+portable;
// Portable edition for the HTML package; public edition resolves immutable resources
// at their original address (sponsor, media and font URLs must not move).
const online=portable.replace(/from '\.\/(?!studio-text-layout|studio-config|studio-audio)([^']+)'/g,"from '/library/v1.7.0/BTV_BA_1P/$1'")
  .replace("'./studio-text-layout.mjs'","'./text-layout.mjs'")
  .replace("'./studio-config.mjs'","'./config.mjs'")
  .replace("'./studio-audio.mjs'","'./audio.mjs'")
  .replace('const BASE=import.meta.url;',"const BASE=new URL('/library/v1.7.0/BTV_BA_1P/graphic.mjs',import.meta.url).href;");
// Preview can supply bounded media surfaces. Export and portable delivery keep
// the exact native painter; no global patch or source/crop mutation.
const previewOnline=exact(online,'await installMediaCanvases(scene.animation,media,{baseUrl:BASE,signal})','await (this.__installPreviewMediaCanvases||installMediaCanvases)(scene.animation,media,{baseUrl:BASE,signal})');
const nativeMedia=await readFile(resolve(root,'public/library/v1.7.0/BTV_BA_1P/media.mjs'),'utf8');
if(createHash('sha256').update(nativeMedia).digest('hex')!=='9e955794db66e24d4c14b16a65ef2bad92e8712c042f25c191a301f65bee6924')throw Error('BA media source changed: requalify preview colour.');
const previewColour=nativeMedia.slice(nativeMedia.indexOf('class PackGrade{'),nativeMedia.indexOf('export async function installMediaCanvases'));
if(!previewColour.startsWith('class PackGrade{'))throw Error('Native BA colour component missing.');
const directory=resolve(root,'public/studio-engines/ba-text-v2'),layout=await readFile(resolve(root,'public/studio-engines/ba-text-v1/text-layout.mjs'),'utf8');
await mkdir(directory,{recursive:true});
await writeFile(resolve(directory,'graphic.mjs'),previewOnline);
await writeFile(resolve(directory,'preview-colour.mjs'),'export '+previewColour);
await writeFile(resolve(directory,'portable.mjs'),portable);
await writeFile(resolve(directory,'config.mjs'),portableConfig.replace(/from '\.\/(?!studio-audio)([^']+)'/g,"from '/library/v1.7.0/BTV_BA_1P/$1'").replace("'./studio-audio.mjs'","'./audio.mjs'"));
await writeFile(resolve(directory,'audio.mjs'),portableAudio.replace("'./studio-voice-layout.mjs'","'./voice-layout.mjs'").replace("'./studio-audio-clock.mjs'","'./audio-clock.mjs'"));
await writeFile(resolve(directory,'voice-layout.mjs'),voiceLayout);
await writeFile(resolve(directory,'audio-clock.mjs'),audioClock);
await writeFile(resolve(directory,'text-layout.mjs'),layout);
await writeFile(resolve(root,'src/studio/ba-editor.generated.json'),JSON.stringify({graphic:portable,config:portableConfig,audio:portableAudio,voiceLayout,audioClock,layout}));
console.log('BA text editor generated from SHA-256 pinned engine; original library unchanged.');
