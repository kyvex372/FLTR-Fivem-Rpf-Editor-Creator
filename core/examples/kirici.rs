//! Bozuk girdide çöken ayrıştırıcıları bulur: gerçek dosyaları kırpar ve baytlarını bozar.
use std::collections::BTreeMap;
use std::panic;
use std::sync::Arc;

use fltr_rpf_core::rpf::{Arsiv, Dugum};

fn main() {
    panic::set_hook(Box::new(|_| {}));
    let mut cokmeler: BTreeMap<String, (usize, String)> = BTreeMap::new();
    let mut deneme = 0;
    let mut tohum: u64 = 0x9E3779B97F4A7C15;
    let mut rastgele = move || {
        tohum ^= tohum << 13;
        tohum ^= tohum >> 7;
        tohum ^= tohum << 17;
        tohum
    };
    for giris in std::fs::read_dir("testdata").unwrap().flatten() {
        let bayt = std::fs::read(giris.path()).unwrap();
        // arşivin kendisi: kırpılmış ve bozulmuş
        for n in [16usize, 100, 1000, bayt.len() / 3, bayt.len() / 2] {
            let mut v = bayt[..n.min(bayt.len())].to_vec();
            if n > 200 {
                for _ in 0..8 {
                    let i = (rastgele() as usize) % v.len();
                    v[i] ^= rastgele() as u8;
                }
            }
            deneme += 1;
            if let Err(e) = panic::catch_unwind(|| { let _ = Arsiv::oku(Arc::from(v)); }) {
                let m = e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default();
                cokmeler.entry(format!("Arsiv::oku: {m}")).or_insert((0, giris.file_name().to_string_lossy().into())).0 += 1;
            }
        }
        let Ok(a) = Arsiv::oku(Arc::from(bayt)) else { continue };
        let mut dosyalar = Vec::new();
        a.gez(|y, d| if let Dugum::Dosya(f) = d && let Ok(v) = f.veri() { dosyalar.push((y.to_lowercase(), v.into_owned())) });
        for (yol, v) in dosyalar.iter().filter(|(_, v)| v.len() > 64).take(400) {
            let uz = yol.rsplit('.').next().unwrap_or("").to_string();
            for tur in 0..6 {
                let mut b = v.clone();
                match tur {
                    0 => b.truncate(b.len() / 2),
                    1 => b.truncate(b.len().min(40)),
                    _ => {
                        // RSC başlığını koruyup gövdeyi boz: çözülmüş yapıya bozuk veri gelsin
                        for _ in 0..(tur * 6) {
                            let i = 16 + (rastgele() as usize) % (b.len() - 16);
                            b[i] ^= rastgele() as u8;
                        }
                    }
                }
                let calistir = |ad: &str, f: &dyn Fn()| {
                    if let Err(e) = panic::catch_unwind(panic::AssertUnwindSafe(f)) {
                        let m = e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default();
                        Some(format!("{ad}: {}", m.chars().take(90).collect::<String>()))
                    } else {
                        None
                    }
                };
                let mut sonuclar = Vec::new();
                deneme += 1;
                match uz.as_str() {
                    "ytd" => sonuclar.push(calistir("ytd", &|| {
                        if let Ok(y) = fltr_rpf_core::ytd::Ytd::coz(&b) {
                            for i in 0..y.dokular.len() { let _ = y.rgba(i, 0); let _ = y.dds(i); }
                        }
                    })),
                    "ydr" | "ydd" | "yft" | "ypt" => {
                        sonuclar.push(calistir("gömülü doku", &|| {
                            if let Ok(y) = fltr_rpf_core::ytd::Ytd::modelden(&b, &uz) {
                                for i in 0..y.dokular.len() { let _ = y.rgba(i, 0); }
                            }
                        }));
                        if uz != "ypt" {
                            sonuclar.push(calistir("model_oku", &|| { let _ = fltr_rpf_core::model::model_oku(&b, &uz); }));
                            sonuclar.push(calistir("obj_yaz", &|| { let _ = fltr_rpf_core::model::obj_yaz(&b, &uz, "x"); }));
                        } else {
                            sonuclar.push(calistir("ypt::oku", &|| {
                                if let Ok(k) = fltr_rpf_core::rsc::Kaynak::coz(&b) { let _ = fltr_rpf_core::ypt::oku(&k); }
                            }));
                        }
                    }
                    "ybn" => sonuclar.push(calistir("carpisma_oku", &|| { let _ = fltr_rpf_core::model::carpisma_oku(&b); })),
                    "gfx" => sonuclar.push(calistir("gfx", &|| {
                        if let Ok(g) = fltr_rpf_core::gfx::Gfx::coz(&b) {
                            for x in g.gorseller() { let _ = g.gorsel_rgba(x.karakter); }
                            let _ = g.dis_gorseller();
                        }
                    })),
                    "ymt" | "ymap" | "ytyp" | "ymf" => sonuclar.push(calistir("meta_xml", &|| { let _ = fltr_rpf_core::model::meta_xml(&b); })),
                    "dat" => sonuclar.push(calistir("vs", &|| { let a = fltr_rpf_core::vs::Ayarlar::coz(&String::from_utf8_lossy(&b)); let _ = a.renkler(); })),
                    "xml" if yol.ends_with("assembly.xml") => sonuclar.push(calistir("oiv", &|| { let _ = fltr_rpf_core::oiv::coz(&String::from_utf8_lossy(&b)); })),
                    _ => {}
                }
                for m in sonuclar.into_iter().flatten() {
                    cokmeler.entry(m).or_insert((0, yol.clone())).0 += 1;
                }
            }
        }
    }
    println!("{deneme} deneme, {} farklı çökme", cokmeler.len());
    for (m, (n, ornek)) in cokmeler {
        println!("{n:>4} × {m}  (ör. {ornek})");
    }
}
