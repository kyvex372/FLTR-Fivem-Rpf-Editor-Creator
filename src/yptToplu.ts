import type { YptGrup } from "./api";

export type Deger = [number, number, number, number];

export interface TopluAyar {
  /** derece */
  ton?: number;
  /** #rrggbb; guc 0..1 */
  boya?: string;
  guc?: number;
  boyut?: number;
  isik?: number;
  dogma?: number;
}

export const renkMi = (ad: string) => /rgb|colourTint/i.test(ad);
export const boyutMu = (ad: string) => /whdM|sizeScalar|zoomScalar|coronaSize|dimensions/i.test(ad);
export const isikMi = (ad: string) => /Light:m_intensity|coronaIntensity|emissiveIntensity/i.test(ad);
export const dogmaMi = (ad: string) => /spawnRate/i.test(ad);

/** Parlaklığı koruyarak tonu kaydırır; 1'in üstündeki (HDR) renklerde de çalışır. */
export function tonKaydir([r, g, b]: number[], derece: number): [number, number, number] {
  const tepe = Math.max(r, g, b, 1e-6);
  const [x, y, z] = [r / tepe, g / tepe, b / tepe];
  const en = Math.max(x, y, z);
  const az = Math.min(x, y, z);
  const l = (en + az) / 2;
  const d = en - az;
  if (d < 1e-6) return [r, g, b];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = en === x ? ((y - z) / d) % 6 : en === y ? (z - x) / d + 2 : (x - y) / d + 4;
  h = (((h * 60 + derece) % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const xx = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [a, bb, cc] = h < 60 ? [c, xx, 0] : h < 120 ? [xx, c, 0] : h < 180 ? [0, c, xx] : h < 240 ? [0, xx, c] : h < 300 ? [xx, 0, c] : [c, 0, xx];
  return [(a + m) * tepe, (bb + m) * tepe, (cc + m) * tepe];
}

const hexRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

/** Gruplardaki uygun anahtar karelere ayarı uygular; yalnız değişenleri `bekleyen`e yazar, değişen sayısını döndürür. */
export function topluDegistir(gruplar: YptGrup[], ayar: TopluAyar, bekleyen: Map<number, Deger>) {
  const [hr, hg, hb] = ayar.boya ? hexRgb(ayar.boya) : [0, 0, 0];
  const guc = ayar.boya ? (ayar.guc ?? 1) : 0;
  const carp = (d: Deger, k = 1): Deger => (k === 1 ? d : [d[0] * k, d[1] * k, d[2] * k, d[3] * k]);
  let n = 0;
  for (const g of gruplar)
    for (const o of g.ozellikler)
      for (const k of o.kareler) {
        let d = [...(bekleyen.get(k.ofs) ?? k.deger)] as Deger;
        const once = d.join();
        if (renkMi(o.ad)) {
          if (ayar.ton) d = [...tonKaydir(d, ayar.ton), d[3]];
          if (guc > 0) {
            const parlak = Math.max(d[0], d[1], d[2], 1e-6);
            d = [d[0] + (hr * parlak - d[0]) * guc, d[1] + (hg * parlak - d[1]) * guc, d[2] + (hb * parlak - d[2]) * guc, d[3]];
          }
        }
        if (boyutMu(o.ad)) d = carp(d, ayar.boyut);
        if (isikMi(o.ad)) d = carp(d, ayar.isik);
        if (dogmaMi(o.ad)) d = carp(d, ayar.dogma);
        if (d.join() !== once) {
          bekleyen.set(k.ofs, d);
          n++;
        }
      }
  return n;
}

/** Ad ve davranışta bütün kelimeleri arar. */
export function yptSuz(gruplar: YptGrup[], arama: string, tur?: YptGrup["tur"] | "hepsi") {
  const k = arama.toLocaleLowerCase("tr").split(/\s+/).filter(Boolean);
  return gruplar.filter(
    (g) => (!tur || tur === "hepsi" || g.tur === tur) && k.every((x) => g.ad.toLowerCase().includes(x) || (g.davranis ?? "").toLowerCase().includes(x)),
  );
}
