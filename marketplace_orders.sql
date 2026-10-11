-- À exécuter une seule fois dans Supabase SQL Editor.
-- Les accès passent par le serveur avec la clé service_role; aucune politique
-- client directe n'est créée sur cette table.
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
