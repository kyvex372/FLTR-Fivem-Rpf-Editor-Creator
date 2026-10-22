import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api, dokuUrl as onizlemeUrl, NOTR_RENK, PROTOKOL, type ModelDokusu, type RenkAyari, type Sigdirma } from "./api";
import type { BelgeBaglami } from "./Belge";
import { RenkAyarlari } from "./DokuEditoru";
import { Ikon, useArayuz, useGeciktir } from "./ortak";

interface ParcaBilgisi {
  doku: string | null;
  renk?: [number, number, number];
  konum: [number, number];
  normal: [number, number];
  uv: [number, number];
  indeks: [number, number];
}

interface CizimBilgisi {
  ad: string;
  min: [number, number, number];
  max: [number, number, number];
  parcalar: ParcaBilgisi[];
  ucgen: number;
}

interface YuklenenModel {
  cizimler: { bilgi: CizimBilgisi; grup: THREE.Group }[];
}

const modelUrl = (id: number, yol: string, surum: number) => `${PROTOKOL}/model?${new URLSearchParams({ id: String(id), yol, v: String(surum) })}`;
const modelDokuUrl = (id: number, yol: string, ad: string, surum: number) =>
  `${PROTOKOL}/modeldoku?${new URLSearchParams({ id: String(id), yol, ad, boy: "1024", v: String(surum) })}`;
const GORSEL_UZANTILARI = ["png", "jpg", "jpeg", "webp", "bmp", "tga", "dds"];
const notrMu = (r: RenkAyari) => r.ton === 0 && r.doygunluk === 1 && r.parlaklik === 0 && r.kontrast === 1 && (!r.boya || r.boya_gucu === 0);
const adUyar = (dokuAdi: string, parcaDokusu: string | null) => !!parcaDokusu && (parcaDokusu === dokuAdi || parcaDokusu.endsWith(dokuAdi));

class Malzemeler {
  private onbellek = new Map<string, THREE.MeshStandardMaterial>();
  private yukleyici = new THREE.TextureLoader();
  eksik = new Set<string>();
  dokulu = true;
  telKafes = false;
  constructor(
    private yeniden: () => void,
    private surum = 0,
  ) {}

  al(id: number, modelYolu: string, doku: string | null, renk?: [number, number, number]) {
    const anahtar = renk ? `#${renk.join(",")}` : (doku ?? "");
    let m = this.onbellek.get(anahtar);
    if (m) return m;
    m = new THREE.MeshStandardMaterial({ color: 0x9d9da6, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, wireframe: this.telKafes });
    if (renk) {
      m.color.setRGB(...renk);
      m.userData.sabitRenk = true;
    }
    this.onbellek.set(anahtar, m);
    if (doku) {
      const hedef = m;
      this.yukleyici.load(
        modelDokuUrl(id, modelYolu, doku, this.surum),
        (t) => {
          t.flipY = false;
          t.colorSpace = THREE.SRGBColorSpace;
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.anisotropy = 8;
          hedef.userData.doku = t;
          if (this.dokulu) {
            hedef.map = t;
            hedef.color.set(0xffffff);
          }
          hedef.alphaTest = 0.35;
          hedef.needsUpdate = true;
          this.yeniden();
        },
        undefined,
        () => {
          this.eksik.add(doku);
          this.yeniden();
        },
      );
    }
    return m;
  }

  ayarla(dokulu: boolean, telKafes: boolean) {
    this.dokulu = dokulu;
    this.telKafes = telKafes;
    for (const m of this.onbellek.values()) {
      const t = m.userData.doku as THREE.Texture | undefined;
      m.map = dokulu && t ? t : null;
      if (!m.userData.sabitRenk) m.color.set(dokulu && t ? 0xffffff : 0x9d9da6);
      m.wireframe = telKafes;
      m.needsUpdate = true;
    }
    this.yeniden();
  }

