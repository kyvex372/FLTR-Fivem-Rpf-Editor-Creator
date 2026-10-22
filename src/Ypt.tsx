import { useEffect, useMemo, useState } from "react";
import { api, type YptGrup, type YptKare } from "./api";
import type { BelgeBaglami } from "./Belge";
import { DokuEditoru } from "./DokuEditoru";
import { hex, hexCoz, Ikon, Kaydirici, useArayuz } from "./ortak";
import { boyutMu, renkMi, topluDegistir, yptSuz, type Deger } from "./yptToplu";

type Tur = "hepsi" | YptGrup["tur"];

const ETIKETLER: Record<string, string> = {
  "ptxu_Colour:m_rgbaMinKFP": "Renk (en az)",
  "ptxu_Colour:m_rgbaMaxKFP": "Renk (en çok)",
  "ptxu_Colour:m_emissiveIntensityKFP": "Parlama gücü",
  "ptxu_Size:m_whdMinKFP": "Boyut (en az)",
  "ptxu_Size:m_whdMaxKFP": "Boyut (en çok)",
  "ptxu_Light:m_rgbMinKFP": "Işık rengi (en az)",
  "ptxu_Light:m_rgbMaxKFP": "Işık rengi (en çok)",
  "ptxu_Light:m_intensityKFP": "Işık gücü",
  "ptxu_Light:m_rangeKFP": "Işık menzili",
  "ptxu_Light:m_coronaRgbMinKFP": "Hale rengi (en az)",
  "ptxu_Light:m_coronaRgbMaxKFP": "Hale rengi (en çok)",
  "ptxu_Light:m_coronaIntensityKFP": "Hale gücü",
  "ptxu_Light:m_coronaSizeKFP": "Hale boyutu",
  "ptxEffectRule:m_colourTintMinKFP": "Efekt renk tonu (en az)",
  "ptxEffectRule:m_colourTintMaxKFP": "Efekt renk tonu (en çok)",
  "ptxEffectRule:m_zoomScalarKFP": "Efekt ölçeği",
  "ptxEmitterRule:m_spawnRateOverTimeKFP": "Doğma hızı (zamanla)",
  "ptxEmitterRule:m_spawnRateOverDistKFP": "Doğma hızı (mesafeyle)",
  "ptxEmitterRule:m_particleLifeKFP": "Parçacık ömrü",
  "ptxEmitterRule:m_sizeScalarKFP": "Boyut çarpanı",
  "ptxEmitterRule:m_speedScalarKFP": "Hız çarpanı",
  "ptxEmitterRule:m_playbackRateScalarKFP": "Oynatma hızı",
  "ptxu_Decal:m_alphaKFP": "İz saydamlığı",
  "ptxu_Decal:m_dimensionsKFP": "İz boyutu",
};
const TUR_ADI: Record<YptGrup["tur"], string> = { efekt: "efekt", yayici: "yayıcı", parcacik: "parçacık" };

const hexe = (d: number[]) => hex(...(d.slice(0, 3).map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255)) as [number, number, number]));

export function YptGorunumu(p: BelgeBaglami & { yol: string; ilkSecim?: number }) {
  const [sekme, setSekme] = useState<"ayar" | "doku">(p.ilkSecim !== undefined ? "doku" : "ayar");
  return (
    <>
      <div className="ypt-sekmeler">
        <button className={`dugme kucuk${sekme === "ayar" ? " birincil" : ""}`} onClick={() => setSekme("ayar")}>
          <Ikon ad="ayar" /> Efekt ayarları
        </button>
        <button className={`dugme kucuk${sekme === "doku" ? " birincil" : ""}`} onClick={() => setSekme("doku")}>
          <Ikon ad="resim" /> Dokular
        </button>
      </div>
      {sekme === "doku" ? <DokuEditoru {...p} /> : <EfektAyarlari {...p} />}
    </>
  );
}

