"""Testar Bildgenerator mot låtsas-torch och låtsas-diffusers (inga riktiga modeller)."""
import sys
import types
import warnings
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from bildgenerator import kärna


class FakeOOM(Exception):
    pass


class FakePipe:
    saknade_repon: set = set()  # repon som "inte finns"
    oom_tills_avlastad = False  # kasta minnesfel så länge avlastning är av
    oom_alltid = False

    def __init__(self):
        self.anrop, self.flyttad, self.avlastad, self.slicing, self.repo = [], None, False, False, None
        self.vae = types.SimpleNamespace(tiling=False)
        self.vae.enable_tiling = lambda: setattr(self.vae, "tiling", True)

    @classmethod
    def from_pretrained(cls, repo, dtype=None):
        if repo in cls.saknade_repon:
            raise OSError(f"{repo} finns inte")
        p = cls()
        p.repo, p.dtype = repo, dtype
        return p

    @classmethod
    def from_pipe(cls, annan):
        p = cls()
        p.repo = annan.repo
        return p

    def to(self, enhet):
        self.flyttad = enhet
        return self

    def enable_model_cpu_offload(self):
        self.avlastad = True

    def remove_all_hooks(self):
        self.avlastad = False

    def enable_attention_slicing(self):
        self.slicing = True

    def __call__(self, **kw):
        if FakePipe.oom_alltid or (FakePipe.oom_tills_avlastad and not self.avlastad):
            raise FakeOOM()
        self.anrop.append(kw)
        if "image" in kw:
            b, h = kw["image"].size
        else:
            b, h = kw["width"], kw["height"]
        cb = kw.get("callback_on_step_end")
        if cb:
            steg = max(1, int(kw["num_inference_steps"] * kw.get("strength", 1)))
            for i in range(steg):
                assert cb(self, i, 0, {}) == {}
        return types.SimpleNamespace(images=[Image.new("RGB", (b, h))])


@pytest.fixture
def fakes(monkeypatch):
    monkeypatch.setattr(FakePipe, "saknade_repon", set())
    monkeypatch.setattr(FakePipe, "oom_tills_avlastad", False)
    monkeypatch.setattr(FakePipe, "oom_alltid", False)

    def installera(cuda=False, vram=0):
        torch = types.ModuleType("torch")
        torch.OutOfMemoryError = FakeOOM
        torch.float16, torch.bfloat16, torch.float32 = "f16", "bf16", "f32"
        torch.cuda = types.SimpleNamespace(
            is_available=lambda: cuda, empty_cache=lambda: None,
            get_device_properties=lambda i: types.SimpleNamespace(total_memory=vram * 1024**3))
        torch.backends = types.SimpleNamespace(mps=types.SimpleNamespace(is_available=lambda: False))

        class Generator:
            def __init__(self, device="cpu"):
                self.seed = None

            def manual_seed(self, s):
                self.seed = s
                return self

        torch.Generator = Generator
        diffusers = types.ModuleType("diffusers")
        for namn in ["ZImagePipeline", "ZImageImg2ImgPipeline", "FluxPipeline", "FluxImg2ImgPipeline",
                     "StableDiffusionPipeline", "StableDiffusionImg2ImgPipeline"]:
            setattr(diffusers, namn, type(namn, (FakePipe,), {}))
        monkeypatch.setitem(sys.modules, "torch", torch)
        monkeypatch.setitem(sys.modules, "diffusers", diffusers)
    return installera


def test_auto_cpu_väljer_sd15(fakes):
    fakes()
    g = kärna.Bildgenerator()
    assert g.profil.namn == "sd15" and g.enhet == "cpu"
    assert g._pipor["text"].flyttad == "cpu" and g._pipor["text"].slicing


def test_auto_stort_kort_kör_helt_på_gpu(fakes):
    fakes(cuda=True, vram=24)
    g = kärna.Bildgenerator()
    p = g._pipor["text"]
    assert g.profil.namn == "z-image-turbo" and not g.avlasta
    assert p.flyttad == "cuda" and p.dtype == "bf16" and p.repo == "Tongyi-MAI/Z-Image-Turbo"


def test_auto_mellanstort_kort_avlastar(fakes):
    fakes(cuda=True, vram=16)
    g = kärna.Bildgenerator()
    assert g.profil.namn == "z-image-turbo" and g.avlasta
    assert g._pipor["text"].avlastad and g._pipor["text"].flyttad is None


def test_auto_litet_kort_väljer_sd15(fakes):
    fakes(cuda=True, vram=8)
    g = kärna.Bildgenerator()
    assert g.profil.namn == "sd15" and g._pipor["text"].dtype == "f16" and not g.avlasta


def test_z_image_standardvärden_och_negativ_ignoreras(fakes):
    fakes(cuda=True, vram=24)
    g = kärna.Bildgenerator("z-image-turbo")
    with pytest.warns(UserWarning, match="negativ prompt"):
        g.generera("a cat", negativ_prompt="blurry", seed=5)
    k = g._pipor["text"].anrop[0]
    assert (k["num_inference_steps"], k["guidance_scale"]) == (8, 0.0)
    assert (k["width"], k["height"]) == (1024, 1024) and "negative_prompt" not in k


