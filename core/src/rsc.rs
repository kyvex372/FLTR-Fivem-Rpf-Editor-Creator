use std::io::{Read, Write};

use flate2::Compression;
use flate2::read::DeflateDecoder;
use flate2::write::DeflateEncoder;

use crate::{Hata, Sonuc, bozuk, u32_oku, u64_oku};

pub const RSC7: u32 = 0x3743_5352;
const SISTEM_TABANI: u64 = 0x5000_0000;
const GRAFIK_TABANI: u64 = 0x6000_0000;

/// Kaynak sürümü sayfa bayraklarının üst dörder bitinde saklanır (sistem yüksek, grafik düşük).
pub fn surum(sistem: u32, grafik: u32) -> u32 {
    ((sistem >> 28) & 0xF) << 4 | ((grafik >> 28) & 0xF)
}

pub fn baslik(v: &[u8]) -> Option<(u32, u32)> {
    if u32_oku(v, 0)? != RSC7 {
        return None;
    }
    Some((u32_oku(v, 8)?, u32_oku(v, 12)?))
}

const KOVA_KAYDIRMA: [u32; 9] = [4, 5, 7, 11, 17, 24, 25, 26, 27];
const KOVA_MASKE: [u32; 9] = [0x1, 0x3, 0xF, 0x3F, 0x7F, 0x1, 0x1, 0x1, 0x1];

fn kova_adetleri(f: u32) -> [u32; 9] {
    std::array::from_fn(|i| (f >> KOVA_KAYDIRMA[i]) & KOVA_MASKE[i])
}

pub fn sayfa_adedi(f: u32) -> u32 {
    kova_adetleri(f).iter().sum()
}

/// Sayfa bayrağından bölüm boyutu: taban sayfa 0x200 << kaydırma, dokuz kovada sayfa adetleri.
pub fn bolum_boyutu(f: u32) -> usize {
    let taban = 0x200usize << (f & 0xF);
    kova_adetleri(f).iter().enumerate().map(|(i, &n)| n as usize * (taban << (8 - i))).sum()
}

#[derive(Clone)]
pub struct Kaynak {
    pub surum: u32,
    pub sistem: u32,
    pub grafik: u32,
    pub sistem_boyutu: usize,
    pub veri: Vec<u8>,
}

impl Kaynak {
    pub fn coz(dosya: &[u8]) -> Sonuc<Kaynak> {
        let (sistem, grafik) = baslik(dosya).ok_or_else(|| bozuk("RSC7 kaynağı değil"))?;
        let surum = u32_oku(dosya, 4).unwrap();
        let sistem_boyutu = bolum_boyutu(sistem);
        let toplam = sistem_boyutu + bolum_boyutu(grafik);
        let mut veri = Vec::with_capacity(toplam);
        DeflateDecoder::new(&dosya[16..])
            .read_to_end(&mut veri)
            .map_err(|e| bozuk(format!("kaynak açılamadı: {e}")))?;
        if veri.len() < sistem_boyutu {
            return Err(bozuk("kaynak verisi eksik"));
        }
        veri.resize(toplam, 0);
        Ok(Kaynak { surum, sistem, grafik, sistem_boyutu, veri })
    }

    pub fn paketle(&self) -> Vec<u8> {
        // büyük kaynaklarda (ypt 100MB+) en iyi sıkıştırma saniyeler sürer, kazancı yüzde birkaç
        let seviye = if self.veri.len() > 32 << 20 { Compression::default() } else { Compression::best() };
        let mut e = DeflateEncoder::new(Vec::with_capacity(self.veri.len() / 2 + 16), seviye);
        let mut cikti = Vec::new();
        for x in [RSC7, self.surum, self.sistem, self.grafik] {
            cikti.extend_from_slice(&x.to_le_bytes());
        }
        e.write_all(&self.veri).expect("belleğe yazım");
        cikti.extend_from_slice(&e.finish().expect("belleğe yazım"));
        cikti
    }

    /// Bölümü tek sayfada toplayıp sonuna `ek` bayt yer açar, yeni alanın bölüm içi ofsetini döndürür.
    /// Tek sayfa eski verinin tamamını kapsadığından hiçbir yapı sayfa sınırına taşmaz ve işaretçiler kaymaz.
    /// Oyunun sayfa haritasındaki (kök +0x08) sayfa adetleri de güncellenir.
    pub fn bolume_yer_ac(&mut self, grafik: bool, ek: usize, hiza: usize) -> Sonuc<usize> {
        let harita = u64_oku(&self.veri, 0x08).and_then(|p| self.ofs(p));
        if let Some(h) = harita
            && (self.veri.get(h + 8).copied() != Some(sayfa_adedi(self.sistem) as u8)
                || self.veri.get(h + 9).copied() != Some(sayfa_adedi(self.grafik) as u8))
        {
            return Err(Hata::Gecersiz("kaynağın sayfa haritası beklenen düzende değil; güvenle büyütülemez".into()));
        }
        let eski = if grafik { self.veri.len() - self.sistem_boyutu } else { self.sistem_boyutu };
        let bas = eski.div_ceil(hiza) * hiza;
        let s = (0..16u32)
            .find(|&s| (0x200usize << (s + 8)) >= bas + ek)
            .ok_or_else(|| Hata::Gecersiz("eklenecek veri çok büyük".into()))?;
        let boyut = 0x200usize << (s + 8);
        let bayrak = if grafik { &mut self.grafik } else { &mut self.sistem };
        *bayrak = (*bayrak & 0xF000_0000) | s | (1 << KOVA_KAYDIRMA[0]);
        debug_assert_eq!(bolum_boyutu(*bayrak), boyut);
        if grafik {
            self.veri.resize(self.sistem_boyutu + boyut, 0);
        } else {
            self.veri.splice(eski..eski, std::iter::repeat_n(0u8, boyut - eski));
            self.sistem_boyutu = boyut;
        }
        if let Some(h) = harita {
            self.veri[h + 8] = sayfa_adedi(self.sistem) as u8;
            self.veri[h + 9] = sayfa_adedi(self.grafik) as u8;
        }
        Ok(bas)
    }

    /// Sanal işaretçiyi düz tampon ofsetine çevirir.
    pub fn ofs(&self, p: u64) -> Option<usize> {
        let o = (p & 0x0FFF_FFFF) as usize;
        let mutlak = match p & !0x0FFF_FFFF {
            SISTEM_TABANI if o < self.sistem_boyutu => o,
            GRAFIK_TABANI => self.sistem_boyutu + o,
            _ => return None,
        };
        (mutlak < self.veri.len()).then_some(mutlak)
    }
}
