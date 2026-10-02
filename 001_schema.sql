-- =====================================================================
-- Torresina, bacheca del quartiere: schema Supabase
-- Incollare nel SQL Editor di un progetto Supabase nuovo ed eseguire.
-- =====================================================================

-- ---------- Tipi ----------
create type public.ruolo      as enum ('residente', 'admin');
create type public.tipo_post  as enum ('evento', 'avviso');
create type public.stato_post as enum ('in_attesa', 'approvato', 'rifiutato');

-- ---------- Profili ----------
create table public.profiles (
  id                        uuid primary key references auth.users(id) on delete cascade,
  nome_visualizzato         text not null default 'Residente'
                            check (char_length(nome_visualizzato) between 2 and 40),
  ruolo                     public.ruolo not null default 'residente',
  fidato                    boolean not null default false,  -- pubblica senza approvazione
  regolamento_accettato_il  timestamptz,
  creato_il                 timestamptz not null default now()
);

-- ---------- Post (eventi e avvisi) ----------
create table public.posts (
  id              uuid primary key default gen_random_uuid(),
  autore_id       uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  tipo            public.tipo_post not null,
  stato           public.stato_post not null default 'in_attesa',
  titolo          text not null check (char_length(titolo) between 3 and 80),
  descrizione     text not null check (char_length(descrizione) between 1 and 2000),
  urgente         boolean not null default false,
  inizio          timestamptz,             -- per gli eventi
  fine            timestamptz,
  luogo           text check (char_length(luogo) <= 120),
  indirizzo       text check (char_length(indirizzo) <= 160),
  lat             double precision,
  lng             double precision,
  foto_path       text,                    -- percorso nel bucket "foto-post"
  motivo_rifiuto  text,
  approvato_da    uuid references public.profiles(id),
  approvato_il    timestamptz,
  creato_il       timestamptz not null default now(),
  aggiornato_il   timestamptz not null default now(),
  constraint evento_ha_data     check (tipo <> 'evento' or inizio is not null),
  constraint evento_ha_luogo    check (tipo <> 'evento' or luogo is not null),
  constraint fine_dopo_inizio   check (fine is null or inizio is null or fine > inizio),
  constraint urgente_solo_avvisi check (not urgente or tipo = 'avviso')
);

create index posts_eventi_pubblici_idx on public.posts (inizio)    where stato = 'approvato' and tipo = 'evento';
create index posts_avvisi_pubblici_idx on public.posts (creato_il) where stato = 'approvato' and tipo = 'avviso';
create index posts_coda_idx            on public.posts (creato_il) where stato = 'in_attesa';
create index posts_autore_idx          on public.posts (autore_id);

-- ---------- Attività commerciali ----------
create table public.attivita (
  id                uuid primary key default gen_random_uuid(),
  nome              text not null,
  categoria         text not null,
  descrizione       text,
  orari             text,
  offerta           text,                  -- offerta per i residenti
  indirizzo         text,
  lat               double precision,
  lng               double precision,
  telefono          text,
  sito              text,
  in_evidenza_fino  date,                  -- per futuri spazi in evidenza
  visibile          boolean not null default false,
  proprietario_id   uuid references public.profiles(id) on delete set null,
  creato_il         timestamptz not null default now()
);

-- =====================================================================
-- Funzioni e trigger
-- =====================================================================

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and ruolo = 'admin');
$$;

-- Profilo creato automaticamente alla registrazione
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, nome_visualizzato)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'name', ''), 'Residente'));
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Un residente non può promuoversi admin o fidato da solo
create or replace function public.profiles_protect()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.ruolo  := old.ruolo;
    new.fidato := old.fidato;
  end if;
  return new;
end; $$;

create trigger profiles_before_update
  before update on public.profiles
  for each row execute function public.profiles_protect();

-- Alla creazione: lo stato lo decide il database, non l'app
create or replace function public.posts_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
begin
  if auth.uid() is null then          -- inserimenti da SQL Editor / service role
    return new;
  end if;

  select * into p from public.profiles where id = auth.uid();
  if p.id is null then
    raise exception 'Profilo non trovato';
  end if;
  if p.regolamento_accettato_il is null then
    raise exception 'Accetta il regolamento prima di pubblicare';
  end if;

  new.autore_id      := p.id;
  new.motivo_rifiuto := null;

  if p.ruolo = 'admin' or p.fidato then
    new.stato        := 'approvato';
    new.approvato_da := p.id;
    new.approvato_il := now();
  else
    new.stato        := 'in_attesa';
    new.approvato_da := null;
    new.approvato_il := null;
  end if;
  return new;
