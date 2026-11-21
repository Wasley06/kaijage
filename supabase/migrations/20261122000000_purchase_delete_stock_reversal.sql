begin;
create or replace function public.delete_pos_resource(p_resource text, p_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  line record;
  affected integer;
  resource_business_id text;
  target_product_id text;
begin
  case p_resource
    when 'sales' then
      for line in select product_id, quantity from public.sale_items where sale_id = p_id and product_id is not null loop
        update public.products set stock = stock + line.quantity, updated_at = now() where id = line.product_id;
      end loop;
      delete from public.sales where id = p_id;
      get diagnostics affected = row_count;
    when 'purchases' then
      select business_id into resource_business_id from public.purchases where id = p_id for update;
      if resource_business_id is null then raise exception 'Record not found.' using errcode = 'P0002'; end if;
      for line in select product_id, product_name, quantity from public.purchase_items where purchase_id = p_id loop
        target_product_id := line.product_id;
        if target_product_id is null then
          select id into target_product_id from public.products
            where business_id = resource_business_id and lower(name) = lower(line.product_name)
            order by created_at limit 1;
        end if;
        if target_product_id is not null then
          update public.products set stock = greatest(0, stock - line.quantity), updated_at = now()
            where id = target_product_id and business_id = resource_business_id;
        end if;
      end loop;
      delete from public.purchases where id = p_id;
      get diagnostics affected = row_count;
    when 'products' then
      delete from public.inventory_movements where product_id = p_id;
      delete from public.products where id = p_id;
      get diagnostics affected = row_count;
    when 'customers' then
      delete from public.customers where id = p_id;
      get diagnostics affected = row_count;
    when 'suppliers' then
      delete from public.suppliers where id = p_id;
      get diagnostics affected = row_count;
    when 'expenses' then
      delete from public.expenses where id = p_id;
      get diagnostics affected = row_count;
    when 'notifications' then
      delete from public.notifications where id = p_id;
      get diagnostics affected = row_count;
    else
      raise exception 'Unsupported resource for deletion.' using errcode = '22023';
  end case;
  if affected = 0 then raise exception 'Record not found.' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.delete_pos_resource(text, text) from public, anon, authenticated;
grant execute on function public.delete_pos_resource(text, text) to service_role;
commit;
