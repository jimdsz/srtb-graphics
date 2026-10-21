import type {CommercialSequence} from './model';

export const COMMERCIAL_LAYOUT_LABELS:Record<CommercialSequence['layout'],string>={
  central:'Texte centré',columns:'Deux colonnes',left:'Encart à gauche',right:'Encart à droite',final:'Encart centré',
};
export const COMMERCIAL_LAYOUT_CHOICES:readonly CommercialSequence['layout'][]=['central','columns','left','right','final'];
