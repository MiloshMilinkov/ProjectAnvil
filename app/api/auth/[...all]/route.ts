import {getAuth,getSessionUser} from '../../../lib/auth';
import {routeError} from '../../../lib/workspace-store';

const postPaths=new Set(['sign-up/email','sign-in/username','sign-out','change-password']);
export async function GET(request:Request){
  const path=new URL(request.url).pathname.replace(/^\/api\/auth\//,'');
  if(path!=='get-session')return Response.json({error:'Not found'},{status:404});
  try{return await (await getAuth(request)).handler(request)}catch(error){return routeError(error)}
}
export async function POST(request:Request){
  try{
    const path=new URL(request.url).pathname.replace(/^\/api\/auth\//,'');
    if(!postPaths.has(path))return Response.json({error:'Not found'},{status:404});
    if(!request.headers.get('content-type')?.includes('application/json'))return Response.json({message:'Send a JSON request.'},{status:415});
    const expected=request.headers.get('x-account-id');
    if(expected&&expected!==((await getSessionUser(request))?.id||'guest'))return Response.json({message:'The signed-in account changed. Reload before continuing.'},{status:409});
    const raw=await request.text();
    if(new TextEncoder().encode(raw).length>10000)return Response.json({message:'This request is too large.'},{status:413});
    const body=JSON.parse(raw);
    if(!body||typeof body!=='object'||Array.isArray(body))return Response.json({message:'Enter valid account details.'},{status:400});
    if(path==='sign-up/email'){
      if(typeof body.username!=='string'||!/^[A-Za-z0-9_.]{3,30}$/.test(body.username))return Response.json({message:'Choose a username with 3–30 letters, numbers, underscores, or dots.'},{status:400});
      body.name=body.username;
      delete body.displayUsername;
    }
    const forwarded=new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(body)});
    return await (await getAuth(request)).handler(forwarded);
  }catch(error){return routeError(error)}
}
