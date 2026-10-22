import { useEffect, useMemo, useRef, useState } from "react";
import { Ikon } from "./ortak";

export interface PaletOgesi {
  id: string;
  ad: string;
  /** sağda soluk gösterilen ek bilgi (yol, kısayol) */
  ek?: string;
  grup: string;
  ikon: string;
  is: () => void;
}

const kucuk = (s: string) => s.toLocaleLowerCase("tr");

/** Bütün kelimeler geçmeli; ada tam oturan, baştan eşleşen ve kısa olan önde. */
function puan(o: PaletOgesi, kelimeler: string[]) {
  const ad = kucuk(o.ad);
  const hepsi = `${ad} ${kucuk(o.ek ?? "")}`;
  let p = 0;
  for (const k of kelimeler) {
    const i = hepsi.indexOf(k);
    if (i < 0) return -1;
    p += ad.startsWith(k) ? 30 : ad.includes(k) ? 15 : 5;
    if (i > 0 && /[\s/_.-]/.test(hepsi[i - 1])) p += 8;
  }
  return p - ad.length / 40;
}

export function Palet({ ogeler, kapat }: { ogeler: PaletOgesi[]; kapat: () => void }) {
  const [arama, setArama] = useState("");
  const [secili, setSecili] = useState(0);
  const liste = useRef<HTMLDivElement>(null);

  const sonuc = useMemo(() => {
    const kelimeler = kucuk(arama).split(/\s+/).filter(Boolean);
    if (!kelimeler.length) return ogeler.slice(0, 200);
    return ogeler
      .map((o) => [o, puan(o, kelimeler)] as const)
      .filter(([, p]) => p >= 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 200)
      .map(([o]) => o);
  }, [arama, ogeler]);

  useEffect(() => setSecili(0), [arama]);
  useEffect(() => {
    liste.current?.querySelector(".secili-satir")?.scrollIntoView({ block: "nearest" });
  }, [secili]);

  const calistir = (o: PaletOgesi | undefined) => {
    if (!o) return;
    kapat();
    o.is();
  };

  return (
    <div className="perde palet-perde" onMouseDown={(e) => e.target === e.currentTarget && kapat()}>
      <div className="palet">
        <div className="palet-arama">
          <Ikon ad="ara" />
          <input
            autoFocus
            className="girdi"
            placeholder="Dosya, mod ya da işlem ara…"
            value={arama}
            onChange={(e) => setArama(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSecili((s) => Math.min(s + 1, sonuc.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSecili((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                calistir(sonuc[secili]);
              } else if (e.key === "Escape") kapat();
            }}
          />
        </div>
        <div className="palet-liste" ref={liste}>
          {!sonuc.length && <div className="soluk" style={{ padding: 14 }}>Eşleşen yok.</div>}
          {sonuc.map((o, i) => (
            <div
              key={o.id}
              className={`palet-satir${i === secili ? " secili-satir" : ""}`}
              onMouseMove={() => setSecili(i)}
              onClick={() => calistir(o)}
            >
              <Ikon ad={o.ikon} />
              <span className="ad">{o.ad}</span>
              {o.ek && <small>{o.ek}</small>}
              <span className="palet-grup">{o.grup}</span>
            </div>
          ))}
        </div>
        <div className="palet-alt soluk">↑↓ seç · Enter aç · Esc kapat</div>
      </div>
    </div>
  );
}
