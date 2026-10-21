export interface CommercialWrappedLine {start:number;end:number;text:string}
const graphemes=new Intl.Segmenter('fr',{granularity:'grapheme'});
export const readableDisplayText=(text:string)=>text.replace(/\t/g,'    ');

/** Offsets always address the original string, including CRLF and whitespace. */
export function wrapReadableText(text:string,width:number,measure:(text:string)=>number):CommercialWrappedLine[] {
  if(!Number.isFinite(width)||width<=0)throw Error('La largeur du texte est invalide.');
  const first=text.search(/\S/u);
  if(first<0)return [{start:0,end:text.length,text:''}];
  const last=text.trimEnd().length,units=[...graphemes.segment(text.slice(first,last))].map(unit=>({start:first+unit.index,end:first+unit.index+unit.segment.length,text:unit.segment}));
  const lines:CommercialWrappedLine[]=[];let begin=0,i=0,breakAt=-1;
  const push=(endIndex:number,displayEnd=endIndex)=>{
    const start=units[begin]?.start??last,end=endIndex<units.length?units[endIndex].start:last;
    const contentEnd=displayEnd<units.length?units[displayEnd].start:last;
    lines.push({start:lines.length?start:0,end,text:readableDisplayText(text.slice(start,contentEnd).replace(/[\t \u00a0]+$/u,''))});
    begin=endIndex;i=endIndex;breakAt=-1;
  };
  while(i<units.length){
    const unit=units[i];
    if(/^[\r\n]+$/.test(unit.text)){push(i+1,i);continue;}
    const candidate=readableDisplayText(text.slice(units[begin].start,unit.end));
    if(i===begin||measure(candidate)<=width+1e-7){i++;if(/^[\t \u00a0]+$/u.test(unit.text))breakAt=i;continue;}
    push(breakAt>begin?breakAt:i);
  }
  if(begin<units.length)push(units.length);
  if(lines.length)lines[lines.length-1].end=text.length;
  return lines;
}

/** Every resulting string is an exact contiguous slice; joining restores input. */
export function paginateReadableText(text:string,width:number,maxLines:number,measure:(text:string)=>number):string[] {
  if(!Number.isInteger(maxLines)||maxLines<1)throw Error('Aucune ligne ne tient avec ces réglages. Réduisez la taille du titre ou l’interligne.');
  const chunks:string[]=[];let remaining=text;
  do {
    const lines=wrapReadableText(remaining,width,measure);
    if(lines.some(line=>measure(line.text)>width+.01))throw Error('Un caractère dépasse la largeur disponible. Réduisez la taille ou l’espacement du texte.');
    if(lines.length<=maxLines){chunks.push(remaining);break;}
    let end=lines[maxLines-1].end;
    // A page boundary absorbs its adjacent whitespace. It remains in the saved
    // text, without creating an empty sequence for a paragraph separator.
    while(end<remaining.length&&/\s/u.test(remaining[end]))end++;
    if(end<=0)throw Error('Impossible de répartir ce texte avec les réglages actuels.');
    chunks.push(remaining.slice(0,end));remaining=remaining.slice(end);
  }while(remaining.length);
  return chunks;
}
