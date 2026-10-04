-- =====================================================================
-- Torresina v2: attività e servizi, promozioni, comunicazioni a comparsa,
-- galleria foto, limiti sulle immagini. Eseguire DOPO 001 e 002.
-- =====================================================================

-- ---------- Attività e servizi ----------
alter table public.attivita
  add column tipo          text not null default 'attivita' check (tipo in ('attivita', 'servizio')),
  add column foto_path     text,
  add column whatsapp      text,
  add column instagram     text,
  add column email         text,
  add column aggiornato_il timestamptz not null default now();

create index attivita_tipo_idx on public.attivita (tipo) where visibile;

create or replace function public.is_titolare(a uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.attivita where id = a and proprietario_id = auth.uid());
$$;

-- Il titolare modifica la sua scheda, ma non visibilità, evidenza, tipo o titolare
create or replace function public.attivita_protect()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.aggiornato_il := now();
  if auth.uid() is not null and not public.is_admin() then
    new.visibile         := old.visibile;
    new.in_evidenza_fino := old.in_evidenza_fino;
    new.proprietario_id  := old.proprietario_id;
    new.tipo             := old.tipo;
  end if;
  return new;
end; $$;

create trigger attivita_before_update
  before update on public.attivita
  for each row execute function public.attivita_protect();

drop policy "attività: lettura" on public.attivita;
create policy "attività: lettura"
  on public.attivita for select
  using (visibile or public.is_admin() or proprietario_id = auth.uid());

create policy "attività: il titolare modifica la sua"
  on public.attivita for update to authenticated
  using (proprietario_id = auth.uid()) with check (proprietario_id = auth.uid());

-- ---------- Promozioni ----------
create table public.promozioni (
  id           uuid primary key default gen_random_uuid(),
  attivita_id  uuid not null references public.attivita(id) on delete cascade,
  titolo       text not null check (char_length(titolo) between 3 and 80),
  descrizione  text check (char_length(descrizione) <= 600),
  foto_path    text,
  valida_dal   date not null default current_date,
  valida_fino  date,
  attiva       boolean not null default true,
  creato_il    timestamptz not null default now(),
  constraint promo_date_valide check (valida_fino is null or valida_fino >= valida_dal)
);
create index promozioni_attivita_idx on public.promozioni (attivita_id);

alter table public.promozioni enable row level security;

create policy "promo: lettura"
  on public.promozioni for select
  using (
    (attiva and valida_dal <= current_date and (valida_fino is null or valida_fino >= current_date)
      and exists (select 1 from public.attivita a where a.id = attivita_id and a.visibile))
    or public.is_admin() or public.is_titolare(attivita_id)
  );

create policy "promo: gestione (admin o titolare)"
  on public.promozioni for all to authenticated
  using (public.is_admin() or public.is_titolare(attivita_id))
  with check (public.is_admin() or public.is_titolare(attivita_id));

-- ---------- Comunicazioni a comparsa (pop-up all'avvio) ----------
create table public.comunicazioni (
  id         uuid primary key default gen_random_uuid(),
  titolo     text not null check (char_length(titolo) between 3 and 80),
  testo      text not null check (char_length(testo) between 1 and 1000),
  livello    text not null default 'info' check (livello in ('info', 'importante', 'urgente')),
  inizio     timestamptz not null default now(),
  fine       timestamptz,
  attiva     boolean not null default true,
  creato_da  uuid default auth.uid() references public.profiles(id) on delete set null,
  creato_il  timestamptz not null default now(),
  constraint comunicazione_date_valide check (fine is null or fine > inizio)
);

alter table public.comunicazioni enable row level security;

create policy "comunicazioni: lettura"
  on public.comunicazioni for select
  using ((attiva and inizio <= now() and (fine is null or fine > now())) or public.is_admin());

create policy "comunicazioni: gestione admin"
  on public.comunicazioni for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- Galleria foto ----------
create table public.foto (
  id          uuid primary key default gen_random_uuid(),
  autore_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  path        text not null,
  didascalia  text check (char_length(didascalia) <= 200),
  post_id     uuid references public.posts(id) on delete set null,
  stato       public.stato_post not null default 'in_attesa',
  larghezza   int,
  altezza     int,
  creato_il   timestamptz not null default now()
);
create index foto_pubbliche_idx on public.foto (creato_il desc) where stato = 'approvato';
create index foto_coda_idx on public.foto (creato_il) where stato = 'in_attesa';
create index foto_post_idx on public.foto (post_id);

create or replace function public.foto_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
  if auth.uid() is null then return new; end if;
  select * into p from public.profiles where id = auth.uid();
  if p.id is null then raise exception 'Profilo non trovato'; end if;
  if p.regolamento_accettato_il is null then raise exception 'Accetta il regolamento prima di pubblicare'; end if;
  new.autore_id := p.id;
  new.stato := case when p.ruolo = 'admin' or p.fidato then 'approvato'::public.stato_post else 'in_attesa'::public.stato_post end;
  return new;
end; $$;

create trigger foto_before_insert
  before insert on public.foto
  for each row execute function public.foto_before_insert();

create or replace function public.foto_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.stato     := old.stato;
    new.autore_id := old.autore_id;
    new.path      := old.path;
  end if;
  return new;
end; $$;

create trigger foto_before_update
  before update on public.foto
  for each row execute function public.foto_before_update();

alter table public.foto enable row level security;

create policy "foto: lettura"
  on public.foto for select
  using (stato = 'approvato' or autore_id = auth.uid() or public.is_admin());

create policy "foto: caricamento"
  on public.foto for insert to authenticated
  with check (autore_id = auth.uid());

create policy "foto: modifica (autore in attesa o admin)"
  on public.foto for update to authenticated
  using ((autore_id = auth.uid() and stato = 'in_attesa') or public.is_admin())
  with check ((autore_id = auth.uid()) or public.is_admin());

create policy "foto: eliminazione (autore o admin)"
  on public.foto for delete to authenticated
  using (autore_id = auth.uid() or public.is_admin());

create view public.galleria_pubblica with (security_invoker = true) as
  select f.id, f.path, f.didascalia, f.post_id, f.larghezza, f.altezza, f.creato_il,
         coalesce(pr.nome_visualizzato, 'Residente') as autore
  from public.foto f
  left join public.profiles pr on pr.id = f.autore_id
  where f.stato = 'approvato';

grant select on public.galleria_pubblica to anon, authenticated;

-- ---------- Immagini: massimo 5 MB, solo foto ----------
-- (l'app comprime già le immagini prima di caricarle: di solito restano sotto i 400 KB)
update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'foto-post';
