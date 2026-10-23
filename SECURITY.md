# FLTR güvenlik bildirimleri

FLTR, dışarıdan gelen RPF ve kaynak dosyalarını işler. Seçilen klasörün dışına dosya yazılması, izinsiz kod çalıştırılması, API anahtarlarının açığa çıkması ve istenmeyen dosya değişiklikleri güvenlik sorunu olarak değerlendirilir.

## Bildirim

Güvenlik açığının ayrıntılarını ve örnek saldırı dosyalarını herkese açık issue içinde paylaşmayın. Deponun [Security](https://github.com/kyvex372/FLTR-Fivem-Rpf-Editor-Creator/security) bölümünde **Report a vulnerability** seçeneği etkinse özel bildirim gönderin. Bu seçenek yoksa depo sahibinden özel bir bildirim kanalı isteyin; açığın ayrıntılarını o zamana kadar paylaşmayın.

Bildirime kullanılan sürümü, sorunu tetikleyen işlemleri ve beklenen/gerçekleşen davranışı ekleyin. API anahtarı ve kişisel veri göndermeyin.

## Dışa aktarma koruması

Arşiv, toplu doku ve OBJ dışa aktarımında dosya adları doğrulanır. Klasör ayırıcıları, üst dizin yolları, Windows aygıt adları ve mevcut hedefler reddedilir. Bu kontroller tüm ayrıştırıcıların güvenli olduğuna dair garanti değildir.

Oyun içinde yanlış görünen bir doku gibi güvenlik dışı hatalar için [Issues](https://github.com/kyvex372/FLTR-Fivem-Rpf-Editor-Creator/issues) kullanılabilir.
