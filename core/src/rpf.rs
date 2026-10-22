use std::borrow::Cow;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::Arc;

use flate2::Compression;
use flate2::read::DeflateDecoder;
use flate2::write::DeflateEncoder;

use crate::{Hata, Sonuc, bozuk, rsc, u32_oku, u64_oku};

pub const MAGIC: u32 = 0x5250_4637;
pub const SIFRE_YOK: u32 = 0;
pub const SIFRE_OPEN: u32 = 0x4E45_504F;
pub const SIFRE_CFXP: u32 = 0x5058_4643;
const SIFRE_AES: u32 = 0x0FFF_FFF9;
const SIFRE_NG: u32 = 0x0FEF_FFFF;
const DIZIN_ISARETI: u32 = 0x7FFF_FF00;
const BLOK: usize = 512;
const EN_DERIN_IC_ARSIV: u8 = 4;
const EN_DERIN_DIZIN: usize = 128;

pub fn sifreleme_adi(s: u32) -> &'static str {
    match s {
        SIFRE_OPEN => "OPEN",
        SIFRE_CFXP => "CFXP",
        SIFRE_YOK => "şifresiz",
        SIFRE_AES => "AES",
        SIFRE_NG => "NG",
        _ => "bilinmiyor",
    }
}

fn hizala(n: usize) -> usize {
    n.div_ceil(BLOK) * BLOK
}

pub fn ad_duzelt(ad: &str) -> String {
    ad.trim().to_lowercase()
}

#[derive(Clone)]
enum Icerik {
    Kayitli {
        kaynak: Arc<[u8]>,
        bas: usize,
        uzunluk: usize,
        sikisik: bool,
        acik_boyut: usize,
        /// 16MB üstü kaynaklarda gerçek boyut RSC7 başlığının 2/5/7/14. baytlarına gömülüdür.
        baslik_gomulu: bool,
    },
    Ham(Arc<[u8]>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DosyaTuru {
    Ikili { sifreli: u32 },
    Kaynak { sistem: u32, grafik: u32 },
}

#[derive(Clone)]
pub struct Dosya {
    pub ad: String,
    pub tur: DosyaTuru,
    icerik: Icerik,
}

impl Dosya {
    pub fn yeni(ad: &str, veri: Vec<u8>) -> Dosya {
        let mut d = Dosya {
            ad: ad_duzelt(ad),
            tur: DosyaTuru::Ikili { sifreli: 0 },
            icerik: Icerik::Ham(Arc::from([])),
        };
        d.degistir(veri);
        d
    }

    pub fn veri(&self) -> Sonuc<Cow<'_, [u8]>> {
        match &self.icerik {
            Icerik::Ham(v) => Ok(Cow::Borrowed(v)),
            Icerik::Kayitli { kaynak, bas, uzunluk, sikisik, acik_boyut, baslik_gomulu } => {
                let ham = &kaynak[*bas..*bas + *uzunluk];
                if let (true, DosyaTuru::Kaynak { sistem, grafik }) = (*baslik_gomulu, self.tur) {
                    let mut v = ham.to_vec();
                    if v.len() >= 16 {
                        for (i, x) in [rsc::RSC7, rsc::surum(sistem, grafik), sistem, grafik].into_iter().enumerate() {
                            v[i * 4..i * 4 + 4].copy_from_slice(&x.to_le_bytes());
                        }
                    }
                    return Ok(Cow::Owned(v));
                }
                if *sikisik && matches!(self.tur, DosyaTuru::Ikili { .. }) {
                    let mut cikti = Vec::with_capacity(*acik_boyut);
                    DeflateDecoder::new(ham)
                        .read_to_end(&mut cikti)
                        .map_err(|e| bozuk(format!("{} açılamadı: {e}", self.ad)))?;
                    Ok(Cow::Owned(cikti))
                } else {
                    Ok(Cow::Borrowed(ham))
                }
            }
        }
    }

    pub fn boyut(&self) -> usize {
        match &self.icerik {
            Icerik::Ham(v) => v.len(),
            Icerik::Kayitli { acik_boyut, .. } => *acik_boyut,
        }
    }

    pub fn kayitli_boyut(&self) -> usize {
        match &self.icerik {
            Icerik::Ham(v) => v.len(),
            Icerik::Kayitli { uzunluk, .. } => *uzunluk,
        }
    }

    pub fn degisti(&self) -> bool {
        matches!(self.icerik, Icerik::Ham(_))
    }

    pub fn kaynak_mi(&self) -> bool {
        matches!(self.tur, DosyaTuru::Kaynak { .. })
    }

    pub fn degistir(&mut self, veri: Vec<u8>) {
        self.tur = match rsc::baslik(&veri) {
            Some((sistem, grafik)) => DosyaTuru::Kaynak { sistem, grafik },
            None => DosyaTuru::Ikili { sifreli: 0 },
        };
        self.icerik = Icerik::Ham(veri.into());
    }
}

#[derive(Clone, Default)]
pub struct Dizin {
    pub ad: String,
    pub cocuklar: Vec<Dugum>,
}

#[derive(Clone)]
pub struct IcArsiv {
    pub ad: String,
    pub arsiv: Arsiv,
}

#[derive(Clone)]
pub enum Dugum {
    Dizin(Dizin),
    Dosya(Dosya),
    Arsiv(IcArsiv),
}

impl Dugum {
    pub fn ad(&self) -> &str {
        match self {
            Dugum::Dizin(d) => &d.ad,
            Dugum::Dosya(d) => &d.ad,
            Dugum::Arsiv(a) => &a.ad,
        }
    }

