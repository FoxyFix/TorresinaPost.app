-- =====================================================================
-- Torresina: i campi "fonte" dei post non si fidano più del client.
-- Eseguire DOPO 001, 002, 003 e 004 (una sola volta).
--
-- Problema risolto: un utente registrato poteva salvare in fonte_url un indirizzo
-- come "javascript:..." (anche con una chiamata diretta all'API). Il link
-- "Apri il post originale" lo avrebbe eseguito nel browser di chi lo apre, admin compresi.
--
-- 1) fonte_url può essere solo un indirizzo http/https
-- 2) i campi fonte_* (e confidenza_ai, testo_originale) li scrivono solo le funzioni sul server:
--    quando insert/update arrivano da un utente vengono azzerati o lasciati com'erano
-- =====================================================================

-- Dati esistenti non validi: eliminati prima di aggiungere il vincolo
update public.posts
   set fonte_url = null
 where fonte_url is not null
   and (char_length(fonte_url) > 500 or fonte_url !~* '^https?://[^[:space:]<>"'']+$');

alter table public.posts drop constraint if exists posts_fonte_url_http;
alter table public.posts
  add constraint posts_fonte_url_http
  check (fonte_url is null
         or (char_length(fonte_url) <= 500 and fonte_url ~* '^https?://[^[:space:]<>"'']+$'));

-- ---------- Creazione: stato deciso dal database, campi "fonte" azzerati ----------
create or replace function public.posts_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
begin
  if auth.uid() is null then          -- inserimenti da SQL Editor / service role (import dai social)
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

  -- Un utente può solo creare post "dall'app" o "condivisi dal telefono":
  -- gli altri canali (Instagram, Facebook, Telegram) entrano solo dal server.
  if new.fonte is null or new.fonte not in ('app', 'condivisione') then
    new.fonte := 'app';
  end if;
  if new.fonte = 'app' then
    new.fonte_url := null;
  end if;
  new.fonte_id        := null;
  new.fonte_autore    := null;
  new.testo_originale := null;
  new.confidenza_ai   := null;

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

-- ---------- Modifica: un autore non cambia i campi "fonte" ----------
create or replace function public.posts_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  fid boolean;
begin
  new.aggiornato_il := now();

  if auth.uid() is null or public.is_admin() then
    if new.stato = 'approvato' and old.stato <> 'approvato' then
      new.approvato_da    := auth.uid();
      new.approvato_il    := now();
      new.testo_originale := null;
    end if;
    return new;
  end if;

  -- Autore: i campi di servizio non si toccano
  new.autore_id       := old.autore_id;
  new.approvato_da    := old.approvato_da;
  new.approvato_il    := old.approvato_il;
  new.fonte           := old.fonte;
  new.fonte_id        := old.fonte_id;
  new.fonte_url       := old.fonte_url;
  new.fonte_autore    := old.fonte_autore;
  new.testo_originale := old.testo_originale;
  new.confidenza_ai   := old.confidenza_ai;

  select fidato into fid from public.profiles where id = auth.uid();

  if old.stato = 'rifiutato'
     or (old.stato = 'approvato' and not coalesce(fid, false)) then
    new.stato          := 'in_attesa';
    new.motivo_rifiuto := null;
  else
    new.stato          := old.stato;
    new.motivo_rifiuto := old.motivo_rifiuto;
  end if;
  return new;
end; $$;
