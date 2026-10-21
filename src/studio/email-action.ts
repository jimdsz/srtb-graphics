import type {ActionCodeInfo} from 'firebase/auth';

const operations={verifyEmail:'VERIFY_EMAIL',recoverEmail:'RECOVER_EMAIL',verifyAndChangeEmail:'VERIFY_AND_CHANGE_EMAIL'} as const;
export type EmailActionMode=keyof typeof operations;
export interface ReviewedEmailAction {mode:EmailActionMode;operation:typeof operations[EmailActionMode];email:string;previousEmail:string|null}
export class EmailActionError extends Error {
 constructor(public reason:'unsupported'|'mismatch'|'data',message:string){super(message);}
}
export function emailActionMode(mode:string|null):mode is EmailActionMode{return mode!==null&&Object.hasOwn(operations,mode);}
function checkedEmail(value:unknown):string {
 if(typeof value!=='string'||value.length>254||value!==value.trim()||!value.includes('.')||!/^[^\s@<>]+@[^\s@<>]+$/.test(value)||/[\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(value))throw new EmailActionError('data','Le fournisseur n’a pas confirmé les adresses nécessaires. Aucune action ne sera appliquée.');
 return value;
}
/** Provider data.email is the destination for BOTH recover and change actions;
 * previousEmail is the address that would be replaced. Never use URL emails. */
export function reviewEmailAction(mode:string|null,info:ActionCodeInfo):ReviewedEmailAction {
 if(!emailActionMode(mode))throw new EmailActionError('unsupported','Cette action n’est pas prise en charge par cet écran. Aucune modification n’a été demandée.');
 if(info.operation!==operations[mode])throw new EmailActionError('mismatch','Le lien ne correspond pas à l’action confirmée par le fournisseur. Aucune modification n’a été demandée.');
 const email=checkedEmail(info.data?.email),previousEmail=mode==='verifyEmail'?null:checkedEmail(info.data?.previousEmail);
 if(previousEmail&&previousEmail.toLocaleLowerCase('en')===email.toLocaleLowerCase('en'))throw new EmailActionError('data','Le fournisseur ne distingue pas les deux adresses. Aucune action ne sera appliquée.');
 return {mode,operation:operations[mode],email,previousEmail};
}
export const emailActionCopy={
 verifyEmail:{title:'Confirmer votre adresse.',button:'Confirmer cette adresse',destination:'Adresse à confirmer',intention:'Confirmez que cette adresse vous appartient. Cette action ne change pas votre mot de passe.',done:'Adresse confirmée.',complete:'Votre adresse est confirmée. Vous pouvez vous connecter.',invalid:'Utilisez le dernier e-mail de vérification. Vous pouvez en demander un nouveau après vous être connecté, si votre adresse doit encore être confirmée.'},
 recoverEmail:{title:'Rétablir votre adresse.',button:'Rétablir cette adresse',destination:'Adresse à rétablir',intention:'Cette action annule un changement d’adresse. L’adresse actuelle sera remplacée par l’adresse à rétablir.',done:'Adresse rétablie.',complete:'Le changement d’adresse a été annulé. Utilisez l’adresse rétablie pour vous connecter.',invalid:'Utilisez le dernier e-mail permettant d’annuler le changement d’adresse. S’il n’est plus utilisable, contactez l’administrateur SRTB.'},
 verifyAndChangeEmail:{title:'Changer votre adresse.',button:'Confirmer le changement',destination:'Nouvelle adresse',intention:'Cette action confirme la nouvelle adresse et remplace votre adresse de connexion. Elle ne crée pas de droits d’accès Graphics.',done:'Adresse modifiée.',complete:'Utilisez la nouvelle adresse pour vous connecter. Si votre accès Graphics n’est pas reconnu, contactez l’administrateur SRTB.',invalid:'Recommencez la demande de changement d’adresse avec votre administrateur SRTB. Une réinitialisation du mot de passe ne remplace pas cette vérification.'},
} as const;

/** Bound the UI wait, not the provider write. Callers must retain their mutation
 * lock until the original promise settles, including after this local timeout. */
export function waitForEmailProvider<T>(operation:Promise<T>,timeoutMs=20000):Promise<T>{
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Object.assign(new Error('Provider response timeout'),{code:'auth/network-request-failed'})),timeoutMs);
  operation.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
 });
}
