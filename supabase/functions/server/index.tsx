import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "jsr:@supabase/supabase-js@2.49.8";
import * as kv from "./kv_store.tsx";

const app = new Hono();
const prefix = "/make-server-4efeeff6";
const entities = ["entity_id_001", "entity_id_002"] as const;
const resources = ["products", "sales", "purchases", "customers", "suppliers", "expenses", "notifications"] as const;

app.use("*", logger(console.log));
app.use("/*", cors({
  origin: "*",
  allowHeaders: ["Content-Type", "Authorization", "apikey", "x-client-info"],
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  exposeHeaders: ["Content-Length"],
  maxAge: 600,
}));

const adminClient = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const anonClient = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
const safeUser = (profile: any) => ({ id: profile.id, username: profile.username, fullName: profile.fullName, email: profile.email, role: profile.role, entities: profile.entities, active: profile.active, avatar: profile.avatar || "" });

async function currentUser(c: any) {
  const token = (c.req.header("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) return null;
  const profile = await kv.get(`profile:${data.user.id}`);
  return profile?.active === false ? null : profile;
}

function allowedEntity(profile: any, entity: string) {
  return profile?.role === "super_admin" || profile?.role === "admin" || profile?.entities?.includes(entity);
}

app.get(`${prefix}/health`, async (c) => {
  try {
    await kv.get("system:initialized");
    return c.json({ status: "ok", database: "ok" });
  } catch {
    return c.json({ status: "error", database: "unavailable" }, 503);
  }
});

app.get(`${prefix}/setup-status`, async (c) => c.json({ initialized: Boolean(await kv.get("system:initialized")) }));

app.post(`${prefix}/setup`, async (c) => {
  if (await kv.get("system:initialized")) return c.json({ error: "System has already been initialized." }, 409);
  const body = await c.req.json();
  if (!body.email || !body.password || !body.username || body.password.length < 8) return c.json({ error: "A username, valid email, and password of at least 8 characters are required." }, 400);
  const { data, error } = await adminClient().auth.admin.createUser({ email: body.email, password: body.password, email_confirm: true });
  if (error || !data.user) return c.json({ error: error?.message || "Could not create owner." }, 400);
  const profile = { id: data.user.id, username: body.username, email: body.email, fullName: body.fullName || "System Owner", role: "super_admin", entities: [...entities], active: true, createdAt: new Date().toISOString() };
  await kv.set(`profile:${data.user.id}`, profile);
  await kv.set("system:initialized", { at: new Date().toISOString(), ownerId: data.user.id });
  return c.json({ ok: true });
});

app.post(`${prefix}/login`, async (c) => {
  const body = await c.req.json();
  const profiles = await kv.getByPrefix("profile:");
  const profile = profiles.find((p: any) => p.username?.toLowerCase() === String(body.username || "").toLowerCase() || p.email?.toLowerCase() === String(body.username || "").toLowerCase());
  if (!profile || profile.active === false) return c.json({ error: "Invalid username or password." }, 401);
  const { data, error } = await anonClient().auth.signInWithPassword({ email: profile.email, password: body.password });
  if (error || !data.session) return c.json({ error: "Invalid username or password." }, 401);
  return c.json({ accessToken: data.session.access_token, refreshToken: data.session.refresh_token, user: safeUser(profile) });
});

app.get(`${prefix}/me`, async (c) => {
  const user = await currentUser(c);
  return user ? c.json({ user: safeUser(user) }) : c.json({ error: "Unauthorized" }, 401);
});

app.get(`${prefix}/state`, async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const result: Record<string, any[]> = {};
  for (const resource of resources) {
    result[resource] = (await kv.getByPrefix(`${resource}:`)).filter((record: any) =>
      allowedEntity(user, record.entityId) && (!record.userId || record.userId === user.id || ["super_admin", "admin"].includes(user.role))
    );
  }
  result.edit_requests = ["super_admin", "admin"].includes(user.role)
    ? (await kv.getByPrefix("edit_requests:")).filter((record: any) => allowedEntity(user, record.entityId))
    : [];
  // Keep the system owner account out of ordinary employee listings. The owner
  // can still see it from the owner account itself for account recovery.
  const users = ["super_admin", "admin", "manager"].includes(user.role)
    ? (await kv.getByPrefix("profile:")).filter((profile: any) => user.role === "super_admin" || profile.role !== "super_admin").map(safeUser)
    : [];
  return c.json({ ...result, users });
});

app.post(`${prefix}/edit-requests`, async (c) => {
  const actor = await currentUser(c);
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  if (["super_admin", "admin"].includes(actor.role)) return c.json({ error: "Administrators can edit records directly." }, 403);
  const body = await c.req.json();
  const editableFields: Record<string, string[]> = {
    products: ["name", "category", "buyPrice", "sellPrice", "stock", "minStock", "unit"],
    customers: ["name", "phone", "email", "address"],
    suppliers: ["name", "phone", "email", "address"],
    sales: ["customer", "payment", "discount", "status"],
    purchases: ["supplier", "items", "amountPaid", "status"],
    expenses: ["category", "description", "amount", "payment", "reference"],
  };
  const allowedFields = editableFields[body.resource];
  if (!allowedFields || !body.recordId || !body.changes || typeof body.changes !== "object" || Array.isArray(body.changes)) {
    return c.json({ error: "Choose a supported record and provide the corrected fields." }, 400);
  }
  const existing = await kv.get(`${body.resource}:${body.recordId}`);
  if (!existing || !allowedEntity(actor, existing.entityId)) return c.json({ error: "Record not found or business access denied." }, 404);
  const changes = Object.fromEntries(Object.entries(body.changes).filter(([key, value]) => allowedFields.includes(key) && value !== undefined));
  if (!Object.keys(changes).length) return c.json({ error: "No editable fields were provided." }, 400);
  const now = new Date().toISOString();
  const request = { id: crypto.randomUUID(), entityId: existing.entityId, resource: body.resource, recordId: body.recordId, recordLabel: existing.name || existing.receipt || existing.number || body.recordId, changes, status: "Pending", createdBy: actor.id, createdByName: actor.fullName || actor.username, createdAt: now };
  await kv.set(`edit_requests:${request.id}`, request);
  const admins = (await kv.getByPrefix("profile:")).filter((profile: any) => ["super_admin", "admin"].includes(profile.role) && profile.active !== false && allowedEntity(profile, existing.entityId));
  for (const admin of admins) {
    const notification = { id: crypto.randomUUID(), entityId: existing.entityId, userId: admin.id, title: "Record edit awaiting approval", message: `${request.createdByName} requested a change to ${request.recordLabel}.`, target: "approvals", read: false, createdAt: now };
    await kv.set(`notifications:${notification.id}`, notification);
  }
  return c.json({ request }, 201);
});

app.put(`${prefix}/edit-requests/:id`, async (c) => {
  const actor = await currentUser(c);
  if (!actor || !["super_admin", "admin"].includes(actor.role)) return c.json({ error: "Administrator approval is required." }, 403);
  const request = await kv.get(`edit_requests:${c.req.param("id")}`);
  if (!request) return c.json({ error: "Edit request not found." }, 404);
  if (!allowedEntity(actor, request.entityId)) return c.json({ error: "You cannot access this business." }, 403);
  if (request.status !== "Pending") return c.json({ error: "This request has already been reviewed." }, 409);
  const { status } = await c.req.json();
  if (!["Approved", "Rejected"].includes(status)) return c.json({ error: "Choose approve or reject." }, 400);
  if (status === "Approved") {
    const existing = await kv.get(`${request.resource}:${request.recordId}`);
    if (!existing || existing.entityId !== request.entityId) return c.json({ error: "The original record is no longer available." }, 409);
    await kv.set(`${request.resource}:${request.recordId}`, { ...existing, ...request.changes, id: existing.id, entityId: existing.entityId, updatedAt: new Date().toISOString(), updatedBy: actor.id });
  }
  const reviewed = { ...request, status, reviewedBy: actor.id, reviewedAt: new Date().toISOString() };
  await kv.set(`edit_requests:${request.id}`, reviewed);
  const notification = { id: crypto.randomUUID(), entityId: request.entityId, userId: request.createdBy, title: `Edit request ${status.toLowerCase()}`, message: `Your change to ${request.recordLabel} was ${status.toLowerCase()}.`, target: request.resource, read: false, createdAt: reviewed.reviewedAt };
  await kv.set(`notifications:${notification.id}`, notification);
  return c.json({ request: reviewed });
});

app.put(`${prefix}/resource/:resource/:id`, async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const resource = c.req.param("resource");
  if (!resources.includes(resource as any)) return c.json({ error: "Unknown resource." }, 404);
  const body = await c.req.json();
  if (!entities.includes(body.entityId) || !allowedEntity(user, body.entityId)) return c.json({ error: "You cannot access this business." }, 403);
  const existing = await kv.get(`${resource}:${c.req.param("id")}`);
  const record = { ...existing, ...body, id: c.req.param("id"), updatedAt: new Date().toISOString(), updatedBy: user.id };
  await kv.set(`${resource}:${record.id}`, record);
  return c.json({ record });
});