function EfektAyarlari({ ozet, surum, guncelle, yol }: BelgeBaglami & { yol: string }) {
  const ui = useArayuz();
  const [gruplar, setGruplar] = useState<YptGrup[] | null>(null);
  const [arama, setArama] = useState("");
  const [tur, setTur] = useState<Tur>("hepsi");
  const [yalnizRenk, setYalnizRenk] = useState(false);
  const [bekleyen, setBekleyen] = useState<Map<number, Deger>>(new Map());
  const [gosterilen, setGosterilen] = useState(60);
  const [boya, setBoya] = useState({ renk: "#e5243b", guc: 0, ton: 0, boyut: 1, isik: 1, dogma: 1 });

  useEffect(() => {
    api.yptAyarlari(ozet.id, yol).then(setGruplar, (e) => {
      ui.hata(e);
      setGruplar([]);
    });
  }, [ozet.id, yol, surum, ui]);

  const suzulmus = useMemo(
    () => yptSuz(gruplar ?? [], arama, tur).filter((g) => !yalnizRenk || g.ozellikler.some((o) => renkMi(o.ad))),
    [gruplar, arama, tur, yalnizRenk],
  );

  const deger = (k: YptKare): Deger => bekleyen.get(k.ofs) ?? k.deger;
  const ayarla = (k: YptKare, d: Deger) => setBekleyen((b) => new Map(b).set(k.ofs, d));

  const topluUygula = () => {
    const yeni = new Map(bekleyen);
    const n = topluDegistir(suzulmus, { ...boya, boya: boya.guc > 0 ? boya.renk : undefined }, yeni);
    setBekleyen(yeni);
    setBoya({ ...boya, guc: 0, ton: 0, boyut: 1, isik: 1, dogma: 1 });
    ui.bildir(n ? `${n} değer değişti; kalıcı olması için "Uygula"` : "Süzülen efektlerde bu ayara uyan değer yok");
  };

  const yaz = async () => {
    const liste = [...bekleyen].map(([ofs, d]) => [ofs, d] as [number, number[]]);
    const o = await ui.mesgul(`${liste.length} efekt değeri yazılıyor`, () => api.yptYaz(ozet.id, yol, liste));
    if (!o) return;
    setBekleyen(new Map());
    guncelle(o);
    ui.bildir(`${liste.length} değer yazıldı. Geri almak için Ctrl+Z; oyunda görmek için Kaydet.`, "tamam");
  };

  const sayilar = useMemo(() => {
    const s = { efekt: 0, yayici: 0, parcacik: 0 };
    for (const g of gruplar ?? []) s[g.tur]++;
    return s;
  }, [gruplar]);

  return (
    <>
      <div className="duzenleyici-ust">
        <Ikon ad="pirilti" />
        <h2>
          {yol.split("/").pop()}
          <small>
            {gruplar ? `${sayilar.efekt} efekt · ${sayilar.yayici} yayıcı · ${sayilar.parcacik} parçacık ayarı` : "okunuyor"}
          </small>
        </h2>
        {bekleyen.size > 0 && (
          <>
            <button className="dugme kucuk" onClick={() => setBekleyen(new Map())}>
              Vazgeç
            </button>
            <button className="dugme kucuk birincil" onClick={yaz}>
              <Ikon ad="kaydet" /> Uygula ({bekleyen.size})
            </button>
          </>
        )}
      </div>
      <div className="doku-duzen">
        <div className="kaydir" style={{ padding: 14 }}>
          <div className="uc-arac" style={{ padding: 0, marginBottom: 10 }}>
            <input className="girdi kucuk" style={{ flex: 1 }} placeholder="Efekt ara (ör. blood, muz_pistol, fire)" value={arama} onChange={(e) => setArama(e.target.value)} />
            <div className="secenek-grubu">
              {(["hepsi", "efekt", "yayici", "parcacik"] as const).map((t) => (
                <button key={t} className={`dugme kucuk${tur === t ? " birincil" : ""}`} onClick={() => setTur(t)}>
                  {t === "hepsi" ? "Tümü" : TUR_ADI[t]}
                </button>
              ))}
            </div>
            <label className="yatay-etiket">
              <input type="checkbox" checked={yalnizRenk} onChange={(e) => setYalnizRenk(e.target.checked)} /> Renkliler
            </label>
          </div>
          {!gruplar && <span className="soluk">Efektler okunuyor…</span>}
          {gruplar && !suzulmus.length && <span className="soluk">Eşleşen efekt yok.</span>}
          {suzulmus.slice(0, gosterilen).map((g, gi) => (
            <div key={`${g.tur}${g.ad}${g.davranis}${gi}`} className="kart ypt-kart">
              <div className="kart-ust" style={{ marginBottom: 6 }}>
                <h3 style={{ fontSize: 13 }}>
                  {g.ad || "(adsız)"} <span className="rozet">{TUR_ADI[g.tur]}</span> {g.davranis && <span className="rozet sari">{g.davranis}</span>}
                </h3>
              </div>
              {g.ozellikler.map((o) => (
                <div key={o.ad} className="ypt-ozellik">
                  <span className="ypt-ad" title={o.ad}>
                    {ETIKETLER[o.ad] ?? o.ad.split(":").pop()}
                  </span>
                  <div className="ypt-kareler">
                    {o.kareler.map((k) => {
                      const d = deger(k);
                      const degisti = bekleyen.has(k.ofs);
                      return (
                        <span key={k.ofs} className={`ypt-kare${degisti ? " degisti" : ""}`} title={`zaman ${k.zaman[0].toFixed(2)}`}>
                          <small>{k.zaman[0].toFixed(2)}</small>
                          {renkMi(o.ad) ? (
                            <>
                              <input type="color" value={hexe(d)} onChange={(e) => ayarla(k, [...hexCoz(e.target.value).map((x) => x / 255), d[3]] as Deger)} />
                              {/rgba|colourTint/i.test(o.ad) && (
                                <input
                                  className="girdi kucuk"
                                  type="number"
                                  step={0.05}
                                  title="saydamlık (alfa)"
                                  value={Number(d[3].toFixed(3))}
                                  onChange={(e) => ayarla(k, [d[0], d[1], d[2], Number(e.target.value)])}
                                />
                              )}
                            </>
                          ) : (
                            d
                              .slice(0, boyutMu(o.ad) ? 3 : 1)
                              .map((x, j) => (
                                <input
                                  key={j}
                                  className="girdi kucuk"
                                  type="number"
                                  step={0.05}
                                  value={Number(x.toFixed(4))}
                                  onChange={(e) => ayarla(k, d.map((y, t) => (t === j ? Number(e.target.value) : y)) as Deger)}
                                />
                              ))
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ))}
          {suzulmus.length > gosterilen && (
            <button className="dugme kucuk" onClick={() => setGosterilen(gosterilen + 120)}>
              {suzulmus.length - gosterilen} tane daha göster
            </button>
          )}
        </div>
        <div className="doku-detay">
          <div className="ayar-grubu">
            <h4>Toplu düzenle ({suzulmus.length} sonuç)</h4>
            <span className="soluk" style={{ fontSize: 12 }}>
              Soldaki arama ve süzgeçte görünen bütün efektlere uygulanır. Örnek: "blood" ara, kırmızıyı yeşile boya; "muz" ara, namlu alevini büyüt.
            </span>
            <Kaydirici etiket="Ton kaydır" deger={boya.ton} min={-180} max={180} adim={1} degisti={(ton) => setBoya({ ...boya, ton })} />
            <div className="kaydirici">
              <label>Boya</label>
              <input type="range" min={0} max={1} step={0.01} value={boya.guc} onChange={(e) => setBoya({ ...boya, guc: Number(e.target.value) })} />
              <input type="color" value={boya.renk} onChange={(e) => setBoya({ ...boya, renk: e.target.value, guc: boya.guc || 1 })} />
            </div>
            <Kaydirici etiket="Boyut ×" deger={boya.boyut} min={0.1} max={4} degisti={(boyut) => setBoya({ ...boya, boyut })} />
            <Kaydirici etiket="Işık ×" deger={boya.isik} min={0} max={5} degisti={(isik) => setBoya({ ...boya, isik })} />
            <Kaydirici etiket="Yoğunluk ×" deger={boya.dogma} min={0} max={4} degisti={(dogma) => setBoya({ ...boya, dogma })} />
            <button className="dugme birincil" disabled={!suzulmus.length} onClick={topluUygula}>
              <Ikon ad="palet" /> Süzülenlere uygula
            </button>
            <span className="soluk" style={{ fontSize: 12 }}>
              Yoğunluk 0 yapılırsa efekt parçacık üretmez (performans modları böyle kapatır).
            </span>
          </div>
          <div className="ayar-grubu">
            <h4>Nasıl çalışır</h4>
            <span className="soluk" style={{ fontSize: 12 }}>
              Her değer bir anahtar karedir: soldaki küçük sayı efektin ömründeki zamanı (0 başlangıç, 1 son) gösterir. Değişiklikler önce bekler, sağ
              üstteki "Uygula" ile tek adımda yazılır; Ctrl+Z geri alır.
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
