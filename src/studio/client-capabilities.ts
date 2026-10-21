/** Public wire contract, not an authentication or authorization credential. */
export const CLIENT_CAPABILITIES_HEADER='X-SRTB-Client-Capabilities';
export const DERIVATIONS_CAPABILITY='derivations-v1';

export function supportsDerivations(headers:Headers):boolean{
  return (headers.get(CLIENT_CAPABILITIES_HEADER)??'').split(',').some(value=>value.trim()===DERIVATIONS_CAPABILITY);
}
