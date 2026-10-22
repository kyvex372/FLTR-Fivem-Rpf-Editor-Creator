//! 3B görüntüleme için RAGE modellerini (ydr/ydd/yft) düz mesh paketine, ymap'i yerleşim listesine çevirir.
//! Ayrıştırma rage-formats (Unlicense) ile yapılır.
//!
//! Paket: "TLKM" | u32 json_uzunluğu | json | 4'e hizalı dolgu | veri.
//! json'daki [ofs, adet] çiftleri veri bölümüne bakar (f32 ya da u32 dizileri).

use rage_formats::ydd::{DrawableEntry, DrawableKind, parse_drawables};
use rage_formats::{NameTable, Schema, build_meta, build_pso, dump_meta, dump_pso, from_xml, is_pso, parse_ymap_entities, to_xml};
use serde::Serialize;

use crate::{Hata, Sonuc};

fn tur(uzanti: &str) -> Option<DrawableKind> {
    match uzanti {
        "ydr" => Some(DrawableKind::Ydr),
        "ydd" => Some(DrawableKind::Ydd),
        "yft" => Some(DrawableKind::Yft),
        _ => None,
    }
}

fn cizilebilirler(veri: &[u8], uzanti: &str) -> Sonuc<Vec<DrawableEntry>> {
    let k = tur(uzanti).ok_or_else(|| Hata::Gecersiz(format!(".{uzanti} bir model değil")))?;
    let hata = |e| Hata::Bozuk(format!("model okunamadı: {e}"));
    match k {
        DrawableKind::Ydr => parse_drawables(veri, DrawableKind::Ydr).or_else(|_| parse_drawables(veri, DrawableKind::Ydd)).map_err(hata),
        k => parse_drawables(veri, k).map_err(hata),
    }
}

#[derive(Serialize)]
struct Parca {
    doku: Option<String>,
    /// dokusuz parçaların düz rengi (çarpışma malzemeleri), 0..1
    #[serde(skip_serializing_if = "Option::is_none")]
    renk: Option<[f32; 3]>,
    konum: [usize; 2],
    normal: [usize; 2],
    uv: [usize; 2],
    indeks: [usize; 2],
}

#[derive(Serialize)]
struct CizimBilgisi {
    ad: String,
    min: [f32; 3],
    max: [f32; 3],
    parcalar: Vec<Parca>,
    ucgen: usize,
}

#[derive(Serialize)]
struct ModelBilgisi {
    cizimler: Vec<CizimBilgisi>,
    gomulu_dokular: Vec<String>,
}

struct Yazici(Vec<u8>);

impl Yazici {
    fn f32ler(&mut self, v: &[f32]) -> [usize; 2] {
        let ofs = self.0.len();
        for x in v {
            self.0.extend_from_slice(&x.to_le_bytes());
        }
        [ofs, v.len()]
    }

    fn u32ler(&mut self, v: &[u32]) -> [usize; 2] {
        let ofs = self.0.len();
        for x in v {
            self.0.extend_from_slice(&x.to_le_bytes());
        }
        [ofs, v.len()]
    }
}

