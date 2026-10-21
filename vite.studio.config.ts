import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { libraryFiles } from './scripts/library-dev-plugin.ts';
import {preserveStudioAssets} from './scripts/studio-asset-history.mjs';

export default defineConfig(async ({command})=>{
  if(command==='build')await preserveStudioAssets(import.meta.dirname);
  return {
  define:{__SRTB_DERIVATIONS__:'false'},
  plugins: [react(),libraryFiles()],
  server: { host: '127.0.0.1', port: 5192, strictPort: true, watch:{ignored:['**/.qa-delivery/**','**/public/downloads/**','**/dist-studio-native/**']} },
  build: { target: 'es2022', outDir: 'dist-studio', rolldownOptions: { input: 'studio.html' } },
  };
});
