# Collage

Edytor kolaży zdjęć działający w przeglądarce (telefon i komputer), z domyślnym formatem **A4 do wydruku**.

## Funkcje

- **Krawędzie** – płynne przesuwanie linii podziału (myszą i palcem):
  - wyrównane krawędzie przesuwają się razem jak w tabeli (Alt lub odznaczenie opcji – pojedynczo),
  - magnetyczne przyciąganie do innych krawędzi i środka (Shift – bez przyciągania),
  - komórka nigdy nie „zapada się” (minimalny rozmiar 12 mm),
  - **dwuklik / podwójne stuknięcie na krawędzi** obraca podział: obok siebie ↔ jedno pod drugim.
- **Kadr** – przesuwanie zdjęcia w komórce, przybliżanie (szczypanie, kółko myszy – względem kursora), obrót o 90°, zamiana zdjęć między komórkami, usuwanie komórek, puste komórki „+ Dodaj zdjęcie”.
- **Warstwy** – zdjęcia swobodne nad układem: przesuwanie, skalowanie i obrót (uchwyty lub dwa palce), kolejność warstw, biała ramka, cień.
- Formaty: A4 (domyślny), A3, A5, 10×15, 13×18, 1:1, 4:5, 9:16 – pion/poziom.
- Eksport: **PDF w rozmiarze strony**, PNG, JPG (150/300 DPI), drukowanie, udostępnianie.
- Cofnij/ponów (Ctrl+Z, Ctrl+Shift+Z), skróty klawiszowe dla warstw (strzałki, Delete).

Cała geometria liczona jest w milimetrach strony, więc podgląd i eksport są identyczne niezależnie od rozdzielczości.

## Wersja online

Aplikacja jest publikowana na GitHub Pages pod adresem https://grzegorzka.github.io/collage/
po każdym pushu do `main` (workflow `.github/workflows/pages.yml`).

Jednorazowa konfiguracja: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Szablony

Zakładka **Szablony**: galeria wbudowanych i własnych układów (najpierw te pasujące do liczby zdjęć).

- **Zastosuj** – stuknij miniaturę; zdjęcia trafiają do miejsc po kolei (Cofnij przywraca).
- **Zapisz bieżący jako szablon** – układ, warstwy i styl bez zdjęć.
- **Eksport / import** – szablony to zwykłe pliki `*.collage-template.json` (pojedynczy szablon lub paczka
  `collage-template-pack`), które można kopiować między urządzeniami. Import odrzuca błędne pliki i duplikaty.

Format (wersja 1) – geometria względna, pasuje do każdego formatu strony:

```json
{
  "type": "collage-template", "version": 1, "name": "Duże + dwa", "slots": 3,
  "page": { "orientation": "portrait" },
  "style": { "gapMm": 4, "radiusMm": 1.5, "background": "#ffffff" },
  "layout": { "split": "h", "ratio": 0.62, "first": { "slot": 0 },
              "second": { "split": "v", "ratio": 0.5, "first": { "slot": 1 }, "second": { "slot": 2 } } },
  "layers": [{ "slot": 3, "cx": 0.7, "cy": 0.3, "size": 0.35, "rotation": -6, "frame": true, "shadow": true }]
}
```

Wbudowane szablony: `src/templates/builtin.collage-template.json` (ten sam format). Logika: `src/core/templates.ts`.

## Aplikacja na telefonie (PWA)

Collage można zainstalować jak aplikację:

- **Android (Chrome, Samsung Internet)** – na stronie pojawia się pasek „Zainstaluj Collage”.
- **iPhone / iPad (Safari)** – pasek podpowiada: *Udostępnij → Do ekranu początkowego*.

Po instalacji aplikacja działa też bez internetu. Nowa wersja (każde scalenie do `main`)
pobiera się w tle, a aplikacja pokazuje pasek **„Dostępna nowa wersja – Odśwież”** –
nic nie przeładowuje się samo w trakcie pracy.

Technicznie: `public/manifest.webmanifest`, ikony w `public/icons/`, service worker
generowany przy buildzie z `src/sw-template.js` (wersja = hash opublikowanych plików),
logika instalacji i aktualizacji w `src/pwa.ts`.

## Plik projektu `.collage`

**Zapisz → Projekt → „Zapisz projekt (.collage)”** zapisuje cały kolaż ze zdjęciami w jednym pliku
(na telefonie przez *Udostępnij*); **„Otwórz projekt…”** wczytuje go na dowolnym urządzeniu (Cofnij wraca).

Plik to archiwum ZIP:

```
project.json            dokument + lista zdjęć
photos/<sha256>.<ext>   każde zdjęcie raz, nazwane skrótem treści
```

Ścieżki w `project.json` są względne wobec korzenia archiwum (zawsze `/`), np.
`"path": "photos/3fa9…c2.jpg"`. Nic nie wskazuje poza plik, więc projekt można kopiować i wysyłać.
Przy otwieraniu: akceptowane są tylko ścieżki `photos/<hash>.<ext>`, zgodność treści z hashem jest
sprawdzana, a brakujące lub uszkodzone zdjęcie zostawia pustą komórkę zamiast psuć cały projekt.
Archiwum spakowane ponownie przez system (kompresja deflate) też się otworzy.
Kod: `src/core/project.ts`, `src/core/zip.ts`, `src/core/sha256.ts`.

## Uruchomienie

```bash
npm install
npm run dev        # serwer deweloperski
npm run build      # dist/index.html – jeden samodzielny plik HTML
```

## Testy

```bash
npm run typecheck  # TypeScript
npm test           # testy jednostkowe (Vitest) – logika układu, kadrowania, warstw, PDF
npm run test:e2e   # testy E2E (Playwright) – desktop + telefon (dotyk)
npm run test:e2e:slow  # te same testy przy celowo spowolnionych klatkach (wyłapuje niestabilne testy)
npm run test:all   # wszystko
```

CI (GitHub Actions) uruchamia wszystkie testy przy każdym pushu i publikuje zbudowany `index.html` jako artefakt.

## Struktura

```
src/core/      czysta logika (bez DOM) – w pełni pokryta testami jednostkowymi
  types.ts       model dokumentu
  geometry.ts    układ, krawędzie, przeciąganie, przyciąganie, ograniczenia
  tree.ts        presety, wstawianie/usuwanie, obrót podziału, dopasowanie
  crop.ts        kadrowanie (cover, pan, zoom, obrót)
  floats.ts      warstwy swobodne
  page.ts        formaty stron, DPI
  render.ts      rysowanie na canvas (eksport)
  pdf.ts         minimalny generator PDF
  history.ts     cofnij/ponów
src/ui/        podgląd (Stage), gesty, eksport, wczytywanie zdjęć
src/main.ts    spięcie interfejsu
tests/unit/    Vitest
tests/e2e/     Playwright
```
