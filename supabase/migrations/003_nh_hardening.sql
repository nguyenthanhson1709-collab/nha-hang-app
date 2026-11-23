revoke execute on function public.nh_audit_fn(), public.nh_guard_child(), public.nh_guard_period(),
  public.nh_handle_new_user(), public.nh_profiles_guard(), public.nh_staff_doc(), public.nh_no_unlock() from public, anon, authenticated;

create or replace function public.nh_has_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.nh_profiles where is_owner)
$$;
grant execute on function public.nh_has_owner() to anon, authenticated;

create or replace function public.nh_claim_owner() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if exists(select 1 from public.nh_profiles where is_owner) then return false; end if;
  update public.nh_profiles set is_owner = true where id = auth.uid();
  return found;
end $$;
revoke execute on function public.nh_claim_owner() from public, anon;
grant execute on function public.nh_claim_owner() to authenticated;

-- Kỳ ghi sổ luôn = tháng mở đầu tiên tính từ tháng của ngày chứng từ
create or replace function public.nh_guard_period() returns trigger
language plpgsql security definer set search_path = public as $$
declare d date;
begin
  if tg_op in ('UPDATE','DELETE') then
    if public.nh_is_locked(old.restaurant_id, old.period) then
      raise exception 'NH_LOCKED: Tháng % đã khoá sổ, không sửa được', old.period;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_table_name = 'nh_documents' then d := new.doc_date;
  elsif tg_table_name = 'nh_zbons' then d := new.z_date;
  elsif tg_table_name = 'nh_cash_moves' then d := new.move_date;
  elsif tg_table_name = 'nh_cash_counts' then d := new.count_date;
  end if;
  new.period := public.nh_open_period(new.restaurant_id, d);
  if tg_table_name in ('nh_documents','nh_zbons') and tg_op = 'UPDATE' then
    new.updated_by := auth.uid(); new.updated_at := now();
  end if;
  return new;
end $$;
revoke execute on function public.nh_guard_period() from public, anon, authenticated;

-- Cho phép quản trị (SQL editor / service role, không có auth.uid()) đặt quyền chủ
create or replace function public.nh_profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_owner is distinct from old.is_owner and auth.uid() is not null and not public.nh_is_owner() then
    raise exception 'Không có quyền';
  end if;
  return new;
end $$;
revoke execute on function public.nh_profiles_guard() from public, anon, authenticated;
