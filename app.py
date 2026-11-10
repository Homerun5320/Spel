"""Webbgränssnitt:  python app.py   (öppnar http://127.0.0.1:7860)"""
import gradio as gr

from bildgenerator.kärna import FORMAT, PROFILER, STANDARDMODELL, Bildgenerator

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


def kör(prompt, negativ, modell, format, antal, steg, styrka, seed, startbild, förändring):
    try:
        gen = hämta_generator(modell)
        res = gen.generera(
            prompt, negativ or "", int(antal),
            int(steg) if steg else None,
            float(styrka) if styrka is not None else None,
            seed=int(seed) if seed >= 0 else None,
            startbild=startbild, förändring=float(förändring), format=format,
        )
    except ValueError as e:
        raise gr.Error(str(e))
    i = gen.senaste_inställningar
    status = f"{i['modell']} · {i['storlek']} · {i['steg']} steg" + (
        "  ·  negativ prompt används inte av den här modellen" if negativ and not gen.profil.negativ else "")
    return [(bild, f"seed {s}") for bild, s in res], status


with gr.Blocks(title="Bildgenerator") as demo:
    gr.Markdown("# Bildgenerator\nBeskriv en bild så skapar AI:n den, eller ladda upp en startbild och beskriv hur den ska ändras. "
                "Engelska prompts ger oftast bäst resultat.")
    prompt = gr.Textbox(label="Prompt", lines=3,
                        placeholder="a quiet lake at dusk, mountains in mist, oil painting, soft warm light")
    with gr.Row():
        modell = gr.Dropdown(["auto", *PROFILER], value=STANDARDMODELL, label="Modell",
                             info="auto väljer utifrån ditt grafikkort. Byte laddar om modellen.")
        format = gr.Dropdown(list(FORMAT), value="1:1", label="Format")
        antal = gr.Slider(1, 4, value=1, step=1, label="Antal bilder")
    with gr.Row():
        startbild = gr.Image(type="pil", label="Startbild (valfritt, för bild-till-bild)")
        förändring = gr.Slider(0.1, 1.0, value=0.75, step=0.05,
                               label="Förändring (lågt = nära startbilden, högt = mer fri)")
    with gr.Accordion("Avancerat", open=False):
        negativ = gr.Textbox(label="Negativ prompt (bara sd15)", placeholder="blurry, low quality")
        with gr.Row():
            steg = gr.Number(value=None, precision=0, label="Steg (tomt = modellens standard)")
            styrka = gr.Number(value=None, label="Promptstyrka (tomt = modellens standard)")
            seed = gr.Number(value=-1, precision=0, label="Seed (-1 = slumpmässig)")
    knapp = gr.Button("Generera", variant="primary")
    galleri = gr.Gallery(label="Resultat")
    status = gr.Markdown()
    knapp.click(kör, [prompt, negativ, modell, format, antal, steg, styrka, seed, startbild, förändring],
                [galleri, status])

if __name__ == "__main__":
    demo.launch()
