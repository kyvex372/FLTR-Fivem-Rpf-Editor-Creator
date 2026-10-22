import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { hataMetni } from "./api";

const IKONLAR: Record<string, string> = {
  klasor: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  "klasor-ac": "M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1M3 7v10a2 2 0 0 0 2 2h12l3-8H7l-3 8",
  dosya: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5",
  arsiv: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  resim: "M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01",
  ayar: "M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4",
  metin: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4",
  kaydet: "M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM7 3v5h8V3M7 21v-7h10v7",
  geri: "M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  ileri: "m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3",
  yenile: "M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5",
  arti: "M12 5v14M5 12h14",
  cop: "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3",
  disa: "M12 3v12M7 10l5 5 5-5M5 21h14",
  ice: "M12 21V9M7 14l5-5 5 5M5 3h14",
  kalem: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  x: "M6 6l12 12M18 6 6 18",
  uyari: "M12 3 2 20h20zM12 10v4M12 17h.01",
  "ok-sag": "m9 6 6 6-6 6",
  "ok-asagi": "m6 9 6 6 6-6",
  "ok-yukari": "m6 15 6-6 6 6",
  kopya: "M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
  pirilti: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  palet: "M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.9 1.5-2l-.3-1c-.3-1.1.5-2 1.6-2H17a4 4 0 0 0 4-4c0-5-4-9-9-9zM7.5 11h.01M10 7h.01M15 7.5h.01",
  bilgi: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
  paket: "M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10M8 5l8 4",
  yedek: "M12 8v4l3 2M3 12a9 9 0 1 0 3-6.7M3 4v4h4",
  hedef: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01",
  ara: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  kup: "M12 3 4 7.5v9L12 21l8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
  daralt: "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7",
};

export function Ikon({ ad, boy = 15, renk }: { ad: string; boy?: number; renk?: string }) {
  return (
    <svg
      className="ikon"
      viewBox="0 0 24 24"
      width={boy}
      height={boy}
      fill="none"
      stroke={renk ?? "currentColor"}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={IKONLAR[ad] ?? IKONLAR.dosya} />
    </svg>
  );
}

type BildirimTuru = "bilgi" | "hata" | "tamam";
interface Bildirim {
  id: number;
  metin: string;
  tur: BildirimTuru;
}

interface ModalIstek {
  baslik: string;
  metin?: string;
  girdi?: { deger: string; etiket?: string };
  evet: string;
  hayir?: string;
  tehlike?: boolean;
  coz: (v: string | boolean | null) => void;
}

interface Arayuz {
  bildir: (metin: string, tur?: BildirimTuru) => void;
  hata: (e: unknown) => void;
  onayla: (baslik: string, metin?: string, evet?: string, tehlike?: boolean) => Promise<boolean>;
  sor: (baslik: string, deger?: string, etiket?: string) => Promise<string | null>;
  mesgul: <T>(metin: string, is: () => Promise<T>) => Promise<T | undefined>;
  /** Meşgul göstergesine ilerleme çubuğu ekler; arka uç da "ilerleme" olayıyla aynısını yapar. */
  ilerleme: (bitti: number, toplam: number) => void;
}

interface Ilerleme {
  bitti: number;
  toplam: number;
}

const ArayuzBaglami = createContext<Arayuz>(null!);
export const useArayuz = () => useContext(ArayuzBaglami);

export function ArayuzSaglayici({ children }: { children: ReactNode }) {
  const [bildirimler, setBildirimler] = useState<Bildirim[]>([]);
  const [modal, setModal] = useState<ModalIstek | null>(null);
  const [mesgulMetin, setMesgulMetin] = useState<string | null>(null);
  const [ilerlemeDurumu, setIlerlemeDurumu] = useState<Ilerleme | null>(null);
  const sayac = useRef(0);

  useEffect(() => {
    const birak = listen<Ilerleme>("ilerleme", (e) => setIlerlemeDurumu(e.payload));
    return () => {
      birak.then((f) => f());
    };
  }, []);
  const ilerleme = useCallback((bitti: number, toplam: number) => setIlerlemeDurumu({ bitti, toplam }), []);

  const bildir = useCallback((metin: string, tur: BildirimTuru = "bilgi") => {
    const id = ++sayac.current;
    setBildirimler((b) => [...b.slice(-4), { id, metin, tur }]);
    setTimeout(() => setBildirimler((b) => b.filter((x) => x.id !== id)), tur === "hata" ? 7000 : 3800);
  }, []);
  const hata = useCallback((e: unknown) => bildir(hataMetni(e), "hata"), [bildir]);

  const onayla = useCallback(
    (baslik: string, metin?: string, evet = "Tamam", tehlike = false) =>
      new Promise<boolean>((coz) => setModal({ baslik, metin, evet, hayir: "Vazgeç", tehlike, coz: (v) => coz(v === true) })),
    [],
  );
  const sor = useCallback(
    (baslik: string, deger = "", etiket?: string) =>
      new Promise<string | null>((coz) =>
        setModal({ baslik, girdi: { deger, etiket }, evet: "Tamam", hayir: "Vazgeç", coz: (v) => coz(typeof v === "string" ? v : null) }),
      ),
    [],
  );
  const mesgul = useCallback(
    async <T,>(metin: string, is: () => Promise<T>) => {
      setMesgulMetin(metin);
      setIlerlemeDurumu(null);
      try {
        return await is();
      } catch (e) {
        hata(e);
        return undefined;
      } finally {
        setMesgulMetin(null);
        setIlerlemeDurumu(null);
      }
    },
    [hata],
  );

  return (
    <ArayuzBaglami.Provider value={{ bildir, hata, onayla, sor, mesgul, ilerleme }}>
      {children}
      {mesgulMetin && (
        <div className="mesgul">
          <div className="donen" />
          {mesgulMetin}
          {ilerlemeDurumu && ilerlemeDurumu.toplam > 0 && (
            <>
              <span className="mesgul-cubuk">
                <i style={{ width: `${Math.min(100, (ilerlemeDurumu.bitti / ilerlemeDurumu.toplam) * 100)}%` }} />
              </span>
              <small>
                {ilerlemeDurumu.bitti}/{ilerlemeDurumu.toplam}
              </small>
            </>
          )}
        </div>
      )}
      <div className="bildirimler">
        {bildirimler.map((b) => (
          <div key={b.id} className={`bildirim ${b.tur}`}>
            {b.metin}
          </div>
        ))}
      </div>
      {modal && <Modal istek={modal} kapat={() => setModal(null)} />}
    </ArayuzBaglami.Provider>
  );
}

