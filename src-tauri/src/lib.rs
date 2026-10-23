mod export_path;
mod kasa;

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use tauri::http::{Response, Uri};
use tauri::{AppHandle, Emitter, Manager, State};
use fltr_rpf_core::doku::{self, RenkAyari, Sigdirma};
use fltr_rpf_core::oiv::{self, Hedef, Paket};
use fltr_rpf_core::rpf::{self, Arsiv, Dizin, Dosya, Dugum, IcArsiv};
use fltr_rpf_core::harita;
use fltr_rpf_core::model;
use fltr_rpf_core::ytd::{self, Ytd};
use fltr_rpf_core::{gfx, modlar, rsc, vs, ypt};

type Cevap<T> = Result<T, String>;

fn m(e: impl std::fmt::Display) -> String {
    e.to_string()
}

const GECMIS_SINIRI: usize = 60;
const YEDEK_SAYISI: usize = 20;
const YTD_ONBELLEK_SINIRI: usize = 384 << 20;

struct Belge {
    yol: Option<PathBuf>,
    arsiv: Arsiv,
    geri: Vec<(u64, Arsiv)>,
    ileri: Vec<(u64, Arsiv)>,
    /// Arşivin şu anki hâlinin kimliği; geri al/yinele eski kimliği geri getirir.
    durum_no: u64,
    /// diskteki hâline denk düşen durum; yeni (hiç kaydedilmemiş) belgede yok
    temiz_no: Option<u64>,
    disk_boyutu: u64,
    /// ytd'ler ve modellerin (ydr/ydd/yft) gömülü doku sözlükleri, küçük harf yola göre
    ytdler: HashMap<String, Arc<Ytd>>,
    doku_dizini: Option<Arc<HashMap<String, (String, usize)>>>,
    /// Her değişiklikte artar; kilit dışında hazırlanan önbellek girdisi eski nesle aitse atılır.
    nesil: u64,
}

fn yeni_durum_no() -> u64 {
    static SAYAC: AtomicU64 = AtomicU64::new(0);
    SAYAC.fetch_add(1, Ordering::Relaxed) + 1
}

impl Belge {
    fn yeni(yol: Option<PathBuf>, arsiv: Arsiv, kirli: bool, disk_boyutu: u64) -> Belge {
        let durum_no = yeni_durum_no();
        Belge {
            yol,
            arsiv,
            geri: Vec::new(),
            ileri: Vec::new(),
            durum_no,
            temiz_no: (!kirli).then_some(durum_no),
            disk_boyutu,
            ytdler: HashMap::new(),
            doku_dizini: None,
            nesil: 0,
        }
    }

    /// Değişiklikten hemen önce çağrılır: anlık görüntüyü geri yığınına atar.
    fn degisiklik(&mut self) {
        self.geri.push((self.durum_no, self.arsiv.clone()));
        if self.geri.len() > GECMIS_SINIRI {
            self.geri.remove(0);
        }
        self.durum_no = yeni_durum_no();
        self.ileri.clear();
        self.onbellegi_bosalt();
    }

    /// Geri alınarak diske yazılmış hâle dönülmüşse belge temiz sayılır.
    fn kirli(&self) -> bool {
        self.temiz_no != Some(self.durum_no)
    }

    fn onbellegi_bosalt(&mut self) {
        self.ytdler.clear();
        self.doku_dizini = None;
        self.nesil += 1;
    }
}

/// Ağır açma işleri kilidin dışında yapılır: kilit yalnız dosyayı (Arc paylaşımlı, ucuz) kopyalamak
/// ve sonucu önbelleğe koymak için tutulur, böylece paralel doku/model istekleri birbirini beklemez.
fn dosya_kopyasi(kap: &Mutex<Belge>, yol: &str) -> Cevap<(Dosya, u64)> {
    let b = kilitle(kap);
    Ok((b.arsiv.dosya(yol).map_err(m)?.clone(), b.nesil))
}

fn model_uzantisi(yol: &str) -> Option<&'static str> {
    let uz = yol.rsplit('.').next()?.to_ascii_lowercase();
    ["ydr", "ydd", "yft"].into_iter().find(|&u| u == uz)
}

/// İçine gömülü doku sözlüğü taşıyan kaynaklar: modeller ve parçacık sözlüğü (ypt).
fn gomulu_dokulu(yol: &str) -> Option<&'static str> {
    model_uzantisi(yol).or_else(|| yol.to_ascii_lowercase().ends_with(".ypt").then_some("ypt"))
}

/// Yol bir ytd ise sözlüğün kendisi, model ise içine gömülü dokular.
fn ytd_al(kap: &Mutex<Belge>, yol: &str) -> Cevap<Arc<Ytd>> {
    let anahtar = yol.to_lowercase();
    if let Some(y) = kilitle(kap).ytdler.get(&anahtar) {
        return Ok(y.clone());
    }
    let (dosya, nesil) = dosya_kopyasi(kap, yol)?;
    let veri = dosya.veri().map_err(m)?;
    let y = Arc::new(match gomulu_dokulu(yol) {
        Some(uz) => Ytd::modelden(&veri, uz),
        None => Ytd::coz(&veri),
    }
    .map_err(m)?);
    let mut b = kilitle(kap);
    if b.nesil == nesil {
        let dolu: usize = b.ytdler.values().map(|y| y.kaynak.veri.len()).sum();
        if dolu + y.kaynak.veri.len() > YTD_ONBELLEK_SINIRI {
            b.ytdler.clear();
        }
        return Ok(b.ytdler.entry(anahtar).or_insert(y).clone());
    }
    Ok(y)
}

/// Arşivdeki bütün ytd'lerin doku adı → (ytd yolu, sıra) dizini; yalnız sistem bölümleri açılır.
fn doku_dizini_al(kap: &Mutex<Belge>) -> Arc<HashMap<String, (String, usize)>> {
    let (ytdler, nesil) = {
        let b = kilitle(kap);
        if let Some(d) = &b.doku_dizini {
            return d.clone();
        }
        let mut v = Vec::new();
        b.arsiv.gez(|yol, d| {
            if let Dugum::Dosya(f) = d
                && yol.to_lowercase().ends_with(".ytd")
            {
                v.push((yol.to_string(), f.clone()));
            }
        });
        (v, b.nesil)
    };
    let mut dizin = HashMap::new();
    for (yol, f) in ytdler {
        let Ok(v) = f.veri() else { continue };
        for (i, ad) in ytd::doku_adlari(&v).unwrap_or_default().into_iter().enumerate() {
            dizin.entry(ad).or_insert_with(|| (yol.clone(), i));
        }
    }
    let d = Arc::new(dizin);
    let mut b = kilitle(kap);
    if b.nesil == nesil {
        b.doku_dizini = Some(d.clone());
    }
    d
}

#[derive(Default)]
struct Durum {
    belgeler: Mutex<HashMap<u32, Arc<Mutex<Belge>>>>,
    sayac: AtomicU32,
}

impl Durum {
    fn belge(&self, id: u32) -> Cevap<Arc<Mutex<Belge>>> {
        self.belgeler.lock().unwrap().get(&id).cloned().ok_or_else(|| "belge kapalı".to_string())
    }

    fn ekle(&self, b: Belge) -> u32 {
        let id = self.sayac.fetch_add(1, Ordering::Relaxed) + 1;
        self.belgeler.lock().unwrap().insert(id, Arc::new(Mutex::new(b)));
        id
    }
}

fn kilitle(b: &Mutex<Belge>) -> MutexGuard<'_, Belge> {
    b.lock().unwrap_or_else(|z| z.into_inner())
}

#[derive(Serialize)]
struct DugumBilgi {
    ad: String,
    yol: String,
    tur: &'static str,
    boyut: u64,
    kayitli: u64,
    degisti: bool,
    rsc: bool,
    cocuklar: Vec<DugumBilgi>,
}

fn agac_kur(d: &Dizin, onek: &str) -> Vec<DugumBilgi> {
    let mut v: Vec<DugumBilgi> = d
        .cocuklar
        .iter()
        .map(|c| {
            let yol = if onek.is_empty() { c.ad().to_string() } else { format!("{onek}/{}", c.ad()) };
            match c {
                Dugum::Dizin(alt) => dizin_bilgisi(c.ad(), yol.clone(), "dizin", agac_kur(alt, &yol)),
                Dugum::Arsiv(a) => dizin_bilgisi(c.ad(), yol.clone(), "arsiv", agac_kur(&a.arsiv.kok, &yol)),
                Dugum::Dosya(f) => DugumBilgi {
                    ad: f.ad.clone(),
                    yol,
                    tur: "dosya",
                    boyut: f.boyut() as u64,
                    kayitli: f.kayitli_boyut() as u64,
                    degisti: f.degisti(),
                    rsc: f.kaynak_mi(),
                    cocuklar: Vec::new(),
                },
            }
        })
        .collect();
    v.sort_by(|a, b| (a.tur == "dosya").cmp(&(b.tur == "dosya")).then_with(|| a.ad.cmp(&b.ad)));
    v
}

fn dizin_bilgisi(ad: &str, yol: String, tur: &'static str, cocuklar: Vec<DugumBilgi>) -> DugumBilgi {
    DugumBilgi {
        ad: ad.to_string(),
        yol,
        tur,
        boyut: cocuklar.iter().map(|c| c.boyut).sum(),
        kayitli: cocuklar.iter().map(|c| c.kayitli).sum(),
        degisti: cocuklar.iter().any(|c| c.degisti),
        rsc: false,
        cocuklar,
    }
}

fn tahmini_boyut(d: &Dizin) -> u64 {
    let hizala = |n: u64| n.div_ceil(512) * 512;
    let mut toplam = 0;
    let mut adet = 1u64;
    for c in &d.cocuklar {
        adet += 1;
        toplam += match c {
            Dugum::Dizin(alt) => tahmini_boyut(alt),
            Dugum::Arsiv(a) => hizala(tahmini_boyut(&a.arsiv.kok)),
            Dugum::Dosya(f) => hizala(f.kayitli_boyut() as u64),
        };
    }
    toplam + hizala(adet * 40)
}

#[derive(Serialize)]
struct BelgeOzet {
    id: u32,
    yol: Option<String>,
    ad: String,
    sifreleme: String,
    disk_boyutu: u64,
    tahmini_boyut: u64,
    kirli: bool,
    geri: usize,
    ileri: usize,
    durum_no: u64,
    paket: Option<Paket>,
    paket_hatasi: Option<String>,
    eksik_kaynak: Vec<String>,
    agac: Vec<DugumBilgi>,
}

fn paket_oku(a: &Arsiv) -> Option<Result<Paket, String>> {
    let f = a.dosya("assembly.xml").ok()?;
    Some(f.veri().map_err(m).and_then(|v| oiv::coz(&String::from_utf8_lossy(&v)).map_err(m)))
}

