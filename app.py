"""Webbgränssnitt:  python app.py   (öppnar http://127.0.0.1:7860)"""
import gradio as gr
from PIL import Image

from bildgenerator.kärna import (
    BILDMAPP, FORMAT, PROFILER, STANDARDMODELL, STILAR, Bildgenerator, MinnesFel,
    lista_bilder, läs_metadata, spara_bild,
)

_gen = None
_gen_namn = None


def hämta_generator(modell):
    """Laddar modellen första gången, och byter (frigör den gamla) om man väljer en annan."""
    global _gen, _gen_namn
    if _gen is None or _gen_namn != modell:
        if _gen is not None:
            _gen.frigör()
            _gen = None
        _gen = Bildgenerator(modell)
        _gen_namn = modell
    return _gen


def historik():
    return [str(f) for f in lista_bilder(BILDMAPP)]


def kör(prompt, stil, negativ, modell, format, antal, uppskala, steg, styrka, seed, startbild,
        förändring, progress=gr.Progress()):
    try:
        progress(0, desc="Laddar modellen (första gången laddas den ner)")
        gen = hämta_generator(modell)
        res = gen.generera(
            prompt, negativ or "", int(antal),
            int(steg) if steg else None,
            float(styrka) if styrka is not None else None,
            seed=int(seed) if seed is not None and seed >= 0 else None,
            startbild=startbild, förändring=float(förändring), format=format, stil=stil,
            uppskala=float(uppskala), framsteg=lambda andel, text: progress(andel, desc=text),
        )
    except (ValueError, MinnesFel, RuntimeError) as e:
        raise gr.Error(str(e))
    i = gen.senaste_inställningar
    sökvägar = [str(spara_bild(bild, s, i, BILDMAPP)) for bild, s in res]
    status = f"{i['modell']} · {i['storlek']} · {i['steg']} steg · sparade i `{BILDMAPP}/`" + (
        "  ·  negativ prompt används inte av den här modellen" if negativ and not gen.profil.negativ else "")
    return [(p, f"seed {s}") for p, (_, s) in zip(sökvägar, res)], status, sökvägar, None, historik()


def välj(sökvägar, evt: gr.SelectData):
    """Kom ihåg vilken bild i ett galleri som är vald, och visa dess inställningar."""
    if not sökvägar or evt.index is None or evt.index >= len(sökvägar):
        return None, ""
    sökväg = sökvägar[evt.index]
    m = läs_metadata(sökväg)
    rader = [f"**{k}:** {m[k]}" for k in
             ("prompt", "stil", "seed", "modell", "storlek", "steg", "uppskala", "förändring") if m.get(k)]
    return sökväg, "  \n".join(rader)


def som_startbild(sökväg):
    if not sökväg:
        raise gr.Error("Klicka först på en bild.")
    return Image.open(sökväg).convert("RGB")


def återanvänd(sökväg):
    """Fyll i prompt, stil och seed från en sparad bild."""
    if not sökväg:
        raise gr.Error("Klicka först på en bild.")
    m = läs_metadata(sökväg)
    stil = m.get("stil") if m.get("stil") in STILAR else "ingen"
    return m.get("prompt", ""), stil, int(m.get("seed", -1))


with gr.Blocks(title="Bildgenerator") as demo:
    gr.Markdown("# Bildgenerator\nBeskriv en bild så skapar AI:n den, eller ladda upp en startbild och beskriv hur den ska ändras. "
                "Engelska prompts ger oftast bäst resultat.")
    resultat_filer = gr.State([])
    historik_filer = gr.State(historik())
    vald = gr.State(None)

    prompt = gr.Textbox(label="Prompt", lines=3,
                        placeholder="a quiet lake at dusk, mountains in mist, soft warm light")
    with gr.Row():
        stil = gr.Dropdown(list(STILAR), value="ingen", label="Stil")
        format = gr.Dropdown(list(FORMAT), value="1:1", label="Format")
        antal = gr.Slider(1, 4, value=1, step=1, label="Antal bilder")
        uppskala = gr.Slider(1, 2, value=1, step=0.25, label="Uppskalning",
                             info="Över 1: större bild med fler detaljer, men långsammare.")
    with gr.Row():
        startbild = gr.Image(type="pil", label="Startbild (valfritt, för bild-till-bild)")
        förändring = gr.Slider(0.1, 1.0, value=0.75, step=0.05,
                               label="Förändring (lågt = nära startbilden, högt = mer fri)")
    with gr.Accordion("Avancerat", open=False):
        modell = gr.Dropdown(["auto", *PROFILER], value=STANDARDMODELL, label="Modell",
                             info="auto väljer utifrån ditt grafikkort. Byte laddar om modellen.")
        negativ = gr.Textbox(label="Negativ prompt (bara sd15)", placeholder="blurry, low quality")
        with gr.Row():
            steg = gr.Number(value=None, precision=0, label="Steg (tomt = modellens standard)")
            styrka = gr.Number(value=None, label="Promptstyrka (tomt = modellens standard)")
            seed = gr.Number(value=-1, precision=0, label="Seed (-1 = slumpmässig)")
    knapp = gr.Button("Generera", variant="primary")
    status = gr.Markdown()

    with gr.Tab("Resultat"):
        galleri = gr.Gallery(label="Resultat", columns=2)
    with gr.Tab("Historik"):
        gamla = gr.Gallery(label=f"Sparade bilder i {BILDMAPP}/", value=historik(), columns=4)
    info = gr.Markdown()
    with gr.Row():
        till_start = gr.Button("Använd vald bild som startbild")
        igen = gr.Button("Återanvänd prompt och seed")

    knapp.click(
        kör,
        [prompt, stil, negativ, modell, format, antal, uppskala, steg, styrka, seed, startbild, förändring],
        [galleri, status, resultat_filer, vald, gamla],
    ).then(historik, None, historik_filer)
    galleri.select(välj, resultat_filer, [vald, info])
    gamla.select(välj, historik_filer, [vald, info])
    till_start.click(som_startbild, vald, startbild)
    igen.click(återanvänd, vald, [prompt, stil, seed])

if __name__ == "__main__":
    demo.launch()
