"""Kärnan: väljer och laddar en öppen bildmodell och genererar bilder.

Modellerna (se PROFILER) är öppna och kan köras lokalt. Varje modell har en profil
med rätt klass, steg, styrka och storlek, så att bilderna blir bra utan att man
behöver kunna inställningarna. Importen av torch/diffusers sker först när en
generator skapas, så att resten av modulen går att testa utan dem.
"""
from __future__ import annotations

import gc
import math
import re
import time
import warnings
from dataclasses import dataclass, field, replace
from pathlib import Path

SD15_REPO = "stable-diffusion-v1-5/stable-diffusion-v1-5"
STANDARDMODELL = "auto"
MULTIPEL = 16  # Z-Image och FLUX kräver mått som är delbara med 16 (SD klarar det också)


@dataclass(frozen=True)
class Profil:
    namn: str
    repo: str
    text_klass: str  # diffusers-klass för text-till-bild
    img_klass: str  # diffusers-klass för bild-till-bild
    steg: int  # modellens rekommenderade antal steg
    styrka: float  # rekommenderad guidance_scale
    storlek: int  # standardsida i pixlar (kvadratisk bild)
    max_sida: int  # längsta sida när en startbild skalas
    negativ: bool  # används negativ prompt?
    helt_på_gpu_gb: float  # VRAM som krävs för att hålla allt på GPU, annars avlastas
    dtyp_cuda: str
    licens: str
    beskrivning: str
    extra: dict = field(default_factory=dict)  # fasta extra argument vid anrop
    attention_slicing: bool = False


PROFILER: dict[str, Profil] = {
    "z-image-turbo": Profil(
        namn="z-image-turbo",
        repo="Tongyi-MAI/Z-Image-Turbo",
        text_klass="ZImagePipeline",
        img_klass="ZImageImg2ImgPipeline",
        steg=8,
        styrka=0.0,
        storlek=1024,
        max_sida=1024,
        negativ=False,
        helt_på_gpu_gb=24,
        dtyp_cuda="bfloat16",
        licens="Apache-2.0",
        beskrivning="6 mdr parametrar, hög kvalitet på 8 steg, bra på text i bild. Standard på kraftigt grafikkort.",
    ),
    "flux-schnell": Profil(
        namn="flux-schnell",
        repo="black-forest-labs/FLUX.1-schnell",
        text_klass="FluxPipeline",
        img_klass="FluxImg2ImgPipeline",
        steg=4,
        styrka=0.0,
        storlek=1024,
        max_sida=1024,
        negativ=False,
        helt_på_gpu_gb=40,
        dtyp_cuda="bfloat16",
        licens="Apache-2.0",
        beskrivning="12 mdr parametrar, 4 steg. Mycket bra kvalitet men tung.",
        extra={"max_sequence_length": 256},
    ),
    "sd15": Profil(
        namn="sd15",
        repo=SD15_REPO,
        text_klass="StableDiffusionPipeline",
        img_klass="StableDiffusionImg2ImgPipeline",
        steg=30,
        styrka=7.5,
        storlek=512,
        max_sida=768,
        negativ=True,
        helt_på_gpu_gb=6,
        dtyp_cuda="float16",
        licens="CreativeML OpenRAIL-M",
        beskrivning="Äldre och enkel, men snabb och klarar små grafikkort och CPU.",
        attention_slicing=True,
    ),
}

# bredd:höjd
FORMAT: dict[str, tuple[int, int]] = {
    "1:1": (1, 1), "4:3": (4, 3), "3:2": (3, 2), "16:9": (16, 9),
    "3:4": (3, 4), "2:3": (2, 3), "9:16": (9, 16),
}


def _importera():
    import diffusers
    import torch

    return torch, diffusers


def välj_enhet() -> str:
    """Välj bästa tillgängliga enhet: cuda > mps > cpu."""
    torch, _ = _importera()
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def välj_profil_auto(enhet: str, vram_gb: float | None) -> Profil:
    """Z-Image-Turbo kräver minst ~14 GB VRAM (med avlastning). Annars Stable Diffusion 1.5."""
    if enhet == "cuda" and vram_gb is not None and vram_gb >= 14:
        return PROFILER["z-image-turbo"]
    return PROFILER["sd15"]


