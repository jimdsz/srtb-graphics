import type {ClipPosition} from './media-position';

// Preview-only metadata, held for the lifetime of the actual canvas. A pending
// decode leaves both the last complete pixels and their source position intact.
const positions=new WeakMap<HTMLCanvasElement,ClipPosition>();
export function rememberPreviewPosition(canvas:HTMLCanvasElement,position:ClipPosition){positions.set(canvas,position);}
export function previewPicturePosition(canvas:HTMLCanvasElement){return positions.get(canvas);}