fn ozet(id: u32, b: &Belge) -> BelgeOzet {
    let (paket, paket_hatasi) = match paket_oku(&b.arsiv) {
        Some(Ok(p)) => (Some(p), None),
        Some(Err(e)) => (None, Some(e)),
        None => (None, None),
    };
    let eksik_kaynak = paket
        .iter()
        .flat_map(|p| &p.hedefler)
        .filter(|h| !h.sil && !matches!(b.arsiv.bul(&format!("content/{}", h.kaynak)), Some(Dugum::Dosya(_) | Dugum::Arsiv(_))))
        .map(|h| h.kaynak.clone())
        .collect();
    BelgeOzet {
        id,
        yol: b.yol.as_ref().map(|p| p.to_string_lossy().into_owned()),
        ad: b.yol.as_ref().and_then(|p| p.file_name()).map_or("yeni-mod.rpf".into(), |n| n.to_string_lossy().into_owned()),
        sifreleme: rpf::sifreleme_adi(b.arsiv.sifreleme).to_string(),
        disk_boyutu: b.disk_boyutu,
        tahmini_boyut: tahmini_boyut(&b.arsiv.kok),
        kirli: b.kirli(),
        geri: b.geri.len(),
        ileri: b.ileri.len(),
        durum_no: b.durum_no,
        paket,
        paket_hatasi,
        eksik_kaynak,
        agac: agac_kur(&b.arsiv.kok, ""),
    }
}

fn degistir<T>(durum: &Durum, id: u32, f: impl FnOnce(&mut Belge) -> Cevap<T>) -> Cevap<BelgeOzet> {
    let kap = durum.belge(id)?;
    let mut b = kilitle(&kap);
    // Başarısız işlem yinele geçmişini de götürmesin.
    let ileri = std::mem::take(&mut b.ileri);
    b.degisiklik();
    if let Err(e) = f(&mut b) {
        if let Some((no, onceki)) = b.geri.pop() {
            b.arsiv = onceki;
            b.durum_no = no;
        }
        b.ileri = ileri;
        return Err(e);
    }
    Ok(ozet(id, &b))
}

/// İki yol aynı dosyayı mı gösteriyor; Windows'ta büyük/küçük harf ve eğik çizgi farkı önemsiz.
fn ayni_yol(a: &Path, b: &Path) -> bool {
    let duz = |p: &Path| {
        let tam = fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
        tam.to_string_lossy().replace('/', "\\").to_lowercase()
    };
    duz(a) == duz(b)
}

fn yedek_klasoru(app: &AppHandle) -> Cevap<PathBuf> {
    Ok(app.path().app_data_dir().map_err(m)?.join("yedek"))
}

#[tauri::command]
async fn cakisma_incele(klasor: String, hedef: String, modlar: Vec<String>) -> Cevap<modlar::CakismaAyrintisi> {
    if modlar.iter().any(|d| d.contains(['/', '\\']) || d.contains("..")) {
        return Err("geçersiz mod adı".into());
    }
    Ok(modlar::cakisma_incele(Path::new(&klasor), &hedef, &modlar))
}

#[tauri::command]
fn mods_tara(klasor: Option<String>) -> Cevap<serde_json::Value> {
    let k = match klasor {
        Some(k) if !k.is_empty() => PathBuf::from(k),
        _ => modlar::varsayilan_klasor().ok_or("LOCALAPPDATA bulunamadı")?,
    };
    let bulundu = k.is_dir();
    let rapor = modlar::tara(&k);
    let mut v = serde_json::to_value(rapor).map_err(m)?;
    v["bulundu"] = bulundu.into();
    Ok(v)
}

#[tauri::command]
fn mod_ac_kapa(klasor: String, dosya: String, acik: bool) -> Cevap<()> {
    modlar::ac_kapa(Path::new(&klasor), &dosya, acik).map_err(m)
}

#[tauri::command]
async fn arsiv_ac(durum: State<'_, Durum>, yol: String) -> Cevap<BelgeOzet> {
    {
        let belgeler = durum.belgeler.lock().unwrap();
        for (&id, kap) in belgeler.iter() {
            let b = kilitle(kap);
            if b.yol.as_deref().is_some_and(|y| ayni_yol(y, Path::new(&yol))) {
                return Ok(ozet(id, &b));
            }
        }
    }
    let veri = fs::read(&yol).map_err(|e| format!("{yol}: {e}"))?;
    let disk_boyutu = veri.len() as u64;
    let arsiv = Arsiv::oku(Arc::from(veri)).map_err(m)?;
    let id = durum.ekle(Belge::yeni(Some(PathBuf::from(&yol)), arsiv, false, disk_boyutu));
    let kap = durum.belge(id)?;
    let b = kilitle(&kap);
    Ok(ozet(id, &b))
}

#[tauri::command]
fn yeni_mod(durum: State<'_, Durum>, ad: String, yazar: String) -> Cevap<BelgeOzet> {
    let mut arsiv = Arsiv::yeni();
    let paket = Paket { ad, yazar, surum: "1.0".into(), ..Default::default() };
    arsiv.koy("", Dugum::Dosya(Dosya::yeni("assembly.xml", oiv::uret(&paket).into_bytes()))).map_err(m)?;
    arsiv.dizin_olustur("content").map_err(m)?;
    let id = durum.ekle(Belge::yeni(None, arsiv, true, 0));
    let kap = durum.belge(id)?;
    let b = kilitle(&kap);
    Ok(ozet(id, &b))
}

#[tauri::command]
fn belge_ozet(durum: State<'_, Durum>, id: u32) -> Cevap<BelgeOzet> {
    let kap = durum.belge(id)?;
    let b = kilitle(&kap);
    Ok(ozet(id, &b))
}

#[tauri::command]
fn belge_kapat(durum: State<'_, Durum>, id: u32) {
    durum.belgeler.lock().unwrap().remove(&id);
}

#[tauri::command]
fn geri_al(durum: State<'_, Durum>, id: u32) -> Cevap<BelgeOzet> {
    let kap = durum.belge(id)?;
    let mut b = kilitle(&kap);
    if let Some((no, onceki)) = b.geri.pop() {
        let simdiki = std::mem::replace(&mut b.arsiv, onceki);
        let simdiki_no = std::mem::replace(&mut b.durum_no, no);
        b.ileri.push((simdiki_no, simdiki));
        b.onbellegi_bosalt();
    }
    Ok(ozet(id, &b))
}

#[tauri::command]
fn yinele(durum: State<'_, Durum>, id: u32) -> Cevap<BelgeOzet> {
    let kap = durum.belge(id)?;
    let mut b = kilitle(&kap);
    if let Some((no, sonraki)) = b.ileri.pop() {
        let simdiki = std::mem::replace(&mut b.arsiv, sonraki);
        let simdiki_no = std::mem::replace(&mut b.durum_no, no);
        b.geri.push((simdiki_no, simdiki));
        b.onbellegi_bosalt();
    }
    Ok(ozet(id, &b))
}

#[derive(Serialize)]
struct KayitSonucu {
    ozet: BelgeOzet,
    eski_boyut: u64,
    yeni_boyut: u64,
    yedek: Option<String>,
}

#[tauri::command]
async fn kaydet(app: AppHandle, durum: State<'_, Durum>, id: u32, hedef: Option<String>) -> Cevap<KayitSonucu> {
    let kap = durum.belge(id)?;
    let hedef = match hedef.map(PathBuf::from).or_else(|| kilitle(&kap).yol.clone()) {
        Some(h) => h,
        None => return Err("kayıt yeri seçilmedi".into()),
    };
    // Farklı kaydet başka bir açık belgenin dosyasına denk gelebilir: kaydedilmemiş işi ezilmesin.
    // Bu belgenin kilidi tutulmadan bakılır; kilit sırası her yerde önce belge listesi, sonra belge.
    acik_belgeyi_tazele(&durum, &hedef, None, Some(id))?;
    let (sonuc, veri) = {
        let mut b = kilitle(&kap);
        let veri: Arc<[u8]> = Arc::from(b.arsiv.yaz().map_err(m)?);
        let yeni = Arsiv::oku(veri.clone()).map_err(|e| format!("yazılan arşiv doğrulanamadı, kaydedilmedi: {e}"))?;
        let yedek = modlar::yedekle(&hedef, &yedek_klasoru(&app)?, YEDEK_SAYISI).map_err(m)?;
        modlar::guvenli_yaz(&hedef, &veri).map_err(m)?;
        let eski_boyut = b.disk_boyutu;
        let yeni_boyut = veri.len() as u64;
        b.arsiv = yeni;
        b.yol = Some(hedef.clone());
        b.disk_boyutu = yeni_boyut;
        b.temiz_no = Some(b.durum_no);
        b.onbellegi_bosalt();
        let sonuc = KayitSonucu {
            ozet: ozet(id, &b),
            eski_boyut,
            yeni_boyut,
            yedek: yedek.map(|p| p.to_string_lossy().into_owned()),
        };
        (sonuc, veri)
    };
    acik_belgeyi_tazele(&durum, &hedef, Some(&veri), Some(id))?;
    Ok(sonuc)
}

/// Diskteki dosyayı açık belgelerle eşitler: kaydedilmemiş değişikliği olan belge varsa işlemi reddeder,
/// yoksa belgeyi yeni içerikle tazeler. `haric`, dosyayı yazan belgenin kendisi.
fn acik_belgeyi_tazele(durum: &Durum, yol: &Path, veri: Option<&[u8]>, haric: Option<u32>) -> Cevap<()> {
    let belgeler = durum.belgeler.lock().unwrap();
    for (&id, kap) in belgeler.iter() {
        if Some(id) == haric {
            continue;
        }
        let mut b = kilitle(kap);
        if b.yol.as_deref().is_some_and(|y| ayni_yol(y, yol)) {
            match veri {
                None if b.kirli() => return Err(format!("{} açık ve kaydedilmemiş değişiklik var; önce kaydet ya da kapat", yol.display())),
                None => {}
                Some(v) => {
                    b.arsiv = Arsiv::oku(Arc::from(v)).map_err(m)?;
                    b.disk_boyutu = v.len() as u64;
                    b.geri.clear();
                    b.ileri.clear();
                    b.durum_no = yeni_durum_no();
                    b.temiz_no = Some(b.durum_no);
                    b.onbellegi_bosalt();
                }
            }
        }
    }
    Ok(())
}

#[derive(Serialize)]
struct SikistirmaSonucu {
    eski: u64,
    yeni: u64,
    yedek: Option<String>,
}

/// Diskteki bir rpf'i açmadan ölü alanından arındırır; önce yedekler, yazdığını doğrular.
#[tauri::command]
async fn mod_sikistir(app: AppHandle, durum: State<'_, Durum>, yol: String) -> Cevap<SikistirmaSonucu> {
    let yol = PathBuf::from(yol);
    acik_belgeyi_tazele(&durum, &yol, None, None)?;
    let veri = fs::read(&yol).map_err(|e| format!("{}: {e}", yol.display()))?;
    let eski = veri.len() as u64;
    let yeni = Arsiv::oku(Arc::from(veri)).map_err(m)?.yaz().map_err(m)?;
    Arsiv::oku(Arc::from(yeni.clone())).map_err(|e| format!("yazılan arşiv doğrulanamadı, dokunulmadı: {e}"))?;
    if yeni.len() as u64 >= eski {
        return Ok(SikistirmaSonucu { eski, yeni: eski, yedek: None });
    }
    let yedek = modlar::yedekle(&yol, &yedek_klasoru(&app)?, YEDEK_SAYISI).map_err(m)?;
    modlar::guvenli_yaz(&yol, &yeni).map_err(m)?;
    acik_belgeyi_tazele(&durum, &yol, Some(&yeni), None)?;
    Ok(SikistirmaSonucu { eski, yeni: yeni.len() as u64, yedek: yedek.map(|p| p.to_string_lossy().into_owned()) })
}

#[tauri::command]
fn yedekleri_listele(app: AppHandle) -> Cevap<Vec<modlar::YedekBilgi>> {
    Ok(modlar::yedekleri_oku(&yedek_klasoru(&app)?))
}

