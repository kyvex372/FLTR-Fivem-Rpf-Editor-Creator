use crate::doku::{self, Bicim, RenkAyari, Sigdirma};
use crate::rsc::Kaynak;
use crate::{Hata, Sonuc, bozuk, u16_oku, u32_oku, u64_oku};

#[derive(Clone, Debug)]
pub struct Doku {
    pub ad: String,
    pub genislik: usize,
    pub yukseklik: usize,
    pub bicim: Bicim,
    pub seviye: usize,
    /// mip0 satır adımı; oyun seviye k'yi `adim * yükseklik / 4^k` bayt saklar
    adim: usize,
    /// hangi doku sözlüğünde (ydd/yft'de birden çok olabilir)
    sozluk: usize,
    veri_ofs: usize,
    veri_boyu: usize,
    yapi_ofs: usize,
    ad_ofs: Option<usize>,
}

impl Doku {
    /// Her seviye için (genişlik, yükseklik, tam blok boyutu, oyunun sakladığı boyut).
    /// Oyun seviyeleri dörder dörder küçültür; 4x4'ün altındaki seviyeler blok boyutundan kısa saklanır.
    fn seviyeler(&self) -> impl Iterator<Item = (usize, usize, usize, usize)> + '_ {
        let mut oyun = self.adim * self.yukseklik;
        (0..self.seviye).map(move |m| {
            let (w, h) = ((self.genislik >> m).max(1), (self.yukseklik >> m).max(1));
            let o = oyun;
            oyun /= 4;
            (w, h, self.bicim.seviye_boyutu(w, h).unwrap_or(0), o)
        })
    }
}

#[derive(Clone)]
struct Sozluk {
    liste_ofs: usize,
    ozet_ofs: Option<usize>,
}

/// Bir kaynaktaki doku sözlükleri: ytd'nin kendisi ya da modelin (ydr/ydd/yft) içine gömülü sözlükler.
#[derive(Clone)]
pub struct Ytd {
    pub kaynak: Kaynak,
    pub dokular: Vec<Doku>,
    sozlukler: Vec<Sozluk>,
}

/// Jenkins one-at-a-time; RAGE adları küçük harfe çevirerek özetler.
pub fn joaat(s: &str) -> u32 {
    let mut h: u32 = 0;
    for b in s.bytes() {
        h = h.wrapping_add(b.to_ascii_lowercase() as u32);
        h = h.wrapping_add(h << 10);
        h ^= h >> 6;
    }
    h = h.wrapping_add(h << 3);
    h ^= h >> 11;
    h.wrapping_add(h << 15)
}

fn c_dizgi(b: &[u8], o: usize) -> Option<String> {
    let kalan = b.get(o..)?;
    let son = kalan.iter().take(256).position(|&c| c == 0)?;
    Some(String::from_utf8_lossy(&kalan[..son]).into_owned())
}

/// Model kaynağındaki gömülü doku sözlüklerinin düz ofsetleri: çizim +0x10 gölgelendirici grubu, grup +0x08 sözlük.
fn gomulu_sozlukler(k: &Kaynak, uzanti: &str) -> Vec<usize> {
    let v = &k.veri;
    let isaret = |o: usize| u64_oku(v, o).filter(|&p| p != 0).and_then(|p| k.ofs(p));
    let cizimler: Vec<usize> = match uzanti {
        // parçacık sözlüğü (ptxFxList): 0x10 ad, 0x20 doku sözlüğü, 0x30 çizim sözlüğü
        "ypt" => {
            let s = isaret(0x20).filter(|&s| (1..=4096).contains(&u16_oku(v, s + 0x38).unwrap_or(0)) && isaret(s + 0x30).is_some());
            return s.into_iter().collect();
        }
        "ydd" => {
            let adet = u16_oku(v, 0x38).unwrap_or(0).min(1024) as usize;
            isaret(0x30).map(|l| (0..adet).filter_map(|i| isaret(l + i * 8)).collect()).unwrap_or_default()
        }
        "yft" => {
            let mut c: Vec<usize> = isaret(0x30).into_iter().collect();
            if let Some(l) = isaret(0x38) {
                c.extend((0..u32_oku(v, 0x48).unwrap_or(0).min(64) as usize).filter_map(|i| isaret(l + i * 8)));
            }
            c
        }
        _ => vec![0],
    };
    let mut sozlukler = Vec::new();
    for c in cizimler {
        let Some(s) = isaret(c + 0x10).and_then(|grup| isaret(grup + 0x08)) else { continue };
        let adet = u16_oku(v, s + 0x38).unwrap_or(0);
        if (1..=1024).contains(&adet) && isaret(s + 0x30).is_some() && !sozlukler.contains(&s) {
            sozlukler.push(s);
        }
    }
    sozlukler
}

