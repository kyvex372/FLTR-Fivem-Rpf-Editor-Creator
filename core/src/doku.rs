use fast_image_resize::images::Image;
use image::ImageEncoder;
use fast_image_resize::{FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};
use serde::{Deserialize, Serialize};
use texpresso::{Format, Params};

use crate::{Hata, Sonuc, bozuk, u32_oku};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Bicim {
    Dxt1,
    Dxt3,
    Dxt5,
    Ati1,
    Ati2,
    Bc7,
    A8R8G8B8,
    A8B8G8R8,
    A1R5G5B5,
    A8,
    L8,
    Bilinmeyen(u32),
}

impl Bicim {
    pub fn koddan(k: u32) -> Bicim {
        match k {
            0x3154_5844 => Bicim::Dxt1,
            0x3354_5844 => Bicim::Dxt3,
            0x3554_5844 => Bicim::Dxt5,
            0x3149_5441 => Bicim::Ati1,
            0x3249_5441 => Bicim::Ati2,
            0x2037_4342 => Bicim::Bc7,
            21 => Bicim::A8R8G8B8,
            32 => Bicim::A8B8G8R8,
            25 => Bicim::A1R5G5B5,
            28 => Bicim::A8,
            50 => Bicim::L8,
            k => Bicim::Bilinmeyen(k),
        }
    }

    pub fn ad(self) -> String {
        match self {
            Bicim::Dxt1 => "DXT1".into(),
            Bicim::Dxt3 => "DXT3".into(),
            Bicim::Dxt5 => "DXT5".into(),
            Bicim::Ati1 => "BC4".into(),
            Bicim::Ati2 => "BC5".into(),
            Bicim::Bc7 => "BC7".into(),
            Bicim::A8R8G8B8 => "A8R8G8B8".into(),
            Bicim::A8B8G8R8 => "A8B8G8R8".into(),
            Bicim::A1R5G5B5 => "A1R5G5B5".into(),
            Bicim::A8 => "A8".into(),
            Bicim::L8 => "L8".into(),
            Bicim::Bilinmeyen(k) => format!("?{k:#x}"),
        }
    }

    fn blok(self) -> Option<usize> {
        match self {
            Bicim::Dxt1 | Bicim::Ati1 => Some(8),
            Bicim::Dxt3 | Bicim::Dxt5 | Bicim::Ati2 | Bicim::Bc7 => Some(16),
            _ => None,
        }
    }

    fn piksel(self) -> Option<usize> {
        match self {
            Bicim::A8R8G8B8 | Bicim::A8B8G8R8 => Some(4),
            Bicim::A1R5G5B5 => Some(2),
            Bicim::A8 | Bicim::L8 => Some(1),
            _ => None,
        }
    }

    pub fn blok_sikistirmali(self) -> bool {
        self.blok().is_some()
    }

    pub fn destekli(self) -> bool {
        !matches!(self, Bicim::Bilinmeyen(_))
    }

    pub fn seviye_boyutu(self, w: usize, h: usize) -> Option<usize> {
        match (self.blok(), self.piksel()) {
            (Some(b), _) => Some(w.div_ceil(4).max(1) * h.div_ceil(4).max(1) * b),
            (_, Some(p)) => Some(w * h * p),
            _ => None,
        }
    }

    pub fn satir_adimi(self, w: usize) -> Option<usize> {
        match (self.blok(), self.piksel()) {
            (Some(b), _) => Some(w.div_ceil(4).max(1) * b),
            (_, Some(p)) => Some(w * p),
            _ => None,
        }
    }

    fn texpresso(self) -> Option<Format> {
        match self {
            Bicim::Dxt1 => Some(Format::Bc1),
            Bicim::Dxt3 => Some(Format::Bc2),
            Bicim::Dxt5 => Some(Format::Bc3),
            Bicim::Ati1 => Some(Format::Bc4),
            Bicim::Ati2 => Some(Format::Bc5),
            _ => None,
        }
    }
}

