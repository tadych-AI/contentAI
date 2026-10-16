-- =====================================================================
-- ContentAI – Tadych · schemat bazy (Supabase / Postgres) · v0.3
-- Bazuje na schemacie aplikacji Schedpol. Zmiany względem niej:
--   WYPADA:   assortment (PIM), import_rules (słownik końcówek SKU), kb_documents,
--             images (nieużywana), technologies/series w rodzinach
--   ZMIANA:   products – pełne dane z BaseLinkera (opis PL, parametry, kategoria, bundle)
--             kb_facts – fakty wyciągane z opisu i parametrów BL, poziomy: marka/kategoria/rodzina/produkt
--             product_families – rodziny jako PROPOZYCJE do zatwierdzenia (reguła łączenia do ustalenia)
--             templates – klucz: kanał + kategoria (marka opcjonalna)
--             bl_param_map – źródła z BL (parametr / pole dodatkowe) zamiast kolumn PIM
--   NOWE:     bl_categories, bl_manufacturers, emag_categories, emag_characteristics,
--             category_map (kategoria BL → kategoria eMAG), product_characteristics
-- Uruchamiać na czystym projekcie Supabase (SQL Editor), w całości.
-- =====================================================================

create extension if not exists pg_trgm;

-- ---------- typy ----------
create type user_role   as enum ('generujacy', 'akceptujacy', 'admin');
create type job_status  as enum ('w_kolejce', 'w_toku', 'gotowe', 'blad');
create type desc_status as enum ('do_generacji', 'generowanie', 'do_weryfikacji', 'poprawki', 'zaakceptowany', 'odrzucony', 'opublikowany', 'blad');
create type fact_status as enum ('do_akceptacji', 'zatwierdzony', 'odrzucony');
create type fact_level  as enum ('marka', 'kategoria', 'rodzina', 'produkt');
create type review_status as enum ('propozycja', 'zatwierdzone', 'odrzucone');

-- ---------- wspólne ----------
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------- użytkownicy ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role user_role not null default 'generujacy',
  created_at timestamptz not null default now()
);

-- rola zalogowanego użytkownika (do polityk RLS)
create or replace function public.my_role() returns user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- nowe konto → profil z rolą domyślną
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.profiles (id, email) values (new.id, new.email) on conflict do nothing; return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------- słowniki z BaseLinkera ----------
create table public.bl_categories (              -- getInventoryCategories
  bl_category_id bigint primary key,
  name text not null,
  parent_id bigint,                              -- 0/null = korzeń
  path text,                                     -- „Łazienka > Baterie > Umywalkowe” (wyliczane przy imporcie)
  synced_at timestamptz not null default now()
);

create table public.bl_manufacturers (           -- getInventoryManufacturers
  bl_manufacturer_id bigint primary key,
  name text not null,
  synced_at timestamptz not null default now()
);

