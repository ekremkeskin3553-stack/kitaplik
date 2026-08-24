-- ============================================================================
-- Kitaplık — sosyal katman veri modeli
--
-- KULLANIM
--   Supabase → SQL Editor → New query → bu dosyanın tamamını yapıştır → Run
--   Önce schema.sql çalıştırılmış olmalı.
--
-- Bu betik birden fazla kez çalıştırılabilir; var olanı bozmaz.
--
-- ---------------------------------------------------------------------------
-- GÜVENLİK NOTU — bu dosyanın en kritik kısmı RLS kurallarıdır.
--
-- Kişisel kitaplıkta kural basitti: "herkes yalnızca kendi satırını görür".
-- Sosyal katmanda bu yetmiyor; artık "bu profil herkese açık mı", "bu kulüp
-- gizli mi", "bu kişi beni engellemiş mi" gibi sorular var. Bir hata burada
-- veri sızıntısı demek, o yüzden her tablonun kuralı ayrıca yazıldı ve
-- varsayılan her zaman "kapalı" tarafta tutuldu.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Yardımcı: güncelleme damgası
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- ===========================================================================
-- 1. PROFİLLER
--
-- auth.users tablosuna doğrudan dokunulmaz; herkese açık bilgiler burada
-- tutulur. E-posta adresi bilerek buraya konmadı — kimsenin e-postası
-- başkasına görünmemeli.
-- ===========================================================================
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null unique
                 -- Yalnızca küçük harf: citext ile desen kontrolü de harf duyarsız çalışıp
                 -- 'ABC' gibi adların geçmesine izin veriyordu.
                 check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null default '',
  bio          text default '',
  avatar_url   text default '',
  city         text default '',
  is_public    boolean not null default true,
  is_suspended boolean not null default false,   -- moderasyon
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Kullanıcı adı olarak alınamayacak kelimeler
create table if not exists public.reserved_usernames (name text primary key);
insert into public.reserved_usernames (name) values
  ('admin'),('administrator'),('root'),('kitaplik'),('kitaplık'),('destek'),
  ('support'),('yardim'),('help'),('api'),('www'),('mail'),('info'),('iletisim'),
  ('moderator'),('mod'),('sistem'),('system'),('null'),('undefined'),('ben'),
  ('kulup'),('kulupler'),('kitap'),('kitaplar'),('ilan'),('ilanlar'),('ara'),('profil')
on conflict do nothing;

create or replace function public.check_reserved_username()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.reserved_usernames r where r.name = new.username) then
    raise exception 'Bu kullanıcı adı alınamaz: %', new.username
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_reserved on public.profiles;
create trigger profiles_reserved before insert or update of username on public.profiles
  for each row execute function public.check_reserved_username();


-- ===========================================================================
-- 2. ENGELLEME
--
-- Takip ve kulüp kurallarından ÖNCE tanımlanıyor, çünkü diğer tabloların
-- güvenlik kuralları buna bakıyor.
-- ===========================================================================
create table if not exists public.blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- SECURITY DEFINER: RLS'i atlayarak çalışır.
-- Bu şart — engelleme kaydı sorgulayan bir RLS kuralı, blocks tablosunun
-- kendi RLS kuralını tetikleyip sonsuz döngüye girerdi.
create or replace function public.is_blocked(a uuid, b uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  );
$$;


