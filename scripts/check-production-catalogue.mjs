const origin=new URL(process.argv[2]||'https://srtb-graphics.pages.dev');
const response=await fetch(new URL('/graphics',origin));
if(!response.ok)throw Error(`La page de production répond ${response.status}.`);
const html=await response.text();
const modulePath=html.match(/\/assets\/studio-[^"']+\.js/)?.[0];
if(!modulePath)throw Error('Le module actif de Graphics est introuvable.');
const moduleResponse=await fetch(new URL(modulePath,origin));
if(!moduleResponse.ok)throw Error(`Le module actif répond ${moduleResponse.status}.`);
const source=await moduleResponse.text();
const expected=[
  ['Renvoi · piqûre de rappel','Renvoi · piqûre de rappel'],
  ['Annonce d’événement','Annonce d’événement'],
  ['Semainier · sept programmes','Semainier · sept programmes'],
  ['Tout de suite · moteur dédié','BTV_BA_TDS'],
];
for(const [label,needle] of expected){
  if(!source.includes(needle))throw Error(`Modèle absent du module servi : ${label}`);
  console.log(`PASS catalogue publié : ${label}`);
}
console.log(`PASS module actif : ${modulePath}`);
