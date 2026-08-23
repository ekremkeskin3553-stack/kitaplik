-- ============================================================================
-- Kitaplık — Supabase veritabanı kurulumu
--
-- KULLANIM
--   1. supabase.com'da projeni aç.
--   2. Sol menüden  SQL Editor → New query
--   3. Bu dosyanın tamamını yapıştır ve  Run  de.
--   4. Project Settings → API bölümünden  Project URL  ve  anon public  anahtarını
--      alıp config.js içine yaz.
--
-- Bu betik birden fazla kez çalıştırılabilir; var olanı bozmaz.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tablo
-- ---------------------------------------------------------------------------
create table if not exists public.books (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade
                      default auth.uid(),

  -- künye
  title          text not null,
  author         text,
  isbn           text,
  publisher      text,
  published_year integer,
  page_count     integer,
  series         text,
  cover_url      text,

  -- okuma takibi
  current_page   integer default 0,
  progress_pct   integer,          -- sayfa sayısı bilinmiyorsa elle girilen yüzde
  status         text default 'to_read',
  rating         smallint,

  -- düzen
  shelf          text,
  tags           text[] default '{}',
  notes          text,

  -- ödünç
  loan_to        text,
  loan_date      date,
  loan_due       date,
  loan_returned  boolean default false,

  -- senkron
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted        boolean not null default false
);

-- Eski bir kurulumdan geliyorsan eksik sütunları tamamla.
alter table public.books add column if not exists progress_pct  integer;
alter table public.books add column if not exists series        text;
alter table public.books add column if not exists tags          text[] default '{}';
alter table public.books add column if not exists deleted       boolean not null default false;

-- Sağlamlık kuralları
alter table public.books drop constraint if exists books_status_check;
alter table public.books add  constraint books_status_check
  check (status in ('to_read', 'reading', 'read'));

alter table public.books drop constraint if exists books_rating_check;
alter table public.books add  constraint books_rating_check
  check (rating is null or rating between 1 and 5);

-- ---------------------------------------------------------------------------
-- İndeksler
--
-- updated_at indeksi kritik: uygulama her eşitlemede "bu tarihten sonra
-- değişenleri ver" diye soruyor.
-- ---------------------------------------------------------------------------
create index if not exists books_user_updated_idx on public.books (user_id, updated_at);
create index if not exists books_user_title_idx   on public.books (user_id, title);
create index if not exists books_user_author_idx  on public.books (user_id, author);
create index if not exists books_user_shelf_idx   on public.books (user_id, shelf);

-- ---------------------------------------------------------------------------
-- Güvenlik (Row Level Security)
--
-- anon anahtarı herkese açık olduğu için asıl koruma burada. Bu kurallar
-- olmadan tabloya herkes erişebilirdi; bunlarla herkes YALNIZCA kendi
-- satırlarını görebilir ve değiştirebilir.
-- ---------------------------------------------------------------------------
alter table public.books enable row level security;

drop policy if exists "kendi kitaplarını gör"     on public.books;
drop policy if exists "kendi kitaplarını ekle"    on public.books;
drop policy if exists "kendi kitaplarını güncelle" on public.books;
drop policy if exists "kendi kitaplarını sil"     on public.books;

create policy "kendi kitaplarını gör"
  on public.books for select
  using (auth.uid() = user_id);

create policy "kendi kitaplarını ekle"
  on public.books for insert
  with check (auth.uid() = user_id);

create policy "kendi kitaplarını güncelle"
  on public.books for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "kendi kitaplarını sil"
  on public.books for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- user_id güvencesi
--
-- İstemci user_id göndermeyi unutsa bile satır oturum sahibine bağlansın;
-- başkasının kimliğiyle satır yazılmasın diye de üzerine yazıyoruz.
-- ---------------------------------------------------------------------------
create or replace function public.books_set_user_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.user_id := auth.uid();
  return new;
end;
$$;

drop trigger if exists books_set_user_id_trg on public.books;
create trigger books_set_user_id_trg
  before insert on public.books
  for each row execute function public.books_set_user_id();

-- ---------------------------------------------------------------------------
-- NOT: updated_at bilerek tetikleyiciyle güncellenmiyor.
-- Çakışma çözümünde "son yazan kazanır" kuralının tutarlı olması için bu
-- damgayı istemci koyuyor. Sunucu her yazımda üzerine yazsaydı, iki cihazın
-- değişiklikleri arasında hangisinin gerçekten daha yeni olduğu kaybolurdu.
-- ---------------------------------------------------------------------------
