export interface YaziAyari {
  metin: string;
  font: string;
  kalin: boolean;
  renk: string;
  kontur: number;
  konturRenk: string;
}

export const FONTLAR = ["Segoe UI", "Bahnschrift", "Arial Black", "Impact", "Trebuchet MS", "Georgia", "Consolas"];

/** Yazıyı saydam zemine yüksek çözünürlükte çizer; haritaya işlenecek PNG'yi ve boyutunu döndürür. */
export async function yaziCiz(o: YaziAyari): Promise<{ bayt: Uint8Array; w: number; h: number }> {
  const punto = 220;
  const tuval = document.createElement("canvas");
  const x = tuval.getContext("2d")!;
  const font = `${o.kalin ? "bold " : ""}${punto}px "${o.font}"`;
  x.font = font;
  const satirlar = o.metin.split("\n");
  const genislik = Math.max(...satirlar.map((s) => x.measureText(s).width));
  const bosluk = o.kontur + 24;
  const satirBoyu = punto * 1.2;
  tuval.width = Math.ceil(genislik + bosluk * 2);
  tuval.height = Math.ceil(satirBoyu * satirlar.length + bosluk * 2);
  x.font = font;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.lineJoin = "round";
  satirlar.forEach((s, i) => {
    const y = bosluk + satirBoyu * (i + 0.5);
    if (o.kontur > 0) {
      x.lineWidth = o.kontur * 2;
      x.strokeStyle = o.konturRenk;
      x.strokeText(s, tuval.width / 2, y);
    }
    x.fillStyle = o.renk;
    x.fillText(s, tuval.width / 2, y);
  });
  const blob = await new Promise<Blob>((coz, reddet) => tuval.toBlob((b) => (b ? coz(b) : reddet(new Error("yazı çizilemedi"))), "image/png"));
  return { bayt: new Uint8Array(await blob.arrayBuffer()), w: tuval.width, h: tuval.height };
}
