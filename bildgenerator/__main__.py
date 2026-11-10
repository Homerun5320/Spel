"""Kommandorad:  python -m bildgenerator "en röd drake över ett berg" """
import argparse

from .kärna import FORMAT, PROFILER, STANDARDMODELL, Bildgenerator


def lista_modeller():
    print("Modeller (--modell):")
    print("  auto           väljer själv: z-image-turbo om grafikkortet har minst 14 GB, annars sd15")
    for p in PROFILER.values():
        print(f"  {p.namn:<14} {p.beskrivning} [{p.licens}, {p.steg} steg]")
    print("  <id>           eget Hugging Face-id (antas vara Stable Diffusion 1.x)")


def main():
    p = argparse.ArgumentParser(prog="bildgenerator", description="Generera bilder från text.")
    p.add_argument("prompt", nargs="?", help="Beskrivning av bilden (engelska ger oftast bäst resultat)")
    p.add_argument("-n", "--negativ", default="", help="Det du inte vill ha med (bara sd15)")
    p.add_argument("--antal", type=int, default=1)
    p.add_argument("--steg", type=int, default=None, help="Standard: modellens rekommenderade")
    p.add_argument("--styrka", type=float, default=None, help="Hur strikt prompten följs (standard: modellens)")
    p.add_argument("--format", default="1:1", choices=list(FORMAT), help="Bildformat")
    p.add_argument("--bredd", type=int, default=None, help="Åsidosätter --format")
    p.add_argument("--höjd", type=int, default=None)
    p.add_argument("--bild", help="Startbild för bild-till-bild (sökväg till en bildfil)")
    p.add_argument("--förändring", type=float, default=0.75,
                   help="0-1: hur mycket startbilden får ändras (lågt = nära originalet)")
    p.add_argument("--seed", type=int, default=None, help="Samma seed ger samma bild")
    p.add_argument("--modell", default=STANDARDMODELL, help="auto, z-image-turbo, flux-schnell, sd15 eller ett Hugging Face-id")
    p.add_argument("--avlasta", action="store_true", help="Tvinga avlastning till processorminnet (mindre VRAM, långsammare)")
    p.add_argument("--lista-modeller", action="store_true", help="Visa tillgängliga modeller och avsluta")
    p.add_argument("--ut", default="bilder", help="Mapp att spara i")
    a = p.parse_args()

    if a.lista_modeller:
        lista_modeller()
        return
    if not a.prompt:
        p.error("ange en prompt (eller --lista-modeller)")

    startbild = None
    if a.bild:
        from PIL import Image

        try:
            startbild = Image.open(a.bild)
        except OSError as e:
            p.error(f"Kunde inte öppna startbilden {a.bild!r}: {e}")

    print(f"Laddar modell '{a.modell}' (första gången laddas den ner, kan vara flera GB)...")
    gen = Bildgenerator(a.modell, avlasta=True if a.avlasta else None)
    pr = gen.profil
    print(f"Modell: {pr.namn} ({pr.repo}), licens {pr.licens}")
    print(f"Kör på: {gen.enhet}" + (" med avlastning" if gen.avlasta else "")
          + ("  (CPU är långsamt, räkna med minuter per bild)" if gen.enhet == "cpu" else ""))
    for sökväg in gen.generera_och_spara(
        a.prompt, a.ut, negativ_prompt=a.negativ, antal=a.antal, steg=a.steg,
        styrka=a.styrka, bredd=a.bredd, höjd=a.höjd, seed=a.seed, format=a.format,
        startbild=startbild, förändring=a.förändring,
    ):
        print("Sparade", sökväg)


if __name__ == "__main__":
    main()