/// Yedeği hedefin üstüne koyar; hedefin o anki hâli de önce yedeklenir, böylece geri yükleme de geri alınabilir.
#[tauri::command]
async fn yedek_geri_yukle(app: AppHandle, durum: State<'_, Durum>, yedek: String, hedef: String) -> Cevap<()> {
    let klasor = yedek_klasoru(&app)?;
    let yedek = PathBuf::from(yedek);
    if yedek.parent() != Some(klasor.as_path()) {
        return Err("yalnız Fltr Fivemleaktr yedek klasöründeki dosyalar geri yüklenebilir".into());
    }
    let hedef = PathBuf::from(hedef);
    acik_belgeyi_tazele(&durum, &hedef, None, None)?;
    let veri = fs::read(&yedek).map_err(m)?;
    Arsiv::oku(Arc::from(veri.clone())).map_err(|e| format!("yedek okunamıyor: {e}"))?;
    modlar::yedekle(&hedef, &klasor, YEDEK_SAYISI).map_err(m)?;
    modlar::guvenli_yaz(&hedef, &veri).map_err(m)?;
    acik_belgeyi_tazele(&durum, &hedef, Some(&veri), None)
}

/// Açık belgeyi mods klasörüne (sıkıştırarak) yazar; aynı adlı mod varsa önce yedeklenir.
/// O mod başka bir sekmede kaydedilmemiş değişiklikle açıksa üzerine yazılmaz.
#[tauri::command]
async fn moda_kur(app: AppHandle, durum: State<'_, Durum>, id: u32, klasor: String) -> Cevap<String> {
    let kap = durum.belge(id)?;
    let (veri, ad, durum_no) = {
        let b = kilitle(&kap);
        let ad = b.yol.as_ref().and_then(|p| p.file_name()).map_or("yeni-mod.rpf".into(), |n| n.to_string_lossy().into_owned());
        (Arc::<[u8]>::from(b.arsiv.yaz().map_err(m)?), ad, b.durum_no)
    };
    let yeni = Arsiv::oku(veri.clone()).map_err(|e| format!("yazılan arşiv doğrulanamadı: {e}"))?;
    let hedef = Path::new(&klasor).join(&ad);
    acik_belgeyi_tazele(&durum, &hedef, None, Some(id))?;
    fs::create_dir_all(&klasor).map_err(m)?;
    modlar::yedekle(&hedef, &yedek_klasoru(&app)?, YEDEK_SAYISI).map_err(m)?;
    modlar::guvenli_yaz(&hedef, &veri).map_err(m)?;
    acik_belgeyi_tazele(&durum, &hedef, Some(&veri), Some(id))?;
    // Belge kurulan dosyanın kendisiyse ve o arada değişmediyse artık diskteki hâliyle aynı.
    let mut b = kilitle(&kap);
    if b.durum_no == durum_no && b.yol.as_deref().is_some_and(|y| ayni_yol(y, &hedef)) {
        b.arsiv = yeni;
        b.disk_boyutu = veri.len() as u64;
        b.temiz_no = Some(durum_no);
        b.onbellegi_bosalt();
    }
    Ok(hedef.to_string_lossy().into_owned())
}

#[derive(Serialize)]
struct AramaSonucu {
    tur: &'static str,
    yol: String,
    /// seçim için ek bilgi: doku sırası ya da ayar anahtarı
    ek: String,
    ayrinti: String,
}

/// Pakette yol, doku adı, visualsettings anahtarı ve metin dosyası içeriğinde arar.
#[tauri::command]
async fn icerikte_ara(durum: State<'_, Durum>, id: u32, sorgu: String) -> Cevap<Vec<AramaSonucu>> {
    const SINIR: usize = 400;
    let q = sorgu.trim().to_lowercase();
    if q.len() < 2 {
        return Ok(Vec::new());
    }
    let kap = durum.belge(id)?;
    let mut sonuc = Vec::new();
    let dosyalar: Vec<(String, Dosya)> = {
        let b = kilitle(&kap);
        let mut v = Vec::new();
        b.arsiv.gez(|yol, d| {
            if yol.to_lowercase().contains(&q) {
                sonuc.push(AramaSonucu { tur: "yol", yol: yol.to_string(), ek: String::new(), ayrinti: String::new() });
            }
            if let Dugum::Dosya(f) = d {
                v.push((yol.to_string(), f.clone()));
            }
        });
        v
    };
    let dizin = doku_dizini_al(&kap);
    let mut dokular: Vec<_> = dizin.iter().filter(|(ad, _)| ad.contains(&q)).collect();
    dokular.sort_by(|a, b| a.0.cmp(b.0));
    for (ad, (ytd, i)) in dokular {
        sonuc.push(AramaSonucu { tur: "doku", yol: ytd.clone(), ek: i.to_string(), ayrinti: ad.clone() });
    }
    for (yol, f) in dosyalar {
        if sonuc.len() >= SINIR {
            break;
        }
        let kucuk = yol.to_lowercase();
        if f.kaynak_mi() || f.boyut() > 4 << 20 {
            continue;
        }
        let Ok(v) = f.veri() else { continue };
        if v.iter().take(8192).any(|&c| c == 0) {
            continue;
        }
        let metin = String::from_utf8_lossy(&v);
        if kucuk.ends_with("visualsettings.dat") {
            for g in vs::Ayarlar::coz(&metin).girdiler().into_iter().filter(|g| g.anahtar.to_lowercase().contains(&q)) {
                sonuc.push(AramaSonucu { tur: "ayar", yol: yol.clone(), ek: g.anahtar.clone(), ayrinti: format!("{} = {}", g.anahtar, g.deger) });
            }
            continue;
        }
        for (n, satir) in metin.lines().enumerate().filter(|(_, l)| l.to_lowercase().contains(&q)).take(5) {
            sonuc.push(AramaSonucu { tur: "metin", yol: yol.clone(), ek: (n + 1).to_string(), ayrinti: satir.trim().chars().take(140).collect() });
        }
    }
    sonuc.truncate(SINIR);
    Ok(sonuc)
}

#[tauri::command]
fn yedekler_klasoru(app: AppHandle) -> Cevap<String> {
    let k = yedek_klasoru(&app)?;
    fs::create_dir_all(&k).map_err(m)?;
    Ok(k.to_string_lossy().into_owned())
}

#[derive(Serialize)]
struct DosyaIcerigi {
    tur: &'static str,
    boyut: usize,
    metin: Option<String>,
    hex: Option<String>,
    rsc_surum: Option<u32>,
}

fn metin_mi(v: &[u8]) -> bool {
    let bas = &v[..v.len().min(16384)];
    !bas.contains(&0) && std::str::from_utf8(v).is_ok()
}

fn hex_dokum(v: &[u8]) -> String {
    let mut s = String::new();
    for (i, satir) in v.chunks(16).take(64).enumerate() {
        s.push_str(&format!("{:08x}  ", i * 16));
        for b in satir {
            s.push_str(&format!("{b:02x} "));
        }
        s.push_str(&"   ".repeat(16 - satir.len()));
        s.push(' ');
        s.extend(satir.iter().map(|&b| if (0x20..0x7f).contains(&b) { b as char } else { '.' }));
        s.push('\n');
    }
    s
}

#[tauri::command]
fn dosya_oku(durum: State<'_, Durum>, id: u32, yol: String) -> Cevap<DosyaIcerigi> {
    let kap = durum.belge(id)?;
    let b = kilitle(&kap);
    let f = b.arsiv.dosya(&yol).map_err(m)?;
    let v = f.veri().map_err(m)?;
    let dusuk = yol.to_lowercase();
    let meta_mi = [".ymap", ".ytyp", ".ymt", ".ymf", ".pso"].iter().any(|u| dusuk.ends_with(u));
    if meta_mi && let Ok(xml) = model::meta_xml(&v) {
        return Ok(DosyaIcerigi { tur: "meta", boyut: v.len(), metin: Some(xml), hex: None, rsc_surum: None });
    }
    if f.kaynak_mi() {
        let surum = u32::from_le_bytes(v.get(4..8).and_then(|x| x.try_into().ok()).unwrap_or([0; 4]));
        let tur = if dusuk.ends_with(".ytd") {
            "ytd"
        } else if [".ydr", ".ydd", ".yft"].iter().any(|u| dusuk.ends_with(u)) {
            "model"
        } else {
            "kaynak"
        };
        return Ok(DosyaIcerigi { tur, boyut: v.len(), metin: None, hex: Some(hex_dokum(&v)), rsc_surum: Some(surum) });
    }
    if metin_mi(&v) {
        let tur = if dusuk.ends_with("visualsettings.dat") { "ayar" } else { "metin" };
        return Ok(DosyaIcerigi {
            tur,
            boyut: v.len(),
            metin: Some(String::from_utf8_lossy(&v).into_owned()),
            hex: None,
            rsc_surum: None,
        });
    }
    Ok(DosyaIcerigi { tur: "ikili", boyut: v.len(), metin: None, hex: Some(hex_dokum(&v)), rsc_surum: None })
}

#[tauri::command]
fn metin_yaz(durum: State<'_, Durum>, id: u32, yol: String, metin: String) -> Cevap<BelgeOzet> {
    degistir(&durum, id, |b| {
        b.arsiv.dosya_mut(&yol).map_err(m)?.degistir(metin.into_bytes());
        Ok(())
    })
}

fn dugum_dosyadan(yol: &Path) -> Cevap<Dugum> {
    let ad = yol.file_name().ok_or("dosya adı yok")?.to_string_lossy().into_owned();
    if yol.is_dir() {
        let mut dizin = Dizin { ad: rpf::ad_duzelt(&ad), cocuklar: Vec::new() };
        for e in fs::read_dir(yol).map_err(m)?.flatten() {
            dizin.cocuklar.push(dugum_dosyadan(&e.path())?);
        }
        return Ok(Dugum::Dizin(dizin));
    }
    let veri = fs::read(yol).map_err(|e| format!("{}: {e}", yol.display()))?;
    if ad.to_lowercase().ends_with(".rpf")
        && let Ok(arsiv) = Arsiv::oku(Arc::from(veri.clone()))
    {
        return Ok(Dugum::Arsiv(IcArsiv { ad: rpf::ad_duzelt(&ad), arsiv }));
    }
    Ok(Dugum::Dosya(Dosya::yeni(&ad, veri)))
}

#[tauri::command]
async fn ice_aktar(durum: State<'_, Durum>, id: u32, dizin: String, kaynaklar: Vec<String>) -> Cevap<BelgeOzet> {
    let dugumler = kaynaklar.iter().map(|k| dugum_dosyadan(Path::new(k))).collect::<Cevap<Vec<_>>>()?;
    degistir(&durum, id, |b| {
        for d in dugumler {
            b.arsiv.koy(&dizin, d).map_err(m)?;
        }
        Ok(())
    })
}

#[tauri::command]
async fn dosya_degistir(durum: State<'_, Durum>, id: u32, yol: String, kaynak: String) -> Cevap<BelgeOzet> {
    let veri = fs::read(&kaynak).map_err(|e| format!("{kaynak}: {e}"))?;
    degistir(&durum, id, |b| {
        if let Some(Dugum::Arsiv(_)) = b.arsiv.bul(&yol) {
            let arsiv = Arsiv::oku(Arc::from(veri)).map_err(m)?;
            let (ust, ad) = yol.rsplit_once('/').unwrap_or(("", &yol));
            return b.arsiv.koy(ust, Dugum::Arsiv(IcArsiv { ad: ad.to_string(), arsiv })).map_err(m);
        }
        b.arsiv.dosya_mut(&yol).map_err(m)?.degistir(veri);
        Ok(())
    })
}