create table public.brands (                     -- marka = producent z BL (lub ręcznie)
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  bl_manufacturer_id bigint unique references public.bl_manufacturers(bl_manufacturer_id),
  default_style jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ---------- kanały i szablony ----------
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                     -- np. emag_hu
  marketplace text not null,                     -- eMAG
  language text not null,                        -- hu
  baselinker_source_id text,                     -- np. emag_12345 (z getInventoryIntegrations)
  bl_text_lang text,
  bl_name_field text not null default 'name',
  bl_desc_field text not null default 'description',
  bl_features_field text not null default 'features',   -- parametry integracji: features|hu|<source_id>
  marketplace_platform text,                     -- dla API marketplace'u (eMAG: hu / ro / bg)
  limits jsonb not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id),
  bl_category_id bigint references public.bl_categories(bl_category_id),  -- null = szablon domyślny kanału
  brand_id uuid references public.brands(id),                             -- null = dla wszystkich marek
  name text not null,
  sections jsonb not null default '[]',
  styles jsonb not null default '{}',
  version integer not null default 1,
  status text not null default 'szkic' check (status in ('szkic', 'aktywny', 'archiwalny')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- produkty i rodziny ----------
create table public.product_families (
  id uuid primary key default gen_random_uuid(),
  name text not null,                            -- nazwa rodziny (nazwa produktu bez wymiaru/koloru)
  brand_id uuid references public.brands(id),
  bl_category_id bigint references public.bl_categories(bl_category_id),
  lead_product_id uuid,                          -- FK dodany niżej (cykl z products)
  status review_status not null default 'propozycja',
  grouping jsonb not null default '{}',          -- na jakiej podstawie zaproponowano grupę: { rule, signals, score }
  varying_attributes text[] not null default '{}',  -- parametry różniące warianty (np. {Szerokość, Kolor})
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  baselinker_product_id bigint not null unique,
  sku text not null unique,
  ean text,
  name text not null,                            -- text_fields.name (PL)
  description_pl text,                           -- text_fields.description (źródło faktów)
  description_extra jsonb not null default '{}', -- description_extra1..4, jeśli używane
  features jsonb not null default '{}',          -- text_fields.features (PL): { nazwa: wartość }
  extra_fields jsonb not null default '{}',      -- extra_field_X: { id: wartość }
  bl_category_id bigint references public.bl_categories(bl_category_id),
  brand_id uuid references public.brands(id),
  bl_parent_id bigint,                           -- produkt nadrzędny w BL (warianty BL), jeśli jest
  is_bundle boolean not null default false,
  bundle_items jsonb not null default '[]',      -- [{ bl_id, sku, name, quantity }] – kontekst, nie źródło faktów
  family_id uuid references public.product_families(id),
  images jsonb not null default '[]',            -- [{ url, position, role }]
  weight numeric,
  dimensions jsonb,                              -- { height, width, length }
  source_hash text,                              -- skrót danych źródłowych → wykrywanie zmian w BL
  import_flags jsonb not null default '[]',
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_category_idx on public.products (bl_category_id);
create index products_family_idx on public.products (family_id);
create trigger products_touch before update on public.products for each row execute function public.touch_updated_at();

alter table public.product_families
  add constraint product_families_lead_fk foreign key (lead_product_id) references public.products(id) on delete set null;

-- ---------- fakty (źródło prawdy dla generacji) ----------
create table public.kb_facts (
  id uuid primary key default gen_random_uuid(),
  content text not null,                         -- jedno zdanie po polsku
  level fact_level not null default 'produkt',
  product_id uuid references public.products(id) on delete cascade,
  family_id uuid references public.product_families(id) on delete cascade,
  bl_category_id bigint references public.bl_categories(bl_category_id),
  brand_id uuid references public.brands(id),
  source text not null default 'bl_opis' check (source in ('bl_opis', 'bl_parametry', 'reczny')),
  source_excerpt text,                           -- fragment opisu, z którego pochodzi fakt
  source_hash text,                              -- hash opisu w chwili ekstrakcji → „opis w BL się zmienił”
  flags jsonb not null default '[]',             -- np. WYMAGA ŹRÓDŁA, claim środowiskowy
  status fact_status not null default 'do_akceptacji',
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (level = 'produkt'   and product_id is not null) or
    (level = 'rodzina'   and family_id is not null) or
    (level = 'kategoria' and bl_category_id is not null) or
    (level = 'marka'     and brand_id is not null)
  )
);
create index kb_facts_product_idx on public.kb_facts (product_id);
create index kb_facts_family_idx on public.kb_facts (family_id);

-- ---------- frazy ----------
create table public.keyword_banks (
  id uuid primary key default gen_random_uuid(),
  bl_category_id bigint references public.bl_categories(bl_category_id),
  category text not null,                        -- etykieta banku (np. ścieżka kategorii)
  language text not null,
  location_code integer,
  seeds text[] not null default '{}',
  seeds_verified boolean not null default false,
  keywords jsonb not null default '[]',
  excluded text[] not null default '{}',
  min_volume integer not null default 10,
  refreshed_at timestamptz,
  unique (category, language)
);

-- ---------- opisy ----------
create table public.descriptions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  family_id uuid references public.product_families(id),   -- null = produkt bez rodziny / bundle
  channel_id uuid not null references public.channels(id),
  template_id uuid references public.templates(id),
  is_base boolean not null default false,
  parent_id uuid references public.descriptions(id),
  version integer not null default 1,
  fields jsonb not null default '{}',
  html text,
  translation_pl jsonb,
  qa jsonb,
  meta jsonb,
  status desc_status not null default 'do_generacji',
  publish_error text,
  created_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index descriptions_product_channel_idx on public.descriptions (product_id, channel_id);
create trigger descriptions_touch before update on public.descriptions for each row execute function public.touch_updated_at();

create table public.review_comments (
  id uuid primary key default gen_random_uuid(),
  description_id uuid not null references public.descriptions(id) on delete cascade,
  section_key text,
  content text not null,
  make_rule boolean not null default false,
  status text not null default 'otwarta' check (status in ('otwarta', 'uwzgledniona')),
  author uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.qa_rules (
  id uuid primary key default gen_random_uuid(),
  rule_type text not null check (rule_type in ('zakazany_wzorzec', 'marka_konkurencji', 'limit', 'instrukcja')),
  pattern text not null,
  language text,
  source_comment_id uuid references public.review_comments(id) on delete set null,
  status text not null default 'propozycja' check (status in ('propozycja', 'aktywna', 'wylaczona')),
  created_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- parametry Base (features|hu) ----------
create table public.bl_param_map (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,                     -- nazwa parametru w Base (PL)
  sort integer not null default 0,
  source text not null default 'bl_parametr' check (source in ('bl_parametr', 'bl_pole_dodatkowe', 'atrybut', 'nazwa', 'stala', 'frazy', 'pomin')),
  source_key text,                               -- nazwa parametru w BL / ID pola dodatkowego
  fallback_key text,
  attr_key text,
  regex text,
  const_value text,
  transform text not null default 'tekst' check (transform in ('tekst', 'liczba', 'liczba_pl')),
  value_map text,
  suffix text,
  default_value text,
  kw_lang text,
  kw_count integer,
  only_categories bigint[],                      -- ograniczenie do kategorii BL
  translate boolean not null default true,
  note text,
  updated_at timestamptz not null default now()
);

create table public.bl_param_names (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.bl_param_map(id) on delete cascade,
  lang text not null check (lang ~ '^[a-z]{2}$'),
  name text not null,
  status text not null default 'propozycja' check (status in ('propozycja', 'zatwierdzone')),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (map_id, lang)
);

create table public.bl_value_translations (
  id uuid primary key default gen_random_uuid(),
  lang text not null check (lang ~ '^[a-z]{2}$'),
  source text not null,
  target text not null,
  status text not null default 'propozycja' check (status in ('propozycja', 'zatwierdzone')),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (lang, source)
);

-- ---------- eMAG: kategorie i characteristics ----------
create table public.emag_categories (            -- API eMAG: category/read
  platform text not null,                        -- hu
  emag_category_id bigint not null,
  name text not null,
  parent_id bigint,
  is_allowed boolean not null default true,      -- czy sprzedawca może w niej wystawiać
  synced_at timestamptz not null default now(),
  primary key (platform, emag_category_id)
);

create table public.emag_characteristics (       -- characteristics z category/read
  platform text not null,
  emag_category_id bigint not null,
  characteristic_id bigint not null,
  name text not null,                            -- nazwa po węgiersku, dokładnie jak w eMAG
  type_id integer,                               -- typ wartości wg eMAG (liczba, tekst, lista…)
  is_mandatory boolean not null default false,
  is_filter boolean not null default false,
  allow_new_value boolean not null default true,
  values jsonb not null default '[]',            -- dozwolone wartości (słownik eMAG)
  tags jsonb not null default '[]',
  synced_at timestamptz not null default now(),
  primary key (platform, emag_category_id, characteristic_id),
  foreign key (platform, emag_category_id) references public.emag_categories(platform, emag_category_id) on delete cascade
);

create table public.category_map (               -- kategoria BL → kategoria marketplace'u w kanale
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id),
  bl_category_id bigint not null references public.bl_categories(bl_category_id),
  marketplace_category_id bigint not null,
  status review_status not null default 'propozycja',   -- AI proponuje, człowiek zatwierdza
  note text,
  approved_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (channel_id, bl_category_id)
);

create table public.product_characteristics (    -- wartości characteristics dla produktu w kanale
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  channel_id uuid not null references public.channels(id),
  marketplace_category_id bigint not null,
  values jsonb not null default '{}',            -- { characteristic_id: { name, value, origin, confidence } }
  missing_mandatory text[] not null default '{}',
  qa jsonb,
  status desc_status not null default 'do_generacji',
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  published_at timestamptz,
  publish_error text,
  updated_at timestamptz not null default now(),
  unique (product_id, channel_id)
);
create trigger product_characteristics_touch before update on public.product_characteristics for each row execute function public.touch_updated_at();

-- ---------- grafiki marki (opcjonalnie) ----------
create table public.media_library (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references public.brands(id),
  scope text not null check (scope in ('marka', 'kategoria', 'rodzina')),
  scope_value text,
  role text not null,
  url text not null,
  alt_hint text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- zadania, katalog, audyt ----------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  payload jsonb not null default '{}',
  status job_status not null default 'w_kolejce',
  result jsonb,
  error text,
  cost jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger jobs_touch before update on public.jobs for each row execute function public.touch_updated_at();

-- lekki indeks CAŁEGO katalogu BL (25 tys.+) do wyboru, co importować; pełne dane tylko dla wybranych (products)
create table public.bl_catalog (
  bl_id bigint primary key,
  parent_id bigint,                              -- produkt nadrzędny (warianty BL)
  sku text,
  ean text,
  name text,
  bl_category_id bigint,
  bl_manufacturer_id bigint,
  is_bundle boolean not null default false,
  tags text[] not null default '{}',
  batch_id uuid not null,                        -- przebieg synchronizacji listy (wiersze spoza ostatniego = usunięte w BL)
  synced_at timestamptz not null default now(),
  enriched_at timestamptz                        -- kiedy dociągnięto kategorię i producenta (getInventoryProductsData)
);
create index bl_catalog_manufacturer_idx on public.bl_catalog (bl_manufacturer_id);
create index bl_catalog_category_idx on public.bl_catalog (bl_category_id);
create index bl_catalog_name_trgm_idx on public.bl_catalog using gin (lower(name) gin_trgm_ops);

-- zapisane zestawy wyboru (np. „Besco – wanny”), żeby ponawiać import i dociągać nowe SKU
create table public.import_selections (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  filters jsonb not null default '{}',           -- { manufacturer_ids, category_ids, keywords, exclude_keywords, tags }
  created_by uuid references public.profiles(id),
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id bigserial primary key,
  actor uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- RLS: odczyt dla zalogowanych; zapis wg ról. n8n pisze kluczem secret (omija RLS).
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['profiles','bl_categories','bl_manufacturers','brands','channels','templates','product_families','products',
    'kb_facts','keyword_banks','descriptions','review_comments','qa_rules','bl_param_map','bl_param_names','bl_value_translations',
    'emag_categories','emag_characteristics','category_map','product_characteristics','media_library','jobs','bl_catalog','import_selections','audit_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
  end loop;
end $$;

-- praca redakcyjna (każdy zalogowany): produkty, rodziny-propozycje, fakty-propozycje, opisy, komentarze, characteristics
do $$
declare t text;
begin
  foreach t in array array['products','product_families','kb_facts','descriptions','review_comments','product_characteristics','keyword_banks','import_selections']
  loop
    execute format('create policy %I on public.%I for insert to authenticated with check (true)', t || '_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (true) with check (true)', t || '_upd', t);
  end loop;
end $$;

-- konfiguracja: akceptujący i admin
do $$
declare t text;
begin
  foreach t in array array['templates','qa_rules','bl_param_map','bl_param_names','bl_value_translations','category_map','media_library','brands']
  loop
    execute format($p$create policy %I on public.%I for all to authenticated using (public.my_role() in ('akceptujacy','admin')) with check (public.my_role() in ('akceptujacy','admin'))$p$, t || '_cfg', t);
  end loop;
end $$;

-- kanały i role użytkowników: tylko admin
create policy channels_admin on public.channels for all to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
create policy profiles_admin on public.profiles for update to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- zadania: każdy zleca własne
create policy jobs_ins on public.jobs for insert to authenticated with check (created_by = auth.uid());

-- akceptacja faktów, rodzin i opisów tylko przez akceptującego/admina (blokada na poziomie bazy)
create or replace function public.guard_approval() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- n8n (klucz secret)
  if public.my_role() in ('akceptujacy', 'admin') then return new; end if;
  if (tg_table_name = 'kb_facts' and new.status is distinct from old.status and new.status <> 'do_akceptacji')
     or (tg_table_name = 'product_families' and new.status is distinct from old.status and new.status <> 'propozycja')
     or (tg_table_name in ('descriptions', 'product_characteristics') and new.status is distinct from old.status and new.status in ('zaakceptowany', 'opublikowany'))
  then raise exception 'Akceptować może tylko akceptujący lub admin'; end if;
  return new;
end $$;
create trigger kb_facts_guard before update on public.kb_facts for each row execute function public.guard_approval();
create trigger families_guard before update on public.product_families for each row execute function public.guard_approval();
create trigger descriptions_guard before update on public.descriptions for each row execute function public.guard_approval();
create trigger characteristics_guard before update on public.product_characteristics for each row execute function public.guard_approval();

-- ---------- dane startowe ----------
insert into public.channels (code, marketplace, language, marketplace_platform, bl_text_lang, limits)
values ('emag_hu', 'eMAG', 'hu', 'hu', 'hu', '{"title_max": 200}');
