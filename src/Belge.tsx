import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, boyutYaz, type BelgeOzet, type DugumBilgi, tumDugumler, uzanti } from "./api";
import { BaglamMenusu, Ikon, type MenuOgesi, useArayuz } from "./ortak";
import { Ozet } from "./Ozet";
import { DokuEditoru } from "./DokuEditoru";
import { AyarEditoru } from "./AyarEditoru";
import { HazirPanel } from "./HazirPanel";
import { HAZIRLAR } from "./hazirlar";

// ağır bağımlılıklar (three.js, CodeMirror, AI SDK) ilk açılışı yavaşlatmasın diye ihtiyaç anında yüklenir
const DosyaGorunumu = lazy(() => import("./DosyaGorunumu").then((m) => ({ default: m.DosyaGorunumu })));
const AiPanel = lazy(() => import("./AiPanel").then((m) => ({ default: m.AiPanel })));
const GfxGorunumu = lazy(() => import("./Gfx").then((m) => ({ default: m.GfxGorunumu })));
const YptGorunumu = lazy(() => import("./Ypt").then((m) => ({ default: m.YptGorunumu })));
const ModelGorunumu = lazy(() => import("./Uc").then((m) => ({ default: m.ModelGorunumu })));
const HaritaGorunumu = lazy(() => import("./Uc").then((m) => ({ default: m.HaritaGorunumu })));
const HaritaEditoru = lazy(() => import("./HaritaEditoru").then((m) => ({ default: m.HaritaEditoru })));

export interface BelgeBaglami {
  ozet: BelgeOzet;
  surum: number;
  guncelle: (o: BelgeOzet) => void;
  ac: (yol: string) => void;
  birakmaHedefi: string | null;
}

export function dugumIkonu(d: Pick<DugumBilgi, "ad" | "tur">) {
  if (d.tur === "dizin") return "klasor";
  if (d.tur === "arsiv") return "arsiv";
  const u = uzanti(d.ad);
  if (u === "ytd") return "resim";
  if (u === "ypt") return "pirilti";
  if (u === "gfx") return "resim";
  if (["ydr", "ydd", "yft", "ybn"].includes(u)) return "kup";
  if (u === "ymap") return "hedef";
  if (d.ad.toLowerCase() === "visualsettings.dat") return "ayar";
  if (["xml", "meta", "dat", "txt", "ini", "cfg", "json", "lua"].includes(u)) return "metin";
  return "dosya";
}

interface Props {
  ozet: BelgeOzet;
  surum: number;
  secim: string;
  secimAyarla: (yol: string) => void;
  guncelle: (o: BelgeOzet) => void;
  kaydet: (farkli?: boolean) => void;
  geriIleri: (yon: "geri" | "ileri") => void;
  birakmaHedefi: string | null;
  gezgindeGoster: () => void;
  modsKlasoru?: string;
  modlarDegisti: () => void;
}

type AramaSonucu = Awaited<ReturnType<typeof api.icerikteAra>>[number];

