import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
// Never publish the legacy static dist/ or infer a production release from a build.
if(process.argv.length!==3||!['--check','--production'].includes(process.argv[2]))throw Error('Utilisez npm run build:studio, puis npm run deploy -- --check. Pour publier explicitement : npm run deploy -- --production.');
const root=resolve(import.meta.dirname,'..');
const ffmpegReleaseBlock=resolve(root,'vendor','ffmpeg-core-0.12.10','RELEASE_BLOCKED.md');
function run(args,env=process.env){const result=spawnSync(process.execPath,args,{cwd:root,env,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)throw Error('Contrôle/publication interrompu. Aucun contournement du middleware autorisé.');}
if(process.argv[2]==='--production'&&existsSync(ffmpegReleaseBlock))throw Error('Publication bloquée : le choix de licence du repli FFmpeg/libx264 et son Corresponding Source exact ne sont pas encore validés. Consultez vendor/ffmpeg-core-0.12.10/RELEASE_BLOCKED.md.');
run(['scripts/prepare-studio-preview.mjs']);
run(['tests/storage-bundle.mjs']);
if(process.argv[2]==='--production')run(['node_modules/wrangler/bin/wrangler.js','pages','deploy','--cwd','.pages-studio','--project-name','srtb-graphics','--branch','main','--commit-dirty=true','--commit-message','SRTB Graphics — browser exports and local media'],{...process.env,CLOUDFLARE_ACCOUNT_ID:'8d1be9102f391f34a6f4bde342eafc2f'});
