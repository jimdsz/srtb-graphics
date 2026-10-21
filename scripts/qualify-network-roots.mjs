// Read-only qualification of the two locations explicitly supplied by the user.
// No source content is opened and nothing is sent to a remote service.
import fs from 'node:fs/promises';
import path from 'node:path';
import {Connector} from '../connector/core.mjs';
const repo=path.resolve(import.meta.dirname,'..');
await fs.mkdir(path.join(repo,'.qa-delivery'),{recursive:true});
const dataDir=process.argv[2]?path.resolve(process.argv[2]):await fs.mkdtemp(path.join(repo,'.qa-delivery/network-index-'));
const c=await new Connector(dataDir).init(),report={at:new Date().toISOString(),roots:[],search:[]};
try{for(const location of ['Y:\\BONJOUR LE BENIN 2026\\BONJOUR LE BENIN','X:\\_']){
 const root=await c.authorize(location);c.start(root.id);
 const progress=setInterval(()=>console.log(JSON.stringify({root:root.name,visited:root.visited,found:root.found,state:root.state})),30000);
 const limit=setTimeout(()=>c.stop(root.id),60*60000);
 try{await c.jobs.get(root.id).promise;}finally{clearTimeout(limit);clearInterval(progress);}
 report.roots.push(c.list().find(r=>r.id===root.id));console.log(JSON.stringify(report.roots.at(-1)));
}
 report.search=(await c.search(['Bonjour le Bénin','Le grand entretien','Lithapo','Temps présent','Missi Minxo'].map((title,i)=>({id:String(i),title,subtitle:'',airDate:'2026-09-28'})))).map(r=>({id:r.id,count:r.matches.length,matches:r.matches.slice(0,3)}));
}finally{c.close();await fs.writeFile(path.join(dataDir,'qualification.json'),JSON.stringify(report,null,2));console.log('Rapport local : '+path.join(dataDir,'qualification.json'));}
