//! visualsettings.dat: `anahtar değer` satırları. Dokunulmayan her satır olduğu gibi korunur.

use std::collections::HashMap;
use std::ops::Range;

use serde::Serialize;

struct Satir {
    ham: String,
    anahtar: Option<Range<usize>>,
    deger: Option<Range<usize>>,
}

pub struct Ayarlar {
    satirlar: Vec<Satir>,
    ayirici: &'static str,
    son_satir_sonu: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct Girdi {
    pub anahtar: String,
    pub deger: String,
    pub satir: usize,
    pub tekrar: usize,
}

#[derive(Serialize, Clone, Debug)]
pub struct RenkUclusu {
    pub taban: String,
    pub anahtarlar: [String; 3],
    /// 255 ya da 1
    pub olcek: f32,
}

fn satir_anahtari(s: &Satir) -> Option<&str> {
    s.anahtar.clone().map(|r| &s.ham[r])
}

fn satir_coz(ham: &str) -> Satir {
    let bos = |ham: &str| Satir { ham: ham.to_string(), anahtar: None, deger: None };
    let icerik = ham.trim_start();
    if icerik.is_empty() || icerik.starts_with('#') || icerik.starts_with("//") {
        return bos(ham);
    }
    let bas = ham.len() - icerik.len();
    let Some(bosluk) = icerik.find(char::is_whitespace) else {
        return bos(ham);
    };
    let anahtar = bas..bas + bosluk;
    let geri = &ham[anahtar.end..];
    let deger_bas = anahtar.end + (geri.len() - geri.trim_start().len());
    let deger_son = ham[deger_bas..].find(char::is_whitespace).map_or(ham.len(), |i| deger_bas + i);
    if deger_bas == deger_son {
        return bos(ham);
    }
    Satir { ham: ham.to_string(), anahtar: Some(anahtar), deger: Some(deger_bas..deger_son) }
}

/// "750.0f" gibi değerlerin sayısal kısmı.
pub fn sayi(deger: &str) -> Option<f64> {
    deger.trim_end_matches(['f', 'F']).parse().ok()
}

impl Ayarlar {
    pub fn coz(metin: &str) -> Ayarlar {
        let ayirici = if metin.contains("\r\n") { "\r\n" } else { "\n" };
        let son_satir_sonu = metin.ends_with('\n');
        let govde = metin.strip_suffix(ayirici).unwrap_or(metin);
        let satirlar = govde.split(ayirici).map(satir_coz).collect();
        Ayarlar { satirlar, ayirici, son_satir_sonu }
    }

    pub fn metin(&self) -> String {
        let mut m = self.satirlar.iter().map(|s| s.ham.as_str()).collect::<Vec<_>>().join(self.ayirici);
        if self.son_satir_sonu {
            m.push_str(self.ayirici);
        }
        m
    }

    /// Her anahtar bir kez; tekrar eden anahtarda son satırın değeri gösterilir, `ayarla` hepsini günceller.
    pub fn girdiler(&self) -> Vec<Girdi> {
        let mut sira: Vec<Girdi> = Vec::new();
        let mut yer: HashMap<&str, usize> = HashMap::new();
        for (i, s) in self.satirlar.iter().enumerate() {
            let (Some(a), Some(d)) = (satir_anahtari(s), s.deger.clone()) else { continue };
            let deger = s.ham[d].to_string();
            match yer.get(a) {
                Some(&j) => {
                    sira[j].deger = deger;
                    sira[j].tekrar += 1;
                }
                None => {
                    yer.insert(a, sira.len());
                    sira.push(Girdi { anahtar: a.to_string(), deger, satir: i + 1, tekrar: 1 });
                }
            }
        }
        sira
    }

    pub fn deger(&self, anahtar: &str) -> Option<&str> {
        self.satirlar
            .iter()
            .rev()
            .find(|s| satir_anahtari(s) == Some(anahtar))
            .and_then(|s| s.deger.clone().map(|d| &s.ham[d]))
    }

    /// Anahtarın bütün tekrarlarını günceller; sayı sonundaki `f` eki korunur. Değişen satır sayısını döner.
    pub fn ayarla(&mut self, anahtar: &str, yeni: &str) -> usize {
        let mut adet = 0;
        for s in &mut self.satirlar {
            let (Some(a), Some(d)) = (s.anahtar.clone(), s.deger.clone()) else { continue };
            if &s.ham[a] != anahtar {
                continue;
            }
            let eski = &s.ham[d.clone()];
            let mut yeni = yeni.trim().to_string();
            if eski.ends_with(['f', 'F']) && sayi(eski).is_some() && !yeni.ends_with(['f', 'F']) && sayi(&yeni).is_some() {
                yeni.push('f');
            }
            if eski == yeni {
                continue;
            }
            s.ham.replace_range(d.clone(), &yeni);
            s.deger = Some(d.start..d.start + yeni.len());
            adet += 1;
        }
        adet
    }

    /// `x.red/.green/.blue`, `x.r/.g/.b` ya da `xR/xG/xB` üçlüleri.
    pub fn renkler(&self) -> Vec<RenkUclusu> {
        let girdiler = self.girdiler();
        let degerler: HashMap<&str, &str> = girdiler.iter().map(|g| (g.anahtar.as_str(), g.deger.as_str())).collect();
        let mut sonuc = Vec::new();
        for g in &girdiler {
            let adaylar: [(&str, [&str; 3]); 4] = [
                (".red", [".red", ".green", ".blue"]),
                (".r", [".r", ".g", ".b"]),
                ("R", ["R", "G", "B"]),
                ("Red", ["Red", "Green", "Blue"]),
            ];
            for (ek, uclu) in adaylar {
                let Some(taban) = g.anahtar.strip_suffix(ek) else { continue };
                let anahtarlar = uclu.map(|e| format!("{taban}{e}"));
                let sayilar: Option<Vec<f64>> =
                    anahtarlar.iter().map(|a| degerler.get(a.as_str()).and_then(|d| sayi(d))).collect();
                if let Some(s) = sayilar {
                    let olcek = if s.iter().any(|&v| v > 1.0) { 255.0 } else { 1.0 };
                    sonuc.push(RenkUclusu { taban: taban.to_string(), anahtarlar, olcek });
                    break;
                }
            }
        }
        sonuc
    }
}

#[cfg(test)]
mod testler {
    use super::*;

    #[test]
    fn satir_duzeni_korunur() {
        let m = "# yorum\r\nmisc.a 1.0f\r\n  car.b.red 255 # not\r\ncar.b.green 0\r\ncar.b.blue 0\r\nmisc.a 2.0f\r\n";
        let mut a = Ayarlar::coz(m);
        assert_eq!(a.metin(), m);
        assert_eq!(a.deger("misc.a"), Some("2.0f"));
        assert_eq!(a.girdiler().iter().find(|g| g.anahtar == "misc.a").unwrap().tekrar, 2);
        assert_eq!(a.ayarla("misc.a", "3.5"), 2);
        assert_eq!(a.ayarla("car.b.red", "128"), 1);
        assert_eq!(a.metin(), m.replace("1.0f", "3.5f").replace("2.0f", "3.5f").replace("255 #", "128 #"));
        let r = a.renkler();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].taban, "car.b");
        assert_eq!(r[0].olcek, 255.0);
    }
}
