import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseFolder,folderPickerAvailable,persistentFolderPickerAvailable} from '../src/studio/day-planner-folders';

class DirectoryInput extends EventTarget {
 type='';webkitdirectory=false;multiple=false;hidden=false;files:File[]=[];removed=false;clicks=0;
 click(){this.clicks++;}
 remove(){this.removed=true;}
}
function environment(picker?:()=>Promise<unknown>){
 const originals=['window','document'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)] as const);
 const inputs:DirectoryInput[]=[];
 Object.defineProperty(globalThis,'window',{configurable:true,value:{showDirectoryPicker:picker}});
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>new DirectoryInput(),body:{append(input:DirectoryInput){inputs.push(input);}}}});
 return {inputs,restore(){for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}};
}
test('native read-only picker remains preferred, without a directory input',async()=>{
 let options:unknown;const handle={kind:'directory',name:'Native'};
 const e=environment(async function(...args:unknown[]){options=args[0];return handle;});
 try{assert.equal(persistentFolderPickerAvailable(),true);assert.equal(await chooseFolder(),handle);assert.deepEqual(options,{mode:'read',id:'srtb-graphics-programmes'});assert.equal(e.inputs.length,0);}finally{e.restore();}
});
test('directory input cancel, empty selection and explicit abort clean up and allow retry',async()=>{
 const e=environment();
 try{
  assert.equal(persistentFolderPickerAvailable(),false);assert.equal(folderPickerAvailable(),true);
  const cancelled=chooseFolder(),cancelInput=e.inputs.at(-1)!;cancelInput.dispatchEvent(new Event('cancel'));
  await assert.rejects(cancelled,{name:'AbortError'});assert.equal(cancelInput.removed,true);
  const empty=chooseFolder(),emptyInput=e.inputs.at(-1)!;emptyInput.dispatchEvent(new Event('change'));
  await assert.rejects(empty,{name:'AbortError'});assert.equal(emptyInput.removed,true);
  const controller=new AbortController(),aborted=chooseFolder(controller.signal),abortInput=e.inputs.at(-1)!;controller.abort();
  await assert.rejects(aborted,{name:'AbortError'});assert.equal(abortInput.removed,true);
  const selected=chooseFolder(),input=e.inputs.at(-1)!;
  assert.equal(input.clicks,1);assert.equal(input.webkitdirectory,true);assert.equal(input.multiple,true);
  input.files=[{name:'clip.mp4',webkitRelativePath:'Programmes/clip.mp4',size:42,lastModified:123} as File];input.dispatchEvent(new Event('change'));
  const folder=await selected;assert.equal(folder.name,'Programmes');assert.equal(input.removed,true);
 }finally{e.restore();}
});
test('invalid directory selection is rejected and its input removed',async()=>{
 const e=environment();
 try{const pending=chooseFolder(),input=e.inputs.at(-1)!;input.files=[{name:'clip.mp4',webkitRelativePath:'../clip.mp4'} as File];input.dispatchEvent(new Event('change'));await assert.rejects(pending,/chemin/);assert.equal(input.removed,true);}finally{e.restore();}
});
