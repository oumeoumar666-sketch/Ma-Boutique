-- Run once in the Supabase SQL Editor before deploying the ownership checks.
-- Product reads remain public; only the server uses owner_uid to authorize
-- publish-related actions with a verified Firebase ID token.
alter table public.products
  add column if not exists owner_uid text;

create index if not exists products_owner_uid_idx
  on public.products (owner_uid);

-- Existing rows intentionally remain unclaimed. Assign them only after
-- verifying each seller's Firebase UID. Example for a verified account:
-- update public.products
-- set owner_uid = 'FIREBASE_UID_CONFIRMED_WITH_SELLER'
-- where seller = 'EXACT_EXISTING_SELLER_NAME' and owner_uid is null;

create table if not exists public.user_profiles (
  user_id text primary key,
  role text not null check (role in ('buyer', 'seller', 'commercial')),
  created_at timestamptz not null default now()
);
alter table public.user_profiles drop constraint if exists user_profiles_role_check;
alter table public.user_profiles
  add constraint user_profiles_role_check
  check (role in ('buyer', 'seller', 'commercial'));
alter table public.user_profiles enable row level security;

create table if not exists public.marketplace_sales (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null,
  product_id text not null,
  product_name text not null,
  amount_gnf numeric not null check (amount_gnf > 0),
  quantity integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now()
);
alter table public.marketplace_sales
  add column if not exists commercial_uid text,
  add column if not exists commission_percent numeric not null default 0,
  add column if not exists commission_gnf numeric not null default 0;
alter table public.marketplace_sales enable row level security;
create index if not exists marketplace_sales_owner_created_idx
  on public.marketplace_sales (owner_uid, created_at desc);
create index if not exists marketplace_sales_commercial_created_idx
  on public.marketplace_sales (commercial_uid, created_at desc);

create table if not exists public.commercial_profiles (
  user_id text primary key,
  referral_code text not null unique,
  created_at timestamptz not null default now()
);
alter table public.commercial_profiles enable row level security;
alter table public.products
  add column if not exists commission_percent numeric not null default 0
    check (commission_percent >= 0 and commission_percent <= 50);

create table if not exists public.marketplace_orders (
  id uuid primary key default gen_random_uuid(),
  buyer_uid text not null,
  seller_uid text not null,
  product_id text not null,
  product_name text not null,
  unit_price_gnf numeric not null check (unit_price_gnf > 0),
  quantity integer not null check (quantity > 0),
  buyer_name text not null,
  buyer_phone text not null,
  delivery_area text not null default '',
  buyer_note text not null default '',
  status text not null default 'requested'
    check (status in ('requested', 'confirmed', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.marketplace_orders enable row level security;
create index if not exists marketplace_orders_buyer_created_idx
  on public.marketplace_orders (buyer_uid, created_at desc);
create index if not exists marketplace_orders_seller_created_idx
  on public.marketplace_orders (seller_uid, created_at desc);

-- Retire the listing and record its sale in one database transaction.
create or replace function public.record_marketplace_sale(
  p_product_id text,
  p_owner_uid text,
  p_referral_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sold_product public.products%rowtype;
  recorded_sale public.marketplace_sales%rowtype;
  matched_commercial_uid text;
  commission_rate numeric := 0;
  commission_amount numeric := 0;
begin
  delete from public.products as product
  where product.id = p_product_id and product.owner_uid = p_owner_uid
  returning product.* into sold_product;

  if not found then
    return jsonb_build_object('notFound', true);
  end if;

  if nullif(trim(p_referral_code), '') is not null then
    select profile.user_id into matched_commercial_uid
      from public.commercial_profiles as profile
      join public.user_profiles as account on account.user_id = profile.user_id
      where upper(profile.referral_code) = upper(trim(p_referral_code))
        and account.role = 'commercial';
    if matched_commercial_uid is null then
      raise exception 'Code commercial invalide';
    end if;
    commission_rate := coalesce(sold_product.commission_percent, 0);
    commission_amount := floor(sold_product.price * commission_rate / 100);
  end if;

  insert into public.marketplace_sales (
    owner_uid, product_id, product_name, amount_gnf, quantity,
    commercial_uid, commission_percent, commission_gnf
  ) values (
    p_owner_uid, sold_product.id, sold_product.name, sold_product.price, 1,
    matched_commercial_uid, commission_rate, commission_amount
  ) returning * into recorded_sale;

  return jsonb_build_object(
    'sale', to_jsonb(recorded_sale),
    'image_url', sold_product.image_url
  );
end;
$$;

revoke all on function public.record_marketplace_sale(text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_marketplace_sale(text, text, text)
  to service_role;