impl Ytd {
    pub fn coz(dosya: &[u8]) -> Sonuc<Ytd> {
        Ytd::sozluklerden(Kaynak::coz(dosya)?, &[0])
    }

    /// Modelin içine gömülü dokular; gömülü doku yoksa liste boştur. Yalnız yerinde düzenleme (değiştir, renklendir, ad) yapılabilir.
    pub fn modelden(dosya: &[u8], uzanti: &str) -> Sonuc<Ytd> {
        let kaynak = Kaynak::coz(dosya)?;
        let mut konumlar = gomulu_sozlukler(&kaynak, uzanti);
        // ydr uzantılı çizim sözlükleri de var
        if konumlar.is_empty() && uzanti == "ydr" {
            konumlar = gomulu_sozlukler(&kaynak, "ydd");
        }
        Ytd::sozluklerden(kaynak, &konumlar)
    }

    fn sozluklerden(kaynak: Kaynak, konumlar: &[usize]) -> Sonuc<Ytd> {
        let mut dokular = Vec::new();
        let mut sozlukler = Vec::with_capacity(konumlar.len());
        for (s, &o) in konumlar.iter().enumerate() {
            sozlukler.push(sozluk_oku(&kaynak, o, s, &mut dokular)?);
        }
        Ok(Ytd { kaynak, dokular, sozlukler })
    }
}

/// `o` ofsetindeki pgDictionary<grcTexture>: 0x20 ad özetleri, 0x30 doku işaretçileri.
fn sozluk_oku(kaynak: &Kaynak, o: usize, sozluk: usize, dokular: &mut Vec<Doku>) -> Sonuc<Sozluk> {
    let v = &kaynak.veri;
    let liste = u64_oku(v, o + 0x30).and_then(|p| kaynak.ofs(p)).ok_or_else(|| bozuk("doku listesi yok"))?;
    let adet = u16_oku(v, o + 0x38).unwrap_or(0) as usize;
    dokular.reserve(adet);
    for i in 0..adet {
        let t = u64_oku(v, liste + i * 8)
            .and_then(|p| kaynak.ofs(p))
            .ok_or_else(|| bozuk(format!("{i}. doku işaretçisi bozuk")))?;
        let ad_ofs = u64_oku(v, t + 0x28).and_then(|p| kaynak.ofs(p));
        let ad = ad_ofs.and_then(|o| c_dizgi(v, o)).unwrap_or_else(|| format!("doku_{i}"));
        let genislik = u16_oku(v, t + 0x50).unwrap_or(0) as usize;
        let yukseklik = u16_oku(v, t + 0x52).unwrap_or(0) as usize;
        let bicim = Bicim::koddan(u32_oku(v, t + 0x58).unwrap_or(0));
        let seviye = (*v.get(t + 0x5D).unwrap_or(&1) as usize).max(1);
        let veri_ofs = u64_oku(v, t + 0x70).and_then(|p| kaynak.ofs(p)).unwrap_or(usize::MAX);
        let adim = match u16_oku(v, t + 0x56).unwrap_or(0) as usize {
            0 => bicim.seviye_boyutu(genislik, yukseklik).unwrap_or(0) / yukseklik.max(1),
            a => a,
        };
        let mut d = Doku { ad, genislik, yukseklik, bicim, seviye, adim, sozluk, veri_ofs, veri_boyu: 0, yapi_ofs: t, ad_ofs };
        d.veri_boyu = d.seviyeler().map(|x| x.3).sum();
        dokular.push(d);
    }
    let ozet_ofs = u64_oku(v, o + 0x20)
        .and_then(|p| kaynak.ofs(p))
        .filter(|_| u16_oku(v, o + 0x28) == Some(adet as u16));
    Ok(Sozluk { liste_ofs: liste, ozet_ofs })
}

