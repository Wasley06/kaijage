-- Storage used by supabase/functions/server/kv_store.tsx.
-- This preserves the existing JSONB record format and can be run repeatedly.
begin;

create table if not exists public.kv_store_4efeeff6 (
  key text primary key,
  value jsonb not null
);

alter table public.kv_store_4efeeff6 enable row level security;

-- The browser must use the Edge Function. Only its server-side service role
-- may access this table directly; never put a service-role key in the app.
revoke all on table public.kv_store_4efeeff6 from anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.kv_store_4efeeff6 to service_role;

commit;
