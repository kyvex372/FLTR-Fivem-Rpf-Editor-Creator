import { useEffect, useMemo, useState } from "react";
import { api, dokuUrl, NOTR_RENK } from "./api";
import type { BelgeBaglami } from "./Belge";
import { hexCoz, Ikon, Kaydirici, useArayuz } from "./ortak";
import { anahtarUyar, sayiAralik, tonuTasi, type Hazir } from "./hazirlar";
import { RenkSatiri, sayiCoz, sayiYaz, tabanAl, useAyarYazici } from "./AyarEditoru";
import { hazirlariEsle, type AyarDosyasi, useTarama } from "./tarama";

function AyarBolumu({
  hazir,
  dosya,
  ozetId,
  guncelle,
  yolGoster,
}: {
  hazir: Hazir;
  dosya: AyarDosyasi;
  ozetId: number;
  guncelle: BelgeBaglami["guncelle"];
  yolGoster: boolean;
}) {
  const { taslak, yenilendi, ayarla } = useAyarYazici(ozetId, dosya.yol, guncelle);
  useEffect(yenilendi, [dosya, yenilendi]);
  const taban = tabanAl(ozetId, dosya.yol, dosya.girdiler);
  const deger = (k: string) => taslak[k] ?? dosya.girdiler.find((g) => g.anahtar === k)?.deger ?? "0";

  const renkler = dosya.renkler.filter((r) => anahtarUyar(hazir, r.taban));
  const renkAnahtari = new Set(renkler.flatMap((r) => r.anahtarlar));
  const sayilar = dosya.girdiler.filter((g) => anahtarUyar(hazir, g.anahtar) && !renkAnahtari.has(g.anahtar) && Number.isFinite(sayiCoz(g.deger)));
  const onek = (k: string) => hazir.onekler.find((o) => k.toLowerCase().startsWith(o.toLowerCase())) ?? "";
  const kisa = (k: string) => k.slice(onek(k).length) || k;

  const altGruplar = new Map<string, typeof sayilar>();
  for (const g of sayilar) {
    const p = kisa(g.anahtar).split(".");
    const alt = p.length > 1 ? `${onek(g.anahtar)}${p.slice(0, -1).join(".")}` : onek(g.anahtar);
    if (!altGruplar.has(alt)) altGruplar.set(alt, []);
    altGruplar.get(alt)!.push(g);
  }

  const degisen = [...renkAnahtari, ...sayilar.map((g) => g.anahtar)].filter((k) => deger(k) !== (taban.get(k) ?? deger(k)));

  return (
    <>
      {yolGoster && <div className="soluk">{dosya.yol}</div>}
      {degisen.length > 0 && (
        <div className="satir-eylem">
          <span className="rozet sari">{degisen.length} ayar değişti</span>
          <button className="dugme kucuk" onClick={() => ayarla(Object.fromEntries(degisen.map((k) => [k, taban.get(k)!])))}>
            <Ikon ad="geri" /> Bu bölümü ilk haline döndür
          </button>
        </div>
      )}
      {renkler.length > 0 && (
        <div className="ayar-grubu">
          <h4>Renkler</h4>
          <div className="renk-izgara">
            {renkler.map((r) => (
              <RenkSatiri key={r.taban} r={r} deger={deger} ayarla={ayarla} etiket={kisa(r.taban)} />
            ))}
          </div>
        </div>
      )}
      {[...altGruplar.entries()].map(([alt, girdiler]) => (
        <div className="ayar-grubu" key={alt}>
          <h4>{alt.replace(/\.$/, "") || hazir.ad}</h4>
          <div className="sayi-izgara">
            {girdiler.map((g) => {
              const t = taban.get(g.anahtar) ?? g.deger;
              const v = sayiCoz(deger(g.anahtar));
              const [min, max] = sayiAralik(g.anahtar, sayiCoz(t));
              return (
                <Kaydirici
                  key={g.anahtar}
                  etiket={kisa(g.anahtar).split(".").pop()!}
                  baslik={`${g.anahtar}\nilk değer: ${t}`}
                  deger={v}
                  min={Math.min(min, v)}
                  max={Math.max(max, v)}
                  vurgu={deger(g.anahtar) !== t}
                  degisti={(x) => ayarla({ [g.anahtar]: sayiYaz(x, max - min > 20 && Number.isInteger(sayiCoz(t))) })}
                />
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

export function HazirPanel({ hazir, ozet, surum, guncelle, ac }: BelgeBaglami & { hazir: Hazir }) {
  const ui = useArayuz();
  const { tarama } = useTarama(ozet, surum);
  const [hedefRenk, setHedefRenk] = useState("#e5243b");
  const [renklereUygula, setRenklereUygula] = useState(true);
  const [dokulaUygula, setDokulaUygula] = useState(true);
  const eslesme = useMemo(() => (tarama ? hazirlariEsle(tarama).find((e) => e.hazir.id === hazir.id) : undefined), [tarama, hazir.id]);
  const ayarDosyalari = tarama?.ayarlar.filter((a) => a.girdiler.some((g) => anahtarUyar(hazir, g.anahtar))) ?? [];

  const tekRenk = async () => {
    if (!tarama || !eslesme) return;
    const hedef = hexCoz(hedefRenk);
    const s = await ui.mesgul("Renk uygulanıyor", async () => {
      let o = null;
      let adim = 0;
      if (renklereUygula) {
        for (const a of ayarDosyalari) {
          const degerler = new Map(a.girdiler.map((g) => [g.anahtar, sayiCoz(g.deger)]));
          const yeni: [string, string][] = [];
          for (const r of a.renkler.filter((r) => anahtarUyar(hazir, r.taban))) {
            const mevcut = r.anahtarlar.map((k) => ((degerler.get(k) ?? 0) * 255) / r.olcek) as [number, number, number];
            const sonuc = tonuTasi(mevcut, hedef);
            r.anahtarlar.forEach((k, i) => yeni.push([k, sayiYaz((sonuc[i] * r.olcek) / 255, r.olcek === 255)]));
          }
          if (yeni.length) {
            o = await api.vsAyarla(ozet.id, a.yol, yeni);
            adim++;
          }
        }
      }
      if (dokulaUygula) {
        const ytdler = new Map<string, number[]>();
        for (const d of eslesme.dokular.filter((d) => d.doku.destekli)) ytdler.set(d.yol, [...(ytdler.get(d.yol) ?? []), d.doku.i]);
        for (const [yol, indeksler] of ytdler) {
          o = await api.dokuRenklendir(ozet.id, yol, indeksler, { ...NOTR_RENK, boya: hedef, boya_gucu: 1 });
          adim++;
        }
      }
      return { o, adim };
    });
    if (s?.o) {
      guncelle(s.o);
      ui.bildir(`Renk uygulandı (${s.adim} geri-al adımı)`, "tamam");
    }
  };

  if (!tarama) return <div className="bilgi-kutu">İçerik taranıyor…</div>;

  return (
    <div className="kaydir">
      <div className="hazir-panel">
        <div className="hazir-ust">
          <div>
            <h2>{hazir.ad}</h2>
            <p>{hazir.aciklama}</p>
          </div>
          <div className="tek-renk" title="Bu bölümdeki bütün renklerin tonunu seçilen renge çevirir; her rengin kendi parlaklığı korunur.">
            <input type="color" value={hedefRenk} onChange={(e) => setHedefRenk(e.target.value)} />
            <label className="soluk">
              <input type="checkbox" checked={renklereUygula} onChange={(e) => setRenklereUygula(e.target.checked)} /> ayarlar
            </label>
            {!!eslesme?.dokular.length && (
              <label className="soluk">
                <input type="checkbox" checked={dokulaUygula} onChange={(e) => setDokulaUygula(e.target.checked)} /> dokular
              </label>
            )}
            <button className="dugme birincil kucuk" onClick={tekRenk} disabled={!renklereUygula && !dokulaUygula}>
              <Ikon ad="palet" /> Tek renge boya
            </button>
          </div>
        </div>

        {ayarDosyalari.map((a) => (
          <AyarBolumu key={a.yol} hazir={hazir} dosya={a} ozetId={ozet.id} guncelle={guncelle} yolGoster={ayarDosyalari.length > 1} />
        ))}

        {!!eslesme?.dokular.length && (
          <div className="ayar-grubu">
            <h4>Dokular — tıkla ve düzenle, ya da görseli üstüne bırak</h4>
            <div className="kucuk-dokular">
              {eslesme.dokular.map(({ yol, doku }) => (
                <div
                  key={`${yol}#${doku.i}`}
                  className="doku-kart"
                  data-birak={`doku:${ozet.id}:${doku.i}:${yol}`}
                  onClick={() => ac(`${yol}#${doku.i}`)}
                  title={`${yol}\n${doku.ad} · ${doku.genislik}×${doku.yukseklik} ${doku.bicim}`}
                >
                  <div className="resim dama">
                    {doku.destekli && <img src={dokuUrl(ozet.id, yol, doku.i, 128, surum)} loading="lazy" draggable={false} alt="" />}
                  </div>
                  <div className="alt">
                    <b>{doku.ad}</b>
                    <span>
                      {doku.genislik}×{doku.yukseklik}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
