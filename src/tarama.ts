import { useEffect, useState } from "react";
import { api, type BelgeOzet, type DokuBilgi, type Girdi, type RenkUclusu, tumDugumler, uzanti } from "./api";
import { anahtarUyar, HAZIRLAR, type Hazir } from "./hazirlar";

export interface AyarDosyasi {
  yol: string;
  girdiler: Girdi[];
  renkler: RenkUclusu[];
}

export interface YtdDosyasi {
  yol: string;
  dokular: DokuBilgi[];
}

export interface Tarama {
  ayarlar: AyarDosyasi[];
  ytdler: YtdDosyasi[];
  atlananYtd: number;
}

const YTD_SINIRI = 16;
const YTD_BOYUT_SINIRI = 12 * 1024 * 1024;
const onbellek = new Map<string, Promise<Tarama>>();

async function tara(o: BelgeOzet): Promise<Tarama> {
  const dugumler = tumDugumler(o.agac).filter((d) => d.tur === "dosya");
  const ayarYollari = dugumler.filter((d) => d.ad.toLowerCase() === "visualsettings.dat").map((d) => d.yol);
  const ytdAdaylari = dugumler.filter((d) => uzanti(d.ad) === "ytd").sort((a, b) => a.kayitli - b.kayitli);
  const ytdYollari = ytdAdaylari.filter((d) => d.kayitli <= YTD_BOYUT_SINIRI).slice(0, YTD_SINIRI).map((d) => d.yol);
  const [ayarlar, ytdler] = await Promise.all([
    Promise.all(ayarYollari.map(async (yol) => ({ yol, ...(await api.vsOku(o.id, yol)) }))),
    Promise.all(ytdYollari.map(async (yol) => ({ yol, dokular: await api.ytdListesi(o.id, yol).catch(() => []) }))),
  ]);
  return { ayarlar, ytdler, atlananYtd: ytdAdaylari.length - ytdYollari.length };
}

export function useTarama(o: BelgeOzet, surum: number) {
  const [sonuc, setSonuc] = useState<Tarama | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  useEffect(() => {
    const anahtar = `${o.id}:${surum}`;
    let p = onbellek.get(anahtar);
    if (!p) {
      p = tara(o);
      onbellek.set(anahtar, p);
      for (const k of onbellek.keys()) if (k.startsWith(`${o.id}:`) && k !== anahtar) onbellek.delete(k);
    }
    let iptal = false;
    p.then((t) => !iptal && setSonuc(t)).catch((e) => !iptal && setHata(String(e)));
    return () => {
      iptal = true;
    };
  }, [o, surum]);
  return { tarama: sonuc, hata };
}

export interface HazirEslesme {
  hazir: Hazir;
  anahtarSayisi: number;
  renkler: string[];
  dokular: { yol: string; doku: DokuBilgi }[];
}

export function hazirlariEsle(t: Tarama): HazirEslesme[] {
  return HAZIRLAR.map((hazir) => {
    let anahtarSayisi = 0;
    const renkler: string[] = [];
    for (const a of t.ayarlar) {
      const degerler = new Map(a.girdiler.map((g) => [g.anahtar, parseFloat(g.deger)]));
      anahtarSayisi += a.girdiler.filter((g) => anahtarUyar(hazir, g.anahtar)).length;
      for (const r of a.renkler.filter((r) => anahtarUyar(hazir, r.taban))) {
        const c = r.anahtarlar.map((k) => ((degerler.get(k) ?? 0) * 255) / r.olcek);
        renkler.push(`rgb(${c.map((x) => Math.round(Math.min(255, Math.max(0, x)))).join(",")})`);
      }
    }
    const dokular = hazir.dokular
      ? t.ytdler.flatMap((y) => y.dokular.filter((d) => hazir.dokular!.test(d.ad)).map((doku) => ({ yol: y.yol, doku })))
      : [];
    return { hazir, anahtarSayisi, renkler, dokular };
  }).filter((e) => e.anahtarSayisi > 0 || e.dokular.length > 0);
}
