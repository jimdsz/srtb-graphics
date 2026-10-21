// Only the isolated native release build defines this constant. Default studio
// and qualification builds keep the strict, measured-floor CBR policy.
declare const __SRTB_NATIVE_ONLY__: boolean;
export const NATIVE_ONLY_EXPORT=typeof __SRTB_NATIVE_ONLY__!=='undefined'&&__SRTB_NATIVE_ONLY__;
