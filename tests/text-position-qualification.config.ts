import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
import {libraryFiles} from '../scripts/library-dev-plugin';
export default defineConfig({
  define:{__SRTB_NATIVE_ONLY__:'true','import.meta.env.VITE_STUDIO_QUALIFICATION':'false'},
  resolve:{alias:[{find:/^\.\/cbr-fallback(?:\.ts)?$/,replacement:resolve(import.meta.dirname,'../src/studio/video/opaque-native-adapter.ts')}]},
  plugins:[react(),libraryFiles()],
  server:{host:'127.0.0.1',port:5197,strictPort:true,hmr:false,watch:{ignored:['**/.tools/**','**/reports/**']},headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob:; media-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'"}},
});
