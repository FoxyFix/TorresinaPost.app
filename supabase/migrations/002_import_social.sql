-- =====================================================================
-- Torresina: import dai social (Instagram, Pagina Facebook, Telegram,
-- condivisione dal telefono). Eseguire DOPO 001_schema.sql.
-- =====================================================================

create type public.fonte_post as enum ('app', 'instagram', 'facebook_pagina', 'telegram', 'condivisione');

alter table public.posts
  add column fonte           public.fonte_post not null default 'app',
  add column fonte_id        text,          -- id del post sul social, per non importarlo due volte
  add column fonte_url       text,          -- link al post originale
  add column fonte_autore    text,          -- solo handle pubblici (@utente, nome Pagina)
  add column testo_originale text,          -- visto solo dall'admin, cancellato all'approvazione
  add column confidenza_ai   real;          -- quanto l'AI è sicura dei campi estratti (0-1)

-- I post importati non hanno un account dell'app come autore
alter table public.posts alter column autore_id drop not null;
alter table public.posts add constraint autore_o_fonte check (autore_id is not null or fonte <> 'app');

create unique index posts_fonte_unica on public.posts (fonte, fonte_id) where fonte_id is not null;

-- Un post importato può arrivare senza data o luogo: l'admin li completa
-- prima di approvarlo. Il vincolo vale quindi solo per i post approvati.
alter table public.posts drop constraint evento_ha_data, drop constraint evento_ha_luogo;
alter table public.posts
  add constraint evento_ha_data  check (tipo <> 'evento' or stato <> 'approvato' or inizio is not null),
  add constraint evento_ha_luogo check (tipo <> 'evento' or stato <> 'approvato' or luogo   is not null);

-- All'approvazione il testo originale viene cancellato (privacy)
create or replace function public.posts_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
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

  new.autore_id       := old.autore_id;
  new.stato           := old.stato;
  new.approvato_da    := old.approvato_da;
  new.approvato_il    := old.approvato_il;
  new.motivo_rifiuto  := old.motivo_rifiuto;
  new.fonte           := old.fonte;
  new.fonte_id        := old.fonte_id;
  new.testo_originale := old.testo_originale;
  return new;
end; $$;

-- Viste pubbliche: ora includono anche i post importati
drop view public.eventi_pubblici;
drop view public.avvisi_pubblici;

create view public.eventi_pubblici with (security_invoker = true) as
  select p.id, p.titolo, p.descrizione, p.inizio, p.fine, p.luogo, p.indirizzo,
         p.lat, p.lng, p.foto_path, p.fonte, p.fonte_url,
         coalesce(pr.nome_visualizzato, p.fonte_autore,
                  case p.fonte when 'telegram' then 'Dal gruppo Telegram'
                               when 'facebook_pagina' then 'Dalla Pagina Facebook'
                               else 'Dai social' end) as autore
  from public.posts p
  left join public.profiles pr on pr.id = p.autore_id
  where p.tipo = 'evento' and p.stato = 'approvato';

create view public.avvisi_pubblici with (security_invoker = true) as
  select p.id, p.titolo, p.descrizione, p.urgente, p.luogo, p.indirizzo,
         p.lat, p.lng, p.foto_path, p.creato_il, p.fonte, p.fonte_url,
         coalesce(pr.nome_visualizzato, p.fonte_autore,
                  case p.fonte when 'telegram' then 'Dal gruppo Telegram'
                               when 'facebook_pagina' then 'Dalla Pagina Facebook'
                               else 'Dai social' end) as autore
  from public.posts p
  left join public.profiles pr on pr.id = p.autore_id
  where p.tipo = 'avviso' and p.stato = 'approvato';

grant select on public.eventi_pubblici, public.avvisi_pubblici to anon, authenticated;
