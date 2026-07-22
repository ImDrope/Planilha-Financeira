-- Teste transacional de isolamento RLS.
-- Requer duas contas vinculadas a autorizações active/trial.
-- Nenhum dado de teste é mantido: toda alteração termina em ROLLBACK.

begin;

select set_config(
  'dm_test.user_a',
  (select user_id::text from public.access_entitlements
   where user_id is not null and status in ('active','trial')
   order by created_at limit 1),
  true
);
select set_config(
  'dm_test.user_b',
  (select user_id::text from public.access_entitlements
   where user_id is not null and status in ('active','trial')
   order by created_at offset 1 limit 1),
  true
);

do $$ begin
  if current_setting('dm_test.user_a', true) is null
     or current_setting('dm_test.user_b', true) is null then
    raise exception 'O teste exige duas contas com acesso ativo.';
  end if;
end $$;

insert into public.monthly_plans(user_id, month_key, salary, budget, investment_goal)
values
  (current_setting('dm_test.user_a')::uuid, '2099-11', 111.11, 0, 0),
  (current_setting('dm_test.user_b')::uuid, '2099-12', 222.22, 0, 0)
on conflict (user_id, month_key) do update set salary = excluded.salary;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('dm_test.user_a'), true);

do $$
declare own_rows integer; other_rows integer;
begin
  select count(*) into own_rows from public.monthly_plans
   where user_id = current_setting('dm_test.user_a')::uuid and month_key = '2099-11';
  select count(*) into other_rows from public.monthly_plans
   where user_id = current_setting('dm_test.user_b')::uuid and month_key = '2099-12';
  if own_rows <> 1 or other_rows <> 0 then
    raise exception 'Falha RLS para usuário A: próprio %, outro %', own_rows, other_rows;
  end if;
  begin
    insert into public.monthly_plans(user_id, month_key)
    values (current_setting('dm_test.user_b')::uuid, '2099-10');
    raise exception 'Falha RLS: usuário A conseguiu escrever para B.';
  exception when insufficient_privilege then
    null;
  end;
end $$;

select set_config('request.jwt.claim.sub', current_setting('dm_test.user_b'), true);

do $$
declare own_rows integer; other_rows integer;
begin
  select count(*) into own_rows from public.monthly_plans
   where user_id = current_setting('dm_test.user_b')::uuid and month_key = '2099-12';
  select count(*) into other_rows from public.monthly_plans
   where user_id = current_setting('dm_test.user_a')::uuid and month_key = '2099-11';
  if own_rows <> 1 or other_rows <> 0 then
    raise exception 'Falha RLS para usuário B: próprio %, outro %', own_rows, other_rows;
  end if;
end $$;

reset role;
update public.access_entitlements
set status = 'refunded'
where user_id = current_setting('dm_test.user_a')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('dm_test.user_a'), true);

do $$
begin
  if exists (
    select 1 from public.monthly_plans
    where user_id = current_setting('dm_test.user_a')::uuid and month_key = '2099-11'
  ) then
    raise exception 'Falha de acesso: autorização reembolsada ainda enxerga dados.';
  end if;
end $$;

reset role;
rollback;

select 'PASSOU: contas isoladas, escrita cruzada bloqueada e reembolso revoga acesso; nenhum dado de teste foi mantido.' as resultado;

