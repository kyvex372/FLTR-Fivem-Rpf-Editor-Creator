//! ESC/radar haritası bitmap karoları: düzen, karo adı çözümü ve görsel katmanlarını karolara işleme.
//!
//! Karo (satır, sütun) dünyada `baslangic.x + sütun*karo.x` solundan, `baslangic.y - satır*karo.y` üstünden başlar;
//! dünya y yukarı, doku v aşağı doğru artar.

use rayon::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Duzen {
    pub sutun: u32,
    pub satir: u32,
    pub karo: [f64; 2],
    pub baslangic: [f64; 2],
}

/// Oyunun kendi minimap.ymt değerleri; pakette minimap.ymt yoksa bunlar geçerlidir.
impl Default for Duzen {
    fn default() -> Self {
        Duzen { sutun: 2, satir: 3, karo: [4500.0, 4500.0], baslangic: [-4140.0, 8400.0] }
    }
}

/// minimap.ymt'nin XML dökümünden `Bitmap` düzenini okur.
pub fn duzen_oku(xml: &str) -> Option<Duzen> {
    let oz = |etiket: &str, ad: &str| -> Option<f64> {
        let i = xml.find(&format!("<{etiket} "))?;
        let parca = &xml[i..i + xml[i..].find('>')?];
        let a = parca.find(&format!("{ad}=\""))? + ad.len() + 2;
        let b = a + parca[a..].find('"')?;
        parca[a..b].trim().parse().ok()
    };
    Some(Duzen {
        sutun: oz("iBitmapTilesX", "value")? as u32,
        satir: oz("iBitmapTilesY", "value")? as u32,
        karo: [oz("vBitmapTileSize", "x")?, oz("vBitmapTileSize", "y")?],
        baslangic: [oz("vBitmapStart", "x")?, oz("vBitmapStart", "y")?],
    })
}

/// `minimap_sea_1_0` → ("sea", 1, 0), `minimap_2_1` → ("minimap", 2, 1). `minimap_lod_128` karo değildir.
pub fn karo_adi(ad: &str) -> Option<(&'static str, u32, u32)> {
    let ad = ad.to_ascii_lowercase();
    let (varyant, kalan) = match ad.strip_prefix("minimap_sea_") {
        Some(k) => ("sea", k.to_string()),
        None => ("minimap", ad.strip_prefix("minimap_")?.to_string()),
    };
    let (a, b) = kalan.split_once('_')?;
    Some((varyant, a.parse().ok()?, b.parse().ok()?))
}

/// Karonun dünya dikdörtgeni: [sol, üst, genişlik, yükseklik] (üst en büyük y).
pub fn karo_dikdortgeni(d: &Duzen, satir: u32, sutun: u32) -> [f64; 4] {
    [
        d.baslangic[0] + sutun as f64 * d.karo[0],
        d.baslangic[1] - satir as f64 * d.karo[1],
        d.karo[0],
        d.karo[1],
    ]
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Karisim {
    #[default]
    Normal,
    Carp,
    Ekran,
}

pub struct Katman<'a> {
    pub rgba: &'a [u8],
    pub w: usize,
    pub h: usize,
    /// dünya koordinatında merkez
    pub merkez: [f64; 2],
    /// dünya biriminde genişlik, yükseklik
    pub boyut: [f64; 2],
    /// derece, dünyada saat yönünün tersi
    pub donus: f64,
    pub opaklik: f32,
    pub karisim: Karisim,
}