fn dugum_yaz(d: &Dugum, hedef: &Path) -> Cevap<usize> {
    let yol = export_path::child(hedef, d.ad())?;
    match d {
        Dugum::Dosya(f) => {
            export_path::write(&yol, f.veri().map_err(m)?).map_err(|e| format!("{}: {e}", yol.display()))?;
            Ok(1)
        }
        Dugum::Arsiv(a) => {
            export_path::write(&yol, a.arsiv.yaz().map_err(m)?).map_err(|e| format!("{}: {e}", yol.display()))?;
            Ok(1)
        }
        Dugum::Dizin(alt) => {
            fs::create_dir_all(&yol).map_err(m)?;
            alt.cocuklar.iter().map(|c| dugum_yaz(c, &yol)).sum()
        }
    }
}

#[tauri::command]
async fn disa_aktar(durum: State<'_, Durum>, id: u32, yollar: Vec<String>, hedef: String) -> Cevap<usize> {
    let kap = durum.belge(id)?;
    let b = kilitle(&kap);
    let hedef = Path::new(&hedef);
    fs::create_dir_all(hedef).map_err(m)?;
    let mut adet = 0;
    for y in &yollar {
        if y.is_empty() {
            adet += b.arsiv.kok.cocuklar.iter().map(|c| dugum_yaz(c, hedef)).sum::<Cevap<usize>>()?;
        } else {
            adet += dugum_yaz(b.arsiv.bul(y).ok_or_else(|| format!("bulunamadı: {y}"))?, hedef)?;
        }
    }
    Ok(adet)
}

#[tauri::command]
fn sil(durum: State<'_, Durum>, id: u32, yollar: Vec<String>) -> Cevap<BelgeOzet> {
    degistir(&durum, id, |b| {
        for y in &yollar {
            b.arsiv.sil(y).map_err(m)?;
        }
        Ok(())
    })
}

#[tauri::command]
fn yeniden_adlandir(durum: State<'_, Durum>, id: u32, yol: String, ad: String) -> Cevap<BelgeOzet> {
    degistir(&durum, id, |b| b.arsiv.yeniden_adlandir(&yol, &ad).map_err(m))
}

#[tauri::command]
fn dizin_olustur(durum: State<'_, Durum>, id: u32, yol: String) -> Cevap<BelgeOzet> {
    degistir(&durum, id, |b| b.arsiv.dizin_olustur(&yol).map_err(m))
}

#[tauri::command]
fn tasi(durum: State<'_, Durum>, id: u32, yollar: Vec<String>, dizin: String) -> Cevap<BelgeOzet> {
    degistir(&durum, id, |b| {
        for y in &yollar {
            let hedef_ici = format!("{}/", dizin.to_lowercase());
            if dizin.eq_ignore_ascii_case(y) || hedef_ici.starts_with(&format!("{}/", y.to_lowercase())) {
                return Err(format!("{y} kendi içine taşınamaz"));
            }
            let d = b.arsiv.sil(y).map_err(m)?;
            b.arsiv.koy(&dizin, d).map_err(m)?;
        }
        Ok(())
    })
}

#[derive(Serialize)]
struct DokuBilgi {
    i: usize,
    ad: String,
    genislik: usize,
    yukseklik: usize,
    bicim: String,
    seviye: usize,
    destekli: bool,
}

#[tauri::command]
async fn ytd_listesi(durum: State<'_, Durum>, id: u32, yol: String) -> Cevap<Vec<DokuBilgi>> {
    let kap = durum.belge(id)?;
    let ytd = ytd_al(&kap, &yol)?;
    Ok(ytd
        .dokular
        .iter()
        .enumerate()
        .map(|(i, d)| DokuBilgi {
            i,
            ad: d.ad.clone(),
            genislik: d.genislik,
            yukseklik: d.yukseklik,
            bicim: d.bicim.ad(),
            seviye: d.seviye,
            destekli: d.bicim.destekli(),
        })
        .collect())
}

fn ytd_guncelle(b: &mut Belge, yol: &str, ytd: Ytd, dosya: Vec<u8>) -> Cevap<()> {
    b.arsiv.dosya_mut(yol).map_err(m)?.degistir(dosya);
    b.ytdler.insert(yol.to_lowercase(), Arc::new(ytd));
    Ok(())
}

#[tauri::command]
async fn doku_degistir(
    durum: State<'_, Durum>,
    id: u32,
    yol: String,
    i: usize,
    gorsel: String,
    sigdirma: Sigdirma,
    renk: RenkAyari,
) -> Cevap<BelgeOzet> {
    let (rgba, w, h) = doku::gorsel_ac(&fs::read(&gorsel).map_err(|e| format!("{gorsel}: {e}"))?).map_err(m)?;
    let kap = durum.belge(id)?;
    let mut ytd = (*ytd_al(&kap, &yol)?).clone();
    ytd.degistir(i, rgba, w, h, sigdirma, &renk).map_err(m)?;
    let dosya = ytd.dosya();
    degistir(&durum, id, move |b| ytd_guncelle(b, &yol, ytd, dosya))
}

#[tauri::command]
async fn doku_renklendir(durum: State<'_, Durum>, id: u32, yol: String, indeksler: Vec<usize>, renk: RenkAyari) -> Cevap<BelgeOzet> {
    let kap = durum.belge(id)?;
    let mut ytd = (*ytd_al(&kap, &yol)?).clone();
    for i in indeksler {
        ytd.renklendir(i, &renk).map_err(m)?;
    }
    let dosya = ytd.dosya();
    degistir(&durum, id, move |b| ytd_guncelle(b, &yol, ytd, dosya))
}

#[derive(Deserialize)]
#[serde(tag = "tur", rename_all = "lowercase")]
enum YtdIstegi {
    Sil { ad: String },
    Koy { ad: String, gorsel: String, boyut: Option<[usize; 2]>, bicim: Option<String> },
    Olcekle { ad: String, boyut: [usize; 2] },
}

/// Doku sözlüğünü yeniden kuran işlemler (ekle, sil, boyut değiştir); hepsi tek geri-al adımı.
#[tauri::command]
async fn ytd_islem(durum: State<'_, Durum>, id: u32, yol: String, islemler: Vec<YtdIstegi>) -> Cevap<BelgeOzet> {
    if gomulu_dokulu(&yol).is_some() {
        return gomulu_boyutlandir(&durum, id, yol, islemler);
    }
    let kap = durum.belge(id)?;
    let (dosya, _) = dosya_kopyasi(&kap, &yol)?;
    let veri = dosya.veri().map_err(m)?.into_owned();
    let mevcut = Ytd::coz(&veri).map_err(m)?;
    let mut ops = Vec::new();
    for i in islemler {
        ops.push(match i {
            YtdIstegi::Sil { ad } => ytd::DokuIslemi::Sil(ad),
            YtdIstegi::Koy { ad, gorsel, boyut, bicim } => {
                let (rgba, w, h) = doku::gorsel_ac(&fs::read(&gorsel).map_err(|e| format!("{gorsel}: {e}"))?).map_err(m)?;
                let (rgba, w, h) = match boyut {
                    Some([nw, nh]) if [nw, nh] != [w, h] => (doku::olcekle(rgba, w, h, nw, nh, Sigdirma::Esnet).map_err(m)?, nw, nh),
                    _ => (rgba, w, h),
                };
                ytd::DokuIslemi::Koy { ad, rgba, w, h, bicim }
            }
            YtdIstegi::Olcekle { ad, boyut: [nw, nh] } => {
                let i = mevcut.dokular.iter().position(|d| d.ad.eq_ignore_ascii_case(&ad)).ok_or_else(|| format!("{ad} dokusu yok"))?;
                let (rgba, w, h) = mevcut.rgba(i, 0).map_err(m)?;
                let rgba = doku::olcekle(rgba, w, h, nw, nh, Sigdirma::Esnet).map_err(m)?;
                ytd::DokuIslemi::Koy { ad, rgba, w: nw, h: nh, bicim: None }
            }
        });
    }
    let yeni = ytd::yeniden_kur(&veri, ops).map_err(m)?;
    Ytd::coz(&yeni).map_err(|e| format!("kurulan ytd doğrulanamadı, uygulanmadı: {e}"))?;
    degistir(&durum, id, move |b| {
        b.arsiv.dosya_mut(&yol).map_err(m)?.degistir(yeni);
        Ok(())
    })
}

/// En yakın 2'nin kuvveti (4..4096); modele konan görsel oyunun sevdiği boyuta gelsin.
fn iki_kuvveti(n: usize) -> usize {
    let n = n.clamp(4, 4096);
    let ust = n.next_power_of_two();
    let alt = ust / 2;
    if alt >= 4 && n - alt < ust - n { alt } else { ust.min(4096) }
}

/// Model/ypt içindeki sözlükte doku silinip eklenemez; var olan doku yeni boyutta yeniden yazılır.
fn gomulu_boyutlandir(durum: &Durum, id: u32, yol: String, islemler: Vec<YtdIstegi>) -> Cevap<BelgeOzet> {
    let kap = durum.belge(id)?;
    let mut ytd = (*ytd_al(&kap, &yol)?).clone();
    for islem in islemler {
        let (ad, rgba, w, h) = match islem {
            YtdIstegi::Sil { .. } => return Err("modelin ya da efektin içindeki doku silinemez; yerine görsel koyabilir ya da küçültebilirsin".into()),
            YtdIstegi::Koy { ad, gorsel, boyut, .. } => {
                let (rgba, w, h) = doku::gorsel_ac(&fs::read(&gorsel).map_err(|e| format!("{gorsel}: {e}"))?).map_err(m)?;
                let [nw, nh] = boyut.unwrap_or([iki_kuvveti(w), iki_kuvveti(h)]);
                (ad, doku::olcekle(rgba, w, h, nw, nh, Sigdirma::Esnet).map_err(m)?, nw, nh)
            }
            YtdIstegi::Olcekle { ad, boyut: [nw, nh] } => {
                let i = ytd.dokular.iter().position(|d| d.ad.eq_ignore_ascii_case(&ad)).ok_or_else(|| format!("{ad} dokusu yok"))?;
                let (rgba, w, h) = ytd.rgba(i, 0).map_err(m)?;
                (ad, doku::olcekle(rgba, w, h, nw, nh, Sigdirma::Esnet).map_err(m)?, nw, nh)
            }
        };
        if w % 4 != 0 || h % 4 != 0 || w > 8192 || h > 8192 {
            return Err(format!("{w}x{h}: boyut 4'ün katı ve en fazla 8192 olmalı (2'nin kuvvetleri en güvenlisi)"));
        }
        let i = ytd
            .dokular
            .iter()
            .position(|d| d.ad.eq_ignore_ascii_case(&ad))
            .ok_or_else(|| format!("{ad}: bu dosyaya yeni doku eklenemez, yalnız var olanlar değiştirilir"))?;
        ytd.boyutlandir(i, rgba, w, h).map_err(m)?;
    }
    let dosya = ytd.dosya();
    Ytd::modelden(&dosya, gomulu_dokulu(&yol).unwrap_or("ydr")).map_err(|e| format!("yazılan dosya doğrulanamadı, uygulanmadı: {e}"))?;
    degistir(durum, id, move |b| ytd_guncelle(b, &yol, ytd, dosya))
}

