export const COMMERCIAL_REGULAR_FONT = 'Commercial Benin';
export const COMMERCIAL_SEMIBOLD_FONT = 'Commercial Benin Semibold';
export const COMMERCIAL_READING_FONT = 'Commercial Suisse';
let ready:Promise<void>|undefined;
/** One shared load for preview, export and text pagination. */
export async function loadCommercialTemplateFonts():Promise<void> {
  if(!ready)ready=Promise.all([
    new FontFace(COMMERCIAL_REGULAR_FONT,'url("/commercial-assets/BeninRegularTAB.otf")').load(),
    new FontFace(COMMERCIAL_SEMIBOLD_FONT,'url("/commercial-assets/BeninSemiBold-TAB.otf")').load(),
    new FontFace(COMMERCIAL_READING_FONT,'url("/commercial-assets/SuisseIntl-Regular.otf")').load(),
  ]).then(fonts=>{fonts.forEach(font=>document.fonts.add(font));}).catch(error=>{ready=undefined;throw error;});
  await ready;
}
