import { useEffect, useState } from "react";
import { api, boyutYaz, type CakismaAyrintisi, type ModRaporu } from "./api";
import { Ikon, useArayuz } from "./ortak";

export function CakismaPenceresi({
  rapor,
  hedef,
  modlar,
  kapat,
  modKapat,
}: {
  rapor: ModRaporu;
  hedef: string;
  modlar: string[];
  kapat: () => void;
  modKapat: (dosya: string) => Promise<void>;
}) {
  const ui = useArayuz();
  const [a, setA] = useState<CakismaAyrintisi | null>(null);

  useEffect(() => {
    api.cakismaIncele(rapor.klasor, hedef, modlar).then(setA, (e) => {
      ui.hata(e);
      kapat();
    });
  }, [rapor.klasor, hedef, modlar, ui, kapat]);

  const ad = (dosya: string) => rapor.modlar.find((m) => m.dosya === dosya)?.paket?.ad || dosya;
  const kisa = hedef.split("\\").pop();

  return (
    <div className="perde" onMouseDown={(e) => e.target === e.currentTarget && kapat()}>
      <div className="modal genis-modal">
        <div className="kart-ust">
          <h3 style={{ flex: 1 }}>
            <Ikon ad="uyari" renk="var(--sari)" /> Çakışma: {kisa}
          </h3>
          <button className="ikon-dugme" onClick={kapat}>
            <Ikon ad="x" />
          </button>
        </div>
        <p>
          <code>{hedef}</code> dosyasını {modlar.length} açık mod değiştiriyor; oyunda yalnız biri geçerli olur. Hangisinin kalacağını seçip diğerini
          kapat.
        </p>
        {!a && <span className="soluk">Karşılaştırılıyor…</span>}
        {a && (
          <>
            <div className="cakisma-modlari">
              {a.kaynaklar.map((k) => (
                <div key={k.mod_dosyasi} className="dosya-satiri">
                  <Ikon ad="paket" />
                  <span className="ad">
                    <b>{ad(k.mod_dosyasi)}</b> <small className="soluk">{k.mod_dosyasi}</small>
                  </span>
                  <small>{k.hata ? <span className="rozet kirmizi">{k.hata}</span> : boyutYaz(k.boyut)}</small>
                  <button className="dugme kucuk" onClick={() => modKapat(k.mod_dosyasi)}>
                    Bu modu kapat
                  </button>
                </div>
              ))}
            </div>
            {a.hepsi_ayni && (
              <div className="onari">
                <Ikon ad="bilgi" />
                <span>
                  İki moddaki <b>{kisa}</b> birebir aynı; hangisi geçerli olursa olsun sonuç değişmez. Başka farkları yoksa modlardan biri gereksiz.
                </span>
              </div>
            )}
            {a.ayar_farki_sayisi > 0 && (
              <>
                <h4 style={{ margin: "12px 0 6px" }}>Farklı ayarlar ({a.ayar_farki_sayisi})</h4>
                <div className="cakisma-tablo">
                  <table className="hedef-tablosu">
                    <thead>
                      <tr>
                        <th>Ayar</th>
                        {a.kaynaklar.map((k) => (
                          <th key={k.mod_dosyasi}>{k.mod_dosyasi}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {a.ayar_farklari.map((f) => (
                        <tr key={f.anahtar}>
                          <td>
                            <code>{f.anahtar}</code>
                          </td>
                          {f.degerler.map((d, i) => (
                            <td key={i}>{d ?? <span className="soluk">yok</span>}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {a.doku_farklari.length > 0 && (
              <div className="onari">
                <Ikon ad="resim" />
                <span>
                  Farklı dokular ({a.doku_farklari.length}): <b>{a.doku_farklari.slice(0, 12).join(", ")}</b>
                  {a.doku_farklari.length > 12 ? "…" : ""}. Geri kalan dokular iki modda aynı.
                </span>
              </div>
            )}
            {a.satir_farki_sayisi > 0 && (
              <>
                <h4 style={{ margin: "12px 0 6px" }}>Farklı satırlar ({a.satir_farki_sayisi})</h4>
                <div className="cakisma-tablo">
                  {a.satir_farklari.map((f, i) => (
                    <div key={i} className="cakisma-satir">
                      <span className="soluk">{f.var.map((v, j) => (v ? a.kaynaklar[j].mod_dosyasi : null)).filter(Boolean).join(", ")}</span>
                      <code>{f.satir}</code>
                    </div>
                  ))}
                </div>
              </>
            )}
            {!a.hepsi_ayni && !a.ayar_farki_sayisi && !a.doku_farklari.length && !a.satir_farki_sayisi && (
              <p className="soluk">Dosyalar farklı ama içerik ayrıntısı karşılaştırılamadı (ikili dosya).</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