pub fn model_oku(veri: &[u8], uzanti: &str) -> Sonuc<Vec<u8>> {
    let girdiler = cizilebilirler(veri, uzanti)?;
    let mut y = Yazici(Vec::new());
    let mut cizimler = Vec::new();
    let mut gomulu = Vec::new();

    for g in &girdiler {
        let d = &g.drawable;
        if let Some(sg) = &d.shader_group {
            gomulu.extend(sg.textures.iter().map(|t| t.name.to_lowercase()));
        }
        let Some(lod) = d.best_lod() else { continue };
        let (sinir, _) = d.bounds_or_computed(lod);
        let mut parcalar = Vec::new();
        let mut ucgen = 0;
        for model in &lod.models {
            for geo in &model.geometries {
                let (Some(vb), Some(ib)) = (&geo.vertex_buffer, &geo.index_buffer) else { continue };
                let Ok(koseler) = vb.to_unified_vertices() else { continue };
                if koseler.is_empty() || ib.indices.is_empty() {
                    continue;
                }
                let n = koseler.len() as u32;
                let indeks: Vec<u32> = ib.indices.iter().copied().filter(|&i| i < n).collect();
                if indeks.len() != ib.indices.len() {
                    continue;
                }
                let konum: Vec<f32> = koseler.iter().flat_map(|k| [k.position.x, k.position.y, k.position.z]).collect();
                let normal: Vec<f32> = koseler.iter().flat_map(|k| [k.normal.x, k.normal.y, k.normal.z]).collect();
                let uv: Vec<f32> = koseler.iter().flat_map(|k| [k.texcoord0.x, k.texcoord0.y]).collect();
                ucgen += indeks.len() / 3;
                parcalar.push(Parca {
                    doku: d.diffuse_texture_name(geo.shader_id).map(str::to_lowercase),
                    renk: None,
                    konum: y.f32ler(&konum),
                    normal: y.f32ler(&normal),
                    uv: y.f32ler(&uv),
                    indeks: y.u32ler(&indeks),
                });
            }
        }
        cizimler.push(CizimBilgisi {
            ad: if g.name.is_empty() { d.name.clone() } else { g.name.clone() },
            min: [sinir.box_min.x, sinir.box_min.y, sinir.box_min.z],
            max: [sinir.box_max.x, sinir.box_max.y, sinir.box_max.z],
            parcalar,
            ucgen,
        });
    }

    gomulu.sort();
    gomulu.dedup();
    paketle(ModelBilgisi { cizimler, gomulu_dokular: gomulu }, y)
}

fn paketle(bilgi: ModelBilgisi, y: Yazici) -> Sonuc<Vec<u8>> {
    let json = serde_json::to_vec(&bilgi).map_err(|e| Hata::Bozuk(e.to_string()))?;
    let mut paket = Vec::with_capacity(8 + json.len() + 3 + y.0.len());
    paket.extend_from_slice(b"TLKM");
    paket.extend_from_slice(&(json.len() as u32).to_le_bytes());
    paket.extend_from_slice(&json);
    paket.resize(paket.len().div_ceil(4) * 4, b' ');
    paket.extend_from_slice(&y.0);
    Ok(paket)
}

/// Çarpışma dosyasını (ybn) 3B paketine çevirir; her malzeme türü ayrı renkte bir parçadır.
pub fn carpisma_oku(veri: &[u8]) -> Sonuc<Vec<u8>> {
    let ybn = rage_formats::parse_ybn(veri).map_err(|e| Hata::Bozuk(format!("çarpışma okunamadı: {e}")))?;
    let mut gruplar: std::collections::BTreeMap<u8, Vec<rage_formats::Triangle>> = Default::default();
    for t in ybn.triangles() {
        gruplar.entry(t.material).or_default().push(t);
    }
    let (mut min, mut max) = ([f32::MAX; 3], [f32::MIN; 3]);
    let mut y = Yazici(Vec::new());
    let mut parcalar = Vec::new();
    let mut ucgen = 0;
    for (malzeme, ucgenler) in &gruplar {
        let mut konum = Vec::with_capacity(ucgenler.len() * 9);
        let mut normal = Vec::with_capacity(ucgenler.len() * 9);
        for t in ucgenler {
            let n = t.normal();
            for v in t.vertices {
                for (i, c) in [v.x, v.y, v.z].into_iter().enumerate() {
                    min[i] = min[i].min(c);
                    max[i] = max[i].max(c);
                }
                konum.extend([v.x, v.y, v.z]);
                normal.extend([n.x, n.y, n.z]);
            }
        }
        let adet = ucgenler.len() as u32 * 3;
        ucgen += ucgenler.len();
        // malzeme numarasından ayırt edilebilir, sabit bir renk
        let ton = (*malzeme as f32 * 47.0) % 360.0 / 60.0;
        let x = 1.0 - (ton % 2.0 - 1.0).abs();
        let [r, g, b] = match ton as u32 {
            0 => [1.0, x, 0.0],
            1 => [x, 1.0, 0.0],
            2 => [0.0, 1.0, x],
            3 => [0.0, x, 1.0],
            4 => [x, 0.0, 1.0],
            _ => [1.0, 0.0, x],
        };
        parcalar.push(Parca {
            doku: None,
            renk: Some([0.25 + r * 0.55, 0.25 + g * 0.55, 0.25 + b * 0.55]),
            konum: y.f32ler(&konum),
            normal: y.f32ler(&normal),
            uv: y.f32ler(&vec![0.0; adet as usize * 2]),
            indeks: y.u32ler(&(0..adet).collect::<Vec<_>>()),
        });
    }
    if ucgen == 0 {
        (min, max) = ([0.0; 3], [0.0; 3]);
    }
    let cizim = CizimBilgisi { ad: "çarpışma".into(), min, max, parcalar, ucgen };
    paketle(ModelBilgisi { cizimler: vec![cizim], gomulu_dokular: Vec::new() }, y)
}

