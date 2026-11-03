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

    def generera(
        self,
        prompt: str,
        negativ_prompt: str = "",
        antal: int = 1,
        steg: int = 30,
        styrka: float = 7.5,
        bredd: int = 512,
        höjd: int = 512,
        seed: int | None = None,
    ):
        """Returnerar en lista av (PIL-bild, seed)."""
        if not prompt.strip():
            raise ValueError("Prompten får inte vara tom.")
        if seed is None:
            seed = int(time.time() * 1000) % 2**31
        resultat = []
        for i in range(antal):
            s = seed + i
            gen = self._torch.Generator(device="cpu").manual_seed(s)
            bild = self.pipe(
                prompt=prompt,
                negative_prompt=negativ_prompt or None,
                num_inference_steps=steg,
                guidance_scale=styrka,
                width=bredd,
                height=höjd,
                generator=gen,
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
