//! Scaleform arayüz dosyası (gfx, SWF türevi): gömülü görselleri okuma ve değiştirme.
//! Başlık "GFX" (düz) ya da "CFX" (zlib); gövde SWF etiket dizisidir. Görseller DefineBits* etiketleridir;
//! değiştirilen görsel aynı karakter kimliğiyle DefineBitsLossless2 (önçarpımlı ARGB) olarak yazılır.

use std::io::{Read, Write};

use serde::Serialize;

use crate::doku::{self, Sigdirma};
use crate::{Hata, Sonuc, bozuk};

const KAYIPSIZ: u16 = 20;
const KAYIPSIZ2: u16 = 36;
const JPEG2: u16 = 21;
const JPEG3: u16 = 35;
/// Scaleform'un dış doku bağlantısı (ExporterInfo'dan sonra gelen görsel içe aktarma)
const DIS_GORSEL: u16 = 1009;

struct Etiket {
    kod: u16,
    /// etiket başlığının gövdedeki ofseti
    bas: usize,
    veri: std::ops::Range<usize>,
}

pub struct Gfx {
    sikistirilmis: bool,
    surum: u8,
    govde: Vec<u8>,
    etiketler: Vec<Etiket>,
}

#[derive(Serialize)]
pub struct Gorsel {
    pub karakter: u16,
    pub genislik: usize,
    pub yukseklik: usize,
    pub tur: &'static str,
}

fn u16_le(b: &[u8], o: usize) -> u16 {
    u16::from_le_bytes([b[o], b[o + 1]])
}

fn zlib_ac(b: &[u8]) -> Sonuc<Vec<u8>> {
    let mut o = Vec::new();
    flate2::read::ZlibDecoder::new(b).read_to_end(&mut o).map_err(|e| bozuk(format!("gfx açılamadı: {e}")))?;
    Ok(o)
}

fn zlib(b: &[u8]) -> Vec<u8> {
    let mut e = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::best());
    e.write_all(b).expect("belleğe yazım");
    e.finish().expect("belleğe yazım")
}

impl Gfx {
    pub fn coz(dosya: &[u8]) -> Sonuc<Gfx> {
        let imza = dosya.get(..3).ok_or_else(|| bozuk("dosya çok kısa"))?;
        let sikistirilmis = match imza {
            b"GFX" => false,
            b"CFX" => true,
            _ => return Err(Hata::Gecersiz("Scaleform gfx dosyası değil".into())),
        };
        let govde = if sikistirilmis { zlib_ac(&dosya[8..])? } else { dosya[8..].to_vec() };
        let nbit = (*govde.first().ok_or_else(|| bozuk("gövde boş"))? >> 3) as usize;
        let mut p = (5 + nbit * 4).div_ceil(8) + 4;
        let mut etiketler = Vec::new();
        while p + 2 <= govde.len() {
            let bas = p;
            let kl = u16_le(&govde, p);
            let (kod, mut uz) = (kl >> 6, (kl & 0x3f) as usize);
            p += 2;
            if uz == 0x3f {
                uz = u32::from_le_bytes(govde.get(p..p + 4).ok_or_else(|| bozuk("etiket yarım"))?.try_into().unwrap()) as usize;
                p += 4;
            }
            if p + uz > govde.len() {
                return Err(bozuk(format!("{kod} etiketi dosya sonunu aşıyor")));
            }
            etiketler.push(Etiket { kod, bas, veri: p..p + uz });
            p += uz;
            if kod == 0 {
                break;
            }
        }
        Ok(Gfx { sikistirilmis, surum: dosya[3], govde, etiketler })
    }

    pub fn gorseller(&self) -> Vec<Gorsel> {
        self.etiketler
            .iter()
            .filter(|e| e.veri.len() >= 7)
            .filter_map(|e| {
                let v = &self.govde[e.veri.clone()];
                let karakter = u16_le(v, 0);
                match e.kod {
                    KAYIPSIZ | KAYIPSIZ2 => Some(Gorsel { karakter, genislik: u16_le(v, 3) as usize, yukseklik: u16_le(v, 5) as usize, tur: "kayıpsız" }),
                    JPEG2 | JPEG3 => {
                        let (w, h) = self.gorsel_rgba(karakter).map(|x| (x.1, x.2)).unwrap_or((0, 0));
                        Some(Gorsel { karakter, genislik: w, yukseklik: h, tur: "jpeg" })
                    }
                    _ => None,
                }
            })
            .collect()
    }

    /// Oyunun doku sözlüklerinden kullandığı görseller (ad.dds); gfx'in içinde değil, bir ytd'de dururlar.
    pub fn dis_gorseller(&self) -> Vec<String> {
        let mut adlar: Vec<String> = self
            .etiketler
            .iter()
            .filter(|e| e.kod == DIS_GORSEL)
            .filter_map(|e| {
                let v = &self.govde[e.veri.clone()];
                let metin = String::from_utf8_lossy(v);
                metin.split(|c: char| c.is_control()).find(|s| s.to_lowercase().ends_with(".dds")).map(|s| s.to_string())
            })
            .collect();
        adlar.sort();
        adlar.dedup();
        adlar
    }

    fn etiket(&self, karakter: u16) -> Sonuc<&Etiket> {
        self.etiketler
            .iter()
            .find(|e| matches!(e.kod, KAYIPSIZ | KAYIPSIZ2 | JPEG2 | JPEG3) && u16_le(&self.govde, e.veri.start) == karakter)
            .ok_or_else(|| Hata::Yok(format!("{karakter} numaralı görsel")))
    }

