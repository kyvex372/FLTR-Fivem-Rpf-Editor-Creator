//! Parçacık sözlüğü (ypt, ptxFxList) içindeki efekt, yayıcı ve parçacık kurallarının anahtar kareli ayarları.
//! Yalnız var olan değerler yerinde değiştirilir; yapı ve boyut değişmez.
//! Düzen CodeWalker'ın (MIT) Particle.cs tanımlarından; dosyada doğrulanan: kök 0x38 parçacık, 0x48 efekt, 0x50 yayıcı kuralı sözlüğü.

use serde::Serialize;

use crate::rsc::Kaynak;
use crate::{Hata, Sonuc, u16_oku, u32_oku, u64_oku};

/// ptxKeyframeProp ad özetleri (CodeWalker, zirconium).
const OZELLIK_ADLARI: &[(u32, &str)] = &[
    (0x68f00338, "ptxAttractorDomain:m_positionKFP"),
    (0x8ace32c2, "ptxAttractorDomain:m_rotationKFP"),
    (0x851d3d14, "ptxAttractorDomain:m_sizeInnerKFP"),
    (0xc248b5c9, "ptxAttractorDomain:m_sizeOuterKFP"),
    (0x45e377e9, "ptxCreationDomain:m_positionKFP"),
    (0x5e692d43, "ptxCreationDomain:m_rotationKFP"),
    (0x841ab3da, "ptxCreationDomain:m_sizeInnerKFP"),
    (0x1104051e, "ptxCreationDomain:m_sizeOuterKFP"),
    (0xd7c1e22b, "ptxEffectRule:m_colourTintMaxKFP"),
    (0xe5480b3b, "ptxEffectRule:m_colourTintMinKFP"),
    (0xff864d6c, "ptxEffectRule:m_dataCapsuleKFP"),
    (0x34d6ded7, "ptxEffectRule:m_dataSphereKFP"),
    (0xce8e57a7, "ptxEffectRule:m_zoomScalarKFP"),
    (0xa83b53f0, "ptxEmitterRule:m_accnScalarKFP"),
    (0xdd18b4f2, "ptxEmitterRule:m_dampeningScalarKFP"),
    (0xd2df1fa0, "ptxEmitterRule:m_inheritVelocityKFP"),
    (0xe511bc23, "ptxEmitterRule:m_matrixWeightScalarKFP"),
    (0x9fc4652b, "ptxEmitterRule:m_particleLifeKFP"),
    (0x60855078, "ptxEmitterRule:m_playbackRateScalarKFP"),
    (0x4af0ffa1, "ptxEmitterRule:m_sizeScalarKFP"),
    (0xe00e5025, "ptxEmitterRule:m_spawnRateOverDistKFP"),
    (0x61c50318, "ptxEmitterRule:m_spawnRateOverTimeKFP"),
    (0xc9fe6abb, "ptxEmitterRule:m_speedScalarKFP"),
    (0x41d49131, "ptxTargetDomain:m_positionKFP"),
    (0x64c6c696, "ptxTargetDomain:m_rotationKFP"),
    (0xe7d61ff7, "ptxTargetDomain:m_sizeInnerKFP"),
    (0x13c0cac4, "ptxTargetDomain:m_sizeOuterKFP"),
    (0x72668c6f, "ptxd_Trail:m_texInfoKFP"),
    (0xd1be590a, "ptxu_Acceleration:m_strengthKFP"),
    (0x412a554c, "ptxu_Acceleration:m_xyzMaxKFP"),
    (0x30e327d4, "ptxu_Acceleration:m_xyzMinKFP"),
    (0x2946e76f, "ptxu_AnimateTexture:m_animRateKFP"),
    (0x686f965f, "ptxu_Collision:m_bounceDirVarKFP"),
    (0x61532d47, "ptxu_Collision:m_bouncinessKFP"),
    (0x8306b23a, "ptxu_Colour:m_emissiveIntensityKFP"),
    (0x60500691, "ptxu_Colour:m_rgbaMaxKFP"),
    (0x7fae9df8, "ptxu_Colour:m_rgbaMinKFP"),
    (0x64c7fc25, "ptxu_Dampening:m_xyzMaxKFP"),
    (0xd0ef73c5, "ptxu_Dampening:m_xyzMinKFP"),
    (0xa7228870, "ptxu_Decal:m_alphaKFP"),
    (0xfb8eb4e6, "ptxu_Decal:m_dimensionsKFP"),
    (0x3ee8e85e, "ptxu_FogVolume:m_densityRangeKFP"),
    (0x23f55175, "ptxu_FogVolume:m_rgbTintMaxKFP"),
    (0x3c599207, "ptxu_FogVolume:m_rgbTintMinKFP"),
    (0x570dc9cd, "ptxu_FogVolume:m_rotationMaxKFP"),
    (0x9ef3ceec, "ptxu_FogVolume:m_rotationMinKFP"),
    (0x5473d2fe, "ptxu_FogVolume:m_scaleMaxKFP"),
    (0xdafe6982, "ptxu_FogVolume:m_scaleMinKFP"),
    (0xb9410926, "ptxu_Light:m_coronaFlareKFP"),
    (0xe2c464a6, "ptxu_Light:m_coronaIntensityKFP"),
    (0xf8561886, "ptxu_Light:m_coronaRgbMaxKFP"),
    (0xe364d5b2, "ptxu_Light:m_coronaRgbMinKFP"),
    (0xc35aaf9b, "ptxu_Light:m_coronaSizeKFP"),
    (0xef500a62, "ptxu_Light:m_intensityKFP"),
    (0x75990186, "ptxu_Light:m_rangeKFP"),
    (0x12bbe65e, "ptxu_Light:m_rgbMaxKFP"),
    (0xda8c99a6, "ptxu_Light:m_rgbMinKFP"),
    (0xe7af1a2c, "ptxu_MatrixWeight:m_mtxWeightKFP"),
    (0xff31aaf3, "ptxu_Noise:m_posNoiseMaxKFP"),
    (0x2d0d70b5, "ptxu_Noise:m_posNoiseMinKFP"),
    (0x513812a5, "ptxu_Noise:m_velNoiseMaxKFP"),
    (0xf256e579, "ptxu_Noise:m_velNoiseMinKFP"),
    (0x687b4382, "ptxu_Rotation:m_angleMaxKFP"),
    (0xf0274f77, "ptxu_Rotation:m_angleMinKFP"),
    (0x351ed852, "ptxu_Rotation:m_initialAngleMaxKFP"),
    (0x1c256ba4, "ptxu_Rotation:m_initialAngleMinKFP"),
    (0xa67a1155, "ptxu_Size:m_tblrScalarKFP"),
    (0xd5c0fce5, "ptxu_Size:m_tblrVelScalarKFP"),
    (0x3dc78098, "ptxu_Size:m_whdMaxKFP"),
    (0x1f641348, "ptxu_Size:m_whdMinKFP"),
    (0x0aadcbef, "ptxu_Wind:m_influenceKFP"),
    (0xea6afaba, "ptxu_ZCull:m_fadeDistKFP"),
    (0xce9adbfd, "ptxu_ZCull:m_heightKFP"),
];

