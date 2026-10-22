use std::collections::{BTreeMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use flate2::read::DeflateDecoder;
use serde::{Deserialize, Serialize};

use crate::oiv::{self, Paket};
use crate::rpf::{self, KayitTuru};
use crate::{Hata, Sonuc, bozuk};

#[derive(Serialize, Clone, Debug)]
pub struct ModBilgi {
    pub dosya: String,
    pub yol: String,
    pub acik: bool,
    pub boyut: u64,
    pub kullanilan: u64,
    pub sifreleme: String,
    pub dosya_sayisi: usize,
    pub degisim: i64,
    pub paket: Option<Paket>,
    pub eksik_kaynak: Vec<String>,
    pub hata: Option<String>,
    /// FiveM'in paketi yüklemesini engelleyen durumlar
    pub engeller: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Cakisma {
    pub hedef: String,
    pub modlar: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ModRaporu {
    pub klasor: String,
    pub kapali_klasor: String,
    pub modlar: Vec<ModBilgi>,
    pub cakismalar: Vec<Cakisma>,
}

pub fn varsayilan_klasor() -> Option<PathBuf> {
    let yerel = std::env::var_os("LOCALAPPDATA")?;
    Some(Path::new(&yerel).join("FiveM").join("FiveM.app").join("mods"))
}

pub fn kapali_klasor(mods: &Path) -> PathBuf {
    mods.with_file_name("mods-kapali")
}

fn incele(yol: &Path, acik: bool) -> ModBilgi {
    let meta = fs::metadata(yol).ok();
    let mut bilgi = ModBilgi {
        dosya: yol.file_name().unwrap_or_default().to_string_lossy().into_owned(),
        yol: yol.to_string_lossy().into_owned(),
        acik,
        boyut: meta.as_ref().map_or(0, |m| m.len()),
        kullanilan: 0,
        sifreleme: String::new(),
        dosya_sayisi: 0,
        degisim: meta
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_secs() as i64),
        paket: None,
        eksik_kaynak: Vec::new(),
        hata: None,
        engeller: Vec::new(),
    };
    if let Err(e) = incele_ic(yol, &mut bilgi) {
        bilgi.hata = Some(e.to_string());
    }
    bilgi.engeller = fivem_engelleri(&bilgi);
    bilgi
}

/// FiveM mods paketi yükleyicisi (VFSRagePackfile7) yalnız OPEN ve CFXP başlıklı RPF7 kabul eder.
pub fn fivem_engelleri(b: &ModBilgi) -> Vec<String> {
    let mut v = Vec::new();
    let okunabildi_ya_da_sifreli = b.hata.is_none() || b.sifreleme == "NG" || b.sifreleme == "AES";
    if okunabildi_ya_da_sifreli && !b.sifreleme.is_empty() && b.sifreleme != "OPEN" && b.sifreleme != "CFXP" {
        v.push(format!(
            "FiveM yüklemez: şifreleme {} (yalnız OPEN/CFXP kabul ediliyor){}",
            b.sifreleme,
            if b.sifreleme == "şifresiz" { " — Fltr Fivemleaktr ile açıp OPEN yapabilirsin" } else { "" }
        ));
    }
    if b.hata.is_none() && b.paket.is_none() {
        v.push("assembly.xml yok: FiveM içeriği oyunda nereye koyacağını bilemez".into());
    }
    if let Some(p) = &b.paket
        && !p.hedefler.is_empty()
        && p.hedefler.iter().all(|h| h.sil || b.eksik_kaynak.contains(&h.kaynak))
    {
        v.push("assembly.xml'deki hiçbir kaynak pakette yok: mod oyunda hiçbir şeyi değiştirmez".into());
    }
    v
}

fn incele_ic(yol: &Path, bilgi: &mut ModBilgi) -> Sonuc<()> {
    let mut f = File::open(yol)?;
    let mut bas = [0u8; 16];
    f.read_exact(&mut bas).map_err(|_| Hata::RpfDegil)?;
    let adet = u32::from_le_bytes(bas[4..8].try_into().unwrap()) as usize;
    let ad_boyu = u32::from_le_bytes(bas[8..12].try_into().unwrap()) as usize;
    bilgi.sifreleme = rpf::sifreleme_adi(u32::from_le_bytes(bas[12..16].try_into().unwrap())).to_string();
    let baslik_boyu = 16 + adet.min(1_000_000) * 16 + ad_boyu.min(1 << 24);
    let mut baslik = vec![0u8; baslik_boyu];
    f.seek(SeekFrom::Start(0))?;
    f.read_exact(&mut baslik).map_err(|_| bozuk("başlık dosyadan uzun"))?;
    let tablo = rpf::tablo_oku(&baslik)?;

    let mut yollar = vec![String::new(); tablo.kayitlar.len()];
    let mut kullanilan = baslik_boyu.div_ceil(512) * 512;
    let mut dosyalar = HashSet::new();
    let mut assembly = None;
    for (i, k) in tablo.kayitlar.iter().enumerate() {
        match k.tur {
            KayitTuru::Dizin { ilk, adet } => {
                for j in ilk..(ilk + adet).min(tablo.kayitlar.len()) {
                    if j > i {
                        yollar[j] = if yollar[i].is_empty() {
                            tablo.kayitlar[j].ad.clone()
                        } else {
                            format!("{}/{}", yollar[i], tablo.kayitlar[j].ad)
                        };
                    }
                }
            }
            KayitTuru::Dosya { ofs, kayitli, sikisik, .. } => {
                kullanilan += kayitli.div_ceil(512) * 512;
                bilgi.dosya_sayisi += 1;
                let y = yollar[i].to_lowercase();
                if y == "assembly.xml" {
                    assembly = Some((ofs, kayitli, sikisik));
                }
                dosyalar.insert(y);
            }
        }
    }
    bilgi.kullanilan = kullanilan as u64;

    if let Some((ofs, kayitli, sikisik)) = assembly {
        let mut ham = vec![0u8; kayitli];
        f.seek(SeekFrom::Start(ofs as u64))?;
        f.read_exact(&mut ham)?;
        let xml = if sikisik {
            let mut v = Vec::new();
            DeflateDecoder::new(&ham[..]).read_to_end(&mut v).map_err(|e| bozuk(e.to_string()))?;
            v
        } else {
            ham
        };
        let paket = oiv::coz(&String::from_utf8_lossy(&xml))?;
        bilgi.eksik_kaynak = paket
            .hedefler
            .iter()
            .filter(|h| !h.sil && !dosyalar.contains(&format!("content/{}", h.kaynak)))
            .map(|h| h.kaynak.clone())
            .collect();
        bilgi.paket = Some(paket);
    }
    Ok(())
}

fn rpfler(klasor: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(klasor)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().is_some_and(|e| e.eq_ignore_ascii_case("rpf")))
        .collect();
    v.sort_by_key(|p| p.file_name().map(|n| n.to_ascii_lowercase()));
    v
}

pub fn tara(mods: &Path) -> ModRaporu {
    let kapali = kapali_klasor(mods);
    let mut modlar: Vec<ModBilgi> = rpfler(mods).iter().map(|p| incele(p, true)).collect();
    modlar.extend(rpfler(&kapali).iter().map(|p| incele(p, false)));

    let mut hedefler: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for m in modlar.iter().filter(|m| m.acik) {
        let Some(p) = &m.paket else { continue };
        let mut gorulen = HashSet::new();
        for h in p.hedefler.iter().filter(|h| !h.sil && !m.eksik_kaynak.contains(&h.kaynak)) {
            let a = h.anahtar();
            if gorulen.insert(a.clone()) {
                hedefler.entry(a).or_default().push(m.dosya.clone());
            }
        }
    }
    let cakismalar = hedefler
        .into_iter()
        .filter(|(_, m)| m.len() > 1)
        .map(|(hedef, modlar)| Cakisma { hedef, modlar })
        .collect();

    ModRaporu {
        klasor: mods.to_string_lossy().into_owned(),
        kapali_klasor: kapali.to_string_lossy().into_owned(),
        modlar,
        cakismalar,
    }
}

#[derive(Serialize)]
pub struct AyarFarki {
    pub anahtar: String,
    /// her modun değeri, `kaynaklar` sırasıyla; modda yoksa None
    pub degerler: Vec<Option<String>>,
}

#[derive(Serialize)]
pub struct CakismaKaynagi {
    pub mod_dosyasi: String,
    pub paket_adi: Option<String>,
    pub icerik_yolu: Option<String>,
    pub boyut: usize,
    /// içerik özeti; aynı olanlar aynı değeri taşır
    pub ozet: Option<String>,
    pub hata: Option<String>,
}

#[derive(Serialize)]
pub struct CakismaAyrintisi {
    pub hedef: String,
    pub kaynaklar: Vec<CakismaKaynagi>,
    pub hepsi_ayni: bool,
    /// hedef visualsettings.dat ise farklı değerli anahtarlar
    pub ayar_farklari: Vec<AyarFarki>,
    pub ayar_farki_sayisi: usize,
    /// hedef ytd ise içeriği farklı ya da yalnız bazı modlarda olan dokular
    pub doku_farklari: Vec<String>,
    /// metin ya da meta (XML'e çevrilerek) dosyalarda her modda bulunmayan satırlar; `var` kaynak sırasıyla
    pub satir_farklari: Vec<SatirFarki>,
    pub satir_farki_sayisi: usize,
}

#[derive(Serialize)]
pub struct SatirFarki {
    pub satir: String,
    pub var: Vec<bool>,
}

/// Aynı oyun dosyasını değiştiren modlardaki kopyaları karşılaştırır.
pub fn cakisma_incele(mods: &Path, hedef: &str, dosyalar: &[String]) -> CakismaAyrintisi {
    use std::hash::{Hash, Hasher};
    let hedef_k = hedef.to_lowercase();
    let mut kaynaklar = Vec::new();
    let mut veriler: Vec<Option<Vec<u8>>> = Vec::new();
    for dosya in dosyalar {
        let yol = mods.join(dosya);
        let oku = || -> Sonuc<(Option<String>, String, Vec<u8>)> {
            let arsiv = rpf::Arsiv::oku(std::sync::Arc::from(fs::read(&yol)?))?;
            let xml = arsiv.dosya("assembly.xml")?.veri()?;
            let paket = oiv::coz(&String::from_utf8_lossy(&xml))?;
            let h = paket
                .hedefler
                .iter()
                .find(|h| !h.sil && h.anahtar() == hedef_k)
                .ok_or_else(|| Hata::Yok(format!("{hedef} eşlemesi")))?;
            let icerik = format!("content/{}", h.kaynak);
            let veri = arsiv.dosya(&icerik)?.veri()?.into_owned();
            Ok((Some(paket.ad), icerik, veri))
        };
        match oku() {
            Ok((paket_adi, icerik, veri)) => {
                let mut s = std::collections::hash_map::DefaultHasher::new();
                veri.hash(&mut s);
                kaynaklar.push(CakismaKaynagi {
                    mod_dosyasi: dosya.clone(),
                    paket_adi,
                    icerik_yolu: Some(icerik),
                    boyut: veri.len(),
                    ozet: Some(format!("{:016x}", s.finish())),
                    hata: None,
                });
                veriler.push(Some(veri));
            }
            Err(e) => {
                kaynaklar.push(CakismaKaynagi { mod_dosyasi: dosya.clone(), paket_adi: None, icerik_yolu: None, boyut: 0, ozet: None, hata: Some(e.to_string()) });
                veriler.push(None);
            }
        }
    }
    let hepsi_ayni = kaynaklar.len() > 1 && kaynaklar.iter().all(|k| k.ozet.is_some() && k.ozet == kaynaklar[0].ozet);
    let mut ayar_farklari = Vec::new();
    let mut ayar_farki_sayisi = 0;
    if hedef_k.ends_with("visualsettings.dat") && !hepsi_ayni {
        let haritalar: Vec<Option<std::collections::HashMap<String, String>>> = veriler
            .iter()
            .map(|v| {
                v.as_ref().map(|v| {
                    crate::vs::Ayarlar::coz(&String::from_utf8_lossy(v)).girdiler().into_iter().map(|g| (g.anahtar, g.deger)).collect()
                })
            })
            .collect();
        let mut anahtarlar: Vec<&String> = haritalar.iter().flatten().flat_map(|h| h.keys()).collect();
        anahtarlar.sort();
        anahtarlar.dedup();
        for a in anahtarlar {
            let degerler: Vec<Option<String>> = haritalar.iter().map(|h| h.as_ref().and_then(|h| h.get(a).cloned())).collect();
            let sayisal = |d: &Option<String>| d.as_deref().and_then(crate::vs::sayi);
            let ayni = degerler.windows(2).all(|w| w[0] == w[1] || (sayisal(&w[0]).is_some() && sayisal(&w[0]) == sayisal(&w[1])));
            if !ayni {
                ayar_farki_sayisi += 1;
                if ayar_farklari.len() < 200 {
                    ayar_farklari.push(AyarFarki { anahtar: a.clone(), degerler });
                }
            }
        }
    }
    let mut doku_farklari = Vec::new();
    if hedef_k.ends_with(".ytd") && !hepsi_ayni {
        let sozlukler: Vec<std::collections::HashMap<String, u64>> = veriler
            .iter()
            .map(|v| {
                let Some(y) = v.as_ref().and_then(|v| crate::ytd::Ytd::coz(v).ok()) else { return Default::default() };
                (0..y.dokular.len())
                    .map(|i| {
                        let mut s = std::collections::hash_map::DefaultHasher::new();
                        y.ham_veri(i).unwrap_or_default().hash(&mut s);
                        (y.dokular[i].genislik, y.dokular[i].yukseklik).hash(&mut s);
                        (y.dokular[i].ad.to_lowercase(), s.finish())
                    })
                    .collect()
            })
            .collect();
        let mut adlar: Vec<&String> = sozlukler.iter().flat_map(|h| h.keys()).collect();
        adlar.sort();
        adlar.dedup();
        doku_farklari = adlar
            .into_iter()
            .filter(|a| sozlukler.iter().map(|h| h.get(*a)).collect::<Vec<_>>().windows(2).any(|w| w[0] != w[1]))
            .cloned()
            .collect();
    }
    let mut satir_farklari = Vec::new();
    let mut satir_farki_sayisi = 0;
    if !hepsi_ayni && ayar_farklari.is_empty() && doku_farklari.is_empty() {
        let metinler: Vec<Option<String>> = veriler
            .iter()
            .map(|v| {
                let v = v.as_ref()?;
                crate::model::meta_xml(v).ok().or_else(|| std::str::from_utf8(v).ok().filter(|m| !m.contains('\0')).map(str::to_string))
            })
            .collect();
        if metinler.iter().all(Option::is_some) {
            let kumeler: Vec<HashSet<&str>> = metinler.iter().flatten().map(|m| m.lines().map(str::trim).filter(|l| !l.is_empty()).collect()).collect();
            let mut gorulen = HashSet::new();
            for m in metinler.iter().flatten() {
                for l in m.lines().map(str::trim).filter(|l| !l.is_empty()) {
                    let var: Vec<bool> = kumeler.iter().map(|k| k.contains(l)).collect();
                    if var.iter().any(|x| !x) && gorulen.insert(l) {
                        satir_farki_sayisi += 1;
                        if satir_farklari.len() < 120 {
                            satir_farklari.push(SatirFarki { satir: l.to_string(), var });
                        }
                    }
                }
            }
        }
    }
    CakismaAyrintisi {
        hedef: hedef.to_string(),
        kaynaklar,
        hepsi_ayni,
        ayar_farklari,
        ayar_farki_sayisi,
        doku_farklari,
        satir_farklari,
        satir_farki_sayisi,
    }
}

pub fn ac_kapa(mods: &Path, dosya: &str, acik: bool) -> Sonuc<()> {
    if dosya.contains(['/', '\\']) || dosya.contains("..") {
        return Err(Hata::Gecersiz(format!("geçersiz dosya adı: {dosya}")));
    }
    let kapali = kapali_klasor(mods);
    let (kaynak, hedef) = if acik { (kapali.join(dosya), mods.join(dosya)) } else { (mods.join(dosya), kapali.join(dosya)) };
    if hedef.exists() {
        return Err(Hata::Gecersiz(format!("{} zaten var", hedef.display())));
    }
    fs::create_dir_all(hedef.parent().unwrap())?;
    kilit_kontrol(&kaynak)?;
    fs::rename(&kaynak, &hedef)?;
    Ok(())
}

/// Dosya başka bir süreçte (çoğunlukla FiveM) açıksa yazmayı baştan reddeder.
pub fn kilit_kontrol(yol: &Path) -> Sonuc<()> {
    if !yol.exists() {
        return Ok(());
    }
    let mut ac = OpenOptions::new();
    ac.read(true).write(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        ac.share_mode(0);
    }
    match ac.open(yol) {
        Ok(_) => Ok(()),
        Err(e) if e.raw_os_error() == Some(32) || e.raw_os_error() == Some(33) => Err(Hata::Gecersiz(format!(
            "{} başka bir programda açık — FiveM çalışıyorsa kapatıp tekrar dene",
            yol.file_name().unwrap_or_default().to_string_lossy()
        ))),
        Err(e) => Err(e.into()),
    }
}

pub fn guvenli_yaz(hedef: &Path, veri: &[u8]) -> Sonuc<()> {
    kilit_kontrol(hedef)?;
    let gecici = hedef.with_extension("tlk-yaziliyor");
    {
        let mut f = File::create(&gecici)?;
        f.write_all(veri)?;
        f.sync_all()?;
    }
    fs::rename(&gecici, hedef).inspect_err(|_| {
        let _ = fs::remove_file(&gecici);
    })?;
    Ok(())
}

/// Yedeğin yanına yazılan bilgi: yedeğin hangi dosyadan, ne zaman alındığı.
/// FiveM'de çok sayıda mod aynı adı taşır (her dlcpack'te `dlc.rpf`); ad tek
/// başına yedeği doğru dosyaya bağlamaya yetmez.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct YedekKaydi {
    pub kaynak: String,
    /// Unix zamanı, milisaniye
    pub zaman: i64,
}

