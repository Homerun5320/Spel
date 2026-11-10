"""Kommandorad:  python -m bildgenerator "en röd drake över ett berg" """
import argparse

from .kärna import FORMAT, PROFILER, STANDARDMODELL, STILAR, Bildgenerator, MinnesFel, läs_metadata


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
    p.add_argument("--stil", default="ingen", choices=list(STILAR), help="Stil som läggs till prompten")
    p.add_argument("--uppskala", type=float, default=1.0, metavar="1-2",
                   help="Förstora och rita om lätt för fler detaljer, t.ex. 1.5 (långsammare, mer minne)")
    p.add_argument("--bredd", type=int, default=None, help="Åsidosätter --format")
    p.add_argument("--höjd", type=int, default=None)
    p.add_argument("--bild", help="Startbild för bild-till-bild (sökväg till en bildfil)")
    p.add_argument("--förändring", type=float, default=0.75,
                   help="0-1: hur mycket startbilden får ändras (lågt = nära originalet)")
    p.add_argument("--seed", type=int, default=None, help="Samma seed ger samma bild")
    p.add_argument("--modell", default=STANDARDMODELL, help="auto, z-image-turbo, flux-schnell, sd15 eller ett Hugging Face-id")
    p.add_argument("--avlasta", action="store_true", help="Tvinga avlastning till processorminnet (mindre VRAM, långsammare)")
    p.add_argument("--lista-modeller", action="store_true", help="Visa tillgängliga modeller och avsluta")
    p.add_argument("--visa-info", metavar="FIL", help="Visa prompt, seed och inställningar för en sparad bild")
    p.add_argument("--ut", default="bilder", help="Mapp att spara i")
    a = p.parse_args()

    if a.lista_modeller:
        lista_modeller()
        return
    if a.visa_info:
        try:
            info = läs_metadata(a.visa_info)
        except OSError as e:
            p.error(f"Kunde inte läsa {a.visa_info!r}: {e}")
        if not info:
            print("Bilden har inga sparade inställningar.")
        for nyckel, värde in info.items():
            print(f"{nyckel}: {värde}")
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
    try:
        gen = Bildgenerator(a.modell, avlasta=True if a.avlasta else None)
    except RuntimeError as e:
        raise SystemExit(str(e))
    pr = gen.profil
    print(f"Modell: {pr.namn} ({gen.repo}), licens {pr.licens}")
    print(f"Kör på: {gen.enhet}" + (" med avlastning" if gen.avlasta else "")
          + ("  (CPU är långsamt, räkna med minuter per bild)" if gen.enhet == "cpu" else ""))
    try:
        sökvägar = gen.generera_och_spara(
            a.prompt, a.ut, negativ_prompt=a.negativ, antal=a.antal, steg=a.steg,
            styrka=a.styrka, bredd=a.bredd, höjd=a.höjd, seed=a.seed, format=a.format,
            startbild=startbild, förändring=a.förändring, stil=a.stil, uppskala=a.uppskala,
        )
    except (ValueError, MinnesFel) as e:
        raise SystemExit(f"Fel: {e}")
    for sökväg in sökvägar:
        print("Sparade", sökväg)


if __name__ == "__main__":
    main()