  /** Seçili dokuyu kullanan parçaları kırmızıya boyar. */
  vurgula(ad: string | null) {
    for (const [anahtar, m] of this.onbellek) {
      const secili = ad !== null && adUyar(ad, anahtar || null);
      m.emissive.setHex(secili ? 0xe5243b : 0);
      m.emissiveIntensity = secili ? 0.45 : 1;
    }
    this.yeniden();
  }

  birak() {
    for (const m of this.onbellek.values()) {
      (m.userData.doku as THREE.Texture | undefined)?.dispose();
      m.dispose();
    }
  }
}

async function modelYukle(id: number, yol: string, surum: number, malzemeler: Malzemeler): Promise<YuklenenModel> {
  const r = await fetch(modelUrl(id, yol, surum));
  if (!r.ok) throw new Error(await r.text());
  const buf = await r.arrayBuffer();
  if (new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== "TLKM") throw new Error("model paketi bozuk");
  const n = new DataView(buf).getUint32(4, true);
  const bilgi = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, n))) as { cizimler: CizimBilgisi[] };
  const bas = Math.ceil((8 + n) / 4) * 4;
  const f32 = ([o, a]: [number, number]) => new Float32Array(buf, bas + o, a);
  const u32 = ([o, a]: [number, number]) => new Uint32Array(buf, bas + o, a);

  return {
    cizimler: bilgi.cizimler.map((c) => {
      const grup = new THREE.Group();
      grup.name = c.ad;
      for (const p of c.parcalar) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(f32(p.konum), 3));
        g.setAttribute("normal", new THREE.BufferAttribute(f32(p.normal), 3));
        g.setAttribute("uv", new THREE.BufferAttribute(f32(p.uv), 2));
        g.setIndex(new THREE.BufferAttribute(u32(p.indeks), 1));
        g.computeBoundingSphere();
        const parca = new THREE.Mesh(g, malzemeler.al(id, yol, p.doku, p.renk));
        parca.userData.doku = p.doku;
        grup.add(parca);
      }
      return { bilgi: c, grup };
    }),
  };
}

function birakGrup(g: THREE.Object3D) {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) o.geometry.dispose();
  });
}

