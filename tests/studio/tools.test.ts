import { expect,it } from 'vitest';
import { studioTools,toolForPath } from '../../src/studio/tools';
it('reserves an independent namespace per tool without pretending planned tools work',()=>{
  expect(new Set(studioTools.map(t=>t.path)).size).toBe(studioTools.length);
  expect(toolForPath('/')).toBeUndefined();
  expect(toolForPath('/graphics')?.id).toBe('graphics');
  expect(toolForPath('/commercial')?.id).toBe('commercial');
  expect(toolForPath('/signatures')).toBeUndefined();
  expect(toolForPath('/graphics-elsewhere')).toBeUndefined();
});
