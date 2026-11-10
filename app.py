"""Webbgränssnitt:  python app.py   (öppnar http://127.0.0.1:7860)"""
import gradio as gr

from bildgenerator.kärna import STANDARDMODELL, Bildgenerator

_gen = None


def hämta_generator():
    global _gen
    if _gen is None:  # laddas först vid första klicket
        _gen = Bildgenerator(STANDARDMODELL)
    return _gen


def kör(prompt, negativ, antal, steg, styrka, bredd, höjd, seed, startbild, förändring):
    try:
        res = hämta_generator().generera(
            prompt, negativ, int(antal), int(steg), float(styrka),
            int(bredd) if startbild is None else None,
            int(höjd) if startbild is None else None,
            int(seed) if seed >= 0 else None,
            startbild, float(förändring),
        )
    except ValueError as e:
        raise gr.Error(str(e))
    return [(bild, f"seed {s}") for bild, s in res]


with gr.Blocks(title="Bildgenerator") as demo:
    gr.Markdown("# Bildgenerator\nBeskriv en bild så skapar AI:n den, eller ladda upp en startbild och beskriv hur den ska ändras. Engelska prompts ger oftast bäst resultat.")
    prompt = gr.Textbox(label="Prompt", placeholder="a red dragon flying over a snowy mountain, digital art", lines=2)
    negativ = gr.Textbox(label="Negativ prompt (valfritt)", placeholder="blurry, low quality")
    with gr.Row():
        antal = gr.Slider(1, 4, value=1, step=1, label="Antal bilder")
        steg = gr.Slider(10, 60, value=30, step=1, label="Steg")
        styrka = gr.Slider(1, 15, value=7.5, step=0.5, label="Promptstyrka")
    with gr.Row():
        bredd = gr.Slider(256, 768, value=512, step=64, label="Bredd")
        höjd = gr.Slider(256, 768, value=512, step=64, label="Höjd")
        seed = gr.Number(value=-1, precision=0, label="Seed (-1 = slumpmässig)")
    with gr.Row():
        startbild = gr.Image(type="pil", label="Startbild (valfritt, för bild-till-bild)")
        förändring = gr.Slider(0.1, 1.0, value=0.75, step=0.05,
                               label="Förändring (lågt = nära startbilden, högt = mer fri)")
    knapp = gr.Button("Generera", variant="primary")
    galleri = gr.Gallery(label="Resultat")
    knapp.click(kör, [prompt, negativ, antal, steg, styrka, bredd, höjd, seed, startbild, förändring], galleri)

if __name__ == "__main__":
    demo.launch()
