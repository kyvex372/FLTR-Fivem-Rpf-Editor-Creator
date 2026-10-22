use std::path::Path;
use std::sync::Arc;

use fltr_rpf_core::doku::{RenkAyari, Sigdirma};
use fltr_rpf_core::rpf::{Arsiv, Dugum};
use fltr_rpf_core::{modlar, vs, ytd::{Ytd, joaat}};

// Gerçek mod dosyaları (testdata/*.rpf) telif ve boyut nedeniyle depoda değil; yoksa bu testler atlanır.
fn testdata() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../testdata")
}

fn ornek(ad: &str) -> Option<Vec<u8>> {
    std::fs::read(testdata().join(ad)).ok()
}

macro_rules! ornek_ya_da_atla {
    ($ad:expr) => {
        match ornek($ad) {
            Some(v) => v,
            None => {
                eprintln!("atlandı: testdata/{} yok", $ad);
                return;
            }
        }
    };
}

fn ornekler() -> Vec<(String, Arc<[u8]>)> {
    let mut v: Vec<_> = std::fs::read_dir(testdata())
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "rpf"))
        .map(|e| (e.file_name().to_string_lossy().into_owned(), Arc::from(std::fs::read(e.path()).unwrap())))
        .collect();
    v.sort_by(|a, b| a.0.cmp(&b.0));
    if v.is_empty() {
        eprintln!("atlandı: testdata/ içinde rpf yok");
    }
    v
}

fn dosyalar(a: &Arsiv) -> Vec<(String, Vec<u8>)> {
    let mut v = Vec::new();
    a.gez(|yol, d| {
        if let Dugum::Dosya(f) = d {
            v.push((yol.to_lowercase(), f.veri().unwrap().into_owned()));
        }
    });
    v.sort_by(|a, b| a.0.cmp(&b.0));
    v
}

#[test]
fn gidis_donus_icerigi_korur() {
    for (ad, bayt) in ornekler() {
        let a = Arsiv::oku(bayt.clone()).unwrap_or_else(|e| panic!("{ad}: {e}"));
        let yazilan = a.yaz().unwrap_or_else(|e| panic!("{ad}: {e}"));
        let b = Arsiv::oku(Arc::from(yazilan.clone())).unwrap_or_else(|e| panic!("{ad} yeniden: {e}"));
        assert_eq!(dosyalar(&a), dosyalar(&b), "{ad}");
        assert_eq!(b.yaz().unwrap(), yazilan, "{ad}: ikinci yazım aynı olmalı");
        println!("{ad}: {} -> {} bayt", bayt.len(), yazilan.len());
    }
}

#[test]
fn ytd_ve_visualsettings() {
    for (ad, bayt) in ornekler() {
        let a = Arsiv::oku(bayt).unwrap();
        let mut ytdler = Vec::new();
        let mut vsler = Vec::new();
        a.gez(|yol, d| {
            if let Dugum::Dosya(f) = d {
                if yol.ends_with(".ytd") {
                    ytdler.push((yol.to_string(), f.veri().unwrap().into_owned()));
                } else if yol.ends_with("visualsettings.dat") {
                    vsler.push(String::from_utf8_lossy(&f.veri().unwrap()).into_owned());
                }
            }
        });
        for m in vsler {
            let v = vs::Ayarlar::coz(&m);
            assert_eq!(v.metin(), m, "{ad}: visualsettings gidiş-dönüş");
            println!("{ad}: {} ayar, {} renk", v.girdiler().len(), v.renkler().len());
        }
        for (yol, veri) in ytdler {
            let mut y = Ytd::coz(&veri).unwrap_or_else(|e| panic!("{ad}/{yol}: {e}"));
            let mut cozulen = 0;
            for i in 0..y.dokular.len() {
                if y.rgba(i, 0).is_ok() {
                    cozulen += 1;
                }
            }
            println!(
                "{ad}/{yol}: {} doku, {} çözüldü: {:?}",
                y.dokular.len(),
                cozulen,
                y.dokular.iter().take(6).map(|d| format!("{} {}x{} {} m{}", d.ad, d.genislik, d.yukseklik, d.bicim.ad(), d.seviye)).collect::<Vec<_>>()
            );
            assert!(cozulen > 0);
            if let Some(i) = (0..y.dokular.len()).find(|&i| y.rgba(i, 0).is_ok()) {
                let kirmizi = [255u8, 0, 0, 255].repeat(64 * 32);
                y.degistir(i, kirmizi, 64, 32, Sigdirma::Esnet, &RenkAyari { doygunluk: 1.0, kontrast: 1.0, ..Default::default() }).unwrap();
                let yeni = Ytd::coz(&y.dosya()).unwrap();
                let (px, _, _) = yeni.rgba(i, 0).unwrap();
                assert!(px[0] > 200 && px[1] < 40, "{ad}: değiştirilen doku kırmızı olmalı: {:?}", &px[..4]);
            }
        }
    }
}

