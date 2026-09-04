alter table public.credit_transactions
  drop constraint if exists credit_transactions_reason_check;

alter table public.credit_transactions
  add constraint credit_transactions_reason_check
  check (reason in ('welcome', 'redeem', 'asset_export', 'image_export', 'video_export', 'admin_adjustment'));

create or replace function public.credit_cost(p_action text, p_duration_seconds numeric default 0)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_action = 'asset_export' then 1
    when p_action = 'image_export' then 2
    when p_action = 'video_export' then 5 + greatest(0, ceil((greatest(0, p_duration_seconds) - 30) / 30))::integer * 3
    else null
  end;
$$;

revoke execute on function public.credit_cost(text, numeric) from public, anon, authenticated;
