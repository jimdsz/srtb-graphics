import type {Project} from './domain';

export type ValidationStatus = Extract<Project['status'], 'submitted' | 'rejected' | 'approved'>;

// These are views of the current version, not a second approval history.
export const validationViews = [
  {status:'submitted', label:'En attente', emptyTitle:'Aucun envoi en attente', emptyDescription:'Les versions soumises au diffuseur apparaîtront ici.'},
  {status:'rejected', label:'À corriger', emptyTitle:'Aucune correction demandée', emptyDescription:'Les versions à reprendre après relecture apparaîtront ici.'},
  {status:'approved', label:'Validés', emptyTitle:'Aucun projet validé', emptyDescription:'Les versions approuvées par le diffuseur apparaîtront ici.'},
] as const satisfies ReadonlyArray<{status:ValidationStatus;label:string;emptyTitle:string;emptyDescription:string}>;

export function validationAction(status:ValidationStatus, reviewer:boolean) {
  if(status==='submitted')return reviewer?'Vérifier':'Voir';
  if(status==='rejected')return reviewer?'Voir':'Corriger';
  return 'Ouvrir';
}

export function savedVersionMessage(previousStatus:Project['status']) {
  return previousStatus==='rejected'
    ? 'Corrections enregistrées. Soumettez cette nouvelle version au diffuseur.'
    : 'Projet enregistré. Une nouvelle révision a été créée.';
}