#[test]
fn mods_klasoru_taranir() {
    let r = modlar::tara(&testdata());
    for m in &r.modlar {
        println!(
            "{} {} {}/{} bayt, {} dosya, paket={:?}, eksik={}, hata={:?}",
            m.dosya, m.sifreleme, m.kullanilan, m.boyut, m.dosya_sayisi,
            m.paket.as_ref().map(|p| &p.ad), m.eksik_kaynak.len(), m.hata
        );
        assert!(m.hata.is_none(), "{}: {:?}", m.dosya, m.hata);
    }
    for c in &r.cakismalar {
        println!("ÇAKIŞMA {} <- {:?}", c.hedef, c.modlar);
    }
}

#[test]
fn doku_yeniden_adlandirma() {
    let bayt = ornek_ya_da_atla!("grafik-paketi.rpf");
    let a = Arsiv::oku(Arc::from(bayt)).unwrap();
    let veri = a.dosya("content/essa/graphics.ytd").unwrap().veri().unwrap().into_owned();
    let mut y = Ytd::coz(&veri).unwrap();
    let adlar: Vec<u32> = y.dokular.iter().map(|d| joaat(&d.ad)).collect();
    assert!(adlar.windows(2).all(|w| w[0] <= w[1]), "orijinal liste özete göre sıralı olmalı");

    let i = y.dokular.iter().position(|d| d.ad == "torch").unwrap();
    let (once, _, _) = y.rgba(i, 0).unwrap();
    y.yeniden_adlandir(i, "mesale").unwrap();
    let j = y.dokular.iter().position(|d| d.ad == "mesale").unwrap();
    y.yeniden_adlandir(j, "cok_uzun_bir_mesale_adi_fltr_rpf").unwrap();

    let yeni = Ytd::coz(&y.dosya()).unwrap();
    let k = yeni.dokular.iter().position(|d| d.ad == "cok_uzun_bir_mesale_adi_fltr_rpf").expect("yeni ad okunmalı");
    assert!(!yeni.dokular.iter().any(|d| d.ad == "torch" || d.ad == "mesale"));
    assert_eq!(yeni.rgba(k, 0).unwrap().0, once, "piksel verisi aynı dokuya bağlı kalmalı");
    let ozet: Vec<u32> = yeni.dokular.iter().map(|d| joaat(&d.ad)).collect();
    assert!(ozet.windows(2).all(|w| w[0] <= w[1]));
    assert_eq!(yeni.dokular.len(), 118);
}