    fn ad_mut(&mut self) -> &mut String {
        match self {
            Dugum::Dizin(d) => &mut d.ad,
            Dugum::Dosya(d) => &mut d.ad,
            Dugum::Arsiv(a) => &mut a.ad,
        }
    }
}

pub struct Kayit {
    pub ad: String,
    pub tur: KayitTuru,
}

pub enum KayitTuru {
    Dizin { ilk: usize, adet: usize },
    Dosya { ofs: usize, kayitli: usize, acik: usize, sikisik: bool, tur: DosyaTuru, baslik_gomulu: bool },
}

pub struct Tablo {
    pub sifreleme: u32,
    pub kayitlar: Vec<Kayit>,
    pub baslik_boyutu: usize,
}

/// `b` en az başlık bölgesini içermeli. Veri bölgesi yoksa 0xFFFFFF boyutlu kaynakların
/// gerçek boyutu okunamaz ve 0 kalır.
pub fn tablo_oku(b: &[u8]) -> Sonuc<Tablo> {
    if u32_oku(b, 0) != Some(MAGIC) {
        if b.len() >= 16 && b[..16].iter().all(|&x| x == 0) {
            return Err(bozuk("dosyanın başı tamamen boş (sıfır); dosya bozuk ya da yarım indirilmiş"));
        }
        return Err(Hata::RpfDegil);
    }
    let adet = u32_oku(b, 4).ok_or_else(|| bozuk("başlık kısa"))? as usize;
    let ad_boyu = u32_oku(b, 8).ok_or_else(|| bozuk("başlık kısa"))? as usize;
    let sifreleme = u32_oku(b, 12).ok_or_else(|| bozuk("başlık kısa"))?;
    match sifreleme {
        SIFRE_AES => return Err(Hata::Sifreli("AES")),
        SIFRE_NG => return Err(Hata::Sifreli("NG")),
        _ => {}
    }
    if adet == 0 || adet > 1_000_000 {
        return Err(bozuk(format!("kayıt sayısı anlamsız: {adet}")));
    }
    let ad_bas = 16 + adet * 16;
    let adlar = b
        .get(ad_bas..ad_bas + ad_boyu)
        .ok_or_else(|| bozuk("kayıt tablosu dosyadan uzun"))?;
    let ad_al = |o: usize| -> Sonuc<String> {
        let kalan = adlar.get(o..).ok_or_else(|| bozuk("ad ofseti taşıyor"))?;
        let son = kalan.iter().position(|&c| c == 0).unwrap_or(kalan.len());
        Ok(String::from_utf8_lossy(&kalan[..son]).into_owned())
    };

    let mut kayitlar = Vec::with_capacity(adet);
    for i in 0..adet {
        let o = 16 + i * 16;
        let y = u64_oku(b, o).unwrap();
        let x = u32_oku(b, o + 4).unwrap();
        let s8 = u32_oku(b, o + 8).unwrap();
        let s12 = u32_oku(b, o + 12).unwrap();
        let kayit = if x == DIZIN_ISARETI {
            Kayit {
                ad: ad_al(u32_oku(b, o).unwrap() as usize)?,
                tur: KayitTuru::Dizin { ilk: s8 as usize, adet: s12 as usize },
            }
        } else if x & 0x8000_0000 == 0 {
            let kayitli = ((y >> 16) & 0xFF_FFFF) as usize;
            Kayit {
                ad: ad_al((y & 0xFFFF) as usize)?,
                tur: KayitTuru::Dosya {
                    ofs: ((y >> 40) & 0xFF_FFFF) as usize * BLOK,
                    kayitli: if kayitli == 0 { s8 as usize } else { kayitli },
                    acik: s8 as usize,
                    sikisik: kayitli != 0,
                    tur: DosyaTuru::Ikili { sifreli: s12 },
                    baslik_gomulu: false,
                },
            }
        } else {
            let ofs = ((y >> 40) & 0x7F_FFFF) as usize * BLOK;
            let mut kayitli = ((y >> 16) & 0xFF_FFFF) as usize;
            let baslik_gomulu = kayitli == 0xFF_FFFF;
            if baslik_gomulu {
                kayitli = match b.get(ofs..ofs + 16) {
                    Some(h) => {
                        (h[7] as usize) | (h[14] as usize) << 8 | (h[5] as usize) << 16 | (h[2] as usize) << 24
                    }
                    None => 0,
                };
            }
            Kayit {
                ad: ad_al((y & 0xFFFF) as usize)?,
                tur: KayitTuru::Dosya {
                    ofs,
                    kayitli,
                    acik: kayitli,
                    sikisik: true,
                    tur: DosyaTuru::Kaynak { sistem: s8, grafik: s12 },
                    baslik_gomulu,
                },
            }
        };
        kayitlar.push(kayit);
    }
    if !matches!(kayitlar[0].tur, KayitTuru::Dizin { .. }) {
        return Err(bozuk("kök kayıt dizin değil"));
    }
    Ok(Tablo { sifreleme, kayitlar, baslik_boyutu: ad_bas + ad_boyu })
}

/// Dizin tablosu bir ağaç olmalı: her kayıt en çok bir dizinin çocuğu, iç içelik sınırlı.
/// Bozuk bir tablo özyinelemeli kurmayı yığın taşmasına ya da üstel büyümeye sürüklemesin.
fn agac_dogrula(t: &Tablo) -> Sonuc<()> {
    let mut goruldu = vec![false; t.kayitlar.len()];
    goruldu[0] = true;
    let mut kuyruk = VecDeque::from([(0usize, 0usize)]);
    while let Some((i, seviye)) = kuyruk.pop_front() {
        let KayitTuru::Dizin { ilk, adet } = t.kayitlar[i].tur else { continue };
        if adet == 0 {
            continue;
        }
        if ilk <= i || ilk + adet > t.kayitlar.len() {
            return Err(bozuk(format!("dizin tablosu tutarsız: {}", t.kayitlar[i].ad)));
        }
        if seviye >= EN_DERIN_DIZIN {
            return Err(bozuk("dizinler anlamsız derecede iç içe"));
        }
        for (j, g) in goruldu.iter_mut().enumerate().skip(ilk).take(adet) {
            if std::mem::replace(g, true) {
                return Err(bozuk(format!("dizin tablosunda bir kayıt birden çok dizinde: {}", t.kayitlar[j].ad)));
            }
            kuyruk.push_back((j, seviye + 1));
        }
    }
    Ok(())
}

#[derive(Clone)]
pub struct Arsiv {
    pub sifreleme: u32,
    pub kok: Dizin,
}

fn yol_parcalari(yol: &str) -> Vec<&str> {
    yol.split(['/', '\\']).filter(|p| !p.is_empty()).collect()
}

impl Dizin {
    pub fn cocuk(&self, ad: &str) -> Option<&Dugum> {
        self.cocuklar.iter().find(|c| c.ad().eq_ignore_ascii_case(ad))
    }

