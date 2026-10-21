import {ArrowRightToLine,Pause,Play,RotateCcw,Square,Volume2,VolumeX} from 'lucide-react';

/** Presentation-only transport. Playback, audio and export clocks stay in Preview. */
export default function PreviewControls({ready,working,playing,paused,muted,soundLoading,onPlayPause,onRestart,onOut,onClear,onSound}:{
  ready:boolean;working:boolean;playing:boolean;paused:boolean;muted:boolean;soundLoading:boolean;
  onPlayPause:()=>void;onRestart:()=>void;onOut:()=>void;onClear:()=>void;onSound:()=>void;
}){
  const unavailable=!ready||working;
  return <div className="preview-controls monitor-transport" aria-label="Commandes de l’aperçu">
    <div className="transport-playback">
      <button type="button" className="transport-restart" aria-label="Recommencer l’aperçu (IN)" title="Recommencer depuis le début · IN" disabled={unavailable} onClick={onRestart}><RotateCcw size={17} aria-hidden="true"/></button>
      <button type="button" className="primary transport-play" disabled={unavailable} onClick={onPlayPause} aria-label={playing?'Mettre l’aperçu en pause':paused?'Reprendre l’aperçu':'Lire l’aperçu'}>{playing?<Pause size={18} aria-hidden="true"/>:<Play size={18} aria-hidden="true"/>}<span>{playing?'Pause':paused?'Reprendre':'Lire'}</span></button>
      <button type="button" disabled={unavailable||!playing&&!paused} onClick={onOut} title="Jouer l’animation de sortie · OUT"><ArrowRightToLine size={17} aria-hidden="true"/><span>Sortie</span></button>
      <button type="button" className="transport-clear" disabled={unavailable} onClick={onClear} aria-label="Effacer l’aperçu" title="Effacer l’aperçu"><Square size={15} aria-hidden="true"/></button>
    </div>
    <button type="button" className="transport-sound" aria-label={soundLoading?'Préparation du son':muted?'Activer le son':'Couper le son'} title={muted?'Activer les pistes sonores du projet':'Couper le son de l’aperçu'} aria-pressed={!muted} disabled={unavailable||soundLoading} onClick={onSound}>{muted?<VolumeX size={18} aria-hidden="true"/>:<Volume2 size={18} aria-hidden="true"/>}<span>{soundLoading?'Son…':muted?'Son coupé':'Son activé'}</span></button>
  </div>;
}
