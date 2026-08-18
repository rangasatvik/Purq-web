-- Waitlist table for the landing page.
--
-- Run once in the Supabase SQL editor (staging project).
--
-- This lives OUTSIDE the Drizzle migration chain on purpose: it belongs to the
-- marketing site, not the app. Putting it in api/drizzle would mean the app's
-- migrations own a table the app never reads. One table, one job.

create table if not exists public.waitlist (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  source     text,
  country    text,
  referrer   text,
  created_at timestamptz not null default now(),

  -- A plain column constraint, NOT a unique index on lower(email).
  --
  -- PostgREST infers the ON CONFLICT target from the ?on_conflict= column list,
  -- and it can only name real columns. A functional index on lower(email) is
  -- unnameable that way, so `Prefer: resolution=merge-duplicates` would fall
  -- back to the primary key — a fresh uuid every insert, which never conflicts.
  -- The second signup would then hit the index directly, raise 23505, and the
  -- visitor would be shown an error for succeeding twice.
  --
  -- The Pages Function lowercases before it sends, so case-insensitivity is
  -- preserved without an expression index. If that ever stops being true, this
  -- constraint stops protecting anything — keep them together.
  constraint waitlist_email_key unique (email)
);

-- RLS on, and deliberately NO policies.
--
-- No policy means no role can read or write through the Data API. The Pages
-- Function uses the service role key, which bypasses RLS — so signups work and
-- the table is unreachable by anyone holding the publishable key. If a policy
-- is ever added here, re-read this comment first and ask what it opens up.
alter table public.waitlist enable row level security;
