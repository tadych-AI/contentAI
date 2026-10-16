# ContentAI – Tadych

Aplikacja do przygotowania opisów i atrybutów produktów na marketplace (start: eMAG.hu) na podstawie danych z Baselinkera.

- Frontend: React + Vite, hosting GitHub Pages (wdrożenie automatyczne po każdej zmianie w gałęzi `main`)
- Baza i logowanie: Supabase (projekt `nyivgmimhwlhavdkgnzg`)
- Silnik zadań: n8n (Baselinker, później Gemini, DataForSEO, API eMAG)

Adres po wdrożeniu: https://tadych-ai.github.io/contentAI/

## Etap 1 – co działa

- logowanie, role (generujący, akceptujący, admin), zmiana hasła, nadawanie ról,
- **Katalog Baselinkera**: lekki indeks całego katalogu (25 tys.+ produktów: SKU, EAN, nazwa, kategoria, producent, warianty, bundle), filtr wyboru (marka = producent w BL lub marka w nazwie, kategoria z podkategoriami, słowa kluczowe, słowa wykluczające, rodzaj produktu), zapisane zestawy wyboru, import zaznaczonych,
- **Produkty w aplikacji**: pełne dane z BL (opis, parametry, pola dodatkowe, zdjęcia, skład zestawu) i uwagi do jakości danych (brak opisu/parametrów/EAN, waga zastępcza, powtórzony EAN, brak kategorii lub producenta).

## Uruchomienie

### 1. Supabase
1. SQL Editor → wklej i uruchom całość pliku `001_schema.sql` (na czystym projekcie).
2. Authentication → Users → Add user (zaznacz „Auto Confirm User”). Profil tworzy się sam z rolą „generujący”.
3. Pierwszemu adminowi nadaj rolę w SQL Editor: `update profiles set role = 'admin' where email = 'twoj@email';`
4. Project Settings → API Keys: skopiuj klucz **publishable/anon** (do aplikacji) i **secret** (tylko do n8n).

### 2. n8n
1. Import workflow z pliku `contentai-zadania-v1.json`.
2. Credentiale (Header Auth):
   - **Supabase apikey (secret)**: Name `apikey`, Value = klucz `sb_secret_…`,
   - **Baselinker X-BLToken**: Name `X-BLToken`, Value = token API Baselinkera (na etap 1 wystarczy odczyt katalogu).
3. Przypisz credentiale we wszystkich węzłach HTTP (po imporcie są oznaczone jako brakujące).
4. Węzeł **KONFIGURACJA**: wpisz `BASELINKER_INVENTORY_ID`.
5. Włącz workflow (Active) i skopiuj **Production URL** webhooka.

### 3. GitHub
1. Settings → Pages → Source: **GitHub Actions**.
2. Settings → Secrets and variables → Actions → **Variables**:
   - `VITE_SUPABASE_ANON_KEY` = klucz publishable/anon
   - `VITE_N8N_WEBHOOK_URL` = Production URL webhooka n8n
3. Actions → „Wdrozenie na GitHub Pages” → Run workflow.

Nigdy nie umieszczaj w repozytorium klucza `secret`/`service_role` ani tokenu Baselinkera.

### 4. Pierwszy test
1. Dashboard → „Sprawdź połączenie” (ping n8n).
2. Katalog Baselinkera → „Zbuduj indeks” (akceptujący/admin; ok. 3–5 minut dla 25 tys. produktów).
3. Filtr, np. marka Besco + słowo „wanna” → zaznacz → „Importuj zaznaczone”.

## Jak działa indeks katalogu

Lista produktów w API Baselinkera nie zwraca producenta ani kategorii, a filtrować po producencie się nie da. Dlatego:
1. `bl_catalog_list` pobiera całą listę (strony po 1000), kategorie i producentów; produkty usunięte z BL znikają z indeksu (tylko gdy cała lista pobrała się poprawnie),
2. `bl_catalog_enrich` dociąga kategorię, producenta, bundle i tagi paczkami po 1000 ID (aplikacja zleca kolejne paczki i pokazuje postęp),
3. `bl_import` pobiera pełne dane tylko dla wybranych produktów.

Limit API Baselinkera: 100 zapytań na minutę – workflow robi przerwę 0,7 s między zapytaniami.

## Struktura

```
src/            aplikacja (pages/, components/, catalog.js – filtr i zlecenia, jobs.js – kolejka zadań n8n)
```
Schemat bazy (`001_schema.sql`) i workflow n8n (`contentai-zadania-v1.json`) są utrzymywane poza repozytorium aplikacji.
