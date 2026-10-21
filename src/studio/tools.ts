export interface StudioTool {
  id: string;
  title: string;
  path: string;
  category: string;
  description: string;
  status: 'qualification' | 'planned' | 'available';
}
// A new tool gets its own route, API namespace and server-side authorisation.
// Registration alone must never grant access to another tool's data.
export const studioTools: readonly StudioTool[] = [
  { id:'graphics', title:'SRTB Graphics', path:'/graphics', category:'Habillage & diffusion',
    description:'Préparer les habillages BTV, travailler les médias et soumettre une version au diffuseur.', status:'available' },
  { id:'commercial', title:'SRTB Annonces', path:'/commercial', category:'Service commercial',
    description:'Créer les communiqués, choisir une voix off et une musique, puis exporter une annonce.', status:'available' },
];
export function toolForPath(path:string) {
  return studioTools.find(tool=>path===tool.path||path.startsWith(`${tool.path}/`));
}
