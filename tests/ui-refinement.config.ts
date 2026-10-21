import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {libraryFiles} from '../scripts/library-dev-plugin.ts';
export default defineConfig({define:{__SRTB_DERIVATIONS__:'false'},plugins:[react(),libraryFiles()],server:{host:'127.0.0.1',port:5198,strictPort:true,hmr:false,watch:{ignored:['**/reports/**','**/dist*/**']}}});