pub fn coz(b: Bicim, veri: &[u8], w: usize, h: usize) -> Sonuc<Vec<u8>> {
    let gerek = b.seviye_boyutu(w, h).ok_or_else(|| Hata::Gecersiz(format!("{} biçimi çözülemiyor", b.ad())))?;
    let veri = veri.get(..gerek).ok_or_else(|| bozuk("doku verisi eksik"))?;
    let mut rgba = vec![0u8; w * h * 4];
    if let Some(f) = b.texpresso() {
        f.decompress(veri, w, h, &mut rgba);
        if b == Bicim::Ati1 {
            for p in rgba.as_chunks_mut::<4>().0.iter_mut() {
                p[1] = p[0];
                p[2] = p[0];
                p[3] = 255;
            }
        } else if b == Bicim::Ati2 {
            for p in rgba.as_chunks_mut::<4>().0.iter_mut() {
                p[2] = 0;
                p[3] = 255;
            }
        }
        return Ok(rgba);
    }
    match b {
        Bicim::Bc7 => {
            let mut blok = [0u8; 64];
            let bw = w.div_ceil(4);
            for (i, sikisik) in veri.as_chunks::<16>().0.iter().enumerate() {
                bcdec_rs::bc7(sikisik, &mut blok, 16);
                let (bx, by) = (i % bw * 4, i / bw * 4);
                for y in 0..4 {
                    for x in 0..4 {
                        let (px, py) = (bx + x, by + y);
                        if px < w && py < h {
                            let d = (py * w + px) * 4;
                            let s = (y * 4 + x) * 4;
                            rgba[d..d + 4].copy_from_slice(&blok[s..s + 4]);
                        }
                    }
                }
            }
        }
        Bicim::A8R8G8B8 => {
            for (d, s) in rgba.as_chunks_mut::<4>().0.iter_mut().zip(veri.as_chunks::<4>().0.iter()) {
                d.copy_from_slice(&[s[2], s[1], s[0], s[3]]);
            }
        }
        Bicim::A8B8G8R8 => rgba.copy_from_slice(veri),
        Bicim::A1R5G5B5 => {
            for (d, s) in rgba.as_chunks_mut::<4>().0.iter_mut().zip(veri.as_chunks::<2>().0.iter()) {
                let v = u16::from_le_bytes([s[0], s[1]]);
                let kanal = |k: u16| ((k & 0x1F) * 255 / 31) as u8;
                d.copy_from_slice(&[kanal(v >> 10), kanal(v >> 5), kanal(v), if v & 0x8000 != 0 { 255 } else { 0 }]);
            }
        }
        Bicim::A8 => {
            for (d, &a) in rgba.as_chunks_mut::<4>().0.iter_mut().zip(veri) {
                d.copy_from_slice(&[255, 255, 255, a]);
            }
        }
        Bicim::L8 => {
            for (d, &l) in rgba.as_chunks_mut::<4>().0.iter_mut().zip(veri) {
                d.copy_from_slice(&[l, l, l, 255]);
            }
        }
        _ => unreachable!(),
    }
    Ok(rgba)
}

pub fn kodla(b: Bicim, rgba: &[u8], w: usize, h: usize) -> Sonuc<Vec<u8>> {
    let boyut = b.seviye_boyutu(w, h).ok_or_else(|| Hata::Gecersiz(format!("{} biçimine yazılamıyor", b.ad())))?;
    if let Some(f) = b.texpresso() {
        let mut cikti = vec![0u8; boyut];
        let params = Params { weigh_colour_by_alpha: b != Bicim::Dxt1, ..Params::default() };
        f.compress(rgba, w, h, params, &mut cikti);
        return Ok(cikti);
    }
    Ok(match b {
        Bicim::Bc7 => {
            // ISPC kodlayıcı 4'ün katı boyut ister; kenar pikselleri tekrarlanarak doldurulur.
            let (pw, ph) = (w.div_ceil(4) * 4, h.div_ceil(4) * 4);
            let mut dolu = vec![0u8; pw * ph * 4];
            for y in 0..ph {
                for x in 0..pw {
                    let s = (y.min(h - 1) * w + x.min(w - 1)) * 4;
                    let d = (y * pw + x) * 4;
                    dolu[d..d + 4].copy_from_slice(&rgba[s..s + 4]);
                }
            }
            let yuzey = intel_tex_2::RgbaSurface { data: &dolu, width: pw as u32, height: ph as u32, stride: pw as u32 * 4 };
            intel_tex_2::bc7::compress_blocks(&intel_tex_2::bc7::alpha_basic_settings(), &yuzey)
        }
        Bicim::A8R8G8B8 => rgba.as_chunks::<4>().0.iter().flat_map(|p| [p[2], p[1], p[0], p[3]]).collect(),
        Bicim::A8B8G8R8 => rgba.to_vec(),
        Bicim::A1R5G5B5 => rgba
            .as_chunks::<4>().0.iter()
            .flat_map(|p| {
                let k = |c: u8| (c as u16 * 31 + 127) / 255;
                let v = (if p[3] >= 128 { 0x8000 } else { 0 }) | k(p[0]) << 10 | k(p[1]) << 5 | k(p[2]);
                v.to_le_bytes()
            })
            .collect(),
        Bicim::A8 => rgba.as_chunks::<4>().0.iter().map(|p| p[3]).collect(),
        Bicim::L8 => rgba
            .as_chunks::<4>().0.iter()
            .map(|p| ((p[0] as u32 * 54 + p[1] as u32 * 183 + p[2] as u32 * 19) >> 8) as u8)
            .collect(),
        _ => unreachable!(),
    })
}

