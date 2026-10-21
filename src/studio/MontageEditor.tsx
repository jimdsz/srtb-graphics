import {useEffect,useRef,useState} from 'react';
import {ArrowDown,ArrowUp,Copy,Film,Plus,Scissors,Trash2} from 'lucide-react';
import type {BroadcastTemplate,FieldValue,MediaAsset,ProjectData} from './domain';
import type {CropClip} from './sequence-crop';
import {clipCropData,editCropSequence,patchClipCrop,sequenceCropKey} from './sequence-crop';
import {IMAGE_SIZES,readImageSizes,reorderImageSizes} from './image-sizing-model';
import {mediaKind} from './media-trim';
import {presentation} from './presentation';
import {mediaFieldInactive} from './media-selection';
import {activateMedia} from './media-trim';
import {CE_SOIR_BACKGROUND,ceSoirBackground} from './ce-soir-background';
import {HelpBubble} from './GraphicsHelp';
import {localURL,sameLocalMediaSource} from './local-media';
import {montageClipDuration,montageClipIssue,montageDuration,montageEdit,montageLabel,montageSource,parseMontage,seedMontageClip} from './montage-model';
import MediaSelect from './MediaSelect';
import MediaTrim from './MediaTrim';
import MediaCrop from './MediaCrop';
import ImageSize from './ImageSize';
import './montage-editor.css';

interface Props {
  id:string;name:string;value:string;media:MediaAsset[];onPatch:(patch:ProjectData)=>void;
  primary:FieldValue;start:number;end:number;limit:number;template:BroadcastTemplate;data:ProjectData;
}
const seconds=(value:number)=>`${new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(value)} s`;
const resolvedSource=(value:FieldValue)=>{const source=montageSource(value);try{return localURL(source);}catch{return source;}};
interface RemovalSnapshot {action:'remove'|'reset';value:string;after:string;keys:string[];selected:string|null;crops:FieldValue|undefined;sizes:Record<string,number>}

/** The original playlist format is also the preview/export format. Stable local
 * keys keep an asynchronous file choice bound to its excerpt after UI edits. */
