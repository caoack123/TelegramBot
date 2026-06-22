create table if not exists public.app_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.processed_updates (
  update_id bigint primary key,
  processed_at timestamptz not null default now()
);

create index if not exists processed_updates_processed_at_idx
  on public.processed_updates (processed_at);

alter table public.app_state enable row level security;
alter table public.processed_updates enable row level security;

revoke all on table public.app_state from anon, authenticated;
revoke all on table public.processed_updates from anon, authenticated;
grant all on table public.app_state to service_role;
grant all on table public.processed_updates to service_role;

comment on table public.app_state is 'Server-only state for Telegram bot config, chat history, and user profile references.';
comment on table public.processed_updates is 'Telegram update IDs used for durable webhook idempotency.';
