import { useEffect, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { save } from "@tauri-apps/plugin-dialog";
import { api, boyutYaz, type ModRaporu } from "./api";
import { Ikon, useArayuz } from "./ortak";

type Yedek = Awaited<ReturnType<typeof api.yedekleriListele>>[number];

export function Yedekler({ rapor, kapat, bitti }: { rapor: ModRaporu | null; kapat: () => void; bitti: () => void }) {
  const ui = useArayuz();
  const [liste, setListe] = useState<Yedek[] | null>(null);
  const [filtre, setFiltre] = useState("");

  const [tazele, setTazele] = useState(0);
  const yukle = () => setTazele((t) => t + 1);
  useEffect(() => {
    api.yedekleriListele().then(setListe, ui.hata);
  }, [tazele, ui]);

  // Eski biçimdeki yedeklerde asıl yol kayıtlı değil: ad yalnız tek bir modla eşleşiyorsa ona,
  // yoksa (her dlcpack'teki dlc.rpf gibi) kullanıcıya sorarak geri yüklenir.
  const hedefBul = (y: Yedek) => {
    if (y.kaynak) return y.kaynak;
    const eslesen = rapor?.modlar.filter((m) => m.dosya.toLowerCase() === y.ad.toLowerCase()) ?? [];
    return eslesen.length === 1 ? eslesen[0].yol : undefined;
  };
  const gorunurYol = (y: Yedek) => {
    if (!y.kaynak) return "asıl yer kayıtlı değil (eski yedek)";
    const k = rapor?.klasor;
    return k && y.kaynak.toLowerCase().startsWith(k.toLowerCase() + "\\") ? y.kaynak.slice(k.length + 1) : y.kaynak;
  };

  const geriYukle = async (y: Yedek) => {
    let hedef = hedefBul(y);
    if (!hedef) {
      const s = await save({ defaultPath: `${rapor?.klasor ?? ""}\\${y.ad}`, filters: [{ name: "RPF", extensions: ["rpf"] }] });
      if (!s) return;
      hedef = s;
    }
    const tarih = new Date(y.zaman * 1000).toLocaleString("tr");
    if (!(await ui.onayla(`${y.ad} geri yüklensin mi?`, `${tarih} tarihli yedek (${boyutYaz(y.boyut)}) şu dosyanın yerine geçecek:\n${hedef}\n\nMevcut hâli de önce yedeklenir.`, "Geri yükle", true)))
      return;
    const r = await ui.mesgul("Geri yükleniyor", () => api.yedekGeriYukle(y.yol, hedef!));
    if (r === undefined) return;
    ui.bildir(`${y.ad} geri yüklendi`, "tamam");
    yukle();
    bitti();
  };

  const gorunen = (liste ?? []).filter((y) => !filtre || `${y.ad} ${y.kaynak ?? ""}`.toLowerCase().includes(filtre.toLowerCase()));

  return (
    <div className="perde" onMouseDown={(e) => e.target === e.currentTarget && kapat()}>
      <div className="modal genis-modal">
        <div className="kart-ust">
          <h3 style={{ flex: 1 }}>
            <Ikon ad="yedek" /> Yedekler
          </h3>
          <button className="dugme kucuk" onClick={() => api.yedeklerKlasoru().then(openPath).catch(ui.hata)}>
            <Ikon ad="klasor" /> Klasörü aç
          </button>
          <button className="ikon-dugme" onClick={kapat}>
            <Ikon ad="x" />
          </button>
        </div>
        <p>Her kaydetme, sıkıştırma ve geri yüklemeden önce dosyanın o anki hâli buraya alınır; her mod için son 20 yedek tutulur.</p>
        <input className="girdi" placeholder="Mod ara" value={filtre} onChange={(e) => setFiltre(e.target.value)} />
        <div className="yedek-listesi">
          {liste && !gorunen.length && <span className="soluk">Yedek yok.</span>}
          {gorunen.map((y) => (
            <div key={y.yol} className="dosya-satiri">
              <Ikon ad="arsiv" />
              <span className="ad" title={y.kaynak ?? undefined}>
                {y.ad}
                <small className="soluk yedek-yolu">{gorunurYol(y)}</small>
              </span>
              <small>{new Date(y.zaman * 1000).toLocaleString("tr")}</small>
              <small>{boyutYaz(y.boyut)}</small>
              <button className="dugme kucuk" onClick={() => geriYukle(y)}>
                Geri yükle
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
