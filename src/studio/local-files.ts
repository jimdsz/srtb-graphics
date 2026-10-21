// In-memory File references only: never persisted, copied, or uploaded here.
export const localBindings=new Map<string,{file?:File;url:string;connector?:boolean}>();
export function localBlob(url:string){for(const binding of localBindings.values())if(binding.url===url)return binding.file;return undefined;}
