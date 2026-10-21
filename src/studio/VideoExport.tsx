import {useState,useSyncExternalStore} from 'react';
import type {BroadcastTemplate} from './domain';
import type {Project} from './domain';
import {exportQueue} from './export-queue';
import type {VideoFormat,VideoReport} from './video/export';
import {TIMINGS} from './video/timeline';
import {baSocialDirect} from './ba-social-direct';
import {dimensions} from './presentation';
import {NATIVE_ONLY_EXPORT} from './video/release-profile';
import {CircleCheck,ListVideo,Info,Monitor,ShieldCheck} from 'lucide-react';
import ExportFormatPicker from './ExportFormatPicker';
import './delivery-workbench.css';

function bitrateLabel(value:number|undefined){
  return typeof value==='number'&&Number.isFinite(value)&&value>=0?`${(value/1_000_000).toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})} Mb/s`:'non mesuré';
}

export function ExportReport({report}:{report:VideoReport}){
  const hasVideoBitrate=typeof report.videoBitrate==='number'&&Number.isFinite(report.videoBitrate);
  const fallback=!NATIVE_ONLY_EXPORT&&report.bitrateFallback==='ffmpeg-x264-cbr';
  return <section className="delivery-report" aria-label="Rapport du fichier exporté">
    <h4 className="delivery-report-heading"><CircleCheck size={17} aria-hidden="true"/>Fichier contrôlé</h4>
    <dl className="delivery-report-metrics"><div><dt>Durée</dt><dd>{report.duration.toFixed(2)} s</dd></div><div><dt>Poids</dt><dd>{(report.bytes/1024**2).toFixed(1)} Mo</dd></div><div><dt>Images</dt><dd>{report.frames}</dd></div></dl>
    <p>{report.format==='mov'?'ProRes 4444 · alpha contrôlé':report.format==='png'?'PNG RGBA · alpha contrôlé':report.alpha?'VP9 · alpha contrôlé':'H.264'} · {report.audio?(report.format==='png'?'WAV 48 kHz / 24 bits':report.format==='mov'?'PCM 48 kHz / 24 bits':'son 48 kHz'):'sans son'}.</p>
    {report.format!=='png'&&hasVideoBitrate?<p><strong>Débit vidéo moyen mesuré : {bitrateLabel(report.videoBitrate)}</strong>{report.format==='mp4'?<><br/>Minimum mesuré sur 1 s : <strong>{report.bitrateMeasurementWindows===0?'aucune fenêtre complète':bitrateLabel(report.minimumOneSecondVideoBitrate)}</strong>{typeof report.bitrateMeasurementWindows==='number'&&report.bitrateMeasurementWindows>0?` · ${report.bitrateMeasurementWindows} fenêtres contrôlées`:null}.</>:null}</p>:null}
    {report.format==='mp4'?<>
      <p>Profil demandé : cible <strong>{bitrateLabel(report.targetVideoBitrate)}</strong>{report.bitrateMode==='constant'?' en mode CBR':null}.{report.exportProfile==='native-only'?' Édition native : le plancher de 30 Mb/s n’est pas garanti.':<> Plancher de contrôle : <strong>{bitrateLabel(report.minimumVideoBitrate)}</strong> pour la moyenne et les fenêtres de 1 s mesurées.</>}</p>
      {report.bitrateWarning?<p className="notice warning" role="alert">{report.bitrateWarning}</p>:null}
      <details className="export-options"><summary>Encodage et méthode de mesure</summary>
        <p>{fallback?'Réencodage local FFmpeg / libx264 après contrôle de l’export natif.':'Encodage natif du navigateur (WebCodecs), sans réencodage FFmpeg.'}{fallback&&typeof report.cbrSegments==='number'?` ${report.cbrSegments} segments traités.`:null}{report.encoderCodec?` Codec : ${report.encoderCodec}.`:null}</p>
        {typeof report.nativeVideoBitrate==='number'?<p>Avant tout réencodage, le navigateur avait produit une moyenne de <strong>{bitrateLabel(report.nativeVideoBitrate)}</strong>{typeof report.nativeMinimumOneSecondVideoBitrate==='number'?<> et un minimum sur 1 s de <strong>{bitrateLabel(report.nativeMinimumOneSecondVideoBitrate)}</strong></>:null}.</p>:null}
        <p>Mesures sur la piste vidéo seule, hors son et conteneur. Le minimum porte sur les fenêtres complètes de 1 s contrôlées, pas sur chaque image. Le mode CBR demandé ne prouve pas un débit identique à chaque instant.</p>
        {fallback?<p>Le remplissage CBR peut augmenter le débit sans ajouter de détail à l’image ni améliorer la qualité des médias sources.</p>:null}
      </details>
    </>:null}
    <p className="small">Contrôle après encodage : {report.checkedFrames.length} images échantillonnées.{report.format==='png'?' Tous les fichiers du ZIP ont été contrôlés.':null}</p>
  </section>;
}

