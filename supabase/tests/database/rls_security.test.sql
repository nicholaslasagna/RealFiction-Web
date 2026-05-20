begin;

create extension if not exists pgtap with schema extensions;

select plan(29);

create or replace function pg_temp.set_auth_context(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', user_id::text, 'role', 'authenticated')::text,
    true
  );
end;
$$;

create or replace function pg_temp.set_anon_context()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
end;
$$;

create or replace function pg_temp.statement_is_blocked(statement text)
returns boolean
language plpgsql
as $$
begin
  execute statement;
  return false;
exception
  when insufficient_privilege then
    return true;
  when check_violation then
    return true;
end;
$$;

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'rls-user-one@realfiction.test'),
  ('22222222-2222-2222-2222-222222222222', 'rls-user-two@realfiction.test')
on conflict (id) do nothing;

insert into public.profiles (id, email, display_name)
values
  ('11111111-1111-1111-1111-111111111111', 'rls-user-one@realfiction.test', 'RLS One'),
  ('22222222-2222-2222-2222-222222222222', 'rls-user-two@realfiction.test', 'RLS Two')
on conflict (id) do update set email = excluded.email;

insert into public.minecraft_account_links (
  id,
  user_id,
  minecraft_uuid,
  minecraft_username,
  verification_code,
  verification_code_hash,
  status,
  verified_at,
  expires_at
)
values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'RLSUserOne',
    'verified',
    null,
    'verified',
    now(),
    now() + interval '1 day'
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '22222222-2222-2222-2222-222222222222',
    null,
    'RLSUserTwo',
    'server-hashed',
    'pending-hash',
    'pending',
    null,
    now() + interval '1 day'
  )
on conflict (id) do nothing;

insert into public.orders (
  id,
  user_id,
  minecraft_username,
  provider,
  status,
  subtotal_cents,
  total_cents,
  currency
)
values
  (
    '33333333-3333-3333-3333-333333333333',
    '11111111-1111-1111-1111-111111111111',
    'RLSUserOne',
    'stripe',
    'fulfilled',
    699,
    699,
    'USD'
  ),
  (
    '44444444-4444-4444-4444-444444444444',
    '22222222-2222-2222-2222-222222222222',
    'RLSUserTwo',
    'paypal',
    'pending',
    499,
    499,
    'USD'
  )
on conflict (id) do nothing;

insert into public.entitlements (
  id,
  user_id,
  minecraft_username,
  entitlement_key,
  status
)
values
  (
    '55555555-5555-5555-5555-555555555555',
    '11111111-1111-1111-1111-111111111111',
    'RLSUserOne',
    'product:realvip-monthly',
    'active'
  ),
  (
    '66666666-6666-6666-6666-666666666666',
    '22222222-2222-2222-2222-222222222222',
    'RLSUserTwo',
    'product:username-colors',
    'active'
  )
on conflict (id) do nothing;

insert into public.reward_queue (
  id,
  user_id,
  minecraft_username,
  source,
  source_id,
  reward_key,
  payload,
  idempotency_key,
  status
)
values
  (
    '77777777-7777-7777-7777-777777777777',
    '11111111-1111-1111-1111-111111111111',
    'RLSUserOne',
    'store',
    '55555555-5555-5555-5555-555555555555',
    'store.realvip-monthly',
    '{"safe_reward":true}'::jsonb,
    'rls-user-one-reward',
    'pending'
  ),
  (
    '88888888-8888-8888-8888-888888888888',
    '22222222-2222-2222-2222-222222222222',
    'RLSUserTwo',
    'vote',
    null,
    'vote.standard',
    '{"safe_reward":true}'::jsonb,
    'rls-user-two-reward',
    'pending'
  )
on conflict (id) do nothing;

insert into public.votes (
  id,
  site_id,
  user_id,
  minecraft_username,
  provider_event_id,
  idempotency_key
)
select
  '99999999-9999-9999-9999-999999999999',
  vote_sites.id,
  '11111111-1111-1111-1111-111111111111',
  'RLSUserOne',
  'rls-provider-event',
  'rls-vote-idempotency'
from public.vote_sites
where slug = 'minecraftservers-org'
on conflict (id) do nothing;

insert into public.webhook_events (
  id,
  provider,
  provider_event_id,
  event_type,
  payload
)
values (
  '12121212-1212-1212-1212-121212121212',
  'stripe',
  'evt_rls_existing',
  'checkout.session.completed',
  '{}'::jsonb
)
on conflict (provider, provider_event_id) do nothing;

insert into public.plugin_request_nonces (
  nonce_hash,
  server_id,
  route,
  expires_at
)
values (
  'rls-existing-nonce',
  'rls-server',
  'rewards.poll',
  now() + interval '5 minutes'
)
on conflict (nonce_hash) do nothing;

set local role anon;
select pg_temp.set_anon_context();

