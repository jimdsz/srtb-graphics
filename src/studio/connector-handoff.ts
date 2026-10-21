// A one-use code, never a disk path or the connector owner's capability.
// URL fragments are not sent to the server. Remove it before React mounts;
// keep it only in memory while the person signs in and confirms the connection.
type Handoff={code:string;expires:number};
let pending:Handoff|null=null;
export function readConnectorHandoff(hash:string,now=Date.now()):Handoff|null{
 const match=/^#connect-media=([A-F0-9]{12})$/.exec(hash);
 return match?{code:match[1],expires:now+300000}:null;
}
export function captureConnectorHandoff(){
 if(!window.location.hash.startsWith('#connect-media='))return;
 pending=readConnectorHandoff(window.location.hash);
 window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search);
}
export function pendingConnectorHandoff(){if(pending&&pending.expires<=Date.now())pending=null;return pending;}
export function clearConnectorHandoff(){pending=null;}
