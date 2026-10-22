import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Girdi, type RenkUclusu } from "./api";
import type { BelgeBaglami } from "./Belge";
import { hex, hexCoz, Ikon, useArayuz, useGeciktir } from "./ortak";
import { sayiAralik } from "./hazirlar";

const tabanDegerler = new Map<string, Map<string, string>>();

export function tabanAl(id: number, yol: string, girdiler: Girdi[]) {
  const k = `${id}:${yol}`;
  let t = tabanDegerler.get(k);
  if (!t) {
    t = new Map(girdiler.map((g) => [g.anahtar, g.deger]));
    tabanDegerler.set(k, t);
  }
  return t;
}

export const sayiCoz = (v: string) => parseFloat(v.replace(/[fF]$/, ""));

export function sayiYaz(v: number, olcek255: boolean) {
  if (olcek255) return String(Math.round(v));
  return String(Number(v.toFixed(4)));
}

/** Ayar dosyası üzerinde gecikmeli toplu yazım: her toplu yazım tek geri-al adımı. */
export function useAyarYazici(ozetId: number, yol: string, guncelle: BelgeBaglami["guncelle"]) {
  const ui = useArayuz();
  const [taslak, setTaslak] = useState<Record<string, string>>({});
  const bekleyen = useRef<Record<string, string>>({});
  const gonder = useGeciktir(async () => {
    const d = bekleyen.current;
    bekleyen.current = {};
    const cift = Object.entries(d);
    if (!cift.length) return;
    try {
      guncelle(await api.vsAyarla(ozetId, yol, cift));
    } catch (e) {
      ui.hata(e);
    }
  }, 450);
  const ayarla = (degerler: Record<string, string>) => {
    Object.assign(bekleyen.current, degerler);
    setTaslak((t) => ({ ...t, ...degerler }));
    gonder();
  };
  const yenilendi = useCallback(() => setTaslak({ ...bekleyen.current }), []);
  return { taslak, yenilendi, ayarla };
}

export function RenkSatiri({
  r,
  deger,
  ayarla,
  etiket,
}: {
  r: RenkUclusu;
  deger: (k: string) => string;
  ayarla: (d: Record<string, string>) => void;
  etiket: string;
}) {
  const kanal = r.anahtarlar.map((k) => sayiCoz(deger(k)));
  const olcek255 = r.olcek === 255;
  const renk = hex(...(kanal.map((c) => (c * 255) / r.olcek) as [number, number, number]));
  return (
    <div className="renk-kutu" title={r.anahtarlar.join("\n")}>
      <input
        type="color"
        value={renk}
        onChange={(e) => {
          const [cr, cg, cb] = hexCoz(e.target.value);
          const s = (c: number) => sayiYaz((c * r.olcek) / 255, olcek255);
          ayarla({ [r.anahtarlar[0]]: s(cr), [r.anahtarlar[1]]: s(cg), [r.anahtarlar[2]]: s(cb) });
        }}
      />
      <div>
        <b>{etiket}</b>
        <span>
          {kanal.map((c) => (olcek255 ? Math.round(c) : c.toFixed(2))).join(" · ")}
          {olcek255 ? "" : " (0–1)"}
        </span>
      </div>
    </div>
  );
}

