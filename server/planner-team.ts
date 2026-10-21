import {z} from 'zod';
import type {Member} from '../src/studio/domain';
import {canApprove} from '../src/studio/domain';
import {plannerTaskChoice,planSchema,taskKey} from '../src/studio/day-planner-model';
import {assignmentChoices} from '../src/studio/planner-team';
import {requestChannel} from './channel-access';
import {HttpError,json,readJson} from './http';
export async function plannerTeamRoutes(request:Request,env:Env,member:Member){
 const path=new URL(request.url).pathname,match=path.match(/^\/api\/planner\/([a-f0-9-]{36})\/assignments$/);if(!match)return null;
 const id=match[1],row=await env.DB.prepare("SELECT data_json,revision FROM planner_documents WHERE id=? AND channel_id=? AND kind='plan' AND archived=0").bind(id,requestChannel(request)).first<{data_json:string;revision:number}>();if(!row)throw new HttpError(404,'Préparation introuvable.');
 if(request.method==='GET'){
  const tasks=(await env.DB.prepare(`SELECT a.task_key AS key,a.owner,m.name AS ownerName,a.revision,
   COALESCE((SELECT CASE WHEN p.archived=1 THEN 'archived' ELSE p.status END FROM planner_personal_tasks t JOIN projects p ON p.id=t.project_id WHERE t.plan_id=a.plan_id AND t.actor=a.owner AND (t.task_key=a.task_key OR substr(t.task_key,1,length(a.task_key)+2)=a.task_key||':r') ORDER BY t.source_revision DESC,length(t.task_key) DESC,t.task_key DESC LIMIT 1),'assigned') AS state
   FROM planner_assignments a JOIN members m ON m.email=a.owner WHERE a.plan_id=? ORDER BY a.task_key LIMIT 2000`).bind(id).all()).results;
  const members=(await env.DB.prepare("SELECT m.email,m.name FROM members m JOIN channel_members cm ON cm.email=m.email WHERE cm.channel_id=? AND m.active=1 AND m.tool_scope='graphics' ORDER BY m.name").bind(requestChannel(request)).all()).results;
  return json({tasks,members});
 }
 if(request.method==='POST'){
  const input=z.object({key:z.string().max(1000),revision:z.number().int().nonnegative(),planRevision:z.number().int().positive(),owner:z.email().nullable()}).strict().parse(await readJson(request));
  const choice=plannerTaskChoice({key:input.key}),plan=planSchema.parse(JSON.parse(row.data_json));
  if(!choice||choice.edition!==undefined||!assignmentChoices(plan).some(item=>taskKey(item)===input.key))throw new HttpError(422,'Choisissez une tâche proposée par cette préparation.');
  if(row.revision!==input.planRevision)throw new HttpError(409,'La préparation a changé. Actualisez les attributions.');
  const owner=input.owner?.toLowerCase()??null,current=await env.DB.prepare('SELECT owner,revision FROM planner_assignments WHERE plan_id=? AND task_key=?').bind(id,taskKey(choice)).first<{owner:string;revision:number}>();
  if(!canApprove(member.role)&&(owner&&owner!==member.email||current&&current.owner!==member.email))throw new HttpError(403,'Seul le responsable ou un administrateur/diffuseur peut changer cette attribution.');
  if((current?.revision??0)!==input.revision)throw new HttpError(409,'Cette tâche vient d’être prise ou modifiée. Actualisez.');
  if(owner&&!await env.DB.prepare("SELECT m.email FROM members m JOIN channel_members cm ON cm.email=m.email WHERE cm.channel_id=? AND m.email=? AND m.active=1 AND m.tool_scope='graphics'").bind(requestChannel(request),owner).first())throw new HttpError(422,'Choisissez un membre actif de cette chaîne.');
  // A prepared private project cannot be reassigned by moving its task. Require
  // explicit project sharing/coordination instead of exposing private content.
  const hasProject="EXISTS(SELECT 1 FROM planner_personal_tasks WHERE plan_id=? AND (task_key=? OR substr(task_key,1,length(?)+2)=?||':r'))",projectArgs=[id,input.key,input.key,input.key];
  if(current&&current.owner!==owner&&await env.DB.prepare(`SELECT 1 WHERE ${hasProject}`).bind(...projectArgs).first())throw new HttpError(409,'Un projet privé est déjà lié. Son auteur conserve cette tâche ; partagez son projet explicitement pour collaborer.');
  const unchangedPlan="EXISTS(SELECT 1 FROM planner_documents WHERE id=? AND revision=? AND archived=0)",planArgs=[id,input.planRevision];
  // Keep both the plan revision and the no-private-draft condition in the
  // mutation: project creation and reassignment may arrive simultaneously.
  const mutation=!owner?env.DB.prepare(`DELETE FROM planner_assignments WHERE plan_id=? AND task_key=? AND revision=? AND ${unchangedPlan} AND NOT ${hasProject}`).bind(id,input.key,input.revision,...planArgs,...projectArgs):current?env.DB.prepare(`UPDATE planner_assignments SET owner=?,revision=revision+1,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE plan_id=? AND task_key=? AND revision=? AND ${unchangedPlan} AND (owner=? OR NOT ${hasProject})`).bind(owner,member.email,id,input.key,input.revision,...planArgs,owner,...projectArgs):env.DB.prepare(`INSERT INTO planner_assignments(plan_id,task_key,owner,updated_by) SELECT ?,?,?,? WHERE ${unchangedPlan} AND NOT EXISTS(SELECT 1 FROM planner_personal_tasks WHERE plan_id=? AND actor<>? AND (task_key=? OR substr(task_key,1,length(?)+2)=?||':r')) ON CONFLICT(plan_id,task_key) DO NOTHING`).bind(id,input.key,owner,member.email,...planArgs,id,owner,input.key,input.key,input.key);
  // D1 includes side effects from integrity triggers in meta.changes. This
  // mutation targets one primary key; zero alone means the conditional write lost.
  if(!(await mutation.run()).meta.changes)throw new HttpError(409,'Cette attribution a changé. Actualisez.');return json({ok:true});
 }
 throw new HttpError(405,'Action non disponible.');
}
