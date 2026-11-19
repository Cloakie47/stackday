-- Stackday account database (Supabase / Postgres).
-- Run this once in the Supabase SQL editor of your project.
--
-- What is stored here: names, team lists and attendance. No money and no keys.
-- Salaries, vaults and loans live on-chain and do not depend on this database.
--
-- Security: row level security is ON for every table and there are NO public policies.
-- The browser can never read or write these tables directly. Only the Stackday server
-- (using the service role key, kept secret in server environment variables) can, and it
-- checks a wallet signature before doing anything on a wallet's behalf.

create table if not exists profiles (
  wallet      text primary key check (wallet = lower(wallet) and wallet ~ '^0x[0-9a-f]{40}$'),
  username    text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  created_at  timestamptz not null default now()
);

-- Single-use sign-in codes (nonces). The server creates one for every sign-in attempt and
-- deletes it the moment it is used, so a captured signature cannot be sent again.
-- Unused codes expire after 10 minutes and are cleared out when new ones are made.
create table if not exists sign_in_nonces (
  nonce       text primary key check (nonce ~ '^[a-f0-9]{32}$'),
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
alter table sign_in_nonces enable row level security;

create table if not exists employees (
  employer_wallet  text not null check (employer_wallet = lower(employer_wallet)),
  employee_wallet  text not null check (employee_wallet = lower(employee_wallet) and employee_wallet ~ '^0x[0-9a-f]{40}$'),
  name             text not null check (char_length(name) between 1 and 80),
  role             text not null default '' check (char_length(role) <= 80),
  salary_usdc      numeric(18, 6) not null default 0 check (salary_usdc >= 0),
  created_at       timestamptz not null default now(),
  primary key (employer_wallet, employee_wallet)
);

create table if not exists attendance (
  employee_wallet  text not null check (employee_wallet = lower(employee_wallet)),
  day              date not null,
  checked_in_at    timestamptz not null default now(),
  primary key (employee_wallet, day)
);

create index if not exists attendance_day_idx on attendance (day);

alter table profiles   enable row level security;
alter table employees  enable row level security;
alter table attendance enable row level security;

-- ---------------------------------------------------------------------------
-- Account flow (anchor parts 2 to 6), added November 15, 2026.
-- Safe to run again: every statement checks before it changes anything.
-- ---------------------------------------------------------------------------

-- Every wallet gets a profile with a unique ID on first sign-in. The name becomes optional.
alter table profiles alter column username drop not null;
alter table profiles add column if not exists uid text;
alter table profiles add column if not exists account_type text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_uid_key') then
    alter table profiles add constraint profiles_uid_key unique (uid);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_uid_format') then
    alter table profiles add constraint profiles_uid_format check (uid ~ '^SD-[0-9A-Z]{8}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_account_type_check') then
    alter table profiles add constraint profiles_account_type_check
      check (account_type is null or account_type in ('individual', 'business'));
  end if;
end $$;

-- A business profile. One per owner wallet.
create table if not exists businesses (
  owner_wallet  text primary key check (owner_wallet = lower(owner_wallet) and owner_wallet ~ '^0x[0-9a-f]{40}$'),
  name          text not null check (char_length(name) between 2 and 60),
  description   text not null default '' check (char_length(description) <= 400),
  created_at    timestamptz not null default now()
);
alter table businesses enable row level security;

-- Being on a team is an invitation until the person accepts it.
-- The business can pay an invited person (that happens on-chain and needs no consent),
-- but it only sees that person's attendance after they accept.
alter table employees add column if not exists status text not null default 'invited';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'employees_status_check') then
    alter table employees add constraint employees_status_check check (status in ('invited', 'accepted'));
  end if;
end $$;
create index if not exists employees_employee_idx on employees (employee_wallet);

-- Rate limiting for the API routes. One row per (key, window): the key is a route group plus a
-- keyed hash of the visitor's address (the address itself is never stored). The server calls
-- rate_limit_hit for each request; old windows are cleared out now and then.
create table if not exists rate_limits (
  key           text not null check (char_length(key) <= 80),
  window_start  timestamptz not null,
  hits          integer not null default 0,
  primary key (key, window_start)
);
alter table rate_limits enable row level security;

create or replace function rate_limit_hit(p_key text, p_window_seconds integer)
returns integer
language plpgsql
set search_path = public
as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n integer;
begin
  insert into rate_limits (key, window_start, hits) values (p_key, w, 1)
  on conflict (key, window_start) do update set hits = rate_limits.hits + 1
  returning hits into n;
  if random() < 0.01 then
    delete from rate_limits where window_start < now() - interval '1 day';
  end if;
  return n;
end;
$$;

-- Only the server (service role) may call it. The browser's public key cannot.
revoke all on function rate_limit_hit(text, integer) from public, anon, authenticated;
grant execute on function rate_limit_hit(text, integer) to service_role;

