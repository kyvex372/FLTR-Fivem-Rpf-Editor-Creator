import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, boyutYaz, NOTR_RENK, type BelgeOzet, type ModRaporu, type Sigdirma, tumDugumler } from "./api";
import { Ikon, useArayuz } from "./ortak";
import { Belge, dugumIkonu } from "./Belge";
import { CakismaPenceresi } from "./Cakisma";
import { Palet, type PaletOgesi } from "./Palet";
import { Yedekler } from "./Yedekler";

const KLASOR_ANAHTARI = "tlk-rpf.mods-klasoru";
const SON_ANAHTARI = "tlk-rpf.son-acilanlar";

function sonlariOku(): string[] {
  try {
    const v = JSON.parse(yerelOku(SON_ANAHTARI) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function yerelOku(k: string) {
  try {
    return localStorage.getItem(k) ?? undefined;
  } catch {
    return undefined;
  }
}

function yerelYaz(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* depolama kapalıysa tercih hatırlanmaz */
  }
}

export default function App() {
  const ui = useArayuz();
  const [rapor, setRapor] = useState<ModRaporu | null>(null);
  const [belgeler, setBelgeler] = useState<BelgeOzet[]>([]);
  const [aktif, setAktif] = useState<number | null>(null);
  const [surumler, setSurumler] = useState<Record<number, number>>({});
  const [secimler, setSecimler] = useState<Record<number, string>>({});
  const [birakmaHedefi, setBirakmaHedefi] = useState<string | null>(null);
  const [yedekAcik, setYedekAcik] = useState(false);
  const [paletAcik, setPaletAcik] = useState(false);
  const [cakisma, setCakisma] = useState<{ hedef: string; modlar: string[] } | null>(null);
  const cakismaKapat = useCallback(() => setCakisma(null), []);
  const [sonlar, setSonlar] = useState<string[]>(sonlariOku);
  const belgelerRef = useRef(belgeler);
  belgelerRef.current = belgeler;

  const modlariTara = useCallback(async () => {
    try {
      setRapor(await api.modsTara(yerelOku(KLASOR_ANAHTARI)));
    } catch (e) {
      ui.hata(e);
    }
  }, [ui]);

  useEffect(() => {
    modlariTara();
  }, [modlariTara]);

  const guncelle = useCallback((o: BelgeOzet) => {
    setBelgeler((b) => (b.some((x) => x.id === o.id) ? b.map((x) => (x.id === o.id ? o : x)) : [...b, o]));
    setSurumler((s) => ({ ...s, [o.id]: (s[o.id] ?? 0) + 1 }));
  }, []);

  const secimAyarla = useCallback((id: number, yol: string) => setSecimler((s) => ({ ...s, [id]: yol })), []);

  const arsivAc = useCallback(
    async (yollar: string[]) => {
      for (const yol of yollar) {
        const o = await ui.mesgul(`${yol.split(/[\\/]/).pop()} açılıyor`, () => api.arsivAc(yol));
        if (o) {
          guncelle(o);
          setAktif(o.id);
          setSonlar((l) => {
            const yeni = [yol, ...l.filter((x) => x.toLowerCase() !== yol.toLowerCase())].slice(0, 12);
            yerelYaz(SON_ANAHTARI, JSON.stringify(yeni));
            return yeni;
          });
        }
      }
    },
    [guncelle, ui],
  );

  const dosyaSecAc = async () => {
    const s = await open({ multiple: true, filters: [{ name: "RPF arşivi", extensions: ["rpf"] }], defaultPath: rapor?.klasor });
    if (s) arsivAc(Array.isArray(s) ? s : [s]);
  };

  const yeniMod = async () => {
    const ad = await ui.sor("Yeni mod paketi", "Yeni modum", "Paket adı (FiveM'de görünen)");
    if (!ad) return;
    try {
      const o = await api.yeniMod(ad, "Fivemleaktr");
      guncelle(o);
      setAktif(o.id);
      setSecimler((s) => ({ ...s, [o.id]: "" }));
      ui.bildir("Boş paket hazır. Dosyaları sürükleyip bırak, sonra Kaydet ile mods klasörüne kaydet.");
    } catch (e) {
      ui.hata(e);
    }
  };

  const kaydet = useCallback(
    async (id: number, farkli = false) => {
      const b = belgelerRef.current.find((x) => x.id === id);
      if (!b) return;
      let hedef: string | undefined;
      if (farkli || !b.yol) {
        const s = await save({
          defaultPath: b.yol ?? `${rapor?.klasor ?? ""}\\${(b.paket?.ad || "yeni-mod").replace(/[^\w.-]+/g, "_")}.rpf`,
          filters: [{ name: "RPF arşivi", extensions: ["rpf"] }],
        });
        if (!s) return;
        hedef = s;
      }
      const r = await ui.mesgul("Kaydediliyor", () => api.kaydet(id, hedef));
      if (!r) return;
      guncelle(r.ozet);
      const fark = r.eski_boyut > 0 ? ` · ${boyutYaz(r.eski_boyut)} → ${boyutYaz(r.yeni_boyut)}` : ` · ${boyutYaz(r.yeni_boyut)}`;
      ui.bildir(`Kaydedildi${fark}${r.yedek ? " · eski hali yedeklendi" : ""}`, "tamam");
      modlariTara();
    },
    [guncelle, modlariTara, rapor?.klasor, ui],
  );

  const kapat = useCallback(
    async (id: number) => {
      const b = belgelerRef.current.find((x) => x.id === id);
      if (b?.kirli && !(await ui.onayla("Kaydedilmemiş değişiklik var", `${b.ad} kaydedilmeden kapatılsın mı?`, "Kaydetmeden kapat", true)))
        return;
      await api.kapat(id);
      const kalan = belgelerRef.current.filter((x) => x.id !== id);
      setBelgeler(kalan);
      setAktif((a) => (a === id ? (kalan.at(-1)?.id ?? null) : a));
    },
    [ui],
  );

  const geriIleri = useCallback(
    async (id: number, yon: "geri" | "ileri") => {
      try {
        guncelle(await (yon === "geri" ? api.geriAl(id) : api.yinele(id)));
      } catch (e) {
        ui.hata(e);
      }
    },
    [guncelle, ui],
  );

  useEffect(() => {
    const tus = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.defaultPrevented) return;
      const k = e.key.toLowerCase();
      if (k === "p") {
        e.preventDefault();
        setPaletAcik((a) => !a);
        return;
      }
      if (aktif === null) return;
      const yaziAlani = (e.target as HTMLElement).closest("input, textarea, .cm-editor");
      if (k === "s") {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        setTimeout(() => kaydet(aktif, e.shiftKey), 60);
      } else if (k === "o") {
        e.preventDefault();
        dosyaSecAc();
      } else if (!yaziAlani && (k === "z" || k === "y")) {
        e.preventDefault();
        geriIleri(aktif, k === "y" || e.shiftKey ? "ileri" : "geri");
      }
    };
    addEventListener("keydown", tus);
    return () => removeEventListener("keydown", tus);
  });

  useEffect(() => {
    const pencere = getCurrentWindow();
    const dinleyici = pencere.onCloseRequested(async (e) => {
      const kirli = belgelerRef.current.filter((b) => b.kirli);
      if (!kirli.length) return;
      e.preventDefault();
      if (await ui.onayla("Kaydedilmemiş değişiklik var", kirli.map((b) => b.ad).join("\n"), "Kaydetmeden çık", true)) pencere.destroy();
    });
    return () => {
      dinleyici.then((f) => f());
    };
  }, [ui]);

  const surukleRef = useRef({ aktif, secimler, belgeler });
  surukleRef.current = { aktif, secimler, belgeler };

  useEffect(() => {
    const hedefBul = (x: number, y: number) => {
      const oran = window.devicePixelRatio || 1;
      const el = document.elementFromPoint(x / oran, y / oran)?.closest<HTMLElement>("[data-birak]");
      return el?.dataset.birak ?? null;
    };
    const dinleyici = getCurrentWebview().onDragDropEvent(async (e) => {
      const p = e.payload;
      if (p.type === "leave") return setBirakmaHedefi(null);
      if (p.type === "enter" || p.type === "over") return setBirakmaHedefi(hedefBul(p.position.x, p.position.y) ?? "");
      if (p.type !== "drop") return;
      setBirakmaHedefi(null);
      const hedef = hedefBul(p.position.x, p.position.y);
      const { aktif, secimler, belgeler } = surukleRef.current;
      const rpfler = p.paths.filter((y) => y.toLowerCase().endsWith(".rpf"));
      try {
        if (hedef?.startsWith("doku:")) {
          const [, id, i, ...yol] = hedef.split(":");
          const sigdirma = (yerelOku("tlk-rpf.sigdirma") as Sigdirma) ?? "esnet";
          const o = await ui.mesgul("Doku değiştiriliyor", () =>
            api.dokuDegistir(Number(id), yol.join(":"), Number(i), p.paths[0], sigdirma, NOTR_RENK),
          );
          if (o) {
            guncelle(o);
            ui.bildir("Doku değiştirildi", "tamam");
          }
          return;
        }
        if (hedef?.startsWith("dosya:")) {
          const [, id, ...yol] = hedef.split(":");
          const o = await ui.mesgul("Dosya değiştiriliyor", () => api.dosyaDegistir(Number(id), yol.join(":"), p.paths[0]));
          if (o) guncelle(o);
          return;
        }
        let dizinHedefi: { id: number; yol: string } | null = null;
        if (hedef?.startsWith("dizin:")) {
          const [, id, ...yol] = hedef.split(":");
          dizinHedefi = { id: Number(id), yol: yol.join(":") };
        } else if (hedef !== "ac" && aktif !== null && rpfler.length < p.paths.length) {
          const b = belgeler.find((x) => x.id === aktif);
          const secim = secimler[aktif] ?? "";
          const dugum = b && tumDugumler(b.agac).find((d) => d.yol === secim);
          const yol = !dugum ? "" : dugum.tur === "dosya" ? secim.split("/").slice(0, -1).join("/") : secim;
          dizinHedefi = { id: aktif, yol };
        }
        if (dizinHedefi) {
          const { id, yol } = dizinHedefi;
          const o = await ui.mesgul("İçe aktarılıyor", () => api.iceAktar(id, yol, p.paths));
          if (o) {
            guncelle(o);
            ui.bildir(`${p.paths.length} öğe ${yol || "köke"} eklendi`, "tamam");
          }
          return;
        }
        if (rpfler.length) arsivAc(rpfler);
      } catch (err) {
        ui.hata(err);
      }
    });
    return () => {
      dinleyici.then((f) => f());
    };
  }, [arsivAc, guncelle, ui]);

  const modAcKapa = async (dosya: string, acik: boolean, yol: string) => {
    if (!rapor) return;
    const acikBelge = belgeler.find((b) => b.yol?.toLowerCase() === yol.toLowerCase());
    if (acikBelge?.kirli) return ui.bildir("Bu mod açık ve kaydedilmemiş değişiklik var; önce kaydet ya da kapat.", "hata");
    try {
      if (acikBelge) await kapat(acikBelge.id);
      await api.modAcKapa(rapor.klasor, dosya, !acik);
      modlariTara();
    } catch (e) {
      ui.hata(e);
    }
  };

  const klasorDegistir = async () => {
    const s = await open({ directory: true, defaultPath: rapor?.klasor });
    if (typeof s === "string") {
      yerelYaz(KLASOR_ANAHTARI, s);
      modlariTara();
    }
  };

  const cakisanlar = new Set(rapor?.cakismalar.flatMap((c) => c.modlar));
  const sisik = (rapor?.modlar ?? []).filter((m) => !m.hata && m.boyut > 512 * 1024 && m.kullanilan < m.boyut * 0.7);

  const topluSikistir = async () => {
    const kazanc = sisik.reduce((t, m) => t + m.boyut - m.kullanilan, 0);
    if (
      !(await ui.onayla(
        `${sisik.length} mod sıkıştırılsın mı?`,
        `${sisik.map((m) => m.dosya).join(", ")}

Yaklaşık ${boyutYaz(kazanc)} ölü alan temizlenir. İçerik değişmez; her dosya önce yedeklenir. FiveM açıksa kapat.`,
        "Sıkıştır",
      ))
    )
      return;
    let toplam = 0;
    const hatalar: string[] = [];
    for (const [i, m] of sisik.entries()) {
      const r = await ui.mesgul(`${i + 1}/${sisik.length} ${m.dosya} sıkıştırılıyor`, () => api.modSikistir(m.yol));
      if (r) toplam += r.eski - r.yeni;
      else hatalar.push(m.dosya);
    }
    ui.bildir(`${boyutYaz(toplam)} kazanıldı${hatalar.length ? ` · atlanan: ${hatalar.join(", ")}` : ""}`, hatalar.length ? "bilgi" : "tamam");
    modlariTara();
    for (const b of belgelerRef.current) guncelle(await api.ozet(b.id));
  };
  const aktifBelge = belgeler.find((b) => b.id === aktif);

  const paletOgeleri = (): PaletOgesi[] => {
    const o: PaletOgesi[] = [];
    const b = aktifBelge;
    if (b) {
      const git = (yol: string) => secimAyarla(b.id, yol);
      o.push(
        { id: "kaydet", ad: "Kaydet", ek: "Ctrl+S", grup: "İşlem", ikon: "kaydet", is: () => kaydet(b.id) },
        { id: "farkli", ad: "Farklı kaydet", ek: "Ctrl+Shift+S", grup: "İşlem", ikon: "kaydet", is: () => kaydet(b.id, true) },
        { id: "geri", ad: "Geri al", ek: "Ctrl+Z", grup: "İşlem", ikon: "geri", is: () => geriIleri(b.id, "geri") },
        { id: "ileri", ad: "Yinele", ek: "Ctrl+Y", grup: "İşlem", ikon: "ileri", is: () => geriIleri(b.id, "ileri") },
        {
          id: "ai",
          ad: "AI paneli",
          ek: "Ctrl+K",
          grup: "İşlem",
          ikon: "pirilti",
          is: () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })),
        },
        { id: "ozet", ad: "Özet ve hazır ayarlar", grup: "Görünüm", ikon: "pirilti", is: () => git("") },
        { id: "kapat", ad: "Sekmeyi kapat", ek: b.ad, grup: "İşlem", ikon: "x", is: () => kapat(b.id) },
      );
      const dugumler = tumDugumler(b.agac);
      if (dugumler.some((d) => /^minimap.*\.ytd$/i.test(d.ad)))
        o.push({ id: "harita", ad: "ESC / radar harita düzenleyici", grup: "Görünüm", ikon: "hedef", is: () => git("harita-editoru") });
      for (const d of dugumler)
        if (d.tur !== "dizin")
          o.push({ id: `d:${d.yol}`, ad: d.ad, ek: d.yol.split("/").slice(0, -1).join("/"), grup: "Dosya", ikon: dugumIkonu(d), is: () => git(d.yol) });
    }
    for (const x of belgeler)
      if (x.id !== aktif) o.push({ id: `s:${x.id}`, ad: x.paket?.ad || x.ad, ek: x.ad, grup: "Sekme", ikon: "arsiv", is: () => setAktif(x.id) });
    o.push(
      { id: "ac", ad: "RPF aç", ek: "Ctrl+O", grup: "İşlem", ikon: "klasor-ac", is: dosyaSecAc },
      { id: "yeni", ad: "Yeni mod", grup: "İşlem", ikon: "arti", is: yeniMod },
      { id: "yedek", ad: "Yedekler ve geri yükleme", grup: "İşlem", ikon: "yedek", is: () => setYedekAcik(true) },
      { id: "tara", ad: "Mods klasörünü yenile", grup: "İşlem", ikon: "yenile", is: modlariTara },
    );
    if (sisik.length) o.push({ id: "sikistir", ad: `Şişkin ${sisik.length} modu sıkıştır`, grup: "İşlem", ikon: "daralt", is: topluSikistir });
    const acikYollar = new Set(belgeler.map((x) => x.yol?.toLowerCase()));
    for (const m of rapor?.modlar ?? [])
      if (!acikYollar.has(m.yol.toLowerCase()))
        o.push({ id: `m:${m.yol}`, ad: m.paket?.ad || m.dosya, ek: m.dosya, grup: "Mod", ikon: "paket", is: () => arsivAc([m.yol]) });
    const modYollari = new Set((rapor?.modlar ?? []).map((m) => m.yol.toLowerCase()));
    for (const y of sonlar)
      if (!modYollari.has(y.toLowerCase()) && !acikYollar.has(y.toLowerCase()))
        o.push({ id: `son:${y}`, ad: y.split(/[\\/]/).pop()!, ek: y, grup: "Son açılan", ikon: "arsiv", is: () => arsivAc([y]) });
    return o;
  };

  return (
    <div className="uygulama">
      <aside className="yan">
        <div className="marka">
          <img src="/ikon.svg" alt="" />
          <div>
            <b>Fltr</b>
            <br />
            <span>Fivemleaktr · RPF düzenleyici</span>
          </div>
        </div>
        <div className="yan-eylemler">
          <button className="dugme" onClick={dosyaSecAc} title="Ctrl+O">
            <Ikon ad="klasor-ac" /> RPF aç
          </button>
          <button className="dugme" onClick={yeniMod}>
            <Ikon ad="arti" /> Yeni mod
          </button>
        </div>
        <div className="bolum-baslik">
          <span title={rapor?.klasor}>Mods klasörü</span>
          <span>
            <button className="ikon-dugme" title="Yenile" onClick={modlariTara}>
              <Ikon ad="yenile" />
            </button>
            <button className="ikon-dugme" title="Klasörü Gezgin'de aç" onClick={() => rapor && openPath(rapor.klasor).catch(ui.hata)}>
              <Ikon ad="klasor" />
            </button>
            <button className="ikon-dugme" title="Yedekler ve geri yükleme" onClick={() => setYedekAcik(true)}>
              <Ikon ad="yedek" />
            </button>
            {sisik.length > 0 && (
              <button className="ikon-dugme" title={`${sisik.length} şişkin modu sıkıştır`} onClick={topluSikistir}>
                <Ikon ad="daralt" />
              </button>
            )}
            <button className="ikon-dugme" title="Başka klasör seç" onClick={klasorDegistir}>
              <Ikon ad="kalem" />
            </button>
          </span>
        </div>
        <div className={`mod-listesi${birakmaHedefi === "ac" ? " birakma-hedefi" : ""}`} data-birak="ac">
          {rapor && !rapor.bulundu && (
            <div className="bilgi-kutu" style={{ margin: 8 }}>
              FiveM mods klasörü bulunamadı.
              <br />
              <small>{rapor.klasor}</small>
            </div>
          )}
          {rapor?.modlar.map((m) => {
            const oran = m.boyut ? 1 - m.kullanilan / m.boyut : 0;
            const acikBelge = belgeler.find((b) => b.yol?.toLowerCase() === m.yol.toLowerCase());
            return (
              <div
                key={m.yol}
                className={`mod${m.acik ? "" : " kapali"}${acikBelge && acikBelge.id === aktif ? " secili" : ""}`}
                onClick={() => (acikBelge ? setAktif(acikBelge.id) : arsivAc([m.yol]))}
                title={m.yol}
              >
                <div className="mod-ad">{m.paket?.ad || m.dosya}</div>
                <button
                  className={`anahtar${m.acik ? " acik" : ""}`}
                  title={m.acik ? "Kapat (oyunda yüklenmez)" : "Aç"}
                  onClick={(e) => {
                    e.stopPropagation();
                    modAcKapa(m.dosya, m.acik, m.yol);
                  }}
                />
                <div className="mod-alt">
                  <span>{m.dosya}</span>
                  <span>{boyutYaz(m.boyut)}</span>
                  {m.hata && !m.engeller.length && (
                    <span className="rozet kirmizi" title={m.hata}>
                      okunamadı
                    </span>
                  )}
                  {m.acik && m.engeller.length > 0 && (
                    <span className="rozet kirmizi" title={m.engeller.join(" · ")}>
                      FiveM yüklemez
                    </span>
                  )}
                  {oran > 0.3 && m.boyut > 512 * 1024 && (
                    <span className="rozet sari" title={`Gerçek veri ${boyutYaz(m.kullanilan)}; kaydedince küçülür`}>
                      %{Math.floor(oran * 100)} boş
                    </span>
                  )}
                  {m.acik && cakisanlar.has(m.dosya) && <span className="rozet kirmizi">çakışma</span>}
                  {m.sifreleme === "CFXP" && <span className="rozet">CFXP</span>}
                </div>
                {(m.engeller[0] ?? m.hata) && <div className="mod-not">{m.engeller[0] ?? m.hata}</div>}
              </div>
            );
          })}
        </div>
        {!!rapor?.cakismalar.length && (
          <div className="cakismalar">
            <div className="bolum-baslik" style={{ padding: "8px 8px 4px" }}>
              <span>
                <Ikon ad="uyari" renk="var(--sari)" /> Çakışmalar ({rapor.cakismalar.length})
              </span>
            </div>
            {rapor.cakismalar.map((c) => (
              <div
                className="cakisma"
                key={c.hedef}
                title="Aynı oyun dosyasını birden fazla açık mod değiştiriyor; tıkla, farkları gör ve birini kapat."
                onClick={() => setCakisma(c)}
              >
                <code>{c.hedef.split("\\").pop()}</code>
                <div>{c.modlar.join(" · ")}</div>
              </div>
            ))}
          </div>
        )}
      </aside>

      <main className="ana">
        {belgeler.length > 0 && (
          <div className="sekmeler">
            {belgeler.map((b) => (
              <div
                key={b.id}
                className={`sekme${b.id === aktif ? " secili" : ""}`}
                onClick={() => setAktif(b.id)}
                onAuxClick={(e) => e.button === 1 && kapat(b.id)}
                title={b.yol ?? "kaydedilmedi"}
              >
                <Ikon ad="arsiv" />
                <span>{b.ad}</span>
                {b.kirli && <i className="nokta" />}
                <button
                  className="ikon-dugme"
                  style={{ width: 20, height: 20 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    kapat(b.id);
                  }}
                >
                  <Ikon ad="x" boy={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        {aktifBelge ? (
          <Belge
            key={aktifBelge.id}
            ozet={aktifBelge}
            surum={surumler[aktifBelge.id] ?? 0}
            secim={secimler[aktifBelge.id] ?? ""}
            secimAyarla={(y) => secimAyarla(aktifBelge.id, y)}
            guncelle={guncelle}
            kaydet={(farkli) => kaydet(aktifBelge.id, farkli)}
            geriIleri={(yon) => geriIleri(aktifBelge.id, yon)}
            birakmaHedefi={birakmaHedefi}
            gezgindeGoster={() => aktifBelge.yol && revealItemInDir(aktifBelge.yol).catch(ui.hata)}
            modsKlasoru={rapor?.bulundu ? rapor.klasor : undefined}
            modlarDegisti={modlariTara}
          />
        ) : (
          <div className={`bos-ekran${birakmaHedefi !== null ? " hedef" : ""}`}>
            <div className="kutu">
              <Ikon ad="arsiv" boy={40} renk="var(--vurgu)" />
              <h2>Bir .rpf bırak ya da soldan mod seç</h2>
              <div>
                Mod açılınca içindeki dosyalara göre düzenleyiciler kendiliğinden gelir: dokular, görsel ayarlar, metin dosyaları ve hazır
                ayarlar.
              </div>
              <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "center" }}>
                <button className="dugme birincil" onClick={dosyaSecAc}>
                  <Ikon ad="klasor-ac" /> RPF aç
                </button>
                <button className="dugme" onClick={yeniMod}>
                  <Ikon ad="arti" /> Yeni mod
                </button>
                <button className="dugme" onClick={() => setPaletAcik(true)} title="Ctrl+P">
                  <Ikon ad="ara" /> Hızlı ara
                </button>
              </div>
              {sonlar.length > 0 && (
                <div className="son-acilanlar">
                  <div className="bolum-baslik">
                    <span>Son açılanlar</span>
                  </div>
                  {sonlar.slice(0, 8).map((y) => (
                    <div key={y} className="dosya-satiri" onClick={() => arsivAc([y])} title={y}>
                      <Ikon ad="arsiv" />
                      <span className="ad">{y.split(/[\\/]/).pop()}</span>
                      <small>{y.split(/[\\/]/).slice(-2, -1)[0]}</small>
                    </div>
                  ))}
                </div>
              )}
              <div className="kisayollar soluk">
                <span>
                  <kbd>Ctrl</kbd>+<kbd>P</kbd> hızlı ara
                </span>
                <span>
                  <kbd>Ctrl</kbd>+<kbd>K</kbd> AI
                </span>
                <span>
                  <kbd>Ctrl</kbd>+<kbd>S</kbd> kaydet
                </span>
                <span>
                  <kbd>Ctrl</kbd>+<kbd>Z</kbd> geri al
                </span>
              </div>
            </div>
          </div>
        )}
      </main>
      {cakisma && rapor && (
        <CakismaPenceresi
          rapor={rapor}
          hedef={cakisma.hedef}
          modlar={cakisma.modlar}
          kapat={cakismaKapat}
          modKapat={async (dosya) => {
            const m = rapor.modlar.find((x) => x.dosya === dosya);
            if (!m) return;
            await modAcKapa(m.dosya, true, m.yol);
            setCakisma(null);
            ui.bildir(`${m.paket?.ad || m.dosya} kapatıldı (mods-kapali klasörüne taşındı, soldan tekrar açılabilir)`, "tamam");
          }}
        />
      )}
      {paletAcik && <Palet ogeler={paletOgeleri()} kapat={() => setPaletAcik(false)} />}
      {yedekAcik && (
        <Yedekler
          rapor={rapor}
          kapat={() => setYedekAcik(false)}
          bitti={async () => {
            modlariTara();
            for (const b of belgelerRef.current) guncelle(await api.ozet(b.id));
          }}
        />
      )}
    </div>
  );
}