def test_sd15_standardvärden_och_negativ_används(fakes):
    fakes()
    g = kärna.Bildgenerator("sd15")
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        g.generera("a cat", negativ_prompt="blurry")
    k = g._pipor["text"].anrop[0]
    assert (k["num_inference_steps"], k["guidance_scale"]) == (30, 7.5)
    assert (k["width"], k["height"], k["negative_prompt"]) == (512, 512, "blurry")
    g.generera("a cat")  # utan egen negativ prompt används modellens standard
    assert "low quality" in g._pipor["text"].anrop[1]["negative_prompt"]


def test_flux_skickar_max_sequence_length(fakes):
    fakes(cuda=True, vram=48)
    g = kärna.Bildgenerator("flux-schnell")
    g.generera("a cat")
    k = g._pipor["text"].anrop[0]
    assert k["max_sequence_length"] == 256 and k["num_inference_steps"] == 4


def test_egna_värden_slår_standard(fakes):
    fakes()
    g = kärna.Bildgenerator("sd15")
    g.generera("a cat", steg=12, styrka=3.0, bredd=500, höjd=300)
    k = g._pipor["text"].anrop[0]
    assert (k["num_inference_steps"], k["guidance_scale"], k["width"], k["height"]) == (12, 3.0, 496, 304)


def test_format_ger_mått_delbara_med_16(fakes):
    for fmt in kärna.FORMAT:
        b, h = kärna.storlek_för_format(fmt, kärna.PROFILER["z-image-turbo"])
        assert b % 16 == 0 and h % 16 == 0
    assert kärna.storlek_för_format("16:9", kärna.PROFILER["z-image-turbo"]) == (1360, 768)
    assert kärna.storlek_för_format("9:16", kärna.PROFILER["z-image-turbo"]) == (768, 1360)
    with pytest.raises(ValueError):
        kärna.storlek_för_format("5:4", kärna.PROFILER["sd15"])


def test_seeds_räknas_upp(fakes):
    fakes()
    g = kärna.Bildgenerator("sd15")
    res = g.generera("a cat", antal=3, seed=10)
    assert [s for _, s in res] == [10, 11, 12]
    assert [k["generator"].seed for k in g._pipor["text"].anrop] == [10, 11, 12]


def test_bild_till_bild_använder_img_pipeline_och_skalar(fakes):
    fakes(cuda=True, vram=24)
    g = kärna.Bildgenerator("z-image-turbo")
    g.generera("sunset", startbild=Image.new("RGBA", (1500, 1000)), förändring=0.5)
    k = g._pipor["img"].anrop[0]
    assert type(g._pipor["img"]).__name__ == "ZImageImg2ImgPipeline"
    assert k["image"].size == (1024, 688) and k["strength"] == 0.5
    # måtten skickas med, annars faller FLUX tillbaka på 1024x1024 och tappar proportionerna
    assert (k["width"], k["height"]) == (1024, 688) and not g._pipor["text"].anrop


def test_avlastning_byter_hooks_mellan_text_och_bild(fakes):
    fakes(cuda=True, vram=16)
    g = kärna.Bildgenerator("z-image-turbo")
    text = g._pipor["text"]
    assert text.avlastad
    g.generera("a", startbild=Image.new("RGB", (64, 64)))
    img = g._pipor["img"]
    assert img.avlastad and not text.avlastad
    g.generera("b")
    assert text.avlastad and not img.avlastad


def test_ogiltiga_värden(fakes):
    fakes()
    g = kärna.Bildgenerator("sd15")
    for kw in [{"prompt": "  "}, {"prompt": "a", "förändring": 0}, {"prompt": "a", "förändring": 1.5},
               {"prompt": "a", "antal": 0}]:
        with pytest.raises(ValueError):
            g.generera(**kw)


def test_eget_modell_id_blir_sd_profil(fakes):
    fakes()
    g = kärna.Bildgenerator("någon/modell")
    assert g.profil.repo == "någon/modell" and g.profil.text_klass == "StableDiffusionPipeline"
    assert g._pipor["text"].repo == "någon/modell"


def test_spara_med_metadata(fakes, tmp_path):
    fakes()
    g = kärna.Bildgenerator("sd15")
    [sökväg] = g.generera_och_spara("A red dragon!", str(tmp_path), seed=7, steg=9)
    assert sökväg.name == "a-red-dragon_7.png"
    m = kärna.läs_metadata(sökväg)
    assert m["prompt"] == "A red dragon!" and m["seed"] == "7" and m["modell"] == "sd15"
    assert m["steg"] == "9" and m["storlek"] == "512x512" and "förändring" not in m


def test_frigör(fakes):
    fakes()
    g = kärna.Bildgenerator("sd15")
    g.frigör()
    assert g._pipor == {}


