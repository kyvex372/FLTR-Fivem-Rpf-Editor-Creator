use std::collections::BTreeMap;
use std::sync::Arc;

use fltr_rpf_core::rpf::{self, Arsiv, Dugum};

fn main() {
    for yol in std::env::args().skip(1) {
        let bayt = match std::fs::read(&yol) {
            Ok(b) => b,
            Err(e) => {
                println!("{yol}: okunamadı {e}");
                continue;
            }
        };
        let t0 = std::time::Instant::now();
        match Arsiv::oku(Arc::from(bayt)) {
            Err(e) => println!("{yol}: HATA {e}"),
            Ok(a) => {
                let mut turler: BTreeMap<String, (usize, usize)> = BTreeMap::new();
                let mut opak = Vec::new();
                let mut ic = 0;
                a.gez(|y, d| match d {
                    Dugum::Arsiv(x) => {
                        ic += 1;
                        let _ = x;
                    }
                    Dugum::Dosya(f) => {
                        let uz = y.rsplit('.').next().unwrap_or("").to_lowercase();
                        let e = turler.entry(uz.clone()).or_default();
                        e.0 += 1;
                        e.1 += f.boyut();
                        if uz == "rpf" {
                            let v = f.veri().map(|v| v.get(12..16).map(|b| u32::from_le_bytes(b.try_into().unwrap())).unwrap_or(0)).unwrap_or(0);
                            opak.push(format!("{y} (şifre {})", rpf::sifreleme_adi(v)));
                        }
                    }
                    _ => {}
                });
                println!("{yol}: {} ms, {} iç arşiv, şifre {}", t0.elapsed().as_millis(), ic, rpf::sifreleme_adi(a.sifreleme));
                println!("   türler: {}", turler.iter().map(|(k, (n, b))| format!("{k}:{n}({}MB)", b >> 20)).collect::<Vec<_>>().join(" "));
                for o in opak.iter().take(8) {
                    println!("   AÇILAMAYAN İÇ RPF: {o}");
                }
                if std::env::var_os("LISTE").is_some() {
                    a.gez(|y, d| {
                        if let Dugum::Dosya(f) = d {
                            println!("   {y} {}", f.boyut());
                        }
                    });
                }
            }
        }
    }
}
