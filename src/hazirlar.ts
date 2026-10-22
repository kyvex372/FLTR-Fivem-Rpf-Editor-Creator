export interface Hazir {
  id: string;
  ad: string;
  aciklama: string;
  onekler: string[];
  dokular?: RegExp;
}

export const HAZIRLAR: Hazir[] = [
  {
    id: "hasar",
    ad: "Hasar ekranı",
    aciklama: "Vurulunca ekran kenarında beliren iz: renk, saydamlık, uzunluk ve süre. FP = birinci şahıs.",
    onekler: ["misc.DamageOverlay."],
    dokular: /dmg|damage|blood|hit|overlay/i,
  },
  {
    id: "oldurme",
    ad: "Öldürme efekti",
    aciklama: "Birini öldürünce ekrana gelen efektin süresi.",
    onekler: ["misc.PedKillOverlay."],
  },
  {
    id: "hale",
    ad: "Işık hâleleri ve parlamalar",
    aciklama: "Lamba, far ve güneş parlamalarının boyutu, gücü ve renk kayması.",
    onekler: ["misc.coronas.", "lensflare."],
    dokular: /corona|flare|bokeh|lens/i,
  },
  {
    id: "arac",
    ad: "Araç ışıkları",
    aciklama: "Far, stop, sinyal ve neon ışıklarının rengi, menzili ve yoğunluğu.",
    onekler: [
      "car.headlight.",
      "car.taillight.",
      "car.indicator.",
      "car.reversinglight.",
      "car.defaultlight.",
      "car.brakelight.",
      "car.neon.",
      "car.coronas.",
      "car.sirens.",
      "car.siren",
    ],
    dokular: /vehiclelight|headlight|light_car|siren/i,
  },
  {
    id: "uzak",
    ad: "Uzak şehir ışıkları",
    aciklama: "Uzaktaki yol, sokak ve bina ışıklarının boyutu ve rengi.",
    onekler: ["distantlights.", "lodlight.", "trafficLight.", "trafficlight."],
    dokular: /distant/i,
  },
  {
    id: "bloom",
    ad: "Bloom, pozlama ve ton",
    aciklama: "Parlama taşması, göz uyumu ve ton eşleme.",
    onekler: ["bloom.", "Exposure.", "Adaptation.", "Tonemapping.", "misc.BloomIntensityClamp.", "misc.CrossPMultiplier."],
  },
  {
    id: "gok",
    ad: "Gökyüzü ve bulutlar",
    aciklama: "Gökyüzü, ay ve bulut katmanı.",
    onekler: ["sky.", "cloud.", "cloudgen.", "skyplane.", "misc.MoonDimMult"],
    dokular: /cloud|sky|moon|star/i,
  },
  {
    id: "yagmur",
    ad: "Yağmur ve su birikintisi",
    aciklama: "Yağmur damlaları ve yerdeki su birikintileri.",
    onekler: ["rain.", "puddles.", "raincollision."],
    dokular: /puddle|rain|drop/i,
  },
  {
    id: "karakter",
    ad: "Karakter ışığı",
    aciklama: "Oyuncu ve NPC üzerine düşen ek ışık, araç içi dahil.",
    onekler: ["ped.", "pedlight.", "pedLight.", "pedFpslight.", "pedFpsLight.", "pedincar.", "rim."],
  },
  {
    id: "bulaniklik",
    ad: "Bulanıklık ve alan derinliği",
    aciklama: "Nişan alırken, hasar alınca ve sinematik bulanıklık.",
    onekler: ["adaptivedof.", "misc.HiDof.", "misc.DOFBlurMultiplier.", "defaultmotionblur.", "cam.", "misc.SniperRifleDof."],
  },
  {
    id: "hud",
    ad: "Nişangah, radar ve HUD",
    aciklama: "Ekrandaki arayüz dokuları.",
    onekler: ["UI."],
    dokular: /reticle|crosshair|hud|radar|minimap|blip/i,
  },
];

export const anahtarUyar = (h: Hazir, anahtar: string) => {
  const k = anahtar.toLowerCase();
  return h.onekler.some((o) => k.startsWith(o.toLowerCase()));
};

export function rgbHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const k = (t: number) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  h /= 360;
  return [k(h + 1 / 3) * 255, k(h) * 255, k(h - 1 / 3) * 255];
}

/** Hedef rengin tonunu ve doygunluğunu alır, mevcut rengin parlaklığını korur. */
export function tonuTasi(mevcut: [number, number, number], hedef: [number, number, number]): [number, number, number] {
  const [, , l] = rgbHsl(...mevcut);
  const [h, s] = rgbHsl(...hedef);
  return hslRgb(h, s, l === 0 ? rgbHsl(...hedef)[2] : l);
}

export function sayiAralik(anahtar: string, v: number, olcek255 = false): [number, number] {
  if (olcek255) return [0, 255];
  const k = anahtar.toLowerCase();
  const mutlak = Math.abs(v);
  if (/duration|time|ms\b/.test(k)) return [0, Math.max(2000, mutlak * 3)];
  if (/enabled|^.*\.use|\.do[A-Z_]/i.test(anahtar) && (v === 0 || v === 1)) return [0, 1];
  const ust = mutlak === 0 ? 1 : mutlak <= 1 ? Math.max(1, mutlak * 3) : mutlak * 3;
  return [v < 0 ? -ust : 0, ust];
}