const DAVRANIS_TURLERI: &[(u32, &str)] = &[
    (0xf5b33baa, "Age"),
    (0xd63d9f1b, "Acceleration"),
    (0x6c0719bc, "Velocity"),
    (0x1ee64552, "Rotation"),
    (0x38b60240, "Size"),
    (0x052b1293, "Dampening"),
    (0x64e5d702, "MatrixWeight"),
    (0x928a1c45, "Collision"),
    (0xeca84c1e, "AnimateTexture"),
    (0x164aea72, "Colour"),
    (0x68fa73f5, "Sprite"),
    (0x38b63978, "Wind"),
    (0x0544c710, "Light"),
    (0x6232e25a, "Model"),
    (0x8f3b6036, "Decal"),
    (0xa35c721f, "ZCull"),
    (0xb77fed19, "Noise"),
    (0x25ac9437, "Attractor"),
    (0xc57377f8, "Trail"),
    (0xa05da63e, "FogVolume"),
    (0xd4594bef, "River"),
    (0xa2d6dc3f, "DecalPool"),
    (0xdf229542, "Liquid"),
];

#[derive(Serialize, Clone)]
pub struct Kare {
    /// x: 0..1 arası ömür/zaman
    pub zaman: [f32; 4],
    pub deger: [f32; 4],
    /// değerin kaynaktaki düz ofseti (yazarken kimlik)
    pub ofs: usize,
}

#[derive(Serialize, Clone)]
pub struct Ozellik {
    pub ad: String,
    pub kareler: Vec<Kare>,
}

#[derive(Serialize, Clone)]
pub struct Grup {
    /// "efekt", "yayici" ya da "parcacik"
    pub tur: &'static str,
    pub ad: String,
    /// parçacık kurallarında davranış türü (Colour, Size, Light…)
    pub davranis: Option<&'static str>,
    pub ozellikler: Vec<Ozellik>,
}

fn dizgi(k: &Kaynak, p: u64) -> String {
    let Some(o) = k.ofs(p) else { return String::new() };
    let son = k.veri[o..].iter().take(128).position(|&b| b == 0).unwrap_or(0);
    String::from_utf8_lossy(&k.veri[o..o + son]).into_owned()
}

/// `o`daki işaretçi listesinin (u64 işaretçi, u16 adet) gösterdiği düz ofsetler.
fn isaretciler(k: &Kaynak, o: usize, sinir: usize) -> Vec<usize> {
    let v = &k.veri;
    let (Some(l), Some(n)) = (u64_oku(v, o).and_then(|p| k.ofs(p)), u16_oku(v, o + 8)) else { return Vec::new() };
    (0..(n as usize).min(sinir)).filter_map(|i| u64_oku(v, l + i * 8).and_then(|p| k.ofs(p))).collect()
}

