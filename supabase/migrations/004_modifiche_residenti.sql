-- =====================================================================
-- Torresina: i residenti possono modificare ed eliminare i propri
-- contenuti (eventi, avvisi, foto) anche dopo la pubblicazione.
-- Eseguire DOPO 001, 002 e 003.
--
-- Regole:
-- - Admin: modificano tutto, lo stato resta quello che scelgono loro.
-- - Residente fidato: la modifica di un contenuto pubblicato resta pubblicata.
-- - Residente normale: la modifica di un contenuto pubblicato torna "in attesa"
--   (così non si può far approvare un testo e poi cambiarlo).
-- - Contenuto rifiutato e poi corretto dall'autore: torna "in attesa".
-- =====================================================================

-- ---------- Post (eventi e avvisi) ----------
drop policy "post: l'autore modifica finché è in attesa" on public.posts;

create policy "post: l'autore modifica i suoi"
  on public.posts for update to authenticated
  using (autore_id = auth.uid())
  with check (autore_id = auth.uid());

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
  new.testo_originale := old.testo_originale;

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

-- ---------- Foto della galleria ----------
drop policy "foto: modifica (autore in attesa o admin)" on public.foto;

create policy "foto: modifica (autore o admin)"
  on public.foto for update to authenticated
  using (autore_id = auth.uid() or public.is_admin())
  with check (autore_id = auth.uid() or public.is_admin());

create or replace function public.foto_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  fid boolean;
begin
  if auth.uid() is null or public.is_admin() then return new; end if;

  new.autore_id := old.autore_id;
  new.path      := old.path;   -- per cambiare l'immagine si elimina e si ricarica

  select fidato into fid from public.profiles where id = auth.uid();

  if old.stato = 'rifiutato'
     or (old.stato = 'approvato' and not coalesce(fid, false)
         and (new.didascalia is distinct from old.didascalia or new.post_id is distinct from old.post_id)) then
    new.stato := 'in_attesa';
  else
    new.stato := old.stato;
  end if;
  return new;
end; $$;

-- L'eliminazione dei propri post e delle proprie foto era già consentita (001 e 003).
