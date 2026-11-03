# Bildgenerator

Genererar bilder från text med Stable Diffusion (förtränad modell via 🤗 diffusers).

## Installera

```bash
pip install -r requirements.txt
```

Modellen (~4 GB) laddas ner automatiskt första gången. En NVIDIA-GPU (helst 6 GB+ VRAM) rekommenderas; på CPU fungerar det men tar minuter per bild.

## Använd

Webbgränssnitt:

```bash
python app.py
```

Kommandorad:

```bash
python -m bildgenerator "a red dragon flying over a snowy mountain, digital art" --antal 2
```

Bilderna sparas i `bilder/`. Samma `--seed` ger samma bild. Byt modell med `--modell` (t.ex. en annan Stable Diffusion 1.x-modell från Hugging Face).

Tips: engelska prompts ger oftast bäst resultat.
