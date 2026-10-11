-- Run once in the Supabase SQL Editor for Ma Boutique.
-- The server accesses this table with SUPABASE_SECRET_KEY. Do not expose that
-- key in the Flutter application or create an anonymous access policy here.
create table if not exists public.subscription_codes (
  code_hash text primary key,
  duration_days integer not null check (duration_days = 30),
  created_at timestamptz not null default now(),
  redeemed_by text,
  redeemed_at timestamptz,
  expires_at timestamptz
);

alter table public.subscription_codes enable row level security;

create table if not exists public.subscription_requests (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  payment_provider text not null default 'orange_money' check (payment_provider in ('orange_money', 'mtn_momo')),
  phone text not null,
  transaction_reference text not null unique,
  amount_gnf integer not null check (amount_gnf = 20000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table public.subscription_requests enable row level security;

-- Migration for installations where subscription_requests already exists.
alter table public.subscription_requests
  add column if not exists payment_provider text not null default 'orange_money';
alter table public.subscription_requests
  drop constraint if exists subscription_requests_payment_provider_check;
alter table public.subscription_requests
  add constraint subscription_requests_payment_provider_check
  check (payment_provider in ('orange_money', 'mtn_momo'));

alter table public.subscription_codes
  add column if not exists request_id uuid unique references public.subscription_requests(id);
