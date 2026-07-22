begin;

create table public.financial_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data_version integer not null check (data_version > 0),
  state_data jsonb not null check (jsonb_typeof(state_data) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.financial_states enable row level security;
alter table public.financial_states force row level security;

create policy financial_states_access_own on public.financial_states
  for all to authenticated
  using (user_id = auth.uid() and (select private.has_active_access(auth.uid())))
  with check (user_id = auth.uid() and (select private.has_active_access(auth.uid())));

revoke all on public.financial_states from anon;
grant select, insert, update, delete on public.financial_states to authenticated;

create trigger financial_states_set_updated_at before update on public.financial_states
  for each row execute function public.set_updated_at();

commit;