export default function MontageEditor({id,name,value,media,onPatch,primary,start,end,limit,template,data}:Props){
  const latest=useRef(data);latest.current=data;
  const serial=useRef(0),newKey=()=>`${id}-clip-${++serial.current}`;
  const parsed=parseMontage(value),clips=parsed??[];
  const identity=useRef<{value:string;keys:string[]}|null>(null);
  if(!identity.current)identity.current={value,keys:clips.map(newKey)};
  else if(identity.current.value!==value){
    const previous=parseMontage(identity.current.value);
    // A completed local fingerprint changes its reference, not its source or
    // place in the montage. Preserve selection and the mounted excerpt editor.
    const sameClips=previous?.length===clips.length&&previous.every((item,index)=>item.start===clips[index].start&&item.end===clips[index].end&&sameLocalMediaSource(montageSource(item.url),montageSource(clips[index].url)));
    identity.current={value,keys:sameClips?identity.current.keys:clips.map(newKey)};
  }
  const [selected,setSelected]=useState<string|null>(null),[error,setError]=useState(''),[busyKeys,setBusyKeys]=useState<Set<string>>(()=>new Set());
  const [announcement,setAnnouncement]=useState('');
  const [removed,setRemoved]=useState<RemovalSnapshot|null>(null);
  const busyRef=useRef(busyKeys);busyRef.current=busyKeys;
  const editorRef=useRef<HTMLDivElement>(null),createButton=useRef<HTMLButtonElement>(null),resetButton=useRef<HTMLButtonElement>(null),focusNext=useRef<'source'|'clip'|'create'|'reset'|null>(null),listButtons=useRef(new Map<string,HTMLButtonElement>());
  const keys=identity.current.keys,selectedIndex=Math.max(0,keys.indexOf(selected??'')),selectedKey=keys[selectedIndex],clip=clips[selectedIndex];
  const kind=name.slice(7,-9),social=presentation(data)!=='tv'&&sequenceCropKey(kind) in template.fields,primaryKey=name.replace(/_sequence$/,'_url');
  const inactive=mediaFieldInactive(data,primaryKey);
  const busy=busyKeys.size>0,requestedRate=Number(data[`_media_${kind}_rate`]||1),rate=Number.isFinite(requestedRate)&&requestedRate>0?requestedRate:1,duration=montageDuration(clips,rate);
  useEffect(()=>{
    if(focusNext.current==='source')editorRef.current?.querySelector<HTMLSelectElement>('select')?.focus();
    else if(focusNext.current==='clip'&&selectedKey)listButtons.current.get(selectedKey)?.focus();
    else if(focusNext.current==='create')createButton.current?.focus();
    else if(focusNext.current==='reset')resetButton.current?.focus();
    focusNext.current=null;
  },[value,selectedKey]);
  useEffect(()=>{if(removed&&removed.after!==value)setRemoved(null);},[value,removed]);

  function commit(patch:ProjectData){setRemoved(null);latest.current={...latest.current,...patch};onPatch(patch);}
  function current(){return parseMontage(latest.current[name]);}
  function save(next:CropClip[],origins:number[],options?:{keys?:string[];select?:number;focus?:'source'|'clip'|'create';promote?:boolean}){
    try{
      const sizes=reorderImageSizes(latest.current,name,origins);
      if(options?.promote){
        const previous=readImageSizes(latest.current),nextSizes=readImageSizes(sizes),primaryKey=name.replace(/_sequence$/,'_url');
        for(const format of ['tv','portrait','vertical'])if(previous[`${format}:${primaryKey}`]!==undefined)nextSizes[`${format}:${name}:0`]=previous[`${format}:${primaryKey}`];
        sizes[IMAGE_SIZES]=JSON.stringify(nextSizes);
      }
      const patch={...sizes,...(sequenceCropKey(kind) in template.fields?editCropSequence(latest.current,kind,next,origins):{[name]:JSON.stringify(next)})};
      const nextKeys=options?.keys??identity.current!.keys;
      identity.current={value:String(patch[name]),keys:nextKeys};
      if(options?.select!==undefined)setSelected(nextKeys[options.select]??null);
      focusNext.current=options?.focus??null;
      setError('');commit(patch);return true;
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));return false;}
  }
  function update(key:string,patch:Partial<CropClip>){
    const list=current(),index=identity.current!.keys.indexOf(key);
    if(!list||index<0||!list[index])return;
    save(list.map((item,i)=>i===index?{...item,...patch}:item),list.map((_,i)=>i));
  }
  function reportBusy(key:string,reading:boolean){
    const next=new Set(busyRef.current);if(reading)next.add(key);else next.delete(key);
    busyRef.current=next;setBusyKeys(next);
  }
  function create(){
    if(busyRef.current.size)return;
    const first=seedMontageClip(primary,start,end);
    if(save([first],[-1],{keys:[newKey()],select:0,focus:'source',promote:!!montageSource(primary)}))setAnnouncement('Montage créé. Ajoutez un autre extrait pour les enchaîner.');
  }
  function edit(action:Parameters<typeof montageEdit>[1]){
    if(busyRef.current.size)return;
    const list=current();if(!list)return;
    if((action.type==='append'||action.type==='duplicate')&&list.length>=limit)return;
    let next:ReturnType<typeof montageEdit>;
    try{next=montageEdit(list,action);}catch(reason){setError(reason instanceof Error?reason.message:String(reason));return;}
    const oldKeys=identity.current!.keys,used=new Set<string>();
    const snapshot:Omit<RemovalSnapshot,'after'>={action:'remove',value:String(latest.current[name]),keys:[...oldKeys],selected:selectedKey??null,crops:latest.current[sequenceCropKey(kind)],sizes:Object.fromEntries(Object.entries(readImageSizes(latest.current)).filter(([key])=>key.includes(`:${name}:`)))};
    const nextKeys=next.origins.map(origin=>{const key=oldKeys[origin];if(key&&!used.has(key)){used.add(key);return key;}return newKey();});
    const index=action.type==='append'?next.clips.length-1:action.type==='duplicate'?action.index+1:action.type==='move'?action.to:Math.min(action.index,next.clips.length-1);
    if(save(next.clips,next.origins,{keys:nextKeys,select:index,focus:next.clips.length? action.type==='append'?'source':'clip':'create'})){
      if(action.type==='remove')setRemoved({...snapshot,after:String(latest.current[name])});
      setAnnouncement(action.type==='append'?'Extrait ajouté. Choisissez son média.':action.type==='duplicate'?'Extrait dupliqué. Ses repères sont conservés.':action.type==='move'?`Extrait déplacé en position ${index+1}.`:next.clips.length?'Extrait retiré.':`Montage retiré. ${montageSource(primary)?'Le média principal est de nouveau utilisé.':'Choisissez un média ou créez un montage.'}`);
    }
  }
  function reset(){
    const snapshot:Omit<RemovalSnapshot,'after'>={action:'reset',value:String(latest.current[name]),keys:[],selected:null,crops:latest.current[sequenceCropKey(kind)],sizes:Object.fromEntries(Object.entries(readImageSizes(latest.current)).filter(([key])=>key.includes(`:${name}:`)))};
    if(save([],[],{keys:[],select:0,focus:'create'})){setRemoved({...snapshot,after:String(latest.current[name])});setAnnouncement('Montage réinitialisé. Vous pouvez annuler cette action.');}
  }
  function undoRemoval(){
    if(!removed||String(latest.current[name])!==removed.after||busyRef.current.size)return;
    const sizes=readImageSizes(latest.current);
    for(const key of Object.keys(sizes))if(key.includes(`:${name}:`))delete sizes[key];
    Object.assign(sizes,removed.sizes);
    const patch:ProjectData={[name]:removed.value,[IMAGE_SIZES]:JSON.stringify(sizes)};
    if(sequenceCropKey(kind) in template.fields)patch[sequenceCropKey(kind)]=removed.crops??'[]';
    identity.current={value:removed.value,keys:[...removed.keys]};setSelected(removed.selected);focusNext.current=removed.action==='reset'?'reset':'clip';
    commit(patch);setAnnouncement(removed.action==='reset'?'Données du montage rétablies.':'Extrait rétabli avec ses repères et son cadrage.');
  }
  function patchCrop(key:string,patch:ProjectData){
    const list=current(),index=identity.current!.keys.indexOf(key);if(!list||index<0||!list[index])return;
    try{setError('');commit(patchClipCrop(latest.current,kind,list[index],index,patch));}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
  }

  if(!parsed)return <section className="montage-editor" id={id} aria-label="Montage"><p role="alert">Ce montage est illisible. Ses extraits ne peuvent pas être affichés.</p><button type="button" ref={resetButton} onClick={reset}>Réinitialiser le montage</button></section>;
  return <section className="montage-editor" id={id} aria-label="Montage">
    <div className="montage-heading"><span><Scissors size={17} aria-hidden="true"/><strong>Montage</strong><HelpBubble section="montage"/></span>{clips.length?<span className="montage-count">{clips.length} / {limit} extraits</span>:null}</div>
    <p className="montage-intro">Assemblez vos extraits dans l’ordre de lecture, directement ici.</p>
    {inactive&&clips.length?<div className="montage-inactive"><strong>{primaryKey==='_media_background_url'?(ceSoirBackground(data)?'Montage masqué par le fond uni':'Montage masqué — fond transparent'):'Piste du montage désactivée'}</strong><small>Les extraits sont conservés. Activez cette piste pour les voir dans l’aperçu et l’export.</small><button type="button" onClick={()=>commit(template.id==='BTV_Ce_Soir'&&primaryKey==='_media_background_url'?{[CE_SOIR_BACKGROUND]:'original'}:activateMedia(primaryKey))}>{primaryKey==='_media_background_url'?'Afficher le montage en fond':'Activer cette piste'}</button></div>:null}
    {error?<p className="montage-error" role="alert">{error}</p>:null}
    {removed?<div className="montage-undo"><span>{removed.action==='reset'?'Montage réinitialisé.':'Extrait retiré.'}</span><button type="button" disabled={busy} onClick={undoRemoval}>{removed.action==='reset'?'Annuler la réinitialisation':'Annuler la suppression'}</button></div>:null}
    <span className="visually-hidden" role="status" aria-live="polite">{announcement}</span>
    {!clips.length?<div className="montage-empty"><button type="button" ref={createButton} onClick={create}><Plus size={16} aria-hidden="true"/>Créer un montage</button><small>{montageSource(primary)?'Le média principal et ses repères deviennent le premier extrait.':'Choisissez un premier média, puis ajoutez vos autres extraits.'}</small></div>:<>
      <div className="montage-duration" aria-live="polite"><span>Durée des extraits</span><strong>{duration.unknown?duration.seconds>0?`${seconds(duration.seconds)} + à définir`:'À définir':seconds(duration.seconds)}</strong></div>
      {duration.unknown?<small className="montage-duration-help">Durée à préciser pour {duration.unknown} extrait{duration.unknown>1?'s':''}. Choisissez leur média et leurs repères de fin pour connaître le total.</small>:null}
      <ol className="montage-list" aria-label="Ordre des extraits">
        {clips.map((item,index)=>{
          const length=montageClipDuration(item),issue=montageClipIssue(item),active=index===selectedIndex,key=keys[index];
          return <li key={key}><button type="button" ref={node=>{if(node)listButtons.current.set(key,node);else listButtons.current.delete(key);}} aria-pressed={active} aria-controls={`${id}-selected`} aria-label={`Modifier l’extrait ${index+1} : ${montageLabel(item.url)}`} disabled={busy&&!active} onClick={()=>setSelected(key)}>
            <span className="montage-number">{index+1}</span><span className="montage-item-copy"><strong>{montageLabel(item.url)}</strong><small>{issue?'À compléter':`${seconds(item.start)} → ${item.end?seconds(item.end):'fin du fichier'}`}</small></span><span className="montage-item-duration">{length===null?'—':seconds(length/(rate>0?rate:1))}</span>
          </button></li>;
        })}
      </ol>
      <button type="button" className="montage-add" disabled={busy||clips.length>=limit} onClick={()=>edit({type:'append',clip:seedMontageClip()})}><Plus size={16} aria-hidden="true"/>Ajouter un extrait</button>
      {clips.length>=limit?<small className="montage-limit">Ce modèle accepte jusqu’à {limit} extraits.</small>:null}
      {clip?<div className="montage-selected" id={`${id}-selected`} ref={editorRef} key={selectedKey}>
        <div className="montage-selected-heading"><strong><Film size={16} aria-hidden="true"/>Extrait {selectedIndex+1}</strong><span>{!montageSource(clip.url)?'Média à choisir':montageClipIssue(clip)?'Repères à vérifier':montageClipDuration(clip)===null?'Jusqu’à la fin du fichier':seconds((montageClipDuration(clip)??0)/rate)}</span></div>
        <div className="montage-order-actions" aria-label={`Actions sur l’extrait ${selectedIndex+1}`}>
          <button type="button" disabled={busy||selectedIndex===0} aria-label={`Monter l’extrait ${selectedIndex+1}`} onClick={()=>edit({type:'move',from:selectedIndex,to:selectedIndex-1})}><ArrowUp size={15} aria-hidden="true"/>Monter</button>
          <button type="button" disabled={busy||selectedIndex===clips.length-1} aria-label={`Descendre l’extrait ${selectedIndex+1}`} onClick={()=>edit({type:'move',from:selectedIndex,to:selectedIndex+1})}><ArrowDown size={15} aria-hidden="true"/>Descendre</button>
          <button type="button" disabled={busy||clips.length>=limit} aria-label={`Dupliquer l’extrait ${selectedIndex+1}`} onClick={()=>edit({type:'duplicate',index:selectedIndex})}><Copy size={15} aria-hidden="true"/>Dupliquer</button>
          <button type="button" disabled={busy} aria-label={`Retirer l’extrait ${selectedIndex+1}`} onClick={()=>edit({type:'remove',index:selectedIndex})}><Trash2 size={15} aria-hidden="true"/>Retirer</button>
        </div>
        <label htmlFor={`${id}-source`}>Média de l’extrait {selectedIndex+1}</label>
        <MediaSelect id={`${id}-source`} field={{'x-control':'media'}} value={clip.url} media={media} emptyLabel="Choisir un média…" onChange={source=>update(selectedKey,seedMontageClip(source))} onRange={range=>update(selectedKey,range)} onBusyChange={reading=>reportBusy(selectedKey,reading)}/>
        {!montageSource(clip.url)?<p className="montage-notice">Choisissez un média pour cet extrait, ou retirez-le du montage.</p>:<>
          <div className="montage-times">
            {mediaKind(clip.url)!=='image'||clip.start!==0?<label htmlFor={`${id}-start`}>Début (s)<input id={`${id}-start`} name={`${name}:start`} autoComplete="off" type="number" min="0" max={mediaKind(clip.url)==='image'?0:86400} step="0.04" value={clip.start} onChange={event=>update(selectedKey,{start:Number(event.target.value)})}/></label>:null}
            <label htmlFor={`${id}-end`}>{mediaKind(clip.url)==='image'?'Durée d’affichage (s)':'Fin (s)'}<input id={`${id}-end`} name={`${name}:end`} autoComplete="off" type="number" min={mediaKind(clip.url)==='image'?.04:0} max="86400" step="0.04" value={clip.end} onChange={event=>update(selectedKey,{end:Number(event.target.value)})}/></label>
          </div>
          {mediaKind(clip.url)!=='image'?<small className="montage-end-help">Fin à 0 : lire jusqu’à la fin du fichier.</small>:null}
          {montageClipIssue(clip)?<p role="alert" className="montage-error">{montageClipIssue(clip)}</p>:null}
          <MediaTrim value={clip.url} module={template.module} start={clip.start} end={clip.end} onChange={range=>update(selectedKey,range)}/>
          <ImageSize value={clip.url} field={`${name}:${selectedIndex}`} data={data} onPatch={commit}/>
          {social?<SequenceCropControls key={`${selectedKey}:${resolvedSource(clip.url)}:${clip.start}:${clip.end}:${data._studio_format}`} template={template} data={data} kind={kind} clip={clip} index={selectedIndex} onPatch={patch=>patchCrop(selectedKey,patch)}/>:null}
        </>}
      </div>:null}
      <small className="montage-preview-help">L’aperçu et l’export lisent les extraits dans cet ordre. La durée finale dépend aussi des réglages de sortie du modèle. Le média principal est conservé ; retirer tous les extraits le réactive.</small>
    </>}
  </section>;
}

function SequenceCropControls({template,data,kind,clip,index,onPatch}:{template:BroadcastTemplate;data:ProjectData;kind:string;clip:CropClip;index:number;onPatch:(patch:ProjectData)=>void}){
  const settings=clipCropData(data,kind,clip,index),fit=`_studio_${kind}_fit`;
  return <details className="montage-crop"><summary>Cadrage de cet extrait · {data._studio_format==='vertical'?'9:16':'4:5'}</summary>
    <label>Cadrage de l’extrait {index+1}<select value={String(settings[fit])} onChange={event=>onPatch({[fit]:event.target.value})}><option value="cover">Remplir le cadre · recadrer</option><option value="contain">Image entière · sans coupe</option></select></label>
    <MediaCrop value={clip.url} template={template} kind={kind} data={settings} start={clip.start} imageField={`_media_${kind}_sequence:${index}`} onPatch={onPatch}/>
    <small>Cet extrait conserve son cadrage quand vous le déplacez.</small>
  </details>;
}
