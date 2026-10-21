import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {firebaseAccountAdmin} from '../server/firebase-account-admin.ts';

// Provision only the explicitly supplied credential. Never log or copy it.
const project='srtb-graphics';
const expectedAccount=`graphics-account-deleter@${project}.iam.gserviceaccount.com`;
let stage='validation';
try {
  const [file,action]=process.argv.slice(2);
  if(!file||!['check','install'].includes(action))throw Error();
  const source=await readFile(file,'utf8');
  if(source.length>16384)throw Error();
  const credential=JSON.parse(source);
  if(credential.type!=='service_account'||credential.project_id!==project||credential.client_email!==expectedAccount||typeof credential.private_key!=='string'||!credential.private_key.startsWith('-----BEGIN PRIVATE KEY-----'))throw Error();
  const secret=JSON.stringify({project_id:project,client_email:expectedAccount,private_key:credential.private_key});
  stage='lecture Firebase';
  const admin=await firebaseAccountAdmin({FIREBASE_PROJECT_ID:project,FIREBASE_ACCOUNT_DELETER:secret});
  if(await admin.lookup('graphics-permission-check@nonexistent.invalid')!==null)throw Error();
  console.log(JSON.stringify({project,serviceAccount:expectedAccount,keyId:credential.private_key_id,readOnlyFirebaseCheck:'passed',identityWrites:0}));
  if(action==='install'){
    stage='configuration du secret';
    const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','pages','secret','put','FIREBASE_ACCOUNT_DELETER','--project-name',project,'--env','production'],{
      cwd:resolve(import.meta.dirname,'..'),input:secret,encoding:'utf8',timeout:90000,maxBuffer:1024*1024,
      env:{...process.env,CLOUDFLARE_ACCOUNT_ID:'8d1be9102f391f34a6f4bde342eafc2f',WRANGLER_LOG:'warn',WRANGLER_SEND_METRICS:'false'},
    });
    // Do not echo CLI output: even a provider error must not expose credentials.
    if(result.error||result.status!==0)throw Error();
    console.log(JSON.stringify({productionSecret:'installed',identityWrites:0}));
  }
}catch(error){
  console.error(JSON.stringify({failedStage:stage,status:Number.isInteger(error?.status)?error.status:undefined,details:'Masqués pour protéger les identifiants.'}));
  process.exitCode=1;
}
