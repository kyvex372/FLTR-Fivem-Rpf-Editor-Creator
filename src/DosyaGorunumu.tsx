import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { EditorView, basicSetup } from "codemirror";
import { Annotation, EditorState } from "@codemirror/state";
import { xml } from "@codemirror/lang-xml";
import { oneDark } from "@codemirror/theme-one-dark";
import { api, boyutYaz, uzanti, type DosyaIcerigi, type DugumBilgi } from "./api";
import type { BelgeBaglami } from "./Belge";
import { dugumIkonu } from "./Belge";
import { Ikon, useArayuz, useGeciktir } from "./ortak";

const disaridan = Annotation.define<boolean>();

const tema = EditorView.theme(
  {
    "&": { backgroundColor: "var(--zemin)", fontSize: "12.5px" },
    ".cm-gutters": { backgroundColor: "var(--panel)", borderRight: "1px solid var(--cizgi)" },
    ".cm-content": { fontFamily: "var(--mono)" },
    ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "rgba(255,255,255,0.035)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "rgba(229,36,59,0.28) !important" },
    ".cm-cursor": { borderLeftColor: "var(--vurgu-acik)" },
  },
  { dark: true },
);

function MetinEditoru({ metin, xmlMi, yaz, salt }: { metin: string; xmlMi: boolean; yaz: (m: string) => void; salt?: boolean }) {
  const kap = useRef<HTMLDivElement>(null);
  const gorunum = useRef<EditorView | null>(null);
  const yazRef = useRef(yaz);
  yazRef.current = yaz;
  const gecikmeli = useGeciktir((m: string) => yazRef.current(m), 700);

  useEffect(() => {
    const v = new EditorView({
      parent: kap.current!,
      state: EditorState.create({
        doc: metin,
        extensions: [
          basicSetup,
          oneDark,
          tema,
          ...(xmlMi ? [xml()] : []),
          ...(salt ? [EditorState.readOnly.of(true)] : []),
          EditorView.updateListener.of((u) => u.docChanged && u.transactions.some((t) => !t.annotation(disaridan)) && gecikmeli(u.state.doc.toString())),
          EditorView.domEventHandlers({ blur: (_, v) => void gecikmeli(v.state.doc.toString()) }),
        ],
      }),
    });
    gorunum.current = v;
    return () => v.destroy();
  }, []);

  useEffect(() => {
    const v = gorunum.current;
    if (v && v.state.doc.toString() !== metin)
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: metin }, annotations: disaridan.of(true) });
  }, [metin]);

  return <div className="cm-kap" ref={kap} />;
}


