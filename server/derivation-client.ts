import {supportsDerivations} from '../src/studio/client-capabilities';
import {HttpError} from './http';

export const DERIVATION_CLIENT_REQUIRED='Ce projet nécessite l’interface récente. Conservez cet onglet et ses brouillons ; ouvrez Graphics dans un nouvel onglet.';

export function requireDerivationClient(request:Request):void{
  if(!supportsDerivations(request.headers))throw new HttpError(409,DERIVATION_CLIENT_REQUIRED);
}

/** Applied in SQL before LIMIT/cursor selection: never leave a sparse legacy page. */
export function legacyProjectFilter(request:Request):string{
  return supportsDerivations(request.headers)?'':' AND NOT EXISTS (SELECT 1 FROM project_derivations d WHERE d.project_id=projects.id)';
}

/** Reuse the existing project lookup; the unique project_id index bounds the probe. */
export function projectClientProjection(request:Request):string{
  return supportsDerivations(request.headers)?'':', EXISTS(SELECT 1 FROM project_derivations d WHERE d.project_id=projects.id) AS _client_requires_derivations';
}
