import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, boyutYaz, dokuUrl, oyunYoluCoz, tumDugumler, uzanti, type ModelOzeti, type Paket } from "./api";
import type { BelgeBaglami } from "./Belge";
import { dugumIkonu } from "./Belge";
import { Ikon, useArayuz } from "./ortak";
import { hazirlariEsle, useTarama } from "./tarama";

const MODEL_UZANTILARI = ["ydr", "ydd", "yft"];

type ModelSuzgeci = "hepsi" | "dokulu" | "bos";

function ModelGalerisi({ ozet, surum, ac }: Pick<BelgeBaglami, "ozet" | "surum" | "ac">) {
  const [liste, setListe] = useState<ModelOzeti[] | null>(null);
  const [suzgec, setSuzgec] = useState<ModelSuzgeci>("hepsi");
  const [arama, setArama] = useState("");
  const [gosterilen, setGosterilen] = useState(60);
  useEffect(() => {
    api.modelOzetleri(ozet.id).then(
      (l) => setListe(l.sort((a, b) => a.yol.localeCompare(b.yol))),
      () => setListe([]),
    );
  }, [ozet.id, surum]);

  const ad = (yol: string) => yol.split("/").pop()!;
  const bos = liste?.filter((m) => !m.hata && m.ucgen === 0).length ?? 0;
  const dokulu = liste?.filter((m) => m.doku > 0).length ?? 0;
  const gorunen = (liste ?? []).filter(
    (m) =>
      (suzgec === "hepsi" || (suzgec === "bos" ? !m.hata && m.ucgen === 0 : m.doku > 0)) &&
      (!arama || ad(m.yol).toLowerCase().includes(arama.toLowerCase())),
  );

  return (
    <div className="kart genis">
      <div className="kart-ust">
        <h3>
          <Ikon ad="kup" renk="var(--vurgu)" /> Modeller {liste && <small className="soluk">{liste.length}</small>}
        </h3>
        <input className="girdi kucuk" placeholder="Model ara" value={arama} onChange={(e) => setArama(e.target.value)} />
        <div className="secenek-grubu">
          {(
            [
              ["hepsi", "Tümü", liste?.length],
              ["dokulu", "Dokulu", dokulu],
              ["bos", "Boş", bos],
            ] as const
          ).map(([k, etiket, n]) => (
            <button key={k} className={`dugme kucuk${suzgec === k ? " birincil" : ""}`} onClick={() => setSuzgec(k)}>
              {etiket} {n !== undefined && <small>{n}</small>}
            </button>
          ))}
        </div>
      </div>
      <p>
        Modele tıkla, 3B açılsın; parçaya tıklayıp dokusunu değiştir. Boş modeller oyunda objeyi gizler (optimizasyon modlarının yaptığı).
      </p>
      {!liste && <span className="soluk">Modeller okunuyor…</span>}
      <div className="model-izgara">
        {gorunen.slice(0, gosterilen).map((m) => (
          <button key={m.yol} className="model-kart" onClick={() => ac(m.yol)} title={m.hata ?? m.yol}>
            <span className="kapak dama">
              {m.kapak !== null ? (
                <img src={dokuUrl(ozet.id, m.yol, m.kapak, 96, surum)} loading="lazy" draggable={false} alt="" />
              ) : (
                <Ikon ad="kup" boy={26} />
              )}
            </span>
            <b>{ad(m.yol)}</b>
            <small>
              {m.hata ? (
                <span className="rozet kirmizi">okunamadı</span>
              ) : m.ucgen === 0 ? (
                <span className="rozet sari">boş</span>
              ) : (
                `${m.ucgen.toLocaleString("tr")} üçgen`
              )}
              {m.doku > 0 && ` · ${m.doku} doku`} · {boyutYaz(m.boyut)}
            </small>
          </button>
        ))}
      </div>
      {gorunen.length > gosterilen && (
        <button className="dugme kucuk" style={{ marginTop: 10 }} onClick={() => setGosterilen(gosterilen + 120)}>
          {gorunen.length - gosterilen} model daha göster
        </button>
      )}
    </div>
  );
}

