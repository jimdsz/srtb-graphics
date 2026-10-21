import test from 'node:test';
import assert from 'node:assert/strict';
import {broadcastTemplates,templateDefaults,validateProjectData} from '../src/studio/domain';
import {engineData} from '../src/studio/presentation';
import {PORTRAIT_LAYOUT,portraitPanelTemplate,portraitLayoutMode} from '../src/studio/social-portrait-layout';

test('new BTV projects and catalogue previews default right in both social formats without selecting legacy layout',()=>{
  for(const template of broadcastTemplates)for(const format of ['portrait','vertical']){
    const data={...templateDefaults(template),_studio_format:format};
    assert.equal(data._studio_logo_anchor,'top-right',template.id);
    assert.equal(validateProjectData(template,data)._studio_logo_anchor,'top-right');
    if(portraitPanelTemplate(template.id))assert.equal(portraitLayoutMode(data),'compact');
    assert.ok(!Object.hasOwn(engineData({...data,_studio_format:'tv'}),'_studio_logo_anchor'));
  }
});

test('old project validation keeps historical anchors and layout, and every explicitly saved position survives',()=>{
  for(const template of broadcastTemplates){
    const old=validateProjectData(template,{_studio_format:'portrait'});
    assert.equal(old._studio_logo_anchor,'top-left',template.id);
    if(portraitPanelTemplate(template.id))assert.equal(old[PORTRAIT_LAYOUT],'auto');
    for(const anchor of ['top-left','top-right','top-center','bottom-left','bottom-right']){
      const data=validateProjectData(template,{_studio_format:'portrait',_studio_logo_anchor:anchor});
      assert.equal(data._studio_logo_anchor,anchor,template.id);
      if(portraitPanelTemplate(template.id)&&anchor!=='top-left')assert.equal(portraitLayoutMode(data),'legacy');
    }
  }
});