#[derive(Serialize)]
struct DisGorsel {
    ad: String,
    /// pakette bu adla bir doku varsa (ytd yolu, sıra)
    bulunan: Option<(String, usize)>,
}

#[derive(Serialize)]
struct GfxBilgisi {
    gorseller: Vec<gfx::Gorsel>,
    dis: Vec<DisGorsel>,
}

fn gfx_ac(kap: &Mutex<Belge>, yol: &str) -> Cevap<gfx::Gfx> {
    let (dosya, _) = dosya_kopyasi(kap, yol)?;
    gfx::Gfx::coz(&dosya.veri().map_err(m)?).map_err(m)
}

/// Scaleform arayüzünün gömülü görselleri ve oyunun doku sözlüklerinden kullandığı görseller.
#[tauri::command]
async fn gfx_bilgi(durum: State<'_, Durum>, id: u32, yol: String) -> Cevap<GfxBilgisi> {
    let kap = durum.belge(id)?;
    let g = gfx_ac(&kap, &yol)?;
    let dizin = doku_dizini_al(&kap);
    let dis = g
        .dis_gorseller()
        .into_iter()
        .map(|ad| {
            let govde = ad.to_lowercase().trim_end_matches(".dds").to_string();
            DisGorsel { bulunan: dizin.get(&govde).cloned(), ad }
        })
        .collect();
    Ok(GfxBilgisi { gorseller: g.gorseller(), dis })
}

#[tauri::command]
async fn gfx_degistir(durum: State<'_, Durum>, id: u32, yol: String, karakter: u16, gorsel: String, sigdirma: Sigdirma) -> Cevap<BelgeOzet> {
    let (rgba, w, h) = doku::gorsel_ac(&fs::read(&gorsel).map_err(|e| format!("{gorsel}: {e}"))?).map_err(m)?;
    let kap = durum.belge(id)?;
    let mut g = gfx_ac(&kap, &yol)?;
    g.gorsel_degistir(karakter, rgba, w, h, sigdirma).map_err(m)?;
    let yeni = g.dosya();
    degistir(&durum, id, move |b| {
        b.arsiv.dosya_mut(&yol).map_err(m)?.degistir(yeni);
        Ok(())
    })
}

#[tauri::command]
async fn gfx_disa(durum: State<'_, Durum>, id: u32, yol: String, karakter: u16, hedef: String) -> Cevap<()> {
    let kap = durum.belge(id)?;
    let (rgba, w, h) = gfx_ac(&kap, &yol)?.gorsel_rgba(karakter).map_err(m)?;
    fs::write(&hedef, doku::png(&rgba, w, h).map_err(m)?).map_err(m)
}

fn gfx_png(app: &AppHandle, uri: &Uri) -> Cevap<Vec<u8>> {
    let q = sorgu(uri);
    let id: u32 = q.get("id").ok_or("id yok")?.parse().map_err(m)?;
    let karakter: u16 = q.get("c").ok_or("c yok")?.parse().map_err(m)?;
    let boy: usize = q.get("boy").and_then(|x| x.parse().ok()).unwrap_or(0);
    let kap = app.state::<Durum>().belge(id)?;
    let (rgba, w, h) = gfx_ac(&kap, q.get("yol").ok_or("yol yok")?)?.gorsel_rgba(karakter).map_err(m)?;
    let (rgba, w, h) = kucult(rgba, w, h, boy);
    doku::png(&rgba, w, h).map_err(m)
}

/// Parçacık sözlüğündeki efekt, yayıcı ve parçacık kurallarının anahtar kareli ayarları.
#[tauri::command]
async fn ypt_ayarlari(durum: State<'_, Durum>, id: u32, yol: String) -> Cevap<Vec<ypt::Grup>> {
    let kap = durum.belge(id)?;
    let (dosya, _) = dosya_kopyasi(&kap, &yol)?;
    let k = rsc::Kaynak::coz(&dosya.veri().map_err(m)?).map_err(m)?;
    ypt::oku(&k).map_err(m)
}

/// Anahtar kare değerlerini yerinde yazar; hepsi tek geri-al adımıdır.
#[tauri::command]
async fn ypt_yaz(durum: State<'_, Durum>, id: u32, yol: String, degisiklikler: Vec<(usize, [f32; 4])>) -> Cevap<BelgeOzet> {
    let kap = durum.belge(id)?;
    let (dosya, _) = dosya_kopyasi(&kap, &yol)?;
    let mut k = rsc::Kaynak::coz(&dosya.veri().map_err(m)?).map_err(m)?;
    ypt::yaz(&mut k, &degisiklikler).map_err(m)?;
    let yeni = k.paketle();
    degistir(&durum, id, move |b| {
        b.arsiv.dosya_mut(&yol).map_err(m)?.degistir(yeni);
        Ok(())
    })
}

#[derive(Serialize)]
struct MetaSonucu {
    ozet: BelgeOzet,
    uyarilar: Vec<String>,
}

/// Düzenlenmiş XML'i ikili meta/PSO'ya geri yazar; sonuç yeniden okunamıyorsa uygulanmaz.
#[tauri::command]
async fn meta_yaz(durum: State<'_, Durum>, id: u32, yol: String, xml: String) -> Cevap<MetaSonucu> {
    let kap = durum.belge(id)?;
    let (dosya, _) = dosya_kopyasi(&kap, &yol)?;
    let (yeni, uyarilar) = model::meta_geri_yaz(&dosya.veri().map_err(m)?, &xml).map_err(m)?;
    model::meta_xml(&yeni).map_err(|e| format!("yazılan dosya doğrulanamadı, uygulanmadı: {e}"))?;
    let ozet = degistir(&durum, id, move |b| {
        b.arsiv.dosya_mut(&yol).map_err(m)?.degistir(yeni);
        Ok(())
    })?;
    Ok(MetaSonucu { ozet, uyarilar })
}

#[tauri::command]
async fn doku_adlandir(durum: State<'_, Durum>, id: u32, yol: String, i: usize, ad: String) -> Cevap<BelgeOzet> {
    let kap = durum.belge(id)?;
    let mut ytd = (*ytd_al(&kap, &yol)?).clone();
    ytd.yeniden_adlandir(i, &ad).map_err(m)?;
    let dosya = ytd.dosya();
    degistir(&durum, id, move |b| ytd_guncelle(b, &yol, ytd, dosya))
}

#[derive(Serialize)]
struct HttpCevabi {
    durum: u16,
    govde: String,
    bekle: Option<f64>,
}

/// AI sağlayıcılarına istek; tarayıcı CORS/CSP kısıtlarına takılmamak için Rust'tan gider.
#[tauri::command]
async fn ai_http(yontem: String, url: String, basliklar: HashMap<String, String>, govde: Option<String>) -> Cevap<HttpCevabi> {
    if !(url.starts_with("https://") || url.starts_with("http://localhost") || url.starts_with("http://127.0.0.1")) {
        return Err("yalnız https ya da yerel (localhost) adresler".into());
    }
    let istemci = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(m)?;
    let mut istek = match yontem.as_str() {
        "GET" => istemci.get(&url),
        _ => istemci.post(&url),
    };
    for (k, v) in &basliklar {
        istek = istek.header(k, v);
    }
    if let Some(g) = govde {
        istek = istek.header("content-type", "application/json").body(g);
    }
    let yanit = istek.send().await.map_err(|e| format!("bağlantı kurulamadı: {e}"))?;
    let durum = yanit.status().as_u16();
    let bekle = yanit
        .headers()
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<f64>().ok());
    Ok(HttpCevabi { durum, govde: yanit.text().await.map_err(m)?, bekle })
}

fn ayar_dosyasi(app: &AppHandle) -> Cevap<PathBuf> {
    Ok(app.path().app_config_dir().map_err(m)?.join("ayarlar.json"))
}

fn disk_ayarlari(yol: &Path) -> Cevap<serde_json::Value> {
    match fs::read_to_string(yol) {
        Ok(s) => serde_json::from_str(&s).map_err(m),
        Err(_) => Ok(serde_json::json!({})),
    }
}

/// API anahtarları kasadan doldurulur. Dosyada düz metin anahtar kalmışsa (1.0.0) önce kasaya taşınır.
#[tauri::command]
fn ayarlar_oku(app: AppHandle) -> Cevap<serde_json::Value> {
    let yol = ayar_dosyasi(&app)?;
    let mut v = disk_ayarlari(&yol)?;
    if kasa::duz_anahtar_var(&v) {
        let ayrik = kasa::ayir(v.clone(), &v);
        if !kasa::duz_anahtar_var(&ayrik) {
            modlar::guvenli_yaz(&yol, &serde_json::to_vec_pretty(&ayrik).map_err(m)?).map_err(m)?;
            v = ayrik;
        }
    }
    Ok(kasa::doldur(v))
}

/// Anahtarlar Windows Kimlik Bilgisi Yöneticisi'ne ayrılır, dosyaya boş yazılır.
#[tauri::command]
fn ayarlar_yaz(app: AppHandle, ayarlar: serde_json::Value) -> Cevap<()> {
    let yol = ayar_dosyasi(&app)?;
    fs::create_dir_all(yol.parent().unwrap()).map_err(m)?;
    let ayrik = kasa::ayir(ayarlar, &disk_ayarlari(&yol)?);
    modlar::guvenli_yaz(&yol, &serde_json::to_vec_pretty(&ayrik).map_err(m)?).map_err(m)
}

#[tauri::command]
async fn doku_disa(durum: State<'_, Durum>, id: u32, yol: String, i: usize, hedef: String) -> Cevap<()> {
    let kap = durum.belge(id)?;
    let ytd = ytd_al(&kap, &yol)?;
    let veri = if hedef.to_lowercase().ends_with(".dds") {
        ytd.dds(i).map_err(m)?
    } else {
        let (rgba, w, h) = ytd.rgba(i, 0).map_err(m)?;
        doku::png(&rgba, w, h).map_err(m)?
    };
    fs::write(&hedef, veri).map_err(m)
}

