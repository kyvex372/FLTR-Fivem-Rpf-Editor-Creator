<div align="center">

<img src="src-tauri/icons/128x128@2x.png" alt="FLTR logosu" width="112" height="112">

# FLTR FiveM RPF Editor & Creator

**Fivemleaktr · FiveM mod paketlerini oluştur, incele ve düzenle.**

Windows için Türkçe arayüzlü RPF düzenleyici. Dokular, görsel ayarlar, efektler, modeller ve harita araçları tek uygulamada.

[![CI](https://github.com/kyvex372/FLTR-Fivem-Rpf-Editor-Creator/actions/workflows/ci.yml/badge.svg)](https://github.com/kyvex372/FLTR-Fivem-Rpf-Editor-Creator/actions/workflows/ci.yml)
![Platform](https://img.shields.io/badge/platform-Windows%2010%20%2F%2011%20x64-0078D4)
![Arayüz](https://img.shields.io/badge/aray%C3%BCz-T%C3%BCrk%C3%A7e-E5243B)
[![Lisans](https://img.shields.io/badge/lisans-GPL--3.0--only-blue)](LICENSE)

[Sürümler](https://github.com/kyvex372/FLTR-Fivem-Rpf-Editor-Creator/releases) · [Hata bildir](https://github.com/kyvex372/FLTR-Fivem-Rpf-Editor-Creator/issues) · [Katkıda bulun](CONTRIBUTING.md)

</div>

## Proje hakkında

FLTR FiveM RPF Editor & Creator, FiveM `mods` klasöründeki `.rpf` paketleri üzerinde çalışır. Mevcut bir paketi açabilir, içeriğini düzenleyebilir veya yeni bir mod paketi oluşturup `assembly.xml` eşlemelerini hazırlayabilirsin.

Uygulama içindeki ürün adı **Fltr Fivemleaktr**, teknik paket adı **fltr-rpf** olarak kullanılır.

## Özellikler

- **RPF ve mod yönetimi:** Paket oluşturma, dosya ekleme ve çıkarma, modları açma/kapatma, paket eşlemeleri ve çakışma karşılaştırması.
- **Doku düzenleme:** `.ytd` dokularını görüntüleme, değiştirme, renklendirme, yeniden adlandırma ve boyutlandırma; PNG/DDS dışa aktarma ve toplu içe aktarma.
- **Gömülü dokular:** `.ydr`, `.ydd`, `.yft` ve `.ypt` içindeki dokuları düzenleme ve boyutlandırma.
- **Görsel ayarlar:** `visualsettings.dat` için gruplanmış ayarlar, renk araçları ve hazır ayarlar.
- **Parçacık efektleri:** `.ypt` efektlerinde renk, boyut, ışık ve yoğunluk düzenleme.
- **3B önizleme:** Modelleri ve `.ybn` çarpışma dosyalarını inceleme, dokularıyla OBJ dışa aktarma.
- **ESC ve radar haritası:** Harita üzerine logo, görsel ve yazı yerleştirme; katmanları döndürme ve ölçekleme.
- **Arayüz ve meta dosyaları:** `.gfx` içindeki görselleri düzenleme; desteklenen meta dosyalarını XML üzerinden değiştirme.
- **Yedekleme ve geri alma:** Mod kaydından önce yedek, düzenlemelerde geri al/yinele ve önceki yedeği geri yükleme.
- **İsteğe bağlı AI yardımcısı:** Claude, OpenAI, Gemini, Groq, OpenRouter, Ollama ve özel OpenAI uyumlu sağlayıcılar.

## Çalıştırma

Bu depoya henüz FLTR adına hazır bir EXE sürümü eklenmedi. Şimdilik aşağıdaki adımlarla kaynak koddan çalıştırabilirsin. Yayınlanan paketler bu deponun [Sürümler](https://github.com/kyvex372/FLTR-Fivem-Rpf-Editor-Creator/releases) sayfasında yer alır.

### Gerekenler

- Windows 10 veya Windows 11, x64.
- Git.
- Node.js 22.12 veya üzeri ve npm.
- Güncel kararlı Rust araç zinciri; Windows için MSVC hedefi.
- Visual Studio Build Tools: **Desktop development with C++** iş yükü ve Windows SDK.
- Microsoft Edge WebView2 Runtime.

### İndir ve başlat

PowerShell'de komutları sırayla çalıştır:

```powershell
git clone https://github.com/kyvex372/FLTR-Fivem-Rpf-Editor-Creator.git
cd FLTR-Fivem-Rpf-Editor-Creator
npm ci
npm run tauri dev
```

İlk açılışta bağımlılıklar indirilir ve Rust kodu derlenir; internet bağlantısı gerekir ve işlem zaman alabilir. Derleme tamamlanınca masaüstü uygulaması açılır.

Yalnızca arayüzü tarayıcıda incelemek için `npm run dev` çalıştırıp `http://localhost:1420` adresini açabilirsin. Dosya işlemleri ve diğer masaüstü özellikleri için Tauri uygulaması gerekir.

### EXE ve kurulum paketi oluştur

```powershell
npm run tauri build
```

- Kurulumsuz uygulama: `target/release/fltr-rpf.exe`
- Windows kurulum paketi: `target/release/bundle/nsis/`

## İlk kullanım

1. FiveM'i kapat ve düzenleyeceğin modların ayrı bir kopyasını sakla.
2. Uygulamayı aç. Mods klasörü otomatik bulunmazsa klasör seçme düğmesiyle konumunu belirt.
3. Soldaki listeden bir mod seç veya **RPF aç** ile paket aç. Yeni paket için **Yeni mod** düğmesini kullan.
4. Dokuları, ayarları, efektleri veya paket içeriğini düzenle.
5. **Ctrl+S** ile kaydet. Sonucu FiveM içinde ayrıca kontrol et.

Varsayılan FiveM mods konumu:

```text
%LOCALAPPDATA%\FiveM\FiveM.app\mods
```

### Kısayollar

- **Ctrl+O:** RPF aç.
- **Ctrl+S / Ctrl+Shift+S:** Kaydet / farklı kaydet.
- **Ctrl+Z / Ctrl+Y:** Geri al / yinele.
- **Ctrl+P:** Komut paleti.
- **Ctrl+K:** AI yardımcısı.
- **F2:** Seçili dosyayı yeniden adlandır.

## Gizlilik ve bilinen sınırlar

AI yardımcısı isteğe bağlıdır. Kullanıldığında mesajların ve yardımcının okuduğu mod içeriği seçtiğin sağlayıcıya gönderilebilir. Özel sağlayıcı adresini ve anahtarını yalnızca güvendiğin bir servis için ayarla. Anahtarlar Windows Kimlik Bilgisi Yöneticisi'nde tutulmaya çalışılır; kasa kullanılamazsa ayar dosyasında düz metin kalabilir.

Mevcut ayar ve yedeklerle uyumluluk için yerel veri dizini `%APPDATA%\com.talkdedsec.tlkrpf\` olarak korunur. Mod kaydı sırasında önceki dosya yedeklenir; her dosya için son 20 yedek tutulur.

- `OPEN` ve `CFXP` RPF arşivleri desteklenir; `NG` ve `AES` şifreli arşivler açılamaz.
- Yeni mod paketi oluşturulabilir; sıfırdan 3B model üretimi ve mesh içe aktarma desteklenmez.
- `.awc` ses düzenleme desteklenmez. Model ve efekt içindeki gömülü dokular eklenip silinemez.
- Büyük arşivler yüksek miktarda RAM kullanabilir. Oyun içindeki sonuç ayrıca test edilmelidir.
- Güvenilmeyen paketleri dışa aktarmak risk taşır: dışa aktarma yollarının doğrulanmasında bilinen eksikler vardır. Güvenmediğin RPF dosyalarını dışa aktarma.

## Geliştirme

Arayüz **React + TypeScript + Vite**, masaüstü katmanı **Tauri**, arşiv ve dosya işlemleri **Rust** ile yazılmıştır.

- `src/`: Arayüz ve düzenleyiciler.
- `src-tauri/`: Masaüstü komutları, uygulama ayarları ve simgeler.
- `core/`: RPF, doku, model, efekt ve diğer dosya biçimleri.
- `docs/ekran/`: Kaynak projeden kalan referans ekran görüntüleri; FLTR markasına geçiş öncesindeki görünümü gösterebilir.
- `.github/workflows/`: Kontrol ve sürüm oluşturma iş akışları.

Arayüz derlemesi:

```powershell
npm run build
```

Çekirdek testleri ve ayrıştırıcı denemesi:

```powershell
cargo test -p fltr-rpf-core --locked
cargo run -p fltr-rpf-core --example kirici
```

Gerçek mod dosyası kullanan testler `testdata/*.rpf` örneklerini arar. Bu dosyalar depoya dahil değildir; örnekler yoksa ilgili testler atlanır.

## Destek ve katkı

Hata veya özellik isteği için [bu depoda bir issue aç](https://github.com/kyvex372/FLTR-Fivem-Rpf-Editor-Creator/issues). Hata bildirimine uygulama sürümünü, yaptığın işlemi ve hata mesajını ekle. API anahtarı veya başka gizli bilgi paylaşma.

Değişiklik göndermek için [katkı rehberine](CONTRIBUTING.md), kullanılan bileşenler için [üçüncü taraf bildirimlerine](THIRD_PARTY_NOTICES.md) bakabilirsin. [CHANGELOG.md](CHANGELOG.md), kaynak projeden devralınan sürüm geçmişini içerir.

## Kaynak ve lisans

Bu proje, **Talkdedsec** tarafından geliştirilen [tlk-rpf](https://github.com/Talkdedsec/tlk-rpf) temel alınarak **FLTR / Fivemleaktr** markasına uyarlanmıştır. Orijinal yazar ve telif bildirimleri korunur.

Copyright (c) 2026 Talkdedsec.

Proje **GPL-3.0-only** lisansı altında sunulur. Lisansın tam metni [LICENSE](LICENSE) dosyasındadır.

FLTR / Fivemleaktr; Rockstar Games, Take-Two Interactive veya Cfx.re ile bağlantılı değildir. Grand Theft Auto ve FiveM adları ilgili sahiplerinin ticari markalarıdır.
