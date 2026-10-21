import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
import {libraryFiles} from '../scripts/library-dev-plugin.ts';

// Match the accepted native production encoder, without publishing this fixture.
export default defineConfig({
 define:{__SRTB_NATIVE_ONLY__:'true',__SRTB_DERIVATIONS__:'true'},
 resolve:{alias:[{find:/^\.\/cbr-fallback(?:\.ts)?$/,replacement:resolve(import.meta.dirname,'../src/studio/video/opaque-native-adapter.ts')}]},
 plugins:[react(),libraryFiles()],server:{host:'127.0.0.1',port:5234,strictPort:true},
});
