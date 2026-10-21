declare module '*ffmpeg-core.js' {
  const createFFmpegCore:(options:{wasmBinary:Uint8Array<ArrayBuffer>})=>Promise<unknown>;
  export default createFFmpegCore;
}
