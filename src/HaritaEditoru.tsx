import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, dokuUrl, NOTR_RENK, yerelGorselUrl, type HaritaDuzeni, type Karisim, type RenkAyari } from "./api";
import type { BelgeBaglami } from "./Belge";
import { RenkAyarlari } from "./DokuEditoru";
import { Ikon, Kaydirici, useArayuz } from "./ortak";
import { FONTLAR, yaziCiz, type YaziAyari } from "./yazi";

interface Katman {
  no: number;
  gorsel: string;
  ad: string;
  merkez: [number, number];
  boyut: [number, number];
  donus: number;
  opaklik: number;
  karisim: Karisim;
  oranKilit: boolean;
  gizli: boolean;
}

interface Gorunum {
  x: number;
  y: number;
  olcek: number;
}

/** Haritaya işleme belgeyi `onceki` durumdan `sonraki`ne geçirdi; belge geri alınınca işlenen katmanlar geri gelir. */
interface Isleme {
  onceki: number;
  sonraki: number;
  katmanlar: Katman[];
  gecmis: Katman[][];
  islenen: number[];
}

interface Tarih {
  katmanlar: Katman[];
  gecmis: Katman[][];
  ileri: Katman[][];
  islemeler: Isleme[];
  geriAlinan: Isleme[];
}

interface Saklanan {
  tarih: Tarih;
  secili: number | null;
  gorunum: Gorunum;
  duzenAnahtari: string;
  goster: "sea" | "minimap";
  isle: Record<string, boolean>;
  yazi: YaziAyari;
}

// başka dosyaya geçip dönünce katmanlar ve görünüm kaybolmasın
const saklananlar = new Map<number, Saklanan>();
let katmanNo = 0;
let surukNo = 0;
const GECMIS_SINIRI = 80;
const BOS_TARIH: Tarih = { katmanlar: [], gecmis: [], ileri: [], islemeler: [], geriAlinan: [] };

type Surukleme =
  | { tur: "kaydir"; sx: number; sy: number; baslangic: Gorunum }
  | { tur: "tasi"; kimlik: string; no: number; sx: number; sy: number; merkez: [number, number] }
  | { tur: "olcek"; kimlik: string; no: number; boyut: [number, number]; uzaklik: number }
  | { tur: "don"; kimlik: string; no: number; donus: number; aci: number };

const GORSEL_UZANTILARI = ["png", "jpg", "jpeg", "webp", "bmp", "tga", "dds"];
const KARISIM_CSS: Record<Karisim, React.CSSProperties["mixBlendMode"]> = { normal: "normal", carp: "multiply", ekran: "screen" };

function gorselBoyutu(url: string) {
  return new Promise<[number, number]>((coz, reddet) => {
    const g = new Image();
    g.onload = () => coz([g.naturalWidth, g.naturalHeight]);
    g.onerror = () => reddet(new Error("görsel açılamadı"));
    g.src = url;
  });
}

