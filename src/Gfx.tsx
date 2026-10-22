import { useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api, gfxUrl, type GfxBilgisi, type Sigdirma } from "./api";
import type { BelgeBaglami } from "./Belge";
import { Ikon, useArayuz } from "./ortak";

const GORSEL_UZANTILARI = ["png", "jpg", "jpeg", "webp", "bmp", "tga", "dds"];

export function GfxGorunumu({ ozet, surum, guncelle, ac, yol }: BelgeBaglami & { yol: string }) {
  const ui = useArayuz();
  const [bilgi, setBilgi] = useState<GfxBilgisi | null>(null);
  const [secili, setSecili] = useState<number | null>(null);
  const [sigdirma, setSigdirma] = useState<Sigdirma>("esnet");

  useEffect(() => {
    api.gfxBilgi(ozet.id, yol).then(
      (b) => {
        setBilgi(b);
        setSecili((s) => s ?? b.gorseller[0]?.karakter ?? null);
      },
      (e) => {
        ui.hata(e);
        setBilgi({ gorseller: [], dis: [] });
      },
    );
  }, [ozet.id, yol, surum, ui]);

  const g = bilgi?.gorseller.find((x) => x.karakter === secili);

  const degistir = async () => {
    if (!g) return;
    const s = await open({ title: "Yerine konacak görsel", filters: [{ name: "Görsel", extensions: GORSEL_UZANTILARI }] });
    if (typeof s !== "string") return;
    const o = await ui.mesgul("Görsel yazılıyor", () => api.gfxDegistir(ozet.id, yol, g.karakter, s, sigdirma));
    if (!o) return;
    guncelle(o);
    ui.bildir("Görsel değiştirildi", "tamam");
  };

  const disa = async () => {
    if (!g) return;
    const s = await save({ defaultPath: `${yol.split("/").pop()!.replace(/\.gfx$/i, "")}_${g.karakter}.png`, filters: [{ name: "PNG", extensions: ["png"] }] });
    if (!s) return;
    try {
      await api.gfxDisa(ozet.id, yol, g.karakter, s);
      ui.bildir("PNG kaydedildi", "tamam");
    } catch (e) {
      ui.hata(e);
    }
  };

  return (
    <>
      <div className="duzenleyici-ust">
        <Ikon ad="resim" />
        <h2>
          {yol.split("/").pop()}
          <small>Scaleform arayüzü · {bilgi ? `${bilgi.gorseller.length} gömülü görsel · ${bilgi.dis.length} dış doku` : "okunuyor"}</small>
        </h2>
      </div>
      <div className="doku-duzen">
        <div className="kaydir" style={{ padding: 14 }}>
          {bilgi && !bilgi.gorseller.length && <p className="soluk">Bu arayüzün içinde görsel yok; çizimleri vektör ya da dış doku.</p>}
          <div className="doku-izgara" style={{ padding: 0 }}>
            {bilgi?.gorseller.map((x) => (
              <div key={x.karakter} className={`doku-kart${x.karakter === secili ? " secili" : ""}`} onClick={() => setSecili(x.karakter)}>
                <div className="resim dama">
                  <img src={gfxUrl(ozet.id, yol, x.karakter, 256, surum)} loading="lazy" draggable={false} alt="" />
                </div>
                <div className="alt">
                  <b>görsel {x.karakter}</b>
                  <span>
                    {x.genislik}×{x.yukseklik} · {x.tur}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {!!bilgi?.dis.length && (
            <div className="kart" style={{ marginTop: 14 }}>
              <h3>
                <Ikon ad="bilgi" /> Oyunun dokularından kullandıkları
              </h3>
              <p>Bu görseller gfx'in içinde değil, bir doku sözlüğünde (ytd) durur. Değiştirmek için o ytd'yi düzenle ya da aynı adla bir ytd ekle.</p>
              <div className="dosya-listesi">
                {bilgi.dis.map((d) => (
                  <div
                    key={d.ad}
                    className="dosya-satiri"
                    onClick={() => d.bulunan && ac(`${d.bulunan[0]}#${d.bulunan[1]}`)}
                    style={{ cursor: d.bulunan ? "pointer" : "default" }}
                  >
                    <Ikon ad="resim" />
                    <span className="ad">{d.ad}</span>
                    <small>{d.bulunan ? d.bulunan[0].split("/").pop() : "oyunda"}</small>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="doku-detay">
          {g ? (
            <>
              <div className="buyuk-onizleme dama">
                <img src={gfxUrl(ozet.id, yol, g.karakter, 1024, surum)} draggable={false} alt="" />
              </div>
              <div className="bilgi-izgara">
                <span>Boyut</span>
                <b>
                  {g.genislik} × {g.yukseklik}
                </b>
                <span>Tür</span>
                <b>{g.tur}</b>
              </div>
              <div className="ayar-grubu">
                <h4>Değiştir</h4>
                <div className="satir-eylem">
                  <button className="dugme birincil" onClick={degistir}>
                    <Ikon ad="ice" /> Görselle değiştir…
                  </button>
                  <select className="girdi" value={sigdirma} onChange={(e) => setSigdirma(e.target.value as Sigdirma)}>
                    <option value="esnet">Esnet</option>
                    <option value="sigdir">Sığdır</option>
                    <option value="doldur">Doldur (kırp)</option>
                  </select>
                </div>
                <span className="soluk" style={{ fontSize: 12 }}>
                  Arayüz bu görseli sabit boyutta çizdiği için yeni görsel {g.genislik}×{g.yukseklik} boyutuna getirilir; saydamlık korunur.
                </span>
                <button className="dugme" onClick={disa}>
                  <Ikon ad="disa" /> PNG olarak dışa aktar
                </button>
              </div>
            </>
          ) : (
            <span className="soluk">Görsel seç</span>
          )}
        </div>
      </div>
    </>
  );
}
