<div align="center">

# 🖐️ HAND//TRACE

### Mode LUMEN — sihir cahaya real-time di browser: lukis di udara, ciptakan kupu-kupu, putar galaksi di telapakmu.

**[▶ Coba Langsung](https://ksatriabintangsamudra.my.id/handtrace/)**

</div>

---

Buka halamannya, izinkan kamera depan, tunjukkan tangan — **21 titik sendi** per tangan dilacak real-time (hingga 2 tangan) dan efek bereaksi ke gesturmu:

| Gestur | Yang kamu ciptakan |
|---|---|
| ☝️ **Telunjuk** | **Melukis tinta cahaya** di udara — goresan kaligrafi bercahaya yang tinggal, berganti rona, dan berdenyut |
| 🤏 **Pinch** (jempol + telunjuk) | **Menetaskan kupu-kupu cahaya** — makin lama ditahan makin banyak; mereka terbang dan mengikuti telunjukmu |
| ✋ **Telapak terbuka** | **Galaksi mini** berputar di atas telapak — miring mengikuti kemiringan tanganmu |
| ✊ **Mengepal** | **Gravitasi** — menghisap tinta, kupu-kupu, dan partikel; buka tangan = **NOVA** (ledakan cahaya yang melahirkan kupu-kupu baru) |
| 🙌 **Dua tangan** | **Benang aurora** — lima helai cahaya menghubungkan kelima pasang ujung jari |

Plus: tangan digambar sebagai **konstelasi bintang**, jejak komet di ujung jari, pelacakan di-*smoothing* adaptif (bebas jitter), glow ber-cache sprite (60 fps tanpa `shadowBlur`), HUD telemetri, tombol **Jepret** (PNG) & **Hapus**, dan **mode demo** (tangan sintetis) bila kamera tidak tersedia.

## Teknologi

- **[MediaPipe Tasks Vision](https://developers.google.com/mediapipe)** — `HandLandmarker` (WASM + model `hand_landmarker.task`), delegasi GPU dengan fallback CPU, **di-self-host** di `vendor/` (tanpa CDN).
- **Canvas 2D murni** untuk seluruh efek — tanpa framework, satu `index.html` + satu `app.js`.
- **100% on-device**: video tidak pernah meninggalkan perangkat — tidak ada server, tidak ada upload.

## Menjalankan lokal

```bash
python3 -m http.server 8080
# buka http://localhost:8080
```

> Perlu HTTPS atau localhost agar browser mengizinkan kamera. Berjalan di Chrome/Edge/Safari modern, desktop maupun HP.

---

<div align="center"><sub><b>Ksatria Bintang Samudra</b> · <a href="https://ksatriabintangsamudra.my.id">ksatriabintangsamudra.my.id</a></sub></div>
