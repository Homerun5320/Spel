import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from bildgenerator.kärna import filnamn_från_prompt


def test_filnamn():
    assert filnamn_från_prompt("En röd drake!", 42) == "en-röd-drake_42.png"


def test_tomt_filnamn():
    assert filnamn_från_prompt("???", 1) == "bild_1.png"
