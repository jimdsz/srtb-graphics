// Explicit release profile opt-in. OFF remains the default for existing builds.
declare const __SRTB_DERIVATIONS__:boolean;
export const DERIVATIONS_ENABLED=typeof __SRTB_DERIVATIONS__!=='undefined'&&__SRTB_DERIVATIONS__;
