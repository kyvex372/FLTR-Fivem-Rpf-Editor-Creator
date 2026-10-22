import { useEffect, useMemo, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api, dokuUrl, NOTR_RENK, uzanti, type DokuBilgi, type RenkAyari, type Sigdirma, type YtdIstegi } from "./api";
import type { BelgeBaglami } from "./Belge";
import { hex, hexCoz, Ikon, Kaydirici, useArayuz, useGeciktir } from "./ortak";

const SIGDIRMA_ANAHTARI = "tlk-rpf.sigdirma";
const GORSEL_UZANTILARI = ["png", "jpg", "jpeg", "webp", "bmp", "tga", "dds"];

function sigdirmaOku(): Sigdirma {
  try {
    return (localStorage.getItem(SIGDIRMA_ANAHTARI) as Sigdirma) || "esnet";
  } catch {
    return "esnet";
  }
}

const notrMu = (r: RenkAyari) =>
  r.ton === 0 && r.doygunluk === 1 && r.parlaklik === 0 && r.kontrast === 1 && (!r.boya || r.boya_gucu === 0);

export function RenkAyarlari({ renk, degisti }: { renk: RenkAyari; degisti: (r: RenkAyari) => void }) {
  return (
    <>
      <Kaydirici etiket="Ton" deger={renk.ton} min={-180} max={180} adim={1} degisti={(ton) => degisti({ ...renk, ton })} />
      <Kaydirici etiket="Doygunluk" deger={renk.doygunluk} min={0} max={3} degisti={(doygunluk) => degisti({ ...renk, doygunluk })} />
      <Kaydirici etiket="Parlaklık" deger={renk.parlaklik} min={-1} max={1} degisti={(parlaklik) => degisti({ ...renk, parlaklik })} />
      <Kaydirici etiket="Kontrast" deger={renk.kontrast} min={0} max={3} degisti={(kontrast) => degisti({ ...renk, kontrast })} />
      <div className="kaydirici">
        <label>Boya</label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={renk.boya_gucu}
          onChange={(e) => degisti({ ...renk, boya_gucu: Number(e.target.value), boya: renk.boya ?? [229, 36, 59] })}
        />
        <input
          type="color"
          value={renk.boya ? hex(...renk.boya) : "#e5243b"}
          onChange={(e) => degisti({ ...renk, boya: hexCoz(e.target.value), boya_gucu: renk.boya_gucu || 1 })}
        />
      </div>
    </>
  );
}

