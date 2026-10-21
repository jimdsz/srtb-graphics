export const CHANNEL_HEADER='X-SRTB-Channel';
export const DEFAULT_CHANNEL='benin-tv';
let active=DEFAULT_CHANNEL;
try{const saved=sessionStorage.getItem('srtb.channel');if(saved&&/^[a-z0-9-]{1,64}$/.test(saved))active=saved;}catch{/* storage can be unavailable */}
export const activeChannelId=()=>active;
export function selectChannel(id:string){
  if(id===active)return;
  const proceed=()=>{active=id;try{sessionStorage.setItem('srtb.channel',id);}catch{/* optional */}window.dispatchEvent(new Event('srtb-channel-change'));};
  const event=new CustomEvent('srtb-before-channel-change',{cancelable:true,detail:{proceed}});
  if(window.dispatchEvent(event))proceed();
}