impl Katman<'_> {
    fn sinir_kutusu(&self) -> [f64; 4] {
        let (s, c) = self.donus.to_radians().sin_cos();
        let (yw, yh) = (self.boyut[0] / 2.0, self.boyut[1] / 2.0);
        let ex = (yw * c).abs() + (yh * s).abs();
        let ey = (yw * s).abs() + (yh * c).abs();
        [self.merkez[0] - ex, self.merkez[1] - ey, self.merkez[0] + ex, self.merkez[1] + ey]
    }

    /// Dünya noktasındaki katman rengi (düz alfa, 0..1); katman dışındaysa None.
    fn ornek(&self, wx: f64, wy: f64, cos: f64, sin: f64) -> Option<[f32; 4]> {
        let (dx, dy) = (wx - self.merkez[0], wy - self.merkez[1]);
        let lx = dx * cos + dy * sin;
        let ly = -dx * sin + dy * cos;
        let u = lx / self.boyut[0] + 0.5;
        let v = 0.5 - ly / self.boyut[1];
        if !(0.0..1.0).contains(&u) || !(0.0..1.0).contains(&v) {
            return None;
        }
        let fx = (u * self.w as f64 - 0.5).clamp(0.0, (self.w - 1) as f64);
        let fy = (v * self.h as f64 - 0.5).clamp(0.0, (self.h - 1) as f64);
        let (x0, y0) = (fx as usize, fy as usize);
        let (x1, y1) = ((x0 + 1).min(self.w - 1), (y0 + 1).min(self.h - 1));
        let (tx, ty) = ((fx - x0 as f64) as f32, (fy - y0 as f64) as f32);
        let p = |x: usize, y: usize| &self.rgba[(y * self.w + x) * 4..][..4];
        let (a, b, c, d) = (p(x0, y0), p(x1, y0), p(x0, y1), p(x1, y1));
        // alfa ağırlıklı ara değer: şeffaf kenarlar koyu hale bırakmasın
        let mut t = [0f32; 4];
        for (px, w) in [(a, (1.0 - tx) * (1.0 - ty)), (b, tx * (1.0 - ty)), (c, (1.0 - tx) * ty), (d, tx * ty)] {
            let al = px[3] as f32 / 255.0 * w;
            for k in 0..3 {
                t[k] += px[k] as f32 / 255.0 * al;
            }
            t[3] += al;
        }
        if t[3] <= 0.0 {
            return None;
        }
        Some([t[0] / t[3], t[1] / t[3], t[2] / t[3], t[3]])
    }
}

/// Karoyu açıp çözmeye değer mi: görünür bir katmanın sınır kutusu karo dikdörtgenine değiyor mu.
pub fn karoya_degiyor(dikdortgen: [f64; 4], katmanlar: &[Katman]) -> bool {
    let [sol, ust, kw, kh] = dikdortgen;
    katmanlar.iter().any(|k| {
        let [x0, y0, x1, y1] = k.sinir_kutusu();
        k.w > 0 && k.h > 0 && k.opaklik > 0.0 && x1 > sol && x0 < sol + kw && y1 > ust - kh && y0 < ust
    })
}

/// Katmanları karonun RGBA verisine işler. Karo dikdörtgeni [sol, üst, genişlik, yükseklik].
/// Karoya değen katman yoksa false döner ve veri değişmez.
pub fn isle(karo: &mut [u8], w: usize, h: usize, dikdortgen: [f64; 4], katmanlar: &[Katman]) -> bool {
    let [sol, ust, kw, kh] = dikdortgen;
    let mut degisti = false;
    for k in katmanlar {
        if k.w == 0 || k.h == 0 || k.opaklik <= 0.0 {
            continue;
        }
        let [x0, y0, x1, y1] = k.sinir_kutusu();
        // dünya → piksel aralığı
        let px0 = (((x0 - sol) / kw) * w as f64).floor().max(0.0) as usize;
        let px1 = ((((x1 - sol) / kw) * w as f64).ceil() as usize).min(w);
        let py0 = (((ust - y1) / kh) * h as f64).floor().max(0.0) as usize;
        let py1 = ((((ust - y0) / kh) * h as f64).ceil() as usize).min(h);
        if px0 >= px1 || py0 >= py1 {
            continue;
        }
        degisti = true;
        let (sin, cos) = k.donus.to_radians().sin_cos();
        karo.par_chunks_mut(w * 4).enumerate().skip(py0).take(py1 - py0).for_each(|(py, satir)| {
            let wy = ust - (py as f64 + 0.5) / h as f64 * kh;
            for px in px0..px1 {
                let wx = sol + (px as f64 + 0.5) / w as f64 * kw;
                let Some(s) = k.ornek(wx, wy, cos, sin) else { continue };
                let a = s[3] * k.opaklik;
                let d = &mut satir[px * 4..px * 4 + 4];
                let da = d[3] as f32 / 255.0;
                for c in 0..3 {
                    let dc = d[c] as f32 / 255.0;
                    let kaynak = match k.karisim {
                        Karisim::Normal => s[c],
                        Karisim::Carp => s[c] * dc,
                        Karisim::Ekran => 1.0 - (1.0 - s[c]) * (1.0 - dc),
                    };
                    d[c] = ((kaynak * a + dc * (1.0 - a)) * 255.0).round().clamp(0.0, 255.0) as u8;
                }
                d[3] = ((a + da * (1.0 - a)) * 255.0).round().clamp(0.0, 255.0) as u8;
            }
        });
    }
    degisti
}

