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
begin
  case p_resource
    when 'sales' then
      for line in select product_id, quantity from public.sale_items where sale_id = p_id and product_id is not null loop
        update public.products set stock = stock + line.quantity, updated_at = now() where id = line.product_id;
      end loop;
      delete from public.sales where id = p_id;
      get diagnostics affected = row_count;
    when 'purchases' then
      for line in select product_id, quantity from public.purchase_items where purchase_id = p_id and product_id is not null loop
        update public.products set stock = stock - line.quantity, updated_at = now()
          where id = line.product_id and stock >= line.quantity;
        get diagnostics affected = row_count;
        if affected = 0 then
          raise exception 'This purchase cannot be deleted because some of its stock has already been sold or removed.' using errcode = '23514';
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

  if affected = 0 then
    raise exception 'Record not found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.delete_pos_resource(text, text) from public, anon, authenticated;
grant execute on function public.delete_pos_resource(text, text) to service_role;

commit;