select results_eq('select count(*) from public.profiles', array[0::bigint], 'anon cannot read profiles');
select results_eq('select count(*) from public.minecraft_account_links', array[0::bigint], 'anon cannot read minecraft links');
select results_eq('select count(*) from public.orders', array[0::bigint], 'anon cannot read orders');
select results_eq('select count(*) from public.entitlements', array[0::bigint], 'anon cannot read entitlements');
select results_eq('select count(*) from public.reward_queue', array[0::bigint], 'anon cannot read reward queue');
select results_eq('select count(*) from public.votes', array[0::bigint], 'anon cannot read votes');
select results_eq('select count(*) from public.webhook_events', array[0::bigint], 'anon cannot read webhook events');
select results_eq('select count(*) from public.plugin_request_nonces', array[0::bigint], 'anon cannot read plugin nonces');

select ok(
  pg_temp.statement_is_blocked($$insert into public.webhook_events (provider, provider_event_id, event_type) values ('stripe', 'evt_rls_anon', 'test')$$),
  'anon cannot write webhook events'
);

select ok(
  pg_temp.statement_is_blocked($$insert into public.votes (site_id, minecraft_username, provider_event_id) select id, 'Spoofed', 'spoof' from public.vote_sites limit 1$$),
  'anon cannot spoof vote logs'
);

set local role authenticated;
select pg_temp.set_auth_context('11111111-1111-1111-1111-111111111111');

select results_eq('select count(*) from public.profiles', array[1::bigint], 'user one can read one own profile');
select results_eq('select count(*) from public.orders', array[1::bigint], 'user one can read only own orders');
select results_eq('select count(*) from public.entitlements', array[1::bigint], 'user one can read only own entitlements');
select results_eq('select count(*) from public.reward_queue', array[1::bigint], 'user one can read only own rewards');
select results_eq('select count(*) from public.minecraft_account_links', array[1::bigint], 'user one can read only own links');
select results_eq('select count(*) from public.votes', array[1::bigint], 'user one can read only own votes');
select results_eq('select count(*) from public.webhook_events', array[0::bigint], 'authenticated users cannot read webhook events');
select results_eq('select count(*) from public.plugin_request_nonces', array[0::bigint], 'authenticated users cannot read plugin nonces');

select is_empty(
  $$update public.minecraft_account_links set status = 'verified', minecraft_uuid = 'ffffffffffffffffffffffffffffffff', verified_at = now() where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' returning id$$,
  'authenticated user cannot self-verify minecraft links'
);

select is_empty(
  $$update public.profiles set role = 'owner', primary_minecraft_uuid = 'ffffffffffffffffffffffffffffffff' where id = '11111111-1111-1111-1111-111111111111' returning id$$,
  'authenticated user cannot update server-owned profile fields'
);

select ok(
  pg_temp.statement_is_blocked($$insert into public.orders (user_id, provider, status, subtotal_cents, total_cents, currency) values ('11111111-1111-1111-1111-111111111111', 'stripe', 'fulfilled', 0, 0, 'USD')$$),
  'authenticated user cannot manually create fulfilled orders'
);

select ok(
  pg_temp.statement_is_blocked($$insert into public.entitlements (user_id, entitlement_key, status) values ('11111111-1111-1111-1111-111111111111', 'product:admin-grant', 'active')$$),
  'authenticated user cannot grant entitlements'
);

select ok(
  pg_temp.statement_is_blocked($$select * from public.fulfill_paid_order('33333333-3333-3333-3333-333333333333')$$),
  'browser roles cannot execute service-role fulfillment function'
);

select ok(
  pg_temp.statement_is_blocked($$select * from public.poll_reward_queue('rls-server', 'global', 10)$$),
  'browser roles cannot execute plugin reward poll function'
);

select ok(
  pg_temp.statement_is_blocked($$select * from public.revoke_order('33333333-3333-3333-3333-333333333333', 'refund', 'test')$$),
  'browser roles cannot execute service-role refund function'
);

select ok(
  pg_temp.statement_is_blocked($$select * from public.apply_vote_streak(null::uuid, null::text, 'RLSUserOne'::text, '2026-05'::text, now())$$),
  'browser roles cannot execute service-role vote streak function'
);

select pg_temp.set_auth_context('22222222-2222-2222-2222-222222222222');

select results_eq(
  $$select count(*) from public.reward_queue where id = '77777777-7777-7777-7777-777777777777'$$,
  array[0::bigint],
  'another authenticated user cannot read someone else reward row'
);

select is_empty(
  $$update public.reward_queue set status = 'delivered' where id = '77777777-7777-7777-7777-777777777777' returning id$$,
  'another authenticated user cannot claim someone else reward row'
);

select ok(
  pg_temp.statement_is_blocked($$insert into public.votes (site_id, user_id, minecraft_username, provider_event_id) select id, '22222222-2222-2222-2222-222222222222', 'RLSUserTwo', 'spoof-auth' from public.vote_sites limit 1$$),
  'authenticated user cannot spoof vote logs directly'
);

select * from finish();

rollback;
