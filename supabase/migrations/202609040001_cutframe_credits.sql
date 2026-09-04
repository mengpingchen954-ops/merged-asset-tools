create extension if not exists pgcrypto with schema extensions;

create table if not exists public.credit_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance integer not null default 10 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  amount integer not null check (amount <> 0),
  reason text not null check (reason in ('welcome', 'redeem', 'asset_export', 'image_export', 'video_export', 'admin_adjustment')),
  idempotency_key uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.redeem_codes (
  code_hash text primary key check (length(code_hash) = 64),
  points integer not null check (points > 0),
  max_uses integer not null default 1 check (max_uses > 0),
  use_count integer not null default 0 check (use_count >= 0 and use_count <= max_uses),
  active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.credit_redemptions (
  id bigint generated always as identity primary key,
  code_hash text not null references public.redeem_codes (code_hash),
  user_id uuid not null references auth.users (id) on delete cascade,
  points integer not null check (points > 0),
  created_at timestamptz not null default now(),
  unique (code_hash, user_id)
);

create index if not exists credit_transactions_user_created_idx
  on public.credit_transactions (user_id, created_at desc);
create unique index if not exists credit_transactions_idempotency_idx
  on public.credit_transactions (user_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists credit_redemptions_user_created_idx
  on public.credit_redemptions (user_id, created_at desc);

alter table public.credit_accounts enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.redeem_codes enable row level security;
alter table public.credit_redemptions enable row level security;

alter table public.credit_accounts force row level security;
alter table public.credit_transactions force row level security;
alter table public.redeem_codes force row level security;
alter table public.credit_redemptions force row level security;

create policy "users read own credit account"
  on public.credit_accounts for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "users read own credit transactions"
  on public.credit_transactions for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "users read own credit redemptions"
  on public.credit_redemptions for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.handle_new_credit_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.credit_accounts (user_id, balance)
  values (new.id, 10)
  on conflict (user_id) do nothing;

  insert into public.credit_transactions (user_id, amount, reason, metadata)
  values (new.id, 10, 'welcome', jsonb_build_object('source', 'signup'));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_credit_account on auth.users;
create trigger on_auth_user_created_credit_account
  after insert on auth.users
  for each row execute function public.handle_new_credit_user();

insert into public.credit_accounts (user_id, balance)
select id, 10 from auth.users
on conflict (user_id) do nothing;

insert into public.credit_transactions (user_id, amount, reason, metadata)
select account.user_id, 10, 'welcome', jsonb_build_object('source', 'migration')
from public.credit_accounts account
where not exists (
  select 1 from public.credit_transactions tx
  where tx.user_id = account.user_id
);

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

create or replace function public.charge_credits(
  p_action text,
  p_duration_seconds numeric default 0,
  p_idempotency_key uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_cost integer := public.credit_cost(p_action, p_duration_seconds);
  v_balance integer;
  v_existing_amount integer;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = 'P0001';
  end if;
  if v_cost is null or v_cost <= 0 then
    raise exception 'invalid_credit_action' using errcode = 'P0001';
  end if;

  select amount into v_existing_amount
  from public.credit_transactions
  where user_id = v_user_id and idempotency_key = p_idempotency_key;

  if found then
    select balance into v_balance from public.credit_accounts where user_id = v_user_id;
    return jsonb_build_object('balance', v_balance, 'cost', abs(v_existing_amount), 'idempotent', true);
  end if;

  update public.credit_accounts
  set balance = balance - v_cost, updated_at = now()
  where user_id = v_user_id and balance >= v_cost
  returning balance into v_balance;

  if not found then
    raise exception 'insufficient_credits' using errcode = 'P0001';
  end if;

  insert into public.credit_transactions (user_id, amount, reason, idempotency_key, metadata)
  values (
    v_user_id,
    -v_cost,
    p_action,
    p_idempotency_key,
    jsonb_build_object('duration_seconds', greatest(0, p_duration_seconds))
  );

  return jsonb_build_object('balance', v_balance, 'cost', v_cost, 'idempotent', false);
end;
$$;

create or replace function public.redeem_credit_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_code_hash text := encode(extensions.digest(upper(trim(p_code)), 'sha256'), 'hex');
  v_points integer;
  v_balance integer;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = 'P0001';
  end if;

  select points into v_points
  from public.redeem_codes
  where code_hash = v_code_hash
    and active
    and use_count < max_uses
    and (expires_at is null or expires_at > now())
  for update;

  if not found then
    raise exception 'invalid_or_expired_code' using errcode = 'P0001';
  end if;

  insert into public.credit_redemptions (code_hash, user_id, points)
  values (v_code_hash, v_user_id, v_points);

  update public.redeem_codes set use_count = use_count + 1 where code_hash = v_code_hash;
  update public.credit_accounts
  set balance = balance + v_points, updated_at = now()
  where user_id = v_user_id
  returning balance into v_balance;

  insert into public.credit_transactions (user_id, amount, reason, metadata)
  values (v_user_id, v_points, 'redeem', jsonb_build_object('code_hash', v_code_hash));

  return jsonb_build_object('balance', v_balance, 'points', v_points);
exception
  when unique_violation then
    raise exception 'code_already_redeemed' using errcode = 'P0001';
end;
$$;

revoke all on public.credit_accounts, public.credit_transactions, public.redeem_codes, public.credit_redemptions from anon, authenticated;
grant select on public.credit_accounts, public.credit_transactions, public.credit_redemptions to authenticated;

revoke execute on function public.credit_cost(text, numeric) from public, anon, authenticated;
revoke execute on function public.handle_new_credit_user() from public, anon, authenticated;
revoke execute on function public.charge_credits(text, numeric, uuid) from public, anon;
revoke execute on function public.redeem_credit_code(text) from public, anon;
grant execute on function public.charge_credits(text, numeric, uuid) to authenticated;
grant execute on function public.redeem_credit_code(text) to authenticated;
