export class RecoveryError extends Error {constructor(message:string,public status:number){super(message);}}
export async function recoveryRequest<T>(action:'request'|'verify'|'confirm',body:unknown):Promise<T>{
  let response:Response;
  try{response=await fetch(`/api/auth/recovery/${action}`,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});}catch{throw new RecoveryError('Connexion interrompue. Réessayez ; aucun changement n’est confirmé.',0);}
  const result=await response.json().catch(()=>null);
  if(!response.ok||!result)throw new RecoveryError(result?.error||'Le service ne répond pas. Réessayez dans un instant.',response.status);
  return result;
}