/// Sözlükteki bütün dokuları klasöre `<ad>.png` (ya da .dds) olarak yazar.
#[tauri::command]
async fn doku_toplu_disa(durum: State<'_, Durum>, id: u32, yol: String, klasor: String, dds: bool) -> Cevap<usize> {
    let kap = durum.belge(id)?;
    let ytd = ytd_al(&kap, &yol)?;
    let hedef = Path::new(&klasor);
    fs::create_dir_all(hedef).map_err(m)?;
    let mut n = 0;
    for (i, d) in ytd.dokular.iter().enumerate() {
        let veri = if dds {
            ytd.dds(i)
        } else {
            ytd.rgba(i, 0).and_then(|(v, w, h)| doku::png(&v, w, h))
        };
        let Ok(veri) = veri else { continue };
        let ad: String = d.ad.chars().map(|c| if r#"<>:"/\|?*"#.contains(c) { '_' } else { c }).collect();
        export_path::write(export_path::child(hedef, &format!("{ad}.{}", if dds { "dds" } else { "png" }))?, veri).map_err(m)?;
        n += 1;
    }
    Ok(n)
}

#[derive(Serialize)]
struct TopluIceSonucu {
    ozet: Option<BelgeOzet>,
    eslesen: Vec<String>,
    eslesmeyen: Vec<String>,
}

/// Klasördeki görselleri adı aynı olan dokuların yerine koyar (boyut ve biçim korunur); hepsi tek geri-al adımı.
#[tauri::command]
async fn doku_toplu_ice(durum: State<'_, Durum>, id: u32, yol: String, klasor: String, sigdirma: Sigdirma) -> Cevap<TopluIceSonucu> {
    let kap = durum.belge(id)?;
    let mut ytd = (*ytd_al(&kap, &yol)?).clone();
    let mut eslesen = Vec::new();
    let mut eslesmeyen = Vec::new();
    let mut girdiler: Vec<PathBuf> = fs::read_dir(&klasor).map_err(m)?.flatten().map(|e| e.path()).filter(|p| p.is_file()).collect();
    girdiler.sort();
    for p in girdiler {
        let uz = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        if !["png", "jpg", "jpeg", "webp", "bmp", "tga", "dds"].contains(&uz.as_str()) {
            continue;
        }
        let govde = p.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
        let Some(i) = ytd.dokular.iter().position(|d| d.ad.to_lowercase() == govde) else {
            eslesmeyen.push(p.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default());
            continue;
        };
        let (rgba, w, h) = doku::gorsel_ac(&fs::read(&p).map_err(|e| format!("{}: {e}", p.display()))?).map_err(|e| format!("{}: {e}", p.display()))?;
        ytd.degistir(i, rgba, w, h, sigdirma, &RenkAyari::notr()).map_err(|e| format!("{govde}: {e}"))?;
        eslesen.push(ytd.dokular[i].ad.clone());
    }
    if eslesen.is_empty() {
        return Ok(TopluIceSonucu { ozet: None, eslesen, eslesmeyen });
    }
    let dosya = ytd.dosya();
    let ozet = degistir(&durum, id, move |b| ytd_guncelle(b, &yol, ytd, dosya))?;
    Ok(TopluIceSonucu { ozet: Some(ozet), eslesen, eslesmeyen })
}

#[derive(Serialize)]
struct AyarDosyasi {
    girdiler: Vec<vs::Girdi>,
    renkler: Vec<vs::RenkUclusu>,
}

#[tauri::command]
fn vs_oku(durum: State<'_, Durum>, id: u32, yol: String) -> Cevap<AyarDosyasi> {
    let kap = durum.belge(id)?;
    let b = kilitle(&kap);
    let v = b.arsiv.dosya(&yol).map_err(m)?.veri().map_err(m)?;
    let a = vs::Ayarlar::coz(&String::from_utf8_lossy(&v));
    Ok(AyarDosyasi { girdiler: a.girdiler(), renkler: a.renkler() })
}

#[tauri::command]
fn vs_ayarla(durum: State<'_, Durum>, id: u32, yol: String, degerler: Vec<(String, String)>) -> Cevap<BelgeOzet> {
    degistir(&durum, id, |b| {
        let f = b.arsiv.dosya_mut(&yol).map_err(m)?;
        let mut a = vs::Ayarlar::coz(&String::from_utf8_lossy(&f.veri().map_err(m)?));
        for (k, v) in &degerler {
            a.ayarla(k, v);
        }
        f.degistir(a.metin().into_bytes());
        Ok(())
    })
}

fn paket_yaz_ic(b: &mut Belge, paket: &Paket) -> Cevap<()> {
    b.arsiv
        .koy("", Dugum::Dosya(Dosya::yeni("assembly.xml", oiv::uret(paket).into_bytes())))
        .map_err(m)
}

#[tauri::command]
fn paket_yaz(durum: State<'_, Durum>, id: u32, paket: Paket) -> Cevap<BelgeOzet> {
    degistir(&durum, id, |b| paket_yaz_ic(b, &paket))
}

#[tauri::command]
fn open_yap(durum: State<'_, Durum>, id: u32) -> Cevap<BelgeOzet> {
    degistir(&durum, id, |b| {
        b.arsiv.sifreleme = rpf::SIFRE_OPEN;
        Ok(())
    })
}

#[tauri::command]
fn kaynak_onar(durum: State<'_, Durum>, id: u32, eski: String, yeni: String) -> Cevap<BelgeOzet> {
    degistir(&durum, id, |b| {
        let f = b.arsiv.dosya_mut("assembly.xml").map_err(m)?;
        let xml = String::from_utf8_lossy(&f.veri().map_err(m)?).into_owned();
        let (yeni_xml, adet) = oiv::kaynak_degistir(&xml, &eski, &yeni);
        if adet == 0 {
            return Err(format!("assembly.xml'de {eski} kaynağı bulunamadı"));
        }
        f.degistir(yeni_xml.into_bytes());
        Ok(())
    })
}

#[tauri::command]
fn olu_satirlari_temizle(durum: State<'_, Durum>, id: u32) -> Cevap<BelgeOzet> {
    degistir(&durum, id, |b| {
        let mut paket = paket_oku(&b.arsiv).ok_or("assembly.xml yok")??;
        paket.hedefler.retain(|h| h.sil || matches!(b.arsiv.bul(&format!("content/{}", h.kaynak)), Some(Dugum::Dosya(_) | Dugum::Arsiv(_))));
        paket_yaz_ic(b, &paket)
    })
}

fn yol_ayir(yol: &str) -> (&str, &str) {
    yol.rsplit_once('/').unwrap_or(("", yol))
}

#[tauri::command]
fn metin_olustur(durum: State<'_, Durum>, id: u32, yol: String, metin: String) -> Cevap<BelgeOzet> {
    let yol = yol.replace('\\', "/").trim_matches('/').to_string();
    degistir(&durum, id, |b| {
        let (ust, ad) = yol_ayir(&yol);
        b.arsiv.koy(ust, Dugum::Dosya(Dosya::yeni(ad, metin.into_bytes()))).map_err(m)
    })
}

#[tauri::command]
fn hedef_ekle(durum: State<'_, Durum>, id: u32, kaynak: String, arsivler: Vec<String>, yol: String) -> Cevap<BelgeOzet> {
    degistir(&durum, id, |b| {
        let kaynak = kaynak.replace('\\', "/").trim_start_matches("content/").to_lowercase();
        if !matches!(b.arsiv.bul(&format!("content/{kaynak}")), Some(Dugum::Dosya(_) | Dugum::Arsiv(_))) {
            return Err(format!("content/{kaynak} pakette yok; önce dosyayı content/ altına koy"));
        }
        let mut paket = match paket_oku(&b.arsiv) {
            Some(p) => p?,
            None => Paket { surum: "1.0".into(), ..Default::default() },
        };
        let hedef = Hedef { kaynak: kaynak.clone(), arsivler, yol, sil: false };
        paket.hedefler.retain(|h| h.anahtar() != hedef.anahtar());
        paket.hedefler.push(hedef);
        paket_yaz_ic(b, &paket)
    })
}

#[derive(Serialize)]
struct AcikBelge {
    id: u32,
    ad: String,
    paket: Option<String>,
}

#[tauri::command]
fn acik_belgeler(durum: State<'_, Durum>) -> Vec<AcikBelge> {
    let belgeler = durum.belgeler.lock().unwrap();
    let mut v: Vec<AcikBelge> = belgeler
        .iter()
        .map(|(&id, kap)| {
            let b = kilitle(kap);
            AcikBelge {
                id,
                ad: b.yol.as_ref().and_then(|p| p.file_name()).map_or("yeni-mod.rpf".into(), |n| n.to_string_lossy().into_owned()),
                paket: paket_oku(&b.arsiv).and_then(|p| p.ok()).map(|p| p.ad),
            }
        })
        .collect();
    v.sort_by_key(|b| b.id);
    v
}

#[tauri::command]
fn belgeler_arasi_kopyala(durum: State<'_, Durum>, kaynak_id: u32, kaynak_yol: String, hedef_id: u32, hedef_yol: String) -> Cevap<BelgeOzet> {
    let dugum = {
        let kap = durum.belge(kaynak_id)?;
        let b = kilitle(&kap);
        b.arsiv.bul(&kaynak_yol).cloned().ok_or_else(|| format!("{kaynak_yol} kaynak pakette yok"))?
    };
    let hedef_yol = hedef_yol.replace('\\', "/").trim_matches('/').to_string();
    degistir(&durum, hedef_id, move |b| {
        let (ust, ad) = yol_ayir(&hedef_yol);
        let mut d = dugum;
        match &mut d {
            Dugum::Dosya(f) => f.ad = rpf::ad_duzelt(ad),
            Dugum::Dizin(x) => x.ad = rpf::ad_duzelt(ad),
            Dugum::Arsiv(a) => a.ad = rpf::ad_duzelt(ad),
        }
        b.arsiv.koy(ust, d).map_err(m)
    })
}

#[derive(Deserialize)]
struct HedefliDosya {
    kaynak: String,
    arsivler: Vec<String>,
    yol: String,
}

#[tauri::command]
async fn hedefli_ekle(durum: State<'_, Durum>, id: u32, dosya: HedefliDosya) -> Cevap<BelgeOzet> {
    let dugum = dugum_dosyadan(Path::new(&dosya.kaynak))?;
    degistir(&durum, id, move |b| {
        let mut paket = match paket_oku(&b.arsiv) {
            Some(p) => p?,
            None => Paket { surum: "1.0".into(), ..Default::default() },
        };
        let kaynak = dugum.ad().to_string();
        b.arsiv.koy("content", dugum).map_err(m)?;
        let hedef = Hedef { kaynak: kaynak.clone(), arsivler: dosya.arsivler, yol: dosya.yol, sil: false };
        paket.hedefler.retain(|h| h.anahtar() != hedef.anahtar() && h.kaynak != kaynak);
        paket.hedefler.push(hedef);
        paket_yaz_ic(b, &paket)
    })
}

fn sorgu(uri: &Uri) -> HashMap<String, String> {
    uri.query()
        .unwrap_or_default()
        .split('&')
        .filter_map(|p| p.split_once('='))
        .map(|(k, v)| (k.to_string(), yuzde_coz(v)))
        .collect()
}

fn yuzde_coz(s: &str) -> String {
    let b = s.as_bytes();
    let mut cikti = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let onaltilik = b.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(std::str::from_utf8(h).ok()?, 16).ok());
        match (b[i], onaltilik) {
            (b'%', Some(x)) => {
                cikti.push(x);
                i += 2;
            }
            (b'+', _) => cikti.push(b' '),
            (c, _) => cikti.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&cikti).into_owned()
}

fn mip_sec(w: usize, h: usize, seviye: usize, boy: usize) -> usize {
    (0..seviye.max(1)).take_while(|&m| boy == 0 || (w >> m).max(h >> m) >= boy).last().unwrap_or(0)
}

fn model_paketi(app: &AppHandle, uri: &Uri) -> Cevap<Vec<u8>> {
    let q = sorgu(uri);
    let id: u32 = q.get("id").ok_or("id yok")?.parse().map_err(m)?;
    let yol = q.get("yol").ok_or("yol yok")?;
    let kap = app.state::<Durum>().belge(id)?;
    let (dosya, _) = dosya_kopyasi(&kap, yol)?;
    let uzanti = yol.rsplit('.').next().unwrap_or("").to_lowercase();
    let veri = dosya.veri().map_err(m)?;
    if uzanti == "ybn" {
        return model::carpisma_oku(&veri).map_err(m);
    }
    model::model_oku(&veri, &uzanti).map_err(m)
}