    fn cocuk_sira(&self, ad: &str) -> Option<usize> {
        self.cocuklar.iter().position(|c| c.ad().eq_ignore_ascii_case(ad))
    }

    fn bul_parca(&self, p: &[&str]) -> Option<&Dugum> {
        let (ilk, kalan) = p.split_first()?;
        let c = self.cocuk(ilk)?;
        if kalan.is_empty() {
            return Some(c);
        }
        match c {
            Dugum::Dizin(d) => d.bul_parca(kalan),
            Dugum::Arsiv(a) => a.arsiv.kok.bul_parca(kalan),
            Dugum::Dosya(_) => None,
        }
    }

    fn dizin_parca_mut(&mut self, p: &[&str]) -> Option<&mut Dizin> {
        let Some((ilk, kalan)) = p.split_first() else {
            return Some(self);
        };
        let i = self.cocuk_sira(ilk)?;
        match &mut self.cocuklar[i] {
            Dugum::Dizin(d) => d.dizin_parca_mut(kalan),
            Dugum::Arsiv(a) => a.arsiv.kok.dizin_parca_mut(kalan),
            Dugum::Dosya(_) => None,
        }
    }

    fn gez<'a>(&'a self, onek: &str, f: &mut dyn FnMut(&str, &'a Dugum)) {
        for c in &self.cocuklar {
            let yol = if onek.is_empty() { c.ad().to_string() } else { format!("{onek}/{}", c.ad()) };
            f(&yol, c);
            match c {
                Dugum::Dizin(d) => d.gez(&yol, f),
                Dugum::Arsiv(a) => a.arsiv.kok.gez(&yol, f),
                Dugum::Dosya(_) => {}
            }
        }
    }
}

impl Arsiv {
    pub fn yeni() -> Arsiv {
        Arsiv { sifreleme: SIFRE_OPEN, kok: Dizin::default() }
    }

