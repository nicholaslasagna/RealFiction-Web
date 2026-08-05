begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id,email) values ('cafe0000-0000-4000-8000-000000000001','rev@example.test') on conflict do nothing;
insert into public.profiles (id,email) values ('cafe0000-0000-4000-8000-000000000001','rev@example.test') on conflict do nothing;
insert into public.orders (id,user_id,minecraft_username,provider,status,subtotal_cents,discount_cents,total_cents,payment_due_cents,currency)
values ('dead0000-0000-4000-8000-000000000001','cafe0000-0000-4000-8000-000000000001','RevTester','stripe','fulfilled',1299,0,1299,1299,'USD');

-- refund.created(succeeded) claims the operation
select is( public.claim_payment_revocation('refund:re_ABC','dead0000-0000-4000-8000-000000000001','refund','created'),
  true, 'refund.created(succeeded) claims the revocation');

-- refund.updated(succeeded) for the SAME refund: different event id, same object
select is( public.claim_payment_revocation('refund:re_ABC','dead0000-0000-4000-8000-000000000001','refund','updated'),
  false, 'refund.updated for the same refund does NOT revoke again');

-- replay of either event
select is( public.claim_payment_revocation('refund:re_ABC','dead0000-0000-4000-8000-000000000001','refund','replay'),
  false, 'a replayed refund event does NOT revoke again');

-- full refund arriving after the order is already revoked
select is( public.claim_payment_revocation('refund:re_ABC','dead0000-0000-4000-8000-000000000001','refund','full-after-revoked'),
  false, 'full refund after already-revoked is a no-op');

-- repeated dispute updates
select is( public.claim_payment_revocation('chargeback:dp_XYZ','dead0000-0000-4000-8000-000000000001','chargeback','created'),
  true, 'dispute.created claims its own revocation');
select is( public.claim_payment_revocation('chargeback:dp_XYZ','dead0000-0000-4000-8000-000000000001','chargeback','closed-lost'),
  false, 'dispute.closed(lost) for the same dispute does NOT revoke again');

select * from finish();
rollback;
