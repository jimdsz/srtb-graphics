export const NATIVE_ONLY_PROFILE='native-only';
export const NATIVE_DERIVATIONS_PROFILE='native-derivations';

export function nativeReleaseProfile(name=NATIVE_ONLY_PROFILE){
  if(![NATIVE_ONLY_PROFILE,NATIVE_DERIVATIONS_PROFILE].includes(name))throw Error('Profil de publication natif inconnu.');
  return {name,nativeOnly:true,derivations:name===NATIVE_DERIVATIONS_PROFILE,qualification:false};
}
export function nativeBuildProfile(args){
  if(args.length===0)return nativeReleaseProfile();
  if(args.length===1&&args[0]==='--derivations')return nativeReleaseProfile(NATIVE_DERIVATIONS_PROFILE);
  throw Error('Utilisez le profil natif par défaut ou --derivations explicitement.');
}
export function nativePublicationOptions(args){
  const unique=new Set(args);
  if(unique.size!==args.length||args.some(arg=>!['--check','--production','--derivations'].includes(arg))||Number(unique.has('--check'))+Number(unique.has('--production'))!==1)throw Error('Choisissez --check ou --production ; --derivations sélectionne explicitement le profil activé.');
  return {production:unique.has('--production'),profile:nativeReleaseProfile(unique.has('--derivations')?NATIVE_DERIVATIONS_PROFILE:NATIVE_ONLY_PROFILE)};
}
// Linked projects have already been published in SRTB production. An OFF Worker
// removes their provenance and old-client protections as well as hiding the UI.
// Keep OFF available for isolated qualification, but never silently downgrade
// the deployed product when a release command forgets its explicit flag.
export function assertProductionFeatureContinuity(options){
  if(options.production&&!nativeReleaseProfile(options.profile.name).derivations){
    throw Error('Publication interrompue : les déclinaisons liées font partie de Graphics en production. Construisez puis publiez explicitement avec --derivations ; le profil natif sans déclinaisons reste réservé aux contrôles locaux.');
  }
}
export function nativeViteProfile(mode){
  if(['development','production',NATIVE_ONLY_PROFILE].includes(mode))return nativeReleaseProfile();
  return nativeReleaseProfile(mode);
}
export function nativeClientDefines(profile){
  const checked=nativeReleaseProfile(profile.name);
  return {__SRTB_NATIVE_ONLY__:'true',__SRTB_DERIVATIONS__:String(checked.derivations),'import.meta.env.VITE_STUDIO_QUALIFICATION':'false'};
}
export function assertWorkerDerivationProfile(inputs,code,profile){
  const paths=inputs.map(path=>path.replaceAll('\\','/'));
  const required=['server/project-derivations.ts','server/derivation-origin.ts','server/derivation-client.ts','src/studio/derivation-model.ts'];
  const tables=['derivation_batches','project_derivations'];
  if(nativeReleaseProfile(profile.name).derivations){
    for(const suffix of required)if(!paths.some(path=>path.endsWith(suffix)))throw Error('Activated derivation Worker module missing: '+suffix);
    for(const table of tables)if(!code.includes(table))throw Error('Activated derivation Worker table missing: '+table);
  }else if(paths.some(path=>required.some(suffix=>path.endsWith(suffix)))||tables.some(table=>code.includes(table)))throw Error('Unreleased derivation API/tables must be absent from the bug-fix Worker graph.');
}