#[test]
fn onalti_mb_ustu_kaynak_gidis_donus() {
    use fltr_rpf_core::rpf::Dosya;
    let n = 0x100_0000 + 12_345;
    let mut ytd = vec![0u8; n];
    ytd[..4].copy_from_slice(&0x3743_5352u32.to_le_bytes());
    ytd[4..8].copy_from_slice(&13u32.to_le_bytes());
    ytd[8..12].copy_from_slice(&0x0006_0000u32.to_le_bytes());
    ytd[12..16].copy_from_slice(&0xDD0E_0006u32.to_le_bytes());
    for (i, b) in ytd.iter_mut().enumerate().skip(16) {
        *b = (i * 31 % 251) as u8;
    }
    let mut a = Arsiv::yeni();
    a.koy("content", Dugum::Dosya(Dosya::yeni("buyuk+hi.ytd", ytd.clone()))).unwrap();
    let yazilan = a.yaz().unwrap();
    let b = Arsiv::oku(Arc::from(yazilan.clone())).unwrap();
    let f = b.dosya("content/buyuk+hi.ytd").unwrap();
    assert!(f.kaynak_mi());
    assert_eq!(f.veri().unwrap().as_ref(), &ytd[..], "başlık geri kurulmalı, içerik birebir");
    assert_eq!(b.yaz().unwrap(), yazilan, "yeniden yazım aynı olmalı");
}

#[test]
fn ytd_yeniden_kurma_ekle_sil_boyutlandir() {
    use fltr_rpf_core::ytd::{DokuIslemi, yeniden_kur};
    let bayt = ornek_ya_da_atla!("grafik-paketi.rpf");
    let a = Arsiv::oku(Arc::from(bayt)).unwrap();
    let veri = a.dosya("content/essa/graphics.ytd").unwrap().veri().unwrap().into_owned();
    let once = Ytd::coz(&veri).unwrap();

    // hiçbir işlem yokken bütün dokuların pikselleri aynı kalmalı
    let ayni = Ytd::coz(&yeniden_kur(&veri, vec![]).unwrap()).unwrap();
    assert_eq!(ayni.dokular.len(), once.dokular.len());
    for d in &once.dokular {
        let j = ayni.dokular.iter().position(|x| x.ad == d.ad).unwrap();
        let i = once.dokular.iter().position(|x| x.ad == d.ad).unwrap();
        if once.rgba(i, 0).is_ok() {
            assert_eq!(once.rgba(i, 0).unwrap().0, ayni.rgba(j, 0).unwrap().0, "{}", d.ad);
        }
    }

    let kirmizi = [255u8, 0, 0, 255].repeat(300 * 200);
    let yeni = yeniden_kur(
        &veri,
        vec![
            DokuIslemi::Sil("torch".into()),
            DokuIslemi::Koy { ad: "fltr_logo".into(), rgba: kirmizi.clone(), w: 300, h: 200, bicim: None },
            DokuIslemi::Koy { ad: "cloudnoise".into(), rgba: kirmizi, w: 300, h: 200, bicim: None },
        ],
    )
    .unwrap();
    let y = Ytd::coz(&yeni).unwrap();
    assert_eq!(y.dokular.len(), once.dokular.len());
    assert!(!y.dokular.iter().any(|d| d.ad == "torch"));
    let logo = y.dokular.iter().position(|d| d.ad == "fltr_logo").unwrap();
    let (px, w, h) = y.rgba(logo, 0).unwrap();
    assert_eq!((w, h), (300, 200));
    assert!(px[0] > 240 && px[1] < 16);
    let bulut = y.dokular.iter().find(|d| d.ad == "cloudnoise").unwrap();
    assert_eq!((bulut.genislik, bulut.yukseklik, bulut.bicim.ad()), (300, 200, "DXT1".to_string()), "biçim korunmalı");
}

#[test]
fn meta_xml_gidis_donus() {
    use fltr_rpf_core::model::{meta_geri_yaz, meta_xml};
    let mut sayi = 0;
    for (ad, bayt) in ornekler() {
        let a = Arsiv::oku(bayt).unwrap();
        let mut dosyalar = Vec::new();
        a.gez(|y, d| {
            if let Dugum::Dosya(f) = d
                && [".ymt", ".ymap", ".ytyp"].iter().any(|u| y.ends_with(u))
            {
                dosyalar.push((y.to_string(), f.veri().unwrap().into_owned()));
            }
        });
        for (yol, v) in dosyalar.into_iter().take(4) {
            let Ok(xml) = meta_xml(&v) else { continue };
            let (yazilan, uyarilar) = meta_geri_yaz(&v, &xml).unwrap_or_else(|e| panic!("{ad}/{yol}: {e}"));
            let tekrar = meta_xml(&yazilan).unwrap_or_else(|e| panic!("{ad}/{yol} yeniden okunamadı: {e}"));
            assert_eq!(tekrar, xml, "{ad}/{yol}: XML gidiş-dönüşte değişmemeli ({} uyarı)", uyarilar.len());
            sayi += 1;
        }
    }
    println!("{sayi} meta dosyası gidiş-dönüş");
    assert!(sayi > 0 || ornekler().is_empty());
}

