-- Vic Chatbot: user profiles, email preferences and announcement log.
-- Run this once in the Supabase SQL editor (Dashboard -> SQL -> New query).
-- Safe to run again: every statement is guarded.

-- ============================================================
-- 1. profiles
--    One row per auth user. Holds only presentational data; it has no
--    privilege column, so a profile update can never change a role.
-- ============================================================

create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    full_name text,
    display_name text,
    avatar_initials text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- A user reads and writes only their own row. The service role (the API on
-- Render) bypasses RLS, which is how admin tooling reads aggregates.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
    on public.profiles for select
    to authenticated
    using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
    on public.profiles for insert
    to authenticated
    with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
    on public.profiles for update
    to authenticated
    using (auth.uid() = id)
    with check (auth.uid() = id);

revoke all on public.profiles from anon;
grant select, insert, update on public.profiles to authenticated;

-- Keep updated_at honest, and keep the initials in step with the name so the
-- avatar is identical on every device.
create or replace function public.profiles_before_write()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
    source_name text;
    words text[];
begin
    source_name := coalesce(
        nullif(trim(new.display_name), ''),
        nullif(trim(new.full_name), ''),
        ''
    );

    new.display_name := nullif(trim(new.display_name), '');
    new.full_name := nullif(trim(new.full_name), '');

    if source_name <> '' then
        words := regexp_split_to_array(source_name, '\s+');
        if array_length(words, 1) >= 2 then
            new.avatar_initials := upper(
                left(words[1], 1) || left(words[2], 1)
            );
        else
            new.avatar_initials := upper(left(source_name, 2));
        end if;
    end if;

    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists profiles_before_write on public.profiles;
create trigger profiles_before_write
    before insert or update on public.profiles
    for each row execute function public.profiles_before_write();

-- ============================================================
-- 2. profile for every new signup
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    derived_name text;
begin
    derived_name := coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), '')
    );

    insert into public.profiles (id, full_name, display_name)
    values (new.id, new.raw_user_meta_data ->> 'full_name', derived_name)
    on conflict (id) do nothing;

    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- Existing accounts that signed up before this migration.
insert into public.profiles (id, full_name, display_name)
select
    u.id,
    u.raw_user_meta_data ->> 'full_name',
    coalesce(
        nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
        nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
        nullif(split_part(coalesce(u.email, ''), '@', 1), '')
    )
from auth.users u
on conflict (id) do nothing;

-- ============================================================
-- 3. email preferences (announcements + unsubscribe tokens)
-- ============================================================

create table if not exists public.email_preferences (
    user_id uuid primary key references auth.users (id) on delete cascade,
    announcements boolean not null default true,
    unsubscribe_token text unique,
    updated_at timestamptz not null default now()
);

create index if not exists email_preferences_token_idx
    on public.email_preferences (unsubscribe_token);

alter table public.email_preferences enable row level security;

drop policy if exists "email_preferences_select_own" on public.email_preferences;
create policy "email_preferences_select_own"
    on public.email_preferences for select
    to authenticated
    using (auth.uid() = user_id);

-- Users may switch announcements on or off, and nothing else.
drop policy if exists "email_preferences_update_own" on public.email_preferences;
create policy "email_preferences_update_own"
    on public.email_preferences for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

revoke all on public.email_preferences from anon;
grant select, update on public.email_preferences to authenticated;

create or replace function public.handle_new_user_preferences()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.email_preferences (user_id)
    values (new.id)
    on conflict (user_id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created_preferences on auth.users;
create trigger on_auth_user_created_preferences
    after insert on auth.users
    for each row execute function public.handle_new_user_preferences();

-- ============================================================
-- 4. announcement log (dedupe + delivery record)
--    Service-role only: RLS on with no policies means no client can read it.
-- ============================================================

create table if not exists public.announcement_log (
    id bigserial primary key,
    announcement_key text not null,
    user_id uuid references auth.users (id) on delete cascade,
    email text,
    status text not null,
    error text,
    created_at timestamptz not null default now(),
    unique (announcement_key, user_id)
);

create index if not exists announcement_log_key_idx
    on public.announcement_log (announcement_key);

alter table public.announcement_log enable row level security;
revoke all on public.announcement_log from anon, authenticated;
