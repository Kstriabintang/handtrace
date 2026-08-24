// HANDTRACE — AR tangan glitch di browser.
// Kamera depan → MediaPipe HandLandmarker (21 titik/tangan, self-host, on-device) →
// efek neon-glitch mengikuti jari: trail ujung jari, PINCH=bola energi (lepas=meledak),
// PALM=perisai hologram, FIST=overload glitch, DUA TANGAN=petir antar telunjuk.
import { FilesetResolver, HandLandmarker } from './vendor/vision_bundle.mjs';

const CY = '#00f0ff', MG = '#ff2bd6', LM = '#b6ff2b', WH = '#ffffff';
const CONN = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const TIPS = [4, 8, 12, 16, 20];

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const video = document.getElementById('cam');
const el = id => document.getElementById(id);

let W = 0, H = 0;
function resize() { W = cv.width = innerWidth; H = cv.height = innerHeight; }
resize(); addEventListener('resize', resize);

// ---------------- state ----------------
const S = {
  ready: false, running: false, demo: false, camOn: false,
  hands: [],            // [{lm:[{x,y}×21], size, gest, pinch}]
  gestureLabel: '', gestureT: 0,
  pulse: 0, shake: 0,   // glitch global (fist / ledakan)
  fps: 0, ms: 0, _ft: 0, _fc: 0,
  t: 0,
};
const particles = [];   // {x,y,vx,vy,life,max,size,c,grav}
const shockwaves = [];  // {x,y,r,max,c}
const trails = new Map(); // key hand-tip -> [{x,y}]
const orbs = [null, null]; // per tangan: {x,y,r,charge,held}
let landmarker = null;

// ---------------- kamera ----------------
async function startCam() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
    });
    video.srcObject = stream;
    await video.play();
    S.camOn = true;
    return true;
  } catch (e) { return false; }
}

// ---------------- model ----------------
async function initModel() {
  el('hstat').textContent = 'memuat model…';
  const fileset = await FilesetResolver.forVisionTasks('./vendor/wasm');
  for (const delegate of ['GPU', 'CPU']) {
    try {
      landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: './vendor/hand_landmarker.task', delegate },
        runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: .5, minHandPresenceConfidence: .5, minTrackingConfidence: .5,
      });
      el('hstat').textContent = 'ONLINE·' + delegate;
      S.ready = true;
      return true;
    } catch (e) { /* coba delegate berikutnya */ }
  }
  el('hstat').textContent = 'GAGAL';
  return false;
}

// peta koordinat video (cover + mirror) → kanvas
function mapPoint(nx, ny) {
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  const s = Math.max(W / vw, H / vh);
  const ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
  return { x: W - (ox + nx * vw * s), y: oy + ny * vh * s }; // mirror X
}

// ---------------- gesture ----------------
const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function analyzeHand(lm) {
  const size = Math.max(30, d2(lm[0], lm[9]));
  const ext = f => d2(lm[f + 3], lm[0]) > d2(lm[f + 1], lm[0]) * 1.12; // tip lebih jauh dari pip
  const fingers = [ext(5), ext(9), ext(13), ext(17)];   // telunjuk,tengah,manis,kelingking
  const nExt = fingers.filter(Boolean).length;
  const pinchD = d2(lm[4], lm[8]) / size;
  const curled = f => d2(lm[f + 3], lm[0]) < d2(lm[f + 1], lm[0]);
  const fist = curled(5) && curled(9) && curled(13) && curled(17);
  let gest = 'idle';
  if (fist) gest = 'fist';                     // cek fist DULU — saat mengepal, jempol memang dekat telunjuk
  else if (pinchD < .40) gest = 'pinch';
  else if (nExt === 4) gest = 'palm';
  else if (fingers[0] && nExt <= 2) gest = 'point';
  return { size, gest, pinch: pinchD, indexExt: fingers[0] };
}

