//! AI sağlayıcılarının API anahtarları ayar dosyasında düz metin durmasın diye
//! Windows Kimlik Bilgisi Yöneticisi'nde tutulur. Arayüz anahtarları her zamanki
//! gibi ayarların içinde görür: yazarken buraya ayrılır, okurken geri doldurulur.
//! Kasa kullanılamazsa (Windows dışı ya da hata) anahtar ayar dosyasında kalır;
//! hiçbir koşulda kaybolmaz.

use serde_json::Value;

const SERVIS: &str = "tlk-rpf";
const ESKI_HESAP: &str = "ai:eski";
/// Ayar dosyasında, kasaya taşınmış anahtarların hesap adları.
pub const LISTE: &str = "anahtar_kasasi";

#[cfg(windows)]
fn yaz(hesap: &str, deger: &str) -> bool {
    keyring::Entry::new(SERVIS, hesap).and_then(|e| e.set_password(deger)).is_ok()
}
#[cfg(windows)]
fn oku(hesap: &str) -> Option<String> {
    keyring::Entry::new(SERVIS, hesap).and_then(|e| e.get_password()).ok()
}
#[cfg(windows)]
fn sil(hesap: &str) {
    if let Ok(e) = keyring::Entry::new(SERVIS, hesap) {
        let _ = e.delete_credential();
    }
}

#[cfg(not(windows))]
fn yaz(_: &str, _: &str) -> bool {
    false
}
#[cfg(not(windows))]
fn oku(_: &str) -> Option<String> {
    None
}
#[cfg(not(windows))]
fn sil(_: &str) {}

fn hesap(id: &str) -> String {
    format!("ai:{id}")
}

fn liste(v: &Value) -> Vec<String> {
    v.get(LISTE)
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_owned)).collect())
        .unwrap_or_default()
}

/// Ayar dosyasında hâlâ düz metin anahtar var mı.
pub fn duz_anahtar_var(v: &Value) -> bool {
    let dolu = |x: Option<&Value>| x.and_then(Value::as_str).is_some_and(|s| !s.is_empty());
    dolu(v.get("ai_anahtari"))
        || v.get("ai_saglayicilar").and_then(Value::as_array).is_some_and(|a| a.iter().any(|p| dolu(p.get("anahtar"))))
}

/// Diske yazılacak hâl: anahtarlar kasaya taşınır, yerlerinde boş metin kalır.
/// `onceki`, diskteki önceki ayarlar; silinen sağlayıcıların anahtarları kasadan da silinir.
pub fn ayir(mut ayarlar: Value, onceki: &Value) -> Value {
    let mut kasada: Vec<String> = Vec::new();
    let mut tasi = |deger: &mut Value, hesap: String| {
        if deger.as_str().is_some_and(|k| !k.is_empty() && yaz(&hesap, k)) {
            *deger = Value::String(String::new());
            kasada.push(hesap);
        }
    };
    if let Some(a) = ayarlar.get_mut("ai_saglayicilar").and_then(Value::as_array_mut) {
        for p in a {
            let Some(id) = p.get("id").and_then(Value::as_str).map(str::to_owned) else { continue };
            if let Some(k) = p.get_mut("anahtar") {
                tasi(k, hesap(&id));
            }
        }
    }
    if let Some(k) = ayarlar.get_mut("ai_anahtari") {
        tasi(k, ESKI_HESAP.to_owned());
    }
    for h in liste(onceki) {
        if !kasada.contains(&h) {
            sil(&h);
        }
    }
    if let Some(o) = ayarlar.as_object_mut() {
        o.insert(LISTE.into(), Value::from(kasada));
    }
    ayarlar
}

/// Arayüze verilecek hâl: kasadaki anahtarlar yerlerine konur.
pub fn doldur(mut ayarlar: Value) -> Value {
    let kasada = liste(&ayarlar);
    let koy = |deger: &mut Value, hesap: String| {
        if deger.as_str().is_some_and(str::is_empty)
            && kasada.contains(&hesap)
            && let Some(k) = oku(&hesap)
        {
            *deger = Value::String(k);
        }
    };
    if let Some(a) = ayarlar.get_mut("ai_saglayicilar").and_then(Value::as_array_mut) {
        for p in a {
            let Some(id) = p.get("id").and_then(Value::as_str).map(str::to_owned) else { continue };
            if let Some(k) = p.get_mut("anahtar") {
                koy(k, hesap(&id));
            }
        }
    }
    if let Some(k) = ayarlar.get_mut("ai_anahtari") {
        koy(k, ESKI_HESAP.to_owned());
    }
    if let Some(o) = ayarlar.as_object_mut() {
        o.remove(LISTE);
    }
    ayarlar
}

#[cfg(all(test, windows))]
mod testler {
    use super::*;
    use serde_json::json;

    #[test]
    fn anahtar_kasaya_gider_ve_geri_gelir() {
        let id = format!("test-{}", std::process::id());
        let ayar = json!({ "ai_saglayicilar": [{ "id": id, "ad": "Deneme", "anahtar": "sk-gizli" }], "ai_secili": id });
        let disk = ayir(ayar.clone(), &json!({}));
        assert_eq!(disk["ai_saglayicilar"][0]["anahtar"], "", "anahtar dosyada kalmamalı");
        assert!(!duz_anahtar_var(&disk));
        assert_eq!(doldur(disk.clone()), ayar, "okurken aynı ayarlar geri gelmeli");
        // Sağlayıcı silinince anahtarı da kasadan silinir.
        let bos = ayir(json!({ "ai_saglayicilar": [] }), &disk);
        assert!(liste(&bos).is_empty());
        assert!(oku(&hesap(&id)).is_none());
    }
}
