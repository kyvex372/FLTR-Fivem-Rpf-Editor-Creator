import { invoke } from "@tauri-apps/api/core";

export interface Hedef {
  kaynak: string;
  arsivler: string[];
  yol: string;
  sil: boolean;
}

export interface Paket {
  ad: string;
  surum: string;
  yazar: string;
  aciklama: string;
  hedefler: Hedef[];
}

export interface DugumBilgi {
  ad: string;
  yol: string;
  tur: "dizin" | "arsiv" | "dosya";
  boyut: number;
  kayitli: number;
  degisti: boolean;
  rsc: boolean;
  cocuklar: DugumBilgi[];
}

export interface BelgeOzet {
  id: number;
  yol: string | null;
  ad: string;
  sifreleme: string;
  disk_boyutu: number;
  tahmini_boyut: number;
  kirli: boolean;
  geri: number;
  ileri: number;
  durum_no: number;
  paket: Paket | null;
  paket_hatasi: string | null;
  eksik_kaynak: string[];
  agac: DugumBilgi[];
}

export interface ModBilgi {
  dosya: string;
  yol: string;
  acik: boolean;
  boyut: number;
  kullanilan: number;
  sifreleme: string;
  dosya_sayisi: number;
  degisim: number;
  paket: Paket | null;
  eksik_kaynak: string[];
  hata: string | null;
  engeller: string[];
}

export interface ModRaporu {
  klasor: string;
  kapali_klasor: string;
  bulundu: boolean;
  modlar: ModBilgi[];
  cakismalar: { hedef: string; modlar: string[] }[];
}

export interface DosyaIcerigi {
  tur: "ytd" | "kaynak" | "ayar" | "metin" | "ikili" | "meta" | "model";
  boyut: number;
  metin: string | null;
  hex: string | null;
  rsc_surum: number | null;
}

export interface DokuBilgi {
  i: number;
  ad: string;
  genislik: number;
  yukseklik: number;
  bicim: string;
  seviye: number;
  destekli: boolean;
}

export interface ModelDokusu {
  ad: string;
  /** dokuyu barındıran dosya (modelin kendisi ya da paketteki ytd); oyunun kendi dokusuysa null */
  kaynak: string | null;
  i: number;
  genislik: number;
  yukseklik: number;
  bicim: string;
  destekli: boolean;
  gomulu: boolean;
  kullanilan: boolean;
}

export interface ModelOzeti {
  yol: string;
  boyut: number;
  ucgen: number;
  doku: number;
  kapak: number | null;
  hata: string | null;
}

export interface YptKare {
  zaman: [number, number, number, number];
  deger: [number, number, number, number];
  ofs: number;
}

export interface YptGrup {
  tur: "efekt" | "yayici" | "parcacik";
  ad: string;
  davranis: string | null;
  ozellikler: { ad: string; kareler: YptKare[] }[];
}

export interface GfxBilgisi {
  gorseller: { karakter: number; genislik: number; yukseklik: number; tur: string }[];
  dis: { ad: string; bulunan: [string, number] | null }[];
}

export const gfxUrl = (id: number, yol: string, c: number, boy: number, surum: number) =>
  `${PROTOKOL}/gfx?${new URLSearchParams({ id: String(id), yol, c: String(c), boy: String(boy), v: String(surum) })}`;

export interface CakismaAyrintisi {
  hedef: string;
  kaynaklar: { mod_dosyasi: string; paket_adi: string | null; icerik_yolu: string | null; boyut: number; ozet: string | null; hata: string | null }[];
  hepsi_ayni: boolean;
  ayar_farklari: { anahtar: string; degerler: (string | null)[] }[];
  ayar_farki_sayisi: number;
  doku_farklari: string[];
  satir_farklari: { satir: string; var: boolean[] }[];
  satir_farki_sayisi: number;
}

export interface Girdi {
  anahtar: string;
  deger: string;
  satir: number;
  tekrar: number;
}

export interface RenkUclusu {
  taban: string;
  anahtarlar: [string, string, string];
  olcek: number;
}

export interface RenkAyari {
  ton: number;
  doygunluk: number;
  parlaklik: number;
  kontrast: number;
  boya: [number, number, number] | null;
  boya_gucu: number;
}