/** GTA Z-yukarı kullanır; kamera ve ızgara buna göre kurulur. */
function useSahne(kap: React.RefObject<HTMLDivElement | null>) {
  const sahne = useMemo(() => {
    const s = new THREE.Scene();
    s.background = new THREE.Color(0x111114);
    s.add(new THREE.HemisphereLight(0xdfe6ff, 0x2a2622, 1.6));
    const gunes = new THREE.DirectionalLight(0xffffff, 1.8);
    gunes.position.set(40, -60, 90);
    s.add(gunes);
    const izgara = new THREE.GridHelper(200, 100, 0x3a3a44, 0x24242b);
    izgara.rotation.x = Math.PI / 2;
    izgara.name = "izgara";
    s.add(izgara);
    return s;
  }, []);
  const ref = useRef<{ kamera: THREE.PerspectiveCamera; kontrol: OrbitControls; ciz: () => void; tuval: HTMLCanvasElement } | null>(null);

  useEffect(() => {
    const el = kap.current!;
    const cizici = new THREE.WebGLRenderer({ antialias: true });
    cizici.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(cizici.domElement);
    const kamera = new THREE.PerspectiveCamera(50, 1, 0.05, 50000);
    kamera.up.set(0, 0, 1);
    kamera.position.set(10, -10, 8);
    const kontrol = new OrbitControls(kamera, cizici.domElement);
    kontrol.enableDamping = true;
    let bekleyen = 0;
    const ciz = () => {
      if (bekleyen) return;
      bekleyen = requestAnimationFrame(() => {
        bekleyen = 0;
        if (kontrol.update()) ciz();
        cizici.render(sahne, kamera);
      });
    };
    kontrol.addEventListener("change", ciz);
    const boyutla = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (!w || !h) return;
      cizici.setSize(w, h);
      kamera.aspect = w / h;
      kamera.updateProjectionMatrix();
      ciz();
    };
    const gozlem = new ResizeObserver(boyutla);
    gozlem.observe(el);
    boyutla();
    ref.current = { kamera, kontrol, ciz, tuval: cizici.domElement };
    return () => {
      gozlem.disconnect();
      cancelAnimationFrame(bekleyen);
      kontrol.dispose();
      cizici.dispose();
      cizici.domElement.remove();
      ref.current = null;
    };
  }, [kap, sahne]);

  const odakla = useCallback((nesne: THREE.Object3D) => {
    const r = ref.current;
    if (!r) return;
    const kutu = new THREE.Box3().setFromObject(nesne);
    if (kutu.isEmpty()) return;
    const merkez = kutu.getCenter(new THREE.Vector3());
    const boy = Math.max(...kutu.getSize(new THREE.Vector3()).toArray(), 0.5);
    const uzaklik = (boy / (2 * Math.tan((r.kamera.fov * Math.PI) / 360))) * 1.35;
    r.kamera.position.copy(merkez).add(new THREE.Vector3(0.9, -1, 0.75).normalize().multiplyScalar(uzaklik));
    r.kamera.near = Math.max(0.01, uzaklik / 2000);
    r.kamera.far = uzaklik * 60;
    r.kamera.updateProjectionMatrix();
    r.kontrol.target.copy(merkez);
    const izgara = sahne.getObjectByName("izgara");
    if (izgara) {
      izgara.position.set(merkez.x, merkez.y, kutu.min.z);
      const olcek = Math.max(1, Math.pow(10, Math.ceil(Math.log10(boy))) / 100);
      izgara.scale.setScalar(olcek);
    }
    r.ciz();
  }, [sahne]);

  const ciz = useCallback(() => ref.current?.ciz(), []);

  /** Ekran noktasının altındaki ilk parça. */
  const isin = useCallback((ex: number, ey: number, nesne: THREE.Object3D) => {
    const r = ref.current;
    if (!r) return null;
    const d = r.tuval.getBoundingClientRect();
    const isinci = new THREE.Raycaster();
    isinci.setFromCamera(new THREE.Vector2(((ex - d.left) / d.width) * 2 - 1, -((ey - d.top) / d.height) * 2 + 1), r.kamera);
    return isinci.intersectObject(nesne, true)[0]?.object ?? null;
  }, []);
  return { sahne, odakla, ciz, isin };
}

function Arac({
  dokulu,
  telKafes,
  setDokulu,
  setTelKafes,
  odakla,
  children,
}: {
  dokulu: boolean;
  telKafes: boolean;
  setDokulu: (v: boolean) => void;
  setTelKafes: (v: boolean) => void;
  odakla: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="uc-arac">
      {children}
      <span className="bosluk" />
      <button className={`dugme kucuk${dokulu ? " birincil" : ""}`} onClick={() => setDokulu(!dokulu)}>
        <Ikon ad="resim" /> Dokular
      </button>
      <button className={`dugme kucuk${telKafes ? " birincil" : ""}`} onClick={() => setTelKafes(!telKafes)}>
        Tel kafes
      </button>
      <button className="dugme kucuk" onClick={odakla} title="Kamerayı modele göre ayarla">
        <Ikon ad="hedef" /> Ortala
      </button>
    </div>
  );
}

