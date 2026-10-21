import {defineConfig} from 'vite';
import base from './social-motion.config';
// Isolated qualification of the published native encoding policy. No change to
// the strict CBR profile or to production build guards.
export default defineConfig({...base,define:{...base.define,__SRTB_NATIVE_ONLY__:'true'},cacheDir:'node_modules/.vite-social-sequence-exports'});