def lös_profil(modell: str, enhet: str, vram_gb: float | None) -> Profil:
    if modell == "auto":
        return välj_profil_auto(enhet, vram_gb)
    if modell in PROFILER:
        return PROFILER[modell]
    # Egen modell från Hugging Face: antas vara Stable Diffusion 1.x
    return replace(PROFILER["sd15"], namn=modell, repo=modell,
                   beskrivning="Egen modell (antas vara Stable Diffusion 1.x).")


def runda_mått(värde: float, multipel: int = MULTIPEL) -> int:
    return max(multipel * 4, round(värde / multipel) * multipel)


def storlek_för_format(format: str, profil: Profil) -> tuple[int, int]:
    """Bredd och höjd för ett bildformat, med ungefär samma antal pixlar som modellens standard."""
    if format not in FORMAT:
        raise ValueError(f"Okänt format {format!r}. Välj bland: {', '.join(FORMAT)}.")
    a, b = FORMAT[format]
    bredd = math.sqrt(profil.storlek**2 * a / b)
    return runda_mått(bredd), runda_mått(bredd * b / a)


def anpassa_storlek(bild, max_sida: int = 768, multipel: int = MULTIPEL):
    """Skala bilden så längsta sidan är högst max_sida och båda sidor är delbara med `multipel`.
    Behåller proportionerna. Returnerar (bild, (bredd, höjd))."""
    bild = bild.convert("RGB")
    skala = min(1.0, max_sida / max(bild.size))
    bredd = runda_mått(bild.width * skala, multipel)
    höjd = runda_mått(bild.height * skala, multipel)
    return bild.resize((bredd, höjd)), (bredd, höjd)


def filnamn_från_prompt(prompt: str, seed: int) -> str:
    """Gör ett säkert filnamn av prompten, t.ex. 'en-röd-drake_123456.png'."""
    ren = re.sub(r"[^\w]+", "-", prompt.lower(), flags=re.UNICODE).strip("-")[:40]
    return f"{ren or 'bild'}_{seed}.png"


def läs_metadata(sökväg) -> dict:
    """Läs inställningarna som sparades i en genererad PNG (prompt, seed, modell ...)."""
    from PIL import Image

    with Image.open(sökväg) as bild:
        return dict(getattr(bild, "text", {}))


