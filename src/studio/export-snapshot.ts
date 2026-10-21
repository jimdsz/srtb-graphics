import {request} from './api';
import type {Project} from './domain';
import type {DeliveryPlan} from './delivery-plan';
import {getTemplate} from './domain';
import {stableLocalData} from './local-media';

// Serialize synchronously: subsequent edits must not alter an export in progress.
export function exportSnapshot(project:Project,signal:AbortSignal):Promise<DeliveryPlan>{
  return request(`/projects/${project.id}/export`,{method:'POST',signal,body:JSON.stringify({title:project.title,revision:project.revision,data:stableLocalData(getTemplate(project.template_id),project.data)})});
}
