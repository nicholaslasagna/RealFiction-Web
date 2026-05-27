begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

-- Test policies only; production lobby/smp rows are not modified by migration 026.
insert into public.economy_server_policies (
  server_id,
  server_group,
  enabled,
  can_read,
  can_reward,
  can_earn,
  can_spend,
  max_credit_minor,
  max_debit_minor,
  max_batch_count,
  notes
) values
  (
    'economy-test-lobby',
    'lobby',
    true,
    true,
    true,
    false,
    false,
    1_000_000,
    0,
    10,
    'pgtap vote_reward allow'
  ),
  (
    'economy-test-smp-readonly',
    'smp',
    true,
    true,
    false,
    false,
    false,
    0,
    0,
    10,
    'pgtap smp read-only'
  ),
  (
    'economy-test-anarchy',
    'anarchy',
    true,
    false,
    false,
    false,
    false,
    1_000_000,
    1_000_000,
    10,
    'pgtap anarchy block'
  )
on conflict (server_id) do update set
  server_group = excluded.server_group,
  enabled = excluded.enabled,
  can_read = excluded.can_read,
  can_reward = excluded.can_reward,
  can_earn = excluded.can_earn,
  can_spend = excluded.can_spend,
  max_credit_minor = excluded.max_credit_minor,
  max_debit_minor = excluded.max_debit_minor,
  max_batch_count = excluded.max_batch_count,
  notes = excluded.notes,
  updated_at = now();

select lives_ok(
  $apply_vote$
    select *
    from public.apply_economy_transaction(
      'economy-test-lobby',
      'lobby',
      'realfiction_main',
      'cccccccccccccccccccccccccccccccc',
      'CategoryTest',
      100,
      'vote_reward',
      'pgtap vote_reward',
      'pgtap-vote-' || gen_random_uuid()::text,
      'pgtap',
      'vote-1',
      '{}'::jsonb
    );
  $apply_vote$,
  'lobby policy with can_reward allows vote_reward'
);

select throws_ok(
  $apply_smp_earn$
    select *
    from public.apply_economy_transaction(
      'economy-test-smp-readonly',
      'smp',
      'realfiction_main',
      'dddddddddddddddddddddddddddddddd',
      'CategoryTest',
      100,
      'gameplay_earn',
      'pgtap gameplay_earn',
      'pgtap-earn-' || gen_random_uuid()::text,
      null,
      null,
      '{}'::jsonb
    );
  $apply_smp_earn$,
  'P0001',
  'server economy-test-smp-readonly is not allowed to apply gameplay earnings',
  'smp read-only rejects gameplay_earn'
);

select throws_ok(
  $apply_smp_spend$
    select *
    from public.apply_economy_transaction(
      'economy-test-smp-readonly',
      'smp',
      'realfiction_main',
      'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      'CategoryTest',
      -50,
      'gameplay_spend',
      'pgtap gameplay_spend',
      'pgtap-spend-' || gen_random_uuid()::text,
      null,
      null,
      '{}'::jsonb
    );
  $apply_smp_spend$,
  'P0001',
  'server economy-test-smp-readonly is not allowed to apply spends',
  'smp read-only rejects gameplay_spend'
);

select throws_ok(
  $apply_smp_shop_sell$
    select *
    from public.apply_economy_transaction(
      'economy-test-smp-readonly',
      'smp',
      'realfiction_main',
      'ffffffffffffffffffffffffffffffff',
      'CategoryTest',
      100,
      'shop_sell',
      'pgtap shop_sell',
      'pgtap-shop-sell-' || gen_random_uuid()::text,
      null,
      null,
      '{}'::jsonb
    );
  $apply_smp_shop_sell$,
  'P0001',
  'server economy-test-smp-readonly is not allowed to apply gameplay earnings',
  'shop_sell maps to can_earn'
);

select throws_ok(
  $apply_smp_shop_buy$
    select *
    from public.apply_economy_transaction(
      'economy-test-smp-readonly',
      'smp',
      'realfiction_main',
      '11111111111111111111111111111111',
      'CategoryTest',
      -50,
      'shop_buy',
      'pgtap shop_buy',
      'pgtap-shop-buy-' || gen_random_uuid()::text,
      null,
      null,
      '{}'::jsonb
    );
  $apply_smp_shop_buy$,
  'P0001',
  'server economy-test-smp-readonly is not allowed to apply spends',
  'shop_buy maps to can_spend'
);

select throws_ok(
  $apply_smp_legacy_spend$
    select *
    from public.apply_economy_transaction(
      'economy-test-smp-readonly',
      'smp',
      'realfiction_main',
      '22222222222222222222222222222222',
      'CategoryTest',
      -50,
      'spend',
      'pgtap legacy spend',
      'pgtap-legacy-spend-' || gen_random_uuid()::text,
      null,
      null,
      '{}'::jsonb
    );
  $apply_smp_legacy_spend$,
  'P0001',
  'server economy-test-smp-readonly is not allowed to apply spends',
  'legacy spend maps to can_spend'
);

select throws_ok(
  $apply_anarchy$
    select *
    from public.apply_economy_transaction(
      'economy-test-anarchy',
      'anarchy',
      'realfiction_main',
      '33333333333333333333333333333333',
      'CategoryTest',
      100,
      'gameplay_earn',
      'pgtap anarchy',
      'pgtap-anarchy-' || gen_random_uuid()::text,
      null,
      null,
      '{}'::jsonb
    );
  $apply_anarchy$,
  'P0001',
  'anarchy may not mutate the global economy',
  'anarchy backend is denied'
);

select throws_ok(
  $unknown_category$
    select public._economy_assert_plugin_category('not_a_real_category');
  $unknown_category$,
  'P0001',
  'category not_a_real_category is not accepted from plugin economy routes',
  'unknown category is denied at plugin gate'
);

select throws_ok(
  $admin_category$
    select public._economy_assert_plugin_category('admin_adjustment');
  $admin_category$,
  'P0001',
  'category admin_adjustment is not accepted from plugin economy routes',
  'admin_adjustment is not available to plugin routes'
);

select throws_ok(
  $migration_category$
    select public._economy_assert_plugin_category('migration_import');
  $migration_category$,
  'P0001',
  'category migration_import is not accepted from plugin economy routes',
  'migration_import is not available to plugin routes'
);

select throws_ok(
  $vault_mirror_plugin$
    select public._economy_assert_plugin_category('vault_mirror_adjustment');
  $vault_mirror_plugin$,
  'P0001',
  'category vault_mirror_adjustment is not accepted from plugin economy routes',
  'vault_mirror_adjustment is not available to plugin routes'
);

select throws_ok(
  $vault_mirror_policy$
    select public._economy_assert_policy(
      'economy-test-lobby',
      'lobby',
      'vault_mirror_adjustment',
      100,
      1
    );
  $vault_mirror_policy$,
  'P0001',
  'category vault_mirror_adjustment is not allowed through plugin policy checks',
  'vault_mirror_adjustment is blocked at policy gate'
);

select * from finish();

rollback;