#[test]
fn yerinde_degistirme_komsu_dokulara_tasmaz() {
    let bayt = ornek_ya_da_atla!("grafik-paketi.rpf");
    let a = Arsiv::oku(Arc::from(bayt)).unwrap();
    let veri = a.dosya("content/essa/graphics.ytd").unwrap().veri().unwrap().into_owned();
    let mut y = Ytd::coz(&veri).unwrap();
    // 1x1'e kadar inen mip zinciri olan dokular, oyunun kısa sakladığı seviyeleri içerir
    let hedefler: Vec<usize> = (0..y.dokular.len()).filter(|&i| y.dokular[i].seviye >= 9 && y.rgba(i, 0).is_ok()).collect();
    assert!(!hedefler.is_empty());
    let once: Vec<_> = (0..y.dokular.len()).map(|i| y.rgba(i, 0).ok().map(|x| x.0)).collect();
    for &i in &hedefler {
        let (w, h) = (y.dokular[i].genislik, y.dokular[i].yukseklik);
        y.degistir(i, [0u8, 255, 0, 255].repeat(w * h), w, h, Sigdirma::Esnet, &RenkAyari::notr()).unwrap();
    }
    let sonra = Ytd::coz(&y.dosya()).unwrap();
    for (i, onceki) in once.iter().enumerate().filter(|(i, _)| !hedefler.contains(i)) {
        assert_eq!(&sonra.rgba(i, 0).ok().map(|x| x.0), onceki, "{} bozuldu", sonra.dokular[i].ad);
    }
}

#[test]
fn model_icindeki_dokular_yerinde_duzenlenir() {
    let bayt = ornek_ya_da_atla!("model-paketi.rpf");
    let a = Arsiv::oku(Arc::from(bayt)).unwrap();
    let mut modeller = Vec::new();
    for (yol, veri) in dosyalar(&a).into_iter().filter(|(y, _)| y.ends_with(".ydr")) {
        let y = Ytd::modelden(&veri, "ydr").unwrap();
        if (0..y.dokular.len()).any(|i| y.rgba(i, 0).is_ok()) {
            modeller.push((yol, veri, y));
        }
    }
    eprintln!("gömülü dokulu model: {}", modeller.len());
    assert!(!modeller.is_empty(), "model paketinde gömülü dokulu ydr bulunmalı");

    for (yol, veri, mut y) in modeller.into_iter().take(6) {
        let once: Vec<_> = (0..y.dokular.len()).map(|i| y.rgba(i, 0).ok().map(|x| x.0)).collect();
        let i = (0..y.dokular.len()).find(|&i| once[i].is_some()).unwrap();
        let (w, h) = (y.dokular[i].genislik, y.dokular[i].yukseklik);
        y.degistir(i, [255u8, 0, 0, 255].repeat(w * h), w, h, Sigdirma::Esnet, &RenkAyari::notr()).unwrap();
        let yeni = y.dosya();
        let sonra = Ytd::modelden(&yeni, "ydr").unwrap();
        let (kirmizi, _, _) = sonra.rgba(i, 0).unwrap();
        assert!(kirmizi.as_chunks::<4>().0.iter().all(|p| p[0] > 200 && p[1] < 40 && p[2] < 40), "{yol}: doku değişmedi");
        for (j, onceki) in once.iter().enumerate().filter(|&(j, _)| j != i) {
            assert_eq!(&sonra.rgba(j, 0).ok().map(|x| x.0), onceki, "{yol}: {} bozuldu", sonra.dokular[j].ad);
        }
        // başka bir okuyucu (rage-formats) da yeni dokuyu aynı görmeli, geometri değişmemeli
        let cizimler = rage_formats::ydd::parse_drawables(&yeni, rage_formats::ydd::DrawableKind::Ydr)
            .or_else(|_| rage_formats::ydd::parse_drawables(&yeni, rage_formats::ydd::DrawableKind::Ydd))
            .unwrap();
        let t = cizimler
            .iter()
            .flat_map(|c| c.drawable.shader_group.iter().flat_map(|s| &s.textures))
            .find(|t| t.name.eq_ignore_ascii_case(&sonra.dokular[i].ad))
            .unwrap();
        let rgba = rage_formats::decompress_texture(t).unwrap();
        assert!(rgba.as_chunks::<4>().0.iter().all(|p| p[0] > 200 && p[1] < 40 && p[2] < 40), "{yol}: rage-formats eski dokuyu görüyor");
        assert_eq!(fltr_rpf_core::model::model_oku(&veri, "ydr").unwrap(), fltr_rpf_core::model::model_oku(&yeni, "ydr").unwrap(), "{yol}: geometri değişmemeli");
    }
}

