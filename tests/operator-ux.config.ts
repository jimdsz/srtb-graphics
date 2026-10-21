import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
import {nativeClientDefines,nativeReleaseProfile} from '../scripts/studio-release-profile.mjs';
import {libraryFiles} from '../scripts/library-dev-plugin.ts';

// Browser-only fixtures. No API, auth bypass, Worker, D1 or release import.
export default defineConfig({
  cacheDir:resolve(import.meta.dirname,'../node_modules/.vite-operator-ux'),
  plugins:[react(),libraryFiles()],
  optimizeDeps:{include:['xlsx']},
  define:nativeClientDefines(nativeReleaseProfile('native-derivations')),
  resolve:{alias:[{find:/^\.\/cbr-fallback(?:\.ts)?$/,replacement:resolve(import.meta.dirname,'../src/studio/video/opaque-native-adapter.ts')}]},
  server:{host:'127.0.0.1',port:5221,strictPort:true},
});