    pub fn oku(kaynak: Arc<[u8]>) -> Sonuc<Arsiv> {
        let uzunluk = kaynak.len();
        Self::icten_oku(&kaynak, 0, uzunluk, 0)
    }

    fn icten_oku(kaynak: &Arc<[u8]>, taban: usize, uzunluk: usize, derinlik: u8) -> Sonuc<Arsiv> {
        let b = &kaynak[taban..taban + uzunluk];
        let tablo = tablo_oku(b)?;
        agac_dogrula(&tablo)?;
        let mut kok = match Self::kur(kaynak, taban, uzunluk, &tablo, 0, derinlik)? {
            Dugum::Dizin(d) => d,
            _ => unreachable!(),
        };
        kok.ad.clear();
        Ok(Arsiv { sifreleme: tablo.sifreleme, kok })
    }

    fn kur(kaynak: &Arc<[u8]>, taban: usize, uzunluk: usize, t: &Tablo, i: usize, derinlik: u8) -> Sonuc<Dugum> {
        let k = &t.kayitlar[i];
        match k.tur {
            KayitTuru::Dizin { ilk, adet } => {
                if adet > 0 && (ilk <= i || ilk + adet > t.kayitlar.len()) {
                    return Err(bozuk(format!("dizin tablosu tutarsız: {}", k.ad)));
                }
                let cocuklar = (ilk..ilk + adet)
                    .map(|j| Self::kur(kaynak, taban, uzunluk, t, j, derinlik))
                    .collect::<Sonuc<Vec<_>>>()?;
                Ok(Dugum::Dizin(Dizin { ad: k.ad.clone(), cocuklar }))
            }
            KayitTuru::Dosya { ofs, mut kayitli, mut acik, sikisik, tur, baslik_gomulu } => {
                let rpf_adi = k.ad.to_ascii_lowercase().ends_with(".rpf");
                let mut kirpik = false;
                if ofs + kayitli > uzunluk {
                    // Bazı araçlar arşivin son 512 baytlık bloğunun dolgusunu kırpıyor; FiveM bu
                    // dosyaları yükler. Sondaki kayıt bir iç arşivse boyutu blok katıdır ve sonu
                    // dolgudur: eldeki baytlarla okunur, kaydedince arşiv baştan, tam boyutuyla
                    // yazılır. Başka her dosyada kırpılan kısım gerçek veridir, okunmaz.
                    let tasan = ofs + kayitli - uzunluk;
                    let ic_arsiv_adayi = !sikisik
                        && ofs < uzunluk
                        && rpf_adi
                        && u32_oku(&kaynak[taban + ofs..taban + uzunluk], 0) == Some(MAGIC);
                    if !ic_arsiv_adayi || tasan >= BLOK {
                        return Err(bozuk(format!("{} arşivin dışına taşıyor", k.ad)));
                    }
                    kayitli = uzunluk - ofs;
                    acik = acik.min(kayitli);
                    kirpik = true;
                }
                let ic_arsiv = matches!(tur, DosyaTuru::Ikili { .. })
                    && !sikisik
                    && derinlik < EN_DERIN_IC_ARSIV
                    && rpf_adi
                    && u32_oku(&kaynak[taban + ofs..], 0) == Some(MAGIC);
                if ic_arsiv {
                    match Self::icten_oku(kaynak, taban + ofs, kayitli, derinlik + 1) {
                        Ok(arsiv) => return Ok(Dugum::Arsiv(IcArsiv { ad: k.ad.clone(), arsiv })),
                        // Kırpılmış kayıt düz dosya olarak alınırsa kaydedince kısa hâli kalıcı olur.
                        Err(e) if kirpik => return Err(bozuk(format!("{} arşivin dışına taşıyor: {e}", k.ad))),
                        Err(_) => {}
                    }
                }
                if kirpik {
                    return Err(bozuk(format!("{} arşivin dışına taşıyor", k.ad)));
                }
                Ok(Dugum::Dosya(Dosya {
                    ad: k.ad.clone(),
                    tur,
                    icerik: Icerik::Kayitli {
                        kaynak: kaynak.clone(),
                        bas: taban + ofs,
                        uzunluk: kayitli,
                        sikisik,
                        acik_boyut: acik,
                        baslik_gomulu,
                    },
                }))
            }
        }
    }

