-- Vic Chatbot: Google sign-in support for profiles.
-- Run this after profiles_and_announcements.sql. Safe to run more than once.
--
-- Two additions:
--   display_name_is_custom  remembers that the person corrected their own name,
--                           so an automatic name never overwrites it again.
--   avatar_url              stores the picture Google returns, unused by the
--                           initials avatar but kept for future use.
--
-- The signup trigger is replaced so a Google account arrives with the name and
-- picture Google already knows, instead of falling back to the email address.

alter table public.profiles
    add column if not exists display_name_is_custom boolean not null default false;

alter table public.profiles
    add column if not exists avatar_url text;

-- A person's own correction must survive later sign-ins.
comment on column public.profiles.display_name_is_custom is
    'True once the person edited their display name; automatic names must not overwrite it.';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    meta_name text;
    derived   text;
begin
    meta_name := coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'display_name'), '')
    );

    derived := coalesce(meta_name, split_part(new.email, '@', 1));

    insert into public.profiles (id, full_name, display_name, avatar_url)
    values (new.id, meta_name, derived, new.raw_user_meta_data ->> 'avatar_url')
    on conflict (id) do update
        set full_name  = coalesce(public.profiles.full_name, excluded.full_name),
            display_name = case
                when public.profiles.display_name_is_custom then public.profiles.display_name
                else coalesce(excluded.display_name, public.profiles.display_name)
            end,
            avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
            updated_at = now();

    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- Existing accounts that signed in before this migration: fill in what Google
-- already told Supabase, without touching a name the person chose themselves.
update public.profiles p
set full_name = coalesce(
        nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
        nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
        p.full_name
    ),
    avatar_url = coalesce(u.raw_user_meta_data ->> 'avatar_url', p.avatar_url),
    updated_at = now()
from auth.users u
where u.id = p.id
  and p.display_name_is_custom = false
  and (p.full_name is null or p.avatar_url is null);

-- RLS is unchanged: the owner-only policies from the first migration still apply,
-- and there is still no role column for a profile write to reach.
