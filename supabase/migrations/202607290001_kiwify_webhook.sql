begin;

create table public.commerce_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('kiwify')),
  event_key text not null check (char_length(event_key) between 16 and 128),
  event_type text not null check (char_length(event_type) between 1 and 80),
  external_order_id text,
  buyer_email text check (buyer_email is null or buyer_email = lower(btrim(buyer_email))),
  product_id text,
  processing_status text not null check (processing_status in ('processed','ignored','failed')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  received_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz not null default timezone('utc', now()),
  unique (provider, event_key)
);

alter table public.commerce_webhook_events enable row level security;
alter table public.commerce_webhook_events force row level security;
revoke all on public.commerce_webhook_events from public, anon, authenticated;

create index commerce_webhook_events_order_idx
  on public.commerce_webhook_events(provider, external_order_id);
create index commerce_webhook_events_received_idx
  on public.commerce_webhook_events(received_at desc);

create or replace function public.process_kiwify_webhook(
  p_event_key text,
  p_event_type text,
  p_order_id text,
  p_email text,
  p_product_id text,
  p_details jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_email text := lower(btrim(p_email));
  v_status text;
  v_processing_status text := 'processed';
  v_user_id uuid;
begin
  if p_event_key is null or char_length(p_event_key) < 16 then
    raise exception 'invalid event key';
  end if;

  if p_event_type in ('compra_aprovada', 'subscription_renewed') then
    v_status := 'active';
  elsif p_event_type = 'compra_reembolsada' then
    v_status := 'refunded';
  elsif p_event_type = 'chargeback' then
    v_status := 'chargeback';
  elsif p_event_type = 'subscription_canceled' then
    v_status := 'cancelled';
  elsif p_event_type = 'subscription_late' then
    v_status := 'expired';
  else
    v_processing_status := 'ignored';
  end if;

  insert into public.commerce_webhook_events(
    provider, event_key, event_type, external_order_id, buyer_email,
    product_id, processing_status, details
  ) values (
    'kiwify', p_event_key, p_event_type, nullif(btrim(p_order_id), ''),
    nullif(v_email, ''), nullif(btrim(p_product_id), ''),
    v_processing_status, coalesce(p_details, '{}'::jsonb)
  )
  on conflict (provider, event_key) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return jsonb_build_object('duplicate', true, 'processed', false);
  end if;

  if v_processing_status = 'ignored' then
    return jsonb_build_object('duplicate', false, 'processed', false, 'ignored', true);
  end if;

  if v_email is null or v_email = '' then
    update public.commerce_webhook_events
      set processing_status = 'failed',
          details = details || jsonb_build_object('error', 'buyer_email_missing')
      where id = v_event_id;
    raise exception 'buyer email missing';
  end if;

  select id into v_user_id
  from auth.users
  where lower(email) = v_email
  limit 1;

  if v_status = 'active' then
    insert into public.access_entitlements(
      user_id, email, provider, external_order_id, product_id, status,
      starts_at, ends_at, metadata
    ) values (
      v_user_id, v_email, 'kiwify', nullif(btrim(p_order_id), ''),
      nullif(btrim(p_product_id), ''), 'active', timezone('utc', now()), null,
      jsonb_build_object('last_event_type', p_event_type, 'last_event_at', timezone('utc', now()))
    )
    on conflict (email) do update set
      user_id = coalesce(public.access_entitlements.user_id, excluded.user_id),
      provider = 'kiwify',
      external_order_id = excluded.external_order_id,
      product_id = excluded.product_id,
      status = 'active',
      starts_at = least(public.access_entitlements.starts_at, excluded.starts_at),
      ends_at = null,
      metadata = public.access_entitlements.metadata || excluded.metadata,
      updated_at = timezone('utc', now());
  else
    update public.access_entitlements
    set status = v_status,
        metadata = metadata || jsonb_build_object(
          'last_event_type', p_event_type,
          'last_event_at', timezone('utc', now())
        ),
        updated_at = timezone('utc', now())
    where email = v_email
      and (
        provider = 'kiwify'
        or (p_order_id is not null and external_order_id = p_order_id)
      );
  end if;

  return jsonb_build_object(
    'duplicate', false,
    'processed', true,
    'status', v_status,
    'entitlement_linked', v_user_id is not null
  );
exception
  when others then
    if v_event_id is not null then
      update public.commerce_webhook_events
      set processing_status = 'failed',
          details = details || jsonb_build_object('error', left(sqlerrm, 300)),
          processed_at = timezone('utc', now())
      where id = v_event_id;
    end if;
    raise;
end;
$$;

revoke all on function public.process_kiwify_webhook(text,text,text,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.process_kiwify_webhook(text,text,text,text,text,jsonb)
  to service_role;

commit;

