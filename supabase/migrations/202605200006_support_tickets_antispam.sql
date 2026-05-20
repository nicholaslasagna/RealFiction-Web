-- Anti-spam support for support tickets: store a hashed client IP so the
-- contact route can rate-limit per IP without retaining raw addresses.

alter table public.support_tickets
  add column if not exists ip_hash text;

create index if not exists support_tickets_ip_hash_created_idx
on public.support_tickets (ip_hash, created_at desc);
