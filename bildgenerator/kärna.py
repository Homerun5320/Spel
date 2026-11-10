"""Kärnan: laddar en förtränad Stable Diffusion-modell och genererar bilder."""
from __future__ import annotations

import re
import time
from pathlib import Path

STANDARDMODELL = "stable-diffusion-v1-5/stable-diffusion-v1-5"


def välj_enhet() -> str:
    """Välj bästa tillgängliga enhet: cuda > mps > cpu."""
    import torch

    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def anpassa_storlek(bild, max_sida: int = 768):
    """Skala bilden så längsta sidan är högst max_sida och båda sidor är delbara med 8
    (kravet för Stable Diffusion). Behåller proportionerna. Returnerar (bild, (bredd, höjd))."""
    bild = bild.convert("RGB")
    skala = min(1.0, max_sida / max(bild.size))
    bredd = max(64, round(bild.width * skala / 8) * 8)
    höjd = max(64, round(bild.height * skala / 8) * 8)
    return bild.resize((bredd, höjd)), (bredd, höjd)


def filnamn_från_prompt(prompt: str, seed: int) -> str:
    """Gör ett säkert filnamn av prompten, t.ex. 'en-röd-drake_123456.png'."""
    ren = re.sub(r"[^\w]+", "-", prompt.lower(), flags=re.UNICODE).strip("-")[:40]
    return f"{ren or 'bild'}_{seed}.png"


class Bildgenerator:
    def __init__(self, modell: str = STANDARDMODELL, enhet: str | None = None):
        import torch
        from diffusers import StableDiffusionPipeline

        self.enhet = enhet or välj_enhet()
        dtyp = torch.float16 if self.enhet == "cuda" else torch.float32
        self.pipe = StableDiffusionPipeline.from_pretrained(modell, torch_dtype=dtyp)
        self.pipe = self.pipe.to(self.enhet)
        self.pipe.enable_attention_slicing()  # sparar minne
        self._torch = torch
        self._img2img = None  # skapas först när en startbild används

    def _hämta_img2img(self):
        """Bild-till-bild-pipeline som delar vikter med text-till-bild (ingen extra nedladdning)."""
        if self._img2img is None:
            from diffusers import StableDiffusionImg2ImgPipeline

            self._img2img = StableDiffusionImg2ImgPipeline.from_pipe(self.pipe)
        return self._img2img

    def generera(
        self,
        prompt: str,
        negativ_prompt: str = "",
        antal: int = 1,
        steg: int = 30,
        styrka: float = 7.5,
        bredd: int | None = None,
        höjd: int | None = None,
        seed: int | None = None,
        startbild=None,
        förändring: float = 0.75,
    ):
        """Returnerar en lista av (PIL-bild, seed).

        Ges en `startbild` (PIL-bild) görs en ny bild utifrån den (bild-till-bild).
        `förändring` (0-1) styr hur mycket bilden får ändras: lågt behåller originalet,
        högt följer prompten mer. Bredd/höjd tas då från startbilden om inget anges.
        """
        if not prompt.strip():
            raise ValueError("Prompten får inte vara tom.")
        if not 0 < förändring <= 1:
            raise ValueError("Förändring måste vara större än 0 och högst 1.")
        if startbild is not None:
            startbild, (b, h) = anpassa_storlek(startbild)
            if bredd or höjd:
                startbild = startbild.resize((bredd or b, höjd or h))
            pipe = self._hämta_img2img()
            extra = {"image": startbild, "strength": förändring}
        else:
            pipe = self.pipe
            extra = {"width": bredd or 512, "height": höjd or 512}
        if seed is None:
            seed = int(time.time() * 1000) % 2**31
        resultat = []
        for i in range(antal):
            s = seed + i
            gen = self._torch.Generator(device="cpu").manual_seed(s)
            bild = pipe(
                prompt=prompt,
                negative_prompt=negativ_prompt or None,
                num_inference_steps=steg,
                guidance_scale=styrka,
                generator=gen,
                **extra,
            ).images[0]
            resultat.append((bild, s))
        return resultat

    def generera_och_spara(self, prompt: str, utmapp: str = "bilder", **kwargs):
        mapp = Path(utmapp)
        mapp.mkdir(parents=True, exist_ok=True)
        sökvägar = []
        for bild, seed in self.generera(prompt, **kwargs):
            sökväg = mapp / filnamn_från_prompt(prompt, seed)
            bild.save(sökväg)
            sökvägar.append(sökväg)
        return sökvägar