/// En iyi LOD'daki toplam üçgen; 0 ise model boştur (optimizasyon modlarının "kaldırılmış" objeleri).
pub fn ucgen_sayisi(veri: &[u8], uzanti: &str) -> Sonuc<usize> {
    Ok(cizilebilirler(veri, uzanti)?
        .iter()
        .filter_map(|g| g.drawable.best_lod())
        .flat_map(|l| &l.models)
        .flat_map(|m| &m.geometries)
        .filter_map(|g| g.index_buffer.as_ref())
        .map(|ib| ib.indices.len() / 3)
        .sum())
}

/// Modelin parçalarının kullandığı ana (diffuse) doku adları; küçük harf, tekrarsız.
pub fn doku_adlari(veri: &[u8], uzanti: &str) -> Sonuc<Vec<String>> {
    let mut adlar = Vec::new();
    for g in cizilebilirler(veri, uzanti)? {
        let d = &g.drawable;
        let Some(lod) = d.best_lod() else { continue };
        for geo in lod.models.iter().flat_map(|m| &m.geometries) {
            if let Some(ad) = d.diffuse_texture_name(geo.shader_id).map(str::to_lowercase)
                && !adlar.contains(&ad)
            {
                adlar.push(ad);
            }
        }
    }
    Ok(adlar)
}

#[derive(Serialize)]
pub struct Yerlesim {
    pub arketip: u32,
    pub konum: [f32; 3],
    /// x, y, z, w — dosyada saklandığı gibi (ters dönüş)
    pub donus: [f32; 4],
    pub olcek: [f32; 2],
    pub lod_mesafe: f32,
}

pub fn ymap_yerlesimleri(veri: &[u8]) -> Sonuc<Vec<Yerlesim>> {
    let v = parse_ymap_entities(veri).map_err(|e| Hata::Bozuk(format!("ymap okunamadı: {e}")))?;
    Ok(v.into_iter()
        .filter(|e| !e.is_mlo_instance)
        .map(|e| Yerlesim {
            arketip: e.archetype_hash,
            konum: [e.position.x, e.position.y, e.position.z],
            donus: e.rotation,
            olcek: [e.scale_xy, e.scale_z],
            lod_mesafe: e.lod_dist,
        })
        .collect())
}

/// İkili meta/PSO dosyasını (ymap, ytyp, ymt, ymf) okunabilir XML'e çevirir.
pub fn meta_xml(veri: &[u8]) -> Sonuc<String> {
    let dokum = if is_pso(veri) { dump_pso(veri) } else { dump_meta(veri) }.map_err(|e| Hata::Gecersiz(format!("XML'e çevrilemedi: {e}")))?;
    Ok(to_xml(&dokum.root, &NameTable::core()))
}