export function HaritaEditoru({ ozet, surum, guncelle }: BelgeBaglami) {
  const ui = useArayuz();
  const [kayit] = useState(() => saklananlar.get(ozet.id));
  const [veri, setVeri] = useState<HaritaDuzeni | null>(null);
  const [tarih, setTarih] = useState<Tarih>(kayit?.tarih ?? BOS_TARIH);
  const katmanlar = tarih.katmanlar;
  const [secili, setSecili] = useState<number | null>(kayit?.secili ?? null);
  const [goster, setGoster] = useState<"sea" | "minimap">(kayit?.goster ?? "sea");
  const [isle, setIsle] = useState<Record<string, boolean>>(kayit?.isle ?? { sea: true, minimap: true });
  const [gorunum, setGorunum] = useState<Gorunum>(kayit?.gorunum ?? { x: 0, y: 0, olcek: 0.05 });
  const [imlec, setImlec] = useState<[number, number] | null>(null);
  const [renkAcik, setRenkAcik] = useState(false);
  const [yaziAcik, setYaziAcik] = useState(false);
  const [yazi, setYazi] = useState<YaziAyari>(
    kayit?.yazi ?? { metin: "FLTR FIVEMLEAKTR", font: "Bahnschrift", kalin: true, renk: "#ffffff", kontur: 10, konturRenk: "#e5243b" },
  );
  const [renk, setRenk] = useState<RenkAyari>(NOTR_RENK);
  const [git, setGit] = useState({ x: "", y: "" });
  const pencere = useRef<HTMLDivElement>(null);
  const surukleme = useRef<Surukleme | null>(null);
  const sonAnlik = useRef({ tur: "", zaman: 0 });
  const sigdirilan = useRef(kayit?.duzenAnahtari ?? "");

  useEffect(() => {
    api.haritaDuzeni(ozet.id).then(setVeri, ui.hata);
  }, [ozet.id, surum, ui]);

  const d = veri?.duzen;
  const duzenAnahtari = d ? `${d.sutun}x${d.satir}:${d.karo}:${d.baslangic}` : "";
  const sinir = useMemo(() => {
    if (!d) return null;
    const [sol, ust] = d.baslangic;
    return { sol, ust, sag: sol + d.sutun * d.karo[0], alt: ust - d.satir * d.karo[1], w: d.sutun * d.karo[0], h: d.satir * d.karo[1] };
  }, [d]);
  const varyantlar = useMemo(() => [...new Set(veri?.karolar.map((k) => k.varyant))], [veri]);
  useEffect(() => {
    if (varyantlar.length && !varyantlar.includes(goster)) setGoster(varyantlar[0]);
  }, [varyantlar, goster]);

  const sigdir = useCallback(() => {
    const p = pencere.current;
    if (!p || !sinir) return;
    const olcek = Math.min(p.clientWidth / sinir.w, p.clientHeight / sinir.h) * 0.92;
    setGorunum({ olcek, x: (p.clientWidth - sinir.w * olcek) / 2, y: (p.clientHeight - sinir.h * olcek) / 2 });
  }, [sinir]);
  // yalnız düzen ilk kez (ya da değişerek) gelince sığdır; her işlemeden sonra görünüm sıçramasın
  useEffect(() => {
    if (!duzenAnahtari || sigdirilan.current === duzenAnahtari) return;
    sigdirilan.current = duzenAnahtari;
    sigdir();
  }, [duzenAnahtari, sigdir]);

  useEffect(() => {
    saklananlar.set(ozet.id, { tarih, secili, gorunum, duzenAnahtari: sigdirilan.current, goster, isle, yazi });
  }, [ozet.id, tarih, secili, gorunum, goster, isle, yazi]);

  // belge geri alınıp/yinelendiğinde haritaya işlenmiş katmanları geri getir ya da yeniden kaldır
  useEffect(() => {
    const no = ozet.durum_no;
    const yinelenemez = !ozet.ileri;
    setTarih((t) => {
      const son = t.islemeler.at(-1);
      if (son && no === son.onceki) {
        const islenen = new Set(son.islenen);
        const simdiki = new Map(t.katmanlar.map((k) => [k.no, k]));
        const eskiler = new Set(son.katmanlar.map((k) => k.no));
        const geriGelen = son.katmanlar.flatMap((k) => (islenen.has(k.no) ? [k] : simdiki.has(k.no) ? [simdiki.get(k.no)!] : []));
        return {
          katmanlar: [...geriGelen, ...t.katmanlar.filter((k) => !eskiler.has(k.no))],
          gecmis: son.gecmis,
          ileri: [],
          islemeler: t.islemeler.slice(0, -1),
          geriAlinan: [...t.geriAlinan, son],
        };
      }
      const geri = t.geriAlinan.at(-1);
      if (geri && no === geri.sonraki) {
        const islenen = new Set(geri.islenen);
        return {
          katmanlar: t.katmanlar.filter((k) => !islenen.has(k.no)),
          gecmis: [],
          ileri: [],
          islemeler: [...t.islemeler, geri],
          geriAlinan: t.geriAlinan.slice(0, -1),
        };
      }
      return t.geriAlinan.length && yinelenemez ? { ...t, geriAlinan: [] } : t;
    });
  }, [ozet.durum_no, ozet.ileri]);

  /** Katman listesini değiştirir. Aynı `tur` ile art arda gelen değişiklikler (sürükleme, yazarak girilen sayı) tek geri-al adımıdır. */
  const katmanDegistir = useCallback((f: (l: Katman[]) => Katman[], tur = "") => {
    const simdi = performance.now();
    const s = sonAnlik.current;
    const birlestir = tur !== "" && tur === s.tur && (tur.startsWith("#") || simdi - s.zaman < 900);
    sonAnlik.current = { tur, zaman: simdi };
    setTarih((t) => {
      const yeni = f(t.katmanlar);
      if (yeni === t.katmanlar) return t;
      return { ...t, katmanlar: yeni, gecmis: birlestir ? t.gecmis : [...t.gecmis, t.katmanlar].slice(-GECMIS_SINIRI), ileri: [] };
    });
  }, []);

  const guncelKatman = useCallback(
    (no: number, degisim: Partial<Katman>, tur = `${no}:${Object.keys(degisim).join()}`) =>
      katmanDegistir((l) => l.map((k) => (k.no === no ? { ...k, ...degisim } : k)), tur),
    [katmanDegistir],
  );

  const katmanGecmisi = useCallback((yon: "geri" | "ileri") => {
    sonAnlik.current = { tur: "", zaman: 0 };
    setTarih((t) => {
      if (yon === "geri" && t.gecmis.length)
        return { ...t, katmanlar: t.gecmis.at(-1)!, gecmis: t.gecmis.slice(0, -1), ileri: [...t.ileri, t.katmanlar] };
      if (yon === "ileri" && t.ileri.length)
        return { ...t, katmanlar: t.ileri.at(-1)!, ileri: t.ileri.slice(0, -1), gecmis: [...t.gecmis, t.katmanlar] };
      return t;
    });
  }, []);

  const cogalt = useCallback(
    (no: number) => {
      const yeniNo = ++katmanNo;
      katmanDegistir((l) => {
        const i = l.findIndex((k) => k.no === no);
        if (i < 0) return l;
        const k = l[i];
        const kopya: Katman = { ...k, no: yeniNo, ad: `${k.ad} (kopya)`, merkez: [k.merkez[0] + k.boyut[0] * 0.1, k.merkez[1] - k.boyut[1] * 0.1] };
        return [...l.slice(0, i + 1), kopya, ...l.slice(i + 1)];
      });
      setSecili(yeniNo);
    },
    [katmanDegistir],
  );

  // dizide sonra gelen üstte çizilir; +1 öne, -1 arkaya
  const sirala = (no: number, yon: 1 | -1) =>
    katmanDegistir((l) => {
      const i = l.findIndex((k) => k.no === no);
      const j = i + yon;
      if (i < 0 || j < 0 || j >= l.length) return l;
      const yeni = [...l];
      [yeni[i], yeni[j]] = [yeni[j], yeni[i]];
      return yeni;
    });

  const kaldir = (no: number) => {
    katmanDegistir((l) => l.filter((x) => x.no !== no));
    if (secili === no) setSecili(null);
  };

  const ekrandanDunyaya = useCallback(
    (ex: number, ey: number): [number, number] => {
      if (!sinir) return [0, 0];
      const r = pencere.current!.getBoundingClientRect();
      return [sinir.sol + (ex - r.left - gorunum.x) / gorunum.olcek, sinir.ust - (ey - r.top - gorunum.y) / gorunum.olcek];
    },
    [gorunum, sinir],
  );

  const yaziEkle = async () => {
    if (!sinir || !yazi.metin.trim()) return;
    const r = await ui.mesgul("Yazı hazırlanıyor", async () => {
      const { bayt, w, h } = await yaziCiz(yazi);
      return { yol: await api.geciciGorselKaydet(bayt), w, h };
    });
    if (!r) return;
    const p = pencere.current!.getBoundingClientRect();
    const merkez = ekrandanDunyaya(p.left + p.width / 2, p.top + p.height / 2);
    const genislik = Math.min(sinir.w, p.width / gorunum.olcek / 3);
    const no = ++katmanNo;
    katmanDegistir((l) => [
      ...l,
      {
        no,
        gorsel: r.yol,
        ad: `Yazı: ${yazi.metin.split("\n")[0].slice(0, 24)}`,
        merkez,
        boyut: [genislik, (genislik * r.h) / r.w],
        donus: 0,
        opaklik: 1,
        karisim: "normal",
        oranKilit: true,
        gizli: false,
      },
    ]);
    setSecili(no);
    setYaziAcik(false);
  };

  const fotoEkle = async (tumu = false) => {
    if (!sinir) return;
    const s = await open({ multiple: !tumu, title: tumu ? "Haritanın tamamını kaplayacak görsel" : "Haritaya eklenecek foto/logo", filters: [{ name: "Görsel", extensions: GORSEL_UZANTILARI }] });
    if (!s) return;
    const yollar = Array.isArray(s) ? s : [s];
    const p = pencere.current!.getBoundingClientRect();
    const merkez = ekrandanDunyaya(p.left + p.width / 2, p.top + p.height / 2);
    const yeni: Katman[] = [];
    for (const yol of yollar) {
      try {
        const [w, h] = await gorselBoyutu(yerelGorselUrl(yol));
        const genislik = tumu ? sinir.w : Math.min(sinir.w, p.width / gorunum.olcek / 4);
        yeni.push({
          no: ++katmanNo,
          gorsel: yol,
          ad: yol.split(/[\\/]/).pop()!,
          merkez: tumu ? [sinir.sol + sinir.w / 2, sinir.alt + sinir.h / 2] : merkez,
          boyut: tumu ? [sinir.w, sinir.h] : [genislik, (genislik * h) / w],
          donus: 0,
          opaklik: 1,
          karisim: "normal",
          oranKilit: !tumu,
          gizli: false,
        });
      } catch (e) {
        ui.hata(e);
      }
    }
    if (yeni.length) {
      katmanDegistir((l) => [...l, ...yeni]);
      setSecili(yeni.at(-1)!.no);
      if (tumu) ui.bildir("Görsel haritanın tamamına esnetildi; oranı bozuluyorsa genişlik/yüksekliği ayarla.");
    }
  };

  useEffect(() => {
    const hareket = (e: PointerEvent) => {
      const s = surukleme.current;
      if (!s) return;
      if (s.tur === "kaydir") {
        setGorunum({ ...s.baslangic, x: s.baslangic.x + e.clientX - s.sx, y: s.baslangic.y + e.clientY - s.sy });
      } else if (s.tur === "tasi") {
        guncelKatman(s.no, { merkez: [s.merkez[0] + (e.clientX - s.sx) / gorunum.olcek, s.merkez[1] - (e.clientY - s.sy) / gorunum.olcek] }, s.kimlik);
      } else {
        const k = katmanlar.find((x) => x.no === s.no);
        if (!k) return;
        const [wx, wy] = ekrandanDunyaya(e.clientX, e.clientY);
        const dx = wx - k.merkez[0];
        const dy = wy - k.merkez[1];
        if (s.tur === "olcek") {
          const oran = Math.max(0.01, Math.hypot(dx, dy) / s.uzaklik);
          guncelKatman(s.no, { boyut: [s.boyut[0] * oran, s.boyut[1] * oran] }, s.kimlik);
        } else {
          const aci = (Math.atan2(dy, dx) * 180) / Math.PI;
          let donus = s.donus + aci - s.aci;
          donus = ((((donus + 180) % 360) + 360) % 360) - 180;
          guncelKatman(s.no, { donus: e.shiftKey ? Math.round(donus / 15) * 15 : donus }, s.kimlik);
        }
      }
    };
    const birak = () => (surukleme.current = null);
    addEventListener("pointermove", hareket);
    addEventListener("pointerup", birak);
    return () => {
      removeEventListener("pointermove", hareket);
      removeEventListener("pointerup", birak);
    };
  }, [gorunum.olcek, katmanlar, ekrandanDunyaya, guncelKatman]);

  // yakalama evresinde: katman geçmişi varken Ctrl+Z/Y belgeye gitmeden katmanlara uygulanır
  useEffect(() => {
    const tus = (e: KeyboardEvent) => {
      if (!e.ctrlKey || (e.target as HTMLElement).closest("input, textarea, select")) return;
      const k = e.key.toLowerCase();
      if (k === "d" && secili !== null) {
        e.preventDefault();
        e.stopPropagation();
        cogalt(secili);
        return;
      }
      if (k !== "z" && k !== "y") return;
      const yon = k === "y" || e.shiftKey ? "ileri" : "geri";
      if ((yon === "geri" ? tarih.gecmis : tarih.ileri).length) {
        e.preventDefault();
        e.stopPropagation();
        katmanGecmisi(yon);
      }
    };
    addEventListener("keydown", tus, true);
    return () => removeEventListener("keydown", tus, true);
  }, [tarih.gecmis, tarih.ileri, secili, cogalt, katmanGecmisi]);

  useEffect(() => {
    const tus = (e: KeyboardEvent) => {
      if (e.ctrlKey || (e.target as HTMLElement).closest("input, textarea, select") || secili === null) return;
      const k = katmanlar.find((x) => x.no === secili);
      if (!k) return;
      if (e.key === "Delete") {
        katmanDegistir((l) => l.filter((x) => x.no !== secili));
        setSecili(null);
      }
      const adim = (e.shiftKey ? 50 : 5) / gorunum.olcek;
      const ok: Record<string, [number, number]> = { ArrowLeft: [-adim, 0], ArrowRight: [adim, 0], ArrowUp: [0, adim], ArrowDown: [0, -adim] };
      if (ok[e.key]) {
        e.preventDefault();
        guncelKatman(k.no, { merkez: [k.merkez[0] + ok[e.key][0], k.merkez[1] + ok[e.key][1]] }, `ok:${k.no}`);
      }
    };
    addEventListener("keydown", tus);
    return () => removeEventListener("keydown", tus);
  }, [secili, katmanlar, gorunum.olcek, katmanDegistir, guncelKatman]);

  const tekerlek = (e: React.WheelEvent) => {
    const r = pencere.current!.getBoundingClientRect();
    const [mx, my] = [e.clientX - r.left, e.clientY - r.top];
    const olcek = Math.min(4, Math.max(0.005, gorunum.olcek * Math.exp(-e.deltaY * 0.0015)));
    const oran = olcek / gorunum.olcek;
    setGorunum({ olcek, x: mx - (mx - gorunum.x) * oran, y: my - (my - gorunum.y) * oran });
  };

  const oraGit = (x: number, y: number) => {
    const p = pencere.current;
    if (!p || !sinir) return;
    const olcek = Math.max(gorunum.olcek, 0.4);
    setGorunum({ olcek, x: p.clientWidth / 2 - (x - sinir.sol) * olcek, y: p.clientHeight / 2 - (sinir.ust - y) * olcek });
  };

  const haritayaIsle = async () => {
    const isleVaryant = varyantlar.filter((v) => isle[v]);
    const gorunen = katmanlar.filter((k) => !k.gizli);
    if (!gorunen.length || !isleVaryant.length) return;
    const onceki = ozet.durum_no;
    const r = await ui.mesgul("Harita karolarına işleniyor", () =>
      api.haritaIsle(
        ozet.id,
        gorunen.map(({ gorsel, merkez, boyut, donus, opaklik, karisim }) => ({ gorsel, merkez, boyut, donus, opaklik, karisim })),
        isleVaryant,
      ),
    );
    if (!r) return;
    const islenen = new Set(gorunen.map((k) => k.no));
    sonAnlik.current = { tur: "", zaman: 0 };
    setTarih((t) => ({
      katmanlar: t.katmanlar.filter((k) => !islenen.has(k.no)),
      gecmis: [],
      ileri: [],
      islemeler: [...t.islemeler, { onceki, sonraki: r.ozet.durum_no, katmanlar: t.katmanlar, gecmis: t.gecmis, islenen: [...islenen] }].slice(-20),
      geriAlinan: [],
    }));
    guncelle(r.ozet);
    setSecili(null);
    ui.bildir(`${r.karo} harita karosuna işlendi. Ctrl+Z geri alır ve katmanları geri getirir; kalıcı olması için Kaydet.`, "tamam");
  };

  const haritayiRenklendir = async () => {
    if (!veri) return;
    const gruplar = new Map<string, number[]>();
    for (const k of veri.karolar.filter((k) => isle[k.varyant])) gruplar.set(k.ytd, [...(gruplar.get(k.ytd) ?? []), k.i]);
    const sonuc = await ui.mesgul("Harita renklendiriliyor", async () => {
      let o = null;
      let bitti = 0;
      for (const [ytd, indeksler] of gruplar) {
        ui.ilerleme(bitti++, gruplar.size);
        o = await api.dokuRenklendir(ozet.id, ytd, indeksler, renk);
      }
      return o;
    });
    if (sonuc) {
      guncelle(sonuc);
      setRenkAcik(false);
      setRenk(NOTR_RENK);
      ui.bildir(`${gruplar.size} doku dosyası renklendirildi (${gruplar.size} geri-al adımı).`, "tamam");
    }
  };

  if (!veri || !sinir || !d) return <div className="bilgi-kutu">Harita karoları okunuyor…</div>;
  if (!veri.karolar.length)
    return (
      <div className="bilgi-kutu">
        Bu pakette ESC/radar haritası karosu (<code>minimap_sea_Y_X</code>, <code>minimap_Y_X</code> dokuları) bulunamadı.
      </div>
    );

  const karolar = veri.karolar.filter((k) => k.varyant === goster);
  const tekil = [...new Map(karolar.map((k) => [`${k.satir}_${k.sutun}`, k])).values()];
  const sk = katmanlar.find((k) => k.no === secili);
  const ekran = (wx: number, wy: number) => [(wx - sinir.sol) * gorunum.olcek + gorunum.x, (sinir.ust - wy) * gorunum.olcek + gorunum.y];
  const surukBasla = () => `#${++surukNo}`;

  return (
    <>
      <div className="duzenleyici-ust">
        <Ikon ad="hedef" />
        <h2>
          ESC / radar haritası
          <small>
            {d.sutun}×{d.satir} karo · karo {d.karo[0]}×{d.karo[1]} oyun birimi · düzen {veri.duzen_kaynagi === "paket" ? "paketteki minimap.ymt'den" : "oyunun varsayılanı"}
          </small>
        </h2>
      </div>
      <div className="uc-arac">
        <button className="dugme kucuk birincil" onClick={() => fotoEkle()}>
          <Ikon ad="arti" /> Foto / logo ekle
        </button>
        <button className="dugme kucuk" onClick={() => fotoEkle(true)} title="Tek bir görseli haritanın tamamına yerleştirir">
          <Ikon ad="resim" /> Tüm haritayı değiştir
        </button>
        <button className={`dugme kucuk${yaziAcik ? " birincil" : ""}`} onClick={() => setYaziAcik(!yaziAcik)}>
          <Ikon ad="metin" /> Yazı ekle
        </button>
        <button className={`dugme kucuk${renkAcik ? " birincil" : ""}`} onClick={() => setRenkAcik(!renkAcik)}>
          <Ikon ad="palet" /> Renklendir
        </button>
        {varyantlar.length > 1 && (
          <select className="girdi kucuk" value={goster} onChange={(e) => setGoster(e.target.value as "sea" | "minimap")} title="Önizlemede gösterilen doku seti">
            <option value="sea">Önizleme: ESC haritası</option>
            <option value="minimap">Önizleme: radar</option>
          </select>
        )}
        <span className="bosluk" />
        {imlec && (
          <span className="soluk koordinat">
            X {imlec[0].toFixed(1)} · Y {imlec[1].toFixed(1)}
          </span>
        )}
        <button className="dugme kucuk" onClick={sigdir}>
          <Ikon ad="hedef" /> Sığdır
        </button>
      </div>
      <div className="harita-duzen">
        <div
          className="harita-pencere dama"
          ref={pencere}
          onWheel={tekerlek}
          onPointerDown={(e) => {
            if (e.button !== 0 && e.button !== 1) return;
            surukleme.current = { tur: "kaydir", sx: e.clientX, sy: e.clientY, baslangic: gorunum };
            setSecili(null);
          }}
          onPointerMove={(e) => setImlec(ekrandanDunyaya(e.clientX, e.clientY))}
          onPointerLeave={() => setImlec(null)}
        >
          <div
            className="harita-dunya"
            style={{ width: sinir.w, height: sinir.h, transform: `translate(${gorunum.x}px, ${gorunum.y}px) scale(${gorunum.olcek})` }}
          >
            {tekil.map((k) => {
              const sol = k.sutun * d.karo[0];
              const ust = k.satir * d.karo[1];
              return (
                <div key={`${k.ytd}#${k.i}`} className="harita-karo" style={{ left: sol, top: ust, width: d.karo[0], height: d.karo[1] }}>
                  <img src={dokuUrl(ozet.id, k.ytd, k.i, 2048, surum)} draggable={false} alt="" />
                  <span style={{ fontSize: 12 / gorunum.olcek }}>
                    {k.satir}_{k.sutun} · {k.genislik}px
                  </span>
                </div>
              );
            })}
            {katmanlar
              .filter((k) => !k.gizli)
              .map((k) => (
                <img
                  key={k.no}
                  className={`harita-katman${k.no === secili ? " secili" : ""}`}
                  src={yerelGorselUrl(k.gorsel)}
                  draggable={false}
                  alt=""
                  style={{
                    left: k.merkez[0] - sinir.sol - k.boyut[0] / 2,
                    top: sinir.ust - k.merkez[1] - k.boyut[1] / 2,
                    width: k.boyut[0],
                    height: k.boyut[1],
                    transform: `rotate(${-k.donus}deg)`,
                    opacity: k.opaklik,
                    mixBlendMode: KARISIM_CSS[k.karisim],
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSecili(k.no);
                    surukleme.current = { tur: "tasi", kimlik: surukBasla(), no: k.no, sx: e.clientX, sy: e.clientY, merkez: k.merkez };
                  }}
                />
              ))}
          </div>
          {sk && !sk.gizli && (() => {
            const [cx, cy] = ekran(sk.merkez[0], sk.merkez[1]);
            const w = sk.boyut[0] * gorunum.olcek;
            const h = sk.boyut[1] * gorunum.olcek;
            return (
              <div className="harita-tutamaclar" style={{ left: cx - w / 2, top: cy - h / 2, width: w, height: h, transform: `rotate(${-sk.donus}deg)` }}>
                <i
                  className="tutamac olcek"
                  title="Büyüt / küçült"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const [wx, wy] = ekrandanDunyaya(e.clientX, e.clientY);
                    surukleme.current = {
                      tur: "olcek",
                      kimlik: surukBasla(),
                      no: sk.no,
                      boyut: sk.boyut,
                      uzaklik: Math.max(1e-6, Math.hypot(wx - sk.merkez[0], wy - sk.merkez[1])),
                    };
                  }}
                />
                <i
                  className="tutamac don"
                  title="Döndür (Shift: 15° adım)"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const [wx, wy] = ekrandanDunyaya(e.clientX, e.clientY);
                    surukleme.current = {
                      tur: "don",
                      kimlik: surukBasla(),
                      no: sk.no,
                      donus: sk.donus,
                      aci: (Math.atan2(wy - sk.merkez[1], wx - sk.merkez[0]) * 180) / Math.PI,
                    };
                  }}
                />
              </div>
            );
          })()}
        </div>

        <div className="doku-detay">
          {yaziAcik && (
            <div className="ayar-grubu">
              <h4>Yazı</h4>
              <textarea
                className="girdi"
                rows={2}
                style={{ height: "auto", padding: 8, resize: "vertical" }}
                value={yazi.metin}
                onChange={(e) => setYazi({ ...yazi, metin: e.target.value })}
                placeholder="Sunucu adı, bölge adı…"
              />
              <div className="sayi-cift">
                <label>
                  Font
                  <select className="girdi kucuk" value={yazi.font} onChange={(e) => setYazi({ ...yazi, font: e.target.value })}>
                    {FONTLAR.map((f) => (
                      <option key={f} value={f} style={{ fontFamily: f }}>
                        {f}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Renk
                  <input type="color" value={yazi.renk} onChange={(e) => setYazi({ ...yazi, renk: e.target.value })} />
                </label>
                <label>
                  Kontur rengi
                  <input type="color" value={yazi.konturRenk} onChange={(e) => setYazi({ ...yazi, konturRenk: e.target.value })} />
                </label>
                <label className="yatay-etiket" style={{ marginTop: 18 }}>
                  <input type="checkbox" checked={yazi.kalin} onChange={(e) => setYazi({ ...yazi, kalin: e.target.checked })} /> Kalın
                </label>
              </div>
              <Kaydirici etiket="Kontur" deger={yazi.kontur} min={0} max={40} adim={1} degisti={(kontur) => setYazi({ ...yazi, kontur })} />
              <div
                className="yazi-onizleme"
                style={{
                  fontFamily: yazi.font,
                  fontWeight: yazi.kalin ? 700 : 400,
                  color: yazi.renk,
                  WebkitTextStroke: yazi.kontur ? `${Math.max(1, yazi.kontur / 8)}px ${yazi.konturRenk}` : undefined,
                  paintOrder: "stroke fill",
                }}
              >
                {yazi.metin || " "}
              </div>
              <button className="dugme birincil" disabled={!yazi.metin.trim()} onClick={yaziEkle}>
                <Ikon ad="arti" /> Haritaya katman olarak ekle
              </button>
            </div>
          )}

          {renkAcik && (
            <div className="ayar-grubu">
              <h4>Haritanın tamamını renklendir</h4>
              <RenkAyarlari renk={renk} degisti={setRenk} />
              <button className="dugme birincil" onClick={haritayiRenklendir}>
                <Ikon ad="palet" /> Uygula
              </button>
            </div>
          )}

          <div className="ayar-grubu">
            <div className="katman-baslik">
              <h4>Katmanlar ({katmanlar.length})</h4>
              <button className="ikon-dugme" title="Katman düzenlemesini geri al (Ctrl+Z)" disabled={!tarih.gecmis.length} onClick={() => katmanGecmisi("geri")}>
                <Ikon ad="geri" boy={13} />
              </button>
              <button className="ikon-dugme" title="Yinele (Ctrl+Y)" disabled={!tarih.ileri.length} onClick={() => katmanGecmisi("ileri")}>
                <Ikon ad="ileri" boy={13} />
              </button>
            </div>
            {!katmanlar.length && (
              <span className="soluk" style={{ fontSize: 12 }}>
                "Foto / logo ekle" ile görsel ekle. Sürükleyerek taşı, sağ alt köşeden büyüt, üstteki yuvarlaktan döndür. Tekerlekle yakınlaş, boş alanı
                sürükleyerek kaydır. Ctrl+D çoğaltır, Delete siler, oklar kaydırır.
              </span>
            )}
            <div className="dosya-listesi">
              {[...katmanlar].reverse().map((k, i) => (
                <div key={k.no} className={`dosya-satiri${k.no === secili ? " secili-satir" : ""}`} onClick={() => setSecili(k.no)}>
                  <input type="checkbox" checked={!k.gizli} title="Görünür" onClick={(e) => e.stopPropagation()} onChange={() => guncelKatman(k.no, { gizli: !k.gizli }, "")} />
                  <span className="ad" title={k.ad}>
                    {k.ad}
                  </span>
                  <span className="satir-dugmeleri" onClick={(e) => e.stopPropagation()}>
                    <button className="ikon-dugme" title="Öne al" disabled={i === 0} onClick={() => sirala(k.no, 1)}>
                      <Ikon ad="ok-yukari" boy={12} />
                    </button>
                    <button className="ikon-dugme" title="Arkaya al" disabled={i === katmanlar.length - 1} onClick={() => sirala(k.no, -1)}>
                      <Ikon ad="ok-asagi" boy={12} />
                    </button>
                    <button className="ikon-dugme" title="Çoğalt (Ctrl+D)" onClick={() => cogalt(k.no)}>
                      <Ikon ad="kopya" boy={12} />
                    </button>
                    <button className="ikon-dugme" title="Kaldır (Delete)" onClick={() => kaldir(k.no)}>
                      <Ikon ad="x" boy={12} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {sk && (
            <div className="ayar-grubu">
              <h4>{sk.ad}</h4>
              <div className="sayi-cift">
                <label>
                  X (oyun)
                  <input className="girdi kucuk" type="number" value={Math.round(sk.merkez[0] * 10) / 10} onChange={(e) => guncelKatman(sk.no, { merkez: [Number(e.target.value), sk.merkez[1]] })} />
                </label>
                <label>
                  Y (oyun)
                  <input className="girdi kucuk" type="number" value={Math.round(sk.merkez[1] * 10) / 10} onChange={(e) => guncelKatman(sk.no, { merkez: [sk.merkez[0], Number(e.target.value)] })} />
                </label>
                <label>
                  Genişlik
                  <input
                    className="girdi kucuk"
                    type="number"
                    min={1}
                    value={Math.round(sk.boyut[0])}
                    onChange={(e) => {
                      const w = Math.max(1, Number(e.target.value));
                      guncelKatman(sk.no, { boyut: [w, sk.oranKilit ? (sk.boyut[1] * w) / sk.boyut[0] : sk.boyut[1]] });
                    }}
                  />
                </label>
                <label>
                  Yükseklik
                  <input
                    className="girdi kucuk"
                    type="number"
                    min={1}
                    value={Math.round(sk.boyut[1])}
                    onChange={(e) => {
                      const h = Math.max(1, Number(e.target.value));
                      guncelKatman(sk.no, { boyut: [sk.oranKilit ? (sk.boyut[0] * h) / sk.boyut[1] : sk.boyut[0], h] });
                    }}
                  />
                </label>
              </div>
              <label className="yatay-etiket">
                <input type="checkbox" checked={sk.oranKilit} onChange={(e) => guncelKatman(sk.no, { oranKilit: e.target.checked }, "")} /> Oranı koru
              </label>
              <Kaydirici etiket="Dönüş" deger={sk.donus} min={-180} max={180} adim={1} degisti={(donus) => guncelKatman(sk.no, { donus })} />
              <Kaydirici etiket="Opaklık" deger={sk.opaklik} min={0} max={1} degisti={(opaklik) => guncelKatman(sk.no, { opaklik })} />
              <div className="kaydirici">
                <label>Karışım</label>
                <select className="girdi kucuk" value={sk.karisim} onChange={(e) => guncelKatman(sk.no, { karisim: e.target.value as Karisim }, "")}>
                  <option value="normal">Normal</option>
                  <option value="carp">Çarp (koyulaştır)</option>
                  <option value="ekran">Ekran (aydınlat)</option>
                </select>
                <span />
              </div>
              <div className="dugme-satiri">
                <button className="dugme kucuk" onClick={() => oraGit(sk.merkez[0], sk.merkez[1])}>
                  <Ikon ad="hedef" /> Katmana git
                </button>
                <button className="dugme kucuk" onClick={() => cogalt(sk.no)}>
                  <Ikon ad="kopya" /> Çoğalt
                </button>
              </div>
            </div>
          )}

          <div className="ayar-grubu">
            <h4>Oyun koordinatına git</h4>
            <span className="soluk" style={{ fontSize: 12 }}>
              Oyunda /coords ile aldığın X ve Y'yi gir; seçili katman varsa oraya taşınır.
            </span>
            <div className="sayi-cift">
              <label>
                X
                <input className="girdi kucuk" value={git.x} onChange={(e) => setGit({ ...git, x: e.target.value })} placeholder="-75.0" />
              </label>
              <label>
                Y
                <input className="girdi kucuk" value={git.y} onChange={(e) => setGit({ ...git, y: e.target.value })} placeholder="-818.5" />
              </label>
            </div>
            <button
              className="dugme kucuk"
              disabled={!Number.isFinite(parseFloat(git.x.replace(",", "."))) || !Number.isFinite(parseFloat(git.y.replace(",", ".")))}
              onClick={() => {
                const x = parseFloat(git.x.replace(",", "."));
                const y = parseFloat(git.y.replace(",", "."));
                if (sk) guncelKatman(sk.no, { merkez: [x, y] }, "");
                oraGit(x, y);
              }}
            >
              {sk ? "Katmanı oraya taşı" : "Oraya git"}
            </button>
          </div>

          <div className="ayar-grubu">
            <h4>Haritaya işle</h4>
            {varyantlar.map((v) => (
              <label key={v} className="yatay-etiket">
                <input type="checkbox" checked={!!isle[v]} onChange={(e) => setIsle({ ...isle, [v]: e.target.checked })} />
                {v === "sea" ? "ESC haritası (minimap_sea)" : "Radar / minimap (minimap)"}
              </label>
            ))}
            <span className="soluk" style={{ fontSize: 12 }}>
              Görünür katmanlar yalnız değdikleri karoların gerçek çözünürlükteki dokusuna yazılır, mip'ler yeniden üretilir. Ctrl+Z tek adımda geri alır ve
              katmanları geri getirir.
            </span>
            <button className="dugme birincil" disabled={!katmanlar.some((k) => !k.gizli) || !varyantlar.some((v) => isle[v])} onClick={haritayaIsle}>
              <Ikon ad="kaydet" /> Haritaya işle
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