#[derive(Serialize, Clone, Debug)]
pub struct YedekBilgi {
    pub yol: String,
    /// Asıl dosyanın adı (`dlc.rpf`)
    pub ad: String,
    /// Asıl dosyanın tam yolu; eski biçimdeki yedeklerde bilinmez
    pub kaynak: Option<String>,
    pub boyut: u64,
    /// Yedeğin alındığı an, Unix saniyesi
    pub zaman: i64,
}

/// Windows'un `\\?\` önekini atar, yol karşılaştırması için büyük/küçük harfi eşitler.
fn yol_metni(yol: &Path) -> String {
    let tam = fs::canonicalize(yol).unwrap_or_else(|_| yol.to_path_buf());
    let s = tam.to_string_lossy().into_owned();
    s.strip_prefix(r"\\?\").map(str::to_owned).unwrap_or(s)
}

/// Tam yoldan kısa ve kararlı bir iz (FNV-1a, 32 bit). Aynı adlı farklı dosyaların
/// yedeklerini ayırır.
fn yol_izi(yol_metni: &str) -> String {
    let mut h: u32 = 0x811c_9dc5;
    for b in yol_metni.to_lowercase().bytes() {
        h ^= u32::from(b);
        h = h.wrapping_mul(0x0100_0193);
    }
    format!("{h:08x}")
}

/// `dosya__iz__20261010-113015-123.rpf` ya da eski biçim `dosya__20261010-113015.rpf`.
fn yedek_adini_coz(govde: &str) -> Option<(String, Option<String>)> {
    let mut parcalar = govde.rsplitn(3, "__");
    let _damga = parcalar.next()?;
    let orta = parcalar.next()?;
    match parcalar.next() {
        Some(ad) if orta.len() == 8 && orta.bytes().all(|b| b.is_ascii_hexdigit()) => Some((ad.to_string(), Some(orta.to_string()))),
        Some(ad) => Some((format!("{ad}__{orta}"), None)),
        None => Some((orta.to_string(), None)),
    }
}

/// Dosyanın o anki hâlini yedek klasörüne alır ve aynı dosyanın en yeni `sakla`
/// yedeğini tutar. Yedekler tam yola göre gruplanır: aynı adlı başka bir modun
/// yedeklerine dokunulmaz.
pub fn yedekle(kaynak: &Path, yedek_klasoru: &Path, sakla: usize) -> Sonuc<Option<PathBuf>> {
    if !kaynak.exists() {
        return Ok(None);
    }
    fs::create_dir_all(yedek_klasoru)?;
    let govde = kaynak.file_stem().unwrap_or_default().to_string_lossy().into_owned();
    let tam = yol_metni(kaynak);
    let onek = format!("{govde}__{}__", yol_izi(&tam));

    // Aynı milisaniyede ikinci bir yedek öncekinin üstüne yazmasın.
    let (hedef, an) = loop {
        let an = chrono::Local::now();
        let h = yedek_klasoru.join(format!("{onek}{}.rpf", an.format("%Y%m%d-%H%M%S-%3f")));
        if !h.exists() {
            break (h, an);
        }
        std::thread::sleep(std::time::Duration::from_millis(2));
    };
    fs::copy(kaynak, &hedef)?;
    let kayit = YedekKaydi { kaynak: tam, zaman: an.timestamp_millis() };
    fs::write(hedef.with_extension("json"), serde_json::to_vec_pretty(&kayit).map_err(|e| Hata::Gecersiz(e.to_string()))?)?;

    let mut eskiler: Vec<PathBuf> = fs::read_dir(yedek_klasoru)?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("rpf")))
        .filter(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with(&onek)))
        .collect();
    eskiler.sort();
    let fazla = eskiler.len().saturating_sub(sakla);
    for p in &eskiler[..fazla] {
        let _ = fs::remove_file(p);
        let _ = fs::remove_file(p.with_extension("json"));
    }
    Ok(Some(hedef))
}

