export interface NativeTextRun {field:string;start:number;end:number}
export const canonicalSocialText=(text:unknown)=>String(text??'').normalize('NFC').split('\n').map(line=>line.split(/\s+/).filter(Boolean).join(' ')).join('\n');
/** Preserve the already fitted combined line, while identifying editable runs. */
export function socialTextRuns(parts:{field:string;text:unknown;separator?:string}[]){
  let text='';const runs:NativeTextRun[]=[];
  for(const part of parts){const value=canonicalSocialText(part.text);if(!value)continue;if(text)text+=part.separator??'\n';const start=text.length;text+=value;runs.push({field:part.field,start,end:text.length});}
  return {text,runs};
}
export function socialLineRuns(line:string,start:number,runs:NativeTextRun[]){
  const end=start+line.length,cuts=new Set([start,end]);for(const run of runs){if(run.start>start&&run.start<end)cuts.add(run.start);if(run.end>start&&run.end<end)cuts.add(run.end);}
  const points=[...cuts].sort((a,b)=>a-b);return points.slice(0,-1).map((from,index)=>({field:runs.find(run=>from>=run.start&&from<run.end)?.field||'',text:line.slice(from-start,points[index+1]-start),prefix:line.slice(0,from-start)}));
}
