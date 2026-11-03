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
    p.add_argument("--bredd", type=int, default=512)
    p.add_argument("--höjd", type=int, default=512)
    p.add_argument("--seed", type=int, default=None, help="Samma seed ger samma bild")
    p.add_argument("--modell", default=STANDARDMODELL)
    p.add_argument("--ut", default="bilder", help="Mapp att spara i")
    a = p.parse_args()

    print(f"Laddar modell {a.modell} (första gången laddas den ner)...")
    gen = Bildgenerator(a.modell)
    print(f"Kör på: {gen.enhet}" + ("  (CPU är långsamt, räkna med minuter per bild)" if gen.enhet == "cpu" else ""))
    for sökväg in gen.generera_och_spara(
        a.prompt, a.ut, negativ_prompt=a.negativ, antal=a.antal, steg=a.steg,
        styrka=a.styrka, bredd=a.bredd, höjd=a.höjd, seed=a.seed,
    ):
        print("Sparade", sökväg)


if __name__ == "__main__":
    main()