def test_sd_bild_till_bild_skickar_inte_mått(fakes):
    fakes()
    g = kärna.Bildgenerator("sd15")
    g.generera("a", startbild=Image.new("RGB", (640, 480)))
    k = g._pipor["img"].anrop[0]
    assert "width" not in k and "height" not in k and k["image"].size == (640, 480)


def test_stil_läggs_till_prompten(fakes):
    fakes()
    g = kärna.Bildgenerator("sd15")
    g.generera(" a cat ", stil="akvarell")
    assert g._pipor["text"].anrop[0]["prompt"] == "a cat, " + kärna.STILAR["akvarell"]
    assert g.senaste_inställningar["prompt"] == " a cat " and g.senaste_inställningar["stil"] == "akvarell"
    assert kärna.bygg_prompt("a cat") == "a cat"
    with pytest.raises(ValueError, match="Okänd stil"):
        g.generera("a cat", stil="kubism")


def test_uppskalning_kör_andra_pass_med_samma_seed(fakes):
    fakes(cuda=True, vram=24)
    g = kärna.Bildgenerator("z-image-turbo")
    res = g.generera("a cat", antal=2, seed=3, uppskala=1.5, format="16:9")
    text, img = g._pipor["text"].anrop, g._pipor["img"].anrop
    assert len(text) == 2 and len(img) == 2
    assert [b.size for b, _ in res] == [(2048, 1152)] * 2  # 1360x768 * 1.5 = 2040x1152, avrundat till 16
    k = img[0]
    assert k["strength"] == kärna.UPPSKALA_FÖRÄNDRING and k["image"].size == (2048, 1152)
    assert (k["width"], k["height"]) == (2048, 1152)
    assert int(k["num_inference_steps"] * k["strength"]) >= 4  # snabbmodellen får ändå riktiga steg
    assert [a["generator"].seed for a in img] == [3, 4] and g._pipor["img"].vae.tiling
    assert g.senaste_inställningar["storlek"] == "2048x1152" and g.senaste_inställningar["uppskala"] == 1.5
    with pytest.raises(ValueError):
        g.generera("a cat", uppskala=3)


def test_framsteg_går_från_0_till_1(fakes):
    fakes()
    g = kärna.Bildgenerator("sd15")
    steg = []
    g.generera("a cat", antal=2, steg=4, uppskala=2, framsteg=lambda a, t: steg.append((a, t)))
    andelar = [a for a, _ in steg]
    assert andelar == sorted(andelar) and andelar[0] == 0 and andelar[-1] == 1.0
    assert all(0 <= a <= 1 for a in andelar)
    assert any("Skalar upp bild 2 av 2" in t for _, t in steg)


def test_reservrepo_används_när_första_saknas(fakes):
    fakes(cuda=True, vram=24)
    FakePipe.saknade_repon = {"Tongyi-MAI/Z-Image-Turbo"}
    g = kärna.Bildgenerator("z-image-turbo")
    assert g.repo == "Z-a-o/Z-Image-Turbo" and g._pipor["text"].repo == "Z-a-o/Z-Image-Turbo"
    g.generera("a")
    assert g.senaste_inställningar["repo"] == "Z-a-o/Z-Image-Turbo"
    FakePipe.saknade_repon = {"Tongyi-MAI/Z-Image-Turbo", "Z-a-o/Z-Image-Turbo"}
    with pytest.raises(RuntimeError, match="Kunde inte ladda"):
        kärna.Bildgenerator("z-image-turbo")


def test_minnesbrist_slår_på_avlastning_och_försöker_igen(fakes):
    fakes(cuda=True, vram=24)
    g = kärna.Bildgenerator("z-image-turbo")
    assert not g.avlasta
    FakePipe.oom_tills_avlastad = True
    res = g.generera("a cat", seed=9)
    assert g.avlasta and g._pipor["text"].avlastad and [s for _, s in res] == [9]


def test_minnesbrist_ger_begripligt_fel(fakes):
    fakes(cuda=True, vram=24)
    g = kärna.Bildgenerator("z-image-turbo")
    FakePipe.oom_alltid = True
    with pytest.raises(kärna.MinnesFel, match="mindre format"):
        g.generera("a cat")


def test_spara_skriver_inte_över_och_listar_nyast_först(fakes, tmp_path):
    import os

    fakes()
    g = kärna.Bildgenerator("sd15")
    a = g.generera_och_spara("a cat", str(tmp_path), seed=1)[0]
    b = g.generera_och_spara("a cat", str(tmp_path), seed=1, steg=5)[0]
    c = g.generera_och_spara("a cat", str(tmp_path), seed=1, steg=6)[0]
    assert [f.name for f in (a, b, c)] == ["a-cat_1.png", "a-cat_1__2.png", "a-cat_1__3.png"]
    for i, f in enumerate((a, b, c)):
        os.utime(f, (1000 + i, 1000 + i))
    assert kärna.lista_bilder(str(tmp_path)) == [c, b, a]
    assert kärna.lista_bilder(str(tmp_path), max_antal=1) == [c]
    assert kärna.lista_bilder(str(tmp_path / "saknas")) == []
