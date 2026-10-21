import {defineConfig} from 'vite';
import {resolve} from 'node:path';
import qualification from '../vite.qualification.config';

// Separate process/port and ephemeral D1. Never imported by a release build.
if(process.env.SRTB_QUALIFICATION_PORT!=='5199')throw Error('Start this isolated derivation workbench on port 5199.');
Object.assign(globalThis,{__SRTB_DERIVATIONS__:true});
export default defineConfig({...qualification,
  define:{...qualification.define,__SRTB_DERIVATIONS__:'true',__SRTB_NATIVE_ONLY__:'true'},
  resolve:{alias:[{find:/^\.\/cbr-fallback(?:\.ts)?$/,replacement:resolve('src/studio/video/opaque-native-adapter.ts')}]},
});