/// Ada tam ya da sonek olarak uyan (en uzun sonek) kayıt; model doku adları bazen önekli gelir.
fn ada_gore<T>(adaylar: impl Iterator<Item = (String, T)>, ad: &str) -> Option<T> {
    let mut sonek: Option<(usize, T)> = None;
    for (k, v) in adaylar {
        if k == ad {
            return Some(v);
        }
        if ad.ends_with(k.as_str()) && sonek.as_ref().is_none_or(|(n, _)| k.len() > *n) {
            sonek = Some((k.len(), v));
        }
    }
    sonek.map(|x| x.1)
}

/// Modelin istediği dokunun yeri: önce modelin içi, sonra arşivdeki ytd'ler. (dosya yolu, sıra)
fn model_dokusunu_bul(kap: &Mutex<Belge>, model_yolu: &str, ad: &str) -> Option<(String, usize)> {
    let ad = ad.to_lowercase();
    if let Ok(ic) = ytd_al(kap, model_yolu)
        && let Some(i) = ada_gore(ic.dokular.iter().enumerate().map(|(i, d)| (d.ad.to_lowercase(), i)), &ad)
    {
        return Some((model_yolu.to_string(), i));
    }
    let dizin = doku_dizini_al(kap);
    ada_gore(dizin.iter().map(|(k, v)| (k.clone(), v)), &ad).cloned()
}

fn model_dokusu(app: &AppHandle, uri: &Uri) -> Cevap<Vec<u8>> {
    let q = sorgu(uri);
    let id: u32 = q.get("id").ok_or("id yok")?.parse().map_err(m)?;
    let yol = q.get("yol").ok_or("yol yok")?;
    let ad = q.get("ad").ok_or("ad yok")?;
    let boy: usize = q.get("boy").and_then(|x| x.parse().ok()).unwrap_or(512);
    let kap = app.state::<Durum>().belge(id)?;
    let (ytd_yolu, i) = model_dokusunu_bul(&kap, yol, ad).ok_or_else(|| format!("{ad} dokusu bu arşivde yok (oyunun kendi dokusu olabilir)"))?;
    let ytd = ytd_al(&kap, &ytd_yolu)?;
    let d = ytd.dokular.get(i).ok_or("doku yok")?;
    let (rgba, w, h) = ytd.rgba(i, mip_sec(d.genislik, d.yukseklik, d.seviye, boy)).map_err(m)?;
    doku::png(&rgba, w, h).map_err(m)
}

fn kucult(rgba: Vec<u8>, w: usize, h: usize, boy: usize) -> (Vec<u8>, usize, usize) {
    let (mut v, mut w, mut h) = (rgba, w, h);
    while boy > 0 && w.max(h) / 2 >= boy {
        (v, w, h) = doku::yarim(&v, w, h);
    }
    (v, w, h)
}

#[derive(Serialize)]
struct ModelOzeti {
    yol: String,
    boyut: usize,
    ucgen: usize,
    /// modelin içine gömülü doku sayısı
    doku: usize,
    /// galeride gösterilecek gömülü doku sırası
    kapak: Option<usize>,
    hata: Option<String>,
}

/// Paketteki bütün modellerin galeri özeti; modeller paralel okunur.
#[tauri::command]
async fn model_ozetleri(durum: State<'_, Durum>, id: u32) -> Cevap<Vec<ModelOzeti>> {
    use rayon::prelude::*;
    let kap = durum.belge(id)?;
    let mut dosyalar = Vec::new();
    kilitle(&kap).arsiv.gez(|yol, d| {
        if let Dugum::Dosya(f) = d
            && model_uzantisi(yol).is_some()
        {
            dosyalar.push((yol.to_string(), f.clone()));
        }
    });
    Ok(dosyalar
        .par_iter()
        .map(|(yol, f)| {
            let uz = model_uzantisi(yol).unwrap_or("ydr");
            let sonuc = f.veri().map_err(m).and_then(|v| {
                let ucgen = model::ucgen_sayisi(&v, uz).map_err(m)?;
                let adlar: Vec<String> = Ytd::modelden(&v, uz).map(|y| y.dokular.iter().map(|d| d.ad.to_lowercase()).collect()).unwrap_or_default();
                let ana = model::doku_adlari(&v, uz).unwrap_or_default();
                // galeri kapağı: önce parçaların ana dokusu, yoksa normal/spec olmayan ilk doku
                let kapak = adlar
                    .iter()
                    .position(|a| ana.contains(a))
                    .or_else(|| adlar.iter().position(|a| !a.ends_with("_n") && !a.contains("normal") && !a.contains("spec")));
                Ok((ucgen, adlar.len(), kapak))
            });
            let (ucgen, doku, kapak, hata) = match sonuc {
                Ok((u, d, k)) => (u, d, k, None),
                Err(e) => (0, 0, None, Some(e)),
            };
            ModelOzeti { yol: yol.clone(), boyut: f.boyut(), ucgen, doku, kapak, hata }
        })
        .collect())
}

#[derive(Serialize)]
struct ModelDokusu {
    ad: String,
    /// dokuyu barındıran dosya: modelin kendisi ya da paketteki bir ytd; oyunun kendi dokusuysa boş
    kaynak: Option<String>,
    i: usize,
    genislik: usize,
    yukseklik: usize,
    bicim: String,
    destekli: bool,
    gomulu: bool,
    /// modelin parçalarında ana doku olarak kullanılıyor
    kullanilan: bool,
}

/// Modelin kullandığı ve içinde taşıdığı dokular; 3B görünümün doku paneli için.
#[tauri::command]
async fn model_dokulari(durum: State<'_, Durum>, id: u32, yol: String) -> Cevap<Vec<ModelDokusu>> {
    let kap = durum.belge(id)?;
    let uzanti = model_uzantisi(&yol).ok_or("model dosyası değil")?;
    let (dosya, _) = dosya_kopyasi(&kap, &yol)?;
    let kullanilan = model::doku_adlari(&dosya.veri().map_err(m)?, uzanti).map_err(m)?;
    let bilgi = |ad: String, kaynak: &str, i: usize, gomulu: bool, kullanilan: bool| -> Cevap<ModelDokusu> {
        let ytd = ytd_al(&kap, kaynak)?;
        let d = ytd.dokular.get(i).ok_or("doku yok")?;
        Ok(ModelDokusu {
            ad,
            kaynak: Some(kaynak.to_string()),
            i,
            genislik: d.genislik,
            yukseklik: d.yukseklik,
            bicim: d.bicim.ad(),
            destekli: d.bicim.destekli(),
            gomulu,
            kullanilan,
        })
    };
    let ic = ytd_al(&kap, &yol)?;
    let mut liste = Vec::new();
    for (i, d) in ic.dokular.iter().enumerate() {
        let ad = d.ad.to_lowercase();
        let kullaniliyor = kullanilan.iter().any(|k| *k == ad || k.ends_with(ad.as_str()));
        liste.push(bilgi(ad, &yol, i, true, kullaniliyor)?);
    }
    for ad in kullanilan {
        match model_dokusunu_bul(&kap, &yol, &ad) {
            Some((kaynak, _)) if kaynak == yol => {}
            Some((kaynak, i)) => {
                if !liste.iter().any(|x| x.kaynak.as_deref() == Some(kaynak.as_str()) && x.i == i) {
                    liste.push(bilgi(ad, &kaynak, i, false, true)?);
                }
            }
            None => liste.push(ModelDokusu {
                ad,
                kaynak: None,
                i: 0,
                genislik: 0,
                yukseklik: 0,
                bicim: String::new(),
                destekli: false,
                gomulu: false,
                kullanilan: true,
            }),
        }
    }
    Ok(liste)
}

#[derive(Serialize, Clone)]
struct HaritaKarosu {
    ytd: String,
    i: usize,
    ad: String,
    varyant: String,
    satir: u32,
    sutun: u32,
    genislik: usize,
    yukseklik: usize,
    bicim: String,
}

#[derive(Serialize)]
struct HaritaDuzeni {
    duzen: harita::Duzen,
    /// "paket" (minimap.ymt pakette) ya da "oyun" (oyunun varsayılanı)
    duzen_kaynagi: &'static str,
    karolar: Vec<HaritaKarosu>,
}

fn harita_duzeni_ic(kap: &Mutex<Belge>) -> Cevap<HaritaDuzeni> {
    let (ytdler, ymt) = {
        let b = kilitle(kap);
        let mut ytdler = Vec::new();
        let mut ymt = None;
        b.arsiv.gez(|yol, d| {
            let Dugum::Dosya(f) = d else { return };
            let kucuk = yol.to_lowercase();
            let ad = kucuk.rsplit('/').next().unwrap_or(&kucuk);
            if ad == "minimap.ymt" {
                ymt = Some(f.clone());
            } else if let Some(govde) = ad.strip_suffix(".ytd")
                && (harita::karo_adi(govde).is_some() || govde.starts_with("minimap"))
            {
                ytdler.push(yol.to_string());
            }
        });
        (ytdler, ymt)
    };
    let paket_duzeni = ymt
        .and_then(|f| f.veri().ok().map(|v| v.into_owned()))
        .and_then(|v| model::meta_xml(&v).ok())
        .and_then(|x| harita::duzen_oku(&x));
    let mut karolar = Vec::new();
    for yol in ytdler {
        let Ok(ytd) = ytd_al(kap, &yol) else { continue };
        let govde = yol.rsplit('/').next().unwrap_or(&yol).to_lowercase();
        let govde = govde.trim_end_matches(".ytd");
        for (i, d) in ytd.dokular.iter().enumerate() {
            let Some((varyant, satir, sutun)) = harita::karo_adi(govde).or_else(|| harita::karo_adi(&d.ad)) else { continue };
            karolar.push(HaritaKarosu {
                ytd: yol.clone(),
                i,
                ad: d.ad.clone(),
                varyant: varyant.to_string(),
                satir,
                sutun,
                genislik: d.genislik,
                yukseklik: d.yukseklik,
                bicim: d.bicim.ad(),
            });
        }
    }
    let duzen_kaynagi = if paket_duzeni.is_some() { "paket" } else { "oyun" };
    Ok(HaritaDuzeni { duzen: paket_duzeni.unwrap_or_default(), duzen_kaynagi, karolar })
}

#[tauri::command]
async fn harita_duzeni(durum: State<'_, Durum>, id: u32) -> Cevap<HaritaDuzeni> {
    let kap = durum.belge(id)?;
    harita_duzeni_ic(&kap)
}

#[derive(Deserialize)]
struct KatmanIstegi {
    gorsel: String,
    merkez: [f64; 2],
    boyut: [f64; 2],
    donus: f64,
    opaklik: f32,
    karisim: harita::Karisim,
}

#[derive(Serialize)]
struct HaritaSonucu {
    ozet: BelgeOzet,
    karo: usize,
}

/// Uzun işlerde arayüzdeki meşgul katmanına giden ilerleme.
#[derive(Serialize, Clone)]
struct Ilerleme {
    bitti: usize,
    toplam: usize,
}

