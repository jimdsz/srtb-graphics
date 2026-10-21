import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createConnectorServer} from './server.mjs';
const run=promisify(execFile);
const platform=os.platform();
const defaultDir=platform==='win32'?path.join(process.env.LOCALAPPDATA||os.homedir(),'SRTB Graphics Connector'):path.join(os.homedir(),'Library','Application Support','SRTB Graphics Connector');
const arg=process.argv.indexOf('--data-dir'),dataDir=arg>=0?path.resolve(process.argv[arg+1]):defaultDir;
const pickDirectory=async signal=>{
 if(platform==='win32'){const script="Add-Type -AssemblyName System.Windows.Forms; $owner=New-Object System.Windows.Forms.Form; $owner.Text='Graphics - Choisir un dossier'; $owner.TopMost=$true; $owner.StartPosition='CenterScreen'; $owner.Width=400; $owner.Height=120; $picker=New-Object System.Windows.Forms.FolderBrowserDialog; $picker.Description='Autoriser Graphics à lire cet emplacement et ses sous-dossiers'; $picker.ShowNewFolderButton=$false; try { $owner.Show(); $owner.Activate(); if($picker.ShowDialog($owner) -eq 'OK'){[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Console]::Write($picker.SelectedPath)} } finally { $picker.Dispose(); $owner.Close(); $owner.Dispose() }";
  return (await run('powershell.exe',['-NoProfile','-STA','-Command',script],{windowsHide:true,maxBuffer:16384,signal,timeout:120000})).stdout.trim();}
 if(platform==='darwin')return (await run('/usr/bin/osascript',['-e','POSIX path of (choose folder with prompt "Autoriser Graphics à lire cet emplacement et ses sous-dossiers")'],{maxBuffer:16384,signal,timeout:120000})).stdout.trim();
 throw Error('Sélecteur natif disponible sur Windows et Mac uniquement.');
};
const desktop=process.argv.includes('--desktop');
// The OS dialog is the permission grant for this one file. The website cannot
// supply a path, invoke a command or authorize a whole disk through this route.
const pickFile=platform==='win32'?async signal=>{
 const script="Add-Type -AssemblyName System.Windows.Forms; $owner=New-Object System.Windows.Forms.Form; $owner.TopMost=$true; $owner.StartPosition='CenterScreen'; $picker=New-Object System.Windows.Forms.OpenFileDialog; $picker.Title='Graphics — autoriser la préparation de ce fichier'; $picker.Filter='Vidéos|*.mxf;*.mov;*.mp4;*.webm'; $picker.Multiselect=$false; try { $owner.Show(); $owner.Activate(); if($picker.ShowDialog($owner) -eq 'OK'){[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Console]::Write($picker.FileName)} } finally { $picker.Dispose(); $owner.Close(); $owner.Dispose() }";
 return (await run('powershell.exe',['-NoProfile','-STA','-Command',script],{windowsHide:true,maxBuffer:16384,signal,timeout:120000})).stdout.trim();
}:undefined;
let app;
try{app=await createConnectorServer({dataDir,pickDirectory,pickFile});}
catch(error){console.error(error?.code==='EADDRINUSE'?'Le port du connecteur est déjà utilisé. Arrêtez l’instance existante, puis réessayez.':'Le connecteur ne peut pas démarrer. Vérifiez les droits de ce compte.');process.exit(1);}
// The capability is opened only in the local control page; never logged or sent
// to the website. Browser pairing requires a separate, one-use human code.
if(!desktop&&!process.argv.includes('--no-open')){
 if(platform==='win32')await run('powershell.exe',['-NoProfile','-Command',`Start-Process '${app.consoleURL}'`],{windowsHide:true});
 else if(platform==='darwin')await run('/usr/bin/open',[app.consoleURL]);
}
// Desktop child protocol: capability goes only to the supervising launcher's
// redirected pipe, never to a file. Losing the parent closes the helper.
if(desktop){
 process.stdout.write(JSON.stringify({type:'ready',consoleURL:app.consoleURL})+'\n');
 process.stdin.resume();process.stdin.once('end',()=>void app.close());
 app.closed.then(()=>{process.stdin.destroy();});
}else console.log('Connecteur Graphics actif, en lecture seule. Arrêtez-le depuis sa console locale ou avec Ctrl+C.');
for(const event of ['SIGINT','SIGTERM'])process.once(event,()=>void app.close().then(()=>process.exit(0)));