export const NOTR_RENK: RenkAyari = { ton: 0, doygunluk: 1, parlaklik: 0, kontrast: 1, boya: null, boya_gucu: 0 };

export interface AiSaglayici {
  id: string;
  ad: string;
  tur: "anthropic" | "openai";
  adres: string;
  anahtar: string;
  model: string;
  gorsel: boolean;
  /** Bir isteğe sığması gereken yaklaşık token; ücretsiz katmanlarda düşük */
  butce?: number;
}

export interface Ayarlar {
  ai_saglayicilar?: AiSaglayici[];
  ai_secili?: string;
  ai_anahtari?: string;
  ai_modeli?: string;
}

export interface HaritaKarosu {
  ytd: string;
  i: number;
  ad: string;
  varyant: "sea" | "minimap";
  satir: number;
  sutun: number;
  genislik: number;
  yukseklik: number;
  bicim: string;
}

export interface HaritaDuzeni {
  duzen: { sutun: number; satir: number; karo: [number, number]; baslangic: [number, number] };
  duzen_kaynagi: "paket" | "oyun";
  karolar: HaritaKarosu[];
}

export type Karisim = "normal" | "carp" | "ekran";

export interface KatmanIstegi {
  gorsel: string;
  merkez: [number, number];
  boyut: [number, number];
  donus: number;
  opaklik: number;
  karisim: Karisim;
}

export type YtdIstegi =
  | { tur: "sil"; ad: string }
  | { tur: "koy"; ad: string; gorsel: string; boyut?: [number, number] | null; bicim?: string | null }
  | { tur: "olcekle"; ad: string; boyut: [number, number] };

export type Sigdirma = "esnet" | "sigdir" | "doldur";

export interface KayitSonucu {
  ozet: BelgeOzet;
  eski_boyut: number;
  yeni_boyut: number;
  yedek: string | null;
}