    pub fn bul(&self, yol: &str) -> Option<&Dugum> {
        self.kok.bul_parca(&yol_parcalari(yol))
    }

    pub fn dosya(&self, yol: &str) -> Sonuc<&Dosya> {
        match self.bul(yol) {
            Some(Dugum::Dosya(d)) => Ok(d),
            _ => Err(Hata::Yok(yol.to_string())),
        }
    }

    pub fn dizin_mut(&mut self, yol: &str) -> Option<&mut Dizin> {
        self.kok.dizin_parca_mut(&yol_parcalari(yol))
    }

    pub fn dosya_mut(&mut self, yol: &str) -> Sonuc<&mut Dosya> {
        let p = yol_parcalari(yol);
        let (son, ust) = p.split_last().ok_or_else(|| Hata::Yok(yol.to_string()))?;
        let dizin = self.kok.dizin_parca_mut(ust).ok_or_else(|| Hata::Yok(yol.to_string()))?;
        let i = dizin.cocuk_sira(son).ok_or_else(|| Hata::Yok(yol.to_string()))?;
        match &mut dizin.cocuklar[i] {
            Dugum::Dosya(d) => Ok(d),
            _ => Err(Hata::Gecersiz(format!("{yol} bir dosya değil"))),
        }
    }

    pub fn dizin_olustur(&mut self, yol: &str) -> Sonuc<()> {
        let mut dizin = &mut self.kok;
        for parca in yol_parcalari(yol) {
            let i = match dizin.cocuk_sira(parca) {
                Some(i) => i,
                None => {
                    dizin.cocuklar.push(Dugum::Dizin(Dizin { ad: ad_duzelt(parca), cocuklar: Vec::new() }));
                    dizin.cocuklar.len() - 1
                }
            };
            dizin = match &mut dizin.cocuklar[i] {
                Dugum::Dizin(d) => d,
                Dugum::Arsiv(a) => &mut a.arsiv.kok,
                Dugum::Dosya(_) => return Err(Hata::Gecersiz(format!("{parca} bir dosya, dizin açılamaz"))),
            };
        }
        Ok(())
    }

    /// Aynı adlı düğüm varsa üzerine yazar; dizin yoksa oluşturur.
    pub fn koy(&mut self, dizin_yolu: &str, dugum: Dugum) -> Sonuc<()> {
        self.dizin_olustur(dizin_yolu)?;
        let dizin = self.dizin_mut(dizin_yolu).expect("az önce oluşturuldu");
        match dizin.cocuk_sira(dugum.ad()) {
            Some(i) => dizin.cocuklar[i] = dugum,
            None => dizin.cocuklar.push(dugum),
        }
        Ok(())
    }

    pub fn sil(&mut self, yol: &str) -> Sonuc<Dugum> {
        let p = yol_parcalari(yol);
        let (son, ust) = p.split_last().ok_or_else(|| Hata::Gecersiz("kök silinemez".into()))?;
        let dizin = self.kok.dizin_parca_mut(ust).ok_or_else(|| Hata::Yok(yol.to_string()))?;
        let i = dizin.cocuk_sira(son).ok_or_else(|| Hata::Yok(yol.to_string()))?;
        Ok(dizin.cocuklar.remove(i))
    }

    pub fn yeniden_adlandir(&mut self, yol: &str, yeni_ad: &str) -> Sonuc<()> {
        let yeni_ad = ad_duzelt(yeni_ad);
        if yeni_ad.is_empty() || yeni_ad.contains(['/', '\\']) {
            return Err(Hata::Gecersiz(format!("geçersiz ad: {yeni_ad}")));
        }
        let p = yol_parcalari(yol);
        let (son, ust) = p.split_last().ok_or_else(|| Hata::Gecersiz("kök adlandırılamaz".into()))?;
        let dizin = self.kok.dizin_parca_mut(ust).ok_or_else(|| Hata::Yok(yol.to_string()))?;
        if dizin.cocuk_sira(&yeni_ad).is_some_and(|j| !dizin.cocuklar[j].ad().eq_ignore_ascii_case(son)) {
            return Err(Hata::Gecersiz(format!("{yeni_ad} zaten var")));
        }
        let i = dizin.cocuk_sira(son).ok_or_else(|| Hata::Yok(yol.to_string()))?;
        *dizin.cocuklar[i].ad_mut() = yeni_ad;
        Ok(())
    }

