-- Vic Chatbot plugin layer: storage for connected accounts.
-- Run this once in the Supabase SQL editor.

create table if not exists public.integrations (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    provider text not null,
    access_token text not null,
    refresh_token text,
    token_expires_at timestamptz,
    scopes text,
    account_label text,
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, provider)
);

create index if not exists integrations_user_id_idx
    on public.integrations (user_id);

alter table public.integrations enable row level security;

-- The backend connects with the service role key, which bypasses RLS.
-- These policies keep the table safe if it is ever queried with a user
-- token instead.
drop policy if exists "Users read their own integrations" on public.integrations;
create policy "Users read their own integrations"
    on public.integrations for select
    using (auth.uid() = user_id);

drop policy if exists "Users delete their own integrations" on public.integrations;
create policy "Users delete their own integrations"
    on public.integrations for delete
    using (auth.uid() = user_id);

-- No insert/update policy on purpose: tokens are only written by the
-- backend so a client can never hand itself someone else's token.