export function DosyaGorunumu({
  ozet,
  surum,
  guncelle,
  dugum,
  ac,
  disaAktar,
  harita,
}: BelgeBaglami & { dugum: DugumBilgi; disaAktar: (y: string[]) => void; harita?: () => void }) {
  const ui = useArayuz();
  const [icerik, setIcerik] = useState<DosyaIcerigi | null>(null);

  useEffect(() => {
    if (dugum.tur !== "dosya") return;
    api.dosyaOku(ozet.id, dugum.yol).then(setIcerik).catch(ui.hata);
  }, [ozet.id, dugum.yol, dugum.tur, surum, ui]);

  const degistir = async () => {
    const s = await open({ title: `${dugum.ad} yerine` });
    if (typeof s !== "string") return;
    try {
      guncelle(await api.dosyaDegistir(ozet.id, dugum.yol, s));
      ui.bildir(`${dugum.ad} değiştirildi`, "tamam");
    } catch (e) {
      ui.hata(e);
    }
  };

  const ust = (
    <div className="duzenleyici-ust">
      <Ikon ad={dugumIkonu(dugum)} renk={dugum.tur === "arsiv" ? "var(--vurgu)" : undefined} />
      <h2>
        {dugum.yol}
        <small>
          {boyutYaz(dugum.boyut)}
          {dugum.tur === "dosya" && dugum.kayitli !== dugum.boyut && ` · arşivde ${boyutYaz(dugum.kayitli)}`}
          {dugum.rsc && " · RSC7 kaynak"}
        </small>
      </h2>
      {harita && (
        <button className="dugme kucuk" onClick={harita}>
          <Ikon ad="kup" /> 3B görünüm
        </button>
      )}
      {dugum.tur === "dosya" && (
        <button className="dugme kucuk" onClick={degistir}>
          <Ikon ad="ice" /> Dosyayla değiştir
        </button>
      )}
      <button className="dugme kucuk" onClick={() => disaAktar([dugum.yol])}>
        <Ikon ad="disa" /> Dışa aktar
      </button>
    </div>
  );

  if (dugum.tur !== "dosya") {
    return (
      <>
        {ust}
        <div className="kaydir">
          {dugum.tur === "arsiv" && (
            <div className="bilgi-kutu">
              <b>İç arşiv.</b> Mod içindeki bir .rpf; içeriği sol ağaçta açılır, düzenlemeler kayıtta bu arşivin içine yazılır.
            </div>
          )}
          <div className="dosya-listesi" style={{ padding: "8px 12px" }}>
            {dugum.cocuklar.map((c) => (
              <div key={c.yol} className="dosya-satiri" onClick={() => ac(c.yol)}>
                <Ikon ad={dugumIkonu(c)} renk={c.tur === "arsiv" ? "var(--vurgu)" : undefined} />
                <span className="ad">{c.ad}</span>
                <small>{c.tur === "dosya" ? boyutYaz(c.boyut) : `${c.cocuklar.length} öğe`}</small>
              </div>
            ))}
            {!dugum.cocuklar.length && <span className="soluk">Boş. Dosya sürükleyip bırakabilirsin.</span>}
          </div>
        </div>
      </>
    );
  }

  if (!icerik) return ust;

  if (icerik.metin !== null) {
    const u = uzanti(dugum.ad);
    return (
      <>
        {ust}
        {icerik.tur === "meta" && (
          <div className="uc-not">
            İkili dosyadan çevrilmiş XML. Değiştirdiğinde dosyanın kendi şemasıyla ikiliye geri yazılır ve doğrulanır; geçersiz değişiklik uygulanmaz.
          </div>
        )}
        <MetinEditoru
          metin={icerik.metin}
          xmlMi={["xml", "meta", "ymt", "oiv"].includes(u) || icerik.tur === "meta" || icerik.metin.trimStart().startsWith("<")}
          yaz={async (m) => {
            if (m === icerik.metin) return;
            try {
              if (icerik.tur === "meta") {
                const r = await api.metaYaz(ozet.id, dugum.yol, m);
                guncelle(r.ozet);
                if (r.uyarilar.length) ui.bildir(`Yazıldı, ${r.uyarilar.length} uyarı: ${r.uyarilar.slice(0, 2).join(" · ")}`);
              } else {
                guncelle(await api.metinYaz(ozet.id, dugum.yol, m));
              }
              setIcerik({ ...icerik, metin: m });
            } catch (e) {
              ui.hata(e);
            }
          }}
        />
      </>
    );
  }

  return (
    <>
      {ust}
      <div className="kaydir">
        <div className="bilgi-kutu">
          {icerik.tur === "kaynak" ? (
            <>
              <b>Derlenmiş RAGE kaynağı</b> (RSC7 v{icerik.rsc_surum}). Bu tür henüz görsel olarak düzenlenmiyor; CodeWalker/OpenIV ile
              düzenleyip "Dosyayla değiştir" ile geri koyabilirsin.
            </>
          ) : (
            <>
              <b>İkili dosya.</b> Dışa aktarıp başka bir araçla düzenleyebilir, sonra "Dosyayla değiştir" ile geri koyabilirsin.
            </>
          )}
        </div>
        {icerik.hex && <pre className="hex">{icerik.hex}</pre>}
      </div>
    </>
  );
}
