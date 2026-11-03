# Kreator Kolaży

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
