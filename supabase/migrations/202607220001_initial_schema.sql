begin;

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function public.set_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = timezone('utc', now()); return new; end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 80),
  accepted_terms_at timestamptz,
  local_migration_completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.access_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  email text not null unique check (email = lower(btrim(email))),
  provider text not null default 'manual',
  external_order_id text,
  product_id text,
  status text not null default 'pending' check (status in ('pending','trial','active','cancelled','expired','refunded','chargeback')),
  starts_at timestamptz not null default timezone('utc', now()),
  ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (ends_at is null or ends_at > starts_at)
);
create unique index access_entitlements_provider_order_unique
  on public.access_entitlements(provider,external_order_id)
  where external_order_id is not null;
create unique index access_entitlements_user_unique on public.access_entitlements(user_id) where user_id is not null;
create index access_entitlements_active_idx on public.access_entitlements(user_id,status,starts_at,ends_at);

create function private.has_active_access(check_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = '' as $$
  select check_user is not null and exists (
    select 1 from public.access_entitlements e
    where e.user_id = check_user and e.status in ('trial','active')
      and e.starts_at <= timezone('utc', now())
      and (e.ends_at is null or e.ends_at > timezone('utc', now()))
  );
$$;
revoke all on function private.has_active_access(uuid) from public;
revoke all on function public.set_updated_at() from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.has_active_access(uuid) to authenticated;

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,full_name)
  values(new.id,left(coalesce(new.raw_user_meta_data->>'full_name',''),80)) on conflict do nothing;
  update public.access_entitlements set user_id=new.id,updated_at=timezone('utc',now())
  where user_id is null and email=lower(btrim(new.email));
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public,anon,authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

create table public.monthly_plans (
  user_id uuid not null references auth.users(id) on delete cascade,
  month_key text not null check (month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  salary numeric(14,2) not null default 0 check (salary>=0),
  budget numeric(14,2) not null default 0 check (budget>=0),
  investment_goal numeric(14,2) not null default 0 check (investment_goal>=0),
  category_budgets jsonb not null default '{}'::jsonb check (jsonb_typeof(category_budgets)='object'),
  created_at timestamptz not null default timezone('utc',now()), updated_at timestamptz not null default timezone('utc',now()),
  primary key(user_id,month_key)
);

create table public.recurrences (
  id text primary key check (char_length(id) between 1 and 120),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('income','expense')),
  frequency text not null check (frequency in ('weekly','monthly','yearly')),
  description text not null check (char_length(description) between 1 and 180),
  amount numeric(14,2) not null check (amount>=0), category text not null,
  start_date date not null, end_date date, due_day smallint not null check (due_day between 1 and 31),
  status text not null check (status in ('paid','pending')), skipped_months text[] not null default '{}', active boolean not null default true,
  created_at timestamptz not null default timezone('utc',now()), updated_at timestamptz not null default timezone('utc',now()),
  check (end_date is null or end_date>=start_date),
  unique(user_id,id)
);
create index recurrences_user_active_idx on public.recurrences(user_id,active);

create table public.transactions (
  id text primary key check (char_length(id) between 1 and 120),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('income','expense')), transaction_date date not null,
  description text not null check (char_length(description) between 1 and 180), amount numeric(14,2) not null check (amount>=0), category text not null,
  expense_class text check (expense_class is null or expense_class in ('fixed','variable','recurring')),
  status text not null check (status in ('paid','pending')), payment_method text not null default 'other', notes text not null default '',
  recurrence_id text, occurrence_key text,
  invoice_month text check (invoice_month is null or invoice_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  installment_group text, installment_number integer check (installment_number is null or installment_number>0),
  installment_count integer check (installment_count is null or installment_count>0), transfer_key text,
  created_at timestamptz not null default timezone('utc',now()), updated_at timestamptz not null default timezone('utc',now()),
  check ((type='income' and expense_class is null) or (type='expense' and expense_class is not null)),
  check (installment_number is null or installment_count is null or installment_number<=installment_count),
  foreign key(user_id,recurrence_id) references public.recurrences(user_id,id) on delete set null (recurrence_id)
);
create index transactions_user_date_idx on public.transactions(user_id,transaction_date desc);
create unique index transactions_occurrence_unique on public.transactions(user_id,occurrence_key) where occurrence_key is not null;
create unique index transactions_transfer_unique on public.transactions(user_id,transfer_key) where transfer_key is not null;