/// Alfa ağırlıklı 2x2 kutu süzgeciyle bir alt seviye.
pub fn yarim(rgba: &[u8], w: usize, h: usize) -> (Vec<u8>, usize, usize) {
    let (yw, yh) = ((w / 2).max(1), (h / 2).max(1));
    let mut cikti = vec![0u8; yw * yh * 4];
    for y in 0..yh {
        for x in 0..yw {
            let mut top = [0u32; 4];
            for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                let (sx, sy) = ((x * 2 + dx).min(w - 1), (y * 2 + dy).min(h - 1));
                let p = &rgba[(sy * w + sx) * 4..][..4];
                let a = p[3] as u32;
                top[0] += p[0] as u32 * a;
                top[1] += p[1] as u32 * a;
                top[2] += p[2] as u32 * a;
                top[3] += a;
            }
            let d = &mut cikti[(y * yw + x) * 4..][..4];
            for k in 0..3 {
                d[k] = (top[k] + top[3] / 2).checked_div(top[3]).unwrap_or(0) as u8;
            }
            d[3] = top[3].div_ceil(4) as u8;
        }
    }
    (cikti, yw, yh)
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Sigdirma {
    #[default]
    Esnet,
    Sigdir,
    Doldur,
}

pub fn olcekle(rgba: Vec<u8>, w: usize, h: usize, hw: usize, hh: usize, mod_: Sigdirma) -> Sonuc<Vec<u8>> {
    if (w, h) == (hw, hh) {
        return Ok(rgba);
    }
    let kaynak = Image::from_vec_u8(w as u32, h as u32, rgba, PixelType::U8x4).map_err(|e| bozuk(e.to_string()))?;
    let alg = ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Lanczos3));
    let mut r = Resizer::new();
    let hata = |e: fast_image_resize::ResizeError| bozuk(e.to_string());
    match mod_ {
        Sigdirma::Esnet | Sigdirma::Doldur => {
            let mut hedef = Image::new(hw as u32, hh as u32, PixelType::U8x4);
            let secenek = if mod_ == Sigdirma::Doldur { alg.fit_into_destination(Some((0.5, 0.5))) } else { alg };
            r.resize(&kaynak, &mut hedef, &secenek).map_err(hata)?;
            Ok(hedef.into_vec())
        }
        Sigdirma::Sigdir => {
            let oran = (hw as f64 / w as f64).min(hh as f64 / h as f64);
            let (iw, ih) = (((w as f64 * oran).round() as usize).clamp(1, hw), ((h as f64 * oran).round() as usize).clamp(1, hh));
            let mut ara = Image::new(iw as u32, ih as u32, PixelType::U8x4);
            r.resize(&kaynak, &mut ara, &alg).map_err(hata)?;
            let ara = ara.into_vec();
            let mut tuval = vec![0u8; hw * hh * 4];
            let (ox, oy) = ((hw - iw) / 2, (hh - ih) / 2);
            for y in 0..ih {
                let d = ((oy + y) * hw + ox) * 4;
                tuval[d..d + iw * 4].copy_from_slice(&ara[y * iw * 4..(y + 1) * iw * 4]);
            }
            Ok(tuval)
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub struct RenkAyari {
    /// derece, -180..180
    pub ton: f32,
    /// çarpan, 1 = değişmez
    pub doygunluk: f32,
    /// -1..1
    pub parlaklik: f32,
    /// çarpan, 1 = değişmez
    pub kontrast: f32,
    pub boya: Option<[u8; 3]>,
    /// 0..1
    pub boya_gucu: f32,
}

impl RenkAyari {
    /// Hiçbir değişiklik yapmayan ayar; `Default` doygunluk ve kontrastı 0 yaptığı için onun yerine bu kullanılır.
    pub const fn notr() -> RenkAyari {
        RenkAyari { ton: 0.0, doygunluk: 1.0, parlaklik: 0.0, kontrast: 1.0, boya: None, boya_gucu: 0.0 }
    }

    pub fn bos_mu(&self) -> bool {
        self.ton == 0.0
            && self.doygunluk == 1.0
            && self.parlaklik == 0.0
            && self.kontrast == 1.0
            && (self.boya.is_none() || self.boya_gucu == 0.0)
    }
}

fn hsl(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let (mx, mn) = (r.max(g).max(b), r.min(g).min(b));
    let l = (mx + mn) / 2.0;
    if mx == mn {
        return (0.0, 0.0, l);
    }
    let d = mx - mn;
    let s = if l > 0.5 { d / (2.0 - mx - mn) } else { d / (mx + mn) };
    let h = if mx == r {
        (g - b) / d + if g < b { 6.0 } else { 0.0 }
    } else if mx == g {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };
    (h * 60.0, s, l)
}

fn rgb(h: f32, s: f32, l: f32) -> (f32, f32, f32) {
    if s == 0.0 {
        return (l, l, l);
    }
    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    let kanal = |mut t: f32| {
        t = t.rem_euclid(1.0);
        if t < 1.0 / 6.0 {
            p + (q - p) * 6.0 * t
        } else if t < 0.5 {
            q
        } else if t < 2.0 / 3.0 {
            p + (q - p) * (2.0 / 3.0 - t) * 6.0
        } else {
            p
        }
    };
    let h = h / 360.0;
    (kanal(h + 1.0 / 3.0), kanal(h), kanal(h - 1.0 / 3.0))
}

pub fn renk_uygula(rgba: &mut [u8], a: &RenkAyari) {
    if a.bos_mu() {
        return;
    }
    let boya = a.boya.map(|[r, g, b]| hsl(r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0));
    for p in rgba.as_chunks_mut::<4>().0.iter_mut() {
        let (mut h, mut s, mut l) = hsl(p[0] as f32 / 255.0, p[1] as f32 / 255.0, p[2] as f32 / 255.0);
        if let Some((bh, bs, _)) = boya {
            let g = a.boya_gucu.clamp(0.0, 1.0);
            let fark = ((bh - h + 540.0) % 360.0) - 180.0;
            h += fark * g;
            s += (bs - s) * g;
        }
        h += a.ton;
        s = (s * a.doygunluk).clamp(0.0, 1.0);
        l = ((l - 0.5) * a.kontrast + 0.5 + a.parlaklik).clamp(0.0, 1.0);
        let (r, g, b) = rgb(h, s, l);
        p[0] = (r * 255.0).round() as u8;
        p[1] = (g * 255.0).round() as u8;
        p[2] = (b * 255.0).round() as u8;
    }
}

pub fn png(rgba: &[u8], w: usize, h: usize) -> Sonuc<Vec<u8>> {
    let mut cikti = Vec::new();
    image::codecs::png::PngEncoder::new_with_quality(
        &mut cikti,
        image::codecs::png::CompressionType::Fast,
        image::codecs::png::FilterType::Adaptive,
    )
    .write_image(rgba, w as u32, h as u32, image::ExtendedColorType::Rgba8)
    .map_err(|e| bozuk(e.to_string()))?;
    Ok(cikti)
}


/// PNG/JPG/WEBP/BMP/TGA ya da DDS'i RGBA8'e açar.
pub fn gorsel_ac(bayt: &[u8]) -> Sonuc<(Vec<u8>, usize, usize)> {
    if bayt.starts_with(b"DDS ") {
        return dds_oku(bayt);
    }
    let g = image::load_from_memory(bayt).map_err(|e| Hata::Gecersiz(format!("görsel açılamadı: {e}")))?;
    let g = g.into_rgba8();
    let (w, h) = (g.width() as usize, g.height() as usize);
    Ok((g.into_raw(), w, h))
}

fn dds_oku(b: &[u8]) -> Sonuc<(Vec<u8>, usize, usize)> {
    let h = u32_oku(b, 12).ok_or_else(|| bozuk("DDS başlığı kısa"))? as usize;
    let w = u32_oku(b, 16).unwrap_or(0) as usize;
    let dort_cc = u32_oku(b, 84).unwrap_or(0);
    let pf_bayrak = u32_oku(b, 80).unwrap_or(0);
    let (bicim, veri_bas) = match b.get(84..88).unwrap_or_default() {
        b"DXT1" => (Bicim::Dxt1, 128),
        b"DXT3" => (Bicim::Dxt3, 128),
        b"DXT5" => (Bicim::Dxt5, 128),
        b"ATI1" | b"BC4U" => (Bicim::Ati1, 128),
        b"ATI2" | b"BC5U" => (Bicim::Ati2, 128),
        b"DX10" => match u32_oku(b, 128).unwrap_or(0) {
            71 | 72 => (Bicim::Dxt1, 148),
            74 | 75 => (Bicim::Dxt3, 148),
            77 | 78 => (Bicim::Dxt5, 148),
            80 => (Bicim::Ati1, 148),
            83 => (Bicim::Ati2, 148),
            98 | 99 => (Bicim::Bc7, 148),
            28 | 29 => (Bicim::A8B8G8R8, 148),
            87 => (Bicim::A8R8G8B8, 148),
            x => return Err(Hata::Gecersiz(format!("DDS DXGI biçimi desteklenmiyor: {x}"))),
        },
        _ if pf_bayrak & 0x40 != 0 && u32_oku(b, 88) == Some(32) => {
            if u32_oku(b, 92) == Some(0x00FF_0000) { (Bicim::A8R8G8B8, 128) } else { (Bicim::A8B8G8R8, 128) }
        }
        _ => return Err(Hata::Gecersiz(format!("DDS biçimi desteklenmiyor: {dort_cc:#x}"))),
    };
    let rgba = coz(bicim, b.get(veri_bas..).unwrap_or_default(), w, h)?;
    Ok((rgba, w, h))
}

/// Tüm mip seviyelerini içeren ham doku verisini DDS dosyasına sarar.
pub fn dds_yaz(bicim: Bicim, w: usize, h: usize, seviye: usize, veri: &[u8]) -> Sonuc<Vec<u8>> {
    let mut d = vec![0u8; 128];
    let yaz = |d: &mut Vec<u8>, o: usize, v: u32| d[o..o + 4].copy_from_slice(&v.to_le_bytes());
    d[..4].copy_from_slice(b"DDS ");
    yaz(&mut d, 4, 124);
    let sikisik = bicim.blok().is_some();
    yaz(&mut d, 8, 0x1 | 0x2 | 0x4 | 0x1000 | 0x20000 | if sikisik { 0x80000 } else { 0x8 });
    yaz(&mut d, 12, h as u32);
    yaz(&mut d, 16, w as u32);
    let adim = if sikisik { bicim.seviye_boyutu(w, h) } else { bicim.satir_adimi(w) };
    yaz(&mut d, 20, adim.unwrap_or(0) as u32);
    yaz(&mut d, 28, seviye as u32);
    yaz(&mut d, 76, 32);
    let mut ek = Vec::new();
    match bicim {
        Bicim::Dxt1 | Bicim::Dxt3 | Bicim::Dxt5 | Bicim::Ati1 | Bicim::Ati2 => {
            let cc: &[u8; 4] = match bicim {
                Bicim::Dxt1 => b"DXT1",
                Bicim::Dxt3 => b"DXT3",
                Bicim::Dxt5 => b"DXT5",
                Bicim::Ati1 => b"ATI1",
                _ => b"ATI2",
            };
            yaz(&mut d, 80, 0x4);
            d[84..88].copy_from_slice(cc);
        }
        Bicim::Bc7 => {
            yaz(&mut d, 80, 0x4);
            d[84..88].copy_from_slice(b"DX10");
            for v in [98u32, 3, 0, 1, 0] {
                ek.extend_from_slice(&v.to_le_bytes());
            }
        }
        Bicim::A8R8G8B8 | Bicim::A8B8G8R8 => {
            yaz(&mut d, 80, 0x41);
            yaz(&mut d, 88, 32);
            let (r, b) = if bicim == Bicim::A8R8G8B8 { (0x00FF_0000, 0xFF) } else { (0xFF, 0x00FF_0000) };
            yaz(&mut d, 92, r);
            yaz(&mut d, 96, 0xFF00);
            yaz(&mut d, 100, b);
            yaz(&mut d, 104, 0xFF00_0000);
        }
        b => return Err(Hata::Gecersiz(format!("{} DDS olarak yazılamıyor, PNG kullan", b.ad()))),
    }
    yaz(&mut d, 108, 0x1000 | if seviye > 1 { 0x400008 } else { 0 });
    d.extend_from_slice(&ek);
    d.extend_from_slice(veri);
    Ok(d)
}
