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
