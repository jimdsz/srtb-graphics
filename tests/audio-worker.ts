const button=document.querySelector<HTMLButtonElement>('#run')!,status=document.querySelector('pre')!;
button.onclick=()=>void(async()=>{
  button.disabled=true;const results:unknown[]=[];
  try{for(const tempo of [.25,.5,1.5,2,4]){
    const worker=new Worker(new URL('../src/studio/video/stretch.worker.ts',import.meta.url),{type:'module'});
    try{const sr=48000,left=new Float32Array(sr*2),right=new Float32Array(sr*2),frames=Math.round(left.length/tempo);
      for(let i=0;i<left.length;i++)left[i]=Math.sin(2*Math.PI*440*i/sr)*.4;
      const channels=await new Promise<Float32Array[]>((resolve,reject)=>{worker.onerror=()=>reject(Error('Worker failed'));worker.onmessage=({data})=>data.error?reject(Error(data.error)):resolve(data.channels);worker.postMessage({left,right,sampleRate:sr,tempo,frames},{transfer:[left.buffer,right.buffer]});});
      let crossings=0;const from=Math.round(sr*.15),to=frames-Math.round(sr*.15);for(let i=from+1;i<to;i++)if(channels[0][i-1]<=0&&channels[0][i]>0)crossings++;
      const hz=crossings/((to-from)/sr);if(channels[0].length!==frames||!channels[1].every(v=>v===0)||Math.abs(hz-440)>10)throw Error('Durée, hauteur ou stéréo incorrecte');results.push({tempo,frames,hz,success:true});
    }finally{worker.terminate();}
  }status.textContent=JSON.stringify(results,null,2);await fetch('/__video-evidence/audio-worker-'+Date.now()+'.json',{method:'POST',body:JSON.stringify(results)});
  }catch(e){status.textContent=String(e);}finally{button.disabled=false;}
})();