const BILINEN_HEDEFLER: Record<string, string> = {
  "visualsettings.dat": "update\\update.rpf\\common\\data\\visualsettings.dat",
  "graphics.ytd": "update\\update.rpf\\x64\\textures\\graphics.ytd",
  "peddamagedecals.ytd": "update\\update.rpf\\x64\\textures\\peddamagedecals.ytd",
  "playerinfo.ymt": "update\\update.rpf\\x64\\data\\tune\\playerinfo.ymt",
  "timecycle_mods_1.xml": "update\\update.rpf\\common\\data\\timecycle\\timecycle_mods_1.xml",
  "timecycle_mods_2.xml": "update\\update.rpf\\common\\data\\timecycle\\timecycle_mods_2.xml",
  "timecycle_mods_3.xml": "update\\update.rpf\\common\\data\\timecycle\\timecycle_mods_3.xml",
  "timecycle_mods_4.xml": "update\\update.rpf\\common\\data\\timecycle\\timecycle_mods_4.xml",
};

export function Ozet({ ozet, surum, guncelle, ac, disaAktar }: BelgeBaglami & { disaAktar: (y: string[]) => void }) {
  const ui = useArayuz();
  const { tarama } = useTarama(ozet, surum);
  const [paketFormu, setPaketFormu] = useState<Paket | null>(ozet.paket);
  const [haritaKarosu, setHaritaKarosu] = useState(0);
  useEffect(() => {
    api.haritaDuzeni(ozet.id).then((h) => setHaritaKarosu(h.karolar.length), () => setHaritaKarosu(0));
  }, [ozet.id, surum]);
  useEffect(() => setPaketFormu(ozet.paket), [ozet.paket]);

  const dosyalar = tumDugumler(ozet.agac).filter((d) => d.tur === "dosya");
  const eslesmeler = tarama ? hazirlariEsle(tarama) : [];
  const ytdler = dosyalar.filter((d) => ["ytd", "ypt"].includes(uzanti(d.ad)));
  const ayarlar = dosyalar.filter((d) => d.ad.toLowerCase() === "visualsettings.dat");
  const modelSayisi = dosyalar.filter((d) => MODEL_UZANTILARI.includes(uzanti(d.ad))).length;
  const digerleri = dosyalar.filter(
    (d) => !ytdler.includes(d) && !ayarlar.includes(d) && !MODEL_UZANTILARI.includes(uzanti(d.ad)) && d.yol !== "assembly.xml",
  );
  const icArsivler = tumDugumler(ozet.agac).filter((d) => d.tur === "arsiv");
  const eksik = new Set(ozet.eksik_kaynak);
  // content/ altında olup hiçbir eşlemenin göstermediği dosyalar (iç arşivlerin içi hariç)
  const eslenen = new Set(ozet.paket?.hedefler.map((h) => h.kaynak) ?? []);
  const icArsivIci = (y: string) => tumDugumler(ozet.agac).some((d) => d.tur === "arsiv" && y.startsWith(`${d.yol}/`));
  const sahipsiz = tumDugumler(ozet.agac)
    .filter((d) => d.tur !== "dizin" && d.yol.startsWith("content/") && !icArsivIci(d.yol))
    .map((d) => d.yol.slice("content/".length))
    .filter((y) => !eslenen.has(y));
  const oneriler = [...eksik].flatMap((e) => {
    const adaylar = sahipsiz.filter((s) => uzanti(s) === uzanti(e));
    return adaylar.length === 1 ? [{ eski: e, yeni: adaylar[0] }] : [];
  });

  const islem = async (fn: () => Promise<typeof ozet>, mesaj?: string) => {
    try {
      guncelle(await fn());
      if (mesaj) ui.bildir(mesaj, "tamam");
    } catch (e) {
      ui.hata(e);
    }
  };

  const hedefliEkle = async () => {
    const s = await open({ title: "Pakete eklenecek dosya" });
    if (typeof s !== "string") return;
    const ad = s.split(/[\\/]/).pop()!.toLowerCase();
    const mevcut = ozet.paket?.hedefler.find((h) => h.yol.toLowerCase().endsWith(ad));
    const tahmin = BILINEN_HEDEFLER[ad] ?? (mevcut ? [...mevcut.arsivler, mevcut.yol].join("\\") : "");
    const hedef = await ui.sor(
      "Oyunda nereye gitsin?",
      tahmin,
      "Tam oyun yolu, arşivler dahil. Örnek: update\\update.rpf\\common\\data\\visualsettings.dat",
    );
    if (!hedef) return;
    const { arsivler, yol } = oyunYoluCoz(hedef);
    islem(() => api.hedefliEkle(ozet.id, { kaynak: s, arsivler, yol }), `${ad} → ${hedef}`);
  };

  const bosAlan = ozet.disk_boyutu - ozet.tahmini_boyut;
  const oneriliEksik = new Set(oneriler.map((o) => o.eski));
  const kalanEksik = [...eksik].filter((e) => !oneriliEksik.has(e));
  const sorunVar = !!ozet.paket_hatasi || oneriler.length > 0 || kalanEksik.length > 0 || (sahipsiz.length > 0 && !!ozet.paket);

  const hepsiniOnar = () =>
    islem(async () => {
      let o = ozet;
      for (const x of oneriler) o = await api.kaynakOnar(ozet.id, x.eski, x.yeni);
      return o;
    }, `${oneriler.length} eşleme onarıldı`);

  return (
    <div className="kaydir">
      <div className="ozet">
        <div className="kart genis">
          <div className="istatistik">
            <div>
              <b>{dosyalar.length}</b>
              <span>dosya</span>
            </div>
            <div>
              <b>{ytdler.length}</b>
              <span>doku sözlüğü</span>
            </div>
            {modelSayisi > 0 && (
              <div>
                <b>{modelSayisi}</b>
                <span>model</span>
              </div>
            )}
            <div>
              <b>{ozet.disk_boyutu ? boyutYaz(ozet.disk_boyutu) : "—"}</b>
              <span>diskte</span>
            </div>
            <div>
              <b>≈ {boyutYaz(ozet.tahmini_boyut)}</b>
              <span>kaydedince</span>
            </div>
            {bosAlan > 256 * 1024 && ozet.disk_boyutu > 0 && (
              <div>
                <b style={{ color: "var(--yesil)" }}>−{boyutYaz(bosAlan)}</b>
                <span>ölü alan temizlenecek</span>
              </div>
            )}
          </div>
        </div>

        {sorunVar && (
          <div className="kart genis sorun-karti">
            <div className="kart-ust">
              <h3>
                <Ikon ad="uyari" renk="var(--sari)" /> Düzeltilmesi gerekenler
              </h3>
              {oneriler.length > 1 && (
                <button className="dugme kucuk birincil" onClick={hepsiniOnar}>
                  Hepsini onar ({oneriler.length})
                </button>
              )}
            </div>
            {ozet.paket_hatasi && <p style={{ color: "var(--vurgu-acik)" }}>assembly.xml okunamadı: {ozet.paket_hatasi}</p>}
            {oneriler.map((o) => (
              <div className="onari" key={o.eski}>
                <Ikon ad="uyari" renk="var(--sari)" />
                <span>
                  assembly.xml pakette olmayan <code>{o.eski}</code> dosyasını gösteriyor; pakette eşlenmemiş <code>{o.yeni}</code> var. Büyük ihtimalle
                  yeniden adlandırılmış; bu hâliyle FiveM bu kısmı yüklemez.
                </span>
                <button className="dugme kucuk birincil" onClick={() => islem(() => api.kaynakOnar(ozet.id, o.eski, o.yeni), "Eşleme onarıldı")}>
                  Onar
                </button>
              </div>
            ))}
            {kalanEksik.length > 0 && (
              <div className="onari">
                <Ikon ad="uyari" renk="var(--sari)" />
                <span>
                  assembly.xml'de kaynağı pakette olmayan {kalanEksik.length} satır var ({kalanEksik.slice(0, 3).join(", ")}
                  {kalanEksik.length > 3 ? "…" : ""}). Zararsızdır ama paketi kirletir.
                </span>
                <button
                  className="dugme kucuk"
                  onClick={async () => {
                    if (
                      await ui.onayla(
                        `${kalanEksik.length} ölü satır temizlensin mi?`,
                        "Kaynağı pakette olmayan <add> satırları silinir. assembly.xml yeniden yazılır; yorumlar gibi ekstralar kaybolur.",
                        "Temizle",
                        true,
                      )
                    )
                      islem(() => api.oluSatirlariTemizle(ozet.id), "assembly.xml temizlendi");
                  }}
                >
                  Temizle
                </button>
              </div>
            )}
            {sahipsiz.length > 0 && !oneriler.length && ozet.paket && (
              <p style={{ color: "var(--sari)" }}>
                Pakette olup hiçbir oyun yoluna eşlenmemiş dosyalar (oyuna gitmez): {sahipsiz.slice(0, 6).join(", ")}
                {sahipsiz.length > 6 ? "…" : ""}. Aşağıdaki "Hedefli dosya ekle" ile eşleyebilirsin.
              </p>
            )}
          </div>
        )}

        {haritaKarosu > 0 && (
          <div className="kart genis harita-karti" onClick={() => ac("harita-editoru")}>
            <div className="kart-ust">
              <h3>
                <Ikon ad="hedef" renk="var(--vurgu)" /> ESC / radar haritası
              </h3>
              <button className="dugme kucuk birincil">Harita düzenleyiciyi aç</button>
            </div>
            <p>
              Bu pakette {haritaKarosu} harita karosu var. Haritayı tek parça görüp üstüne foto/logo ekleyebilir, oyun koordinatına göre yerleştirebilir,
              tüm haritayı değiştirebilir ya da renklendirebilirsin.
            </p>
          </div>
        )}

        <div className="kart genis">
          <div className="kart-ust">
            <h3>
              <Ikon ad="pirilti" renk="var(--vurgu)" /> Hazır ayarlar
            </h3>
            {!tarama && <span className="soluk">içerik taranıyor…</span>}
          </div>
          {tarama && !eslesmeler.length && <p>Bu modda hazır ayarı olan bir içerik bulunamadı. Dosyaları soldan açıp doğrudan düzenleyebilirsin.</p>}
          <div className="hazir-liste">
            {eslesmeler.map((e) => (
              <button key={e.hazir.id} className="hazir" onClick={() => ac(`hazir:${e.hazir.id}`)}>
                <b>{e.hazir.ad}</b>
                <small>{e.hazir.aciklama}</small>
                <div className="renk-seridi">
                  {e.renkler.slice(0, 10).map((r, i) => (
                    <i key={i} style={{ background: r }} />
                  ))}
                </div>
                <small>
                  {e.anahtarSayisi > 0 && `${e.anahtarSayisi} ayar`}
                  {e.anahtarSayisi > 0 && e.dokular.length > 0 && " · "}
                  {e.dokular.length > 0 && `${e.dokular.length} doku`}
                </small>
              </button>
            ))}
          </div>
          {!!tarama?.atlananYtd && <p style={{ marginTop: 10 }}>{tarama.atlananYtd} büyük doku dosyası taramaya alınmadı; soldan açılabilir.</p>}
        </div>

        {modelSayisi > 0 && <ModelGalerisi ozet={ozet} surum={surum} ac={ac} />}

        {(ytdler.length > 0 || ayarlar.length > 0) && (
          <div className="kart">
            <h3>
              <Ikon ad="resim" /> Dokular ve görsel ayarlar
            </h3>
            <p>Doku sözlüklerini aç, görseli sürükleyip bırakarak değiştir.</p>
            <div className="dosya-listesi">
              {[...ayarlar, ...ytdler].slice(0, 40).map((d) => {
                const y = tarama?.ytdler.find((x) => x.yol === d.yol);
                const a = tarama?.ayarlar.find((x) => x.yol === d.yol);
                return (
                  <div key={d.yol} className="dosya-satiri" onClick={() => ac(d.yol)}>
                    <Ikon ad={dugumIkonu(d)} />
                    <span className="ad">{d.yol}</span>
                    <small>{y ? `${y.dokular.length} doku` : a ? `${a.girdiler.length} ayar · ${a.renkler.length} renk` : boyutYaz(d.boyut)}</small>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(digerleri.length > 0 || icArsivler.length > 0) && (
          <div className="kart">
            <h3>
              <Ikon ad="dosya" /> Diğer dosyalar
            </h3>
            <p>Metin dosyaları editörde açılır, diğerleri dışa aktarılıp değiştirilebilir.</p>
            <div className="dosya-listesi">
              {[...icArsivler, ...digerleri].slice(0, 40).map((d) => (
                <div key={d.yol} className="dosya-satiri" onClick={() => ac(d.yol)}>
                  <Ikon ad={dugumIkonu(d)} renk={d.tur === "arsiv" ? "var(--vurgu)" : undefined} />
                  <span className="ad">{d.yol}</span>
                  <small>{boyutYaz(d.boyut)}</small>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="kart genis">
          <div className="kart-ust">
            <h3>
              <Ikon ad="paket" /> Paket (assembly.xml)
            </h3>
            <button className="dugme kucuk" onClick={hedefliEkle}>
              <Ikon ad="hedef" /> Hedefli dosya ekle
            </button>
            <button className="dugme kucuk" onClick={() => disaAktar([""])}>
              <Ikon ad="disa" /> Hepsini çıkar
            </button>
          </div>
          {!ozet.paket && !ozet.paket_hatasi && (
            <p>Bu arşivde assembly.xml yok; FiveM mods klasörü paketleri için gerekli. "Hedefli dosya ekle" ile oluşturabilirsin.</p>
          )}
          {paketFormu && (
            <>
              <div className="form-izgara">
                <label>
                  Paket adı
                  <input className="girdi" value={paketFormu.ad} onChange={(e) => setPaketFormu({ ...paketFormu, ad: e.target.value })} />
                </label>
                <label>
                  Yazar
                  <input className="girdi" value={paketFormu.yazar} onChange={(e) => setPaketFormu({ ...paketFormu, yazar: e.target.value })} />
                </label>
                <label>
                  Sürüm
                  <input className="girdi" value={paketFormu.surum} onChange={(e) => setPaketFormu({ ...paketFormu, surum: e.target.value })} />
                </label>
              </div>
              {(paketFormu.ad !== ozet.paket?.ad || paketFormu.yazar !== ozet.paket?.yazar || paketFormu.surum !== ozet.paket?.surum) && (
                <div className="satir-eylem" style={{ marginBottom: 10 }}>
                  <button className="dugme kucuk birincil" onClick={() => islem(() => api.paketYaz(ozet.id, paketFormu), "Paket bilgisi güncellendi")}>
                    Uygula
                  </button>
                  <button className="dugme kucuk" onClick={() => setPaketFormu(ozet.paket)}>
                    Vazgeç
                  </button>
                </div>
              )}
              <table className="hedef-tablosu">
                <tbody>
                  {paketFormu.hedefler.slice(0, 300).map((h, i) => (
                    <tr key={i} className={eksik.has(h.kaynak) ? "eksik" : ""}>
                      <td style={{ width: "38%" }}>
                        <code>{h.sil ? "(sil)" : h.kaynak}</code>
                      </td>
                      <td>
                        <code>{[...h.arsivler, h.yol].join(" › ")}</code>
                      </td>
                      <td style={{ width: 60 }}>{eksik.has(h.kaynak) && <span className="rozet sari">yok</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {paketFormu.hedefler.length > 300 && <p>… {paketFormu.hedefler.length - 300} satır daha</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
