// Dil seçimi (varsayılan İngilizce, Türkçe düğmeyle), ekran görüntüsü büyütme ve son sürümün indirme bağlantısı.
(() => {
  const kok = document.documentElement;
  const basliklar = { en: "Fltr Fivemleaktr — FiveM RPF editor", tr: "Fltr Fivemleaktr — FiveM RPF düzenleyici" };

  const dilAyarla = (dil, kaydet) => {
    kok.dataset.dil = dil;
    kok.lang = dil;
    document.title = basliklar[dil];
    if (!kaydet) return;
    try {
      localStorage.setItem("dil", dil);
    } catch {
      /* depolama kapalıysa tercih hatırlanmaz */
    }
  };
  let kayitli = null;
  try {
    kayitli = localStorage.getItem("dil");
  } catch {
    /* yok say */
  }
  dilAyarla(kayitli === "tr" ? "tr" : "en", false);
  document.getElementById("dil").addEventListener("click", () => dilAyarla(kok.dataset.dil === "tr" ? "en" : "tr", true));

  const pencere = document.getElementById("buyuk");
  const buyukResim = pencere.querySelector("img");
  document.querySelectorAll(".buyut").forEach((d) =>
    d.addEventListener("click", () => {
      buyukResim.src = d.dataset.src;
      buyukResim.alt = d.querySelector("img")?.alt ?? "";
      pencere.showModal();
    }),
  );
  pencere.addEventListener("click", (e) => {
    if (e.target === pencere) pencere.close();
  });

  // Son sürümde kurucu varsa doğrudan ona bağla; yoksa sürümler sayfası kalır.
  const boyut = (b) => (b / 1048576).toFixed(1).replace(".", kok.dataset.dil === "tr" ? "," : ".") + " MB";
  fetch("https://api.github.com/repos/Talkdedsec/tlk-rpf/releases/latest", { headers: { Accept: "application/vnd.github+json" } })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((s) => {
      const kurucu = (s.assets || []).find((a) => /_x64-setup\.exe$/i.test(a.name));
      if (!kurucu) return;
      document.getElementById("indir").href = kurucu.browser_download_url;
      const bilgi = document.getElementById("surum-bilgi");
      const surum = String(s.tag_name || "").replace(/^v/, "");
      bilgi.querySelector(".tr").textContent = `Sürüm ${surum} · ${boyut(kurucu.size)} · Windows 10/11 x64 · yönetici izni gerekmez`;
      bilgi.querySelector(".en").textContent = `Version ${surum} · ${boyut(kurucu.size)} · Windows 10/11 x64 · no admin rights needed`;
    })
    .catch(() => {});
})();
