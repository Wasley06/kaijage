import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "jsr:@supabase/supabase-js@2.49.8";

const app = new Hono();
const prefix = "/server";
const entities = ["entity_id_001", "entity_id_002"] as const;
const resources = ["products", "sales", "purchases", "customers", "suppliers", "expenses", "notifications"] as const;
const client = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const authClient = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
const tableFor: Record<string, string> = { products:"products", sales:"sales", purchases:"purchases", customers:"customers", suppliers:"suppliers", expenses:"expenses", notifications:"notifications" };
const safeUser = (p: any) => ({ id:p.id, username:p.username, fullName:p.fullName, email:p.email, role:p.role, entities:p.entities || [], active:p.active, avatar:p.avatar || "" });

app.use("*", logger(console.log));
app.use("/*", cors({ origin:"*", allowHeaders:["Content-Type","Authorization","apikey","x-client-info"], allowMethods:["GET","POST","PUT","DELETE","OPTIONS"], exposeHeaders:["Content-Length"], maxAge:600 }));

async function getProfile(id: string) {
  const db = client();
  const [{ data, error }, { data: memberships, error: membershipError }] = await Promise.all([
    db.from("user_profiles").select("*").eq("user_id", id).maybeSingle(),
    db.from("user_businesses").select("business_id").eq("user_id", id),
  ]);
  if (error) throw error;
  if (membershipError) throw membershipError;
  return data ? { id:data.user_id, username:data.username, email:data.email, fullName:data.full_name, role:data.role, active:data.active, avatar:data.avatar || "", entities:(memberships || []).map((x:any)=>x.business_id), createdAt:data.created_at } : null;
}
async function saveProfile(profile: any) {
  const db=client();
  const { error }=await db.from("user_profiles").upsert({ user_id:profile.id, username:profile.username, email:profile.email, full_name:profile.fullName || "", role:profile.role, active:profile.active !== false, avatar:profile.avatar || null, updated_at:new Date().toISOString() });
  if(error) throw error;
  await db.from("user_businesses").delete().eq("user_id",profile.id);
  if(profile.entities?.length){const {error:membershipError}=await db.from("user_businesses").insert(profile.entities.map((business_id:string)=>({user_id:profile.id,business_id})));if(membershipError)throw membershipError;}
}
async function currentUser(c:any) {
  const token=(c.req.header("Authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token)return null;
  const {data,error}=await client().auth.getUser(token);
  if(error||!data.user)return null;
  const profile=await getProfile(data.user.id);
  return profile?.active===false?null:profile;
}
const allowedEntity=(profile:any,entity:string)=>profile?.role==="super_admin"||profile?.role==="admin"||profile?.entities?.includes(entity);
const fieldAllowlist:Record<string,string[]>={
  products:["name","sku","category","unit","buyPrice","sellPrice","stock","minStock","needsPricing"],
  sales:["receipt","date","customer","payment","subtotal","discount","total","amountReceived","change","status","cost","items"],
  purchases:["number","invoice","supplier","date","items","total","amountPaid","balance","status"],
  customers:["name","phone","email","address","status","total"], suppliers:["name","phone","email","address","status","total"],
  expenses:["number","date","category","description","amount","payment","reference","recordedBy"],
  notifications:["title","message","target","read","userId"],
};
function rowRecord(resource:string,row:any){return {...(row.record_data||{}),id:row.id,entityId:row.business_id,updatedAt:row.updated_at||row.created_at};}
async function readResource(resource:string,entityIds:string[]) {
  const db=client(); const table=tableFor[resource];
  const {data,error}=await db.from(table).select("*").in("business_id",entityIds).order(resource==="sales"?"sold_at":"created_at",{ascending:false});
  if(error)throw error;
  const rows=data||[]; const ids=rows.map((x:any)=>x.id);
  if(resource==="sales"&&ids.length){const {data:lines,error:lineError}=await db.from("sale_items").select("*").in("sale_id",ids);if(lineError)throw lineError;const grouped=new Map<string,any[]>();for(const line of lines||[]){const list=grouped.get(line.sale_id)||[];list.push({id:line.product_id,name:line.product_name,qty:Number(line.quantity),price:Number(line.unit_price)});grouped.set(line.sale_id,list);}return rows.map((row:any)=>({...rowRecord(resource,row),items:grouped.get(row.id)||row.record_data?.items||[]}));}
  if(resource==="purchases"&&ids.length){const {data:lines,error:lineError}=await db.from("purchase_items").select("*").in("purchase_id",ids);if(lineError)throw lineError;const grouped=new Map<string,any[]>();for(const line of lines||[]){const list=grouped.get(line.purchase_id)||[];list.push({id:line.product_id,name:line.product_name,qty:Number(line.quantity),cost:Number(line.unit_cost)});grouped.set(line.purchase_id,list);}return rows.map((row:any)=>({...rowRecord(resource,row),items:grouped.get(row.id)||row.record_data?.items||[]}));}
  return rows.map((row:any)=>rowRecord(resource,row));
}
async function saveResource(resource:string,id:string,body:any,user:any){
  const db=client(); const table=tableFor[resource];
  if(!entities.includes(body.entityId)||!allowedEntity(user,body.entityId))throw new Error("You cannot access this business.");
  const clean:any=Object.fromEntries(Object.entries(body).filter(([key,value])=>fieldAllowlist[resource]?.includes(key)&&value!==undefined));
  if(!Object.keys(clean).length)throw new Error("No allowed fields were provided.");
  const {data:oldRow}=await db.from(table).select("*").eq("id",id).maybeSingle();
  if(oldRow&&oldRow.business_id!==body.entityId)throw new Error("Business ownership cannot be changed.");
  if(resource==="products"&&oldRow&&body.expectedStock!==undefined){const current=Number(oldRow.stock);const expected=Number(body.expectedStock);if(current!==expected){const delta=Number(clean.stock)-expected;const reconciled=current+delta;if(!Number.isFinite(delta)||reconciled<0)throw new Error("INVENTORY_CONFLICT: queued stock change exceeds the current available quantity.");clean.stock=reconciled;}}
  const isAdmin=["super_admin","admin"].includes(user.role);
  const changedKeys=oldRow?Object.keys(clean).filter((key)=>JSON.stringify(clean[key])!==JSON.stringify(oldRow.record_data?.[key])):[];
  if(!oldRow){
    const createRoles:Record<string,string[]>={products:["super_admin","admin","manager","stock_manager"],sales:["super_admin","admin","manager","cashier"],purchases:["super_admin","admin","manager","stock_manager"],customers:["super_admin","admin","manager","cashier"],suppliers:["super_admin","admin","manager","stock_manager"],expenses:["super_admin","admin","manager"],notifications:["super_admin","admin","manager","cashier","stock_manager"]};
    if(!createRoles[resource]?.includes(user.role))throw new Error("Your role cannot create this record.");
  }else if(!isAdmin){
    const requestedStock=Number(clean.stock);const currentStock=Number(oldRow.record_data?.stock ?? oldRow.stock);
    const stockOnly=resource==="products"&&changedKeys.every((key)=>key==="stock")&&(user.role==="stock_manager"||(user.role==="cashier"&&requestedStock<=currentStock));
    const ownRead=resource==="notifications"&&oldRow.user_id===user.id&&changedKeys.every((key)=>key==="read");
    if(!stockOnly&&!ownRead)throw new Error("Send existing record changes to an administrator for approval.");
  }
  const now=new Date().toISOString();
  const dbRow:any={id,business_id:body.entityId,record_data:clean};
  if(resource==="products")Object.assign(dbRow,{name:clean.name,sku:clean.sku,category:clean.category||"",unit:clean.unit||"Piece",buy_price:Number(clean.buyPrice||0),sell_price:Number(clean.sellPrice||0),stock:Number(clean.stock||0),min_stock:Number(clean.minStock||0),needs_pricing:Boolean(clean.needsPricing),updated_at:now});
  if(resource==="customers"||resource==="suppliers")Object.assign(dbRow,{name:clean.name,phone:clean.phone||"",email:clean.email||"",address:clean.address||"",status:clean.status||"Active",updated_at:now});
  if(resource==="sales"){const soldAt=clean.date?new Date(String(clean.date)):new Date(now);const {data:customer}=clean.customer?await db.from("customers").select("id").eq("business_id",body.entityId).ilike("name",String(clean.customer)).maybeSingle():{data:null};Object.assign(dbRow,{receipt:clean.receipt||id,sold_at:Number.isNaN(soldAt.getTime())?now:soldAt.toISOString(),customer_id:customer?.id||null,customer_name:clean.customer||"Walk-in customer",payment:clean.payment||"Cash",subtotal:Number(clean.subtotal||0),discount:Number(clean.discount||0),total:Number(clean.total||0),amount_received:Number(clean.amountReceived||0),change_due:Number(clean.change||0),cost:Number(clean.cost||0),status:clean.status||"Completed",created_by:user.id});}
  if(resource==="purchases")Object.assign(dbRow,{number:clean.number||id,invoice:clean.invoice||id,supplier_name:clean.supplier||"",purchased_at:now,total:Number(clean.total||0),amount_paid:Number(clean.amountPaid||0),balance:Number(clean.balance||0),status:clean.status||"Paid",created_by:user.id});
  if(resource==="expenses")Object.assign(dbRow,{number:clean.number||id,category:clean.category||"",description:clean.description||"",amount:Number(clean.amount||0),payment:clean.payment||"",reference:clean.reference||"",recorded_by:clean.recordedBy||"",created_by:user.id});
  if(resource==="notifications")Object.assign(dbRow,{user_id:clean.userId||user.id,title:clean.title||"",message:clean.message||"",target:clean.target||"inventory",is_read:Boolean(clean.read)});
  if(resource==="notifications"&&clean.userId&&clean.userId!==user.id&&!['super_admin','admin'].includes(user.role))throw new Error("You can only manage your own notifications.");
  const {data,error}=await db.from(table).upsert(dbRow).select("*").single();
  if(error)throw error;
  if(resource==="sales"&&Array.isArray(clean.items)){
    await db.from("sale_items").delete().eq("sale_id",id);
    if(clean.items.length){const lineRows=await Promise.all(clean.items.map(async(item:any)=>{const {data:product}=item.id?{data:{id:item.id}}:await db.from("products").select("id").eq("business_id",body.entityId).ilike("name",String(item.name)).maybeSingle();return {sale_id:id,product_id:product?.id||null,product_name:item.name,quantity:Number(item.qty),unit_price:Number(item.price),line_total:Number(item.qty)*Number(item.price)}}));const {error:lineError}=await db.from("sale_items").insert(lineRows);if(lineError)throw lineError;}
  }
  if(resource==="purchases"&&Array.isArray(clean.items)){
    await db.from("purchase_items").delete().eq("purchase_id",id);
    if(clean.items.length){const lineRows=await Promise.all(clean.items.map(async(item:any)=>{const {data:product}=item.id?{data:{id:item.id}}:await db.from("products").select("id").eq("business_id",body.entityId).ilike("name",String(item.name)).maybeSingle();return {purchase_id:id,product_id:product?.id||null,product_name:item.name,quantity:Number(item.qty),unit_cost:Number(item.cost),line_total:Number(item.qty)*Number(item.cost)}}));const {error:lineError}=await db.from("purchase_items").insert(lineRows);if(lineError)throw lineError;}
  }
  if(resource==="products"&&oldRow&&Number(oldRow.stock)!==Number(clean.stock)){
    const delta=Number(clean.stock)-Number(oldRow.stock);
    await db.from("inventory_movements").insert({business_id:body.entityId,product_id:id,movement_type:"adjustment",quantity_delta:delta,source_type:"product_edit",source_id:`${id}:${now}`,created_by:user.id});
  }
  return rowRecord(resource,data);
}

app.get(`${prefix}/health`,async(c)=>{try{const {error}=await client().from("businesses").select("id").limit(1);if(error)throw error;return c.json({status:"ok",database:"ok",storage:"relational"});}catch{return c.json({status:"error",database:"unavailable"},503);}});
app.get(`${prefix}/setup-status`,async(c)=>{const {count,error}=await client().from("user_profiles").select("user_id",{count:"exact",head:true}).eq("role","super_admin");if(error)return c.json({error:"Could not check setup status."},503);return c.json({initialized:(count||0)>0});});
app.post(`${prefix}/setup`,async(c)=>{
  const db=client();const {count}=await db.from("user_profiles").select("user_id",{count:"exact",head:true}).eq("role","super_admin");if((count||0)>0)return c.json({error:"System has already been initialized."},409);
  const body=await c.req.json();if(!body.email||!body.password||!body.username||String(body.password).length<12)return c.json({error:"A username, valid email, and password of at least 12 characters are required."},400);
  const {data,error}=await db.auth.admin.createUser({email:body.email,password:body.password,email_confirm:true});if(error||!data.user)return c.json({error:error?.message||"Could not create owner."},400);
  const profile={id:data.user.id,username:String(body.username).trim(),email:body.email,fullName:body.fullName||"System Owner",role:"super_admin",entities:[...entities],active:true};
  try{await saveProfile(profile);}catch(e){await db.auth.admin.deleteUser(data.user.id);return c.json({error:"Could not save owner profile."},500);}
  return c.json({ok:true});
});
app.post(`${prefix}/login`,async(c)=>{const body=await c.req.json();const {data:row}=await client().from("user_profiles").select("email,active").ilike("username",String(body.username||"")).maybeSingle();let email=row?.email;if(!email){const byEmail=await client().from("user_profiles").select("email,active").ilike("email",String(body.username||"")).maybeSingle();email=byEmail.data?.email;if(byEmail.data?.active===false)email=null;}if(!email||row?.active===false)return c.json({error:"Invalid username or password."},401);const {data,error}=await authClient().auth.signInWithPassword({email,password:body.password});if(error||!data.session)return c.json({error:"Invalid username or password."},401);const profile=await getProfile(data.user.id);if(!profile?.active)return c.json({error:"Invalid username or password."},401);return c.json({accessToken:data.session.access_token,refreshToken:data.session.refresh_token,user:safeUser(profile)});});
app.get(`${prefix}/me`,async(c)=>{const user=await currentUser(c);return user?c.json({user:safeUser(user)}):c.json({error:"Unauthorized"},401);});
app.get(`${prefix}/state`,async(c)=>{
  const user=await currentUser(c);if(!user)return c.json({error:"Unauthorized"},401);
  try{
    const result:Record<string,any[]>={};
    for(const resource of resources){const records=await readResource(resource,user.entities);result[resource]=resource==="notifications"?records.filter((r:any)=>!r.userId||r.userId===user.id||["super_admin","admin"].includes(user.role)):records;}
    const db=client();
    if(["super_admin","admin"].includes(user.role)){const {data,error}=await db.from("edit_requests").select("*").in("business_id",user.entities).order("created_at",{ascending:false});if(error)throw error;result.edit_requests=(data||[]).map((r:any)=>({id:r.id,entityId:r.business_id,resource:r.resource,recordId:r.record_id,recordLabel:r.record_label,changes:r.changes,status:r.status,createdBy:r.created_by,createdByName:r.created_by_name,reviewedBy:r.reviewed_by,createdAt:r.created_at,reviewedAt:r.reviewed_at}));}
    else result.edit_requests=[];
    result.users=[];
    if(["super_admin","admin","manager"].includes(user.role)){const {data:memberships,error}=await db.from("user_businesses").select("user_id,business_id").in("business_id",user.entities);if(error)throw error;const ids=[...new Set((memberships||[]).map((m:any)=>m.user_id))];if(ids.length){const {data:profiles,error:profileError}=await db.from("user_profiles").select("*").in("user_id",ids);if(profileError)throw profileError;const memberMap=new Map<string,string[]>();for(const m of memberships||[])memberMap.set(m.user_id,[...(memberMap.get(m.user_id)||[]),m.business_id]);result.users=(profiles||[]).filter((p:any)=>user.role==="super_admin"||p.role!=="super_admin").map((p:any)=>safeUser({id:p.user_id,username:p.username,email:p.email,fullName:p.full_name,role:p.role,active:p.active,avatar:p.avatar,entities:memberMap.get(p.user_id)||[]}));}}
    return c.json(result);
  }catch(error){console.error("state read failed",error);return c.json({error:"Could not load business data."},503);}
});
app.post(`${prefix}/edit-requests`,async(c)=>{
  const actor=await currentUser(c);if(!actor)return c.json({error:"Unauthorized"},401);if(["super_admin","admin"].includes(actor.role))return c.json({error:"Administrators can edit records directly."},403);
  const idempotencyKey=c.req.header("x-idempotency-key");if(idempotencyKey){const {data:prior}=await client().from("request_deduplication").select("response").eq("idempotency_key",idempotencyKey).eq("user_id",actor.id).maybeSingle();if(prior?.response)return c.json(prior.response);}
  const body=await c.req.json();const allowed=fieldAllowlist[body.resource];if(!allowed||!body.recordId||!body.changes||typeof body.changes!=="object")return c.json({error:"Choose a supported record and provide corrected fields."},400);
  const table=tableFor[body.resource];const {data:row}=await client().from(table).select("*").eq("id",body.recordId).maybeSingle();if(!row||!allowedEntity(actor,row.business_id))return c.json({error:"Record not found or business access denied."},404);
  const changes=Object.fromEntries(Object.entries(body.changes).filter(([key,value])=>allowed.includes(key)&&value!==undefined));if(!Object.keys(changes).length)return c.json({error:"No editable fields were provided."},400);
  const record={id:crypto.randomUUID(),entityId:row.business_id,resource:body.resource,recordId:body.recordId,recordLabel:row.record_data?.name||row.record_data?.receipt||row.record_data?.number||body.recordId,changes,status:"Pending",createdBy:actor.id,createdByName:actor.fullName||actor.username,createdAt:new Date().toISOString()};
  const {error}=await client().from("edit_requests").insert({id:record.id,business_id:record.entityId,resource:record.resource,record_id:record.recordId,record_label:record.recordLabel,changes:record.changes,status:record.status,created_by:record.createdBy,created_by_name:record.createdByName});if(error)return c.json({error:"Could not submit edit request."},500);
  const {data:admins}=await client().from("user_profiles").select("user_id,role").in("role",["admin","super_admin"]).eq("active",true);for(const admin of admins||[]){const profile=await getProfile(admin.user_id);if(profile&&allowedEntity(profile,record.entityId)){await client().from("notifications").insert({id:crypto.randomUUID(),business_id:record.entityId,user_id:admin.user_id,title:"Record edit awaiting approval",message:`${record.createdByName} requested a change to ${record.recordLabel}.`,target:"approvals",is_read:false,record_data:{}});}}
  const response={request:record};if(idempotencyKey)await client().from("request_deduplication").upsert({idempotency_key:idempotencyKey,user_id:actor.id,response});return c.json(response,201);
});
app.put(`${prefix}/edit-requests/:id`,async(c)=>{
  const actor=await currentUser(c);if(!actor||!["super_admin","admin"].includes(actor.role))return c.json({error:"Administrator approval is required."},403);
  const {data:row}=await client().from("edit_requests").select("*").eq("id",c.req.param("id")).maybeSingle();if(!row)return c.json({error:"Edit request not found."},404);if(!allowedEntity(actor,row.business_id))return c.json({error:"You cannot access this business."},403);if(row.status!=="Pending")return c.json({error:"This request has already been reviewed."},409);
  const {status}=await c.req.json();if(!["Approved","Rejected"].includes(status))return c.json({error:"Choose approve or reject."},400);
  let updated:any=null;if(status==="Approved"){const table=tableFor[row.resource];if(!table)return c.json({error:"Invalid record type."},400);const {data:current}=await client().from(table).select("*").eq("id",row.record_id).maybeSingle();if(!current||current.business_id!==row.business_id)return c.json({error:"The original record is no longer available."},409);const merged={...current.record_data,...row.changes};updated=await saveResource(row.resource,row.record_id,{...merged,entityId:row.business_id},actor);}
  const now=new Date().toISOString();const {error}=await client().from("edit_requests").update({status,reviewed_by:actor.id,reviewed_at:now}).eq("id",row.id);if(error)return c.json({error:"Could not review the request."},500);
  const record={id:row.id,entityId:row.business_id,resource:row.resource,recordId:row.record_id,recordLabel:row.record_label,changes:row.changes,status,createdBy:row.created_by,createdByName:row.created_by_name,reviewedBy:actor.id,createdAt:row.created_at,reviewedAt:now};
  await client().from("notifications").insert({id:crypto.randomUUID(),business_id:row.business_id,user_id:row.created_by,title:`Edit request ${status.toLowerCase()}`,message:`Your change to ${row.record_label} was ${status.toLowerCase()}.`,target:row.resource,is_read:false,record_data:{}});
  return c.json({request:record,record:updated});
});
app.put(`${prefix}/resource/:resource/:id`,async(c)=>{const user=await currentUser(c);if(!user)return c.json({error:"Unauthorized"},401);const resource=c.req.param("resource");if(!resources.includes(resource as any))return c.json({error:"Unknown resource."},404);const db=client();const idempotencyKey=c.req.header("x-idempotency-key");if(idempotencyKey){const {data:prior}=await db.from("request_deduplication").select("response").eq("idempotency_key",idempotencyKey).eq("user_id",user.id).maybeSingle();if(prior?.response)return c.json(prior.response);}try{const record=await saveResource(resource,c.req.param("id"),await c.req.json(),user);const response={record};if(idempotencyKey)await db.from("request_deduplication").upsert({idempotency_key:idempotencyKey,user_id:user.id,response});return c.json(response);}catch(error){const message=error instanceof Error?error.message:"Could not save record.";const conflict=message.startsWith("INVENTORY_CONFLICT:");return c.json({error:conflict?message.slice("INVENTORY_CONFLICT:".length).trim():message},conflict?409:400);}});
app.delete(`${prefix}/resource/:resource/:id`,async(c)=>{const user=await currentUser(c);if(!user||!["super_admin","admin"].includes(user.role))return c.json({error:"Administrator approval is required."},403);const resource=c.req.param("resource");if(!resources.includes(resource as any))return c.json({error:"Unknown resource."},404);const db=client();const {data:row}=await db.from(tableFor[resource]).select("business_id").eq("id",c.req.param("id")).maybeSingle();if(row&&!allowedEntity(user,row.business_id))return c.json({error:"Forbidden"},403);const {error}=await db.from(tableFor[resource]).delete().eq("id",c.req.param("id"));return error?c.json({error:"Could not delete record."},500):c.json({ok:true});});
app.post(`${prefix}/users`,async(c)=>{const actor=await currentUser(c);if(!actor||!["super_admin","admin"].includes(actor.role))return c.json({error:"Administrator approval is required."},403);const body=await c.req.json();if(!body.email||!body.password||!body.username||!["admin","manager","cashier","stock_manager"].includes(body.role))return c.json({error:"Complete all required employee fields."},400);if(actor.role!=="super_admin"&&body.role==="admin")return c.json({error:"Only the system owner can add another administrator."},403);const requested=(body.entities||[]).filter((x:string)=>entities.includes(x as any)&&allowedEntity(actor,x));if(!requested.length)return c.json({error:"Assign at least one business you can manage."},400);const db=client();const {data,error}=await db.auth.admin.createUser({email:body.email,password:body.password,email_confirm:true});if(error||!data.user)return c.json({error:error?.message||"Could not create user."},400);const profile={id:data.user.id,username:String(body.username).trim(),email:body.email,fullName:body.fullName||"",role:body.role,entities:requested,active:true};try{await saveProfile(profile);}catch{await db.auth.admin.deleteUser(data.user.id);return c.json({error:"Could not save user profile."},500);}return c.json({user:safeUser(profile)});});
app.put(`${prefix}/users/:id`,async(c)=>{const actor=await currentUser(c);if(!actor)return c.json({error:"Unauthorized"},401);const existing=await getProfile(c.req.param("id"));if(!existing)return c.json({error:"User not found."},404);const self=actor.id===existing.id;if(!self&&!["super_admin","admin"].includes(actor.role))return c.json({error:"Administrator approval is required."},403);if(existing.role==="super_admin"&&actor.role!=="super_admin")return c.json({error:"The system owner cannot be changed by another user."},403);const body=await c.req.json();const profile=self?{...existing,fullName:body.fullName??existing.fullName,avatar:body.avatar??existing.avatar}:{...existing,fullName:body.fullName??existing.fullName,active:body.active??existing.active,entities:(body.entities||existing.entities).filter((e:string)=>allowedEntity(actor,e)),avatar:body.avatar??existing.avatar};await saveProfile(profile);return c.json({user:safeUser(profile)});});

app.notFound((c)=>c.json({error:"Route not found."},404));
Deno.serve(app.fetch);
