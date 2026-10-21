import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {nativePublicationOptions,assertProductionFeatureContinuity} from '../scripts/studio-release-profile.mjs';

test('an explicit ON production release preserves linked projects; local OFF stays qualifiable',()=>{
  for(const args of [['--check'],['--check','--derivations'],['--production','--derivations']]){
    assert.doesNotThrow(()=>assertProductionFeatureContinuity(nativePublicationOptions(args)));
  }
  assert.throws(()=>assertProductionFeatureContinuity(nativePublicationOptions(['--production'])),/Publication interrompue.*--derivations/);
});

test('real publication entry refuses an accidental OFF before inventory, remote queries or deployment',()=>{
  const result=spawnSync(process.execPath,['scripts/check-studio-native-release.mjs','--production'],{
    cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',timeout:10000,
  });
  assert.equal(result.error,undefined);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Publication interrompue.*--derivations/);
  assert.equal(result.stdout,'');
});
