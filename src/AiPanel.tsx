import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, type AiSaglayici, type Ayarlar, type BelgeOzet } from "./api";
import { ajanCalistir, anahtardanHazir, butceAl, durdurulduMu, HAZIR_SAGLAYICILAR, hataAciklama, modelleriGetir, VARSAYILAN_MODEL, type AiOlay } from "./ai";
import { Ikon, useArayuz } from "./ortak";

interface Sohbet {
  olaylar: AiOlay[];
  gecmis: unknown[];
  protokol: string;
  sonAdim: number;
}

const sohbetler = new Map<number, Sohbet>();
const bosSohbet = (): Sohbet => ({ olaylar: [], gecmis: [], protokol: "", sonAdim: 0 });

const ONERILER = [
  "Hasar ekranını koyu kırmızı yap, biraz daha uzun kalsın",
  "dmg_overlay_fade dokusuna bak ve ne olduğunu anlat",
  "Işık hâlesi dokularını maviye boya",
  "Araç farlarını daha parlak ve beyaz yap",
];

/** Eski tek-anahtarlı ayarı sağlayıcı listesine taşır; anahtarın ön ekinden doğru sağlayıcıyı seçer. */
function ayarlariDuzelt(a: Ayarlar): Ayarlar {
  if (a.ai_saglayicilar?.length || !a.ai_anahtari) return a;
  const h = anahtardanHazir(a.ai_anahtari) ?? HAZIR_SAGLAYICILAR.find((x) => x.anahtar === "claude")!;
  const s: AiSaglayici = {
    ...h.sablon,
    id: h.anahtar,
    anahtar: a.ai_anahtari,
    model: h.anahtar === "claude" ? (a.ai_modeli ?? VARSAYILAN_MODEL) : h.sablon.model,
  };
  return { ai_saglayicilar: [s], ai_secili: s.id };
}

