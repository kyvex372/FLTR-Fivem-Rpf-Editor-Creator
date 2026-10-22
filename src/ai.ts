import Anthropic from "@anthropic-ai/sdk";
import { api, boyutYaz, dokuUrl, NOTR_RENK, oyunYoluCoz, tumDugumler, type AiSaglayici, type BelgeOzet, type RenkAyari } from "./api";
import { hexCoz } from "./ortak";
import { topluDegistir, yptSuz, type Deger } from "./yptToplu";
import { yaziCiz } from "./yazi";

export const VARSAYILAN_MODEL = "claude-opus-5-5";
export const CLAUDE_MODELLERI = ["claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5-5", "claude-haiku-5-5"];

/** Reddedilen isteği sunucu tarafında başka modelle sürdürmeyi destekleyen modeller. */
const YEDEKLI_MODELLER = ["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"];
/** Uyarlanabilir düşünme ve effort ayarı olmayan eski modeller. */
const ESKI_MODEL = /^claude-(haiku-4|sonnet-4-5|opus-4-5|3)/;

export interface HazirSaglayici {
  anahtar: string;
  ad: string;
  not: string;
  link: string;
  sablon: Omit<AiSaglayici, "id" | "anahtar">;
}

export const HAZIR_SAGLAYICILAR: HazirSaglayici[] = [
  {
    anahtar: "gemini",
    ad: "Google Gemini",
    not: "Ücretsiz, kart istemez. Araç çağırma ve görsel destekli; önerilen ücretsiz seçenek.",
    link: "https://aistudio.google.com/apikey",
    sablon: { ad: "Google Gemini", tur: "openai", adres: "https://generativelanguage.googleapis.com/v1beta/openai", model: "", gorsel: true, butce: 60000 },
  },
  {
    anahtar: "groq",
    ad: "Groq",
    not: "Ücretsiz, çok hızlı. Görsel yok.",
    link: "https://console.groq.com/keys",
    sablon: { ad: "Groq", tur: "openai", adres: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", gorsel: false, butce: 5500 },
  },
  {
    anahtar: "openrouter",
    ad: "OpenRouter",
    not: "openrouter/free, araç çağırabilen ücretsiz bir modeli kendisi seçer; kalite değişken.",
    link: "https://openrouter.ai/keys",
    sablon: { ad: "OpenRouter", tur: "openai", adres: "https://openrouter.ai/api/v1", model: "openrouter/free", gorsel: false, butce: 20000 },
  },
  {
    anahtar: "ollama",
    ad: "Ollama (yerel)",
    not: "Bilgisayarında çalışır, internet ve anahtar gerekmez. Araç destekli bir model indir (ör. qwen3).",
    link: "https://ollama.com/download",
    sablon: { ad: "Ollama", tur: "openai", adres: "http://localhost:11434/v1", model: "", gorsel: false, butce: 6000 },
  },
  {
    anahtar: "claude",
    ad: "Anthropic Claude",
    not: "Ücretli. Bu işte en tutarlı sonuç.",
    link: "https://console.anthropic.com/settings/keys",
    sablon: { ad: "Claude", tur: "anthropic", adres: "https://api.anthropic.com", model: VARSAYILAN_MODEL, gorsel: true, butce: 150000 },
  },
  {
    anahtar: "openai",
    ad: "OpenAI",
    not: "Ücretli.",
    link: "https://platform.openai.com/api-keys",
    sablon: { ad: "OpenAI", tur: "openai", adres: "https://api.openai.com/v1", model: "", gorsel: true, butce: 60000 },
  },
  {
    anahtar: "ozel",
    ad: "Özel (OpenAI uyumlu)",
    not: "LM Studio, DeepSeek, Mistral, Cerebras… /chat/completions sunan her servis.",
    link: "",
    sablon: { ad: "Özel", tur: "openai", adres: "", model: "", gorsel: false, butce: 12000 },
  },
];

/** Anahtarın ön ekinden sağlayıcıyı tahmin eder; yanlış sağlayıcıya yapıştırılan anahtarı yakalamak için. */
export function anahtardanHazir(anahtar: string): HazirSaglayici | undefined {
  const k = anahtar.trim();
  const ad = k.startsWith("sk-ant-")
    ? "claude"
    : k.startsWith("gsk_")
      ? "groq"
      : k.startsWith("AIza")
        ? "gemini"
        : k.startsWith("sk-or-")
          ? "openrouter"
          : k.startsWith("sk-")
            ? "openai"
            : undefined;
  return HAZIR_SAGLAYICILAR.find((h) => h.anahtar === ad);
}

function openaiBasliklari(s: AiSaglayici): Record<string, string> {
  const b: Record<string, string> = {};
  if (s.anahtar) b.authorization = `Bearer ${s.anahtar}`;
  if (s.adres.includes("openrouter.ai")) b["x-title"] = "Fltr Fivemleaktr";
  return b;
}

const adresDuzelt = (a: string) => a.trim().replace(/\/+$/, "");

/** Sağlayıcının tek isteğe sığdırılacak yaklaşık token bütçesi; bilinmeyen için temkinli. */
export function butceAl(s: AiSaglayici) {
  if (s.butce && s.butce > 0) return s.butce;
  if (s.tur === "anthropic") return 150000;
  if (s.adres.includes("groq.com")) return 5500;
  if (s.adres.includes("localhost") || s.adres.includes("127.0.0.1")) return 6000;
  return 12000;
}

/** Yaklaşık token: Türkçe/JSON karışık metinde ~3.5 karakter bir token. */
const tokenTahmini = (s: string) => Math.ceil(s.length / 3.5);

function kisalt(metin: string, sinir: number, ipucu: string) {
  if (metin.length <= sinir) return metin;
  const satirlar = metin.split("\n");
  let n = 0;
  const kalan: string[] = [];
  for (const x of satirlar) {
    if (n + x.length + 1 > sinir) break;
    kalan.push(x);
    n += x.length + 1;
  }
  return `${kalan.join("\n")}\n… (sonuç kısaltıldı: ${satirlar.length} satırdan ${kalan.length} tanesi gösterildi. ${ipucu})`;
}

export async function modelleriGetir(s: AiSaglayici): Promise<string[]> {
  if (s.tur === "anthropic") {
    const istemci = new Anthropic({ apiKey: s.anahtar, dangerouslyAllowBrowser: true });
    const v: string[] = [];
    for await (const m of istemci.models.list()) v.push(m.id);
    return v.length ? v : CLAUDE_MODELLERI;
  }
  const r = await api.aiHttp("GET", `${adresDuzelt(s.adres)}/models`, openaiBasliklari(s));
  if (r.durum >= 400) throw new Error(`model listesi alınamadı (${r.durum}): ${hataMesaji(r.govde)}`);
  const j = JSON.parse(r.govde);
  return ((j.data ?? j.models ?? []) as { id?: string; name?: string }[])
    .map((m) => String(m.id ?? m.name ?? "").replace(/^models\//, ""))
    .filter(Boolean)
    .sort();
}

function hataMesaji(govde: string) {
  try {
    const j = JSON.parse(govde);
    const e = Array.isArray(j) ? j[0]?.error : j.error;
    return String(e?.message ?? e ?? govde).slice(0, 400);
  } catch {
    return govde.slice(0, 400);
  }
}

type Mesaj = Anthropic.Beta.BetaMessageParam;

const SISTEM = `Sen Fltr Fivemleaktr içindeki mod düzenleme asistanısın. Kullanıcı bir FiveM "mods" klasörü paketini (.rpf, OpenIV/OIV biçimi) açmış durumda; bu paket GTA V'nin bazı dosyalarını değiştirir. Araçlarla paketin içeriğini okuyup değiştirebilirsin.

Alan bilgisi:
- visualsettings.dat: "anahtar değer" satırları. Renkler .red/.green/.blue (ya da R/G/B) üçlüleri; aynı dosyada hem 0-255 hem 0-1 ölçeği bulunur, mevcut değerin ölçeğini koru. misc.DamageOverlay.* vurulunca ekran kenarındaki hasar izi (FP.* birinci şahıs), misc.PedKillOverlay.* öldürme efekti, misc.coronas.* ışık hâleleri, car.* araç ışıkları, distantlights.* uzak ışıklar.
- .ytd doku sözlüğüdür. Doku adları oyunun o dokuyu bulduğu anahtardır: yeniden adlandırılan doku oyunda artık eski adıyla bulunmaz. Kullanıcı bunu açıkça istemedikçe doku adı değiştirme.
- assembly.xml hangi paket dosyasının oyunda nereye gittiğini söyler (content/ altındaki dosyalar).
- Modeller (.ydr/.ydd/.yft) ve parçacık sözlükleri (.ypt) kendi içlerinde doku taşıyabilir; doku araçları bu dosyaların yoluyla da çalışır (list_textures, view_texture, recolor_textures, resize_texture). Bunlarda doku silinemez/eklenemez.
- .ypt parçacık efektleridir (kan, namlu alevi, duman, ateş, kıvılcım, patlama). list_effects ile ara, edit_effects ile renk/ton/boyut/ışık/yoğunluk değiştir. Efekt adları İngilizcedir: kan "blood", namlu alevi "muz", ateş "fire", duman "smoke", kıvılcım "spark", patlama "exp", mermi izi/çarpma "bul"/"impact". Yoğunluk 0 efekti kapatır.
- .gfx Scaleform arayüzüdür (HUD, radar). list_gfx_images içindeki görselleri ve oyunun ytd'lerinden kullandığı dokuları listeler; görseli değiştirmek kullanıcının dosya seçmesini gerektirir, bunu ona söyle.

Yeni mod kurmak:
- Paket = kökte assembly.xml + content/ altındaki dosyalar + her dosya için oyun yolu eşlemesi (map_to_game). Eşlenmeyen dosya oyunda hiçbir şey yapmaz.
- Oyunun orijinal dosyalarına erişimin yok. Tam bir temel dosya gerekiyorsa (ör. visualsettings.dat) list_open_packages ile açık diğer modlara bak, copy_from_package ile al, sonra düzenle. Uygun kaynak yoksa kullanıcıdan o dosyayı içeren bir modu açmasını iste; dosyayı uydurma.
- Bilinen yollar: visualsettings.dat → update\\update.rpf\\common\\data\\visualsettings.dat · graphics.ytd → update\\update.rpf\\x64\\textures\\graphics.ytd · timecycle_mods_N.xml → update\\update.rpf\\common\\data\\timecycle\\timecycle_mods_N.xml · playerinfo.ymt → update\\update.rpf\\x64\\data\\tune\\playerinfo.ymt. Emin olmadığın yolu diğer modların assembly.xml'inden (list_package_files + read_text) doğrula.
- Sıfırdan 3B model ya da doku çizemezsin; var olan dokuları renklendirebilir, boyutlandırabilir, silebilir, ayar ve metin dosyalarını yazabilirsin.

ESC/radar haritası (minimap karoları olan paketler):
- Önce get_map_layout ile düzeni ve koordinat aralığını al. Koordinatlar oyunun kendi X (doğu) / Y (kuzey) değerleridir; kullanıcı /coords çıktısı verirse onu kullan.
- map_add_text yazıyı haritaya kalıcı işler; map_recolor bütün haritanın rengini değiştirir.

Çalışma biçimi:
- Değiştirmeden önce ilgili değerleri oku. Kullanıcının istediği kadarını değiştir, fazlasını değil.
- Her değişiklik uygulamada geri alınabilir ve kullanıcı kaydedene kadar diske yazılmaz; bu yüzden onay isteyip bekleme, yap ve ne yaptığını söyle.
- Belirsiz bir istekte makul yorumu seç ve hangi yorumu seçtiğini tek cümleyle belirt.
- Türkçe, kısa ve düz yanıt ver. Sonunda neyi hangi değerden hangi değere çektiğini özetle.`;

const ARACLAR: Anthropic.Beta.BetaTool[] = [
  {
    name: "list_files",
    description: "Açık paketteki bütün dosya ve klasörleri yol, boyut ve türle listeler.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_settings",
    description:
      "Bir visualsettings.dat dosyasındaki ayarları 'anahtar = değer' olarak döndürür, renk üçlülerini ayrıca listeler. filter anahtar içinde geçen metne göre süzer (büyük/küçük harf duyarsız).",
    input_schema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Paket içi yol, ör. content/essa/visualsettings.dat" },
        filter: { type: "string" },
      },
      required: ["file"],
      additionalProperties: false,
    },
  },
  {
    name: "set_settings",
    description: "visualsettings.dat içinde bir ya da daha çok anahtarın değerini değiştirir. Aynı anahtar dosyada birden çok kez geçiyorsa hepsi güncellenir.",
    input_schema: {
      type: "object",
      properties: {
        file: { type: "string" },
        changes: {
          type: "array",
          items: {
            type: "object",
            properties: { key: { type: "string" }, value: { type: "string" } },
            required: ["key", "value"],
            additionalProperties: false,
          },
        },
      },
      required: ["file", "changes"],
      additionalProperties: false,
    },
  },
  {
    name: "list_textures",
    description: "Bir .ytd doku sözlüğündeki dokuları ad, boyut, biçim ve mip sayısıyla listeler.",
    input_schema: {
      type: "object",
      properties: { file: { type: "string" }, filter: { type: "string" } },
      required: ["file"],
      additionalProperties: false,
    },
  },
  {
    name: "view_texture",
    description: "Bir dokunun görüntüsünü PNG olarak getirir; içeriğini görmek için kullan.",
    input_schema: {
      type: "object",
      properties: {
        file: { type: "string" },
        texture: { type: "string", description: "Doku adı" },
        size: { type: "integer", description: "En uzun kenar, 64-1024 arası. Varsayılan 384." },
      },
      required: ["file", "texture"],
      additionalProperties: false,
    },
  },
  {
    name: "recolor_textures",
    description:
      "Dokuları yeniden renklendirir ve aynı biçimde yeniden kodlar. tint_color verilirse dokunun tonu o renge çekilir (tint_strength 0-1, varsayılan 1). hue_shift derece (-180..180), saturation ve contrast çarpan (1 = değişmez), brightness -1..1.",
    input_schema: {
      type: "object",
      properties: {
        file: { type: "string" },
        textures: { type: "array", items: { type: "string" }, description: "Doku adları; hepsi için [\"*\"]" },
        tint_color: { type: "string", description: "#rrggbb" },
        tint_strength: { type: "number" },
        hue_shift: { type: "number" },
        saturation: { type: "number" },
        brightness: { type: "number" },
        contrast: { type: "number" },
      },
      required: ["file", "textures"],
      additionalProperties: false,
    },
  },
  {
    name: "rename_texture",
    description: "Bir .ytd içindeki dokunun adını değiştirir. Oyun dokuyu adıyla bulduğu için yalnız kullanıcı açıkça isterse kullan.",
    input_schema: {
      type: "object",
      properties: { file: { type: "string" }, texture: { type: "string" }, new_name: { type: "string" } },
      required: ["file", "texture", "new_name"],
      additionalProperties: false,
    },
  },
  {
    name: "rename_path",
    description: "Paket içindeki bir dosyayı ya da klasörü yeniden adlandırır (yalnız ad, klasör değişmez).",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, new_name: { type: "string" } },
      required: ["path", "new_name"],
      additionalProperties: false,
    },
  },
  {
    name: "read_text",
    description: "Metin dosyasını (xml, meta, dat, txt) okur. package_id verilirse açık başka bir paketten okur.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, package_id: { type: "integer" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "write_text",
    description:
      "Metin dosyasının içeriğini tamamen verilen metinle değiştirir. .ymt/.ymap/.ytyp için read_text'in verdiği XML'i düzenleyip ver; ikiliye geri yazılır. visualsettings.dat için set_settings kullan.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "create_text_file",
    description:
      "Pakette yeni bir metin dosyası oluşturur ya da var olanın üstüne yazar (xml, meta, dat, txt). Mod dosyaları content/ altına konur. Oyunda etkili olması için ardından map_to_game ile oyun yoluna eşle.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Paket içi yol, ör. content/timecycle_mods_4.xml" }, content: { type: "string" } },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "map_to_game",
    description:
      "assembly.xml'e eşleme ekler: content/ altındaki bir dosyanın oyunda hangi dosyanın yerine geçeceği. game_path arşivler dahil tam yol, ör. update\\update.rpf\\common\\data\\visualsettings.dat",
    input_schema: {
      type: "object",
      properties: { source: { type: "string", description: "content/ altındaki yol" }, game_path: { type: "string" } },
      required: ["source", "game_path"],
      additionalProperties: false,
    },
  },
  {
    name: "list_open_packages",
    description: "Uygulamada açık olan diğer paketleri (id, dosya adı, paket adı) listeler. Başka bir moddan dosya almak için kullan.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_package_files",
    description: "Açık başka bir paketin dosyalarını listeler.",
    input_schema: { type: "object", properties: { package_id: { type: "integer" } }, required: ["package_id"], additionalProperties: false },
  },
  {
    name: "copy_from_package",
    description:
      "Açık başka bir paketten bir dosyayı ya da klasörü bu pakete kopyalar. Oyunun orijinal dosyaları erişilebilir olmadığından tam bir temel dosya (ör. visualsettings.dat) gerekince bunu kullan.",
    input_schema: {
      type: "object",
      properties: { package_id: { type: "integer" }, path: { type: "string" }, to_path: { type: "string", description: "Bu paketteki hedef yol" } },
      required: ["package_id", "path", "to_path"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_textures",
    description: "Bir .ytd'den dokuları siler (sözlük yeniden kurulur). Oyunun kullandığı dokuyu silmek görünmez yüzeye yol açabilir; yalnız istenirse.",
    input_schema: {
      type: "object",
      properties: { file: { type: "string" }, textures: { type: "array", items: { type: "string" } } },
      required: ["file", "textures"],
      additionalProperties: false,
    },
  },
  {
    name: "resize_texture",
    description: "Dokunun çözünürlüğünü değiştirir (içerik yeniden örneklenir, biçim korunur). 2'nin kuvvetleri en güvenlisi.",
    input_schema: {
      type: "object",
      properties: { file: { type: "string" }, texture: { type: "string" }, width: { type: "integer" }, height: { type: "integer" } },
      required: ["file", "texture", "width", "height"],
      additionalProperties: false,
    },
  },
  {
    name: "get_map_layout",
    description: "Paketteki ESC/radar haritası karolarını ve oyun koordinatı aralığını verir (X doğu, Y kuzey). Harita işlemlerinden önce çağır.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "map_add_text",
    description:
      "ESC/radar haritasına oyun koordinatında yazı işler (karolara kalıcı yazılır, geri alınabilir). width oyun birimi cinsinden yazı genişliği (şehir için 600-1500 uygun).",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Birden çok satır için satır sonu kullan" },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        rotation: { type: "number", description: "derece, saat yönünün tersi" },
        color: { type: "string", description: "#rrggbb" },
        outline_color: { type: "string" },
        outline: { type: "number", description: "0-40" },
        font: { type: "string", enum: ["Segoe UI", "Bahnschrift", "Arial Black", "Impact", "Trebuchet MS", "Georgia", "Consolas"] },
        opacity: { type: "number" },
      },
      required: ["text", "x", "y"],
      additionalProperties: false,
    },
  },
  {
    name: "map_recolor",
    description: "ESC/radar haritasının bütün karolarını renklendirir. tint_color verilirse ton o renge çekilir; hue_shift derece, saturation/contrast çarpan, brightness -1..1.",
    input_schema: {
      type: "object",
      properties: {
        tint_color: { type: "string" },
        tint_strength: { type: "number" },
        hue_shift: { type: "number" },
        saturation: { type: "number" },
        brightness: { type: "number" },
        contrast: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_effects",
    description:
      "Bir .ypt parçacık sözlüğündeki efekt, yayıcı ve parçacık kurallarını arar; her birinin renk/boyut/ışık/yoğunluk anahtar karelerini özetler. query İngilizce ad parçası (ör. blood, muz_pistol).",
    input_schema: {
      type: "object",
      properties: {
        file: { type: "string" },
        query: { type: "string" },
        kind: { type: "string", enum: ["hepsi", "efekt", "yayici", "parcacik"] },
      },
      required: ["file"],
      additionalProperties: false,
    },
  },
  {
    name: "edit_effects",
    description:
      "query ile eşleşen bütün efekt kurallarına toplu değişiklik uygular (tek geri-al adımı). hue_shift derece; paint_color #rrggbb ve paint_strength 0..1 rengi o renge çeker (parlaklık korunur); size_mul, light_mul, density_mul çarpan (density 0 efekti kapatır).",
    input_schema: {
      type: "object",
      properties: {
        file: { type: "string" },
        query: { type: "string" },
        kind: { type: "string", enum: ["hepsi", "efekt", "yayici", "parcacik"] },
        hue_shift: { type: "number" },
        paint_color: { type: "string" },
        paint_strength: { type: "number" },
        size_mul: { type: "number" },
        light_mul: { type: "number" },
        density_mul: { type: "number" },
      },
      required: ["file", "query"],
      additionalProperties: false,
    },
  },
  {
    name: "list_gfx_images",
    description: "Bir .gfx (Scaleform arayüz) dosyasının gömülü görsellerini ve oyunun ytd'lerinden kullandığı doku adlarını listeler.",
    input_schema: { type: "object", properties: { file: { type: "string" } }, required: ["file"], additionalProperties: false },
  },
  {
    name: "get_package",
    description: "assembly.xml bilgisini döndürür: paket adı, yazar, sürüm ve dosya→oyun yolu eşlemeleri, kaynağı eksik olanlar.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

const METIN_SINIRI = 200_000;

async function pngBase64(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  const b = new Uint8Array(await r.arrayBuffer());
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

type Sonuc = string | Anthropic.Beta.BetaToolResultBlockParam["content"];

class Araclar {
  ozet: BelgeOzet;
  surum = 0;
  constructor(
    ozet: BelgeOzet,
    private guncelle: (o: BelgeOzet) => void,
    private gorsel: boolean,
    /** tek araç sonucunun en fazla karakter sayısı */
    private sinir: number,
  ) {
    this.ozet = ozet;
  }

  async guvenli(ad: string, g: Record<string, any>, olay: (x: AiOlay) => void): Promise<{ icerik: Sonuc; hata: boolean }> {
    try {
      let icerik = await this.calistir(ad, g);
      if (typeof icerik === "string") icerik = kisalt(icerik, this.sinir, "Daha dar bir filter ya da yol ver.");
      olay({ tur: "arac", metin: aracOzeti(ad, g) });
      return { icerik, hata: false };
    } catch (e) {
      const hata = e instanceof Error ? e.message : String(e);
      olay({ tur: "arac", metin: `${aracOzeti(ad, g)} — hata: ${hata}` });
      return { icerik: hata, hata: true };
    }
  }

  private yeni(o: BelgeOzet) {
    this.ozet = o;
    this.surum++;
    this.guncelle(o);
  }

  private async dokuBul(file: string, ad: string) {
    const liste = await api.ytdListesi(this.ozet.id, file);
    const d = liste.find((x) => x.ad.toLowerCase() === ad.toLowerCase());
    if (!d) throw new Error(`${file} içinde "${ad}" dokusu yok. Mevcut: ${liste.slice(0, 40).map((x) => x.ad).join(", ")}`);
    return { d, liste };
  }

  async calistir(ad: string, g: Record<string, any>): Promise<Sonuc> {
    const id = this.ozet.id;
    switch (ad) {
      case "list_files":
        return tumDugumler(this.ozet.agac)
          .map((d) => `${d.yol} | ${d.tur}${d.tur === "dosya" ? ` | ${boyutYaz(d.boyut)}` : ""}`)
          .join("\n");
      case "read_settings": {
        const v = await api.vsOku(id, g.file);
        const f = (g.filter ?? "").toLowerCase();
        const girdiler = v.girdiler.filter((x) => !f || x.anahtar.toLowerCase().includes(f));
        if (girdiler.length * 40 > this.sinir) {
          const gruplar = new Map<string, number>();
          for (const x of girdiler) {
            const onek = x.anahtar.split(".").slice(0, 2).join(".");
            gruplar.set(onek, (gruplar.get(onek) ?? 0) + 1);
          }
          return `${girdiler.length} ayar var, hepsi tek seferde sığmıyor. Gruplar (önek: adet):\n${[...gruplar]
            .map(([k, n]) => `${k}: ${n}`)
            .join("\n")}\n\nİlgili grubu filter ile oku, ör. filter: "misc.DamageOverlay".`;
        }
        const renkler = v.renkler.filter((r) => !f || r.taban.toLowerCase().includes(f));
        return (
          girdiler.map((x) => `${x.anahtar} = ${x.deger}${x.tekrar > 1 ? `  (dosyada ${x.tekrar} kez)` : ""}`).join("\n") +
          (renkler.length ? `\n\nRenk üçlüleri:\n${renkler.map((r) => `${r.taban} (${r.olcek === 255 ? "0-255" : "0-1"})`).join("\n")}` : "") +
          `\n\n${girdiler.length} / ${v.girdiler.length} ayar`
        );
      }
      case "set_settings": {
        const degerler = (g.changes as { key: string; value: string }[]).map((c) => [c.key, String(c.value)] as [string, string]);
        this.yeni(await api.vsAyarla(id, g.file, degerler));
        return `${degerler.length} anahtar yazıldı.`;
      }
      case "list_textures": {
        const f = (g.filter ?? "").toLowerCase();
        const liste = await api.ytdListesi(id, g.file);
        return liste
          .filter((d) => !f || d.ad.toLowerCase().includes(f))
          .map((d) => `${d.ad} | ${d.genislik}x${d.yukseklik} | ${d.bicim} | ${d.seviye} mip${d.destekli ? "" : " | desteklenmiyor"}`)
          .join("\n");
      }
      case "view_texture": {
        const { d } = await this.dokuBul(g.file, g.texture);
        if (!this.gorsel) return `${d.ad}: ${d.genislik}x${d.yukseklik} ${d.bicim}. Bu model görsel alamıyor; içeriği göremezsin, yalnız bu bilgiyi kullan.`;
        const boy = Math.min(1024, Math.max(64, g.size ?? 384));
        const veri = await pngBase64(dokuUrl(id, g.file, d.i, boy, Date.now()));
        return [
          { type: "text", text: `${d.ad}: ${d.genislik}x${d.yukseklik} ${d.bicim}` },
          { type: "image", source: { type: "base64", media_type: "image/png", data: veri } },
        ];
      }
      case "recolor_textures": {
        const liste = await api.ytdListesi(id, g.file);
        const istenen = (g.textures as string[]).map((t) => t.toLowerCase());
        const secilen = liste.filter((d) => d.destekli && (istenen.includes("*") || istenen.includes(d.ad.toLowerCase())));
        if (!secilen.length) throw new Error("eşleşen doku yok");
        const renk: RenkAyari = {
          ...NOTR_RENK,
          ton: g.hue_shift ?? 0,
          doygunluk: g.saturation ?? 1,
          parlaklik: g.brightness ?? 0,
          kontrast: g.contrast ?? 1,
          boya: g.tint_color ? hexCoz(g.tint_color) : null,
          boya_gucu: g.tint_color ? (g.tint_strength ?? 1) : 0,
        };
        this.yeni(await api.dokuRenklendir(id, g.file, secilen.map((d) => d.i), renk));
        return `${secilen.length} doku renklendirildi: ${secilen.map((d) => d.ad).join(", ")}`;
      }
      case "rename_texture": {
        const { d } = await this.dokuBul(g.file, g.texture);
        this.yeni(await api.dokuAdlandir(id, g.file, d.i, g.new_name));
        return `${d.ad} → ${String(g.new_name).toLowerCase()}`;
      }
      case "rename_path":
        this.yeni(await api.yenidenAdlandir(id, g.path, g.new_name));
        return `${g.path} → ${String(g.new_name).toLowerCase()}`;
      case "read_text": {
        const d = await api.dosyaOku(g.package_id ?? id, g.path);
        if (d.metin === null) throw new Error(`${g.path} metin dosyası değil (${d.tur}, ${boyutYaz(d.boyut)})`);
        if (d.metin.length > METIN_SINIRI) throw new Error(`${g.path} çok büyük (${boyutYaz(d.boyut)}); ayar dosyasıysa read_settings ile süzerek oku`);
        return d.metin;
      }
      case "write_text": {
        if (/\.(ymt|ymap|ytyp|ymf)$/i.test(g.path)) {
          const r = await api.metaYaz(id, g.path, g.content);
          this.yeni(r.ozet);
          return `${g.path} ikiliye geri yazıldı${r.uyarilar.length ? ` (${r.uyarilar.length} uyarı: ${r.uyarilar.slice(0, 3).join("; ")})` : ""}.`;
        }
        this.yeni(await api.metinYaz(id, g.path, g.content));
        return `${g.path} yazıldı (${g.content.length} karakter).`;
      }
      case "create_text_file":
        this.yeni(await api.metinOlustur(id, g.path, g.content));
        return `${g.path} oluşturuldu (${String(g.content).length} karakter).`;
      case "map_to_game": {
        const { arsivler, yol } = oyunYoluCoz(g.game_path);
        if (!yol) throw new Error("game_path boş");
        this.yeni(await api.hedefEkle(id, g.source, arsivler, yol));
        return `${g.source} → ${g.game_path} eşlendi.`;
      }
      case "list_open_packages": {
        const v = await api.acikBelgeler();
        return v.map((b) => `${b.id} | ${b.ad} | ${b.paket ?? "-"}${b.id === id ? " (bu paket)" : ""}`).join("\n") || "açık paket yok";
      }
      case "list_package_files": {
        const o = await api.ozet(g.package_id);
        return tumDugumler(o.agac)
          .map((d) => `${d.yol} | ${d.tur}${d.tur === "dosya" ? ` | ${boyutYaz(d.boyut)}` : ""}`)
          .join("\n");
      }
      case "copy_from_package":
        if (g.package_id === id) throw new Error("kaynak ve hedef aynı paket");
        this.yeni(await api.belgelerArasiKopyala(g.package_id, g.path, id, g.to_path));
        return `${g.path} → ${g.to_path} kopyalandı.`;
      case "delete_textures": {
        this.yeni(await api.ytdIslem(id, g.file, (g.textures as string[]).map((ad) => ({ tur: "sil" as const, ad }))));
        return `${g.textures.length} doku silindi: ${g.textures.join(", ")}`;
      }
      case "resize_texture":
        this.yeni(await api.ytdIslem(id, g.file, [{ tur: "olcekle", ad: g.texture, boyut: [g.width, g.height] }]));
        return `${g.texture} ${g.width}x${g.height} yapıldı.`;
      case "get_map_layout": {
        const h = await api.haritaDuzeni(id);
        if (!h.karolar.length) return "Bu pakette ESC/radar harita karosu yok.";
        const d = h.duzen;
        const [x0, y1] = d.baslangic;
        const x1 = x0 + d.sutun * d.karo[0];
        const y0 = y1 - d.satir * d.karo[1];
        return [
          `${h.karolar.length} karo (${[...new Set(h.karolar.map((k) => k.varyant))].join(", ")}), ${d.sutun}x${d.satir} düzen, karo ${d.karo[0]} birim.`,
          `Oyun koordinatı aralığı: X ${x0}..${x1}, Y ${y0}..${y1}.`,
          "Bilinen yerler: Legion Meydanı ~(195,-935), Havalimanı ~(-1037,-2737), Sandy Shores ~(1850,3700), Paleto Bay ~(-150,6400), Vinewood tabelası ~(711,1198).",
        ].join("\n");
      }
      case "map_add_text": {
        const { bayt, w, h } = await yaziCiz({
          metin: String(g.text),
          font: g.font ?? "Bahnschrift",
          kalin: true,
          renk: g.color ?? "#ffffff",
          kontur: g.outline ?? 10,
          konturRenk: g.outline_color ?? "#000000",
        });
        const gorsel = await api.geciciGorselKaydet(bayt);
        const genislik = g.width ?? 1000;
        const r = await api.haritaIsle(
          id,
          [{ gorsel, merkez: [g.x, g.y], boyut: [genislik, (genislik * h) / w], donus: g.rotation ?? 0, opaklik: g.opacity ?? 1, karisim: "normal" }],
          ["sea", "minimap"],
        );
        this.yeni(r.ozet);
        return `"${g.text}" (${g.x}, ${g.y}) konumuna ${r.karo} karoya işlendi.`;
      }
      case "map_recolor": {
        const h = await api.haritaDuzeni(id);
        if (!h.karolar.length) throw new Error("Bu pakette harita karosu yok.");
        const renk: RenkAyari = {
          ...NOTR_RENK,
          ton: g.hue_shift ?? 0,
          doygunluk: g.saturation ?? 1,
          parlaklik: g.brightness ?? 0,
          kontrast: g.contrast ?? 1,
          boya: g.tint_color ? hexCoz(g.tint_color) : null,
          boya_gucu: g.tint_color ? (g.tint_strength ?? 0.6) : 0,
        };
        const gruplar = new Map<string, number[]>();
        for (const k of h.karolar) gruplar.set(k.ytd, [...(gruplar.get(k.ytd) ?? []), k.i]);
        for (const [ytd, ind] of gruplar) this.yeni(await api.dokuRenklendir(id, ytd, ind, renk));
        return `${gruplar.size} harita doku dosyası renklendirildi.`;
      }
      case "list_effects": {
        const eslesen = yptSuz(await api.yptAyarlari(id, g.file), g.query ?? "", g.kind);
        const ozet = (d: number[]) => d.map((x) => Number(x.toFixed(3))).join(",");
        return [
          `${eslesen.length} eşleşme${eslesen.length > 40 ? " (ilk 40)" : ""}:`,
          ...eslesen.slice(0, 40).map(
            (x) =>
              `${x.ad} [${x.tur}${x.davranis ? ` ${x.davranis}` : ""}] ` +
              x.ozellikler.map((o) => `${o.ad.split(":").pop()}=${o.kareler.map((k) => `t${k.zaman[0].toFixed(2)}(${ozet(k.deger)})`).join(" ")}`).join("; "),
          ),
        ].join("\n");
      }
      case "edit_effects": {
        const gruplar = yptSuz(await api.yptAyarlari(id, g.file), g.query ?? "", g.kind);
        const bekleyen = new Map<number, Deger>();
        const n = topluDegistir(
          gruplar,
          { ton: g.hue_shift, boya: g.paint_color, guc: g.paint_strength ?? 1, boyut: g.size_mul, isik: g.light_mul, dogma: g.density_mul },
          bekleyen,
        );
        if (!n) return `"${g.query}" ile ${gruplar.length} kural eşleşti ama bu değişikliğe uyan değer yok.`;
        this.yeni(await api.yptYaz(id, g.file, [...bekleyen].map(([o, d]) => [o, d] as [number, number[]])));
        return `${gruplar.length} kuralda ${n} değer değişti.`;
      }
      case "list_gfx_images": {
        const b = await api.gfxBilgi(id, g.file);
        return [
          `Gömülü görseller (${b.gorseller.length}): ${b.gorseller.map((x) => `#${x.karakter} ${x.genislik}x${x.yukseklik}`).join(", ") || "yok"}`,
          `Oyunun dokularından: ${b.dis.map((x) => `${x.ad}${x.bulunan ? ` (pakette: ${x.bulunan[0]})` : ""}`).join(", ") || "yok"}`,
        ].join("\n");
      }
      case "get_package": {
        const p = this.ozet.paket;
        if (!p) return this.ozet.paket_hatasi ?? "Pakette assembly.xml yok.";
        const eksik = new Set(this.ozet.eksik_kaynak);
        return [
          `ad: ${p.ad}`,
          `yazar: ${p.yazar}`,
          `sürüm: ${p.surum}`,
          `eşlemeler (${p.hedefler.length}, kaynağı eksik ${eksik.size}):`,
          ...p.hedefler
            .filter((h) => !eksik.has(h.kaynak))
            .map((h) => `content/${h.kaynak} → ${[...h.arsivler, h.yol].join("\\")}`),
        ].join("\n");
      }
    }
    throw new Error(`bilinmeyen araç: ${ad}`);
  }
}

export interface AiOlay {
  tur: "kullanici" | "metin" | "arac" | "hata" | "bilgi";
  metin: string;
}

export interface AjanGirdisi {
  saglayici: AiSaglayici;
  ozet: BelgeOzet;
  guncelle: (x: BelgeOzet) => void;
  gecmis: unknown[];
  istek: string;
  olay: (x: AiOlay) => void;
  sinyal: AbortSignal;
}

export async function ajanCalistir(o: AjanGirdisi): Promise<{ gecmis: unknown[]; degisiklik: number }> {
  if (!o.saglayici.model) throw new Error("Model seçilmedi. Ayarlardan 'Modelleri getir' ile bir model seç.");
  return o.saglayici.tur === "anthropic" ? claudeCalistir(o) : openaiCalistir(o);
}

function acilis(o: AjanGirdisi) {
  return `Açık paket: ${o.ozet.ad} (${o.ozet.paket?.ad ?? "assembly.xml yok"})\n\n${o.istek}`;
}

async function claudeCalistir(o: AjanGirdisi) {
  const s = o.saglayici;
  const istemci = new Anthropic({ apiKey: s.anahtar, dangerouslyAllowBrowser: true });
  const araclar = new Araclar(o.ozet, o.guncelle, s.gorsel, Math.round(butceAl(s) * 3.5 * 0.35));
  const mesajlar: Mesaj[] = [...(o.gecmis as Mesaj[]), { role: "user", content: acilis(o) }];
  const yedekli = YEDEKLI_MODELLER.includes(s.model);
  const eski = ESKI_MODEL.test(s.model);

  for (let tur = 0; tur < 40; tur++) {
    const yanit = await istemci.beta.messages.create(
      {
        model: s.model,
        max_tokens: 16000,
        system: SISTEM,
        tools: ARACLAR,
        messages: mesajlar,
        cache_control: { type: "ephemeral" },
        // Dosya düzenleyen çok adımlı iş: Opus 5.5'in varsayılanı medium, açıkça high istenir.
        ...(eski ? {} : { thinking: { type: "adaptive" as const }, output_config: { effort: "high" as const } }),
        ...(yedekli ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      },
      { signal: o.sinyal },
    );

    for (const b of yanit.content) if (b.type === "text" && b.text.trim()) o.olay({ tur: "metin", metin: b.text.trim() });
    mesajlar.push({ role: "assistant", content: yanit.content });

    if (yanit.stop_reason === "refusal") {
      o.olay({ tur: "hata", metin: `Model bu isteği reddetti${yanit.stop_details?.explanation ? `: ${yanit.stop_details.explanation}` : "."}` });
      break;
    }
    if (yanit.stop_reason === "max_tokens") {
      o.olay({ tur: "hata", metin: "Yanıt uzunluk sınırına takıldı; isteği bölerek tekrar dene." });
      break;
    }
    if (yanit.stop_reason === "pause_turn") continue;
    if (yanit.stop_reason !== "tool_use") break;

    const sonuclar: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const b of yanit.content) {
      if (b.type !== "tool_use") continue;
      const r = await araclar.guvenli(b.name, (b.input ?? {}) as Record<string, any>, o.olay);
      sonuclar.push({ type: "tool_result", tool_use_id: b.id, content: r.icerik, ...(r.hata ? { is_error: true } : {}) });
    }
    mesajlar.push({ role: "user", content: sonuclar });
  }
  return { gecmis: mesajlar as unknown[], degisiklik: araclar.surum };
}

type OaParca = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

interface OaMesaj {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null | OaParca[];
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

function semaSadelestir(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(semaSadelestir);
  if (x && typeof x === "object")
    return Object.fromEntries(
      Object.entries(x)
        .filter(([k]) => k !== "additionalProperties")
        .map(([k, v]) => [k, semaSadelestir(v)]),
    );
  return x;
}

const OA_ARACLAR = ARACLAR.map((a) => ({
  type: "function",
  function: { name: a.name, description: a.description, parameters: semaSadelestir(a.input_schema) },
}));

const TEMEL_ARACLAR = ["list_files", "read_settings", "set_settings", "list_textures", "view_texture", "recolor_textures", "read_text", "write_text", "get_package"];
const ARAC_GRUPLARI: [RegExp, string[]][] = [
  [/harita|map|minimap|esc|radar|yaz[ıi]|logo|koordinat/i, ["get_map_layout", "map_add_text", "map_recolor"]],
  [/yeni mod|s[ıi]f[ıi]rdan|paket|kopyala|olu[şs]tur|e[şs]le|assembly/i, ["create_text_file", "map_to_game", "list_open_packages", "list_package_files", "copy_from_package"]],
  [/sil|boyut|[çc][öo]z[üu]n[üu]rl[üu]k|ad[ıi]n[ıi]|adland[ıi]r|isim/i, ["delete_textures", "resize_texture", "rename_texture", "rename_path"]],
  [/efekt|ypt|par[çc]ac[ıi]k|kan|blood|duman|smoke|ate[şs]|fire|namlu|muz|k[ıi]v[ıi]lc[ıi]m|spark|patlama|explo|[ıi][şs][ıi]k|yo[ğg]unluk/i, ["list_effects", "edit_effects"]],
  [/gfx|aray[üu]z|hud|scaleform|radar|blip/i, ["list_gfx_images"]],
];

/** Küçük bütçeli sağlayıcılarda yalnız isteğe uyan araçlar gönderilir; tanımlar tek başına ~3K token tutuyor. */
function araclarSec(istek: string, butce: number) {
  if (butce >= 10000) return OA_ARACLAR;
  const adlar = new Set(TEMEL_ARACLAR);
  for (const [kalip, grup] of ARAC_GRUPLARI) if (kalip.test(istek)) grup.forEach((a) => adlar.add(a));
  return OA_ARACLAR.filter((a) => adlar.has(a.function.name));
}

function durdur(sinyal: AbortSignal) {
  if (sinyal.aborted) throw new DOMException("durduruldu", "AbortError");
}

/** Geçmiş bütçeyi aşarsa en eski araç sonuçlarını, yetmezse en eski turları kırpar. */
/** Geçmiş bütçeyi aşarsa önce eski araç sonuçlarını kısaltır, yetmezse `istek`ten önceki en eski turları atar. */
function gecmisiKirp(mesajlar: OaMesaj[], butceToken: number, istek: OaMesaj, aracToken: number) {
  const boyut = () => tokenTahmini(JSON.stringify(mesajlar)) + aracToken;
  for (const m of mesajlar) {
    if (boyut() <= butceToken) return;
    if (m.role === "tool" && typeof m.content === "string" && m.content.length > 120) m.content = "[eski araç sonucu yer açmak için kısaltıldı]";
  }
  while (boyut() > butceToken) {
    const sinir = mesajlar.indexOf(istek);
    if (sinir <= 1) break;
    // sistemden sonraki ilk turu, araç çağrıları sonuçlarından ayrılmasın diye bir sonraki kullanıcı mesajına kadar at
    let son = 2;
    while (son < sinir && mesajlar[son].role !== "user") son++;
    mesajlar.splice(1, son - 1);
  }
}

const bekle = (ms: number, sinyal: AbortSignal) =>
  new Promise<void>((coz, reddet) => {
    const t = setTimeout(coz, ms);
    sinyal.addEventListener("abort", () => (clearTimeout(t), reddet(new DOMException("durduruldu", "AbortError"))), { once: true });
  });

async function openaiCalistir(o: AjanGirdisi) {
  const s = o.saglayici;
  const butce = butceAl(s);
  const araclar = new Araclar(o.ozet, o.guncelle, s.gorsel, Math.max(1500, Math.round(butce * 3.5 * 0.3)));
  const gecmis = o.gecmis as OaMesaj[];
  const istekMesaji: OaMesaj = { role: "user", content: acilis(o) };
  const mesajlar: OaMesaj[] = [
    ...(gecmis.length ? gecmis : [{ role: "system" as const, content: SISTEM }]),
    istekMesaji,
  ];
  const url = `${adresDuzelt(s.adres)}/chat/completions`;
  const gonderilenAraclar = araclarSec(o.istek, butce);
  const aracToken = tokenTahmini(JSON.stringify(gonderilenAraclar));
  let hedefButce = butce;
  let aracDuzeltme = 0;
  let sinirDenemesi = 0;

  for (let tur = 0; tur < 40; tur++) {
    durdur(o.sinyal);
    gecmisiKirp(mesajlar, hedefButce, istekMesaji, aracToken);
    const r = await api.aiHttp("POST", url, openaiBasliklari(s), JSON.stringify({ model: s.model, messages: mesajlar, tools: gonderilenAraclar }));
    durdur(o.sinyal);

    if (r.durum === 429 || r.durum === 413) {
      const mesaj = hataMesaji(r.govde);
      const buyuk = r.durum === 413 || /too large|tokens per minute|TPM|context/i.test(mesaj);
      if (++sinirDenemesi > 4) throw new Error(`${s.ad} hız/boyut sınırı aşıldı: ${mesaj}`);
      if (buyuk) hedefButce = Math.max(2500, Math.round(hedefButce * 0.7));
      const sn = Math.min(60, Math.max(2, r.bekle ?? (buyuk ? 8 : 12)));
      o.olay({ tur: "bilgi", metin: `${s.ad} sınırına takıldı${buyuk ? ", istek küçültülüyor" : ""}; ${Math.ceil(sn)} sn bekleniyor…` });
      await bekle(sn * 1000, o.sinyal);
      tur--;
      continue;
    }
    if (r.durum === 400 && /tool_use_failed|failed_generation|function/i.test(r.govde) && aracDuzeltme < 2) {
      aracDuzeltme++;
      o.olay({ tur: "bilgi", metin: "Model araç çağrısını bozuk yazdı, tekrar deneniyor…" });
      mesajlar.push({ role: "user", content: "Önceki araç çağrın geçersizdi. Araçları yalnız şemaya uygun JSON argümanlarla çağır; metnin içine fonksiyon yazma." });
      continue;
    }
    if (r.durum === 401 || r.durum === 403) throw new Error(`${s.ad}: API anahtarı geçersiz ya da yetkisiz (${r.durum}). Ayarlardan kontrol et.`);
    if (r.durum === 404) throw new Error(`${s.ad}: model ya da adres bulunamadı (${hataMesaji(r.govde)}). Ayarlardan modeli değiştir.`);
    if (r.durum >= 400) throw new Error(`${s.ad} hatası ${r.durum}: ${hataMesaji(r.govde)}`);

    sinirDenemesi = 0;
    const secim = JSON.parse(r.govde).choices?.[0];
    if (!secim) throw new Error(`${s.ad} boş yanıt döndü: ${hataMesaji(r.govde)}`);
    const m = secim.message as OaMesaj;
    const metin = typeof m.content === "string" ? m.content.trim() : "";
    if (metin) o.olay({ tur: "metin", metin });
    mesajlar.push({ role: "assistant", content: m.content ?? "", ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}) });

    if (!m.tool_calls?.length) {
      if (secim.finish_reason === "length") o.olay({ tur: "hata", metin: "Yanıt uzunluk sınırına takıldı; isteği bölerek tekrar dene." });
      break;
    }

    const gorseller: string[] = [];
    for (const c of m.tool_calls) {
      let g: Record<string, any>;
      try {
        g = JSON.parse(c.function.arguments || "{}");
      } catch {
        mesajlar.push({ role: "tool", tool_call_id: c.id, content: "Araç girdisi geçerli JSON değil; tekrar dene." });
        continue;
      }
      const r = await araclar.guvenli(c.function.name, g, o.olay);
      const parcalar = typeof r.icerik === "string" ? [{ type: "text" as const, text: r.icerik }] : (r.icerik ?? []);
      const yazi: string[] = [];
      for (const p of parcalar) {
        if (p.type === "text") yazi.push(p.text);
        else if (p.type === "image" && p.source.type === "base64") gorseller.push(`data:${p.source.media_type};base64,${p.source.data}`);
      }
      mesajlar.push({ role: "tool", tool_call_id: c.id, content: (r.hata ? "HATA: " : "") + (yazi.join("\n") || "tamam") });
    }
    if (gorseller.length)
      mesajlar.push({
        role: "user",
        content: [{ type: "text", text: "view_texture görüntüleri:" }, ...gorseller.map((url) => ({ type: "image_url" as const, image_url: { url } }))],
      });
  }
  // görseller geçmişte tutulmaz; sonraki isteklerde bütçeyi yemesinler
  for (const m of mesajlar)
    if (Array.isArray(m.content)) m.content = m.content.map((p) => (p.type === "image_url" ? { type: "text" as const, text: "[görsel]" } : p));
  return { gecmis: mesajlar as unknown[], degisiklik: araclar.surum };
}

function aracOzeti(ad: string, g: Record<string, any>) {
  const dosya = (y?: string) => (y ? y.split("/").pop() : "");
  switch (ad) {
    case "list_files":
      return "Dosyalara baktı";
    case "read_settings":
      return `${dosya(g.file)} okundu${g.filter ? ` (${g.filter})` : ""}`;
    case "set_settings":
      return `${dosya(g.file)}: ${g.changes?.length ?? 0} ayar değişti`;
    case "list_textures":
      return `${dosya(g.file)} dokuları listelendi`;
    case "view_texture":
      return `${g.texture} dokusuna baktı`;
    case "recolor_textures":
      return `${dosya(g.file)}: ${g.textures?.join(", ")} renklendirildi${g.tint_color ? ` (${g.tint_color})` : ""}`;
    case "rename_texture":
      return `Doku adı: ${g.texture} → ${g.new_name}`;
    case "rename_path":
      return `Ad: ${g.path} → ${g.new_name}`;
    case "read_text":
      return `${dosya(g.path)} okundu`;
    case "write_text":
      return `${dosya(g.path)} yazıldı`;
    case "get_package":
      return "Paket bilgisine baktı";
    case "delete_textures":
      return `Doku silindi: ${g.textures?.join(", ")}`;
    case "resize_texture":
      return `${g.texture} → ${g.width}x${g.height}`;
    case "get_map_layout":
      return "Harita düzenine baktı";
    case "map_add_text":
      return `Haritaya yazı: "${g.text}" (${g.x}, ${g.y})`;
    case "map_recolor":
      return "Harita renklendirildi";
    case "create_text_file":
      return `${g.path} oluşturuldu`;
    case "map_to_game":
      return `Eşleme: ${g.source} → ${g.game_path}`;
    case "list_open_packages":
      return "Açık paketlere baktı";
    case "list_package_files":
      return `${g.package_id} numaralı paketin dosyalarına baktı`;
    case "copy_from_package":
      return `Kopyalandı: ${g.path} → ${g.to_path}`;
    case "list_effects":
      return `${dosya(g.file)} efektleri arandı${g.query ? ` (${g.query})` : ""}`;
    case "edit_effects":
      return `${dosya(g.file)}: "${g.query}" efektleri düzenlendi`;
    case "list_gfx_images":
      return `${dosya(g.file)} görsellerine baktı`;
  }
  return ad;
}

export function hataAciklama(e: unknown) {
  if (e instanceof Anthropic.AuthenticationError) return "API anahtarı geçersiz. Ayarlardan kontrol et.";
  if (e instanceof Anthropic.PermissionDeniedError) return "Bu anahtarın bu modele erişimi yok.";
  if (e instanceof Anthropic.RateLimitError) return "Hız sınırına takıldı, biraz bekleyip tekrar dene.";
  if (e instanceof Anthropic.NotFoundError) return "Model bulunamadı; ayarlardan başka model seç.";
  if (e instanceof Anthropic.BadRequestError) return `İstek reddedildi: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return "Anthropic API'ye bağlanılamadı (internet?).";
  if (e instanceof Anthropic.APIError) return `API hatası ${e.status}: ${e.message}`;
  if (typeof e === "string") return e;
  return e instanceof Error ? e.message : String(e);
}

export function durdurulduMu(e: unknown) {
  return e instanceof Anthropic.APIUserAbortError || (e instanceof DOMException && e.name === "AbortError");
}
