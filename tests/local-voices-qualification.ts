import inventory from '../reports/local-voice-inventory-2026-09-23.json';

const input=document.querySelector<HTMLInputElement>('#files')!,button=document.querySelector<HTMLButtonElement>('#run')!;
const status=document.querySelector<HTMLElement>('#status')!,result=document.querySelector<HTMLElement>('#result')!;
input.addEventListener('change',()=>{button.disabled=!input.files?.length;status.textContent=`${input.files?.length||0} fichiers sélectionnés, aucun envoi.`;});
button.addEventListener('click',async()=>{
  button.disabled=true;input.disabled=true;const records=[];let context:AudioContext|undefined;
  try{
    if(location.origin!=='http://127.0.0.1:5198')throw Error('Recette réservée au serveur local 5198.');
    context=new AudioContext({sampleRate:48000});const started=performance.now();
    for(const file of [...input.files!]){
      status.textContent=`Décodage local ${records.length+1}/${input.files!.length} · ${file.name}`;
      const expected=inventory.files.find(row=>row.name===file.name);if(!expected)throw Error('Fichier absent de l’inventaire : '+file.name);
      const bytes=await file.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes),sha256=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
      if(sha256!==expected.sha256)throw Error('Fichier changé : '+file.name);
      const decoded=await context.decodeAudioData(bytes),differenceSeconds=decoded.duration-expected.decodedDurationSeconds;
      if(Math.abs(differenceSeconds)>1/48000+.000001)throw Error('Durée décodée divergente : '+file.name);
      if(decoded.numberOfChannels!==2||decoded.sampleRate!==48000)throw Error('Format PCM inattendu : '+file.name);
      records.push({name:file.name,sha256,containerDuration:expected.durationSeconds,browserDecodedDuration:decoded.duration,
        ffmpegDecodedDuration:expected.decodedDurationSeconds,differenceSeconds,channels:decoded.numberOfChannels,sampleRate:decoded.sampleRate,status:'PASS'});
    }
    if(records.length!==inventory.count)throw Error(`Choisir les ${inventory.count} fichiers pour terminer la recette.`);
    const report={scope:'Décodage navigateur des fichiers locaux sélectionnés et comparaison FFmpeg indépendante. Aucun octet audio transféré.',status:'PASS',count:records.length,elapsedMs:Math.round(performance.now()-started),records};
    result.textContent=JSON.stringify(report,null,2);
    const saved=await fetch(`/__social-evidence/local-voices-${Date.now()}.json`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});
    if(!saved.ok)throw Error('Le rapport chiffré n’a pas été enregistré.');
    status.textContent=`PASS — ${records.length} fichiers décodés localement, durées comparées à FFmpeg. Aucune parole validée par ce contrôle.`;
  }catch(error){status.textContent='FAIL — '+(error instanceof Error?error.message:String(error));result.textContent=JSON.stringify(records,null,2);}
  finally{await context?.close();input.disabled=false;button.disabled=false;}
});