end; $$;

create trigger posts_before_insert
  before insert on public.posts
  for each row execute function public.posts_before_insert();

-- Alla modifica: solo gli admin cambiano lo stato
create or replace function public.posts_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.aggiornato_il := now();

  if auth.uid() is null or public.is_admin() then
    if new.stato = 'approvato' and old.stato <> 'approvato' then
      new.approvato_da := auth.uid();
      new.approvato_il := now();
    end if;
    return new;
  end if;

  -- autore normale: può correggere il contenuto, non lo stato
  new.autore_id      := old.autore_id;
  new.stato          := old.stato;
  new.approvato_da   := old.approvato_da;
  new.approvato_il   := old.approvato_il;
  new.motivo_rifiuto := old.motivo_rifiuto;
  return new;
end; $$;

create trigger posts_before_update
  before update on public.posts
  for each row execute function public.posts_before_update();

-- =====================================================================
-- Row Level Security
-- =====================================================================

alter table public.profiles enable row level security;
alter table public.posts    enable row level security;
alter table public.attivita enable row level security;

-- Profili: chiunque vede solo il nome visualizzato (serve per "da ...")
revoke select on public.profiles from anon;
grant  select (id, nome_visualizzato) on public.profiles to anon;

create policy "profili: lettura"
  on public.profiles for select using (true);

create policy "profili: modifica del proprio (o admin)"
  on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- Post: tutti leggono gli approvati; l'autore vede i suoi; l'admin vede tutto
create policy "post: lettura"
  on public.posts for select
  using (stato = 'approvato' or autore_id = auth.uid() or public.is_admin());

create policy "post: creazione da residenti"
  on public.posts for insert to authenticated
  with check (autore_id = auth.uid());

create policy "post: l'autore modifica finché è in attesa"
  on public.posts for update to authenticated
  using (autore_id = auth.uid() and stato = 'in_attesa')
  with check (autore_id = auth.uid());

create policy "post: gli admin modificano tutto"
  on public.posts for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "post: eliminazione (autore o admin)"
  on public.posts for delete to authenticated
  using (autore_id = auth.uid() or public.is_admin());

-- Attività: visibili a tutti se pubblicate, gestite dagli admin
create policy "attività: lettura"
  on public.attivita for select
  using (visibile or public.is_admin());

create policy "attività: gestione admin"
  on public.attivita for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- =====================================================================
-- Viste pronte per l'app (rispettano la RLS di chi le interroga)
-- =====================================================================

create view public.eventi_pubblici with (security_invoker = true) as
  select p.id, p.titolo, p.descrizione, p.inizio, p.fine, p.luogo, p.indirizzo,
         p.lat, p.lng, p.foto_path, pr.nome_visualizzato as autore
  from public.posts p
  join public.profiles pr on pr.id = p.autore_id
  where p.tipo = 'evento' and p.stato = 'approvato';

create view public.avvisi_pubblici with (security_invoker = true) as
  select p.id, p.titolo, p.descrizione, p.urgente, p.luogo, p.indirizzo,
         p.lat, p.lng, p.foto_path, p.creato_il, pr.nome_visualizzato as autore
  from public.posts p
  join public.profiles pr on pr.id = p.autore_id
  where p.tipo = 'avviso' and p.stato = 'approvato';

grant select on public.eventi_pubblici, public.avvisi_pubblici to anon, authenticated;

-- =====================================================================
-- Foto dei post (Storage)
-- Ogni utente carica nella cartella col proprio id: foto-post/<uid>/<file>
-- Nota: il bucket è pubblico, quindi anche la foto di un post in attesa
-- è raggiungibile da chi conosce l'URL esatto.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('foto-post', 'foto-post', true)
on conflict (id) do nothing;

create policy "foto: caricamento nella propria cartella"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'foto-post' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "foto: eliminazione (proprietario o admin)"
  on storage.objects for delete to authenticated
  using (bucket_id = 'foto-post'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ---------- Aggiornamenti in tempo reale (coda admin, nuovi avvisi) ----------
alter publication supabase_realtime add table public.posts;

-- =====================================================================
-- Primo admin: dopo esserti registrato nell'app, esegui
--   update public.profiles set ruolo = 'admin' where id = '<il-tuo-uuid>';
-- (l'uuid lo trovi in Authentication > Users)
-- =====================================================================
