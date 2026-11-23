-- VICORA AI assistant upgrade: documents, memories, shares.
-- Run once in the Supabase SQL editor. Safe to re-run.

-- ---------------------------------------------------------------------------
-- uploaded documents
-- ---------------------------------------------------------------------------
create table if not exists public.uploaded_documents (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    conversation_id uuid references public.conversations (id) on delete set null,
    file_name text not null,
    mime_type text,
    byte_size integer,
    storage_path text,
    extracted_text text,
    page_count integer,
    status text not null default 'ready',
    error text,
    created_at timestamptz not null default now()
);

create index if not exists uploaded_documents_user_idx
    on public.uploaded_documents (user_id, created_at desc);

alter table public.uploaded_documents enable row level security;

drop policy if exists "documents_select_own" on public.uploaded_documents;
create policy "documents_select_own" on public.uploaded_documents
    for select using (auth.uid() = user_id);

drop policy if exists "documents_insert_own" on public.uploaded_documents;
create policy "documents_insert_own" on public.uploaded_documents
    for insert with check (auth.uid() = user_id);

drop policy if exists "documents_delete_own" on public.uploaded_documents;
create policy "documents_delete_own" on public.uploaded_documents
    for delete using (auth.uid() = user_id);

revoke all on public.uploaded_documents from anon;

-- ---------------------------------------------------------------------------
-- long-term memories
-- ---------------------------------------------------------------------------
create table if not exists public.user_memories (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    content text not null,
    category text not null default 'general',
    source text not null default 'chat',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists user_memories_user_idx
    on public.user_memories (user_id, created_at desc);

alter table public.user_memories enable row level security;

drop policy if exists "memories_select_own" on public.user_memories;
create policy "memories_select_own" on public.user_memories
    for select using (auth.uid() = user_id);

drop policy if exists "memories_insert_own" on public.user_memories;
create policy "memories_insert_own" on public.user_memories
    for insert with check (auth.uid() = user_id);

drop policy if exists "memories_update_own" on public.user_memories;
create policy "memories_update_own" on public.user_memories
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "memories_delete_own" on public.user_memories;
create policy "memories_delete_own" on public.user_memories
    for delete using (auth.uid() = user_id);

revoke all on public.user_memories from anon;

-- ---------------------------------------------------------------------------
-- share links
-- ---------------------------------------------------------------------------
create table if not exists public.conversation_shares (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references public.conversations (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    token text not null unique,
    created_at timestamptz not null default now(),
    revoked_at timestamptz
);

create index if not exists conversation_shares_conversation_idx
    on public.conversation_shares (conversation_id);

alter table public.conversation_shares enable row level security;

drop policy if exists "shares_select_own" on public.conversation_shares;
create policy "shares_select_own" on public.conversation_shares
    for select using (auth.uid() = user_id);

drop policy if exists "shares_insert_own" on public.conversation_shares;
create policy "shares_insert_own" on public.conversation_shares
    for insert with check (
        auth.uid() = user_id
        and exists (
            select 1 from public.conversations c
            where c.id = conversation_id and c.user_id = auth.uid()
        )
    );

drop policy if exists "shares_update_own" on public.conversation_shares;
create policy "shares_update_own" on public.conversation_shares
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

revoke all on public.conversation_shares from anon;

-- ---------------------------------------------------------------------------
-- message metadata (attachments + citations). Anonymous visitors never read
-- messages directly; the backend uses the service role for shared pages.
-- ---------------------------------------------------------------------------
alter table public.messages add column if not exists attachments jsonb;
alter table public.messages add column if not exists sources jsonb;

-- ---------------------------------------------------------------------------
-- storage: private bucket for uploaded documents
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

drop policy if exists "documents_bucket_read_own" on storage.objects;
create policy "documents_bucket_read_own" on storage.objects
    for select using (
        bucket_id = 'documents'
        and auth.uid()::text = (storage.foldername(name))[1]
    );

drop policy if exists "documents_bucket_write_own" on storage.objects;
create policy "documents_bucket_write_own" on storage.objects
    for insert with check (
        bucket_id = 'documents'
        and auth.uid()::text = (storage.foldername(name))[1]
    );

drop policy if exists "documents_bucket_delete_own" on storage.objects;
create policy "documents_bucket_delete_own" on storage.objects
    for delete using (
        bucket_id = 'documents'
        and auth.uid()::text = (storage.foldername(name))[1]
    );

-- ---------------------------------------------------------------------------
-- memory switch on the existing profile row
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists memory_enabled boolean not null default true;
