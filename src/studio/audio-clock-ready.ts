type AudioClock=Pick<AudioContext,'state'|'currentTime'|'resume'>;

/** `resume()`/`running` are not proof that the output device's clock has
 * started. Anchor graphics only after observing a fresh audio-clock advance.
 * Timers (not RAF) also work when a control tab is not painted. */
export function resumeAudioClock(context:AudioClock,{signal,timeoutMs=3000}:{signal?:AbortSignal;timeoutMs?:number}={}):Promise<void>{
  if(signal?.aborted)return Promise.reject(signal.reason??new DOMException('Lecture annulée.','AbortError'));
  if(context.state==='closed')return Promise.reject(Object.assign(Error('Le contexte audio a été fermé.'),{code:'AUDIO_DISPOSED'}));
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0)return Promise.reject(new RangeError('Délai audio invalide.'));
  const initial=context.currentTime;
  return new Promise((resolve,reject)=>{
    let settled=false,resumed=context.state==='running',poll:ReturnType<typeof setTimeout>|undefined;
    const finish=(error?:unknown)=>{if(settled)return;settled=true;clearTimeout(deadline);clearTimeout(poll);signal?.removeEventListener('abort',abort);error===undefined?resolve():reject(error);};
    const abort=()=>finish(signal?.reason??new DOMException('Lecture annulée.','AbortError'));
    const deadline=setTimeout(()=>finish(Object.assign(Error('L’horloge audio ne démarre pas. Réactivez le son puis réessayez.'),{code:'AUDIO_CLOCK_NOT_READY'})),timeoutMs);
    const check=()=>{
      if(settled)return;
      if(context.state==='closed'){finish(Object.assign(Error('Le contexte audio a été fermé.'),{code:'AUDIO_DISPOSED'}));return;}
      if(resumed&&context.state==='running'&&context.currentTime>initial){finish();return;}
      poll=setTimeout(check,10);
    };
    signal?.addEventListener('abort',abort,{once:true});
    // Keep resume within the initiating operator gesture, before any await.
    try{if(!resumed)context.resume().then(()=>{resumed=true;},finish);}catch(error){finish(error);}
    check();
  });
}