/// Yedek klasöründeki yedekler, en yeni önce. Yeni biçimde asıl yol ve alınma
/// zamanı yanındaki bilgi dosyasından gelir; eski biçimde ad ve dosya zamanı kullanılır.
pub fn yedekleri_oku(yedek_klasoru: &Path) -> Vec<YedekBilgi> {
    let mut v: Vec<YedekBilgi> = fs::read_dir(yedek_klasoru)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let yol = e.path();
            if !yol.extension().is_some_and(|x| x.eq_ignore_ascii_case("rpf")) {
                return None;
            }
            let govde = yol.file_stem()?.to_string_lossy().into_owned();
            let (ad, _) = yedek_adini_coz(&govde)?;
            let meta = e.metadata().ok()?;
            let kayit: Option<YedekKaydi> = fs::read(yol.with_extension("json")).ok().and_then(|b| serde_json::from_slice(&b).ok());
            let dosya_zamani = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_secs() as i64);
            Some(YedekBilgi {
                yol: yol.to_string_lossy().into_owned(),
                ad: format!("{ad}.rpf"),
                kaynak: kayit.as_ref().map(|k| k.kaynak.clone()),
                boyut: meta.len(),
                zaman: kayit.map_or(dosya_zamani, |k| k.zaman / 1000),
            })
        })
        .collect();
    v.sort_by_key(|y| std::cmp::Reverse(y.zaman));
    v
}