create table public.investments (
  id text primary key check (char_length(id) between 1 and 120), user_id uuid not null references auth.users(id) on delete cascade,
  investment_date date not null, type text not null, name text not null check (char_length(name) between 1 and 180),
  institution text not null default '', objective text not null default '', initial_amount numeric(18,2) not null default 0 check(initial_amount>=0),
  quantity numeric(30,12) not null default 0 check(quantity>=0), current_value numeric(18,2) not null default 0 check(current_value>=0), notes text not null default '',
  created_at timestamptz not null default timezone('utc',now()), updated_at timestamptz not null default timezone('utc',now()),
  unique(user_id,id)
);
create index investments_user_date_idx on public.investments(user_id,investment_date desc);

create table public.investment_events (
  id text primary key check (char_length(id) between 1 and 120), user_id uuid not null references auth.users(id) on delete cascade,
  investment_id text not null,
  type text not null check(type in ('contribution','withdrawal','income','valuation')), event_date date not null, amount numeric(18,2) not null check(amount>=0), notes text not null default '',
  created_at timestamptz not null default timezone('utc',now()), updated_at timestamptz not null default timezone('utc',now()),
  foreign key(user_id,investment_id) references public.investments(user_id,id) on delete cascade
);
create index investment_events_user_date_idx on public.investment_events(user_id,event_date desc);

create table public.monthly_closures (
  user_id uuid not null references auth.users(id) on delete cascade, month_key text not null check(month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  closed_at timestamptz not null default timezone('utc',now()), income numeric(14,2) not null default 0, expenses numeric(14,2) not null default 0,
  invested numeric(14,2) not null default 0, balance numeric(14,2) not null default 0, forecast_balance numeric(14,2) not null default 0,
  pending numeric(14,2) not null default 0, score smallint not null default 0 check(score between 0 and 100), level text not null default '',
  savings_rate numeric(9,4) not null default 0, category_changes jsonb not null default '[]'::jsonb check(jsonb_typeof(category_changes)='array'),
  created_at timestamptz not null default timezone('utc',now()), updated_at timestamptz not null default timezone('utc',now()), primary key(user_id,month_key)
);

create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade, theme text not null default 'light' check(theme in ('light','dark')),
  values_hidden boolean not null default false, onboarding_completed boolean not null default false,
  created_at timestamptz not null default timezone('utc',now()), updated_at timestamptz not null default timezone('utc',now())
);

create table public.local_imports (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  source_version integer not null, fingerprint text not null check(char_length(fingerprint) between 16 and 128),
  counts jsonb not null default '{}'::jsonb check(jsonb_typeof(counts)='object'), imported_at timestamptz not null default timezone('utc',now()), unique(user_id,fingerprint)
);

do $$ declare t text; begin foreach t in array array['profiles','access_entitlements','monthly_plans','recurrences','transactions','investments','investment_events','monthly_closures','user_preferences','local_imports'] loop
  execute format('alter table public.%I enable row level security',t); execute format('alter table public.%I force row level security',t);
end loop; end $$;

create policy profiles_select_own on public.profiles for select to authenticated using(id=auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy entitlements_select_own on public.access_entitlements for select to authenticated using(user_id=auth.uid());

do $$ declare t text; begin foreach t in array array['monthly_plans','recurrences','transactions','investments','investment_events','monthly_closures','user_preferences','local_imports'] loop
  execute format('create policy %I on public.%I for all to authenticated using(user_id=auth.uid() and (select private.has_active_access(auth.uid()))) with check(user_id=auth.uid() and (select private.has_active_access(auth.uid())))',t||'_access_own',t);
end loop; end $$;

revoke all on public.profiles,public.access_entitlements,public.monthly_plans,public.recurrences,
  public.transactions,public.investments,public.investment_events,public.monthly_closures,
  public.user_preferences,public.local_imports from anon;
grant select,update on public.profiles to authenticated;
grant select on public.access_entitlements to authenticated;
grant select,insert,update,delete on public.monthly_plans,public.recurrences,public.transactions,public.investments,public.investment_events,public.monthly_closures,public.user_preferences,public.local_imports to authenticated;

do $$ declare t text; begin foreach t in array array['profiles','access_entitlements','monthly_plans','recurrences','transactions','investments','investment_events','monthly_closures','user_preferences'] loop
  execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',t||'_set_updated_at',t);
end loop; end $$;

commit;