fn ozellik_oku(k: &Kaynak, o: usize) -> Option<Ozellik> {
    let v = &k.veri;
    let ozet = u32_oku(v, o + 0x68)?;
    let ad = OZELLIK_ADLARI.iter().find(|x| x.0 == ozet).map_or_else(|| format!("hash_{ozet:08x}"), |x| x.1.to_string());
    let l = k.ofs(u64_oku(v, o + 0x70)?);
    let n = u16_oku(v, o + 0x78)? as usize;
    if n > 256 {
        return None;
    }
    let f = |x: usize| f32::from_le_bytes(v[x..x + 4].try_into().unwrap());
    let kareler = match l {
        Some(l) if l + n * 0x20 <= v.len() => (0..n)
            .map(|i| {
                let b = l + i * 0x20;
                Kare { zaman: std::array::from_fn(|j| f(b + j * 4)), deger: std::array::from_fn(|j| f(b + 16 + j * 4)), ofs: b + 16 }
            })
            .collect(),
        _ => Vec::new(),
    };
    Some(Ozellik { ad, kareler })
}

/// pgDictionary'nin (0x30 değerler, 0x38 adet) değer işaretçileri.
fn sozluk(k: &Kaynak, kok_ofs: usize) -> Vec<usize> {
    u64_oku(&k.veri, kok_ofs).and_then(|p| k.ofs(p)).map(|s| isaretciler(k, s + 0x30, 8192)).unwrap_or_default()
}

pub fn oku(k: &Kaynak) -> Sonuc<Vec<Grup>> {
    let ad = dizgi(k, u64_oku(&k.veri, 0x10).unwrap_or(0));
    if ad.is_empty() {
        return Err(Hata::Gecersiz("parçacık sözlüğü (ypt) değil".into()));
    }
    let mut gruplar = Vec::new();
    let ozellikler = |liste: Vec<usize>| liste.into_iter().filter_map(|o| ozellik_oku(k, o)).filter(|x| !x.kareler.is_empty()).collect::<Vec<_>>();
    // efekt kuralında 5, yayıcı kuralında 10 anahtar kare özelliği yapının içinde gömülüdür
    let gomulu = |bas: usize, n: usize| (0..n).map(|i| bas + i * 0x90).collect::<Vec<_>>();
    for e in sozluk(k, 0x48) {
        let ozellikler = ozellikler(gomulu(e + 0xC0, 5));
        if !ozellikler.is_empty() {
            gruplar.push(Grup { tur: "efekt", ad: dizgi(k, u64_oku(&k.veri, e + 0x20).unwrap_or(0)), davranis: None, ozellikler });
        }
    }
    for e in sozluk(k, 0x50) {
        let ozellikler = ozellikler(gomulu(e + 0x78, 10));
        if !ozellikler.is_empty() {
            gruplar.push(Grup { tur: "yayici", ad: dizgi(k, u64_oku(&k.veri, e + 0x20).unwrap_or(0)), davranis: None, ozellikler });
        }
    }
    for p in sozluk(k, 0x38) {
        let kural = dizgi(k, u64_oku(&k.veri, p + 0x120).unwrap_or(0));
        for b in isaretciler(k, p + 0x128, 64) {
            let tur = u32_oku(&k.veri, b + 0x08).unwrap_or(0);
            let davranis = DAVRANIS_TURLERI.iter().find(|x| x.0 == tur).map(|x| x.1);
            let ozellikler = ozellikler(isaretciler(k, b + 0x10, 64));
            if !ozellikler.is_empty() {
                gruplar.push(Grup { tur: "parcacik", ad: kural.clone(), davranis, ozellikler });
            }
        }
    }
    Ok(gruplar)
}

/// Anahtar kare değerlerini yazar; yalnız `oku`nun döndürdüğü ofsetler kabul edilir.
pub fn yaz(k: &mut Kaynak, degisiklikler: &[(usize, [f32; 4])]) -> Sonuc<usize> {
    let gecerli: std::collections::HashSet<usize> = oku(k)?.iter().flat_map(|g| &g.ozellikler).flat_map(|o| &o.kareler).map(|x| x.ofs).collect();
    for (ofs, deger) in degisiklikler {
        if !gecerli.contains(ofs) {
            return Err(Hata::Gecersiz(format!("{ofs:#x} bir anahtar kare değeri değil")));
        }
        if deger.iter().any(|x| !x.is_finite()) {
            return Err(Hata::Gecersiz("geçersiz sayı".into()));
        }
        for (j, x) in deger.iter().enumerate() {
            k.veri[ofs + j * 4..ofs + j * 4 + 4].copy_from_slice(&x.to_le_bytes());
        }
    }
    Ok(degisiklikler.len())
}
