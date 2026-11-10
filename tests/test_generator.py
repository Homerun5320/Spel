"""Testar Bildgenerator mot låtsas-torch och låtsas-diffusers (inga riktiga modeller)."""
import sys
import types
import warnings
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from bildgenerator import kärna


class FakePipe:
    def __init__(self):
        self.anrop, self.flyttad, self.avlastad, self.slicing, self.repo = [], None, False, False, None

    @classmethod
    def from_pretrained(cls, repo, dtype=None):
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
        self.anrop.append(kw)
        b, h = kw.get("width", 64), kw.get("height", 64)
        return types.SimpleNamespace(images=[Image.new("RGB", (b, h))])


@pytest.fixture
def fakes(monkeypatch):
    def installera(cuda=False, vram=0):
        torch = types.ModuleType("torch")
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
    assert "width" not in k and "height" not in k and not g._pipor["text"].anrop


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