impl Ytd {
    /// Adı değiştirir; ad özet listesi ve doku listesi yeniden sıralanır (oyun ikili arama yapar).
    /// Dokuların sırası değişebilir.
    pub fn yeniden_adlandir(&mut self, i: usize, yeni: &str) -> Sonuc<()> {
        let yeni = yeni.trim().to_lowercase();
        if yeni.is_empty() || yeni.len() > 63 || !yeni.bytes().all(|c| c.is_ascii_alphanumeric() || b"_-.".contains(&c)) {
            return Err(Hata::Gecersiz(format!("geçersiz doku adı: {yeni} (a-z, 0-9, _ - . ve en fazla 63 karakter)")));
        }
        let d = self.dokular.get(i).ok_or_else(|| Hata::Yok(format!("{i}. doku")))?;
        if d.ad == yeni {
            return Ok(());
        }
        if self.dokular.iter().any(|x| x.sozluk == d.sozluk && x.ad == yeni) {
            return Err(Hata::Gecersiz(format!("{yeni} adlı doku zaten var")));
        }
        let eski_ofs = d.ad_ofs.ok_or_else(|| bozuk("doku adının yeri bulunamadı"))?;
        let eski_boy = d.ad.len();
        let yapi = d.yapi_ofs;
        let hedef = if yeni.len() <= eski_boy {
            self.kaynak.veri[eski_ofs..eski_ofs + eski_boy + 1].fill(0);
            eski_ofs
        } else {
            let o = self.bos_alan(yeni.len() + 1)?;
            self.kaynak.veri[yapi + 0x28..yapi + 0x30].copy_from_slice(&(0x5000_0000u64 + o as u64).to_le_bytes());
            o
        };
        self.kaynak.veri[hedef..hedef + yeni.len()].copy_from_slice(yeni.as_bytes());
        self.kaynak.veri[hedef + yeni.len()] = 0;
        self.dokular[i].ad = yeni;
        self.dokular[i].ad_ofs = Some(hedef);
        self.sirala();
        Ok(())
    }

    /// Sistem bölümünün sonundaki sıfır dolgudan, son yapıya 64 bayt pay bırakarak yer ayırır;
    /// yetmezse bölümü büyütür.
    fn bos_alan(&mut self, n: usize) -> Sonuc<usize> {
        let sistem = &self.kaynak.veri[..self.kaynak.sistem_boyutu];
        let sifir = sistem.iter().rev().take_while(|&&b| b == 0).count();
        let bas = (self.kaynak.sistem_boyutu - sifir + 64).div_ceil(16) * 16;
        if bas + n <= self.kaynak.sistem_boyutu {
            return Ok(bas);
        }
        let eski_boy = self.kaynak.sistem_boyutu;
        let yeni = self.kaynak.bolume_yer_ac(false, n, 16)?;
        let kayma = self.kaynak.sistem_boyutu - eski_boy;
        for d in &mut self.dokular {
            if d.veri_ofs != usize::MAX && d.veri_ofs >= eski_boy {
                d.veri_ofs += kayma;
            }
        }
        Ok(yeni)
    }

    /// Dokuyu yeni boyutta, aynı biçimde tam mip zinciriyle yazar. Veri grafik bölümünün sonuna eklenir,
    /// doku yapısı yerinde güncellenir; eski veri sıfırlanır (sıkıştırınca yer kaplamaz).
    pub fn boyutlandir(&mut self, i: usize, rgba: Vec<u8>, w: usize, h: usize) -> Sonuc<()> {
        let d = self.doku(i)?.clone();
        let yeni = doku_uret(&d.ad, rgba, w, h, d.bicim)?;
        let boy = yeni.pixel_data.len();
        let g = self.kaynak.bolume_yer_ac(true, boy, 256)?;
        let duz = self.kaynak.sistem_boyutu + g;
        self.kaynak.veri[d.veri_ofs..d.veri_ofs + d.veri_boyu].fill(0);
        self.kaynak.veri[duz..duz + boy].copy_from_slice(&yeni.pixel_data);
        let t = d.yapi_ofs;
        let v = &mut self.kaynak.veri;
        v[t + 0x50..t + 0x52].copy_from_slice(&yeni.width.to_le_bytes());
        v[t + 0x52..t + 0x54].copy_from_slice(&yeni.height.to_le_bytes());
        v[t + 0x54..t + 0x56].copy_from_slice(&1u16.to_le_bytes());
        v[t + 0x56..t + 0x58].copy_from_slice(&yeni.stride.to_le_bytes());
        v[t + 0x5D] = yeni.levels;
        v[t + 0x70..t + 0x78].copy_from_slice(&(0x6000_0000u64 + g as u64).to_le_bytes());
        let x = &mut self.dokular[i];
        (x.genislik, x.yukseklik, x.seviye, x.adim, x.veri_ofs) = (w, h, yeni.levels as usize, yeni.stride as usize, duz);
        x.veri_boyu = x.seviyeler().map(|s| s.3).sum();
        debug_assert_eq!(x.veri_boyu, boy);
        Ok(())
    }