export const api = {
  modsTara: (klasor?: string) => invoke<ModRaporu>("mods_tara", { klasor: klasor ?? null }),
  modAcKapa: (klasor: string, dosya: string, acik: boolean) => invoke<void>("mod_ac_kapa", { klasor, dosya, acik }),
  arsivAc: (yol: string) => invoke<BelgeOzet>("arsiv_ac", { yol }),
  yeniMod: (ad: string, yazar: string) => invoke<BelgeOzet>("yeni_mod", { ad, yazar }),
  ozet: (id: number) => invoke<BelgeOzet>("belge_ozet", { id }),
  kapat: (id: number) => invoke<void>("belge_kapat", { id }),
  geriAl: (id: number) => invoke<BelgeOzet>("geri_al", { id }),
  yinele: (id: number) => invoke<BelgeOzet>("yinele", { id }),
  kaydet: (id: number, hedef?: string) => invoke<KayitSonucu>("kaydet", { id, hedef: hedef ?? null }),
  yedeklerKlasoru: () => invoke<string>("yedekler_klasoru"),
  modaKur: (id: number, klasor: string) => invoke<string>("moda_kur", { id, klasor }),
  icerikteAra: (id: number, sorgu: string) =>
    invoke<{ tur: "yol" | "doku" | "ayar" | "metin"; yol: string; ek: string; ayrinti: string }[]>("icerikte_ara", { id, sorgu }),
  modSikistir: (yol: string) => invoke<{ eski: number; yeni: number; yedek: string | null }>("mod_sikistir", { yol }),
  yedekleriListele: () => invoke<{ yol: string; ad: string; kaynak: string | null; boyut: number; zaman: number }[]>("yedekleri_listele"),
  yedekGeriYukle: (yedek: string, hedef: string) => invoke<void>("yedek_geri_yukle", { yedek, hedef }),
  dosyaOku: (id: number, yol: string) => invoke<DosyaIcerigi>("dosya_oku", { id, yol }),
  metinYaz: (id: number, yol: string, metin: string) => invoke<BelgeOzet>("metin_yaz", { id, yol, metin }),
  iceAktar: (id: number, dizin: string, kaynaklar: string[]) => invoke<BelgeOzet>("ice_aktar", { id, dizin, kaynaklar }),
  dosyaDegistir: (id: number, yol: string, kaynak: string) => invoke<BelgeOzet>("dosya_degistir", { id, yol, kaynak }),
  disaAktar: (id: number, yollar: string[], hedef: string) => invoke<number>("disa_aktar", { id, yollar, hedef }),
  sil: (id: number, yollar: string[]) => invoke<BelgeOzet>("sil", { id, yollar }),
  yenidenAdlandir: (id: number, yol: string, ad: string) => invoke<BelgeOzet>("yeniden_adlandir", { id, yol, ad }),
  dizinOlustur: (id: number, yol: string) => invoke<BelgeOzet>("dizin_olustur", { id, yol }),
  tasi: (id: number, yollar: string[], dizin: string) => invoke<BelgeOzet>("tasi", { id, yollar, dizin }),
  ytdListesi: (id: number, yol: string) => invoke<DokuBilgi[]>("ytd_listesi", { id, yol }),
  dokuDegistir: (id: number, yol: string, i: number, gorsel: string, sigdirma: Sigdirma, renk: RenkAyari) =>
    invoke<BelgeOzet>("doku_degistir", { id, yol, i, gorsel, sigdirma, renk }),
  dokuRenklendir: (id: number, yol: string, indeksler: number[], renk: RenkAyari) =>
    invoke<BelgeOzet>("doku_renklendir", { id, yol, indeksler, renk }),
  ytdIslem: (id: number, yol: string, islemler: YtdIstegi[]) => invoke<BelgeOzet>("ytd_islem", { id, yol, islemler }),
  metaYaz: (id: number, yol: string, xml: string) => invoke<{ ozet: BelgeOzet; uyarilar: string[] }>("meta_yaz", { id, yol, xml }),
  dokuAdlandir: (id: number, yol: string, i: number, ad: string) => invoke<BelgeOzet>("doku_adlandir", { id, yol, i, ad }),
  ayarlarOku: () => invoke<Ayarlar>("ayarlar_oku"),
  ayarlarYaz: (ayarlar: Ayarlar) => invoke<void>("ayarlar_yaz", { ayarlar }),
  aiHttp: (yontem: "GET" | "POST", url: string, basliklar: Record<string, string>, govde?: string) =>
    invoke<{ durum: number; govde: string; bekle: number | null }>("ai_http", { yontem, url, basliklar, govde: govde ?? null }),
  dokuDisa: (id: number, yol: string, i: number, hedef: string) => invoke<void>("doku_disa", { id, yol, i, hedef }),
  dokuTopluDisa: (id: number, yol: string, klasor: string, dds: boolean) => invoke<number>("doku_toplu_disa", { id, yol, klasor, dds }),
  dokuTopluIce: (id: number, yol: string, klasor: string, sigdirma: Sigdirma) =>
    invoke<{ ozet: BelgeOzet | null; eslesen: string[]; eslesmeyen: string[] }>("doku_toplu_ice", { id, yol, klasor, sigdirma }),
  modelDokulari: (id: number, yol: string) => invoke<ModelDokusu[]>("model_dokulari", { id, yol }),
  cakismaIncele: (klasor: string, hedef: string, modlar: string[]) => invoke<CakismaAyrintisi>("cakisma_incele", { klasor, hedef, modlar }),
  modelOzetleri: (id: number) => invoke<ModelOzeti[]>("model_ozetleri", { id }),
  gfxBilgi: (id: number, yol: string) => invoke<GfxBilgisi>("gfx_bilgi", { id, yol }),
  gfxDegistir: (id: number, yol: string, karakter: number, gorsel: string, sigdirma: Sigdirma) =>
    invoke<BelgeOzet>("gfx_degistir", { id, yol, karakter, gorsel, sigdirma }),
  gfxDisa: (id: number, yol: string, karakter: number, hedef: string) => invoke<void>("gfx_disa", { id, yol, karakter, hedef }),
  yptAyarlari: (id: number, yol: string) => invoke<YptGrup[]>("ypt_ayarlari", { id, yol }),
  yptYaz: (id: number, yol: string, degisiklikler: [number, number[]][]) => invoke<BelgeOzet>("ypt_yaz", { id, yol, degisiklikler }),
  vsOku: (id: number, yol: string) => invoke<{ girdiler: Girdi[]; renkler: RenkUclusu[] }>("vs_oku", { id, yol }),
  vsAyarla: (id: number, yol: string, degerler: [string, string][]) => invoke<BelgeOzet>("vs_ayarla", { id, yol, degerler }),
  paketYaz: (id: number, paket: Paket) => invoke<BelgeOzet>("paket_yaz", { id, paket }),
  oluSatirlariTemizle: (id: number) => invoke<BelgeOzet>("olu_satirlari_temizle", { id }),
  kaynakOnar: (id: number, eski: string, yeni: string) => invoke<BelgeOzet>("kaynak_onar", { id, eski, yeni }),
  openYap: (id: number) => invoke<BelgeOzet>("open_yap", { id }),
  metinOlustur: (id: number, yol: string, metin: string) => invoke<BelgeOzet>("metin_olustur", { id, yol, metin }),
  hedefEkle: (id: number, kaynak: string, arsivler: string[], yol: string) => invoke<BelgeOzet>("hedef_ekle", { id, kaynak, arsivler, yol }),
  acikBelgeler: () => invoke<{ id: number; ad: string; paket: string | null }[]>("acik_belgeler"),
  belgelerArasiKopyala: (kaynakId: number, kaynakYol: string, hedefId: number, hedefYol: string) =>
    invoke<BelgeOzet>("belgeler_arasi_kopyala", { kaynakId, kaynakYol, hedefId, hedefYol }),
  geciciGorselKaydet: (bayt: Uint8Array) => invoke<string>("gecici_gorsel_kaydet", { bayt: Array.from(bayt) }),
  modelObj: (id: number, yol: string, klasor: string) =>
    invoke<{ obj: string; doku: number; eksik: string[] }>("model_obj", { id, yol, klasor }),
  haritaDuzeni: (id: number) => invoke<HaritaDuzeni>("harita_duzeni", { id }),
  haritaIsle: (id: number, katmanlar: KatmanIstegi[], varyantlar: string[]) =>
    invoke<{ ozet: BelgeOzet; karo: number }>("harita_isle", { id, katmanlar, varyantlar }),
  hedefliEkle: (id: number, dosya: { kaynak: string; arsivler: string[]; yol: string }) =>
    invoke<BelgeOzet>("hedefli_ekle", { id, dosya }),
};