#[test]
fn parcacik_sozlugu_dokulari_yerinde_duzenlenir() {
    let bayt = ornek_ya_da_atla!("efekt-paketi.rpf");
    let a = Arsiv::oku(Arc::from(bayt)).unwrap();
    let (yol, veri) = dosyalar(&a).into_iter().find(|(y, _)| y.ends_with(".ypt")).expect("efekt paketinde ypt olmalı");
    let mut y = Ytd::modelden(&veri, "ypt").unwrap();
    eprintln!("{yol}: {} doku", y.dokular.len());
    assert!(y.dokular.len() > 10);
    let i = (0..y.dokular.len()).find(|&i| y.rgba(i, 0).is_ok()).unwrap();
    let komsu = (0..y.dokular.len()).filter(|&j| j != i).find(|&j| y.rgba(j, 0).is_ok()).unwrap();
    let komsu_once = y.rgba(komsu, 0).unwrap().0;
    let (w, h) = (y.dokular[i].genislik, y.dokular[i].yukseklik);
    y.degistir(i, [0u8, 0, 255, 255].repeat(w * h), w, h, Sigdirma::Esnet, &RenkAyari::notr()).unwrap();
    let sonra = Ytd::modelden(&y.dosya(), "ypt").unwrap();
    assert_eq!(sonra.dokular.len(), y.dokular.len());
    assert!(sonra.rgba(i, 0).unwrap().0.as_chunks::<4>().0.iter().all(|p| p[2] > 200 && p[0] < 40));
    assert_eq!(sonra.rgba(komsu, 0).unwrap().0, komsu_once);
}

/// Oyunun sayfa haritasındaki adetler RSC başlığındaki sayfa bayraklarıyla tutmalı.
fn sayfa_haritasi_tutarli(dosya: &[u8]) -> bool {
    let k = fltr_rpf_core::rsc::Kaynak::coz(dosya).unwrap();
    let p = u64::from_le_bytes(k.veri[8..16].try_into().unwrap());
    let h = k.ofs(p).unwrap();
    k.veri[h + 8] as u32 == fltr_rpf_core::rsc::sayfa_adedi(k.sistem) && k.veri[h + 9] as u32 == fltr_rpf_core::rsc::sayfa_adedi(k.grafik)
}