#[cfg(test)]
mod testler {
    use super::*;

    #[test]
    fn duzen_ve_karo_adlari() {
        let xml = r#"<Bitmap><iBitmapTilesX value="2"/><iBitmapTilesY value="3"/><vBitmapTileSize x="4500" y="4500"/><vBitmapStart x="-4140" y="8400"/></Bitmap>"#;
        assert_eq!(duzen_oku(xml), Some(Duzen::default()));
        assert_eq!(karo_adi("minimap_sea_2_1"), Some(("sea", 2, 1)));
        assert_eq!(karo_adi("minimap_0_1"), Some(("minimap", 0, 1)));
        assert_eq!(karo_adi("minimap_lod_128"), None);
        assert_eq!(karo_dikdortgeni(&Duzen::default(), 1, 1), [360.0, 3900.0, 4500.0, 4500.0]);
    }

    #[test]
    fn katman_dogru_yere_yazilir() {
        // 100x100 piksellik karo, dünya [0,100]x[0,100]; kırmızı 2x2 görsel dünya (75,75) merkezli 20x20 alana
        let (w, h) = (100, 100);
        let mut karo = [0u8, 0, 255, 255].repeat(w * h);
        let gorsel = [255u8, 0, 0, 255].repeat(4);
        let k = Katman { rgba: &gorsel, w: 2, h: 2, merkez: [75.0, 75.0], boyut: [20.0, 20.0], donus: 0.0, opaklik: 1.0, karisim: Karisim::Normal };
        assert!(isle(&mut karo, w, h, [0.0, 100.0, 100.0, 100.0], &[k]));
        let piksel = |x: usize, y: usize| &karo[(y * w + x) * 4..][..4];
        // dünya (75,75) → piksel (75, 25): y yukarı dünyada, aşağı dokuda
        assert_eq!(piksel(75, 25), &[255, 0, 0, 255]);
        assert_eq!(piksel(75, 75), &[0, 0, 255, 255], "katman dışı değişmemeli");
        assert_eq!(piksel(20, 25), &[0, 0, 255, 255]);

        let mut karo2 = [0u8, 0, 255, 255].repeat(w * h);
        let uzak = Katman { rgba: &gorsel, w: 2, h: 2, merkez: [500.0, 500.0], boyut: [20.0, 20.0], donus: 30.0, opaklik: 1.0, karisim: Karisim::Normal };
        assert!(!karoya_degiyor([0.0, 100.0, 100.0, 100.0], std::slice::from_ref(&uzak)));
        assert!(!isle(&mut karo2, w, h, [0.0, 100.0, 100.0, 100.0], &[uzak]));
        let kenar = Katman { rgba: &gorsel, w: 2, h: 2, merkez: [105.0, 50.0], boyut: [20.0, 20.0], donus: 0.0, opaklik: 1.0, karisim: Karisim::Normal };
        assert!(karoya_degiyor([0.0, 100.0, 100.0, 100.0], &[kenar]), "yarısı karoda olan katman");
    }

    #[test]
    fn donus_saat_yonunun_tersine() {
        // yatay şerit (40x4) 90° dönünce dikey olmalı
        let (w, h) = (100, 100);
        let mut karo = vec![0u8; w * h * 4];
        let gorsel = [255u8, 255, 255, 255].repeat(40 * 4);
        let k = Katman { rgba: &gorsel, w: 40, h: 4, merkez: [50.0, 50.0], boyut: [40.0, 4.0], donus: 90.0, opaklik: 1.0, karisim: Karisim::Normal };
        isle(&mut karo, w, h, [0.0, 100.0, 100.0, 100.0], &[k]);
        let dolu = |x: usize, y: usize| karo[(y * w + x) * 4 + 3] > 0;
        assert!(dolu(50, 35) && dolu(50, 65), "dikey uçlar dolu");
        assert!(!dolu(35, 50) && !dolu(65, 50), "yatay uçlar boş");
    }
}