    pub fn gez<'a>(&'a self, mut f: impl FnMut(&str, &'a Dugum)) {
        self.kok.gez("", &mut f);
    }

    pub fn yaz(&self) -> Sonuc<Vec<u8>> {
        enum Cikis<'a> {
            Dizin(&'a Dizin, usize, usize),
            Dosya(&'a Dosya),
            Arsiv(&'a IcArsiv),
        }
        let mut sira: Vec<(&str, Cikis)> = vec![("", Cikis::Dizin(&self.kok, 0, 0))];
        let mut kuyruk = VecDeque::from([0usize]);
        while let Some(i) = kuyruk.pop_front() {
            let Cikis::Dizin(d, _, _) = sira[i].1 else { continue };
            let mut cocuklar: Vec<&Dugum> = d.cocuklar.iter().collect();
            cocuklar.sort_by_cached_key(|c| c.ad().to_lowercase());
            if let Some(w) = cocuklar.windows(2).find(|w| w[0].ad().eq_ignore_ascii_case(w[1].ad())) {
                return Err(Hata::Gecersiz(format!("aynı dizinde iki kez: {}", w[0].ad())));
            }
            let ilk = sira.len();
            for c in &cocuklar {
                match c {
                    Dugum::Dizin(cd) => {
                        kuyruk.push_back(sira.len());
                        sira.push((&cd.ad, Cikis::Dizin(cd, 0, 0)));
                    }
                    Dugum::Dosya(f) => sira.push((&f.ad, Cikis::Dosya(f))),
                    Dugum::Arsiv(a) => sira.push((&a.ad, Cikis::Arsiv(a))),
                }
            }
            if let Cikis::Dizin(_, bas, adet) = &mut sira[i].1 {
                *bas = ilk;
                *adet = cocuklar.len();
            }
        }

        let mut adlar: Vec<u8> = vec![0];
        let mut ad_ofs: HashMap<&str, usize> = HashMap::from([("", 0)]);
        let mut ofsler = Vec::with_capacity(sira.len());
        for (ad, _) in &sira {
            let o = *ad_ofs.entry(ad).or_insert_with(|| {
                let o = adlar.len();
                adlar.extend_from_slice(ad.as_bytes());
                adlar.push(0);
                o
            });
            if o > 0xFFFF {
                return Err(Hata::Gecersiz("dosya adları tablosu 64KB sınırını aştı".into()));
            }
            ofsler.push(o as u64);
        }
        adlar.resize(adlar.len().div_ceil(16) * 16, 0);

        let mut tablo = Vec::with_capacity(16 + sira.len() * 16 + adlar.len());
        tablo.extend_from_slice(&MAGIC.to_le_bytes());
        tablo.extend_from_slice(&(sira.len() as u32).to_le_bytes());
        tablo.extend_from_slice(&(adlar.len() as u32).to_le_bytes());
        tablo.extend_from_slice(&self.sifreleme.to_le_bytes());
        let mut imlec = hizala(16 + sira.len() * 16 + adlar.len());
        let mut yukler: Vec<Cow<[u8]>> = Vec::new();

        for (i, (ad, c)) in sira.iter().enumerate() {
            let ad_o = ofsler[i];
            let (y, s8, s12, yuk) = match c {
                Cikis::Dizin(_, bas, adet) => {
                    tablo.extend_from_slice(&(ad_o as u32).to_le_bytes());
                    tablo.extend_from_slice(&DIZIN_ISARETI.to_le_bytes());
                    tablo.extend_from_slice(&(*bas as u32).to_le_bytes());
                    tablo.extend_from_slice(&(*adet as u32).to_le_bytes());
                    continue;
                }
                Cikis::Arsiv(a) => {
                    let ic = a.arsiv.yaz()?;
                    let n = ic.len();
                    (ad_o | blok_alani(imlec, 0xFF_FFFF)? << 40, n as u32, 0, Cow::Owned(ic))
                }
                Cikis::Dosya(f) => match (f.tur, &f.icerik) {
                    (DosyaTuru::Kaynak { sistem, grafik }, _) => {
                        let mut v = f.veri()?;
                        let n = v.len();
                        let boyut_alani = if n >= 0xFF_FFFF {
                            let k = v.to_mut();
                            (k[2], k[5], k[7], k[14]) = ((n >> 24) as u8, (n >> 16) as u8, n as u8, (n >> 8) as u8);
                            0xFF_FFFF
                        } else {
                            n as u64
                        };
                        let alan = ad_o | boyut_alani << 16 | (blok_alani(imlec, 0x7F_FFFF)? | 0x80_0000) << 40;
                        (alan, sistem, grafik, v)
                    }
                    (DosyaTuru::Ikili { sifreli }, Icerik::Kayitli { kaynak, bas, uzunluk, sikisik, acik_boyut, .. }) => {
                        let ham = &kaynak[*bas..*bas + *uzunluk];
                        let sik = if *sikisik { *uzunluk as u64 } else { 0 };
                        let alan = ad_o | sik << 16 | blok_alani(imlec, 0xFF_FFFF)? << 40;
                        (alan, *acik_boyut as u32, sifreli, Cow::Borrowed(ham))
                    }
                    (DosyaTuru::Ikili { .. }, Icerik::Ham(v)) => {
                        let acik = v.len() as u32;
                        let sik = if ad.to_ascii_lowercase().ends_with(".rpf") { None } else { sikistir(v) };
                        let (sik_alan, yuk) = match sik {
                            Some(s) => (s.len() as u64, Cow::Owned(s)),
                            None => (0, Cow::Borrowed(&v[..])),
                        };
                        (ad_o | sik_alan << 16 | blok_alani(imlec, 0xFF_FFFF)? << 40, acik, 0, yuk)
                    }
                },
            };
            tablo.extend_from_slice(&y.to_le_bytes());
            tablo.extend_from_slice(&s8.to_le_bytes());
            tablo.extend_from_slice(&s12.to_le_bytes());
            imlec += hizala(yuk.len());
            yukler.push(yuk);
        }
        tablo.extend_from_slice(&adlar);

        let mut cikti = Vec::with_capacity(imlec);
        cikti.extend_from_slice(&tablo);
        cikti.resize(hizala(cikti.len()), 0);
        for yuk in &yukler {
            cikti.extend_from_slice(yuk);
            cikti.resize(hizala(cikti.len()), 0);
        }
        debug_assert_eq!(cikti.len(), imlec);
        Ok(cikti)
    }
}

fn blok_alani(imlec: usize, sinir: u64) -> Sonuc<u64> {
    let blok = (imlec / BLOK) as u64;
    if blok > sinir {
        return Err(Hata::Gecersiz("arşiv boyut sınırını aştı".into()));
    }
    Ok(blok)
}

fn sikistir(v: &[u8]) -> Option<Vec<u8>> {
    if v.len() < 64 {
        return None;
    }
    let seviye = if v.len() > 8 << 20 { 6 } else { 9 };
    let mut e = DeflateEncoder::new(Vec::with_capacity(v.len() / 2), Compression::new(seviye));
    e.write_all(v).ok()?;
    let s = e.finish().ok()?;
    (s.len() < v.len() && s.len() < 0xFF_FFFF).then_some(s)
}

#[cfg(test)]
mod testler {
    use super::*;

    /// Dış arşivin sonundaki iç arşiv, son bloğunun dolgusu kırpılmış hâliyle
    /// (gerçek bir modda görüldüğü gibi) okunabilmeli ve kaydedince tam boyuta dönmeli.
    #[test]
    fn son_blok_dolgusu_kirpilmis_ic_arsiv_okunur() {
        let mut ic = Arsiv::yeni();
        ic.koy("", Dugum::Dosya(Dosya::yeni("visualsettings.dat", b"car.headlight.near.intensity 2.0\n".repeat(50)))).unwrap();
        let mut dis = Arsiv::yeni();
        dis.koy("", Dugum::Dosya(Dosya::yeni("assembly.xml", b"<package/>".to_vec()))).unwrap();
        dis.koy("", Dugum::Dizin(Dizin { ad: "content".into(), cocuklar: vec![] })).unwrap();
        dis.koy("content", Dugum::Arsiv(IcArsiv { ad: "gta5.rpf".into(), arsiv: ic })).unwrap();
        let tam = dis.yaz().unwrap();
        let kirp = 13;
        assert!(tam[tam.len() - kirp..].iter().all(|&b| b == 0), "deneme kurulumu: kırpılan kısım dolgu olmalı");
        let kirpik: Arc<[u8]> = Arc::from(&tam[..tam.len() - kirp]);

        let a = Arsiv::oku(kirpik).expect("kırpılmış dolgu okumayı engellememeli");
        assert!(matches!(a.bul("content/gta5.rpf"), Some(Dugum::Arsiv(_))), "iç arşiv arşiv olarak tanınmalı");
        let v = a.dosya("content/gta5.rpf/visualsettings.dat").unwrap().veri().unwrap();
        assert!(v.starts_with(b"car.headlight"));

        let yeniden = a.yaz().unwrap();
        assert!(yeniden.len().is_multiple_of(512) && Arsiv::oku(Arc::from(yeniden)).is_ok(), "kaydedilen arşiv tam bloklarla yazılmalı");
    }

    #[test]
    fn sikistirilmis_veride_eksik_kisim_hata_verir() {
        let mut a = Arsiv::yeni();
        a.koy("", Dugum::Dosya(Dosya::yeni("buyuk.meta", "<x>tekrar</x>".repeat(4000).into_bytes()))).unwrap();
        let tam = a.yaz().unwrap();
        // Dolgudan fazlasını kes: sıkıştırılmış verinin kendisi eksik kalır.
        let kirpik: Arc<[u8]> = Arc::from(&tam[..tam.len() - 600]);
        assert!(Arsiv::oku(kirpik).is_err());
    }

    /// Sıkıştırılmamış düz dosyada kırpılan kısım gerçek veridir; okunup kaydedilirse
    /// kısa hâli kalıcı olurdu.
    #[test]
    fn kirpilmis_duz_dosya_okunmaz() {
        let mut x = 0x2545_f491u32;
        let veri: Vec<u8> = (0..300)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                x as u8
            })
            .collect();
        let mut a = Arsiv::yeni();
        a.koy("", Dugum::Dosya(Dosya::yeni("rastgele.bin", veri))).unwrap();
        let tam = a.yaz().unwrap();

        let yalniz_dolgu: Arc<[u8]> = Arc::from(&tam[..tam.len() - 200]);
        let okunan = Arsiv::oku(yalniz_dolgu).unwrap();
        let f = okunan.dosya("rastgele.bin").unwrap();
        assert_eq!((f.boyut(), f.kayitli_boyut()), (300, 300), "deneme kurulumu: veri sıkıştırılmadan girmeli");

        // 212 bayt dolgu ve 88 bayt veri kesilir.
        let kirpik: Arc<[u8]> = Arc::from(&tam[..tam.len() - 300]);
        assert!(Arsiv::oku(kirpik).is_err(), "eksik veri sessizce kısaltılmamalı");
    }

