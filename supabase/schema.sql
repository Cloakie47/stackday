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
