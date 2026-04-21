-- ============================================================
-- PULRA LEAD TRACKER — SUPABASE SCHEMA (No Auth)
-- Run this in your Supabase SQL editor (Dashboard → SQL Editor)
-- ============================================================

create extension if not exists "pgcrypto";

create table leads (
  id           uuid primary key default gen_random_uuid(),
  deal         text not null,
  loc          text, type text, branches text,
  stage        text default 'New',
  priority     text default 'Normal',
  fu_date      date, fu_required boolean default false,
  soft         text, del text, del_mode text default 'none',
  notes        text, last_contact date,
  outreach_em  boolean default false,
  outreach_wa  boolean default false,
  outreach_vb  boolean default false,
  outreach_cl  boolean default false,
  outreach_ip  boolean default false,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete cascade,
  name text, role text, phone text, email text,
  telegram text, whatsapp text, sort_order integer default 0
);

create table tickets (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete cascade,
  type text default 'other', status text default 'pending',
  title text, date date, time text, assigned_to text,
  priority text default 'normal', notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table interactions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete cascade,
  type text default 'note', text text not null,
  created_at timestamptz default now()
);

create or replace function set_updated_at()
returns trigger as $$ begin new.updated_at = now(); return new; end; $$ language plpgsql;

create trigger leads_updated_at   before update on leads   for each row execute function set_updated_at();
create trigger tickets_updated_at before update on tickets for each row execute function set_updated_at();

-- RLS: open access via anon key (the key IS your access control)
alter table leads        enable row level security;
alter table contacts     enable row level security;
alter table tickets      enable row level security;
alter table interactions enable row level security;

create policy "open" on leads        for all using (true) with check (true);
create policy "open" on contacts     for all using (true) with check (true);
create policy "open" on tickets      for all using (true) with check (true);
create policy "open" on interactions for all using (true) with check (true);

-- Realtime
alter publication supabase_realtime add table leads;
alter publication supabase_realtime add table contacts;
alter publication supabase_realtime add table tickets;
alter publication supabase_realtime add table interactions;

-- ── BOT SESSIONS (conversation state machine) ───────────────
-- Add this after initial setup if deploying the Telegram bot
create table bot_sessions (
  chat_id    bigint primary key,
  state      text not null,
  data       jsonb default '{}',
  updated_at timestamptz default now()
);

alter table bot_sessions enable row level security;
create policy "open" on bot_sessions for all using (true) with check (true);

-- Sessions expire after 30 min of inactivity (run as a cron or just let them accumulate)
-- Optional cleanup: DELETE FROM bot_sessions WHERE updated_at < now() - interval '30 minutes';
