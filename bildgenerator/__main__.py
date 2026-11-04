"""Kommandorad:  python -m bildgenerator "en röd drake över ett berg" """
import argparse

from .kärna import STANDARDMODELL, Bildgenerator


def main():
    p = argparse.ArgumentParser(prog="bildgenerator", description="Generera bilder från text.")
    p.add_argument("prompt", help="Beskrivning av bilden (engelska ger oftast bäst resultat)")
    p.add_argument("-n", "--negativ", default="", help="Det du inte vill ha med")
    p.add_argument("--antal", type=int, default=1)
    p.add_argument("--steg", type=int, default=30, help="Fler steg = bättre men långsammare")
    p.add_argument("--styrka", type=float, default=7.5, help="Hur strikt prompten följs")
    p.add_argument("--bredd", type=int, default=None, help="Standard 512, eller startbildens storlek")
    p.add_argument("--höjd", type=int, default=None)
    p.add_argument("--bild", help="Startbild för bild-till-bild (sökväg till en bildfil)")
    p.add_argument("--förändring", type=float, default=0.75,
                   help="0-1: hur mycket startbilden får ändras (lågt = nära originalet)")
    p.add_argument("--seed", type=int, default=None, help="Samma seed ger samma bild")
    p.add_argument("--modell", default=STANDARDMODELL)
    p.add_argument("--ut", default="bilder", help="Mapp att spara i")
    a = p.parse_args()

    startbild = None
    if a.bild:
        from PIL import Image

        try:
            startbild = Image.open(a.bild)
        except OSError as e:
            p.error(f"Kunde inte öppna startbilden {a.bild!r}: {e}")

    print(f"Laddar modell {a.modell} (första gången laddas den ner)...")
    gen = Bildgenerator(a.modell)
    print(f"Kör på: {gen.enhet}" + ("  (CPU är långsamt, räkna med minuter per bild)" if gen.enhet == "cpu" else ""))
    for sökväg in gen.generera_och_spara(
        a.prompt, a.ut, negativ_prompt=a.negativ, antal=a.antal, steg=a.steg,
        styrka=a.styrka, bredd=a.bredd, höjd=a.höjd, seed=a.seed,
        startbild=startbild, förändring=a.förändring,
    ):
        print("Sparade", sökväg)


if __name__ == "__main__":
    main()
