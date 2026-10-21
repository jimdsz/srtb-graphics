// Portable entry shares both the voice source and the operator transport.
// The editor imports the lighter voice module directly.
export * from './supplemental-voice';
export {installAEMediaTrim} from './ae-media-trim';
export {installPreviewTransport as installPortableTransport} from './preview-transport';
