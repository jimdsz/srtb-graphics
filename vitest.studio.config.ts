import { defineConfig } from 'vitest/config';
import { cloudflareTest,readD1Migrations } from '@cloudflare/vitest-plugin';
export default defineConfig({
  // Exercise the explicit derivations profile with all migrations in isolated local D1.
  define:{__SRTB_DERIVATIONS__:'true'},
  resolve:{alias:{'@aws-sdk/xml-builder':'@aws-sdk/xml-builder/dist-cjs/index.js'}},
  plugins:[cloudflareTest({miniflare:{compatibilityDate:'2026-09-21',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['MEDIA'],bindings:{ACCESS_TEAM_DOMAIN:'NOT_CONFIGURED',ACCESS_AUDIENCE:'NOT_CONFIGURED',APP_ENV:'test'}}})],
  test:{include:['tests/studio/**/*.test.ts'],provide:{migrations:await readD1Migrations('./migrations')},testTimeout:20000},
});
