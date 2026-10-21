// Isolated UI fixture: no user account, remote API or media transfer.
import {api} from '../src/studio/api';
import {activeChannelId} from '../src/studio/channel-context';
import {broadcastTemplates} from '../src/studio/domain';
import {plannerAPI} from '../src/studio/day-planner-api';

api.channels=async()=>[
  {id:'benin-tv',name:'Bénin TV',logo:'',accent:'#efbd32',timezone:'Africa/Porto-Novo',revision:1,archived:0,canManage:true},
  {id:'nouvelle-chaine',name:'Nouvelle chaîne',logo:'',accent:'#efbd32',timezone:'Africa/Porto-Novo',revision:1,archived:0,canManage:true},
];
api.catalogue=async()=>activeChannelId()==='benin-tv'?broadcastTemplates:[];
api.programmes=async()=>[];
api.channelMembers=async()=>api.members();
api.setChannelMember=async()=>({});
api.search=async query=>({projects:(await api.projects()).projects.filter(project=>project.title.toLocaleLowerCase('fr').includes(query.toLocaleLowerCase('fr'))),programmes:[],media:[]});
plannerAPI.list=async()=>({documents:[],next:null});
plannerAPI.overview=async(view,date)=>({items:[],next:null,view,date});
await import('./operator-shell');
const projects=api.projects;
api.projects=async(...args)=>activeChannelId()==='benin-tv'?projects(...args):{projects:[],next:null};