    fn sirala(&mut self) {
        let mut hepsi = Vec::with_capacity(self.dokular.len());
        for (s, sozluk) in self.sozlukler.iter().enumerate() {
            let mut sira: Vec<(u32, u64, Doku)> = self
                .dokular
                .iter()
                .filter(|d| d.sozluk == s)
                .map(|d| (joaat(&d.ad), 0x5000_0000u64 + d.yapi_ofs as u64, d.clone()))
                .collect();
            sira.sort_by_key(|x| x.0);
            for (j, (ozet, isaretci, _)) in sira.iter().enumerate() {
                self.kaynak.veri[sozluk.liste_ofs + j * 8..][..8].copy_from_slice(&isaretci.to_le_bytes());
                if let Some(o) = sozluk.ozet_ofs {
                    self.kaynak.veri[o + j * 4..][..4].copy_from_slice(&ozet.to_le_bytes());
                }
            }
            hepsi.extend(sira.into_iter().map(|x| x.2));
        }
        self.dokular = hepsi;
    }

    fn doku(&self, i: usize) -> Sonuc<&Doku> {
        let d = self.dokular.get(i).ok_or_else(|| Hata::Yok(format!("{i}. doku")))?;
        if !d.bicim.destekli() {
            return Err(Hata::Gecersiz(format!("{}: {} biçimi desteklenmiyor", d.ad, d.bicim.ad())));
        }
        if d.genislik == 0 || d.yukseklik == 0 || d.veri_ofs.saturating_add(d.veri_boyu) > self.kaynak.veri.len() {
            return Err(bozuk(format!("{}: veri sınırları tutarsız", d.ad)));
        }
        Ok(d)
    }

    pub fn ham_veri(&self, i: usize) -> Sonuc<&[u8]> {
        let d = self.doku(i)?;
        Ok(&self.kaynak.veri[d.veri_ofs..d.veri_ofs + d.veri_boyu])
    }

    /// İstenen mip seviyesini RGBA8 olarak döndürür.
    pub fn rgba(&self, i: usize, mip: usize) -> Sonuc<(Vec<u8>, usize, usize)> {
        let d = self.doku(i)?;
        let mip = mip.min(d.seviye - 1);
        let mut ofs = d.veri_ofs;
        for (m, (w, h, blok, oyun)) in d.seviyeler().enumerate() {
            if m == mip {
                let mut ham = self.kaynak.veri[ofs..ofs + oyun].to_vec();
                ham.resize(blok, 0);
                return Ok((doku::coz(d.bicim, &ham, w, h)?, w, h));
            }
            ofs += oyun;
        }
        unreachable!()
    }

    /// Görseli dokunun kendi boyut/biçim/mip düzenine getirip yerinde yazar; düzen değişmez.
    pub fn degistir(&mut self, i: usize, rgba: Vec<u8>, w: usize, h: usize, sigdirma: Sigdirma, renk: &RenkAyari) -> Sonuc<()> {
        let d = self.doku(i)?.clone();
        let mut seviye_rgba = doku::olcekle(rgba, w, h, d.genislik, d.yukseklik, sigdirma)?;
        doku::renk_uygula(&mut seviye_rgba, renk);
        let (mut sw, mut sh) = (d.genislik, d.yukseklik);
        let mut yazilan = Vec::with_capacity(d.veri_boyu);
        for (m, (_, _, _, oyun)) in d.seviyeler().enumerate() {
            if m > 0 {
                let (y, yw, yh) = doku::yarim(&seviye_rgba, sw, sh);
                (seviye_rgba, sw, sh) = (y, yw, yh);
            }
            let mut seviye = doku::kodla(d.bicim, &seviye_rgba, sw, sh)?;
            seviye.resize(oyun, 0);
            yazilan.extend(seviye);
        }
        if yazilan.len() != d.veri_boyu {
            return Err(bozuk(format!("{}: kodlanan boyut tutmadı ({} != {})", d.ad, yazilan.len(), d.veri_boyu)));
        }
        self.kaynak.veri[d.veri_ofs..d.veri_ofs + d.veri_boyu].copy_from_slice(&yazilan);
        Ok(())
    }