class Bildgenerator:
    def __init__(self, modell: str = STANDARDMODELL, enhet: str | None = None,
                 avlasta: bool | None = None):
        """modell: 'auto', ett profilnamn (z-image-turbo, flux-schnell, sd15) eller ett
        Hugging Face-id. avlasta: tvinga (True) eller stäng av (False) avlastning till
        processorminnet; None väljer själv utifrån grafikkortets minne."""
        torch, diffusers = _importera()
        self._torch, self._diffusers = torch, diffusers
        self.enhet = enhet or välj_enhet()
        vram = None
        if self.enhet == "cuda":
            vram = torch.cuda.get_device_properties(0).total_memory / 1024**3
        self.vram_gb = vram
        self.profil = lös_profil(modell, self.enhet, vram)
        p = self.profil

        dtyp = getattr(torch, p.dtyp_cuda) if self.enhet == "cuda" else torch.float32
        text_klass = getattr(diffusers, p.text_klass)
        self._img_klass = getattr(diffusers, p.img_klass)
        self.avlasta = (
            self.enhet == "cuda" and (vram < p.helt_på_gpu_gb if avlasta is None else avlasta)
        )

        pipe = text_klass.from_pretrained(p.repo, dtype=dtyp)
        if not self.avlasta:
            pipe = pipe.to(self.enhet)
        if p.attention_slicing:
            pipe.enable_attention_slicing()  # sparar minne
        self._pipor = {"text": pipe}
        self._aktiv: str | None = None
        self.senaste_inställningar: dict = {}
        self._pipe("text")

    def _pipe(self, läge: str):
        """Pipeline för 'text' (text-till-bild) eller 'img' (bild-till-bild). De delar vikter,
        så ingen extra nedladdning eller extra minne behövs. Vid avlastning får bara en
        av dem hooks åt gången."""
        byte = self.avlasta and self._aktiv != läge
        if byte and self._aktiv:
            self._pipor[self._aktiv].remove_all_hooks()
        if läge not in self._pipor:
            pipe = self._img_klass.from_pipe(self._pipor["text"])
            if self.profil.attention_slicing:
                pipe.enable_attention_slicing()
            self._pipor[läge] = pipe
        pipe = self._pipor[läge]
        if byte:
            pipe.enable_model_cpu_offload()
        self._aktiv = läge
        return pipe

    def frigör(self):
        """Släpp modellen och dess minne (används när man byter modell)."""
        self._pipor.clear()
        gc.collect()
        if self.enhet == "cuda":
            self._torch.cuda.empty_cache()

    def generera(
        self,
        prompt: str,
        negativ_prompt: str = "",
        antal: int = 1,
        steg: int | None = None,
        styrka: float | None = None,
        bredd: int | None = None,
        höjd: int | None = None,
        seed: int | None = None,
        startbild=None,
        förändring: float = 0.75,
        format: str = "1:1",
    ):
        """Returnerar en lista av (PIL-bild, seed).

        steg/styrka: None använder modellens rekommenderade värden.
        format: bildformat (1:1, 16:9, 9:16 ...) när varken bredd/höjd eller startbild ges.
        Ges en `startbild` (PIL-bild) görs en ny bild utifrån den (bild-till-bild).
        `förändring` (0-1) styr hur mycket bilden får ändras: lågt behåller originalet,
        högt följer prompten mer. Storleken tas då från startbilden om inget anges.
        """
        p = self.profil
        if not prompt.strip():
            raise ValueError("Prompten får inte vara tom.")
        if antal < 1:
            raise ValueError("Antal måste vara minst 1.")
        if not 0 < förändring <= 1:
            raise ValueError("Förändring måste vara större än 0 och högst 1.")
        steg = steg or p.steg
        styrka = p.styrka if styrka is None else styrka

        anrop = dict(p.extra)
        if negativ_prompt.strip():
            if p.negativ:
                anrop["negative_prompt"] = negativ_prompt
            else:
                warnings.warn(
                    f"{p.namn} använder inte negativ prompt, den ignoreras. "
                    "Beskriv i stället vad du vill ha."
                )

        if startbild is not None:
            pipe = self._pipe("img")
            startbild, (b, h) = anpassa_storlek(startbild, p.max_sida)
            if bredd or höjd:
                b, h = runda_mått(bredd or b), runda_mått(höjd or h)
                startbild = startbild.resize((b, h))
            anrop.update(image=startbild, strength=förändring)
            storlek = (b, h)
        else:
            pipe = self._pipe("text")
            if bredd or höjd:
                b, h = runda_mått(bredd or p.storlek), runda_mått(höjd or p.storlek)
            else:
                b, h = storlek_för_format(format, p)
            anrop.update(width=b, height=h)
            storlek = (b, h)

        if seed is None:
            seed = int(time.time() * 1000) % 2**31
        self.senaste_inställningar = {
            "modell": p.namn, "repo": p.repo, "prompt": prompt,
            "negativ_prompt": negativ_prompt if p.negativ else "",
            "steg": steg, "styrka": styrka, "storlek": f"{storlek[0]}x{storlek[1]}",
            "förändring": förändring if startbild is not None else "",
        }

        resultat = []
        for i in range(antal):
            s = seed + i
            gen = self._torch.Generator(device="cpu").manual_seed(s)
            bild = pipe(
                prompt=prompt, num_inference_steps=steg, guidance_scale=styrka,
                generator=gen, **anrop,
            ).images[0]
            resultat.append((bild, s))
        return resultat

    def generera_och_spara(self, prompt: str, utmapp: str = "bilder", **kwargs):
        """Genererar och sparar PNG-filer. Inställningarna sparas i filen (läs_metadata)."""
        from PIL.PngImagePlugin import PngInfo

        mapp = Path(utmapp)
        mapp.mkdir(parents=True, exist_ok=True)
        resultat = self.generera(prompt, **kwargs)
        sökvägar = []
        for bild, seed in resultat:
            info = PngInfo()
            for nyckel, värde in {**self.senaste_inställningar, "seed": seed}.items():
                if värde != "":
                    info.add_text(nyckel, str(värde))
            sökväg = mapp / filnamn_från_prompt(prompt, seed)
            bild.save(sökväg, pnginfo=info)
            sökvägar.append(sökväg)
        return sökvägar