#[test]
fn gomulu_doku_buyutulur() {
    let model_paketi = Arsiv::oku(Arc::from(ornek_ya_da_atla!("model-paketi.rpf"))).unwrap();
    let efekt_paketi = Arsiv::oku(Arc::from(ornek_ya_da_atla!("efekt-paketi.rpf"))).unwrap();
    let ornekler = [
        (dosyalar(&model_paketi).into_iter().find(|(y, _)| y.ends_with("metro_subway1shell.ydr")).unwrap(), "ydr", "gri"),
        (dosyalar(&efekt_paketi).into_iter().find(|(y, _)| y.ends_with(".ypt")).unwrap(), "ypt", "ptfx_flare"),
    ];
    for ((yol, veri), uz, ad) in ornekler {
        assert!(sayfa_haritasi_tutarli(&veri), "{yol}: kaynak baştan tutarsız");
        let mut y = Ytd::modelden(&veri, uz).unwrap();
        let i = y.dokular.iter().position(|d| d.ad.eq_ignore_ascii_case(ad)).unwrap();
        let komsular: Vec<_> = (0..y.dokular.len()).filter(|&j| j != i).map(|j| y.rgba(j, 0).ok().map(|x| x.0)).collect();
        y.boyutlandir(i, [0u8, 200, 255, 255].repeat(256 * 128), 256, 128).unwrap();
        let yeni = y.dosya();
        assert!(sayfa_haritasi_tutarli(&yeni), "{yol}: sayfa haritası bozuldu");
        let s = Ytd::modelden(&yeni, uz).unwrap();
        assert_eq!((s.dokular[i].genislik, s.dokular[i].yukseklik), (256, 128));
        let (rgba, w, h) = s.rgba(i, 0).unwrap();
        assert_eq!((w, h), (256, 128));
        assert!(rgba.as_chunks::<4>().0.iter().all(|p| p[0] < 30 && p[1] > 170 && p[2] > 220), "{yol}: yeni doku okunmadı");
        let (_, w3, h3) = s.rgba(i, 3).unwrap();
        assert_eq!((w3, h3), (32, 16), "mip zinciri");
        let sonra: Vec<_> = (0..s.dokular.len()).filter(|&j| j != i).map(|j| s.rgba(j, 0).ok().map(|x| x.0)).collect();
        assert_eq!(sonra, komsular, "{yol}: diğer dokular bozuldu");
        if uz == "ydr" {
            let c = rage_formats::ydd::parse_drawables(&yeni, rage_formats::ydd::DrawableKind::Ydr).unwrap();
            let t = c.iter().flat_map(|c| c.drawable.shader_group.iter().flat_map(|s| &s.textures)).find(|t| t.name.eq_ignore_ascii_case(ad)).unwrap();
            assert_eq!((t.width, t.height), (256, 128));
            assert!(rage_formats::decompress_texture(t).unwrap().as_chunks::<4>().0.iter().all(|p| p[2] > 220));
            assert_eq!(fltr_rpf_core::model::ucgen_sayisi(&yeni, "ydr").unwrap(), fltr_rpf_core::model::ucgen_sayisi(&veri, "ydr").unwrap());
        }
    }
}

#[test]
fn parcacik_ayarlari_okunur_ve_yazilir() {
    let a = Arsiv::oku(Arc::from(ornek_ya_da_atla!("efekt-paketi.rpf"))).unwrap();
    let (_, veri) = dosyalar(&a).into_iter().find(|(y, _)| y.ends_with(".ypt")).unwrap();
    let mut k = fltr_rpf_core::rsc::Kaynak::coz(&veri).unwrap();
    let g = fltr_rpf_core::ypt::oku(&k).unwrap();
    let say = |t: &str| g.iter().filter(|x| x.tur == t).count();
    let renk: Vec<_> = g.iter().filter(|x| x.davranis == Some("Colour")).collect();
    let bilinmeyen = g.iter().flat_map(|x| &x.ozellikler).filter(|o| o.ad.starts_with("hash_")).count();
    eprintln!("efekt {} yayıcı {} parçacık {} · renk davranışı {} · adı bilinmeyen özellik {bilinmeyen}", say("efekt"), say("yayici"), say("parcacik"), renk.len());
    assert!(say("efekt") > 100 && say("parcacik") > 100 && renk.len() > 50);
    let kare = &renk[0].ozellikler[0].kareler[0];
    eprintln!("{} {} {:?} {:?}", renk[0].ad, renk[0].ozellikler[0].ad, kare.zaman, kare.deger);
    assert!(kare.zaman[0] >= 0.0 && kare.zaman[0] <= 1.0);
    fltr_rpf_core::ypt::yaz(&mut k, &[(kare.ofs, [0.0, 1.0, 0.0, 1.0])]).unwrap();
    let g2 = fltr_rpf_core::ypt::oku(&fltr_rpf_core::rsc::Kaynak::coz(&k.paketle()).unwrap()).unwrap();
    let r2 = g2.iter().find(|x| x.ad == renk[0].ad && x.davranis == Some("Colour")).unwrap();
    assert_eq!(r2.ozellikler[0].kareler[0].deger, [0.0, 1.0, 0.0, 1.0]);
    assert!(fltr_rpf_core::ypt::yaz(&mut k, &[(12, [0.0; 4])]).is_err(), "rastgele ofset reddedilmeli");
}