    /// Mevcut dokuyu yalnız renk ayarıyla yeniden kodlar.
    pub fn renklendir(&mut self, i: usize, renk: &RenkAyari) -> Sonuc<()> {
        let (rgba, w, h) = self.rgba(i, 0)?;
        self.degistir(i, rgba, w, h, Sigdirma::Esnet, renk)
    }

    /// DDS tam blok ister; oyunun kısa sakladığı küçük seviyeler sıfırla doldurulur.
    pub fn dds(&self, i: usize) -> Sonuc<Vec<u8>> {
        let d = self.doku(i)?;
        let mut veri = Vec::new();
        let mut ofs = d.veri_ofs;
        for (_, _, blok, oyun) in d.seviyeler() {
            let bas = veri.len();
            veri.extend_from_slice(&self.kaynak.veri[ofs..ofs + oyun.min(blok)]);
            veri.resize(bas + blok, 0);
            ofs += oyun;
        }
        doku::dds_yaz(d.bicim, d.genislik, d.yukseklik, d.seviye, &veri)
    }

    pub fn dosya(&self) -> Vec<u8> {
        self.kaynak.paketle()
    }
}


/// Yalnız sistem bölümünü açarak doku adlarını okur; büyük arşivlerde doku dizini kurmak için.
pub fn doku_adlari(dosya: &[u8]) -> Sonuc<Vec<String>> {
    use std::io::Read;
    let (sistem, _) = crate::rsc::baslik(dosya).ok_or_else(|| bozuk("RSC7 kaynağı değil"))?;
    let boy = crate::rsc::bolum_boyutu(sistem);
    let mut v = Vec::with_capacity(boy);
    flate2::read::DeflateDecoder::new(&dosya[16..])
        .take(boy as u64)
        .read_to_end(&mut v)
        .map_err(|e| bozuk(e.to_string()))?;
    let ofs = |p: u64| (p >> 28 == 5).then_some((p & 0x0FFF_FFFF) as usize).filter(|&o| o < v.len());
    let liste = u64_oku(&v, 0x30).and_then(ofs).ok_or_else(|| bozuk("doku listesi yok"))?;
    let adet = u16_oku(&v, 0x38).unwrap_or(0) as usize;
    Ok((0..adet)
        .map(|i| {
            u64_oku(&v, liste + i * 8)
                .and_then(ofs)
                .and_then(|t| u64_oku(&v, t + 0x28))
                .and_then(ofs)
                .and_then(|o| c_dizgi(&v, o))
                .unwrap_or_default()
                .to_lowercase()
        })
        .collect())
}

pub enum DokuIslemi {
    Sil(String),
    /// Aynı adlı doku varsa yerine geçer (boyutu farklı olabilir), yoksa eklenir.
    /// `bicim` boşsa var olan dokunun biçimi, yeni dokuda görselden seçilen biçim kullanılır.
    Koy { ad: String, rgba: Vec<u8>, w: usize, h: usize, bicim: Option<String> },
}

