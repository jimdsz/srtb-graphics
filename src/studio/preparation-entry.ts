import type {PreparationKind} from './preparation-profile-model';

export function preparationEntryKind({open,wasOpen,editing,kind,initialKind}:{open:boolean;wasOpen:boolean;editing:boolean;kind:PreparationKind;initialKind?:PreparationKind}):PreparationKind{
  return open&&!wasOpen&&!editing?(initialKind??kind):kind;
}