export function Belge({
  ozet,
  surum,
  secim,
  secimAyarla,
  guncelle,
  kaydet,
  geriIleri,
  birakmaHedefi,
  gezgindeGoster,
  modsKlasoru,
  modlarDegisti,
}: Props) {
  const ui = useArayuz();
  const [acik, setAcik] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const d of ozet.agac) if (d.tur !== "dosya") s.add(d.yol);
    for (const d of tumDugumler(ozet.agac)) if (d.tur !== "dosya" && d.yol.split("/").length <= 2 && d.cocuklar.length <= 12) s.add(d.yol);
    return s;
  });
  const [filtre, setFiltre] = useState("");
  const [icerikte, setIcerikte] = useState(false);
  const [sonuclar, setSonuclar] = useState<AramaSonucu[] | null>(null);

  useEffect(() => {
    if (!icerikte || filtre.trim().length < 2) {
      setSonuclar(null);
      return;
    }
    let iptal = false;
    const t = setTimeout(() => {
      api.icerikteAra(ozet.id, filtre).then((r) => !iptal && setSonuclar(r), ui.hata);
    }, 300);
    return () => {
      iptal = true;
      clearTimeout(t);
    };
  }, [icerikte, filtre, ozet.id, surum, ui]);
  const [menu, setMenu] = useState<{ x: number; y: number; ogeler: MenuOgesi[] } | null>(null);
  const [aiAcik, setAiAcik] = useState(false);
  const [xmlYol, setXmlYol] = useState<string | null>(null);

  const dugumler = useMemo(() => tumDugumler(ozet.agac), [ozet.agac]);
  const [secYol, secParca] = secim.split("#");
  const secilen = dugumler.find((d) => d.yol === secYol);
  const baglam: BelgeBaglami = { ozet, surum, guncelle, ac: secimAyarla, birakmaHedefi };

  const islem = async (fn: () => Promise<BelgeOzet>, bildirim?: string) => {
    try {
      guncelle(await fn());
      if (bildirim) ui.bildir(bildirim, "tamam");
    } catch (e) {
      ui.hata(e);
    }
  };

  const disaAktar = async (yollar: string[]) => {
    const hedef = await open({ directory: true, title: "Nereye çıkarılsın?" });
    if (typeof hedef !== "string") return;
    const n = await ui.mesgul("Dışa aktarılıyor", () => api.disaAktar(ozet.id, yollar, hedef));
    if (n !== undefined) ui.bildir(`${n} dosya çıkarıldı`, "tamam");
  };

  const dosyaEkle = async (dizin: string, klasor = false) => {
    const s = await open({ multiple: !klasor, directory: klasor, title: dizin ? `${dizin} içine ekle` : "Köke ekle" });
    if (!s) return;
    const kaynaklar = Array.isArray(s) ? s : [s];
    islem(() => api.iceAktar(ozet.id, dizin, kaynaklar), `${kaynaklar.length} öğe eklendi`);
  };

  const adlandir = async (d: DugumBilgi) => {
    const ad = await ui.sor("Yeniden adlandır", d.ad);
    if (!ad || ad === d.ad) return;
    const yeni = [...d.yol.split("/").slice(0, -1), ad.toLowerCase()].join("/");
    await islem(() => api.yenidenAdlandir(ozet.id, d.yol, ad));
    if (secYol === d.yol) secimAyarla(yeni);
  };

  useEffect(() => {
    const tus = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, .cm-editor")) return;
      if (e.key === "F2" && secilen) {
        e.preventDefault();
        adlandir(secilen);
      } else if (e.ctrlKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAiAcik((a) => !a);
      }
    };
    addEventListener("keydown", tus);
    return () => removeEventListener("keydown", tus);
  });

  const menuAc = (e: React.MouseEvent, d: DugumBilgi | null) => {
    e.preventDefault();
    e.stopPropagation();
    const dizinYolu = !d ? "" : d.tur === "dosya" ? d.yol.split("/").slice(0, -1).join("/") : d.yol;
    const ogeler: MenuOgesi[] = [];
    if (!d || d.tur !== "dosya") {
      ogeler.push(
        { ad: "Dosya ekle…", ikon: "ice", is: () => dosyaEkle(dizinYolu) },
        { ad: "Klasör ekle…", ikon: "klasor", is: () => dosyaEkle(dizinYolu, true) },
        {
          ad: "Yeni klasör",
          ikon: "arti",
          is: async () => {
            const ad = await ui.sor("Yeni klasör", "yeni_klasor");
            if (ad) islem(() => api.dizinOlustur(ozet.id, dizinYolu ? `${dizinYolu}/${ad}` : ad));
          },
        },
      );
    }
    if (d) {
      if (d.tur === "dosya")
        ogeler.push({
          ad: "Dosyayla değiştir…",
          ikon: "ice",
          is: async () => {
            const s = await open({ title: `${d.ad} yerine` });
            if (typeof s === "string") islem(() => api.dosyaDegistir(ozet.id, d.yol, s), `${d.ad} değiştirildi`);
          },
        });
      ogeler.push(
        { ad: "Dışa aktar…", ikon: "disa", is: () => disaAktar([d.yol]), ayrac: true },
        { ad: "Yeniden adlandır (F2)", ikon: "kalem", is: () => adlandir(d) },
        {
          ad: "Taşı…",
          ikon: "klasor",
          is: async () => {
            const hedef = await ui.sor("Hangi klasöre taşınsın?", d.yol.split("/").slice(0, -1).join("/"), "Arşiv içi yol, kök için boş bırak");
            if (hedef !== null) islem(() => api.tasi(ozet.id, [d.yol], hedef.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")));
          },
        },
        {
          ad: "Sil",
          ikon: "cop",
          is: async () => {
            if (await ui.onayla(`${d.ad} silinsin mi?`, "Kaydetmeden önce Geri al (Ctrl+Z) ile geri getirebilirsin.", "Sil", true)) {
              await islem(() => api.sil(ozet.id, [d.yol]));
              if (secYol.startsWith(d.yol)) secimAyarla("");
            }
          },
        },
      );
    } else {
      ogeler.push({ ad: "Hepsini dışa aktar…", ikon: "disa", is: () => disaAktar([""]), ayrac: true });
    }
    setMenu({ x: e.clientX, y: e.clientY, ogeler });
  };

  const gorunur = useMemo(() => {
    if (!filtre.trim()) return null;
    const q = filtre.toLowerCase();
    const s = new Set<string>();
    for (const d of dugumler) {
      if (d.yol.toLowerCase().includes(q)) {
        const p = d.yol.split("/");
        for (let i = 1; i <= p.length; i++) s.add(p.slice(0, i).join("/"));
      }
    }
    return s;
  }, [filtre, dugumler]);

  const satirlar = (liste: DugumBilgi[], derinlik: number): React.ReactNode =>
    liste
      .filter((d) => !gorunur || gorunur.has(d.yol))
      .map((d) => {
        const kap = d.tur !== "dosya";
        const genis = kap && (acik.has(d.yol) || !!gorunur);
        const birak = kap ? `dizin:${ozet.id}:${d.yol}` : uzanti(d.ad) === "ytd" ? undefined : `dosya:${ozet.id}:${d.yol}`;
        return (
          <div key={d.yol}>
            <div
              className={`satir${secYol === d.yol ? " secili" : ""}${birak && birakmaHedefi === birak ? " odak" : ""}`}
              style={{ paddingLeft: 6 + derinlik * 14 }}
              data-birak={birak}
              onClick={() => {
                secimAyarla(d.yol);
                if (kap && secYol === d.yol) setAcik((s) => new Set(s.has(d.yol) ? [...s].filter((x) => x !== d.yol) : [...s, d.yol]));
                else if (kap) setAcik((s) => new Set(s).add(d.yol));
              }}
              onContextMenu={(e) => menuAc(e, d)}
              title={`${d.yol}\n${boyutYaz(d.boyut)}${d.rsc ? " · RSC7 kaynak" : ""}`}
            >
              <span
                className="ok"
                onClick={(e) => {
                  if (!kap) return;
                  e.stopPropagation();
                  setAcik((s) => new Set(s.has(d.yol) ? [...s].filter((x) => x !== d.yol) : [...s, d.yol]));
                }}
              >
                {kap && <Ikon ad={genis ? "ok-asagi" : "ok-sag"} boy={12} />}
              </span>
              <span className="tur-ikon">
                <Ikon ad={dugumIkonu(d)} renk={d.tur === "arsiv" ? "var(--vurgu)" : undefined} />
              </span>
              <span className="ad">{d.ad}</span>
              {d.degisti && <i className="degisti" title="değişti" />}
              {!kap && <span className="boy">{boyutYaz(d.boyut)}</span>}
            </div>
            {genis && satirlar(d.cocuklar, derinlik + 1)}
          </div>
        );
      });

  const hazir = secim.startsWith("hazir:") ? HAZIRLAR.find((h) => h.id === secim.slice(6)) : undefined;
  let icerik: React.ReactNode;
  if (hazir) icerik = <HazirPanel key={hazir.id} hazir={hazir} {...baglam} />;
  else if (secim === "harita-editoru") icerik = <HaritaEditoru {...baglam} />;
  else if (!secilen) icerik = <Ozet {...baglam} disaAktar={disaAktar} />;
  else if (secilen.tur === "dosya" && uzanti(secilen.ad) === "gfx") icerik = <GfxGorunumu key={secilen.yol} yol={secilen.yol} {...baglam} />;
  else if (secilen.tur === "dosya" && uzanti(secilen.ad) === "ypt")
    icerik = <YptGorunumu key={secilen.yol} yol={secilen.yol} ilkSecim={secParca ? Number(secParca) : undefined} {...baglam} />;
  else if (secilen.tur === "dosya" && uzanti(secilen.ad) === "ytd")
    icerik = <DokuEditoru key={secilen.yol} yol={secilen.yol} ilkSecim={secParca ? Number(secParca) : undefined} {...baglam} />;
  else if (secilen.tur === "dosya" && secilen.ad.toLowerCase() === "visualsettings.dat")
    icerik = <AyarEditoru key={`${secilen.yol}#${secParca ?? ""}`} yol={secilen.yol} ilkArama={secParca} {...baglam} />;
  else if (secilen.tur === "dosya" && ["ydr", "ydd", "yft", "ybn"].includes(uzanti(secilen.ad)))
    icerik = <ModelGorunumu key={secilen.yol} yol={secilen.yol} {...baglam} />;
  else if (secilen.tur === "dosya" && uzanti(secilen.ad) === "ymap" && xmlYol !== secilen.yol)
    icerik = <HaritaGorunumu key={secilen.yol} yol={secilen.yol} {...baglam} xml={() => setXmlYol(secilen.yol)} />;
  else
    icerik = (
      <DosyaGorunumu
        key={secilen.yol}
        dugum={secilen}
        {...baglam}
        disaAktar={disaAktar}
        harita={uzanti(secilen.ad) === "ymap" ? () => setXmlYol(null) : undefined}
      />
    );

  const buyume = ozet.disk_boyutu > 0 && ozet.tahmini_boyut < ozet.disk_boyutu * 0.8;

  return (
    <div className="belge">
      <div className="belge-ust">
        <Ikon ad="arsiv" boy={26} renk="var(--vurgu)" />
        <div className="belge-baslik">
          <h1>{ozet.paket?.ad || ozet.ad}</h1>
          <div>
            <span>{ozet.ad}</span>
            {ozet.paket?.yazar && <span>{ozet.paket.yazar}</span>}
            {ozet.paket?.surum && <span>v{ozet.paket.surum}</span>}
            <span className="rozet">{ozet.sifreleme}</span>
            {ozet.disk_boyutu > 0 && <span>{boyutYaz(ozet.disk_boyutu)}</span>}
            {buyume && (
              <span className="rozet yesil" title="OpenIV'in bıraktığı ölü alan kayıtta temizlenir">
                kaydedince ≈ {boyutYaz(ozet.tahmini_boyut)}
              </span>
            )}
          </div>
        </div>
        <button className={`dugme${aiAcik ? " birincil" : ""}`} onClick={() => setAiAcik(!aiAcik)} title="AI ile düzenle (Ctrl+K)">
          <Ikon ad="pirilti" /> AI
        </button>
        <button className="dugme hayalet" disabled={!ozet.geri} onClick={() => geriIleri("geri")} title="Geri al (Ctrl+Z)">
          <Ikon ad="geri" />
        </button>
        <button className="dugme hayalet" disabled={!ozet.ileri} onClick={() => geriIleri("ileri")} title="Yinele (Ctrl+Y)">
          <Ikon ad="ileri" />
        </button>
        {modsKlasoru && !ozet.yol?.toLowerCase().startsWith(modsKlasoru.toLowerCase()) && (
          <button
            className="dugme"
            title="Paketi FiveM mods klasörüne (sıkıştırılmış) kopyalar"
            onClick={async () => {
              if (!(await ui.onayla("Mods klasörüne kurulsun mu?", `${ozet.ad} → ${modsKlasoru}\nAynı adlı mod varsa üzerine yazılır; eskisi önce yedeklenir.`, "Kur")))
                return;
              const yol = await ui.mesgul("Kuruluyor", () => api.modaKur(ozet.id, modsKlasoru));
              if (yol) {
                ui.bildir(`Kuruldu: ${yol}`, "tamam");
                modlarDegisti();
              }
            }}
          >
            <Ikon ad="ice" /> Mods'a kur
          </button>
        )}
        {ozet.yol && (
          <button className="dugme hayalet" onClick={gezgindeGoster} title="Gezgin'de göster">
            <Ikon ad="klasor" />
          </button>
        )}
        <button className="dugme" onClick={() => kaydet(true)} title="Farklı kaydet (Ctrl+Shift+S)">
          Farklı kaydet
        </button>
        <button className="dugme birincil" onClick={() => kaydet()} disabled={!ozet.kirli && !buyume} title="Kaydet (Ctrl+S)">
          <Ikon ad="kaydet" /> {buyume && !ozet.kirli ? "Sıkıştır ve kaydet" : "Kaydet"}
        </button>
      </div>
      {ozet.sifreleme !== "OPEN" && ozet.sifreleme !== "CFXP" && (
        <div className="uyari-seridi">
          <Ikon ad="uyari" />
          <span>
            Bu paketin şifrelemesi <b>{ozet.sifreleme}</b>. FiveM mods klasöründe yalnız OPEN ya da CFXP paketleri yükler; bu hâliyle oyunda
            görünmez.
          </span>
          <button className="dugme kucuk birincil" onClick={() => islem(() => api.openYap(ozet.id), "Şifreleme OPEN yapıldı; kaydetmeyi unutma")}>
            OPEN yap
          </button>
        </div>
      )}
      <div className={`belge-govde${aiAcik ? " ai-acik" : ""}`}>
        <div className="agac-panel">
          <div className="agac-arac">
            <input
              className="girdi kucuk"
              placeholder={icerikte ? "Doku, ayar, metin ara" : "Dosya ara"}
              value={filtre}
              onChange={(e) => setFiltre(e.target.value)}
            />
            <button
              className={`ikon-dugme${icerikte ? " etkin" : ""}`}
              title="İçerikte ara: doku adları, visualsettings anahtarları, metin dosyaları"
              onClick={() => setIcerikte(!icerikte)}
            >
              <Ikon ad="ara" />
            </button>
            <button className="ikon-dugme" title="Dosya ekle" onClick={() => dosyaEkle(secilen && secilen.tur !== "dosya" ? secilen.yol : "")}>
              <Ikon ad="ice" />
            </button>
            <button className="ikon-dugme" title="Hepsini dışa aktar" onClick={() => disaAktar([""])}>
              <Ikon ad="disa" />
            </button>
          </div>
          <div
            className={`agac${birakmaHedefi === `dizin:${ozet.id}:` ? " birakma-hedefi" : ""}`}
            data-birak={`dizin:${ozet.id}:`}
            onContextMenu={(e) => menuAc(e, null)}
          >
            <div className={`satir${!secim ? " secili" : ""}`} style={{ paddingLeft: 6 }} onClick={() => secimAyarla("")}>
              <span className="ok" />
              <span className="tur-ikon">
                <Ikon ad="pirilti" renk="var(--vurgu)" />
              </span>
              <span className="ad">Özet ve hazır ayarlar</span>
            </div>
            {icerikte && sonuclar ? (
              <div className="arama-sonuclari">
                {!sonuclar.length && <span className="soluk">Sonuç yok.</span>}
                {sonuclar.map((r, i) => (
                  <div
                    key={i}
                    className="satir arama-satiri"
                    title={`${r.yol}${r.ayrinti ? `\n${r.ayrinti}` : ""}`}
                    onClick={() => secimAyarla(r.tur === "doku" || r.tur === "ayar" ? `${r.yol}#${r.ek}` : r.yol)}
                  >
                    <span className="tur-ikon">
                      <Ikon ad={{ yol: "dosya", doku: "resim", ayar: "ayar", metin: "metin" }[r.tur]} />
                    </span>
                    <span className="ad">
                      {r.tur === "yol" ? r.yol : r.ayrinti}
                      {r.tur !== "yol" && <small>{r.tur === "metin" ? `${r.yol.split("/").pop()}:${r.ek}` : r.yol.split("/").pop()}</small>}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              satirlar(ozet.agac, 0)
            )}
          </div>
        </div>
        <div className="duzenleyici">
          <Suspense fallback={<div className="bilgi-kutu">Yükleniyor…</div>}>{icerik}</Suspense>
        </div>
        {aiAcik && (
          <Suspense fallback={<div className="ai-panel" />}>
            <AiPanel ozet={ozet} guncelle={guncelle} kapat={() => setAiAcik(false)} />
          </Suspense>
        )}
      </div>
      {menu && <BaglamMenusu {...menu} kapat={() => setMenu(null)} />}
    </div>
  );
}