#[test]
fn gfx_gorselleri_okunur_ve_degistirilir() {
    let a = Arsiv::oku(Arc::from(ornek_ya_da_atla!("minimap.rpf"))).unwrap();
    let (_, veri) = dosyalar(&a).into_iter().find(|(y, _)| y.ends_with(".gfx")).unwrap();
    let mut g = fltr_rpf_core::gfx::Gfx::coz(&veri).unwrap();
    assert_eq!(g.dosya(), veri, "dokunulmadan yazınca birebir aynı olmalı");
    let gorseller = g.gorseller();
    eprintln!("{} görsel, dış: {:?}", gorseller.len(), g.dis_gorseller());
    assert_eq!(gorseller.len(), 4);
    let b = gorseller.iter().max_by_key(|x| x.genislik * x.yukseklik).unwrap();
    let (once, w, h) = g.gorsel_rgba(b.karakter).unwrap();
    assert_eq!((w, h), (b.genislik, b.yukseklik));
    assert!(once.as_chunks::<4>().0.iter().any(|p| p[3] > 0));
    let digerleri: Vec<_> = gorseller.iter().filter(|x| x.karakter != b.karakter).map(|x| g.gorsel_rgba(x.karakter).unwrap().0).collect();
    g.gorsel_degistir(b.karakter, [255u8, 0, 0, 128].repeat(64), 8, 8, fltr_rpf_core::doku::Sigdirma::Esnet).unwrap();
    let g2 = fltr_rpf_core::gfx::Gfx::coz(&g.dosya()).unwrap();
    let (sonra, w2, h2) = g2.gorsel_rgba(b.karakter).unwrap();
    assert_eq!((w2, h2), (w, h));
    assert!(sonra.as_chunks::<4>().0.iter().all(|p| p[0] > 245 && p[1] < 10 && p[3] == 128));
    let digerleri2: Vec<_> = gorseller.iter().filter(|x| x.karakter != b.karakter).map(|x| g2.gorsel_rgba(x.karakter).unwrap().0).collect();
    assert_eq!(digerleri, digerleri2);
    assert_eq!(g2.dis_gorseller(), g.dis_gorseller());
}

#[test]
fn cakismalar_karsilastirilir() {
    let klasor = testdata();
    let r = modlar::tara(&klasor);
    for c in &r.cakismalar {
        let a = modlar::cakisma_incele(&klasor, &c.hedef, &c.modlar);
        eprintln!(
            "{} · {} · aynı: {} · ayar farkı {} · doku farkı {:?} · satır farkı {} {:?} · {:?}",
            c.hedef,
            c.modlar.join(" + "),
            a.hepsi_ayni,
            a.ayar_farki_sayisi,
            a.doku_farklari,
            a.satir_farki_sayisi,
            a.satir_farklari.iter().take(4).map(|f| (&f.satir, &f.var)).collect::<Vec<_>>(),
            a.ayar_farklari.first().map(|f| (&f.anahtar, &f.degerler))
        );
        assert!(a.kaynaklar.iter().all(|k| k.hata.is_none()), "{:?}", a.kaynaklar.iter().map(|k| &k.hata).collect::<Vec<_>>());
    }
}