/// Katmanları değdikleri karolara gerçek çözünürlükte işler; hepsi tek geri-al adımıdır.
#[tauri::command]
async fn harita_isle(app: AppHandle, durum: State<'_, Durum>, id: u32, katmanlar: Vec<KatmanIstegi>, varyantlar: Vec<String>) -> Cevap<HaritaSonucu> {
    if katmanlar.is_empty() {
        return Err("işlenecek katman yok".into());
    }
    let kap = durum.belge(id)?;
    let gorseller = katmanlar
        .iter()
        .map(|k| doku::gorsel_ac(&fs::read(&k.gorsel).map_err(|e| format!("{}: {e}", k.gorsel))?).map_err(m))
        .collect::<Cevap<Vec<_>>>()?;
    let hk: Vec<harita::Katman> = katmanlar
        .iter()
        .zip(&gorseller)
        .map(|(k, (rgba, w, h))| harita::Katman {
            rgba,
            w: *w,
            h: *h,
            merkez: k.merkez,
            boyut: k.boyut,
            donus: k.donus,
            opaklik: k.opaklik.clamp(0.0, 1.0),
            karisim: k.karisim,
        })
        .collect();

    let dz = harita_duzeni_ic(&kap)?;
    let mut gruplar: HashMap<String, Vec<HaritaKarosu>> = HashMap::new();
    for k in dz.karolar {
        if varyantlar.contains(&k.varyant) && harita::karoya_degiyor(harita::karo_dikdortgeni(&dz.duzen, k.satir, k.sutun), &hk) {
            gruplar.entry(k.ytd.clone()).or_default().push(k);
        }
    }
    let toplam = gruplar.values().map(Vec::len).sum();
    let _ = app.emit("ilerleme", Ilerleme { bitti: 0, toplam });
    let mut guncel = Vec::new();
    let mut karo = 0;
    let mut bitti = 0;
    for (yol, karolar) in gruplar {
        let mut ytd = (*ytd_al(&kap, &yol)?).clone();
        let mut degisti = false;
        for k in karolar {
            let (mut rgba, w, h) = ytd.rgba(k.i, 0).map_err(m)?;
            if harita::isle(&mut rgba, w, h, harita::karo_dikdortgeni(&dz.duzen, k.satir, k.sutun), &hk) {
                ytd.degistir(k.i, rgba, w, h, Sigdirma::Esnet, &RenkAyari::notr()).map_err(m)?;
                degisti = true;
                karo += 1;
            }
            bitti += 1;
            let _ = app.emit("ilerleme", Ilerleme { bitti, toplam });
        }
        if degisti {
            let dosya = ytd.dosya();
            guncel.push((yol, ytd, dosya));
        }
    }
    if guncel.is_empty() {
        return Err("katmanlar hiçbir harita karosuna değmiyor".into());
    }
    let ozet = degistir(&durum, id, move |b| {
        for (yol, ytd, dosya) in guncel {
            ytd_guncelle(b, &yol, ytd, dosya)?;
        }
        Ok(())
    })?;
    Ok(HaritaSonucu { ozet, karo })
}

/// Arayüzde üretilen görseli (yazı katmanı gibi) geçici klasöre yazar, yolunu döndürür.
#[tauri::command]
fn gecici_gorsel_kaydet(app: AppHandle, bayt: Vec<u8>) -> Cevap<String> {
    if !bayt.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Err("PNG bekleniyor".into());
    }
    let klasor = app.path().app_cache_dir().map_err(m)?.join("katmanlar");
    fs::create_dir_all(&klasor).map_err(m)?;
    let ad = format!("{}.png", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(m)?.as_nanos());
    let yol = klasor.join(ad);
    fs::write(&yol, bayt).map_err(m)?;
    Ok(yol.to_string_lossy().into_owned())
}

fn yerel_gorsel(uri: &Uri) -> Cevap<Vec<u8>> {
    let q = sorgu(uri);
    let yol = q.get("yol").ok_or("yol yok")?;
    let uzanti = yol.rsplit('.').next().unwrap_or("").to_lowercase();
    if !["png", "jpg", "jpeg", "webp", "bmp", "tga", "dds"].contains(&uzanti.as_str()) {
        return Err("desteklenmeyen görsel".into());
    }
    let (rgba, w, h) = doku::gorsel_ac(&fs::read(yol).map_err(m)?).map_err(m)?;
    let (rgba, w, h) = kucult(rgba, w, h, 2048);
    doku::png(&rgba, w, h).map_err(m)
}

#[derive(Serialize)]
struct ObjSonucu {
    obj: String,
    doku: usize,
    eksik: Vec<String>,
}

/// Modeli OBJ + MTL + PNG dokular olarak klasöre yazar; dokular modelin içinden ya da paketteki ytd'lerden alınır.
#[tauri::command]
async fn model_obj(durum: State<'_, Durum>, id: u32, yol: String, klasor: String) -> Cevap<ObjSonucu> {
    let kap = durum.belge(id)?;
    let (dosya, _) = dosya_kopyasi(&kap, &yol)?;
    let govde = yol.rsplit('/').next().unwrap_or(&yol);
    let (ad, uzanti) = govde.rsplit_once('.').unwrap_or((govde, ""));
    let c = model::obj_yaz(&dosya.veri().map_err(m)?, &uzanti.to_lowercase(), ad).map_err(m)?;
    let hedef = Path::new(&klasor);
    fs::create_dir_all(hedef).map_err(m)?;
    let obj = export_path::child(hedef, &format!("{ad}.obj"))?;
    export_path::write(&obj, &c.obj).map_err(m)?;
    export_path::write(export_path::child(hedef, &format!("{ad}.mtl"))?, &c.mtl).map_err(m)?;
    let mut doku = 0;
    let mut eksik = Vec::new();
    for t in &c.dokular {
        let rgba = model_dokusunu_bul(&kap, &yol, t).and_then(|(kaynak, i)| ytd_al(&kap, &kaynak).ok()?.rgba(i, 0).ok());
        match rgba {
            Some((v, w, h)) => {
                export_path::write(export_path::child(hedef, &format!("{t}.png"))?, doku::png(&v, w, h).map_err(m)?).map_err(m)?;
                doku += 1;
            }
            None => eksik.push(t.clone()),
        }
    }
    Ok(ObjSonucu { obj: obj.to_string_lossy().into_owned(), doku, eksik })
}

#[derive(Serialize)]
struct HaritaVerisi {
    yerlesimler: Vec<model::Yerlesim>,
    modeller: HashMap<u32, String>,
}

#[tauri::command]
async fn harita_verisi(durum: State<'_, Durum>, id: u32, yol: String) -> Cevap<HaritaVerisi> {
    let kap = durum.belge(id)?;
    let b = kilitle(&kap);
    let veri = b.arsiv.dosya(&yol).map_err(m)?.veri().map_err(m)?;
    let yerlesimler = model::ymap_yerlesimleri(&veri).map_err(m)?;
    let mut modeller = HashMap::new();
    b.arsiv.gez(|y, d| {
        let Dugum::Dosya(_) = d else { return };
        let ad = y.rsplit('/').next().unwrap_or(y).to_lowercase();
        if let Some(govde) = ad.strip_suffix(".ydr").or_else(|| ad.strip_suffix(".yft")) {
            modeller.entry(ytd::joaat(govde)).or_insert_with(|| y.to_string());
        }
    });
    Ok(HaritaVerisi { yerlesimler, modeller })
}

fn doku_png(app: &AppHandle, uri: &Uri) -> Cevap<Vec<u8>> {
    let q = sorgu(uri);
    let al = |k: &str| q.get(k).cloned().unwrap_or_default();
    let id: u32 = al("id").parse().map_err(m)?;
    let i: usize = al("i").parse().map_err(m)?;
    let boy: usize = al("boy").parse().unwrap_or(0);
    let kap = app.state::<Durum>().belge(id)?;
    let ytd = ytd_al(&kap, &al("yol"))?;
    let d = ytd.dokular.get(i).ok_or("doku yok")?;
    let mip = (0..d.seviye)
        .take_while(|&m| boy == 0 || (d.genislik >> m).max(d.yukseklik >> m) >= boy)
        .last()
        .unwrap_or(0);
    let (mut rgba, w, h) = ytd.rgba(i, mip).map_err(m)?;
    if uri.path().ends_with("/onizle") {
        let sayi = |k: &str, v: f32| q.get(k).and_then(|x| x.parse().ok()).unwrap_or(v);
        let boya = q.get("boya").filter(|x| x.len() == 6).and_then(|x| {
            let p = |a: usize| u8::from_str_radix(&x[a..a + 2], 16).ok();
            Some([p(0)?, p(2)?, p(4)?])
        });
        let renk = RenkAyari {
            ton: sayi("ton", 0.0),
            doygunluk: sayi("doy", 1.0),
            parlaklik: sayi("par", 0.0),
            kontrast: sayi("kon", 1.0),
            boya,
            boya_gucu: sayi("guc", 0.0),
        };
        doku::renk_uygula(&mut rgba, &renk);
    }
    doku::png(&rgba, w, h).map_err(m)
}

pub fn calistir() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Durum::default())
        .register_asynchronous_uri_scheme_protocol("fltr", |ctx, istek, yanit| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let yol = istek.uri().path().to_string();
                let (sonuc, tur) = if yol.ends_with("/model") {
                    (model_paketi(&app, istek.uri()), "application/octet-stream")
                } else if yol.ends_with("/modeldoku") {
                    (model_dokusu(&app, istek.uri()), "image/png")
                } else if yol.ends_with("/gfx") {
                    (gfx_png(&app, istek.uri()), "image/png")
                } else if yol.ends_with("/gorsel") {
                    (yerel_gorsel(istek.uri()), "image/png")
                } else {
                    (doku_png(&app, istek.uri()), "image/png")
                };
                let cevap = match sonuc {
                    Ok(png) => Response::builder()
                        .header("Content-Type", tur)
                        .header("Cache-Control", "no-store")
                        .header("Access-Control-Allow-Origin", "*")
                        .body(png),
                    Err(e) => Response::builder()
                        .status(404)
                        .header("Content-Type", "text/plain; charset=utf-8")
                        .header("Access-Control-Allow-Origin", "*")
                        .body(e.into_bytes()),
                };
                yanit.respond(cevap.expect("yanıt başlıkları geçerli"));
            });
        })
        .invoke_handler(tauri::generate_handler![
            mods_tara,
            mod_ac_kapa,
            arsiv_ac,
            yeni_mod,
            belge_ozet,
            belge_kapat,
            geri_al,
            yinele,
            kaydet,
            yedekler_klasoru,
            mod_sikistir,
            yedekleri_listele,
            yedek_geri_yukle,
            moda_kur,
            icerikte_ara,
            dosya_oku,
            metin_yaz,
            ice_aktar,
            dosya_degistir,
            disa_aktar,
            sil,
            yeniden_adlandir,
            dizin_olustur,
            tasi,
            ytd_listesi,
            doku_degistir,
            doku_renklendir,
            doku_adlandir,
            ytd_islem,
            meta_yaz,
            doku_disa,
            ayarlar_oku,
            ayarlar_yaz,
            ai_http,
            harita_verisi,
            model_obj,
            harita_duzeni,
            harita_isle,
            model_dokulari,
            model_ozetleri,
            cakisma_incele,
            doku_toplu_disa,
            doku_toplu_ice,
            ypt_ayarlari,
            gfx_bilgi,
            gfx_degistir,
            gfx_disa,
            ypt_yaz,
            gecici_gorsel_kaydet,
            metin_olustur,
            hedef_ekle,
            acik_belgeler,
            belgeler_arasi_kopyala,
            vs_oku,
            vs_ayarla,
            paket_yaz,
            olu_satirlari_temizle,
            kaynak_onar,
            open_yap,
            hedefli_ekle,
        ])
        .run(tauri::generate_context!())
        .expect("Fltr Fivemleaktr başlatılamadı");
}