/// Düzenlenmiş XML'i orijinal dosyanın kendi şemasıyla (yoksa CodeWalker tablolarıyla) ikiliye geri yazar.
/// Uyarılar, yazıcının atladığı ya da tahmin ettiği alanlardır.
pub fn meta_geri_yaz(orijinal: &[u8], xml: &str) -> Sonuc<(Vec<u8>, Vec<String>)> {
    let mut sema = Schema::builtin().clone();
    if let Ok(dosya) = Schema::from_file(orijinal) {
        sema.merge(dosya);
    }
    let kok = from_xml(xml).map_err(|e| Hata::Gecersiz(format!("XML okunamadı: {e}")))?;
    let yazilan = if is_pso(orijinal) { build_pso(&kok, &sema) } else { build_meta(&kok, &sema) }
        .map_err(|e| Hata::Gecersiz(format!("ikiliye yazılamadı: {e}")))?;
    Ok((yazilan.bytes, yazilan.warnings))
}

pub struct ObjCikti {
    pub obj: String,
    pub mtl: String,
    /// MTL'nin istediği doku adları (PNG olarak yanına yazılmalı)
    pub dokular: Vec<String>,
}

/// Modelin en iyi LOD'unu Wavefront OBJ/MTL olarak yazar. Doku v ekseni OBJ için ters çevrilir.
pub fn obj_yaz(veri: &[u8], uzanti: &str, ad: &str) -> Sonuc<ObjCikti> {
    use std::fmt::Write;
    let girdiler = cizilebilirler(veri, uzanti)?;
    let mut obj = format!("# Fltr Fivemleaktr\nmtllib {ad}.mtl\n");
    let mut dokular: Vec<String> = Vec::new();
    let mut taban = 1usize;
    for g in &girdiler {
        let d = &g.drawable;
        let Some(lod) = d.best_lod() else { continue };
        let _ = writeln!(obj, "o {}", if g.name.is_empty() { &d.name } else { &g.name });
        for (mi, model) in lod.models.iter().enumerate() {
            for (gi, geo) in model.geometries.iter().enumerate() {
                let (Some(vb), Some(ib)) = (&geo.vertex_buffer, &geo.index_buffer) else { continue };
                let Ok(koseler) = vb.to_unified_vertices() else { continue };
                let n = koseler.len();
                if n == 0 || ib.indices.iter().any(|&i| i as usize >= n) {
                    continue;
                }
                let malzeme = d.diffuse_texture_name(geo.shader_id).map(str::to_lowercase).unwrap_or_else(|| "dokusuz".into());
                if !dokular.contains(&malzeme) {
                    dokular.push(malzeme.clone());
                }
                let _ = writeln!(obj, "g parca_{mi}_{gi}\nusemtl {malzeme}");
                for k in &koseler {
                    let _ = writeln!(obj, "v {} {} {}", k.position.x, k.position.y, k.position.z);
                }
                for k in &koseler {
                    let _ = writeln!(obj, "vt {} {}", k.texcoord0.x, 1.0 - k.texcoord0.y);
                }
                for k in &koseler {
                    let _ = writeln!(obj, "vn {} {} {}", k.normal.x, k.normal.y, k.normal.z);
                }
                for u in ib.indices.as_chunks::<3>().0 {
                    let (a, b, c) = (u[0] as usize + taban, u[1] as usize + taban, u[2] as usize + taban);
                    let _ = writeln!(obj, "f {a}/{a}/{a} {b}/{b}/{b} {c}/{c}/{c}");
                }
                taban += n;
            }
        }
    }
    let mut mtl = String::from("# Fltr Fivemleaktr\n");
    for m in &dokular {
        let _ = writeln!(mtl, "newmtl {m}\nKd 1 1 1\nillum 1");
        if m != "dokusuz" {
            let _ = writeln!(mtl, "map_Kd {m}.png");
        }
    }
    Ok(ObjCikti { obj, mtl, dokular: dokular.into_iter().filter(|m| m != "dokusuz").collect() })
}