export function DokuEditoru({ ozet, surum, guncelle, yol, ilkSecim, birakmaHedefi }: BelgeBaglami & { yol: string; ilkSecim?: number }) {
  const ui = useArayuz();
  const [dokular, setDokular] = useState<DokuBilgi[] | null>(null);
  const [secili, setSecili] = useState(ilkSecim ?? 0);
  const [coklu, setCoklu] = useState<Set<number>>(new Set());
  const [arama, setArama] = useState("");
  const [renk, setRenk] = useState<RenkAyari>(NOTR_RENK);
  const [onizlemeRengi, setOnizlemeRengi] = useState<RenkAyari>(NOTR_RENK);
  const [sigdirma, setSigdirma] = useState<Sigdirma>(sigdirmaOku);
  const onizlemeyiGuncelle = useGeciktir((r: RenkAyari) => setOnizlemeRengi(r), 140);
  // ypt gibi kaynakların içindeki sözlük yalnız yerinde düzenlenir (boyut/biçim sabit, ekleme/silme yok)
  const yerinde = uzanti(yol) !== "ytd";

  useEffect(() => {
    if (ilkSecim !== undefined) setSecili(ilkSecim);
  }, [ilkSecim]);

  useEffect(() => {
    api.ytdListesi(ozet.id, yol).then(setDokular).catch((e) => {
      ui.hata(e);
      setDokular([]);
    });
  }, [ozet.id, yol, surum, ui]);

  const suzulmus = useMemo(
    () => (dokular ?? []).filter((d) => !arama || d.ad.toLowerCase().includes(arama.toLowerCase())),
    [dokular, arama],
  );
  const d = dokular?.[secili];
  const hedefler = coklu.size ? [...coklu] : [secili];

  const renkDegisti = (r: RenkAyari) => {
    setRenk(r);
    onizlemeyiGuncelle(r);
  };

  const islem = async (metin: string, fn: () => Promise<typeof ozet>, basari: string) => {
    const o = await ui.mesgul(metin, fn);
    if (o) {
      guncelle(o);
      ui.bildir(basari, "tamam");
    }
  };

  const gorselleDegistir = async () => {
    if (!d) return;
    const s = await open({ title: `${d.ad} yerine görsel`, filters: [{ name: "Görsel", extensions: GORSEL_UZANTILARI }] });
    if (typeof s !== "string") return;
    await islem("Doku kodlanıyor", () => api.dokuDegistir(ozet.id, yol, d.i, s, sigdirma, renk), `${d.ad} değiştirildi`);
    setRenk(NOTR_RENK);
    setOnizlemeRengi(NOTR_RENK);
  };

  /** Sözlüğü yeniden kuran işlem sonrası listeyi tazeler ve seçimi adıyla korur. */
  const yenidenKur = async (metin: string, islemler: YtdIstegi[], basari: string, secilecek?: string) => {
    const o = await ui.mesgul(metin, () => api.ytdIslem(ozet.id, yol, islemler));
    if (!o) return;
    guncelle(o);
    const yeni = await api.ytdListesi(ozet.id, yol);
    setDokular(yeni);
    setCoklu(new Set());
    setSecili(yeni.find((x) => x.ad === secilecek)?.i ?? 0);
    ui.bildir(basari, "tamam");
  };

  const dokuEkle = async () => {
    const s = await open({ multiple: true, title: "Sözlüğe eklenecek görseller", filters: [{ name: "Görsel", extensions: GORSEL_UZANTILARI }] });
    if (!s) return;
    const yollar = Array.isArray(s) ? s : [s];
    const adlar = yollar.map((y) =>
      y
        .split(/[\\/]/)
        .pop()!
        .replace(/\.[^.]+$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9_.-]+/g, "_")
        .slice(0, 63),
    );
    const cakisan = adlar.filter((a) => dokular?.some((d) => d.ad === a));
    if (cakisan.length && !(await ui.onayla("Aynı adlı doku var", `${cakisan.join(", ")} değiştirilecek.`, "Değiştir", true))) return;
    await yenidenKur(
      "Dokular ekleniyor",
      yollar.map((gorsel, i) => ({ tur: "koy" as const, ad: adlar[i], gorsel })),
      `${yollar.length} doku eklendi`,
      adlar.at(-1),
    );
  };

  const renkUygula = async () => {
    await islem(
      `${hedefler.length} doku renklendiriliyor`,
      () => api.dokuRenklendir(ozet.id, yol, hedefler, renk),
      `${hedefler.length} doku renklendirildi`,
    );
    setRenk(NOTR_RENK);
    setOnizlemeRengi(NOTR_RENK);
  };

  const disa = async (uz: "png" | "dds") => {
    if (!d) return;
    const s = await save({ defaultPath: `${d.ad}.${uz}`, filters: [{ name: uz.toUpperCase(), extensions: [uz] }] });
    if (!s) return;
    try {
      await api.dokuDisa(ozet.id, yol, d.i, s);
      ui.bildir(`${d.ad}.${uz} kaydedildi`, "tamam");
    } catch (e) {
      ui.hata(e);
    }
  };

  const topluDisa = async () => {
    const k = await open({ directory: true, title: "Dokular hangi klasöre çıkarılsın?" });
    if (typeof k !== "string") return;
    const n = await ui.mesgul("Dokular çıkarılıyor", () => api.dokuTopluDisa(ozet.id, yol, k, false));
    if (n !== undefined) ui.bildir(`${n} doku PNG olarak çıkarıldı. Düzenleyip aynı adla "Klasörden değiştir" ile geri koyabilirsin.`, "tamam");
  };

  const topluIce = async () => {
    const k = await open({ directory: true, title: "Aynı adlı görsellerin olduğu klasör" });
    if (typeof k !== "string") return;
    const r = await ui.mesgul("Eşleşen dokular yazılıyor", () => api.dokuTopluIce(ozet.id, yol, k, sigdirma));
    if (!r) return;
    if (r.ozet) guncelle(r.ozet);
    const atlanan = r.eslesmeyen.length ? ` · adı eşleşmeyen ${r.eslesmeyen.length} dosya atlandı (${r.eslesmeyen.slice(0, 4).join(", ")}${r.eslesmeyen.length > 4 ? "…" : ""})` : "";
    ui.bildir(r.eslesen.length ? `${r.eslesen.length} doku değiştirildi${atlanan}` : `Klasörde bu sözlükteki doku adlarıyla eşleşen görsel yok${atlanan}`, r.eslesen.length ? "tamam" : "bilgi");
  };

  const birakHedefi = (i: number) => `doku:${ozet.id}:${i}:${yol}`;

  return (
    <>
      <div className="duzenleyici-ust">
        <Ikon ad="resim" />
        <h2>
          {yol.split("/").pop()}
          <small>
            {dokular ? `${dokular.length} doku` : "yükleniyor"}
            {uzanti(yol) === "ypt" && " · parçacık efektlerinin dokuları (kan, kıvılcım, duman, patlama…)"}
          </small>
        </h2>
        <input className="girdi kucuk" placeholder="Doku ara" value={arama} onChange={(e) => setArama(e.target.value)} />
        {!yerinde && (
          <button className="dugme kucuk" onClick={dokuEkle} title="Görselleri yeni doku olarak ekler">
            <Ikon ad="arti" /> Doku ekle
          </button>
        )}
        <button className="dugme kucuk" onClick={topluDisa} title="Bütün dokuları seçtiğin klasöre ad.png olarak çıkarır">
          <Ikon ad="disa" /> Hepsini çıkar
        </button>
        <button className="dugme kucuk" onClick={topluIce} title="Klasördeki ad.png / ad.dds dosyalarını aynı adlı dokuların yerine koyar">
          <Ikon ad="ice" /> Klasörden değiştir
        </button>
        <button className="dugme kucuk" onClick={() => setCoklu(coklu.size ? new Set() : new Set(suzulmus.map((x) => x.i)))}>
          {coklu.size ? `Seçimi bırak (${coklu.size})` : "Hepsini seç"}
        </button>
      </div>
      <div className="doku-duzen">
        <div className="doku-izgara">
          {suzulmus.map((x) => (
            <div
              key={x.i}
              className={`doku-kart${x.i === secili ? " secili" : ""}${coklu.has(x.i) ? " coklu" : ""}${birakmaHedefi === birakHedefi(x.i) ? " birakma-hedefi" : ""}`}
              data-birak={birakHedefi(x.i)}
              onClick={(e) => {
                if (e.ctrlKey || e.shiftKey) {
                  const s = new Set(coklu);
                  if (s.has(x.i)) s.delete(x.i);
                  else s.add(x.i);
                  setCoklu(s);
                } else setSecili(x.i);
              }}
              title={`${x.ad}\n${x.genislik}×${x.yukseklik} ${x.bicim} · ${x.seviye} mip\nCtrl+tık: çoklu seçim · Görsel sürükle: değiştir`}
            >
              <div className="resim dama">
                {x.destekli ? (
                  <img src={dokuUrl(ozet.id, yol, x.i, 128, surum)} loading="lazy" draggable={false} alt="" />
                ) : (
                  <span className="soluk">{x.bicim}</span>
                )}
              </div>
              <div className="alt">
                <b>{x.ad}</b>
                <span>
                  {x.genislik}×{x.yukseklik} · {x.bicim}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="doku-detay">
          {d ? (
            <>
              <div
                className={`buyuk-onizleme dama${birakmaHedefi === birakHedefi(d.i) ? " birakma-hedefi" : ""}`}
                data-birak={birakHedefi(d.i)}
              >
                {d.destekli && (
                  <img
                    src={dokuUrl(ozet.id, yol, d.i, 512, surum, notrMu(onizlemeRengi) ? undefined : onizlemeRengi)}
                    draggable={false}
                    alt=""
                  />
                )}
                {!notrMu(onizlemeRengi) && <span className="rozet sari etiket">önizleme</span>}
              </div>
              <div className="bilgi-izgara">
                <span>Ad</span>
                <b style={{ userSelect: "text" }}>{d.ad}</b>
                <span>Boyut</span>
                <b>
                  {d.genislik} × {d.yukseklik}
                </b>
                <span>Biçim</span>
                <b>
                  {d.bicim} · {d.seviye} mip
                </b>
              </div>
              <div className="ayar-grubu">
                <h4>Değiştir</h4>
                <div className="satir-eylem">
                  <button className="dugme birincil" disabled={!d.destekli} onClick={gorselleDegistir}>
                    <Ikon ad="ice" /> Görselle değiştir…
                  </button>
                  <select
                    className="girdi"
                    value={sigdirma}
                    title="Görsel dokunun oranında değilse"
                    onChange={(e) => {
                      const v = e.target.value as Sigdirma;
                      setSigdirma(v);
                      try {
                        localStorage.setItem(SIGDIRMA_ANAHTARI, v);
                      } catch {
                        /* tercih hatırlanmaz */
                      }
                    }}
                  >
                    <option value="esnet">Esnet</option>
                    <option value="sigdir">Sığdır</option>
                    <option value="doldur">Doldur (kırp)</option>
                  </select>
                </div>
                <span className="soluk" style={{ fontSize: 12 }}>
                  PNG, JPG, WEBP, TGA ya da DDS. Görsel dokunun boyutuna ve {d.bicim} biçimine çevrilir, mip'ler yeniden üretilir. Karta
                  sürükleyip bırakmak da olur.
                </span>
                {yerinde && (
                  <span className="soluk" style={{ fontSize: 12 }}>
                    Bu dosyanın içindeki dokular değiştirilebilir ve boyutlandırılabilir; doku eklenip silinemez.
                  </span>
                )}
                <div className="satir-eylem">
                  <button
                    className="dugme kucuk"
                    disabled={!d.destekli}
                    title="Görseli kendi çözünürlüğünde koyar; doku boyutu görselinki olur"
                    onClick={async () => {
                      const s = await open({ title: `${d.ad} yerine (kendi boyutunda)`, filters: [{ name: "Görsel", extensions: GORSEL_UZANTILARI }] });
                      if (typeof s === "string") await yenidenKur("Doku kodlanıyor", [{ tur: "koy", ad: d.ad, gorsel: s }], `${d.ad} görselin boyutunda değiştirildi`, d.ad);
                    }}
                  >
                    Görselin kendi boyutunda
                  </button>
                  <button
                    className="dugme kucuk"
                    disabled={!d.destekli}
                    onClick={async () => {
                      const g = await ui.sor("Yeni boyut", `${d.genislik}x${d.yukseklik}`, "genişlik x yükseklik (ör. 1024x1024; 2'nin kuvvetleri en güvenlisi)");
                      const m = g?.match(/^\s*(\d+)\s*[x×*]\s*(\d+)\s*$/i);
                      if (!m) return;
                      const boyut: [number, number] = [Number(m[1]), Number(m[2])];
                      await yenidenKur("Boyutlandırılıyor", [{ tur: "olcekle", ad: d.ad, boyut }], `${d.ad} ${boyut.join("x")} yapıldı`, d.ad);
                    }}
                  >
                    Boyutlandır…
                  </button>
                  {!yerinde && (
                  <button
                    className="dugme kucuk tehlike"
                    onClick={async () => {
                      const adlar = coklu.size ? [...coklu].map((i) => dokular![i].ad) : [d.ad];
                      if (!(await ui.onayla(`${adlar.length} doku silinsin mi?`, `${adlar.slice(0, 8).join(", ")}${adlar.length > 8 ? "…" : ""}
Geri al ile dönebilirsin.`, "Sil", true))) return;
                      await yenidenKur("Siliniyor", adlar.map((ad) => ({ tur: "sil" as const, ad })), `${adlar.length} doku silindi`);
                    }}
                  >
                    <Ikon ad="cop" /> {coklu.size ? `${coklu.size} dokuyu sil` : "Sil"}
                  </button>
                  )}
                </div>
              </div>
              <div className="ayar-grubu">
                <h4>
                  Renk {coklu.size > 0 && <span className="rozet kirmizi">{coklu.size} doku</span>}
                  {!notrMu(renk) && (
                    <button
                      className="dugme kucuk hayalet"
                      onClick={() => {
                        setRenk(NOTR_RENK);
                        setOnizlemeRengi(NOTR_RENK);
                      }}
                    >
                      Sıfırla
                    </button>
                  )}
                </h4>
                <RenkAyarlari renk={renk} degisti={renkDegisti} />
                <button className="dugme birincil" disabled={notrMu(renk) || !d.destekli} onClick={renkUygula}>
                  <Ikon ad="palet" /> {coklu.size ? `${coklu.size} dokuya uygula` : "Uygula"}
                </button>
              </div>
              <div className="ayar-grubu">
                <h4>Ad</h4>
                <div className="satir-eylem">
                  <button
                    className="dugme"
                    onClick={async () => {
                      const ad = await ui.sor("Doku adı", d.ad, "Oyun dokuyu bu adla bulur; adı değişen doku eski yerinde görünmez.");
                      if (!ad || ad === d.ad) return;
                      const o = await ui.mesgul("Adlandırılıyor", () => api.dokuAdlandir(ozet.id, yol, d.i, ad));
                      if (!o) return;
                      guncelle(o);
                      const yeni = await api.ytdListesi(ozet.id, yol);
                      setDokular(yeni);
                      setSecili(yeni.find((x) => x.ad === ad.trim().toLowerCase())?.i ?? 0);
                      setCoklu(new Set());
                    }}
                  >
                    <Ikon ad="kalem" /> Yeniden adlandır
                  </button>
                </div>
              </div>
              <div className="ayar-grubu">
                <h4>Dışa aktar</h4>
                <div className="satir-eylem">
                  <button className="dugme" disabled={!d.destekli} onClick={() => disa("png")}>
                    <Ikon ad="disa" /> PNG
                  </button>
                  <button className="dugme" disabled={!d.destekli} onClick={() => disa("dds")}>
                    <Ikon ad="disa" /> DDS
                  </button>
                </div>
              </div>
            </>
          ) : (
            <span className="soluk">Doku seç</span>
          )}
        </div>
      </div>
    </>
  );
}