    pub fn gorsel_rgba(&self, karakter: u16) -> Sonuc<(Vec<u8>, usize, usize)> {
        let e = self.etiket(karakter)?;
        let v = &self.govde[e.veri.clone()];
        match e.kod {
            KAYIPSIZ | KAYIPSIZ2 => {
                let alfa = e.kod == KAYIPSIZ2;
                let (bicim, w, h) = (v[2], u16_le(v, 3) as usize, u16_le(v, 5) as usize);
                let mut rgba = vec![0u8; w * h * 4];
                match bicim {
                    5 => {
                        let ham = zlib_ac(&v[7..])?;
                        if ham.len() < w * h * 4 {
                            return Err(bozuk("görsel verisi eksik"));
                        }
                        for (d, s) in rgba.as_chunks_mut::<4>().0.iter_mut().zip(ham.as_chunks::<4>().0) {
                            let a = if alfa { s[0] } else { 255 };
                            // önçarpımlı ARGB → düz RGBA
                            let ac = |c: u8| if alfa && a > 0 && a < 255 { ((c as u32 * 255 + a as u32 / 2) / a as u32).min(255) as u8 } else { c };
                            *d = [ac(s[1]), ac(s[2]), ac(s[3]), a];
                        }
                    }
                    3 => {
                        let renk_sayisi = v[7] as usize + 1;
                        let ham = zlib_ac(&v[8..])?;
                        let boy = if alfa { 4 } else { 3 };
                        let (tablo, pikseller) = ham.split_at((renk_sayisi * boy).min(ham.len()));
                        let satir = w.div_ceil(4) * 4;
                        for y in 0..h {
                            for x in 0..w {
                                let i = *pikseller.get(y * satir + x).unwrap_or(&0) as usize;
                                let c = tablo.get(i * boy..i * boy + boy).unwrap_or(&[0, 0, 0, 0]);
                                rgba[(y * w + x) * 4..][..4].copy_from_slice(&[c[0], c[1], c[2], if alfa { c[3] } else { 255 }]);
                            }
                        }
                    }
                    b => return Err(Hata::Gecersiz(format!("{b} numaralı kayıpsız biçim desteklenmiyor"))),
                }
                Ok((rgba, w, h))
            }
            _ => {
                let (jpeg, alfa) = if e.kod == JPEG3 {
                    let n = u32::from_le_bytes(v[2..6].try_into().unwrap()) as usize;
                    (&v[6..6 + n], Some(&v[6 + n..]))
                } else {
                    (&v[2..], None)
                };
                // bazı araçlar başa fazladan SOI/EOI koyar
                let jpeg = jpeg.strip_prefix(&[0xFF, 0xD9, 0xFF, 0xD8]).unwrap_or(jpeg);
                let g = image::load_from_memory(jpeg).map_err(|e| bozuk(format!("jpeg çözülemedi: {e}")))?.to_rgba8();
                let (w, h) = (g.width() as usize, g.height() as usize);
                let mut rgba = g.into_raw();
                if let Some(a) = alfa.filter(|a| !a.is_empty()).and_then(|a| zlib_ac(a).ok()) {
                    for (p, &x) in rgba.as_chunks_mut::<4>().0.iter_mut().zip(&a) {
                        p[3] = x;
                    }
                }
                Ok((rgba, w, h))
            }
        }
    }

    /// Görseli, arayüzdeki çizimi bozmamak için eski boyutuna getirip DefineBitsLossless2 olarak yazar.
    pub fn gorsel_degistir(&mut self, karakter: u16, rgba: Vec<u8>, w: usize, h: usize, sigdirma: Sigdirma) -> Sonuc<()> {
        let (_, ew, eh) = self.gorsel_rgba(karakter)?;
        let rgba = doku::olcekle(rgba, w, h, ew, eh, sigdirma)?;
        let mut argb = Vec::with_capacity(ew * eh * 4);
        for p in rgba.as_chunks::<4>().0 {
            let a = p[3] as u32;
            let on = |c: u8| ((c as u32 * a + 127) / 255) as u8;
            argb.extend_from_slice(&[p[3], on(p[0]), on(p[1]), on(p[2])]);
        }
        let mut veri = Vec::new();
        veri.extend_from_slice(&karakter.to_le_bytes());
        veri.push(5);
        veri.extend_from_slice(&(ew as u16).to_le_bytes());
        veri.extend_from_slice(&(eh as u16).to_le_bytes());
        veri.extend(zlib(&argb));

        let e = self.etiket(karakter)?;
        let (bas, son) = (e.bas, e.veri.end);
        let mut yeni = Vec::with_capacity(veri.len() + 6);
        yeni.extend_from_slice(&((KAYIPSIZ2 << 6) | 0x3f).to_le_bytes());
        yeni.extend_from_slice(&(veri.len() as u32).to_le_bytes());
        yeni.extend(veri);
        self.govde.splice(bas..son, yeni);
        *self = Gfx::coz(&self.dosya())?;
        Ok(())
    }

    pub fn dosya(&self) -> Vec<u8> {
        let mut d = Vec::with_capacity(self.govde.len() + 8);
        d.extend_from_slice(if self.sikistirilmis { b"CFX" } else { b"GFX" });
        d.push(self.surum);
        d.extend_from_slice(&((self.govde.len() + 8) as u32).to_le_bytes());
        if self.sikistirilmis {
            d.extend(zlib(&self.govde));
        } else {
            d.extend_from_slice(&self.govde);
        }
        d
    }
}