-- Recurring buys the trigger bot should run (web/app/api/keeper). A row is only a reminder: the
-- bot re-reads the plan on the blockchain before every buy, and drops rows whose plan was cancelled.
create table if not exists recurring_plans (
  wallet      text not null check (wallet ~ '^0x[0-9a-f]{40}$'),
  asset       text not null check (asset ~ '^0x[0-9a-f]{40}$'),
  created_at  timestamptz not null default now(),
  primary key (wallet, asset)
);
alter table recurring_plans enable row level security;
-- No policies: only the server (service role) reads or writes it.

-- ---------------------------------------------------------------------------------------------
-- Research (Themes layer engine, docs/research/PLAN.md). Market research is public information
-- the server writes once per trading day; reports, portfolios and plans belong to one wallet.
-- RLS on and no policies, like every table above: only the server (service role) reads or writes.
-- ---------------------------------------------------------------------------------------------

-- One row per engine run. A failed or over-budget run writes nothing else, so the last good
-- snapshot stays live.
create table if not exists research_runs (
  run_id       text primary key,
  run_date     date not null,
  status       text not null check (status in ('running', 'ok', 'failed', 'aborted-cost')),
  cost_usd     numeric(10, 4) not null default 0,
  detail       text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);
alter table research_runs enable row level security;

-- Daily research note per asset (ResearchNote in web/lib/research/types.ts). Kept forever so
-- people can see how a suggestion changed over time.
create table if not exists research_notes (
  run_date   date not null,
  asset_id   text not null check (asset_id ~ '^m[A-Za-z]{2,10}$'),
  run_id     text not null references research_runs(run_id),
  action     text not null check (action in ('buy', 'hold', 'sell', 'watch')),
  note       jsonb not null,
  created_at timestamptz not null default now(),
  primary key (run_date, asset_id)
);
alter table research_notes enable row level security;

-- Market overview per trading day (MarketOverview).
create table if not exists research_market (
  run_date   date primary key,
  run_id     text not null references research_runs(run_id),
  overview   jsonb not null,
  created_at timestamptz not null default now()
);
alter table research_market enable row level security;

-- Reports a wallet generated (Report). Body is the full report as shown.
create table if not exists research_reports (
  id            uuid primary key default gen_random_uuid(),
  wallet        text not null check (wallet ~ '^0x[0-9a-f]{40}$'),
  scope         text not null check (scope in ('market', 'asset', 'portfolio', 'full')),
  period        text not null check (period in ('daily', 'weekly', 'monthly', 'on-demand')),
  snapshot_date date not null,
  premium       boolean not null default false,
  body          jsonb not null,
  created_at    timestamptz not null default now()
);
create index if not exists research_reports_wallet on research_reports (wallet, created_at desc);
alter table research_reports enable row level security;

-- Holdings typed in by hand plus horizon and risk answers (PortfolioInput). Vault holdings are
-- read from the chain each time and never stored here.
create table if not exists research_portfolios (
  wallet      text primary key check (wallet ~ '^0x[0-9a-f]{40}$'),
  input       jsonb not null,
  updated_at  timestamptz not null default now()
);
alter table research_portfolios enable row level security;

-- Scheduled reports a wallet asked for.
create table if not exists research_schedules (
  wallet      text not null check (wallet ~ '^0x[0-9a-f]{40}$'),
  period      text not null check (period in ('daily', 'weekly', 'monthly')),
  scope       text not null check (scope in ('market', 'portfolio', 'full')),
  enabled     boolean not null default true,
  last_run    date,
  primary key (wallet, period, scope)
);
alter table research_schedules enable row level security;

-- Plan and credits per wallet (Entitlement). Testnet only: payments are test USDC on Base Sepolia.
create table if not exists research_entitlements (
  wallet          text primary key check (wallet ~ '^0x[0-9a-f]{40}$'),
  plan            text not null default 'free' check (plan in ('free', 'pay-per-report', 'monthly', 'yearly')),
  valid_until     timestamptz,
  report_credits  integer not null default 0 check (report_credits >= 0),
  premium         boolean not null default false,
  updated_at      timestamptz not null default now()
);
alter table research_entitlements enable row level security;

-- Each payment transaction is accepted once (the primary key stops a replayed hash).
create table if not exists research_payments (
  tx_hash      text primary key check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  wallet       text not null check (wallet ~ '^0x[0-9a-f]{40}$'),
  chain_id     integer not null,
  amount_usdc  numeric(18, 6) not null check (amount_usdc > 0),
  purpose      text not null check (purpose in ('report', 'monthly', 'yearly', 'premium')),
  verified_at  timestamptz not null default now()
);
alter table research_payments enable row level security;
-- No policies on any research table: only the server (service role) reads or writes them.
