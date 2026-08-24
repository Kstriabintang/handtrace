<div align="center">

# 🖐️ HAND//TRACE

### AR tangan real-time di browser — kamera depan membaca jarimu, efek glitch neon mengikutinya.

**[▶ Coba Langsung](https://ksatriabintangsamudra.my.id/handtrace/)**

</div>

---

Buka halamannya, izinkan kamera depan, tunjukkan tangan — **21 titik sendi** per tangan dilacak real-time (hingga 2 tangan) dan efek bereaksi ke gesturmu:

| Gestur | Efek |
|---|---|
| 🤏 **Pinch** (jempol + telunjuk) | Bola energi muncul di antara jari — geser untuk memindahkan, tahan untuk mengisi daya, **lepaskan = meledak** |
| ✋ **Telapak terbuka** | Perisai hologram heksagon berputar mengikuti telapak |
| ✊ **Mengepal** | Overload: layar ber-glitch (RGB split, slice shift, noise) |
| 🙌 **Dua tangan** | Petir menyambung antar ujung telunjuk |

Plus: kerangka tangan neon dengan ghost kromatik, jejak cahaya di ujung jari, partikel, scanline CRT, HUD telemetri (FPS · jumlah tangan · latensi inferensi), tombol jepret PNG, dan **mode demo** (tangan sintetis) bila kamera tidak tersedia.

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