export function AyarEditoru({ ozet, surum, guncelle, yol, ilkArama }: BelgeBaglami & { yol: string; ilkArama?: string }) {
  const ui = useArayuz();
  const [veri, setVeri] = useState<{ girdiler: Girdi[]; renkler: RenkUclusu[] } | null>(null);
  const [arama, setArama] = useState(ilkArama ?? "");
  const [acikGruplar, setAcikGruplar] = useState<Set<string>>(new Set());
  const [sadeceDegisen, setSadeceDegisen] = useState(false);
  const { taslak, yenilendi, ayarla } = useAyarYazici(ozet.id, yol, guncelle);

  useEffect(() => {
    api
      .vsOku(ozet.id, yol)
      .then((v) => {
        setVeri(v);
        yenilendi();
      })
      .catch(ui.hata);
  }, [ozet.id, yol, surum, ui, yenilendi]);

  const taban = useMemo(() => (veri ? tabanAl(ozet.id, yol, veri.girdiler) : new Map<string, string>()), [veri, ozet.id, yol]);
  const deger = (k: string) => taslak[k] ?? veri?.girdiler.find((g) => g.anahtar === k)?.deger ?? "0";

  const gruplar = useMemo(() => {
    if (!veri) return [];
    const q = arama.toLowerCase();
    const renkAnahtarlari = new Map<string, RenkUclusu>();
    for (const r of veri.renkler) for (const k of r.anahtarlar) renkAnahtarlari.set(k, r);
    const m = new Map<string, { renkler: RenkUclusu[]; girdiler: Girdi[] }>();
    for (const g of veri.girdiler) {
      if (q && !g.anahtar.toLowerCase().includes(q)) continue;
      if (sadeceDegisen && taban.get(g.anahtar) === g.deger) continue;
      const grup = g.anahtar.split(".")[0];
      if (!m.has(grup)) m.set(grup, { renkler: [], girdiler: [] });
      const e = m.get(grup)!;
      const r = renkAnahtarlari.get(g.anahtar);
      if (!r) e.girdiler.push(g);
      else if (!e.renkler.includes(r)) e.renkler.push(r);
    }
    return [...m.entries()];
  }, [veri, arama, sadeceDegisen, taban]);

  const degisenSayisi = veri ? veri.girdiler.filter((g) => taban.get(g.anahtar) !== g.deger).length : 0;

  if (!veri) return <div className="bilgi-kutu">Yükleniyor…</div>;

  return (
    <>
      <div className="duzenleyici-ust">
        <Ikon ad="ayar" />
        <h2>
          {yol}
          <small>
            {veri.girdiler.length} ayar · {veri.renkler.length} renk
          </small>
        </h2>
      </div>
      <div className="ayar-arac">
        <input className="girdi" style={{ flex: 1 }} placeholder="Ayar ara (ör. DamageOverlay, headlight, coronas)" value={arama} onChange={(e) => setArama(e.target.value)} />
        <button className={`dugme${sadeceDegisen ? " birincil" : ""}`} onClick={() => setSadeceDegisen(!sadeceDegisen)} disabled={!degisenSayisi && !sadeceDegisen}>
          Değişenler ({degisenSayisi})
        </button>
        {degisenSayisi > 0 && (
          <button
            className="dugme tehlike"
            onClick={async () => {
              if (await ui.onayla("Tüm değişiklikler geri alınsın mı?", "Bu dosyadaki ayarlar açıldığı andaki değerlerine döner.", "Geri döndür", true))
                ayarla(Object.fromEntries(veri.girdiler.filter((g) => taban.get(g.anahtar) !== g.deger).map((g) => [g.anahtar, taban.get(g.anahtar)!])));
            }}
          >
            Hepsini geri döndür
          </button>
        )}
      </div>
      <div className="kaydir">
        <div className="ayar-listesi">
          {gruplar.map(([grup, e]) => {
            const acik = !!arama || sadeceDegisen || acikGruplar.has(grup);
            return (
              <div key={grup}>
                <div
                  className="grup-baslik"
                  onClick={() => setAcikGruplar((s) => new Set(s.has(grup) ? [...s].filter((x) => x !== grup) : [...s, grup]))}
                >
                  <Ikon ad={acik ? "ok-asagi" : "ok-sag"} boy={12} />
                  {grup}
                  <small>
                    {e.girdiler.length + e.renkler.length * 3} ayar{e.renkler.length ? ` · ${e.renkler.length} renk` : ""}
                  </small>
                  {!acik && (
                    <span className="renk-seridi" style={{ marginLeft: 8 }}>
                      {e.renkler.slice(0, 12).map((r) => (
                        <i key={r.taban} style={{ background: hex(...(r.anahtarlar.map((k) => (sayiCoz(deger(k)) * 255) / r.olcek) as [number, number, number])) }} />
                      ))}
                    </span>
                  )}
                </div>
                {acik && (
                  <>
                    {e.renkler.length > 0 && (
                      <div className="renk-izgara" style={{ padding: "4px 6px 10px 28px" }}>
                        {e.renkler.map((r) => (
                          <RenkSatiri key={r.taban} r={r} deger={deger} ayarla={ayarla} etiket={r.taban.slice(grup.length + 1) || r.taban} />
                        ))}
                      </div>
                    )}
                    {e.girdiler.map((g) => {
                      const d = deger(g.anahtar);
                      const t = taban.get(g.anahtar) ?? g.deger;
                      const sayi = sayiCoz(d);
                      const sayisal = Number.isFinite(sayi) && Number.isFinite(sayiCoz(t));
                      const [min, max] = sayisal ? sayiAralik(g.anahtar, sayiCoz(t)) : [0, 1];
                      return (
                        <div key={g.anahtar} className={`ayar-satiri${d !== t ? " degisik" : ""}`}>
                          <span className="anahtar-adi" title={`${g.anahtar}\nsatır ${g.satir}${g.tekrar > 1 ? ` · dosyada ${g.tekrar} kez geçiyor, hepsi güncellenir` : ""}\nilk değer: ${t}`}>
                            <small>{grup}.</small>
                            {g.anahtar.slice(grup.length + 1)}
                            {g.tekrar > 1 && <small> ×{g.tekrar}</small>}
                          </span>
                          {sayisal ? (
                            <input
                              type="range"
                              min={Math.min(min, sayi)}
                              max={Math.max(max, sayi)}
                              step={max - min > 20 ? 1 : 0.001}
                              value={sayi}
                              onChange={(ev) => ayarla({ [g.anahtar]: ev.target.value })}
                            />
                          ) : (
                            <span />
                          )}
                          <input
                            className="girdi"
                            key={d}
                            defaultValue={d}
                            onBlur={(ev) => ev.target.value !== d && ayarla({ [g.anahtar]: ev.target.value.trim() })}
                            onKeyDown={(ev) => ev.key === "Enter" && (ev.target as HTMLInputElement).blur()}
                          />
                          {d !== t ? (
                            <button className="ikon-dugme" title={`İlk değere dön: ${t}`} onClick={() => ayarla({ [g.anahtar]: t })}>
                              <Ikon ad="geri" boy={13} />
                            </button>
                          ) : (
                            <span />
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
