/** A pending confirmation holds only an action, never copies/replaces form data.
 * Refusal is a no-op for the form; explicit confirmation consumes it once. */
export function createFormExitGuard(onPending:(pending:boolean)=>void){
  let action:(()=>void)|undefined;
  return {
    get pending(){return !!action;},
    request(hasForm:boolean,next:()=>void){if(action)return;if(!hasForm){next();return;}action=next;onPending(true);},
    cancel(){if(!action)return;action=undefined;onPending(false);},
    confirm(){const next=action;if(!next)return;action=undefined;onPending(false);next();},
  };
}
