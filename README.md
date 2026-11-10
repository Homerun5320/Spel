# Bildgenerator

Genererar bilder från text (och från andra bilder) med öppna bildmodeller via 🤗 diffusers.

Webbsida: https://homerun5320.github.io/Spel/ (källa i `docs/`, publiceras av `.github/workflows/pages.yml`).

## Modeller

| `--modell` | Kvalitet | Steg | Minne | Licens* |
|---|---|---|---|---|
| `z-image-turbo` | hög, bra på text i bild | 8 | 24 GB VRAM, eller 14 GB+ med avlastning (kräver ca 24 GB RAM) | Apache-2.0 |
| `flux-schnell` | hög | 4 | 40 GB VRAM, eller 24 GB+ med avlastning (ca 32 GB RAM) | Apache-2.0 |
| `sd15` | enkel | 30 | 4–6 GB VRAM, går även på CPU | CreativeML OpenRAIL-M |
| `auto` (standard) | väljer själv | | z-image-turbo om grafikkortet har minst 14 GB, annars sd15 | |

Eget Hugging Face-id går också (`--modell någon/modell`), men antas då vara Stable Diffusion 1.x.
Se alla med `python -m bildgenerator --lista-modeller`.

\* Licenserna är hämtade från sökresultat och diffusers dokumentation, inte från modellkorten, eftersom
de inte gick att nå när koden skrevs. Kontrollera modellkorten på Hugging Face om du ska använda bilderna
kommersiellt. Minneskraven är uppskattningar och är inte testade här.

## Installera

```bash
pip install -r requirements.txt
```

Modellen laddas ner automatiskt första gången (sd15 ca 4 GB, Z-Image-Turbo och FLUX 20 GB eller mer).
En NVIDIA-GPU rekommenderas. På CPU fungerar sd15 men det tar minuter per bild.
Om `--modell z-image-turbo` inte hittar modellen på Hugging Face, prova id:t `Z-a-o/Z-Image-Turbo`
som används i diffusers exempel.

## Använd

Webbgränssnitt:

```bash
python app.py
```

Kommandorad:

```bash
python -m bildgenerator "a red dragon flying over a snowy mountain, digital art" --antal 2
```

Välj format med `--format` (1:1, 4:3, 3:2, 16:9, 3:4, 2:3, 9:16) eller exakta mått med `--bredd` och `--höjd`.
Standard för steg och promptstyrka är det som är bäst för vald modell, så du behöver sällan ändra dem.
Negativ prompt (`-n`) används bara av `sd15`. De andra modellerna ignorerar den, så beskriv i stället vad du vill ha.

Bild till bild: ge en startbild och en prompt som beskriver hur den ska ändras.

```bash
python -m bildgenerator "the same scene at sunset, oil painting" --bild foto.jpg --förändring 0.6
```

`--förändring` (0–1) styr hur mycket startbilden får ändras: lågt håller sig nära originalet, högt följer prompten mer. Storleken tas från startbilden. I webbgränssnittet laddar du upp startbilden i fältet "Startbild".

Bilderna sparas i `bilder/` som PNG, och prompt, seed, modell och inställningar sparas i filen
(läs dem med `bildgenerator.kärna.läs_metadata`). Samma `--seed` ger samma bild.

## Tips för bra bilder

- Skriv på engelska och beskriv motiv, miljö, ljus och stil: *a weathered fisherman mending a net at dawn, low golden light, 85mm photograph, shallow depth of field*.
- Är bilden nästan rätt: behåll `--seed` och ändra bara en sak i prompten.
- Vill du ha text i bilden, sätt den inom citattecken i prompten och använd `z-image-turbo` eller `flux-schnell`.
- Tar minnet slut: lägg till `--avlasta`, eller välj `sd15`.

## Test

```bash
pip install pytest
python -m pytest tests
```

Testerna kör logiken mot en låtsas-torch och låtsas-diffusers. Själva bildgenereringen med riktiga modeller är inte provkörd.
