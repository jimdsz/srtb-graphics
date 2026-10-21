import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import {libraryFiles} from '../scripts/library-dev-plugin';

// Isolated loopback fake backend: no credentials, no production DB, no user media.
export default defineConfig({plugins:[react(),{
  name:'session-qualification',
  configureServer(server){
    let expires=0,fail=false,recoverAt=Infinity;
    let draft={id:'draft-test',title:'Brouillon de recette récupérable',template_id:'BTV_Relais_Antenne',template_version:'1.0.0',library_version:'1.7.0',status:'draft',revision:1,data:templateDefaults(getTemplate('BTV_Relais_Antenne')),created_by:'test@example.test',updated_by:'test@example.test',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),archived:0};
    server.middlewares.use((req,res,next)=>{
      if(req.headers.host!=='127.0.0.1:5195'){res.writeHead(403).end();return;}
      const path=new URL(req.url||'/','http://127.0.0.1:5195').pathname;
      if(path==='/graphics'){req.url='/tests/session-qualification.html';return next();}
      const json=(status:number,data:unknown,headers:Record<string,string>={})=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));};
      if(path.startsWith('/__session-test/')){
        if(req.method!=='POST'||req.headers.origin!=='http://127.0.0.1:5195')return json(403,{});
        if(path.endsWith('/login')){expires=Date.now()+3600000;fail=false;recoverAt=Infinity;}
        if(path.endsWith('/expire'))expires=0;
        if(path.endsWith('/short')){expires=Date.now()+30000;fail=false;recoverAt=Infinity;}
        if(path.endsWith('/outage')){fail=true;recoverAt=Infinity;}
        if(path.endsWith('/outage-renew')){fail=true;expires=Date.now()+3600000;recoverAt=Date.now()+45000;}
        if(path.endsWith('/recover'))fail=false;
        return json(200,{ok:true});
      }
      if(path==='/api/auth/logout'){expires=0;return json(200,{ok:true});}
      if(path.startsWith('/api/')){
        if(fail&&Date.now()>=recoverAt)fail=false;
        if(fail)return json(503,{error:'Indisponibilité temporaire simulée'});
        if(Date.now()>=expires)return json(401,{error:'Session expirée (recette)'});
        if(path==='/api/me')return json(200,{email:'test@example.test',name:'Membre de recette',role:'designer',active:1},{'X-SRTB-Session-Remaining-Ms':String(expires-Date.now())});
        if(path==='/api/graphics/projects/draft-test/archive'&&req.method==='POST'){
          let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{const patch=JSON.parse(body);if(patch.revision!==draft.revision)return json(409,{error:'Révision modifiée'});draft={...draft,archived:patch.archived?1:0,revision:draft.revision+1};json(200,draft);});return;
        }
        if(path==='/api/graphics/projects/draft-test')return json(200,draft);
        if(path.startsWith('/api/graphics/projects')){const archived=new URL(req.url||'/','http://127.0.0.1:5195').searchParams.get('archived')==='1';return json(200,{projects:archived===!!draft.archived?[draft]:[],next:null});}
        return json(200,[]);
      }
      next();
    });
  },
},libraryFiles()],resolve:{alias:[{find:/^\.\/firebase-client$/,replacement:resolve('tests/session-client.fake.ts')}]},server:{host:'127.0.0.1',port:5195,strictPort:true,hmr:false}});