-- ===========================================================================
-- 3. TAKİP
-- ===========================================================================
create table if not exists public.follows (
  follower_id  uuid not null references auth.users (id) on delete cascade,
  following_id uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create index if not exists follows_following_idx on public.follows (following_id);


-- ===========================================================================
-- 4. KİTAP GÖRÜNÜRLÜĞÜ
--
-- Mevcut books tablosuna görünürlük alanı ekleniyor. Varsayılan GİZLİ:
-- kimsenin kitaplığı, kendisi istemeden herkese açılmamalı.
-- ===========================================================================
alter table public.books add column if not exists is_public boolean not null default false;
create index if not exists books_public_idx on public.books (user_id) where is_public;


-- ===========================================================================
-- 5. KULÜPLER
-- ===========================================================================
create table if not exists public.clubs (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  name        text not null check (length(trim(name)) between 2 and 80),
  description text default '',
  cover_url   text default '',
  owner_id    uuid not null references auth.users (id) on delete cascade,
  is_public   boolean not null default true,
  is_removed  boolean not null default false,    -- moderasyon
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists clubs_touch on public.clubs;
create trigger clubs_touch before update on public.clubs
  for each row execute function public.touch_updated_at();

/* Kulübü kuran kişi kendiliğinden 'owner' rolüyle üye yapılır.
   Bu olmadan kurucu kendi kulübünün dışında kalıyor: gizli bir kulüpte
   üyelik satırı olmadığı için kulübü göremiyor, göremediği için de üye
   ekleyemiyor — kilitli bir döngü. SECURITY DEFINER, çünkü tetikleyici
   çalıştığı anda kurucunun club_members'a yazma yetkisi henüz yok. */
create or replace function public.add_club_owner()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.club_members (club_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (club_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists clubs_add_owner on public.clubs;
create trigger clubs_add_owner after insert on public.clubs
  for each row execute function public.add_club_owner();

create table if not exists public.club_members (
  club_id   uuid not null references public.clubs (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  role      text not null default 'member' check (role in ('owner','moderator','member')),
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

create index if not exists club_members_user_idx on public.club_members (user_id);

-- Yine SECURITY DEFINER: club_members üzerindeki kural yine club_members'a
-- bakacağı için doğrudan yazılırsa sonsuz döngü olur. Supabase'de en sık
-- yapılan RLS hatası budur.
create or replace function public.is_club_member(c uuid, u uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.club_members where club_id = c and user_id = u);
$$;

create or replace function public.club_role(c uuid, u uuid)
returns text
language sql stable security definer set search_path = public as $$
  select role from public.club_members where club_id = c and user_id = u;
$$;

/* Bir kulüp, verilen kullanıcıya görünür mü?
   Herkese açık kulüpler herkese görünür; gizli kulüpleri yalnızca üyeleri görür. */
create or replace function public.club_visible(c uuid, u uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.clubs
    where id = c
      and not is_removed
      and (is_public or public.is_club_member(c, u))
  );
$$;


-- ===========================================================================
-- 6. KULÜP GÖNDERİLERİ VE YORUMLAR
-- ===========================================================================
create table if not exists public.club_posts (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs (id) on delete cascade,
  author_id  uuid not null references auth.users (id) on delete cascade,
  body       text not null check (length(trim(body)) between 1 and 5000),
  -- Gönderi bir kitap hakkındaysa künyesi burada kopyalanır. Kasıtlı olarak
  -- books tablosuna bağlanmıyor: gönderen kitabı kitaplığından silse bile
  -- kulüpteki tartışma anlamını yitirmemeli.
  book_title  text default '',
  book_author text default '',
  book_isbn   text default '',
  book_cover  text default '',
  is_removed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists club_posts_club_idx on public.club_posts (club_id, created_at desc);

drop trigger if exists club_posts_touch on public.club_posts;
create trigger club_posts_touch before update on public.club_posts
  for each row execute function public.touch_updated_at();

create table if not exists public.club_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.club_posts (id) on delete cascade,
  author_id  uuid not null references auth.users (id) on delete cascade,
  body       text not null check (length(trim(body)) between 1 and 2000),
  is_removed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists club_comments_post_idx on public.club_comments (post_id, created_at);

-- Yorumun ait olduğu kulübü bulmak için (RLS kuralları kullanıyor)
create or replace function public.post_club(p uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select club_id from public.club_posts where id = p;
$$;


-- ===========================================================================
-- 7. ŞİKÂYET
--
-- Kullanıcı içeriği barındıran her platformun ilk günden ihtiyacı olan şey.
-- Sonradan eklenmesi zor, baştan koymak kolay.
-- ===========================================================================
create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null references auth.users (id) on delete cascade,
  target_type  text not null check (target_type in ('profile','club','post','comment','listing')),
  target_id    uuid not null,
  reason       text not null check (length(trim(reason)) between 3 and 1000),
  status       text not null default 'open' check (status in ('open','reviewed','dismissed')),
  created_at   timestamptz not null default now()
);

create index if not exists reports_status_idx on public.reports (status, created_at);


-- ===========================================================================
-- 8. GÜVENLİK KURALLARI (RLS)
-- ===========================================================================

alter table public.profiles      enable row level security;
alter table public.blocks        enable row level security;
alter table public.follows       enable row level security;
alter table public.clubs         enable row level security;
alter table public.club_members  enable row level security;
alter table public.club_posts    enable row level security;
alter table public.club_comments enable row level security;
alter table public.reports       enable row level security;
alter table public.reserved_usernames enable row level security;

-- --- profiller ---------------------------------------------------------
drop policy if exists "profil gor" on public.profiles;
create policy "profil gor" on public.profiles for select
  using (
    id = auth.uid()
    or (is_public and not is_suspended and not public.is_blocked(auth.uid(), id))
  );

drop policy if exists "profil olustur" on public.profiles;
create policy "profil olustur" on public.profiles for insert
  with check (id = auth.uid());

drop policy if exists "profil duzenle" on public.profiles;
create policy "profil duzenle" on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- --- engelleme ---------------------------------------------------------
drop policy if exists "engel gor" on public.blocks;
create policy "engel gor" on public.blocks for select using (blocker_id = auth.uid());

drop policy if exists "engel ekle" on public.blocks;
create policy "engel ekle" on public.blocks for insert with check (blocker_id = auth.uid());

drop policy if exists "engel kaldir" on public.blocks;
create policy "engel kaldir" on public.blocks for delete using (blocker_id = auth.uid());

-- --- takip -------------------------------------------------------------
drop policy if exists "takip gor" on public.follows;
create policy "takip gor" on public.follows for select
  using (not public.is_blocked(auth.uid(), follower_id)
     and not public.is_blocked(auth.uid(), following_id));

drop policy if exists "takip et" on public.follows;
create policy "takip et" on public.follows for insert
  with check (follower_id = auth.uid() and not public.is_blocked(auth.uid(), following_id));

drop policy if exists "takibi birak" on public.follows;
create policy "takibi birak" on public.follows for delete using (follower_id = auth.uid());

-- --- kitaplar (mevcut kuralın üzerine görünürlük) -----------------------
-- Kendi kitapların her zaman görünür; başkasınınki ancak hem kitap hem
-- profil herkese açıksa ve engel yoksa.
drop policy if exists "kendi kitaplarını gör" on public.books;
create policy "kendi kitaplarını gör" on public.books for select
  using (
    auth.uid() = user_id
    or (
      is_public
      and not deleted
      and exists (
        select 1 from public.profiles p
        where p.id = books.user_id and p.is_public and not p.is_suspended
      )
      and not public.is_blocked(auth.uid(), user_id)
    )
  );

-- --- kulüpler ----------------------------------------------------------
-- owner_id kontrolü, üyelik satırından bağımsız olarak da yazıldı: kayıt
-- eklenirken PostgREST oluşan satırı geri okuyor ve o an üyelik tetikleyicisi
-- henüz görünür olmayabiliyor. Sahibin kendi kulübünü her hâlükârda görmesi
-- zaten doğru davranış.
drop policy if exists "kulup gor" on public.clubs;
create policy "kulup gor" on public.clubs for select
  using (
    not is_removed
    and (is_public or owner_id = auth.uid() or public.is_club_member(id, auth.uid()))
  );

drop policy if exists "kulup kur" on public.clubs;
create policy "kulup kur" on public.clubs for insert with check (owner_id = auth.uid());

drop policy if exists "kulup duzenle" on public.clubs;
create policy "kulup duzenle" on public.clubs for update
  using (owner_id = auth.uid() or public.club_role(id, auth.uid()) in ('owner','moderator'))
  with check (owner_id = auth.uid() or public.club_role(id, auth.uid()) in ('owner','moderator'));

drop policy if exists "kulup sil" on public.clubs;
create policy "kulup sil" on public.clubs for delete using (owner_id = auth.uid());

-- --- kulüp üyeleri -----------------------------------------------------
drop policy if exists "uye gor" on public.club_members;
create policy "uye gor" on public.club_members for select
  using (public.club_visible(club_id, auth.uid()));

-- Herkese açık kulübe kendi kendine katılabilirsin; gizli kulübe katılmak
-- için kulüp yöneticisinin eklemesi gerekir.
drop policy if exists "kulube katil" on public.club_members;
create policy "kulube katil" on public.club_members for insert
  with check (
    (user_id = auth.uid() and exists (
      select 1 from public.clubs c where c.id = club_id and c.is_public and not c.is_removed
    ))
    or public.club_role(club_id, auth.uid()) in ('owner','moderator')
    or exists (select 1 from public.clubs c where c.id = club_id and c.owner_id = auth.uid())
  );

drop policy if exists "uyelikten cik" on public.club_members;
create policy "uyelikten cik" on public.club_members for delete
  using (user_id = auth.uid() or public.club_role(club_id, auth.uid()) in ('owner','moderator'));

drop policy if exists "uye rolu degistir" on public.club_members;
create policy "uye rolu degistir" on public.club_members for update
  using (public.club_role(club_id, auth.uid()) = 'owner')
  with check (public.club_role(club_id, auth.uid()) = 'owner');

-- --- gönderiler --------------------------------------------------------
drop policy if exists "gonderi gor" on public.club_posts;
create policy "gonderi gor" on public.club_posts for select
  using (
    not is_removed
    and public.club_visible(club_id, auth.uid())
    and not public.is_blocked(auth.uid(), author_id)
  );

drop policy if exists "gonderi yaz" on public.club_posts;
create policy "gonderi yaz" on public.club_posts for insert
  with check (author_id = auth.uid() and public.is_club_member(club_id, auth.uid()));

drop policy if exists "gonderi duzenle" on public.club_posts;
create policy "gonderi duzenle" on public.club_posts for update
  using (author_id = auth.uid() or public.club_role(club_id, auth.uid()) in ('owner','moderator'))
  with check (author_id = auth.uid() or public.club_role(club_id, auth.uid()) in ('owner','moderator'));

drop policy if exists "gonderi sil" on public.club_posts;
create policy "gonderi sil" on public.club_posts for delete
  using (author_id = auth.uid() or public.club_role(club_id, auth.uid()) in ('owner','moderator'));

-- --- yorumlar ----------------------------------------------------------
drop policy if exists "yorum gor" on public.club_comments;
create policy "yorum gor" on public.club_comments for select
  using (
    not is_removed
    and public.club_visible(public.post_club(post_id), auth.uid())
    and not public.is_blocked(auth.uid(), author_id)
  );

drop policy if exists "yorum yaz" on public.club_comments;
create policy "yorum yaz" on public.club_comments for insert
  with check (
    author_id = auth.uid()
    and public.is_club_member(public.post_club(post_id), auth.uid())
  );

drop policy if exists "yorum sil" on public.club_comments;
create policy "yorum sil" on public.club_comments for delete
  using (
    author_id = auth.uid()
    or public.club_role(public.post_club(post_id), auth.uid()) in ('owner','moderator')
  );

-- --- şikâyet -----------------------------------------------------------
-- Kullanıcı yalnızca kendi şikâyetini görür; inceleme paneli service_role ile
-- çalışacağı için RLS'e takılmaz.
drop policy if exists "sikayet gor" on public.reports;
create policy "sikayet gor" on public.reports for select using (reporter_id = auth.uid());

drop policy if exists "sikayet et" on public.reports;
create policy "sikayet et" on public.reports for insert with check (reporter_id = auth.uid());

-- --- ayrılmış kullanıcı adları ----------------------------------------
drop policy if exists "ayrilmis oku" on public.reserved_usernames;
create policy "ayrilmis oku" on public.reserved_usernames for select using (true);


-- ===========================================================================
-- 9. KAYIT OLUNCA PROFİL AÇ
--
-- Yeni kullanıcıya otomatik profil oluşturulur; kullanıcı adı e-postadan
-- türetilir, çakışırsa sonuna sayı eklenir. Böylece uygulama tarafında
-- "profili yoksa oluştur" gibi kırılgan bir akış gerekmiyor.
-- ===========================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  base text;
  candidate text;
  n int := 0;
begin
  base := lower(regexp_replace(split_part(new.email, '@', 1), '[^a-z0-9_]', '', 'g'));
  if length(base) < 3 then base := 'okur'; end if;
  base := left(base, 16);
  candidate := base;

  while exists (select 1 from public.profiles where username = candidate)
     or exists (select 1 from public.reserved_usernames where name = candidate) loop
    n := n + 1;
    candidate := left(base, 16) || n::text;
    if n > 9999 then
      candidate := 'okur' || substr(replace(new.id::text, '-', ''), 1, 10);
      exit;
    end if;
  end loop;

  insert into public.profiles (id, username, display_name)
  values (new.id, candidate, coalesce(split_part(new.email, '@', 1), 'Okur'))
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Bu betiği mevcut bir projede çalıştırıyorsan, önceden kayıtlı kullanıcılara
-- da profil aç:
insert into public.profiles (id, username, display_name)
select u.id,
       'okur' || substr(replace(u.id::text, '-', ''), 1, 10),
       coalesce(split_part(u.email, '@', 1), 'Okur')
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict do nothing;


-- ===========================================================================
-- 10. KEŞFETME İÇİN GÖRÜNÜMLER
--
-- Sayaçları her seferinde tek tek sorgulamak yerine hazır görünümler.
-- security_invoker: görünüm, sorguyu yapan kullanıcının yetkileriyle çalışır,
-- yani RLS kuralları görünüm üzerinden atlanamaz.
-- ===========================================================================
create or replace view public.club_stats
with (security_invoker = true) as
  select c.id, c.slug, c.name, c.description, c.cover_url, c.is_public, c.created_at,
         (select count(*) from public.club_members m where m.club_id = c.id) as member_count,
         (select count(*) from public.club_posts p where p.club_id = c.id and not p.is_removed) as post_count
  from public.clubs c
  where not c.is_removed;

create or replace view public.profile_stats
with (security_invoker = true) as
  select p.id, p.username, p.display_name, p.bio, p.avatar_url, p.city, p.is_public, p.created_at,
         (select count(*) from public.follows f where f.following_id = p.id) as follower_count,
         (select count(*) from public.follows f where f.follower_id = p.id) as following_count,
         (select count(*) from public.books b where b.user_id = p.id and b.is_public and not b.deleted) as public_book_count
  from public.profiles p
  where not p.is_suspended;
