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
