# TadychAI · ContentStudio

Aplikacja do przygotowania opisów i atrybutów produktów na marketplace (start: eMAG.hu) na podstawie danych z Baselinkera.

- Frontend: React + Vite, hosting GitHub Pages (wdrożenie automatyczne po każdej zmianie w gałęzi `main`)
- Baza i logowanie: Supabase (projekt `nyivgmimhwlhavdkgnzg`)
- Silnik zadań: n8n (Baselinker, później Gemini, DataForSEO, API eMAG)

Adres po wdrożeniu: https://tadych-ai.github.io/contentAI/

## Co działa

- logowanie, role (generujący, akceptujący, admin), zmiana hasła; panel użytkowników (admin): dodawanie i usuwanie kont, nadawanie ról, ustawianie haseł – przez funkcje w bazie (hasło nie trafia do n8n ani do tabel aplikacji),
- **Katalog Baselinkera**: lekki indeks całego katalogu (25 tys.+ produktów: SKU, EAN, nazwa, kategoria, producent, warianty, bundle), filtr wyboru (marka = producent w BL lub marka w nazwie, kategoria z podkategoriami, słowa kluczowe, słowa wykluczające, rodzaj produktu), zapisane zestawy wyboru, import zaznaczonych,
- **Produkty w aplikacji**: pełne dane z BL (opis, parametry, pola dodatkowe, zdjęcia, skład zestawu) i uwagi do jakości danych (brak opisu/parametrów/EAN, waga zastępcza, powtórzony EAN, brak kategorii lub producenta),
- **Rodziny produktów**: propozycje grupowania wariantów (marka + kategoria + nazwa modelu bez wymiarów, kolorów i strony; warianty z BL zawsze razem), zatwierdzanie, wariant wiodący, łączenie i rozdzielanie,
- **Fakty** (na rodzinę): Gemini (Vertex AI) wyciąga z opisu wariantu wiodącego i różnic pozostałych wariantów sprawdzalne fakty na trzech poziomach – marka (zatwierdzana raz), rodzina (wszystkie warianty), wariant (wskazane SKU); flagi: wymaga źródła, claim biobójczy, claim środowiskowy, nieaktualna norma, superlatyw, promocja sklepu, liczba spoza opisu, sprzeczność z parametrem. Akceptacja pojedynczo lub masowo, edycja treści, przeniesienie faktu na poziom marki.
- **Opisy** (eMAG HU): bank fraz z DataForSEO per kategoria BL, szablony sekcji z grafikami (zdjęcia z BL wg pozycji), generacja opisu bazowego rodziny w 3 krokach (mapa fraz → treść → tłumaczenie kontrolne na PL), QA (liczby spoza faktów, zakazane sformułowania, informacje o ofercie, CAPS, limity), weryfikacja z poprawą wybranych sekcji, opisy wariantów jako adaptacja zaakceptowanego opisu bazowego.
- **Grafiki**: biblioteka grafik na serwerze (Supabase Storage, publiczne adresy) z marką, rolą i tagami; w szablonach opisów grafika wybrana z biblioteki albo „grafika marki wg roli” (każda rodzina dostaje grafikę swojej marki),
- **Zestawy**: dane składników (nazwa, parametry, opis) pobierane z BL przy imporcie i używane w faktach i opisach; gratisy (np. ręcznik) rozpoznawane automatycznie lub zaznaczane ręcznie i podkreślane w opisie,
- **Tytuły eMAG**: wzór tytułu per kategoria BL (kolejność elementów, separatory, maks. długość), Gemini ustala elementy po węgiersku, aplikacja składa i skraca tytuł, edycja ręczna i zatwierdzanie hurtowe,
- **Eksport eMAG**: wgrywanie oryginalnych szablonów importu eMAG (create-product, update-product, update-product-family) per kategoria, charakterystyki wariantów (dane z BL dopasowane do słowników eMAG – kolor, typ, materiał, wymiary, pojemność – i uzupełnione przez Gemini; edycja w siatce, zatwierdzanie), nazwa i typ rodziny eMAG (dobierany automatycznie), generowanie pliku XLSX do importu w eMAG Marketplace. Marka w pliku: Aqua 4 You (ustawienie kanału `export_brand`), tytuł z modułu Tytuły. Domyślnie: stan 1 szt., czas wysyłki 2 dni, gwarancja z BL; ceny, VAT i GPSR puste.

## Uruchomienie

### 1. Supabase
1. SQL Editor → wklej i uruchom całość pliku `001_schema.sql` (na czystym projekcie), potem kolejno `002_fakty.sql`, `003_rodziny.sql`, `004_opisy.sql`, `005_emag.sql`, `006_grafiki.sql`, `007_tytuly_zestawy.sql`, `008_tytuly_pl.sql`, `009_uzytkownicy.sql`, `010_rodziny_grafiki.sql`, `011_szablon_wizytowka.sql`, `012_rodziny_emag.sql`, `013_usuwanie_opisow.sql`, `014_bledy_zadan.sql`.
2. Pierwsze konto: Authentication → Users → Add user (zaznacz „Auto Confirm User”). Kolejne konta dodaje admin w aplikacji (Konfiguracja → Użytkownicy).
3. Pierwszemu adminowi nadaj rolę w SQL Editor: `update profiles set role = 'admin' where email = 'twoj@email';`
4. Project Settings → API Keys: skopiuj klucz **publishable/anon** (do aplikacji) i **secret** (tylko do n8n).

### 2. n8n
1. Import workflow z pliku `contentai-zadania-v7.json` (zastępuje poprzednią wersję – wyłącz i usuń starą wersję, żeby nie dublować webhooka).
2. Credentiale (Header Auth):
   - **Supabase apikey (secret)**: Name `apikey`, Value = klucz `sb_secret_…`,
   - **Baselinker X-BLToken**: Name `X-BLToken`, Value = token API Baselinkera (na etap 1 wystarczy odczyt katalogu),
   - **Vertex x-goog-api-key**: Name `x-goog-api-key`, Value = klucz API Vertex AI (Google Cloud, express mode),
   - **DataForSEO** (Basic Auth): login i hasło API DataForSEO.
3. Przypisz credentiale we wszystkich węzłach HTTP (po imporcie są oznaczone jako brakujące).
4. Węzeł **KONFIGURACJA**: wpisz `BASELINKER_INVENTORY_ID`; model Gemini ustawiasz w `VERTEX.model`.
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
Schemat bazy (`001_schema.sql`, `002_fakty.sql`, `003_rodziny.sql`) i workflow n8n (`contentai-zadania-v7.json`) są utrzymywane poza repozytorium aplikacji.