    /// Yalnız dizinlerden oluşan ham tablo: (ad ofseti, ilk çocuk, çocuk sayısı).
    fn dizin_tablosu(dizinler: &[(u32, u32, u32)]) -> Vec<u8> {
        let adlar = b"\0a\0b\0\0\0\0\0\0\0\0\0\0\0";
        let mut v = Vec::new();
        for x in [MAGIC, dizinler.len() as u32, adlar.len() as u32, SIFRE_OPEN] {
            v.extend_from_slice(&x.to_le_bytes());
        }
        for &(ad, ilk, adet) in dizinler {
            for x in [ad, DIZIN_ISARETI, ilk, adet] {
                v.extend_from_slice(&x.to_le_bytes());
            }
        }
        v.extend_from_slice(adlar);
        v.resize(hizala(v.len()), 0);
        v
    }

    #[test]
    fn bozuk_dizin_tablosu_reddedilir() {
        assert!(Arsiv::oku(Arc::from(dizin_tablosu(&[(0, 1, 2), (1, 0, 0), (3, 0, 0)]))).is_ok());
        // 1. dizin, kökün çocuğu olan 2. kaydı bir daha gösteriyor.
        assert!(Arsiv::oku(Arc::from(dizin_tablosu(&[(0, 1, 2), (1, 2, 1), (3, 0, 0)]))).is_err());
        // 300 kat iç içe dizin
        let derin: Vec<(u32, u32, u32)> = (0..300).map(|i| (1, i + 1, 1)).chain([(1, 0, 0)]).collect();
        assert!(Arsiv::oku(Arc::from(dizin_tablosu(&derin))).is_err());
        // Yalnız imzadan ibaret iç arşiv panik değil hata vermeli.
        assert!(tablo_oku(&MAGIC.to_le_bytes()).is_err());
    }
}
