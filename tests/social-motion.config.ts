import {defineConfig} from 'vite';
import qualification from './social-qualification.config';

// Run alongside the editor's Vite server without competing for its dependency
// cache on Windows (renaming an open cache directory raises EPERM).
export default defineConfig({...qualification,cacheDir:'node_modules/.vite-social-motion'});
