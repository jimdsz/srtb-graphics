/** OUT starts on the first 25 fps sample at or after the requested time.
 * Ignore only floating-point noise around an already exact frame boundary.
 * Keep this pure: the portable HTML runtime embeds the same function. */
export function ceilFrameSeconds(seconds:number){const frame=Math.ceil(seconds*25-1e-7);return frame===0?0:frame/25;}
