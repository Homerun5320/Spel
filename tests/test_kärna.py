import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from bildgenerator.kärna import filnamn_från_prompt


def test_filnamn():
    assert filnamn_från_prompt("En röd drake!", 42) == "en-röd-drake_42.png"


def test_tomt_filnamn():
    assert filnamn_från_prompt("???", 1) == "bild_1.png"


def test_anpassa_storlek_delbar_med_8_och_behåller_proportioner():
    from PIL import Image

    from bildgenerator.kärna import anpassa_storlek

    bild, (b, h) = anpassa_storlek(Image.new("RGBA", (1500, 1000)))
    assert (b, h) == (768, 512) and bild.size == (b, h) and bild.mode == "RGB"


def test_anpassa_storlek_förstorar_inte_små_bilder():
    from PIL import Image

    from bildgenerator.kärna import anpassa_storlek

    _, (b, h) = anpassa_storlek(Image.new("RGB", (301, 203)))
    assert b % 8 == 0 and h % 8 == 0 and max(b, h) <= 304