function Modal({ istek, kapat }: { istek: ModalIstek; kapat: () => void }) {
  const [deger, setDeger] = useState(istek.girdi?.deger ?? "");
  const bitir = (v: string | boolean | null) => {
    istek.coz(v);
    kapat();
  };
  const evet = () => bitir(istek.girdi ? deger : true);
  return (
    <div className="perde" onMouseDown={(e) => e.target === e.currentTarget && bitir(null)}>
      <div
        className="modal"
        onKeyDown={(e) => {
          if (e.key === "Escape") bitir(null);
          if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) evet();
        }}
      >
        <h3>{istek.baslik}</h3>
        {istek.metin && <p>{istek.metin}</p>}
        {istek.girdi && (
          <label>
            {istek.girdi.etiket}
            <input
              className="girdi"
              autoFocus
              value={deger}
              onChange={(e) => setDeger(e.target.value)}
              onFocus={(e) => {
                const nokta = e.target.value.lastIndexOf(".");
                e.target.setSelectionRange(0, nokta > 0 ? nokta : e.target.value.length);
              }}
            />
          </label>
        )}
        <div className="eylemler">
          {istek.hayir && (
            <button className="dugme" onClick={() => bitir(null)}>
              {istek.hayir}
            </button>
          )}
          <button className={`dugme birincil`} autoFocus={!istek.girdi} onClick={evet}>
            {istek.evet}
          </button>
        </div>
      </div>
    </div>
  );
}

export interface MenuOgesi {
  ad: string;
  ikon?: string;
  is: () => void;
  ayrac?: boolean;
}

export function BaglamMenusu({ x, y, ogeler, kapat }: { x: number; y: number; ogeler: MenuOgesi[]; kapat: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [konum, setKonum] = useState({ x, y });
  useEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setKonum({ x: Math.min(x, innerWidth - r.width - 8), y: Math.min(y, innerHeight - r.height - 8) });
    const disari = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && kapat();
    const tus = (e: KeyboardEvent) => e.key === "Escape" && kapat();
    addEventListener("mousedown", disari);
    addEventListener("keydown", tus);
    addEventListener("blur", kapat);
    return () => {
      removeEventListener("mousedown", disari);
      removeEventListener("keydown", tus);
      removeEventListener("blur", kapat);
    };
  }, [x, y, kapat]);
  return (
    <div className="baglam" ref={ref} style={{ left: konum.x, top: konum.y }}>
      {ogeler.map((o, i) => (
        <div key={i}>
          {o.ayrac && <hr />}
          <button
            onClick={() => {
              kapat();
              o.is();
            }}
          >
            {o.ikon && <Ikon ad={o.ikon} />}
            {o.ad}
          </button>
        </div>
      ))}
    </div>
  );
}

export function Kaydirici({
  etiket,
  deger,
  min,
  max,
  adim,
  degisti,
  vurgu,
  baslik,
}: {
  etiket: string;
  deger: number;
  min: number;
  max: number;
  adim?: number;
  degisti: (v: number) => void;
  vurgu?: boolean;
  baslik?: string;
}) {
  const [yazi, setYazi] = useState(String(deger));
  useEffect(() => setYazi(String(Number(deger.toFixed(4)))), [deger]);
  const adimDeger = adim ?? (max - min > 20 ? 1 : 0.01);
  return (
    <div className={`kaydirici${vurgu ? " degisik" : ""}`} title={baslik}>
      <label>{etiket}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={adimDeger}
        value={Math.min(max, Math.max(min, deger))}
        onChange={(e) => degisti(Number(e.target.value))}
      />
      <input
        className="girdi"
        value={yazi}
        onChange={(e) => setYazi(e.target.value)}
        onBlur={() => {
          const v = Number(yazi.replace(",", "."));
          if (Number.isFinite(v)) degisti(v);
          else setYazi(String(deger));
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
}

export function useGeciktir<T extends unknown[]>(fn: (...a: T) => void, ms: number) {
  const zaman = useRef<number>(0);
  const son = useRef(fn);
  son.current = fn;
  return useCallback(
    (...a: T) => {
      clearTimeout(zaman.current);
      zaman.current = window.setTimeout(() => son.current(...a), ms);
    },
    [ms],
  );
}

export function hex(r: number, g: number, b: number) {
  const k = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${k(r)}${k(g)}${k(b)}`;
}

export function hexCoz(h: string): [number, number, number] {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
