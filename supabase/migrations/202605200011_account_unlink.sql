-- Account unlink + relink safety.
--
-- A web account may have at most ONE active Minecraft link at a time. Linking a
-- new account (or explicitly unlinking) strips the previous Minecraft account's
-- cosmetic/supporter grants, so a single purchase can never benefit two accounts
-- at once (link A -> buy -> unlink A -> link B must not leave A with perks).
--
-- Entitlements are owned by the web user, not the Minecraft account, so they are
-- NEVER deleted on unlink. They are detached (delivery target cleared) and can be
-- re-delivered to the next linked account for their REMAINING duration only, so
-- relinking is not a way to renew or duplicate a subscription.
--
-- Service-role only. All grants/revokes are cosmetic-safe (no pay-to-win).

-- Strip live grants from one Minecraft account for every active, non-consumable
-- entitlement the user owns, and cancel any still-pending grants aimed at it.
-- Returns the number of compensating revoke rewards queued.
create or replace function public.revoke_account_grants(
  p_user_id uuid,
  p_minecraft_uuid text,
  p_minecraft_username text,
  p_reason text default 'Minecraft account unlinked'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ent record;
  v_queued integer := 0;
  v_rows integer := 0;
  v_stamp text := (extract(epoch from clock_timestamp()) * 1000000)::bigint::text;
begin
  if p_user_id is null or p_minecraft_uuid is null then
    return 0;
  end if;

  -- Stop undelivered grants still aimed at this account from ever landing.
  update public.reward_queue
  set status = 'cancelled',
      failure_reason = p_reason,
      updated_at = now()
  where user_id = p_user_id
    and minecraft_uuid = p_minecraft_uuid
    and status = 'pending'
    and (reward_key like 'store.%' or reward_key like 'subscription.%');

  for v_ent in
    select e.id, e.order_item_id, p.slug, p.category, p.metadata
    from public.entitlements e
    join public.products p on p.id = e.product_id
    where e.user_id = p_user_id
      and e.status = 'active'
      and p.fulfillment_type <> 'consumable'
  loop
    insert into public.reward_queue (
      user_id, minecraft_uuid, minecraft_username,
      source, source_id, reward_key, payload, idempotency_key, status, available_at
    )
    values (
      p_user_id, p_minecraft_uuid, p_minecraft_username,
      'admin', v_ent.order_item_id, 'revoke.' || v_ent.slug,
      jsonb_build_object(
        'action', 'revoke',
        'entitlement_id', v_ent.id,
        'product_slug', v_ent.slug,
        'category', v_ent.category,
        'entitlement_key', 'product:' || v_ent.slug,
        'reason', p_reason,
        'metadata', v_ent.metadata,
        'safe_reward', true
      ),
      'unlink_revoke:' || v_ent.id::text || ':' || p_minecraft_uuid || ':' || v_stamp,
      'pending', now()
    )
    on conflict (idempotency_key) do nothing;

    get diagnostics v_rows = row_count;
    v_queued := v_queued + v_rows;
  end loop;

  return v_queued;
end;
$$;

-- Player-initiated unlink. Revokes every verified link for the user, strips the
-- live grants from each Minecraft account, detaches (but keeps) entitlements, and
-- clears the profile pointer. Idempotent: with no verified links it is a no-op.
create or replace function public.unlink_minecraft_account(
  p_user_id uuid,
  p_reason text default 'Player unlinked their Minecraft account'
)
returns table(unlinked_links integer, queued_revokes integer, detached_entitlements integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link record;
  v_links integer := 0;
  v_revokes integer := 0;
  v_detached integer := 0;
  v_rows integer := 0;
begin
  if p_user_id is null then
    raise exception 'user id is required';
  end if;

  for v_link in
    select id, minecraft_uuid, minecraft_username
    from public.minecraft_account_links
    where user_id = p_user_id
      and status = 'verified'
    for update
  loop
    update public.minecraft_account_links
    set status = 'revoked', updated_at = now()
    where id = v_link.id;
    v_links := v_links + 1;

    if v_link.minecraft_uuid is not null then
      v_revokes := v_revokes + public.revoke_account_grants(
        p_user_id, v_link.minecraft_uuid, v_link.minecraft_username, p_reason
      );
    end if;
  end loop;

  -- Detach active entitlements from any Minecraft account; ownership is retained
  -- so they can be re-delivered to a future linked account.
  update public.entitlements
  set minecraft_uuid = null,
      minecraft_username = null,
      updated_at = now()
  where user_id = p_user_id
    and status = 'active'
    and (minecraft_uuid is not null or minecraft_username is not null);
  get diagnostics v_rows = row_count;
  v_detached := v_rows;

  update public.profiles
  set primary_minecraft_uuid = null,
      primary_minecraft_username = null,
      updated_at = now()
  where id = p_user_id;

  insert into public.audit_logs (actor_type, action, target_table, target_id, metadata)
  values (
    'system', 'account.unlink', 'minecraft_account_links', p_user_id,
    jsonb_build_object(
      'unlinked_links', v_links,
      'queued_revokes', v_revokes,
      'detached_entitlements', v_detached,
      'reason', p_reason
    )
  );

  unlinked_links := v_links;
  queued_revokes := v_revokes;
  detached_entitlements := v_detached;
  return next;
end;
$$;

-- Effects to run after a new link is verified: enforce one-active-link-per-account
-- by superseding any other verified links (stripping their grants), then re-deliver
-- the user's active entitlements to the newly linked account for their remaining
-- duration only.
create or replace function public.apply_minecraft_link(
  p_user_id uuid,
  p_link_id uuid,
  p_minecraft_uuid text,
  p_minecraft_username text
)
returns table(superseded_links integer, queued_revokes integer, redelivered integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link record;
  v_ent record;
  v_superseded integer := 0;
  v_revokes integer := 0;
  v_redelivered integer := 0;
  v_rows integer := 0;
  v_days integer;
  v_stamp text := (extract(epoch from clock_timestamp()) * 1000000)::bigint::text;
begin
  if p_user_id is null or p_link_id is null or p_minecraft_uuid is null then
    raise exception 'user id, link id, and minecraft uuid are required';
  end if;

  -- One active Minecraft link per web account: revoke the others.
  for v_link in
    select id, minecraft_uuid, minecraft_username
    from public.minecraft_account_links
    where user_id = p_user_id
      and status = 'verified'
      and id <> p_link_id
    for update
  loop
    update public.minecraft_account_links
    set status = 'revoked', updated_at = now()
    where id = v_link.id;
    v_superseded := v_superseded + 1;

    if v_link.minecraft_uuid is not null and v_link.minecraft_uuid <> p_minecraft_uuid then
      v_revokes := v_revokes + public.revoke_account_grants(
        p_user_id, v_link.minecraft_uuid, v_link.minecraft_username,
        'Superseded by a new Minecraft link'
      );
    end if;
  end loop;

  -- Re-deliver active entitlements to the new account for remaining duration.
  for v_ent in
    select e.id, e.order_item_id, e.expires_at,
           p.slug, p.category, p.fulfillment_type, p.duration_days, p.metadata
    from public.entitlements e
    join public.products p on p.id = e.product_id
    where e.user_id = p_user_id
      and e.status = 'active'
      and p.fulfillment_type <> 'consumable'
      and (e.expires_at is null or e.expires_at > now())
  loop
    update public.entitlements
    set minecraft_uuid = p_minecraft_uuid,
        minecraft_username = p_minecraft_username,
        updated_at = now()
    where id = v_ent.id;

    if v_ent.expires_at is null then
      v_days := v_ent.duration_days; -- null => no fixed expiry
    else
      v_days := greatest(1, ceil(extract(epoch from (v_ent.expires_at - now())) / 86400.0)::integer);
    end if;

    insert into public.reward_queue (
      user_id, minecraft_uuid, minecraft_username,
      source, source_id, reward_key, payload, idempotency_key, status, available_at
    )
    values (
      p_user_id, p_minecraft_uuid, p_minecraft_username,
      'subscription', v_ent.order_item_id, 'store.' || v_ent.slug,
      jsonb_build_object(
        'entitlement_id', v_ent.id,
        'product_slug', v_ent.slug,
        'category', v_ent.category,
        'fulfillment_type', v_ent.fulfillment_type,
        'duration_days', v_days,
        'metadata', v_ent.metadata,
        'safe_reward', true,
        'redelivered', true
      ),
      'relink_grant:' || v_ent.id::text || ':' || p_minecraft_uuid || ':' || v_stamp,
      'pending', now()
    )
    on conflict (idempotency_key) do nothing;

    get diagnostics v_rows = row_count;
    v_redelivered := v_redelivered + v_rows;
  end loop;

  superseded_links := v_superseded;
  queued_revokes := v_revokes;
  redelivered := v_redelivered;
  return next;
end;
$$;

revoke all on function public.revoke_account_grants(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.unlink_minecraft_account(uuid, text) from public, anon, authenticated;
revoke all on function public.apply_minecraft_link(uuid, uuid, text, text) from public, anon, authenticated;

grant execute on function public.revoke_account_grants(uuid, text, text, text) to service_role;
grant execute on function public.unlink_minecraft_account(uuid, text) to service_role;
grant execute on function public.apply_minecraft_link(uuid, uuid, text, text) to service_role;