#[cfg(test)]
mod yedek_testleri {
    use super::*;

    fn gecici(ad: &str) -> PathBuf {
        let k = std::env::temp_dir().join(format!("fltr-rpf-test-{ad}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&k);
        fs::create_dir_all(&k).unwrap();
        k
    }

    #[test]
    fn ayni_adli_modlar_birbirinin_yedegini_silmez() {
        let k = gecici("ayni-ad");
        let (a, b) = (k.join("dlcpacks/arac/dlc.rpf"), k.join("dlcpacks/silah/dlc.rpf"));
        for p in [&a, &b] {
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, p.to_string_lossy().as_bytes()).unwrap();
        }
        let yedek = k.join("yedek");
        for _ in 0..3 {
            yedekle(&a, &yedek, 3).unwrap();
        }
        for _ in 0..5 {
            yedekle(&b, &yedek, 3).unwrap();
        }
        let liste = yedekleri_oku(&yedek);
        let say = |p: &Path| liste.iter().filter(|y| y.kaynak.as_deref() == Some(yol_metni(p).as_str())).count();
        assert_eq!(say(&a), 3, "silah/dlc.rpf yedekleri arac/dlc.rpf yedeklerini silmemeli");
        assert_eq!(say(&b), 3);
        assert!(liste.iter().all(|y| y.ad == "dlc.rpf"));
        // Bilgi dosyaları döndürmeyle birlikte silinir.
        let json = fs::read_dir(&yedek).unwrap().flatten().filter(|e| e.path().extension().is_some_and(|x| x == "json")).count();
        assert_eq!(json, 6);
        let _ = fs::remove_dir_all(&k);
    }

    #[test]
    fn arka_arkaya_yedek_oncekini_ezmez() {
        let k = gecici("ard-arda");
        let a = k.join("mod.rpf");
        let yedek = k.join("yedek");
        fs::write(&a, b"ilk").unwrap();
        let y1 = yedekle(&a, &yedek, 20).unwrap().unwrap();
        fs::write(&a, b"ikinci").unwrap();
        let y2 = yedekle(&a, &yedek, 20).unwrap().unwrap();
        assert_ne!(y1, y2);
        assert_eq!(fs::read(&y1).unwrap(), b"ilk");
        assert_eq!(fs::read(&y2).unwrap(), b"ikinci");
        let _ = fs::remove_dir_all(&k);
    }

    #[test]
    fn eski_bicim_okunur() {
        assert_eq!(yedek_adini_coz("hud__20260926-101500"), Some(("hud".into(), None)));
        assert_eq!(yedek_adini_coz("dlc__0a1b2c3d__20261010-113015-123"), Some(("dlc".into(), Some("0a1b2c3d".into()))));
        assert_eq!(yedek_adini_coz("cift__alt__20260926-101500"), Some(("cift__alt".into(), None)));
    }
}
