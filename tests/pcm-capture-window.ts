export type PCMChunk={firstFrame:number;channels:Float32Array[]};

/** Strict extraction of an observed interval, never silence-filled across a
 * missing quantum. Clock discontinuities outside it remain separate evidence. */
export function captureWindow(chunks:PCMChunk[],firstFrame:number,endFrame:number){
  if(!Number.isSafeInteger(firstFrame)||!Number.isSafeInteger(endFrame)||endFrame<=firstFrame)throw Error('Bornes PCM invalides.');
  const channels=[new Float32Array(endFrame-firstFrame),new Float32Array(endFrame-firstFrame)];let cursor=firstFrame,previousEnd=-Infinity;
  for(const chunk of chunks){
    const count=chunk.channels[0]?.length,at=chunk.firstFrame,end=at+count;
    if(!Number.isSafeInteger(at)||!count||chunk.channels.length!==2||chunk.channels[1].length!==count)throw Error('Bloc PCM invalide.');
    if(at<previousEnd)throw Error('Blocs PCM en recouvrement ou dans le désordre.');previousEnd=end;
    if(end<=firstFrame||at>=endFrame)continue;
    const start=Math.max(at,firstFrame),finish=Math.min(end,endFrame);
    if(start!==cursor)throw Error(`Lacune dans la fenêtre PCM : attendu ${cursor}, reçu ${start}.`);
    for(let c=0;c<2;c++)channels[c].set(chunk.channels[c].subarray(start-at,finish-at),start-firstFrame);
    cursor=finish;
  }
  if(cursor!==endFrame)throw Error(`Fenêtre PCM incomplète : fin ${cursor}, attendue ${endFrame}.`);
  return {firstFrame,channels};
}
