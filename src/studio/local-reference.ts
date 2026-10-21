// Portable metadata only. No operating-system paths, permissions or media bytes.
// Source files are streamed and are not subject to the 3 GiB ZIP delivery cap.
export const MAX_LOCAL_BYTES=64*1024**3;
export function localReference(value:string){
  const match=/^local-media:([a-f0-9]{64}):([1-9]\d{0,12})$/.exec(value);
  if(!match)return null;const bytes=Number(match[2]);
  return Number.isSafeInteger(bytes)&&bytes<=MAX_LOCAL_BYTES?{sha256:match[1],bytes}:null;
}
export const mediaExtensions:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/mp4':'mp4','video/webm':'webm','audio/mpeg':'mp3','audio/wav':'wav','audio/x-wav':'wav','audio/mp4':'m4a','audio/ogg':'ogg'};
