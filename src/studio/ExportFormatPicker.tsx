import {useId} from 'react';
import {FileVideo,Film,Images,Globe,Check} from 'lucide-react';
import type {VideoFormat} from './video/export';

const choices=[
  {value:'mp4',title:'MP4',codec:'H.264',detail:'Fond opaque',Icon:FileVideo},
  {value:'mov',title:'MOV',codec:'ProRes 4444',detail:'Transparence alpha',Icon:Film},
  {value:'png',title:'PNG',codec:'Séquence · ZIP',detail:'Transparence alpha',Icon:Images},
  {value:'alpha',title:'WebM',codec:'VP9',detail:'Transparence alpha',Icon:Globe},
] as const;

/** Presentation only: values are the existing export formats, with native radio navigation. */
export default function ExportFormatPicker({value,onChange}:{value:VideoFormat;onChange:(format:VideoFormat)=>void}){
  const name=useId();
  return <div className="delivery-formats" role="group" aria-label="Format d’export">
    {choices.map(({value:format,title,codec,detail,Icon})=><label key={format} className={`delivery-format${value===format?' selected':''}`}>
      <input type="radio" name={name} value={format} checked={value===format} onChange={()=>onChange(format)} aria-label={`${title} · ${codec} · ${detail}`}/>
      <span className="delivery-format-top"><Icon size={18} aria-hidden="true"/><strong>{title}</strong>{value===format?<Check size={14} className="delivery-format-check" aria-hidden="true"/>:null}</span>
      <span className="delivery-format-codec">{codec}</span>
      <span className={`delivery-format-alpha${format==='mp4'?' opaque':''}`}><i aria-hidden="true"/>{detail}</span>
    </label>)}
  </div>;
}
