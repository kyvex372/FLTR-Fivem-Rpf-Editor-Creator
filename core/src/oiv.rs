//! OIV `assembly.xml`: pakette hangi dosyanın oyunda nereye gideceği.

use serde::{Deserialize, Serialize};

use crate::{Hata, Sonuc};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Paket {
    pub ad: String,
    pub surum: String,
    pub yazar: String,
    pub aciklama: String,
    pub hedefler: Vec<Hedef>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Hedef {
    /// `content/` altındaki yol, `/` ayraçlı
    pub kaynak: String,
    pub arsivler: Vec<String>,
    pub yol: String,
    pub sil: bool,
}

fn yol_duzelt(y: &str) -> String {
    y.trim().replace('/', "\\").trim_matches('\\').to_string()
}

impl Hedef {
    /// Çakışma karşılaştırması için tek dizgi: `update\update.rpf\common\data\visualsettings.dat`
    pub fn anahtar(&self) -> String {
        let mut p: Vec<&str> = self.arsivler.iter().map(String::as_str).collect();
        p.push(&self.yol);
        p.join("\\").to_lowercase()
    }
}

fn metin(d: roxmltree::Node, yol: &[&str]) -> String {
    let mut n = Some(d);
    for ad in yol {
        n = n.and_then(|x| x.children().find(|c| c.has_tag_name(*ad)));
    }
    n.and_then(|x| x.text()).unwrap_or_default().trim().to_string()
}

fn icerik_gez(n: roxmltree::Node, arsivler: &mut Vec<String>, cikti: &mut Vec<Hedef>) {
    for c in n.children().filter(|c| c.is_element()) {
        match c.tag_name().name() {
            "archive" => {
                arsivler.push(yol_duzelt(c.attribute("path").unwrap_or_default()));
                icerik_gez(c, arsivler, cikti);
                arsivler.pop();
            }
            "add" | "replace" => cikti.push(Hedef {
                kaynak: c.attribute("source").unwrap_or_default().trim().replace('\\', "/").to_lowercase(),
                arsivler: arsivler.clone(),
                yol: yol_duzelt(c.text().unwrap_or_default()),
                sil: false,
            }),
            "delete" => cikti.push(Hedef {
                kaynak: String::new(),
                arsivler: arsivler.clone(),
                yol: yol_duzelt(c.text().unwrap_or_default()),
                sil: true,
            }),
            _ => {}
        }
    }
}

/// FiveM assembly.xml'i hoşgörülü okur; <package> dışındaki çöp satırlar ve kaçışsız `&` sık görülür.
fn temizle(xml: &str) -> String {
    let bas = xml.find("<package").unwrap_or(0);
    let son = xml.rfind("</package>").map_or(xml.len(), |i| i + "</package>".len());
    let govde = &xml[bas..son.max(bas)];
    let mut cikti = String::with_capacity(govde.len());
    for (i, c) in govde.char_indices() {
        let varlik = |kalan: &str| {
            kalan.split_once(';').is_some_and(|(ad, _)| {
                !ad.is_empty() && ad.len() <= 8 && (ad.starts_with('#') || ad.chars().all(|x| x.is_ascii_alphanumeric()))
            })
        };
        if c == '&' && !varlik(&govde[i + 1..]) {
            cikti.push_str("&amp;");
        } else {
            cikti.push(c);
        }
    }
    cikti
}

pub fn coz(xml: &str) -> Sonuc<Paket> {
    let xml = xml.trim_start_matches('\u{feff}');
    let temiz;
    let belge = match roxmltree::Document::parse(xml) {
        Ok(b) => b,
        Err(e) => {
            temiz = temizle(xml);
            roxmltree::Document::parse(&temiz).map_err(|_| Hata::Gecersiz(format!("assembly.xml okunamadı: {e}")))?
        }
    };
    let kok = belge.root_element();
    let meta = kok.children().find(|c| c.has_tag_name("metadata"));
    let mut p = Paket::default();
    if let Some(m) = meta {
        p.ad = metin(m, &["name"]);
        let (ana, alt) = (metin(m, &["version", "major"]), metin(m, &["version", "minor"]));
        p.surum = if ana.is_empty() { String::new() } else { format!("{ana}.{}", if alt.is_empty() { "0" } else { &alt }) };
        p.yazar = metin(m, &["author", "displayName"]);
        p.aciklama = metin(m, &["description"]);
    }
    if let Some(c) = kok.children().find(|c| c.has_tag_name("content")) {
        icerik_gez(c, &mut Vec::new(), &mut p.hedefler);
    }
    Ok(p)
}

/// `source="..."` değeri `eski` olan bütün satırları `yeni`ye çevirir; dosyanın geri kalanına dokunmaz.
pub fn kaynak_degistir(xml: &str, eski: &str, yeni: &str) -> (String, usize) {
    let normal = |s: &str| s.trim().replace('\\', "/").to_lowercase();
    let hedef = normal(eski);
    let yeni = yeni.replace('/', "\\");
    let mut cikti = String::with_capacity(xml.len());
    let mut kalan = xml;
    let mut adet = 0;
    while let Some(i) = kalan.find("source=\"") {
        let bas = i + "source=\"".len();
        let Some(son) = kalan[bas..].find('"') else { break };
        cikti.push_str(&kalan[..bas]);
        let deger = &kalan[bas..bas + son];
        if normal(deger) == hedef {
            cikti.push_str(&kacis(&yeni));
            adet += 1;
        } else {
            cikti.push_str(deger);
        }
        kalan = &kalan[bas + son..];
    }
    cikti.push_str(kalan);
    (cikti, adet)
}

fn kacis(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn icerik_yaz(hedefler: &[&Hedef], derinlik: usize, girinti: usize, x: &mut String) {
    let bosluk = "\t".repeat(girinti);
    let mut arsiv_sirasi: Vec<&str> = Vec::new();
    for h in hedefler {
        if h.arsivler.len() == derinlik {
            if h.sil {
                x.push_str(&format!("{bosluk}<delete>{}</delete>\n", kacis(&h.yol)));
            } else {
                x.push_str(&format!(
                    "{bosluk}<add source=\"{}\">{}</add>\n",
                    kacis(&h.kaynak.replace('/', "\\")),
                    kacis(&h.yol)
                ));
            }
        } else if !arsiv_sirasi.iter().any(|a| a.eq_ignore_ascii_case(&h.arsivler[derinlik])) {
            arsiv_sirasi.push(&h.arsivler[derinlik]);
        }
    }
    for a in arsiv_sirasi {
        let alt: Vec<&Hedef> = hedefler
            .iter()
            .copied()
            .filter(|h| h.arsivler.len() > derinlik && h.arsivler[derinlik].eq_ignore_ascii_case(a))
            .collect();
        x.push_str(&format!("{bosluk}<archive path=\"{}\" createIfNotExist=\"True\" type=\"RPF7\">\n", kacis(a)));
        icerik_yaz(&alt, derinlik + 1, girinti + 1, x);
        x.push_str(&format!("{bosluk}</archive>\n"));
    }
}

pub fn uret(p: &Paket) -> String {
    let (ana, alt) = p.surum.split_once('.').unwrap_or((if p.surum.is_empty() { "1" } else { &p.surum }, "0"));
    let mut x = String::new();
    x.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<package version=\"2.0\" target=\"Five\">\n");
    x.push_str("\t<metadata>\n");
    x.push_str(&format!("\t\t<name>{}</name>\n", kacis(&p.ad)));
    x.push_str(&format!("\t\t<version>\n\t\t\t<major>{}</major>\n\t\t\t<minor>{}</minor>\n\t\t\t<tag>Stable</tag>\n\t\t</version>\n", kacis(ana), kacis(alt)));
    x.push_str(&format!("\t\t<author>\n\t\t\t<displayName>{}</displayName>\n\t\t</author>\n", kacis(&p.yazar)));
    x.push_str(&format!("\t\t<description><![CDATA[{}]]></description>\n", p.aciklama.replace("]]>", "]] >")));
    x.push_str("\t</metadata>\n\t<content>\n");
    let hepsi: Vec<&Hedef> = p.hedefler.iter().collect();
    icerik_yaz(&hepsi, 0, 2, &mut x);
    x.push_str("\t</content>\n</package>\n");
    x
}

#[cfg(test)]
mod testler {
    use super::*;

    #[test]
    fn gidis_donus() {
        let x = r#"<?xml version="1.0"?><package version="2.0" target="Five"><metadata><name>Deneme</name>
            <version><major>1</major><minor>2</minor></version><author><displayName>Fivemleaktr</displayName></author></metadata>
            <content><add source="a.rpf">update\x64\dlcpacks\a\dlc.rpf</add>
            <archive path="update\update.rpf" createIfNotExist="True" type="RPF7">
              <add source="essa\graphics.ytd">\x64\textures\graphics.ytd</add>
              <add source="essa\visualsettings.dat">\common\data\visualsettings.dat</add>
            </archive></content></package>"#;
        let p = coz(x).unwrap();
        assert_eq!((p.ad.as_str(), p.surum.as_str(), p.yazar.as_str()), ("Deneme", "1.2", "Fivemleaktr"));
        assert_eq!(p.hedefler.len(), 3);
        assert_eq!(p.hedefler[1].kaynak, "essa/graphics.ytd");
        assert_eq!(p.hedefler[2].anahtar(), "update\\update.rpf\\common\\data\\visualsettings.dat");
        let yeniden = coz(&uret(&p)).unwrap();
        assert_eq!(yeniden.hedefler, p.hedefler);
    }

    #[test]
    fn kaynak_degistirme_metni_korur() {
        let x = "<!-- not -->\n<package><content><add source=\"Eski.rpf\">update\\x64\\dlcpacks\\eski\\dlc.rpf</add>\
            <add source=\"a.ymt\">x</add></content></package>";
        let (y, n) = kaynak_degistir(x, "eski.rpf", "talk.rpf");
        assert_eq!(n, 1);
        assert_eq!(y, x.replace("Eski.rpf", "talk.rpf"));
        assert_eq!(coz(&y).unwrap().hedefler[0].kaynak, "talk.rpf");
    }

    #[test]
    fn bozuk_yorum_ve_kacissiz_ampersand() {
        let x = "<?xml version=\"1.0\"?>\r\n!--Made by x --\r\n<package><metadata><name>A & B</name></metadata>\
            <content><add source=\"a.ymt\">update\\update.rpf\\x64\\a.ymt</add></content></package>";
        let p = coz(x).unwrap();
        assert_eq!(p.ad, "A & B");
        assert_eq!(p.hedefler.len(), 1);
    }
}

#[cfg(test)]
mod bozuk_girdi {
    #[test]
    fn cok_baytli_karakterde_cokmez() {
        let xml = "<package><metadata><name>é&ş ğ</name></metadata><content><add source=\"a\">b</add></content></package>\u{FFFD}";
        let _ = super::coz(xml);
        let _ = super::coz("\u{FFFD}<package>&\u{FFFD}ı");
    }
}