export default function VideoExport({project,template,permitted,unsaved=false}:{project:Project;template:BroadcastTemplate;permitted:boolean;unsaved?:boolean;onRunningChange?:(value:boolean)=>void}){
  const [format,setFormat]=useState<VideoFormat>('mp4'),[audio,setAudio]=useState(true),[removeBackground,setRemoveBackground]=useState(false),[background,setBackground]=useState('#000000');
  const [manualOut,setManualOut]=useState(Number(project.data._out_duration_seconds||TIMINGS[template.id]?.stop||10));
  const [message,setMessage]=useState(''),[error,setError]=useState('');
  const queue=useSyncExternalStore(exportQueue.subscribe,exportQueue.snapshot);
  function render(){
    if(!permitted)return;setError('');
    try{exportQueue.enqueue(project,{format,audio,manualOut,removeBackground,background},{unsaved});setMessage('Ajouté à la file. Vous pouvez continuer à travailler ; retrouvez le fichier dans « Exports ».');}
    catch(cause){setError(cause instanceof Error?cause.message:String(cause));setMessage('');}
  }
  return <section className="delivery-video" aria-label="Export vidéo"><h3>Vidéo ou séquence d’images</h3>
    <div className="delivery-composition"><Monitor size={21} aria-hidden="true"/><div><strong>{dimensions(project.data).label}</strong><small>{dimensions(project.data).width} × {dimensions(project.data).height} · 25 images/s</small></div></div>
    <fieldset><legend>Format du fichier</legend>
      <ExportFormatPicker value={format} onChange={setFormat}/>
      {NATIVE_ONLY_EXPORT&&format==='mp4'?<p className="notice warning">Édition native · cible 50 Mb/s demandée au navigateur en mode constant. Le débit réel dépend du navigateur et du contenu ; le plancher de 30 Mb/s n’est pas encore garanti. Les valeurs mesurées seront affichées après l’export, y compris lorsqu’elles sont inférieures.</p>:null}
      <p className="delivery-format-note">{format==='mp4'?'Sans transparence. Pour un fond transparent, choisissez MOV ou PNG.':format==='mov'?'Transparence et son dans un seul fichier, pour le montage compatible ProRes.':format==='png'?'Images sans perte avec transparence. Le son est fourni en WAV séparé.':'Vidéo VP9 avec transparence, à vérifier dans votre logiciel cible.'}</p>
      <details className="delivery-help"><summary><Info size={13} aria-hidden="true"/>Détails et compatibilité</summary>
        <p>La destination se choisit dans Réglages → Composition. L’export reprend ce format et les réglages affichés.</p>
        {format==='mov'?<><p>ProRes 4444, alpha droit, son PCM 24 bits / 48 kHz si activé. Fichier plus volumineux qu’un MP4, destiné au montage et à la diffusion compatibles ProRes.</p><p>Un écran noir dans un lecteur ne suffit pas à conclure que le fichier est vide. Après le calcul, utilisez « Contrôler les images et la transparence » pour inspecter le MOV lui-même sur un damier. La lecture de ce ProRes alpha pose problème sur le VLC 3.0.21 testé ; vérifiez aussi l’import dans votre logiciel de montage ou de diffusion.</p></>:null}
        {format==='png'?<p>Après décompression du ZIP, importez la première image comme séquence à 25 images/s. Le WAV fourni si le son est activé est synchronisé.</p>:null}
        {format!=='mp4'?<p>Les aplats graphiques du modèle restent présents ; un habillage plein écran peut être opaque par conception. Vérifiez la lecture alpha dans votre logiciel cible.</p>:null}
      </details>
      <details className="export-options delivery-options"><summary>Options · fond et son <span className="delivery-option-state">{audio?'Son inclus':'Sans son'}</span></summary>
      {format==='mp4'?<label>Fond de composition<select value={background} onChange={e=>setBackground(e.target.value)}><option value="#000000">Noir</option><option value="#ffffff">Blanc</option><option value="#f0b900">Or BTV</option><option value="#007300">Vert BTV</option><option value="#eb1905">Rouge BTV</option></select></label>:<p className="small">{format==='png'?'Les PNG conservent':format==='mov'?'Le MOV conserve':'Le WebM conserve'} les zones transparentes. Les aplats graphiques du modèle restent présents ; un habillage plein écran peut être opaque par conception. Vérifiez la lecture alpha dans votre logiciel cible.</p>}
      <label className="row"><input type="checkbox" checked={removeBackground} onChange={e=>setRemoveBackground(e.target.checked)}/>Retirer les médias de fond plein écran</label><p className="small muted">Conserve les textes, logos, cartouches et médias des vignettes. Ne change pas le projet enregistré.</p>
      <label className="row"><input type="checkbox" checked={audio} onChange={e=>setAudio(e.target.checked)}/>Inclure les pistes sonores activées dans le projet</label>
      </details>
      {project.data._out_mode==='manual'?<label className="delivery-out"><span>Déclencher OUT après (secondes)<small>{baSocialDirect(template.id,project.data)?'Fin directe, sans animation ajoutée.':'L’animation de fin est ajoutée.'}</small></span><input type="number" aria-label="Déclencher OUT après (secondes)" min={baSocialDirect(template.id,project.data)?.04:TIMINGS[template.id]?.entry||0} max={590} step={.04} value={manualOut} onChange={e=>setManualOut(Number(e.target.value))}/></label>:<p className="delivery-format-note">{baSocialDirect(template.id,project.data)?'Fin directe selon la durée du projet ou des extraits.':'Sortie automatique selon le projet, animation de fin incluse.'}</p>}
    </fieldset>
    <div className="delivery-actions"><button className="primary" disabled={!permitted||queue.items.length>=8} onClick={render}><ListVideo size={16} aria-hidden="true"/>Ajouter à la file d’exports</button><button onClick={exportQueue.openPanel}>Voir les exports{queue.items.length?` · ${queue.items.length}`:''}</button></div>
    {queue.items.length>=8?<p className="notice">File pleine : téléchargez et retirez les fichiers terminés pour libérer une place.</p>:null}
    {message?<p className="delivery-status" role="status">{message}</p>:null}{error?<p className="notice error" role="alert">{error}</p>:null}
    <p className="delivery-format-note">Les réglages de ce lancement sont conservés. Les exports se calculent l’un après l’autre, même si vous changez de projet.</p>
    <p className="delivery-privacy"><ShieldCheck size={14} aria-hidden="true"/><span>Calcul sur ce poste, sans envoi de vos médias. Gardez cet onglet ouvert.</span></p>
    <details className="delivery-help"><summary>Configuration et limites</summary><p>Chrome ou Edge récent · 10 minutes maximum. Prévoyez de l’espace libre sur le disque. La durée du calcul dépend du poste et des médias.{format==='png'?' PNG : jusqu’à 3 Gio par ZIP, selon la durée et les médias.':null}</p><a href="/licenses/NOTICE.txt" target="_blank" rel="noreferrer">Composants et licences</a></details>
  </section>;
}