function SaglayiciFormu({
  ilk,
  kaydet,
  sil,
  vazgec,
}: {
  ilk: AiSaglayici;
  kaydet: (s: AiSaglayici) => void;
  sil?: () => void;
  vazgec: () => void;
}) {
  const ui = useArayuz();
  const [s, setS] = useState(ilk);
  const [modeller, setModeller] = useState<string[]>([]);
  const [yukleniyor, setYukleniyor] = useState(false);
  const hazir = HAZIR_SAGLAYICILAR.find((h) => h.sablon.adres === ilk.adres && h.sablon.tur === ilk.tur);
  const yerel = s.adres.startsWith("http://localhost") || s.adres.startsWith("http://127.0.0.1");

  const getir = async () => {
    setYukleniyor(true);
    try {
      const v = await modelleriGetir(s);
      setModeller(v);
      if (!s.model && v.length) {
        const oneri = v.find((m) => /flash/.test(m) && !/image|tts|embed|lite|live|audio/.test(m)) ?? v[0];
        setS((x) => ({ ...x, model: oneri }));
      }
      ui.bildir(`${v.length} model bulundu`, "tamam");
    } catch (e) {
      ui.hata(hataAciklama(e));
    } finally {
      setYukleniyor(false);
    }
  };

  return (
    <div className="ai-form">
      {hazir && (
        <div className="soluk">
          {hazir.not}{" "}
          {hazir.link && (
            <a href="#" onClick={(e) => (e.preventDefault(), openUrl(hazir.link))}>
              Anahtar al
            </a>
          )}
        </div>
      )}
      <label>
        Ad
        <input className="girdi kucuk" value={s.ad} onChange={(e) => setS({ ...s, ad: e.target.value })} />
      </label>
      {s.tur === "openai" && (
        <label>
          Adres (OpenAI uyumlu, /chat/completions'ın bir üstü)
          <input className="girdi kucuk" value={s.adres} placeholder="https://…/v1" onChange={(e) => setS({ ...s, adres: e.target.value })} />
        </label>
      )}
      <label>
        API anahtarı{yerel ? " (yerelde gerekmez)" : ""}
        <input
          className="girdi kucuk"
          type="password"
          autoComplete="off"
          value={s.anahtar}
          onChange={(e) => setS({ ...s, anahtar: e.target.value.trim() })}
        />
      </label>
      {(() => {
        const tahmin = s.anahtar ? anahtardanHazir(s.anahtar) : undefined;
        if (!tahmin || (tahmin.sablon.tur === s.tur && tahmin.sablon.adres === s.adres)) return null;
        return (
          <div className="onari">
            <Ikon ad="uyari" renk="var(--sari)" />
            <span>Bu anahtar {tahmin.ad} anahtarına benziyor.</span>
            <button
              className="dugme kucuk"
              onClick={() => setS({ ...s, ...tahmin.sablon, id: s.id, anahtar: s.anahtar, ad: tahmin.sablon.ad })}
            >
              {tahmin.ad} olarak ayarla
            </button>
          </div>
        );
      })()}
      <label>
        Model
        <div style={{ display: "flex", gap: 6 }}>
          <input
            className="girdi kucuk"
            style={{ flex: 1 }}
            list={`modeller-${s.id}`}
            value={s.model}
            placeholder="Modelleri getir ya da yaz"
            onChange={(e) => setS({ ...s, model: e.target.value.trim() })}
          />
          <datalist id={`modeller-${s.id}`}>
            {modeller.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <button className="dugme kucuk" disabled={yukleniyor || (!s.anahtar && !yerel) || !s.adres} onClick={getir}>
            {yukleniyor ? "…" : "Modelleri getir"}
          </button>
        </div>
      </label>
      <label className="yatay">
        <input type="checkbox" checked={s.gorsel} onChange={(e) => setS({ ...s, gorsel: e.target.checked })} />
        Model görsel görebiliyor (doku içeriğine bakabilsin)
      </label>
      <label>
        İstek başına token bütçesi (ücretsiz katmanlarda düşük tut; Groq ~5500)
        <input
          className="girdi kucuk"
          type="number"
          min={2500}
          step={500}
          value={s.butce ?? butceAl(s)}
          onChange={(e) => setS({ ...s, butce: Number(e.target.value) || undefined })}
        />
      </label>
      <div className="satir-eylem">
        <button className="dugme kucuk birincil" disabled={!s.adres || (!s.anahtar && !yerel)} onClick={() => kaydet(s)}>
          Kaydet
        </button>
        <button className="dugme kucuk" onClick={vazgec}>
          Vazgeç
        </button>
        {sil && (
          <button className="dugme kucuk tehlike" style={{ marginLeft: "auto" }} onClick={sil}>
            <Ikon ad="cop" /> Sil
          </button>
        )}
      </div>
    </div>
  );
}

export function AiPanel({ ozet, guncelle, kapat }: { ozet: BelgeOzet; guncelle: (o: BelgeOzet) => void; kapat: () => void }) {
  const ui = useArayuz();
  const [ayarlar, setAyarlar] = useState<Ayarlar | null>(null);
  const [ayarAcik, setAyarAcik] = useState(false);
  const [duzenlenen, setDuzenlenen] = useState<AiSaglayici | null>(null);
  const [sohbet, setSohbet] = useState<Sohbet>(() => sohbetler.get(ozet.id) ?? bosSohbet());
  const [istek, setIstek] = useState("");
  const [calisiyor, setCalisiyor] = useState(false);
  const iptal = useRef<AbortController | null>(null);
  const liste = useRef<HTMLDivElement>(null);
  const ozetRef = useRef(ozet);
  ozetRef.current = ozet;

  const saglayicilar = ayarlar?.ai_saglayicilar ?? [];
  const secili = saglayicilar.find((s) => s.id === ayarlar?.ai_secili) ?? saglayicilar[0];

  useEffect(() => {
    api.ayarlarOku().then((a) => {
      const d = ayarlariDuzelt(a);
      setAyarlar(d);
      if (d !== a) api.ayarlarYaz(d).catch(ui.hata);
      if (!d.ai_saglayicilar?.length) setAyarAcik(true);
    }, ui.hata);
  }, [ui]);

  useEffect(() => {
    sohbetler.set(ozet.id, sohbet);
    liste.current?.scrollTo({ top: liste.current.scrollHeight, behavior: "smooth" });
  }, [sohbet, ozet.id]);

  const ayarKaydet = async (yeni: Ayarlar) => {
    try {
      await api.ayarlarYaz(yeni);
      setAyarlar(yeni);
    } catch (e) {
      ui.hata(e);
    }
  };

  const saglayiciKaydet = async (s: AiSaglayici) => {
    const liste = saglayicilar.some((x) => x.id === s.id) ? saglayicilar.map((x) => (x.id === s.id ? s : x)) : [...saglayicilar, s];
    await ayarKaydet({ ...ayarlar, ai_saglayicilar: liste, ai_secili: s.id });
    setDuzenlenen(null);
    ui.bildir(`${s.ad} kaydedildi`, "tamam");
  };

  const gonder = async (metin = istek) => {
    const soru = metin.trim();
    if (!soru || calisiyor || !secili) return;
    setIstek("");
    setCalisiyor(true);
    const baslangicAdimi = ozetRef.current.geri;
    const ekle = (o: AiOlay) => setSohbet((s) => ({ ...s, olaylar: [...s.olaylar, o] }));
    ekle({ tur: "kullanici", metin: soru });
    const protokol = `${secili.tur}:${secili.id}`;
    const denetim = new AbortController();
    iptal.current = denetim;
    try {
      const r = await ajanCalistir({
        saglayici: secili,
        ozet: ozetRef.current,
        guncelle,
        gecmis: sohbet.protokol === protokol ? sohbet.gecmis : [],
        istek: soru,
        olay: ekle,
        sinyal: denetim.signal,
      });
      setSohbet((s) => ({ ...s, gecmis: r.gecmis, protokol, sonAdim: r.degisiklik ? ozetRef.current.geri - baslangicAdimi : 0 }));
    } catch (e) {
      ekle(durdurulduMu(e) ? { tur: "bilgi", metin: "Durduruldu." } : { tur: "hata", metin: hataAciklama(e) });
      const adim = ozetRef.current.geri - baslangicAdimi;
      setSohbet((s) => ({ ...s, sonAdim: adim > 0 ? adim : 0 }));
    } finally {
      setCalisiyor(false);
      iptal.current = null;
    }
  };

  const hepsiniGeriAl = async () => {
    let o = ozetRef.current;
    for (let i = 0; i < sohbet.sonAdim && o.geri > 0; i++) o = await api.geriAl(o.id);
    guncelle(o);
    setSohbet((s) => ({ ...s, sonAdim: 0, olaylar: [...s.olaylar, { tur: "bilgi", metin: "Son isteğin değişiklikleri geri alındı." }] }));
  };

  return (
    <div className="ai-panel">
      <div className="ai-ust">
        <Ikon ad="pirilti" renk="var(--vurgu)" />
        <b>AI ile düzenle</b>
        <span className="bosluk" />
        {saglayicilar.length > 0 && (
          <select
            className="girdi kucuk"
            value={secili?.id}
            title={secili ? `${secili.ad} · ${secili.model || "model yok"}` : ""}
            onChange={(e) => ayarlar && ayarKaydet({ ...ayarlar, ai_secili: e.target.value })}
          >
            {saglayicilar.map((s) => (
              <option key={s.id} value={s.id}>
                {s.ad}
              </option>
            ))}
          </select>
        )}
        <button className={`ikon-dugme${ayarAcik ? " etkin" : ""}`} title="AI sağlayıcıları" onClick={() => setAyarAcik(!ayarAcik)}>
          <Ikon ad="ayar" />
        </button>
        <button className="ikon-dugme" title="Sohbeti temizle" disabled={calisiyor} onClick={() => setSohbet(bosSohbet())}>
          <Ikon ad="cop" />
        </button>
        <button className="ikon-dugme" title="Kapat" onClick={kapat}>
          <Ikon ad="x" />
        </button>
      </div>

      {ayarAcik && (
        <div className="ai-ayar">
          {duzenlenen ? (
            <SaglayiciFormu
              key={duzenlenen.id}
              ilk={duzenlenen}
              kaydet={saglayiciKaydet}
              vazgec={() => setDuzenlenen(null)}
              sil={
                saglayicilar.some((x) => x.id === duzenlenen.id)
                  ? async () => {
                      const kalan = saglayicilar.filter((x) => x.id !== duzenlenen.id);
                      await ayarKaydet({ ...ayarlar, ai_saglayicilar: kalan, ai_secili: kalan[0]?.id });
                      setDuzenlenen(null);
                    }
                  : undefined
              }
            />
          ) : (
            <>
              {saglayicilar.length > 0 && (
                <div className="dosya-listesi">
                  {saglayicilar.map((s) => (
                    <div key={s.id} className="dosya-satiri" onClick={() => setDuzenlenen(s)}>
                      <input
                        type="radio"
                        checked={s.id === secili?.id}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => ayarKaydet({ ...ayarlar, ai_secili: s.id })}
                      />
                      <span className="ad">{s.ad}</span>
                      <small>{s.model || "model seçilmedi"}</small>
                      <Ikon ad="kalem" boy={13} />
                    </div>
                  ))}
                </div>
              )}
              <div className="soluk" style={{ margin: "8px 0 6px" }}>
                Ekle — ücretsiz denemek için Google Gemini önerilir:
              </div>
              <div className="ai-hazirlar">
                {HAZIR_SAGLAYICILAR.map((h) => (
                  <button
                    key={h.anahtar}
                    className="dugme kucuk"
                    title={h.not}
                    onClick={() => setDuzenlenen({ ...h.sablon, id: `${h.anahtar}-${Date.now().toString(36)}`, anahtar: "" })}
                  >
                    {h.ad}
                  </button>
                ))}
              </div>
              <div className="soluk" style={{ fontSize: 11.5, marginTop: 8 }}>
                Anahtarlar yalnız bu bilgisayarda, uygulamanın ayar klasöründe saklanır ve yalnız seçtiğin sağlayıcıya gönderilir.
              </div>
            </>
          )}
        </div>
      )}

      <div className="ai-akis" ref={liste}>
        {!sohbet.olaylar.length && (
          <div className="ai-bos">
            <p>
              Ne yapmak istediğini yaz. Asistan paketi okur, değiştirir ve ne yaptığını söyler. Her adım Geri al ile geri alınır, Kaydet'e basana
              kadar diske bir şey yazılmaz.
            </p>
            {ONERILER.map((o) => (
              <button key={o} className="hazir" disabled={!secili || calisiyor} onClick={() => gonder(o)}>
                <small>{o}</small>
              </button>
            ))}
          </div>
        )}
        {sohbet.olaylar.map((o, i) => (
          <div key={i} className={`ai-olay ${o.tur}`}>
            {o.tur === "arac" && <Ikon ad="ayar" boy={13} />}
            <span>{o.metin}</span>
          </div>
        ))}
        {calisiyor && (
          <div className="ai-olay bilgi">
            <div className="donen" /> {secili?.ad} çalışıyor…
          </div>
        )}
      </div>

      {sohbet.sonAdim > 0 && !calisiyor && (
        <div className="ai-geri">
          <span className="soluk">Son istek {sohbet.sonAdim} değişiklik yaptı</span>
          <button className="dugme kucuk" onClick={hepsiniGeriAl}>
            <Ikon ad="geri" /> Hepsini geri al
          </button>
        </div>
      )}

      <div className="ai-giris">
        <textarea
          className="girdi"
          rows={3}
          placeholder={secili ? "Örn: hasar ekranı rengini #ff0033 yap, süresini iki katına çıkar" : "Önce ayarlardan bir AI sağlayıcısı ekle"}
          value={istek}
          disabled={!secili}
          onChange={(e) => setIstek(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              gonder();
            }
          }}
        />
        {calisiyor ? (
          <button className="dugme" onClick={() => iptal.current?.abort()}>
            Durdur
          </button>
        ) : (
          <button className="dugme birincil" disabled={!istek.trim() || !secili} onClick={() => gonder()}>
            Gönder
          </button>
        )}
      </div>
    </div>
  );
}
