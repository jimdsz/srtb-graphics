/** Playlist IDs read from the public SRTB programme pages on 2026-09-28.
 * Editorial shortcuts, not a claim that every episode is available forever. */
export const replayCatalogue=[
  ['bonjour-le-benin','Bonjour le Bénin','PLYI_vH9CKTetPRj0jOJZY_ZN0nVsukyCL'],
  ['lislam-en-partage','L’Islam en partage','PLYI_vH9CKTeuXoDI5Up_Eczgh-_3Otebp'],
  ['la-foi-chretienne','La foi chrétienne','PLYI_vH9CKTetuZQqm6QR9gidAQ_rOY6rr'],
  ['succes-en-direct','Succès en direct','PLYI_vH9CKTeuNJDBR4NrUHiW3n8O4ubmM'],
  ['heritages','Héritages','PLYI_vH9CKTesHlXVK8WiF0bB-ReWxREr5'],
  ['places-aux-jeunes','Places aux jeunes','PLYI_vH9CKTescjCgdb-UDhjQrv_WWdEdp'],
  ['le-choc-des-legendes','Le choc des légendes','PLYI_vH9CKTeuJ0JFh5uy99SkNNCFhYAr6'],
  ['fitforme','Fitforme','PLYI_vH9CKTetfObiFTNkYIc_JFE-UsPSV'],
  ['echos-de-la-ferme','Échos de la ferme','PLYI_vH9CKTes4qT8qLUwg42y_SAmlwOV9'],
  ['art-pluriel','Art pluriel','PLYI_vH9CKTesdxa8Sr9w8f0H7ZwDp4TPy'],
  ['guichets-fermes','Guichets fermés','PL8-CG7RztHqtbTntgmCIOpp4otkp6NTjW'],
  ['focus','Focus','PL8-CG7RztHqu8zP97loBDACAuqo5HApec'],
].map(([id,title,playlist])=>({id,title,url:`https://www.youtube.com/playlist?list=${playlist}`,source:`https://srtb.bj/${id}/`,checked:'2026-09-28'}));

export function replayAddress(value:string){
  const text=value.trim();if(!text)return '';
  let url:URL;try{url=new URL(text);}catch{throw Error('Collez une adresse complète commençant par https://.');}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('Utilisez un lien HTTP(S) sans identifiants.');
  if(url.href.length>200)throw Error('Lien trop long : utilisez le lien de partage court de la vidéo ou de la playlist.');
  return url.href;
}
