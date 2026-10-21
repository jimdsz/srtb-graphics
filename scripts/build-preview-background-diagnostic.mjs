import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
await build({entryPoints:['src/studio/preview-backgrounds.worker.ts'],bundle:true,format:'esm',outfile:'tests/preview-backgrounds.worker.bundle.js'});
await build({entryPoints:['tests/preview-background-fluency.ts'],bundle:true,format:'esm',outfile:'tests/preview-background-fluency.bundle.js',plugins:[{
  name:'static-diagnostic-worker',setup(build){build.onLoad({filter:/[/\\]preview-backgrounds\.ts$/},async args=>({contents:(await readFile(args.path,'utf8')).replace("'./preview-backgrounds.worker.ts'","'./preview-backgrounds.worker.bundle.js'"),loader:'ts'}));}
}]});
