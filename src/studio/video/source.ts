import {BlobSource,UrlSource} from 'mediabunny';
import {localBlob} from '../local-files';
export function browserSource(url:string){
  const file=localBlob(url);
  return file?new BlobSource(file):new UrlSource(url,{requestInit:{credentials:'same-origin'},maxCacheSize:8*1024**2,getRetryDelay:n=>n<2?1:null});
}
