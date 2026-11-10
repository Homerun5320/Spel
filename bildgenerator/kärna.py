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
UPPSKALA_FÖRÄNDRING = 0.3  # hur mycket uppskalningens andra pass får rita om
BILDMAPP = "bilder"


class MinnesFel(RuntimeError):
    """Grafikkortets minne räckte inte, inte ens med avlastning."""


class _IngenOOM(Exception):
    """Platshållare när torch saknar OutOfMemoryError."""


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
    alt_repon: tuple = ()  # provas i tur och ordning om `repo` inte går att ladda
    img_tar_mått: bool = True  # tar bild-till-bild-klassen width/height? (annars följer den startbilden)
    standard_negativ: str = ""  # används när modellen stöder negativ prompt och ingen angetts


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
        alt_repon=("Z-a-o/Z-Image-Turbo",),
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
        img_tar_mått=False,
        standard_negativ="blurry, low quality, jpeg artifacts, deformed, extra limbs, watermark, text",
    ),
}

# Stilar: ett tillägg på engelska som läggs efter prompten.
STILAR: dict[str, str] = {
    "ingen": "",
    "foto": "photograph, natural light, 50mm lens, sharp focus, realistic detail",
    "film": "cinematic film still, anamorphic lens, dramatic lighting, shallow depth of field, film grain",
    "porträtt": "portrait photograph, 85mm lens, soft window light, shallow depth of field, detailed skin",
    "oljemålning": "oil painting, visible brushstrokes, rich colors, canvas texture",
    "akvarell": "watercolor painting, soft washes, paper texture, delicate colors",
    "anime": "anime illustration, clean line art, cel shading, vibrant colors",
    "3d": "3D render, global illumination, physically based materials, highly detailed",
    "konceptkonst": "concept art, digital painting, atmospheric perspective, dramatic composition",
    "teckning": "pencil drawing, cross hatching, monochrome, paper texture",
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


def bygg_prompt(prompt: str, stil: str = "ingen") -> str:
    """Prompten som skickas till modellen: användarens text plus stilens tillägg."""
    if stil not in STILAR:
        raise ValueError(f"Okänd stil {stil!r}. Välj bland: {', '.join(STILAR)}.")
    prompt = prompt.strip()
    return f"{prompt}, {STILAR[stil]}" if STILAR[stil] else prompt


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


def spara_bild(bild, seed: int, inställningar: dict, mapp: str = BILDMAPP) -> Path:
    """Spara som PNG med inställningarna i filen. Skriver aldrig över en befintlig fil."""
    from PIL.PngImagePlugin import PngInfo

    mapp = Path(mapp)
    mapp.mkdir(parents=True, exist_ok=True)
    info = PngInfo()
    for nyckel, värde in {**inställningar, "seed": seed}.items():
        if värde != "":
            info.add_text(nyckel, str(värde))
    sökväg = mapp / filnamn_från_prompt(inställningar.get("prompt", ""), seed)
    n = 2
    while sökväg.exists():
        sökväg = sökväg.with_name(f"{sökväg.stem.split('__')[0]}__{n}.png")
        n += 1
    bild.save(sökväg, pnginfo=info)
    return sökväg


def lista_bilder(mapp: str = BILDMAPP, max_antal: int = 60) -> list[Path]:
    """Sparade bilder, nyaste först."""
    mapp = Path(mapp)
    if not mapp.is_dir():
        return []
    filer = sorted(mapp.glob("*.png"), key=lambda f: f.stat().st_mtime, reverse=True)
    return filer[:max_antal]


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

        self._oom = (getattr(torch, "OutOfMemoryError", None)
                     or getattr(torch.cuda, "OutOfMemoryError", _IngenOOM))
        pipe, fel = None, []
        for repo in (p.repo, *p.alt_repon):
            try:
                pipe = text_klass.from_pretrained(repo, dtype=dtyp)
            except OSError as e:  # modellen finns inte under det namnet, eller nätet är nere
                fel.append(f"{repo}: {e}")
                continue
            self.repo = repo
            break
        if pipe is None:
            raise RuntimeError(
                f"Kunde inte ladda modellen {p.namn}. Kontrollera internet och modellnamnet.\n"
                + "\n".join(fel))
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
        self._töm_cache()

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
        stil: str = "ingen",
        uppskala: float = 1.0,
        framsteg=None,
    ):
        """Returnerar en lista av (PIL-bild, seed).

        steg/styrka: None använder modellens rekommenderade värden.
        format: bildformat (1:1, 16:9, 9:16 ...) när varken bredd/höjd eller startbild ges.
        stil: ett namn ur STILAR, läggs till efter prompten.
        uppskala: 1-2. Över 1 förstoras bilden och ritas om lätt i ett andra pass, för fler detaljer.
        framsteg: valfri funktion (andel 0-1, text) som anropas under arbetet.
        Ges en `startbild` (PIL-bild) görs en ny bild utifrån den (bild-till-bild).
        `förändring` (0-1) styr hur mycket bilden får ändras: lågt behåller originalet,
        högt följer prompten mer. Storleken tas då från startbilden om inget anges.
        """
        if not prompt.strip():
            raise ValueError("Prompten får inte vara tom.")
        if antal < 1:
            raise ValueError("Antal måste vara minst 1.")
        if not 0 < förändring <= 1:
            raise ValueError("Förändring måste vara större än 0 och högst 1.")
        if not 1 <= uppskala <= 2:
            raise ValueError("Uppskalning måste vara mellan 1 och 2.")
        bygg_prompt(prompt, stil)  # ger ValueError vid okänd stil
        if seed is None:
            seed = int(time.time() * 1000) % 2**31
        argument = dict(
            prompt=prompt, negativ_prompt=negativ_prompt, antal=antal, steg=steg, styrka=styrka,
            bredd=bredd, höjd=höjd, seed=seed, startbild=startbild, förändring=förändring,
            format=format, stil=stil, uppskala=uppskala, framsteg=framsteg,
        )
        try:
            return self._generera(**argument)
        except self._oom:
            # Slut på grafikminne: försök en gång till med avlastning till processorminnet.
            if self.enhet == "cuda" and not self.avlasta:
                self.avlasta, self._aktiv = True, None
                self._töm_cache()
                try:
                    return self._generera(**argument)
                except self._oom:
                    pass
            self._töm_cache()
            raise MinnesFel(
                "Grafikkortets minne räckte inte. Prova ett mindre format, stäng av uppskalning "
                "eller välj modellen sd15."
            ) from None

    def _töm_cache(self):
        gc.collect()
        if self.enhet == "cuda":
            self._torch.cuda.empty_cache()

    def _generera(self, prompt, negativ_prompt, antal, steg, styrka, bredd, höjd, seed,
                  startbild, förändring, format, stil, uppskala, framsteg):
        p = self.profil
        steg = steg or p.steg
        styrka = p.styrka if styrka is None else styrka

        gemensamt = dict(p.extra, prompt=bygg_prompt(prompt, stil), guidance_scale=styrka)
        negativ = ""
        if p.negativ:
            negativ = negativ_prompt.strip() or p.standard_negativ
            if negativ:
                gemensamt["negative_prompt"] = negativ
        elif negativ_prompt.strip():
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
            bas = self._img_argument(startbild, förändring)
            riktiga_steg = max(1, int(steg * förändring))
        else:
            pipe = self._pipe("text")
            if bredd or höjd:
                b, h = runda_mått(bredd or p.storlek), runda_mått(höjd or p.storlek)
            else:
                b, h = storlek_för_format(format, p)
            bas = dict(width=b, height=h)
            riktiga_steg = steg

        pass_totalt = antal * (2 if uppskala > 1 else 1)

        def kör(pipe, nr, text, antal_steg, riktiga, s, **kw):
            if framsteg:
                framsteg(nr / pass_totalt, text)

                def vid_steg(_pipe, i, _t, cb):
                    framsteg((nr + min(1.0, (i + 1) / riktiga)) / pass_totalt, text)
                    return cb

                kw["callback_on_step_end"] = vid_steg
            gen = self._torch.Generator(device="cpu").manual_seed(s)
            return pipe(num_inference_steps=antal_steg, generator=gen, **gemensamt, **kw).images[0]

        resultat = []
        for i in range(antal):
            bild = kör(pipe, i, f"Genererar bild {i + 1} av {antal}", steg, riktiga_steg, seed + i, **bas)
            resultat.append((bild, seed + i))

        if uppskala > 1:
            from PIL import Image

            pipe = self._pipe("img")
            vae = getattr(pipe, "vae", None)
            if hasattr(vae, "enable_tiling"):
                vae.enable_tiling()  # håller nere minnet vid stora bilder
            # Snabbmodeller har få steg: se till att det andra passet ändå får några riktiga steg.
            steg_upp = max(steg, math.ceil(min(4, steg) / UPPSKALA_FÖRÄNDRING))
            riktiga = max(1, int(steg_upp * UPPSKALA_FÖRÄNDRING))
            for i, (bild, s) in enumerate(resultat):
                b, h = runda_mått(bild.width * uppskala), runda_mått(bild.height * uppskala)
                stor = bild.resize((b, h), Image.LANCZOS)
                bild = kör(pipe, antal + i, f"Skalar upp bild {i + 1} av {antal}", steg_upp, riktiga, s,
                           **self._img_argument(stor, UPPSKALA_FÖRÄNDRING))
                resultat[i] = (bild, s)

        if framsteg:
            framsteg(1.0, "Klar")
        self.senaste_inställningar = {
            "modell": p.namn, "repo": self.repo, "prompt": prompt, "stil": stil if stil != "ingen" else "",
            "negativ_prompt": negativ, "steg": steg, "styrka": styrka, "storlek": f"{b}x{h}",
            "förändring": förändring if startbild is not None else "",
            "uppskala": uppskala if uppskala > 1 else "",
        }
        return resultat

    def _img_argument(self, bild, förändring: float) -> dict:
        """Argument för bild-till-bild. FLUX faller annars tillbaka på 1024x1024 och tappar proportionerna."""
        arg = dict(image=bild, strength=förändring)
        if self.profil.img_tar_mått:
            arg.update(width=bild.width, height=bild.height)
        return arg

    def generera_och_spara(self, prompt: str, utmapp: str = BILDMAPP, **kwargs):
        """Genererar och sparar PNG-filer. Inställningarna sparas i filen (läs_metadata)."""
        resultat = self.generera(prompt, **kwargs)
        return [spara_bild(bild, seed, self.senaste_inställningar, utmapp) for bild, seed in resultat]
