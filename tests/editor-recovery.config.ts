import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {libraryFiles} from '../scripts/library-dev-plugin.ts';
import {plannerVoiceFixture} from './planner-voice-fixture';
// A separate dependency cache prevents other concurrent qualification servers
// from invalidating worker imports with "504 Outdated Optimize Dep".
export default defineConfig({
  cacheDir:'node_modules/.vite-editor-recovery',
  define:{__SRTB_DERIVATIONS__:'false'},
  plugins:[react(),libraryFiles(),plannerVoiceFixture()],
  server:{host:'127.0.0.1',port:5201,strictPort:true,hmr:false},
});