export const PROTOKOL = navigator.userAgent.includes("Windows") ? "http://fltr.localhost" : "fltr://localhost";

export const yerelGorselUrl = (yol: string) => `${PROTOKOL}/gorsel?${new URLSearchParams({ yol })}`;

export function dokuUrl(id: number, yol: string, i: number, boy: number, surum: number, renk?: RenkAyari) {
  const q = new URLSearchParams({ id: String(id), yol, i: String(i), boy: String(boy), v: String(surum) });
  if (renk) {
    q.set("ton", String(renk.ton));
    q.set("doy", String(renk.doygunluk));
    q.set("par", String(renk.parlaklik));
    q.set("kon", String(renk.kontrast));
    q.set("guc", String(renk.boya_gucu));
    if (renk.boya) q.set("boya", renk.boya.map((c) => c.toString(16).padStart(2, "0")).join(""));
  }
  return `${PROTOKOL}/${renk ? "onizle" : "doku"}?${q}`;
}

export function boyutYaz(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function hataMetni(e: unknown) {
  return typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
}

export function tumDugumler(agac: DugumBilgi[]): DugumBilgi[] {
  const v: DugumBilgi[] = [];
  const gez = (d: DugumBilgi[]) => {
    for (const x of d) {
      v.push(x);
      gez(x.cocuklar);
    }
  };
  gez(agac);
  return v;
}

/** `a\b.rpf\c\d.rpf\e\f.dat` → arşiv zinciri + iç yol */
export function oyunYoluCoz(tam: string) {
  const parcalar = tam.replace(/\//g, "\\").split("\\").filter(Boolean);
  const arsivler: string[] = [];
  let birikim: string[] = [];
  parcalar.forEach((p, i) => {
    birikim.push(p);
    if (p.toLowerCase().endsWith(".rpf") && i < parcalar.length - 1) {
      arsivler.push(birikim.join("\\"));
      birikim = [];
    }
  });
  return { arsivler, yol: birikim.join("\\") };
}

export function uzanti(ad: string) {
  const i = ad.lastIndexOf(".");
  return i < 0 ? "" : ad.slice(i + 1).toLowerCase();
}