export function ModelGorunumu({ ozet, surum, guncelle, ac, yol }: BelgeBaglami & { yol: string }) {
  const ui = useArayuz();
  const kap = useRef<HTMLDivElement>(null);
  const { sahne, odakla, ciz, isin } = useSahne(kap);
  const [model, setModel] = useState<YuklenenModel | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [secili, setSecili] = useState(0);
  const [dokulu, setDokulu] = useState(true);
  const [telKafes, setTelKafes] = useState(false);
  const [eksik, setEksik] = useState(0);
  const [dokular, setDokular] = useState<ModelDokusu[] | null>(null);
  const [seciliDoku, setSeciliDoku] = useState<string | null>(null);
  const [renk, setRenk] = useState<RenkAyari>(NOTR_RENK);
  const [onizlemeRengi, setOnizlemeRengi] = useState<RenkAyari>(NOTR_RENK);
  const [sigdirma, setSigdirma] = useState<Sigdirma>("esnet");
  const onizlemeyiGuncelle = useGeciktir((r: RenkAyari) => setOnizlemeRengi(r), 140);
  const odaklanan = useRef("");
  const basilan = useRef<{ x: number; y: number } | null>(null);
  // sürüm değişince (doku düzenlendi) malzemeler yeni dokularla baştan kurulur
  const malzemeler = useMemo(() => new Malzemeler(() => ciz(), surum), [ciz, surum]);

  useEffect(() => {
    let iptal = false;
    setHata(null);
    modelYukle(ozet.id, yol, surum, malzemeler).then(
      (m) => (iptal ? m.cizimler.forEach((c) => birakGrup(c.grup)) : setModel(m)),
      (e) => !iptal && setHata(String(e instanceof Error ? e.message : e)),
    );
    return () => {
      iptal = true;
    };
  }, [ozet.id, yol, surum, malzemeler]);

  const carpisma = yol.toLowerCase().endsWith(".ybn");
  useEffect(() => {
    if (carpisma) return setDokular([]);
    api.modelDokulari(ozet.id, yol).then(setDokular, (e) => {
      ui.hata(e);
      setDokular([]);
    });
  }, [ozet.id, yol, surum, ui, carpisma]);

  useEffect(() => () => malzemeler.birak(), [malzemeler]);

  useEffect(() => {
    const c = model?.cizimler[secili];
    if (!c) return;
    sahne.add(c.grup);
    // doku düzenlenip model yeniden yüklendiğinde kamera yerinde kalsın
    if (odaklanan.current !== `${yol}#${secili}`) {
      odaklanan.current = `${yol}#${secili}`;
      odakla(c.grup);
    } else ciz();
    const t = setInterval(() => setEksik(malzemeler.eksik.size), 700);
    return () => {
      clearInterval(t);
      sahne.remove(c.grup);
      ciz();
    };
  }, [model, secili, sahne, odakla, ciz, malzemeler, yol]);

  useEffect(() => () => model?.cizimler.forEach((c) => birakGrup(c.grup)), [model]);
  useEffect(() => malzemeler.ayarla(dokulu, telKafes), [dokulu, telKafes, malzemeler]);
  // seçilen dokunun parçaları kısa süre kırmızı yanar; sürekli boyamak dokunun rengini görmeyi zorlaştırır
  useEffect(() => {
    malzemeler.vurgula(seciliDoku);
    if (!seciliDoku) return;
    const t = setTimeout(() => malzemeler.vurgula(null), 1100);
    return () => clearTimeout(t);
  }, [seciliDoku, malzemeler, model]);

  const c = model?.cizimler[secili];
  const boyut = c ? c.bilgi.max.map((v, i) => v - c.bilgi.min[i]) : null;
  const sd = dokular?.find((d) => d.ad === seciliDoku);
  const duzenlenebilir = !!sd?.kaynak && sd.destekli;

  const parcaSec = (e: React.PointerEvent) => {
    const b = basilan.current;
    basilan.current = null;
    if (!b || !c || Math.hypot(e.clientX - b.x, e.clientY - b.y) > 4) return;
    const parca = isin(e.clientX, e.clientY, c.grup);
    if (!parca) return setSeciliDoku(null);
    const ad = parca.userData.doku as string | null;
    const eslesen = dokular?.filter((d) => adUyar(d.ad, ad)).sort((x, y) => y.ad.length - x.ad.length)[0];
    setSeciliDoku(eslesen?.ad ?? ad ?? null);
    if (!ad) ui.bildir("Bu parçanın ana dokusu yok.");
  };

  const islem = async (metin: string, fn: () => Promise<typeof ozet>, basari: string) => {
    const o = await ui.mesgul(metin, fn);
    if (!o) return;
    guncelle(o);
    setRenk(NOTR_RENK);
    setOnizlemeRengi(NOTR_RENK);
    ui.bildir(basari, "tamam");
  };

  const gorselleDegistir = async () => {
    if (!sd?.kaynak) return;
    const s = await open({ title: `${sd.ad} yerine görsel`, filters: [{ name: "Görsel", extensions: GORSEL_UZANTILARI }] });
    if (typeof s !== "string") return;
    await islem("Doku kodlanıyor", () => api.dokuDegistir(ozet.id, sd.kaynak!, sd.i, s, sigdirma, renk), `${sd.ad} değiştirildi`);
  };

  const kendiBoyutunda = async () => {
    if (!sd?.kaynak) return;
    const s = await open({ title: `${sd.ad} yerine (görselin boyutunda)`, filters: [{ name: "Görsel", extensions: GORSEL_UZANTILARI }] });
    if (typeof s !== "string") return;
    await islem("Doku yazılıyor", () => api.ytdIslem(ozet.id, sd.kaynak!, [{ tur: "koy", ad: sd.ad, gorsel: s }]), `${sd.ad} görselin boyutunda yazıldı`);
  };

  const boyutlandir = async () => {
    if (!sd?.kaynak) return;
    const g = await ui.sor("Yeni boyut", `${sd.genislik}x${sd.yukseklik}`, "genişlik x yükseklik (ör. 512x512; 2'nin kuvvetleri en güvenlisi)");
    const e = g?.match(/^\s*(\d+)\s*[x×*]\s*(\d+)\s*$/i);
    if (!e) return;
    const boyut: [number, number] = [Number(e[1]), Number(e[2])];
    await islem("Boyutlandırılıyor", () => api.ytdIslem(ozet.id, sd.kaynak!, [{ tur: "olcekle", ad: sd.ad, boyut }]), `${sd.ad} ${boyut.join("x")} yapıldı`);
  };

  const pngDisa = async () => {
    if (!sd?.kaynak) return;
    const s = await save({ defaultPath: `${sd.ad}.png`, filters: [{ name: "PNG", extensions: ["png"] }] });
    if (!s) return;
    try {
      await api.dokuDisa(ozet.id, sd.kaynak, sd.i, s);
      ui.bildir(`${sd.ad}.png kaydedildi`, "tamam");
    } catch (e) {
      ui.hata(e);
    }
  };

  return (
    <>
      <div className="duzenleyici-ust">
        <Ikon ad="kup" />
        <h2>
          {yol.split("/").pop()}
          <small>
            {c
              ? `${c.bilgi.ucgen.toLocaleString("tr")} üçgen · ${c.bilgi.parcalar.length} parça${boyut ? ` · ${boyut.map((x) => x.toFixed(1)).join(" × ")} m` : ""}`
              : model
                ? "geometrisi yok"
                : "yükleniyor"}
            {eksik > 0 && ` · ${eksik} doku arşivde yok`}
          </small>
        </h2>
      </div>
      <Arac dokulu={dokulu} telKafes={telKafes} setDokulu={setDokulu} setTelKafes={setTelKafes} odakla={() => c && odakla(c.grup)}>
        {!carpisma && (
        <button
          className="dugme kucuk"
          title="Blender vb. için OBJ + MTL + PNG dokular"
          onClick={async () => {
            const klasor = await open({ directory: true, title: "OBJ nereye yazılsın?" });
            if (typeof klasor !== "string") return;
            const r = await ui.mesgul("OBJ yazılıyor", () => api.modelObj(ozet.id, yol, klasor));
            if (r) ui.bildir(`${r.obj.split(/[\\/]/).pop()} + ${r.doku} doku yazıldı${r.eksik.length ? ` · pakette olmayan ${r.eksik.length} doku atlandı` : ""}`, "tamam");
          }}
        >
          <Ikon ad="disa" /> OBJ dışa aktar
        </button>
        )}
        {model && model.cizimler.length > 1 && (
          <select className="girdi kucuk" value={secili} onChange={(e) => setSecili(Number(e.target.value))}>
            {model.cizimler.map((x, i) => (
              <option key={i} value={i}>
                {x.bilgi.ad || `çizim ${i + 1}`} ({x.bilgi.ucgen.toLocaleString("tr")})
              </option>
            ))}
          </select>
        )}
      </Arac>
      <div className="harita-duzen">
        <div
          className="uc-sahne"
          ref={kap}
          onPointerDown={(e) => (basilan.current = { x: e.clientX, y: e.clientY })}
          onPointerUp={parcaSec}
          title="Bir parçaya tıkla: dokusu sağda seçilir"
        >
          {hata && <div className="uc-bilgi hata">{hata}</div>}
          {model && !model.cizimler.some((x) => x.bilgi.ucgen > 0) && (
            <div className="uc-bilgi">
              <b>Bu model boş.</b> Hiç çizilecek geometrisi yok. Optimizasyon modları bir objeyi oyundan kaldırmak için yerine böyle boş model koyar.
              {!!dokular?.some((d) => d.gomulu) && ` Yine de içinde ${dokular.filter((d) => d.gomulu).length} doku taşıyor; oyunda görünmezler.`}
            </div>
          )}
          {!model && !hata && <div className="uc-bilgi">Model yükleniyor…</div>}
        </div>

        <div className="doku-detay">
          {carpisma && (
            <div className="ayar-grubu">
              <h4>Çarpışma modeli</h4>
              <span className="soluk" style={{ fontSize: 12 }}>
                Oyunda görünmez; oyuncu, araç ve mermiler buna çarpar. Her renk ayrı bir yüzey malzemesi (asfalt, beton, çim, metal…); sesler ve izler
                buna göre seçilir.
              </span>
            </div>
          )}
          {!carpisma && (
          <div className="ayar-grubu">
            <h4>Dokular {dokular && `(${dokular.length})`}</h4>
            <span className="soluk" style={{ fontSize: 12 }}>
              Modelde bir parçaya tıkla, dokusu seçilip kırmızıyla işaretlensin. Değişiklik anında 3B'de görünür.
            </span>
            {dokular && !dokular.length && <span className="soluk">Bu model doku kullanmıyor.</span>}
            <div className="dosya-listesi model-dokulari">
              {dokular?.map((d) => (
                <div
                  key={`${d.kaynak}#${d.i}#${d.ad}`}
                  className={`dosya-satiri${d.ad === seciliDoku ? " secili-satir" : ""}`}
                  onClick={() => setSeciliDoku(d.ad === seciliDoku ? null : d.ad)}
                  title={d.kaynak ? `${d.ad}\n${d.genislik}×${d.yukseklik} ${d.bicim}\n${d.kaynak}` : `${d.ad}\noyunun kendi dokusu, pakette yok`}
                >
                  <span className="kucuk-resim dama">
                    {d.kaynak && d.destekli && <img src={onizlemeUrl(ozet.id, d.kaynak, d.i, 64, surum)} loading="lazy" draggable={false} alt="" />}
                  </span>
                  <span className="ad">{d.ad}</span>
                  <small className="soluk">{d.gomulu ? (d.kullanilan ? "modelin içinde" : "içinde · kullanılmıyor") : d.kaynak ? d.kaynak.split("/").pop() : "oyunda"}</small>
                </div>
              ))}
            </div>
          </div>
          )}

          {sd && (
            <div className="ayar-grubu">
              <h4>{sd.ad}</h4>
              {sd.kaynak && sd.destekli && (
                <div className="buyuk-onizleme dama">
                  <img src={onizlemeUrl(ozet.id, sd.kaynak, sd.i, 512, surum, notrMu(onizlemeRengi) ? undefined : onizlemeRengi)} draggable={false} alt="" />
                  {!notrMu(onizlemeRengi) && <span className="rozet sari etiket">önizleme</span>}
                </div>
              )}
              {sd.kaynak && (
                <div className="bilgi-izgara">
                  <span>Boyut</span>
                  <b>
                    {sd.genislik} × {sd.yukseklik}
                  </b>
                  <span>Biçim</span>
                  <b>{sd.bicim}</b>
                  <span>Yer</span>
                  <b title={sd.kaynak}>{sd.gomulu ? "modelin içinde" : sd.kaynak.split("/").pop()}</b>
                </div>
              )}
              {duzenlenebilir ? (
                <>
                  <div className="satir-eylem">
                    <button className="dugme birincil" onClick={gorselleDegistir}>
                      <Ikon ad="ice" /> Görselle değiştir…
                    </button>
                    <select className="girdi" value={sigdirma} onChange={(e) => setSigdirma(e.target.value as Sigdirma)} title="Görsel dokunun oranında değilse">
                      <option value="esnet">Esnet</option>
                      <option value="sigdir">Sığdır</option>
                      <option value="doldur">Doldur (kırp)</option>
                    </select>
                  </div>
                  <RenkAyarlari
                    renk={renk}
                    degisti={(r) => {
                      setRenk(r);
                      onizlemeyiGuncelle(r);
                    }}
                  />
                  <div className="dugme-satiri">
                    <button
                      className="dugme"
                      disabled={notrMu(renk)}
                      onClick={() => islem("Renklendiriliyor", () => api.dokuRenklendir(ozet.id, sd.kaynak!, [sd.i], renk), `${sd.ad} renklendirildi`)}
                    >
                      <Ikon ad="palet" /> Renklendir
                    </button>
                    <button className="dugme" onClick={pngDisa}>
                      <Ikon ad="disa" /> PNG
                    </button>
                    <button className="dugme" onClick={kendiBoyutunda} title="Görseli kendi çözünürlüğünde (2'nin kuvvetine yuvarlanarak) koyar">
                      <Ikon ad="ice" /> Kendi boyutunda koy
                    </button>
                    <button className="dugme" onClick={boyutlandir}>
                      Boyutlandır…
                    </button>
                    {!sd.gomulu && (
                      <button className="dugme" onClick={() => ac(`${sd.kaynak}#${sd.i}`)} title="ytd'yi doku düzenleyicide aç (boyutlandırma, ad, DDS)">
                        <Ikon ad="resim" /> Düzenleyicide aç
                      </button>
                    )}
                  </div>
                  {sd.gomulu && Math.max(sd.genislik, sd.yukseklik) <= 16 && (
                    <span className="soluk" style={{ fontSize: 12 }}>
                      Bu {sd.genislik}×{sd.yukseklik} düz renk dokusu. "Görselle değiştir" görseli bu boyuta küçültür; gerçek bir resim koymak için "Kendi
                      boyutunda koy"u kullan.
                    </span>
                  )}
                </>
              ) : (
                <span className="soluk" style={{ fontSize: 12 }}>
                  {sd.kaynak
                    ? `${sd.bicim} biçimi düzenlenemiyor.`
                    : "Bu doku oyunun kendi dosyalarında, paket içermiyor. Değiştirmek için modelin doku sözlüğüne (ytd) aynı adla bir doku eklenmesi gerekir."}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

interface Yerlesim {
  arketip: number;
  konum: [number, number, number];
  donus: [number, number, number, number];
  olcek: [number, number];
  lod_mesafe: number;
}

const YERLESIM_SINIRI = 6000;

export function HaritaGorunumu({ ozet, surum, yol, xml }: BelgeBaglami & { yol: string; xml: () => void }) {
  const kap = useRef<HTMLDivElement>(null);
  const { sahne, odakla, ciz } = useSahne(kap);
  const [durum, setDurum] = useState<{ toplam: number; bulunan: number; yuklenen: number; modelSayisi: number } | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [dokulu, setDokulu] = useState(true);
  const [telKafes, setTelKafes] = useState(false);
  const kok = useMemo(() => new THREE.Group(), []);
  const malzemeler = useMemo(() => new Malzemeler(() => ciz(), surum), [ciz, surum]);

  useEffect(() => {
    let iptal = false;
    sahne.add(kok);
    (async () => {
      const veri = await invoke<{ yerlesimler: Yerlesim[]; modeller: Record<string, string> }>("harita_verisi", { id: ozet.id, yol });
      const yerlesimler = veri.yerlesimler.slice(0, YERLESIM_SINIRI);
      const gerekli = [...new Set(yerlesimler.map((y) => y.arketip).filter((h) => veri.modeller[h]))];
      setDurum({ toplam: veri.yerlesimler.length, bulunan: yerlesimler.filter((y) => veri.modeller[y.arketip]).length, yuklenen: 0, modelSayisi: gerekli.length });

      const kutular = yerlesimler.filter((y) => !veri.modeller[y.arketip]);
      if (kutular.length) {
        const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), new THREE.MeshStandardMaterial({ color: 0xe5243b }), kutular.length);
        const mat = new THREE.Matrix4();
        kutular.forEach((y, i) => im.setMatrixAt(i, mat.makeTranslation(...y.konum)));
        kok.add(im);
      }
      odakla(kok);

      const donustur = (y: Yerlesim) => {
        const [x, yy, z, w] = y.donus;
        return new THREE.Matrix4().compose(
          new THREE.Vector3(...y.konum),
          new THREE.Quaternion(-x, -yy, -z, w),
          new THREE.Vector3(y.olcek[0], y.olcek[0], y.olcek[1]),
        );
      };

      let sayac = 0;
      const kuyruk = [...gerekli];
      const isci = async () => {
        while (kuyruk.length && !iptal) {
          const hash = kuyruk.shift()!;
          try {
            const m = await modelYukle(ozet.id, veri.modeller[hash], surum, malzemeler);
            const ana = m.cizimler[0]?.grup;
            if (ana && !iptal)
              for (const y of yerlesimler.filter((x) => x.arketip === hash)) {
                const kopya = ana.clone();
                kopya.applyMatrix4(donustur(y));
                kok.add(kopya);
              }
          } catch {
            /* okunamayan model kutusuz kalır */
          }
          sayac++;
          if (!iptal) {
            setDurum((d) => d && { ...d, yuklenen: sayac });
            ciz();
          }
        }
      };
      await Promise.all([isci(), isci(), isci()]);
      if (!iptal) odakla(kok);
    })().catch((e) => !iptal && setHata(String(e instanceof Error ? e.message : e)));
    return () => {
      iptal = true;
      sahne.remove(kok);
      birakGrup(kok);
      kok.clear();
      malzemeler.birak();
    };
  }, [ozet.id, yol, surum, sahne, kok, odakla, ciz, malzemeler]);

  useEffect(() => malzemeler.ayarla(dokulu, telKafes), [dokulu, telKafes, malzemeler]);

  return (
    <>
      <div className="duzenleyici-ust">
        <Ikon ad="hedef" />
        <h2>
          {yol.split("/").pop()}
          <small>
            {durum
              ? `${durum.toplam} obje yerleşimi · ${durum.bulunan} tanesinin modeli bu pakette (${durum.yuklenen}/${durum.modelSayisi} model yüklendi)${durum.toplam > YERLESIM_SINIRI ? ` · ilk ${YERLESIM_SINIRI} gösteriliyor` : ""}`
              : "yükleniyor"}
          </small>
        </h2>
      </div>
      <Arac dokulu={dokulu} telKafes={telKafes} setDokulu={setDokulu} setTelKafes={setTelKafes} odakla={() => odakla(kok)}>
        <button className="dugme kucuk" onClick={xml}>
          <Ikon ad="metin" /> XML
        </button>
        <span className="soluk" style={{ fontSize: 12 }}>
          <span className="kirmizi-kare" /> modeli pakette olmayan (oyunun kendi objesi)
        </span>
      </Arac>
      <div className="uc-sahne" ref={kap}>
        {hata && <div className="uc-bilgi hata">{hata}</div>}
      </div>
    </>
  );
}