/// Görselden tam mip zincirli bir doku üretir; kodlama bu projenin kendi DXT/BC kodlayıcısıyla yapılır.
fn doku_uret(ad: &str, rgba: Vec<u8>, w: usize, h: usize, bicim: Bicim) -> Sonuc<rage_formats::YtdTexture> {
    if w == 0 || h == 0 || w > 16384 || h > 16384 {
        return Err(Hata::Gecersiz(format!("{w}x{h} kullanılabilir bir doku boyutu değil")));
    }
    let taban = if bicim.blok_sikistirmali() { 4 } else { 1 };
    let mut seviye = 1;
    while (w >> seviye) >= taban && (h >> seviye) >= taban && seviye < 13 {
        seviye += 1;
    }
    let adim = bicim.seviye_boyutu(w, h).ok_or_else(|| Hata::Gecersiz(format!("{} biçimine yazılamıyor", bicim.ad())))? / h;
    let mut veri = Vec::new();
    let mut oyun = adim * h;
    let (mut v, mut sw, mut sh) = (rgba, w, h);
    for m in 0..seviye {
        if m > 0 {
            (v, sw, sh) = doku::yarim(&v, sw, sh);
        }
        let mut kod = doku::kodla(bicim, &v, sw, sh)?;
        kod.resize(oyun, 0);
        veri.extend(kod);
        oyun /= 4;
    }
    let kod = match bicim {
        Bicim::Dxt1 => 0x3154_5844,
        Bicim::Dxt3 => 0x3354_5844,
        Bicim::Dxt5 => 0x3554_5844,
        Bicim::Ati1 => 0x3149_5441,
        Bicim::Ati2 => 0x3249_5441,
        Bicim::Bc7 => 0x2037_4342,
        Bicim::A8R8G8B8 => 21,
        Bicim::A8B8G8R8 => 32,
        Bicim::A1R5G5B5 => 25,
        Bicim::A8 => 28,
        Bicim::L8 => 50,
        Bicim::Bilinmeyen(k) => k,
    };
    Ok(rage_formats::YtdTexture {
        name: ad.to_string(),
        name_hash: joaat(ad),
        width: w as u16,
        height: h as u16,
        depth: 1,
        format: rage_formats::TextureFormat::from_u32(kod),
        levels: seviye as u8,
        stride: adim as u16,
        pixel_data: veri,
    })
}

fn bicim_sec(ad: &str, rgba: &[u8]) -> Bicim {
    if rage_formats::is_normal_map_name(ad) {
        Bicim::Ati2
    } else if rgba.as_chunks::<4>().0.iter().any(|p| p[3] != 255) {
        Bicim::Dxt5
    } else {
        Bicim::Dxt1
    }
}

/// Doku sözlüğünü baştan kurar: ekleme, silme ve boyut/biçim değiştirme yerinde yapılamadığı için.
pub fn yeniden_kur(dosya: &[u8], islemler: Vec<DokuIslemi>) -> Sonuc<Vec<u8>> {
    let mut dokular = rage_formats::parse_ytd(dosya).map_err(|e| bozuk(format!("ytd okunamadı: {e}")))?;
    for islem in islemler {
        match islem {
            DokuIslemi::Sil(ad) => {
                let once = dokular.len();
                dokular.retain(|d| !d.name.eq_ignore_ascii_case(&ad));
                if dokular.len() == once {
                    return Err(Hata::Yok(format!("{ad} dokusu")));
                }
            }
            DokuIslemi::Koy { ad, rgba, w, h, bicim } => {
                let ad = ad.trim().to_lowercase();
                if ad.is_empty() || ad.len() > 63 || !ad.bytes().all(|c| c.is_ascii_alphanumeric() || b"_-.".contains(&c)) {
                    return Err(Hata::Gecersiz(format!("geçersiz doku adı: {ad}")));
                }
                let var = dokular.iter().position(|d| d.name.eq_ignore_ascii_case(&ad));
                let istenen = bicim.as_deref().map(|b| match b.to_ascii_lowercase().as_str() {
                    "dxt1" | "bc1" => Bicim::Dxt1,
                    "dxt5" | "bc3" => Bicim::Dxt5,
                    "bc4" | "ati1" => Bicim::Ati1,
                    "bc5" | "ati2" => Bicim::Ati2,
                    "bc7" => Bicim::Bc7,
                    _ => Bicim::A8R8G8B8,
                });
                let mevcut = var.map(|i| Bicim::koddan(dokular[i].format as u32)).filter(|b| b.destekli());
                let bicim = istenen.or(mevcut).unwrap_or_else(|| bicim_sec(&ad, &rgba));
                let yeni = doku_uret(&ad, rgba, w, h, bicim)?;
                match var {
                    Some(i) => dokular[i] = yeni,
                    None => dokular.push(yeni),
                }
            }
        }
    }
    if dokular.is_empty() {
        return Err(Hata::Gecersiz("doku sözlüğünde en az bir doku kalmalı".into()));
    }
    rage_formats::serialize_ytd(&dokular).map_err(|e| bozuk(format!("ytd yazılamadı: {e}")))
}

#[cfg(test)]
mod testler {
    use super::*;

    #[test]
    fn joaat_bilinen() {
        assert_eq!(joaat("adder"), 0xB779_A091);
    }
}
