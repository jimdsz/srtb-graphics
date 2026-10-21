// Local-only regression entry, bundled with the exact production options.
import {mediaStore} from '../server/storage';
import {objectResponse} from '../server/media';
const settings={APP_ENV:'production',STORAGE_PROVIDER:'b2',B2_REGION:'eu-central-003',B2_BUCKET:'srtb-test-private',B2_KEY_ID:'test000000000000000000000',B2_APPLICATION_KEY:'unit-test-key-not-real000000000000'};
export default {async fetch(request:Request){
  try{return await objectResponse(request,mediaStore(settings),'uploads/12345678-1234-1234-1234-123456789012','video/mp4');}
  catch(error){return Response.json({name:error instanceof Error?error.name:'unknown',message:error instanceof Error?error.message:'unknown',stack:error instanceof Error?error.stack:''},{status:500});}
}};