app.delete(`${prefix}/resource/:resource/:id`, async (c) => {
  const user = await currentUser(c);
  if (!user || !["super_admin", "admin"].includes(user.role)) return c.json({ error: "Administrator approval is required." }, 403);
  const resource = c.req.param("resource");
  if (!resources.includes(resource as any)) return c.json({ error: "Unknown resource." }, 404);
  const existing = await kv.get(`${resource}:${c.req.param("id")}`);
  if (existing && !allowedEntity(user, existing.entityId)) return c.json({ error: "Forbidden" }, 403);
  await kv.del(`${resource}:${c.req.param("id")}`);
  return c.json({ ok: true });
});

app.post(`${prefix}/users`, async (c) => {
  const actor = await currentUser(c);
  if (!actor || !["super_admin", "admin"].includes(actor.role)) return c.json({ error: "Administrator approval is required." }, 403);
  const body = await c.req.json();
  if (!body.email || !body.password || !body.username || !["admin", "manager", "cashier", "stock_manager"].includes(body.role)) return c.json({ error: "Complete all required employee fields." }, 400);
  if (actor.role !== "super_admin" && body.role === "admin") return c.json({ error: "Only the system owner can add another administrator." }, 403);
  const requestedEntities = (body.entities || []).filter((x: string) => entities.includes(x as any));
  if (!requestedEntities.length) return c.json({ error: "Assign at least one business." }, 400);
  const { data, error } = await adminClient().auth.admin.createUser({ email: body.email, password: body.password, email_confirm: true });
  if (error || !data.user) return c.json({ error: error?.message || "Could not create user." }, 400);
  const profile = { id: data.user.id, username: body.username, email: body.email, fullName: body.fullName, role: body.role, entities: requestedEntities, active: true, createdAt: new Date().toISOString() };
  await kv.set(`profile:${data.user.id}`, profile);
  return c.json({ user: safeUser(profile) });
});

app.put(`${prefix}/users/:id`, async (c) => {
  const actor = await currentUser(c);
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const existing = await kv.get(`profile:${c.req.param("id")}`);
  if (!existing) return c.json({ error: "User not found." }, 404);
  const isSelf = actor.id === existing.id;
  if (!isSelf && !["super_admin", "admin"].includes(actor.role)) return c.json({ error: "Administrator approval is required." }, 403);
  if (existing.role === "super_admin" && actor.role !== "super_admin") return c.json({ error: "The system owner cannot be changed by another user." }, 403);
  const body = await c.req.json();
  const profile = isSelf
    ? { ...existing, fullName: body.fullName ?? existing.fullName, avatar: body.avatar ?? existing.avatar }
    : { ...existing, fullName: body.fullName ?? existing.fullName, active: body.active ?? existing.active, entities: body.entities ?? existing.entities, avatar: body.avatar ?? existing.avatar };
  await kv.set(`profile:${existing.id}`, profile);
  return c.json({ user: safeUser(profile) });
});

Deno.serve(app.fetch);