function setGesture(label, color) {
  const g = el('gest');
  if (!label) { g.classList.remove('on'); S.gestureLabel = ''; return; }
  if (S.gestureLabel !== label) {
    g.textContent = label;
    g.style.borderColor = color; g.style.textShadow = `0 0 14px ${color}`;
    g.classList.remove('on'); void g.offsetWidth; g.classList.add('on');
    S.gestureLabel = label;
  }
  S.gestureT = S.t;
}

// ---------------- partikel ----------------
function spawn(x, y, n, c, sp = 4, grav = .06, size = 2.6) {
  for (let i = 0; i < n; i++) {
    if (particles.length > 650) particles.shift();
    const a = Math.random() * Math.PI * 2, v = (Math.random() * .7 + .3) * sp;
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, max: .5 + Math.random() * .9, size: size * (.5 + Math.random()), c, grav });
  }
}
function stepParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt / p.max; if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.vy += p.grav; p.x += p.vx; p.y += p.vy;
  }
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const w = shockwaves[i];
    w.r += (w.max - w.r) * .14; if (w.max - w.r < 4) shockwaves.splice(i, 1);
  }
}

// ---------------- gambar ----------------
function drawVideo() {
  ctx.save();
  if (S.shake > .01) ctx.translate((Math.random() - .5) * 16 * S.shake, (Math.random() - .5) * 10 * S.shake);
  if (S.camOn && video.videoWidth) {
    const vw = video.videoWidth, vh = video.videoHeight;
    const s = Math.max(W / vw, H / vh);
    const dw = vw * s, dh = vh * s;
    ctx.translate(W, 0); ctx.scale(-1, 1);
    ctx.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(3,6,13,.42)'; ctx.fillRect(0, 0, W, H); // tint gelap cyber
  } else {
    const g = ctx.createRadialGradient(W / 2, H * .3, 40, W / 2, H * .35, Math.max(W, H));
    g.addColorStop(0, '#0a1a2e'); g.addColorStop(1, '#03060d');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}
function glitchPass() {
  if (S.pulse < .04) return;
  const n = 3 + Math.floor(S.pulse * 9);
  for (let i = 0; i < n; i++) { // iris horizontal digeser (salin dari kanvas sendiri)
    const sy = Math.random() * H, sh = 6 + Math.random() * 46 * S.pulse;
    const dx = (Math.random() - .5) * 90 * S.pulse;
    ctx.drawImage(cv, 0, sy, W, sh, dx, sy, W, sh);
  }
  ctx.save(); // ghost kromatik
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = .16 * S.pulse; ctx.filter = 'hue-rotate(130deg) saturate(2.4)';
  ctx.drawImage(cv, 5 * S.pulse, 0);
  ctx.filter = 'hue-rotate(-130deg) saturate(2.4)';
  ctx.drawImage(cv, -5 * S.pulse, 1);
  ctx.restore(); ctx.filter = 'none';
  if (Math.random() < S.pulse * .6) { // blok noise
    ctx.fillStyle = `rgba(0,240,255,${.05 + .1 * Math.random()})`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 40 + Math.random() * 160, 2 + Math.random() * 8);
  }
}
function scanlines() {
  ctx.fillStyle = 'rgba(0,0,0,.14)';
  for (let y = (S.t * 34) % 4; y < H; y += 4) ctx.fillRect(0, y, W, 1);
  const sy = (S.t * 120) % (H + 160) - 80; // pita pemindaian berjalan
  const g = ctx.createLinearGradient(0, sy - 60, 0, sy + 60);
  g.addColorStop(0, 'rgba(0,240,255,0)'); g.addColorStop(.5, 'rgba(0,240,255,.05)'); g.addColorStop(1, 'rgba(0,240,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, sy - 60, W, 120);
}
function neon(c, blur = 14) { ctx.strokeStyle = c; ctx.shadowColor = c; ctx.shadowBlur = blur; }

function drawSkeleton(h, i) {
  const lm = h.lm;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.lineWidth = 2; neon(MG, 0); ctx.globalAlpha = .55; // ghost magenta bergetar
  const gx = 2.5 + 3 * S.pulse, gy = 1.5;
  ctx.beginPath();
  for (const [a, b] of CONN) { ctx.moveTo(lm[a].x + gx, lm[a].y + gy); ctx.lineTo(lm[b].x + gx, lm[b].y + gy); }
  ctx.stroke();
  ctx.globalAlpha = 1; ctx.lineWidth = 2.4; neon(CY, 12); // utama cyan
  ctx.beginPath();
  for (const [a, b] of CONN) { ctx.moveTo(lm[a].x, lm[a].y); ctx.lineTo(lm[b].x, lm[b].y); }
  ctx.stroke();
  ctx.shadowBlur = 0;
  for (let k = 0; k < 21; k++) { // sendi
    const tip = TIPS.includes(k);
    ctx.fillStyle = tip ? WH : CY;
    ctx.beginPath(); ctx.arc(lm[k].x, lm[k].y, tip ? 4 : 2.5, 0, 7); ctx.fill();
    if (tip) { neon(CY, 10); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(lm[k].x, lm[k].y, 8 + Math.sin(S.t * 5 + k) * 2, 0, 7); ctx.stroke(); ctx.shadowBlur = 0; }
  }
  // penanda handedness kecil di pergelangan
  ctx.fillStyle = 'rgba(0,240,255,.8)'; ctx.font = '10px "Share Tech Mono"';
  ctx.fillText('H' + i + '·' + h.gest.toUpperCase(), lm[0].x + 12, lm[0].y + 16);
  ctx.restore();
}
function drawTrails() {
  ctx.save(); ctx.lineCap = 'round';
  for (const [, arr] of trails) {
    for (let i = 1; i < arr.length; i++) {
      const a = arr[i - 1], b = arr[i], k = i / arr.length;
      ctx.strokeStyle = `rgba(0,240,255,${k * .5})`; ctx.lineWidth = k * 5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }
  ctx.restore();
}
function drawOrb(o) {
  const r = o.r;
  ctx.save();
  const g = ctx.createRadialGradient(o.x, o.y, 1, o.x, o.y, r * 2.2);
  g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(.25, 'rgba(0,240,255,.75)');
  g.addColorStop(.6, 'rgba(255,43,214,.28)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.x, o.y, r * 2.2, 0, 7); ctx.fill();
  neon(CY, 18); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(o.x, o.y, r, 0, 7); ctx.stroke();
  for (let k = 0; k < 2; k++) { // cincin orbit
    ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(S.t * (k ? -1.7 : 2.3) + k);
    ctx.scale(1, .38 + k * .18);
    neon(k ? MG : CY, 10); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.45, 0, 7); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
  if (Math.random() < .5) spawn(o.x + (Math.random() - .5) * r, o.y + (Math.random() - .5) * r, 1, CY, 1.2, -.02, 1.8);
}
function drawShield(h) {
  const lm = h.lm, cx = (lm[0].x + lm[9].x) / 2, cy2 = (lm[0].y + lm[9].y) / 2;
  const R = h.size * 1.35;
  ctx.save(); ctx.translate(cx, cy2);
  ctx.globalAlpha = .9;
  for (let ring = 0; ring < 2; ring++) {
    ctx.save(); ctx.rotate(S.t * (ring ? -.6 : .9));
    neon(ring ? MG : CY, 12); ctx.lineWidth = 1.6;
    ctx.setLineDash(ring ? [4, 10] : [16, 8]);
    ctx.beginPath(); ctx.arc(0, 0, R * (ring ? .8 : 1), 0, 7); ctx.stroke();
    ctx.restore();
  }
  ctx.setLineDash([]);
  ctx.rotate(S.t * .35); neon(CY, 8); ctx.lineWidth = 1.2; // heksagon
  ctx.beginPath();
  for (let k = 0; k <= 6; k++) { const a = k / 6 * Math.PI * 2; const x = Math.cos(a) * R * .62, y = Math.sin(a) * R * .62; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.stroke();
  ctx.globalAlpha = .5; ctx.font = '10px "Share Tech Mono"'; ctx.fillStyle = CY;
  ctx.fillText('SHIELD ' + (100 + Math.floor(20 * Math.sin(S.t * 3))) + '%', R * .7, -R * .7);
  ctx.restore();
}
function drawBolt(a, b) {
  const seg = 16;
  for (let pass = 0; pass < 2; pass++) {
    ctx.save(); neon(pass ? WH : CY, pass ? 6 : 16); ctx.lineWidth = pass ? 1.2 : 2.6;
    ctx.beginPath(); ctx.moveTo(a.x, a.y);
    for (let i = 1; i < seg; i++) {
      const t = i / seg;
      const nx = a.x + (b.x - a.x) * t + (Math.random() - .5) * 34 * Math.sin(t * Math.PI);
      const ny = a.y + (b.y - a.y) * t + (Math.random() - .5) * 34 * Math.sin(t * Math.PI);
      ctx.lineTo(nx, ny);
    }
    ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
  }
  if (Math.random() < .7) { spawn(a.x, a.y, 2, CY, 2.4, .02, 1.8); spawn(b.x, b.y, 2, CY, 2.4, .02, 1.8); }
}
function drawFx(dt) {
  for (const w of shockwaves) {
    ctx.save(); neon(w.c, 16); ctx.lineWidth = 3 * (1 - w.r / w.max) + .5;
    ctx.globalAlpha = 1 - w.r / w.max;
    ctx.beginPath(); ctx.arc(w.x, w.y, w.r, 0, 7); ctx.stroke(); ctx.restore();
  }
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.c;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.restore();
}
function drawIdle() {
  const cx = W / 2, cy2 = H * .46, R = Math.min(W, H) * .2;
  ctx.save(); ctx.translate(cx, cy2);
  for (let k = 0; k < 3; k++) {
    ctx.save(); ctx.rotate(S.t * (.4 + k * .3) * (k % 2 ? -1 : 1));
    neon(k === 1 ? MG : CY, 10); ctx.lineWidth = 1.4; ctx.globalAlpha = .5;
    ctx.setLineDash([26 - k * 6, 18]);
    ctx.beginPath(); ctx.arc(0, 0, R + k * 22, 0, 7); ctx.stroke(); ctx.restore();
  }
  ctx.globalAlpha = .8; ctx.fillStyle = CY; ctx.font = '13px "Share Tech Mono"'; ctx.textAlign = 'center';
  ctx.fillText('[ TUNJUKKAN TANGANMU KE KAMERA ]', 0, R + 66);
  ctx.restore();
}

// ---------------- logika per frame ----------------
function processHands(rawHands) {
  const prev = S.hands;
  S.hands = rawHands.map(lms => {
    const lm = lms.map(p => mapPoint(p.x, p.y));
    return { lm, ...analyzeHand(lm) };
  });
  // trail ujung jari
  const alive = new Set();
  S.hands.forEach((h, i) => TIPS.forEach(t => {
    const key = i + '-' + t; alive.add(key);
    const arr = trails.get(key) || [];
    const lastPt = arr[arr.length - 1];
    if (lastPt && Math.hypot(lastPt.x - h.lm[t].x, lastPt.y - h.lm[t].y) > 170) arr.length = 0; // loncat jauh = trail putus
    arr.push({ x: h.lm[t].x, y: h.lm[t].y });
    if (arr.length > 12) arr.shift();
    trails.set(key, arr);
  }));
  for (const k of trails.keys()) if (!alive.has(k)) trails.delete(k);

  // gesture → efek
  let pulseTarget = 0, label = null, lcolor = CY;
  S.hands.forEach((h, i) => {
    if (h.gest === 'pinch') {
      const mid = { x: (h.lm[4].x + h.lm[8].x) / 2, y: (h.lm[4].y + h.lm[8].y) / 2 };
      if (!orbs[i]) orbs[i] = { x: mid.x, y: mid.y, r: 6, charge: 0 };
      const o = orbs[i];
      o.x += (mid.x - o.x) * .55; o.y += (mid.y - o.y) * .55;
      o.charge = Math.min(1, o.charge + .012);
      o.r = h.size * (.24 + .5 * o.charge) * (1 + .06 * Math.sin(S.t * 9));
      label = 'PINCH.ORB'; lcolor = CY;
    } else if (orbs[i]) { // dilepas → LEDAK
      const o = orbs[i];
      spawn(o.x, o.y, 60 + Math.floor(120 * o.charge), Math.random() < .5 ? CY : MG, 5 + 6 * o.charge, .05, 3);
      shockwaves.push({ x: o.x, y: o.y, r: 6, max: 90 + 240 * o.charge, c: CY });
      S.shake = Math.min(1, .35 + .5 * o.charge);
      orbs[i] = null;
    }
    if (h.gest === 'fist') { pulseTarget = Math.max(pulseTarget, .85); label = 'FIST.OVERLOAD'; lcolor = MG; }
    if (h.gest === 'palm' && !label) { label = 'PALM.SHIELD'; lcolor = CY; }
    // percikan saat jari bergerak cepat
    const pv = prev[i];
    if (pv && pv.lm) {
      const v = d2(h.lm[8], pv.lm[8]);
      if (v > 26) spawn(h.lm[8].x, h.lm[8].y, 2, CY, 2, .04, 2);
    }
  });
  if (S.hands.length === 2 && S.hands[0].indexExt && S.hands[1].indexExt
    && S.hands[0].gest !== 'fist' && S.hands[1].gest !== 'fist') {
    label = 'DUAL.LINK'; lcolor = LM;
  }
  S.pulse += (pulseTarget - S.pulse) * .12;
  S.shake *= .9;
  if (label) setGesture(label, lcolor);
  else if (S.t - S.gestureT > .6) setGesture(null);
}

// ---------------- demo (tangan sintetis) ----------------
const T_OPEN = [[.50,.95],[.38,.86],[.28,.74],[.21,.63],[.15,.54],[.40,.60],[.38,.42],[.37,.28],[.36,.16],[.50,.58],[.50,.38],[.50,.22],[.50,.08],[.60,.60],[.61,.42],[.62,.28],[.63,.16],[.70,.65],[.73,.50],[.75,.38],[.77,.28]];
const T_PINCH = T_OPEN.map((p,i)=>({1:[.36,.84],2:[.27,.72],3:[.22,.60],4:[.225,.485],6:[.33,.46],7:[.26,.40],8:[.235,.47]}[i]||p));
const T_FIST = T_OPEN.map((p,i)=>({2:[.31,.76],3:[.34,.67],4:[.39,.63],6:[.40,.48],7:[.41,.58],8:[.42,.66],10:[.50,.46],11:[.50,.58],12:[.50,.68],14:[.60,.48],15:[.60,.58],16:[.59,.67],18:[.70,.55],19:[.69,.63],20:[.68,.70]}[i]||p));
let demoPose = 'auto', demoT = 0;
function demoHands(dt) {
  demoT += dt;
  const seq = ['open','open','pinch','pinch','pinch','open','fist','fist','open','dual','dual','open'];
  const cur = demoPose === 'auto' ? seq[Math.floor(demoT / 1.4) % seq.length] : demoPose;
  const tpl = cur === 'pinch' ? T_PINCH : cur === 'fist' ? T_FIST : T_OPEN;
  const SZ = .46; // tinggi tangan dalam koordinat ternormalisasi frame
  const mk = (tpl2, cx, cy2, ph) => tpl2.map(([x, y]) => ({
    x: (1 - (cx + (x - .5) * SZ * .72 + Math.sin(demoT * 1.1 + ph + y * 2) * .006)), // di-mirror balik oleh mapPoint
    y: cy2 + (y - .55) * SZ + Math.cos(demoT * .9 + ph) * .012,
  }));
  const baseX = .5 + Math.sin(demoT * .5) * .1, baseY = .52 + Math.cos(demoT * .34) * .05;
  const hands = [mk(tpl, cur === 'dual' ? .30 : baseX, baseY, 0)];
  if (cur === 'dual') hands.push(mk(T_OPEN.map(([x, y]) => [1 - x, y]), .70, baseY + .02, 2));
  return hands;
}

// ---------------- loop ----------------
let lastT = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(.05, (now - lastT) / 1000); lastT = now;
  S.t += dt;
  // deteksi
  let raw = [];
  if (S.demo) raw = demoHands(dt);
  else if (S.ready && S.camOn && video.videoWidth) {
    const t0 = performance.now();
    try { raw = (landmarker.detectForVideo(video, now).landmarks) || []; } catch (e) { raw = []; }
    S.ms = Math.round(performance.now() - t0);
  }
  processHands(raw);
  stepParticles(dt);
  // render
  drawVideo();
  if (S.hands.length === 0 && S.running) drawIdle();
  drawTrails();
  S.hands.forEach((h, i) => { if (h.gest === 'palm') drawShield(h); });
  S.hands.forEach((h, i) => drawSkeleton(h, i));
  orbs.forEach(o => { if (o) drawOrb(o); });
  if (S.hands.length === 2 && S.gestureLabel === 'DUAL.LINK') drawBolt(S.hands[0].lm[8], S.hands[1].lm[8]);
  drawFx(dt);
  glitchPass();
  scanlines();
  // HUD angka
  S._fc++; if (now - S._ft > 500) { S.fps = Math.round(S._fc * 1000 / (now - S._ft)); S._ft = now; S._fc = 0; }
  el('hfps').textContent = S.fps;
  el('hhands').textContent = S.hands.length;
  el('hms').textContent = S.demo ? '0' : (S.ms || '--');
}

// ---------------- UI ----------------
async function begin(withCam) {
  el('bstart').disabled = true;
  el('stat').textContent = withCam ? '> meminta izin kamera…' : '> menyiapkan mode demo…';
  if (withCam) {
    const ok = await startCam();
    if (!ok) {
      S.demo = true; el('bdemo').classList.add('on');
      showBanner('kamera tidak tersedia / ditolak — berjalan di MODE DEMO');
    }
  } else { S.demo = true; el('bdemo').classList.add('on'); }
  el('stat').textContent = '> memuat modul vision…';
  if (!S.demo) await initModel();
  else { el('hstat').textContent = 'DEMO'; initModel(); } // model tetap dimuat di belakang utk siap dipakai
  el('intro').remove();
  S.running = true;
}
function showBanner(msg) { const b = el('banner'); b.textContent = msg; b.style.display = 'block'; setTimeout(() => b.style.display = 'none', 6000); }
el('bstart').addEventListener('click', () => begin(true));
el('bdemostart').addEventListener('click', () => begin(false));
el('bdemo').addEventListener('click', async () => {
  S.demo = !S.demo;
  el('bdemo').classList.toggle('on', S.demo);
  if (!S.demo && !S.camOn) { const ok = await startCam(); if (ok && !S.ready) initModel(); if (!ok) { S.demo = true; el('bdemo').classList.add('on'); showBanner('kamera tidak tersedia — tetap di MODE DEMO'); } }
});
el('bsnap').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = cv.toDataURL('image/png'); a.download = 'handtrace.png'; a.click();
});

// status QA / debug
window.__HT = {
  get ready() { return S.ready; }, get running() { return S.running; },
  get hands() { return S.hands.length; }, get fps() { return S.fps; },
  get gesture() { return S.gestureLabel; }, get demo() { return S.demo; },
  get particles() { return particles.length; },
  setPose(p) { demoPose = p || 'auto'; },
  start(demo = true) { if (el('intro')) begin(!demo); },
};

requestAnimationFrame(loop);
