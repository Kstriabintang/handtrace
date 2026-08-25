// HANDTRACE · mode LUMEN — sihir cahaya yang mengikuti tanganmu (bersih, halus, tanpa glitch).
// Kamera depan → MediaPipe HandLandmarker (on-device) → kamu MENCIPTA:
//   ☝️ telunjuk  = melukis tinta cahaya di udara (goresan tinggal & berdenyut)
//   🤏 pinch     = menetaskan kupu-kupu cahaya (terbang, tertarik ke telunjukmu)
//   ✋ telapak   = galaksi mini berputar di telapak (miring mengikuti tanganmu)
//   ✊ kepal     = gravitasi — menghisap ciptaan; buka tangan = NOVA
//   🙌 dua tangan= benang aurora antar kelima pasang ujung jari
import { FilesetResolver, HandLandmarker } from './vendor/vision_bundle.mjs';

const CONN = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const TIPS = [4, 8, 12, 16, 20];

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const video = document.getElementById('cam');
const el = id => document.getElementById(id);

let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(2, devicePixelRatio || 1);
  W = innerWidth; H = innerHeight;
  cv.width = W * DPR; cv.height = H * DPR;
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
resize(); addEventListener('resize', resize);

// ---------------- glow sprite cache (pengganti shadowBlur — jauh lebih cepat & halus) ----------------
const glowCache = new Map();
function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)].join(',');
}
function glowSprite(hue) {
  const key = hue === 'w' ? 'w' : Math.round(((hue % 360) + 360) % 360 / 12) * 12;
  let c = glowCache.get(key);
  if (!c) {
    c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const col = hue === 'w' ? '255,255,255' : hslToRgb(key, 95, 66);
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, `rgba(${col},1)`);
    rg.addColorStop(.22, `rgba(${col},.55)`);
    rg.addColorStop(.6, `rgba(${col},.13)`);
    rg.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
    glowCache.set(key, c);
  }
  return c;
}
function glow(x, y, size, hue, alpha) {
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.drawImage(glowSprite(hue), x - size / 2, y - size / 2, size, size);
  ctx.globalAlpha = 1;
}
const hsl = (h, s = 100, l = 70, a = 1) => `hsla(${((h % 360) + 360) % 360},${s}%,${l}%,${a})`;

// ---------------- state ----------------
const S = {
  ready: false, running: false, demo: false, camOn: false,
  hands: [], t: 0, fps: 0, ms: 0, _ft: 0, _fc: 0,
  gestureLabel: '', gestureT: 0,
  hueBase: 190,           // rona berjalan: teal → ungu → magenta → kembali
  novaFlash: 0,
};
const smooth = new Map();    // key tangan -> landmark halus (anti-jitter)
const trails = new Map();
const particles = [];        // {x,y,vx,vy,life,max,size,hue,drag}
const rings = [];            // {x,y,r,max,hue,w}
const inks = [];             // goresan: {pts:[{x,y,hue,w}], pulse}
const butterflies = [];      // {x,y,vx,vy,phase,hue,size}
const galaxies = [null, null];
const fists = [null, null];
const pinchSt = [null, null];
let drawSt = [null, null];
const pointFrames = [0, 0];
const lockAnim = new Map();  // key -> waktu terkunci (animasi lock-on)
const LOGQ = [];
function clog(msg) {
  const c = el('console'); if (!c) return;
  LOGQ.push('<i>[' + S.t.toFixed(1).padStart(6, '0') + ']</i> ' + msg);
  if (LOGQ.length > 7) LOGQ.shift();
  c.innerHTML = LOGQ.join('<br>');
}
let landmarker = null;

// ---------------- kamera & model ----------------
async function startCam() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
    });
    video.srcObject = stream; await video.play();
    S.camOn = true; return true;
  } catch (e) { return false; }
}
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
      el('hstat').textContent = 'ONLINE·' + delegate; S.ready = true; return true;
    } catch (e) { }
  }
  el('hstat').textContent = 'GAGAL'; return false;
}
function mapPoint(nx, ny) {
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  const s = Math.max(W / vw, H / vh);
  const ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
  return { x: W - (ox + nx * vw * s), y: oy + ny * vh * s };
}

// ---------------- gesture (dengan histeresis) ----------------
const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const prevGest = ['idle', 'idle'];
function analyzeHand(lm, i) {
  const size = Math.max(30, d2(lm[0], lm[9]));
  const ext = f => d2(lm[f + 3], lm[0]) > d2(lm[f + 1], lm[0]) * 1.12;
  const curled = f => d2(lm[f + 3], lm[0]) < d2(lm[f + 1], lm[0]);
  const fingers = [ext(5), ext(9), ext(13), ext(17)];
  const nExt = fingers.filter(Boolean).length;
  const pinchD = d2(lm[4], lm[8]) / size;
  const fist = curled(5) && curled(9) && curled(13) && curled(17);
  const wasPinch = prevGest[i] === 'pinch';
  let gest = 'idle';
  if (fist) gest = 'fist';
  else if (pinchD < (wasPinch ? .44 : .32)) gest = 'pinch';
  else if (fingers[0] && !fingers[1] && !fingers[2] && !fingers[3]) gest = 'point';
  else if (nExt === 4) gest = 'palm';
  prevGest[i] = gest;
  return { size, gest, pinch: pinchD, indexExt: fingers[0] };
}
function setGesture(label, color) {
  const g = el('gest');
  if (!label) { g.classList.remove('on'); S.gestureLabel = ''; return; }
  if (S.gestureLabel !== label) {
    g.textContent = label;
    g.style.borderColor = color;
    g.style.textShadow = `0 0 16px ${color}`;
    g.classList.remove('on'); void g.offsetWidth; g.classList.add('on');
    S.gestureLabel = label;
    clog('GESTURE <b>' + label + '</b>');
  }
  S.gestureT = S.t;
}

// ---------------- partikel & dunia ----------------
function spawn(x, y, n, hue, sp = 3, drag = .985, size = 3) {
  for (let k = 0; k < n; k++) {
    if (particles.length > 900) particles.shift();
    const a = Math.random() * Math.PI * 2, v = (Math.random() * .75 + .25) * Math.abs(sp);
    const dirIn = sp < 0 ? -1 : 1;
    particles.push({ x, y, vx: Math.cos(a) * v * dirIn, vy: Math.sin(a) * v * dirIn, life: 1, max: .6 + Math.random() * 1.1, size: size * (.5 + Math.random()), hue: hue + (Math.random() - .5) * 40, drag });
  }
}
function stepWorld(dt, fistPulls) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt / p.max; if (p.life <= 0) { particles.splice(i, 1); continue; }
    for (const f of fistPulls) { const dx = f.x - p.x, dy = f.y - p.y, dd = Math.hypot(dx, dy) + 20; p.vx += dx / dd * 1.6; p.vy += dy / dd * 1.6; }
    p.vx *= p.drag; p.vy *= p.drag; p.x += p.vx; p.y += p.vy;
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i]; r.r += (r.max - r.r) * .12; if (r.max - r.r < 3) rings.splice(i, 1);
  }
  // kupu-kupu: mengembara + tertarik lembut ke telunjuk + dihisap kepalan
  const targets = S.hands.filter(h => h.indexExt).map(h => h.lm[8]);
  for (let i = butterflies.length - 1; i >= 0; i--) {
    const b = butterflies[i];
    b.phase += dt * (8 + 3 * Math.sin(i * 1.7));
    b.vx += Math.sin(S.t * 1.7 + i * 2.1) * .07; b.vy += Math.cos(S.t * 1.3 + i * 1.7) * .07;
    if (targets.length) {
      let tg = targets[0], best = 1e9;
      for (const t of targets) { const dd = d2(b, t); if (dd < best) { best = dd; tg = t; } }
      if (best > 70) { b.vx += (tg.x - b.x) / best * 1.1; b.vy += (tg.y - b.y) / best * 1.1; }
      else { b.vx -= (tg.x - b.x) / best * .5; b.vy -= (tg.y - b.y) / best * .5; }
    }
    let eaten = false;
    for (const f of fistPulls) {
      const dx = f.x - b.x, dy = f.y - b.y, dd = Math.hypot(dx, dy);
      b.vx += dx / (dd + 10) * 3.2; b.vy += dy / (dd + 10) * 3.2;
      if (dd < 34) { spawn(b.x, b.y, 10, b.hue, 2.4); f.charge = Math.min(1, f.charge + .12); eaten = true; }
    }
    if (eaten) { butterflies.splice(i, 1); continue; }
    b.vx = Math.max(-4.5, Math.min(4.5, b.vx)); b.vy = Math.max(-4.5, Math.min(4.5, b.vy));
    b.x += b.vx; b.y += b.vy;
    if (b.x < -40) b.x = W + 40; if (b.x > W + 40) b.x = -40;
    if (b.y < -40) b.y = H + 40; if (b.y > H + 40) b.y = -40;
    if (Math.random() < .1) spawn(b.x, b.y, 1, b.hue, .5, .97, 1.6); // serbuk sayap
  }
}

// ---------------- hujan digital (latar hacker, lembut) ----------------
const GLYPHS = 'アイウエオカキクケコサシスセソタチツテト0123456789ABCDEF<>/#$+*=';
let rainCv = null, rainCtx = null, rainDrops = null, rainW = 0, rainH = 0, rainTick = 0;
function initRain() {
  rainW = Math.ceil(W / 2); rainH = Math.ceil(H / 2);
  rainCv = document.createElement('canvas'); rainCv.width = rainW; rainCv.height = rainH;
  rainCtx = rainCv.getContext('2d');
  rainCtx.fillStyle = '#020609'; rainCtx.fillRect(0, 0, rainW, rainH);
  const cols = Math.ceil(rainW / 13);
  rainDrops = Array.from({ length: cols }, () => Math.random() * rainH / 14);
}
function stepRain() {
  if (!rainCv || rainCv.width !== Math.ceil(W / 2)) initRain();
  if (rainTick++ % 2) return;                       // separuh frame-rate = hemat & tetap mulus
  rainCtx.fillStyle = 'rgba(2,6,9,.12)'; rainCtx.fillRect(0, 0, rainW, rainH);
  rainCtx.font = '12px "Share Tech Mono"';
  for (let c = 0; c < rainDrops.length; c++) {
    const x = c * 13, y = rainDrops[c] * 14;
    rainCtx.fillStyle = 'rgba(140,255,180,.9)';
    rainCtx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], x, y);
    rainCtx.fillStyle = 'rgba(57,255,120,.35)';
    rainCtx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], x, y - 14);
    rainDrops[c] += .55 + (c % 5) * .09;
    if (y > rainH && Math.random() < .03) rainDrops[c] = 0;
  }
}
// ---------------- render ----------------
function drawVideo() {
  if (S.camOn && video.videoWidth) {
    const vw = video.videoWidth, vh = video.videoHeight;
    const s = Math.max(W / vw, H / vh), dw = vw * s, dh = vh * s;
    ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1);
    ctx.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.restore();
    ctx.fillStyle = 'rgba(5,8,16,.46)'; ctx.fillRect(0, 0, W, H);
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .34, W / 2, H / 2, Math.max(W, H) * .75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(2,4,10,.55)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    if (rainCv) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .16; ctx.drawImage(rainCv, 0, 0, W, H); ctx.restore(); }
  } else {
    const g = ctx.createRadialGradient(W / 2, H * .3, 40, W / 2, H * .4, Math.max(W, H));
    g.addColorStop(0, '#0b1526'); g.addColorStop(1, '#04070e');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (rainCv) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .22; ctx.drawImage(rainCv, 0, 0, W, H); ctx.restore(); }
  }
  if (S.novaFlash > .01) { ctx.fillStyle = `rgba(255,244,214,${S.novaFlash * .5})`; ctx.fillRect(0, 0, W, H); }
}
function drawHandConstellation(h) {
  const lm = h.lm;
  ctx.save(); ctx.lineCap = 'round';
  // cincin rune di pergelangan (hacker-sigil, ikut ukuran tangan)
  const wr = h.size * .5;
  ctx.save(); ctx.translate(lm[0].x, lm[0].y); ctx.rotate(S.t * .8);
  ctx.strokeStyle = 'rgba(57,255,120,.4)'; ctx.lineWidth = 1; ctx.setLineDash([7, 9]);
  ctx.beginPath(); ctx.arc(0, 0, wr, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(140,255,180,.75)'; ctx.font = '9px "Share Tech Mono"'; ctx.textAlign = 'center';
  for (let g2 = 0; g2 < 4; g2++) {
    const a2 = g2 / 4 * Math.PI * 2 + S.t * .8;
    ctx.fillText(GLYPHS[(g2 * 7 + Math.floor(S.t * 2)) % GLYPHS.length], Math.cos(a2) * wr, Math.sin(a2) * wr + 3);
  }
  ctx.textAlign = 'left'; ctx.restore();
  // animasi LOCK-ON saat tangan baru terdeteksi
  const lt = lockAnim.get(h.key);
  if (lt !== undefined && S.t - lt < .8) {
    const k2 = (S.t - lt) / .8, R2 = h.size * (2.6 - 1.6 * k2);
    const cx2 = (lm[0].x + lm[9].x) / 2, cyy = (lm[0].y + lm[9].y) / 2;
    ctx.save(); ctx.translate(cx2, cyy); ctx.rotate(k2 * 1.2);
    ctx.strokeStyle = `rgba(57,255,120,${.9 - k2 * .5})`; ctx.lineWidth = 1.6;
    for (let q2 = 0; q2 < 4; q2++) { ctx.save(); ctx.rotate(q2 * Math.PI / 2); ctx.beginPath(); ctx.arc(0, 0, R2, -.4, .4); ctx.stroke(); ctx.restore(); }
    ctx.fillStyle = `rgba(140,255,180,${.9 - k2 * .6})`; ctx.font = '10px "Share Tech Mono"';
    ctx.fillText('LOCK ' + Math.min(100, Math.round(k2 * 140)) + '%', R2 * .74, -R2 * .74);
    ctx.restore();
  }
  // koordinat telunjuk dalam HEX (targeting computer)
  ctx.fillStyle = 'rgba(140,255,180,.8)'; ctx.font = '9.5px "Share Tech Mono"';
  ctx.fillText('0x' + Math.max(0, Math.round(lm[8].x)).toString(16).toUpperCase().padStart(3, '0')
    + ',0x' + Math.max(0, Math.round(lm[8].y)).toString(16).toUpperCase().padStart(3, '0'), lm[8].x + 13, lm[8].y - 11);
  ctx.strokeStyle = 'rgba(255,255,255,.30)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [a, b] of CONN) { ctx.moveTo(lm[a].x, lm[a].y); ctx.lineTo(lm[b].x, lm[b].y); }
  ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 21; k++) {
    const tip = TIPS.includes(k);
    glow(lm[k].x, lm[k].y, tip ? 26 : 12, tip ? 45 : 'w', tip ? .8 : .4);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(lm[k].x, lm[k].y, tip ? 2.6 : 1.5, 0, 7); ctx.fill();
  }
  ctx.restore();
}
function drawTrails() {
  ctx.save(); ctx.lineCap = 'round'; ctx.globalCompositeOperation = 'lighter';
  for (const [key, arr] of trails) {
    const hue = S.hueBase + (+key.split('-')[1]) * 9;
    for (let i = 1; i < arr.length; i++) {
      const a = arr[i - 1], b = arr[i], k = i / arr.length;
      ctx.strokeStyle = hsl(hue, 90, 70, k * .5); ctx.lineWidth = k * 4;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    if (arr.length) { const p = arr[arr.length - 1]; glow(p.x, p.y, 18, hue, .5); }
  }
  ctx.restore();
}
// TINTA CAHAYA — kaligrafi bercahaya yang tinggal di udara
function drawInks() {
  if (!inks.length) return;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const ink of inks) {
    const pts = ink.pts; if (pts.length < 2) continue;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i], q = pts[i - 1];
      ctx.strokeStyle = hsl(p.hue + S.t * 10, 95, 62, .30);
      ctx.lineWidth = p.w * 3.2;
      ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i], q = pts[i - 1];
      ctx.strokeStyle = hsl(p.hue + S.t * 10, 100, 82, .95);
      ctx.lineWidth = p.w;
      ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    }
    ink.pulse = (ink.pulse + .004 + .25 / pts.length) % 1;      // denyut berjalan di goresan
    const pp = pts[Math.floor(ink.pulse * (pts.length - 1))];
    ctx.globalCompositeOperation = 'lighter';
    glow(pp.x, pp.y, 30, pp.hue + S.t * 10, .9);
  }
  ctx.restore();
}
function inkAdd(i, x, y, speed) {
  let ink = drawSt[i];
  if (!ink) { ink = { pts: [], pulse: Math.random() }; drawSt[i] = ink; inks.push(ink); }
  const last = ink.pts[ink.pts.length - 1];
  if (last && d2(last, { x, y }) < 3) return;
  const w = Math.max(1.6, 6.5 - speed * .09);                   // pelan = tebal (kaligrafi)
  if (last) {                                                    // subdivisi: segmen jauh dihaluskan
    const dd = d2(last, { x, y });
    const steps = Math.min(6, Math.floor(dd / 14));
    for (let st2 = 1; st2 <= steps; st2++) {
      const t2 = st2 / (steps + 1);
      ink.pts.push({ x: last.x + (x - last.x) * t2, y: last.y + (y - last.y) * t2, hue: S.hueBase, w });
    }
  }
  ink.pts.push({ x, y, hue: S.hueBase, w });
  if (Math.random() < .3) spawn(x, y, 1, S.hueBase, .8, .96, 1.6);
  let total = 0; for (const s of inks) total += s.pts.length;
  while (total > 2600) { const s0 = inks[0]; s0.pts.shift(); total--; if (!s0.pts.length) inks.shift(); }
}
// KUPU-KUPU CAHAYA
function hatch(x, y, hue, n = 2) {
  for (let k = 0; k < n; k++) {
    if (butterflies.length > 22) { const old = butterflies.shift(); spawn(old.x, old.y, 14, old.hue, 3); }
    butterflies.push({ x: x + (Math.random() - .5) * 20, y: y + (Math.random() - .5) * 20, vx: (Math.random() - .5) * 3, vy: -1 - Math.random() * 2, phase: Math.random() * 7, hue: hue + (Math.random() - .5) * 60, size: 9 + Math.random() * 7 });
  }
}
function drawButterflies() {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const b of butterflies) {
    const dir = Math.atan2(b.vy, b.vx);
    const flap = Math.sin(b.phase);
    const wing = Math.abs(flap) * b.size, lift = flap * b.size * .35;
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(dir + Math.PI / 2);
    ctx.fillStyle = hsl(b.hue, 95, 70, .5);
    for (const sd of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(sd * wing * .9, -b.size * .8 + lift, sd * wing * 1.5, b.size * .1 + lift, 0, b.size * .42);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    glow(b.x, b.y, b.size * 2.6, b.hue, .75);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(b.x, b.y, 1.6, 0, 7); ctx.fill();
  }
  ctx.restore();
}
// GALAKSI TELAPAK
function makeGalaxy() {
  const stars = [];
  for (let i = 0; i < 110; i++) {
    const arm = i % 2, r = Math.pow(Math.random(), .7);
    stars.push({ a: r * 4.2 + arm * Math.PI + (Math.random() - .5) * .55, r, sp: .9 / (r + .28), size: 2 + Math.random() * 3.4, hue: 190 + r * 130 + (Math.random() - .5) * 30 });
  }
  return { k: 0, rot: 0, stars };
}
function drawGalaxy(g, h) {
  const lm = h.lm;
  const cx = (lm[0].x + lm[9].x * 2) / 3, cy2 = (lm[0].y + lm[9].y * 2) / 3 - h.size * .35;
  const R = h.size * 1.25 * g.k;
  const tilt = Math.atan2(lm[17].y - lm[5].y, lm[17].x - lm[5].x);
  g.rot += .012;
  ctx.save(); ctx.translate(cx, cy2); ctx.rotate(tilt);
  ctx.globalCompositeOperation = 'lighter';
  glow(0, 0, R * 1.5, 48, .5 * g.k);
  glow(0, 0, R * .5, 'w', .9 * g.k);
  for (const st of g.stars) {
    const a = st.a + g.rot * st.sp * 3;
    const x = Math.cos(a) * st.r * R, y = Math.sin(a) * st.r * R * .42;
    glow(x, y, st.size * 3.2, st.hue, .75 * g.k);
  }
  ctx.restore();
  if (Math.random() < .25 * g.k) {
    const a = Math.random() * 7;
    spawn(cx + Math.cos(a) * R, cy2 + Math.sin(a) * R * .42, 1, 220 + Math.random() * 100, .6, .97, 1.6);
  }
}
// GRAVITASI & NOVA
function drawFist(f) {
  ctx.save();
  ctx.fillStyle = 'rgba(2,4,10,.9)';
  ctx.beginPath(); ctx.arc(f.x, f.y, 16 + 8 * f.charge, 0, 7); ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 3; k++) {
    ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(S.t * (1.2 + k * .7) * (k % 2 ? -1 : 1));
    ctx.strokeStyle = hsl(265 + k * 25, 90, 70, .5 + .3 * f.charge);
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.ellipse(0, 0, 26 + k * 12 + 10 * f.charge, (26 + k * 12) * .38, 0, 0, 7); ctx.stroke();
    ctx.restore();
  }
  glow(f.x, f.y, 90 + 60 * f.charge, 275, .4 + .4 * f.charge);
  ctx.restore();
  if (Math.random() < .6) { const a = Math.random() * 7, rr = 60 + Math.random() * 60; spawn(f.x + Math.cos(a) * rr, f.y + Math.sin(a) * rr, 1, 275, .3, .9, 2); }
}
function nova(x, y, charge) {
  rings.push({ x, y, r: 8, max: 160 + 340 * charge, hue: 48, w: 4 });
  rings.push({ x, y, r: 4, max: 90 + 200 * charge, hue: 300, w: 2 });
  spawn(x, y, 90 + Math.floor(160 * charge), 45, 6 + 7 * charge, .975, 3.2);
  hatch(x, y, S.hueBase, 1 + Math.round(2 * charge));  // nova pun melahirkan kupu-kupu
  S.novaFlash = .5 + .4 * charge;
}
// BENANG AURORA
function drawAurora(a, b) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  for (let f = 0; f < TIPS.length; f++) {
    const p = a.lm[TIPS[f]], q = b.lm[TIPS[f]];
    const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
    const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const sway = Math.sin(S.t * 1.6 + f * 1.3) * (26 + len * .06);
    const cxp = mx + nx * sway, cyp = my + ny * sway;
    const hue = S.hueBase + f * 26;
    for (const [wdt, alp, l2] of [[9, .10, 60], [3.5, .3, 68], [1.4, .85, 85]]) {
      ctx.strokeStyle = hsl(hue, 95, l2, alp);
      ctx.lineWidth = wdt;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.quadraticCurveTo(cxp, cyp, q.x, q.y); ctx.stroke();
    }
    const u = (S.t * .25 + f * .19) % 1;
    const bx = (1 - u) * (1 - u) * p.x + 2 * (1 - u) * u * cxp + u * u * q.x;
    const by = (1 - u) * (1 - u) * p.y + 2 * (1 - u) * u * cyp + u * u * q.y;
    glow(bx, by, 22, hue, .9);
  }
  ctx.restore();
}
function drawFx() {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const r of rings) {
    ctx.strokeStyle = hsl(r.hue, 95, 72, Math.max(0, 1 - r.r / r.max));
    ctx.lineWidth = r.w * (1 - r.r / r.max) + .6;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, 7); ctx.stroke();
  }
  for (const p of particles) glow(p.x, p.y, p.size * 3.4, p.hue, Math.max(0, p.life) * .85);
  ctx.restore();
}
function drawIdle() {
  const cx = W / 2, cy2 = H * .45, R = Math.min(W, H) * .17;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 3; k++) {
    const rr = R + k * 26 + Math.sin(S.t * 1.4 + k) * 6;
    ctx.strokeStyle = hsl(S.hueBase + k * 40, 80, 70, .28);
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(cx, cy2, rr, 0, 7); ctx.stroke();
  }
  glow(cx, cy2, 60 + Math.sin(S.t * 2) * 12, S.hueBase, .5);
  if (Math.random() < .3) spawn(cx + (Math.random() - .5) * R * 2, cy2 + (Math.random() - .5) * R * 2, 1, S.hueBase, .4, .985, 1.6);
  ctx.restore();
  ctx.fillStyle = 'rgba(230,240,255,.8)'; ctx.font = '13px "Share Tech Mono"'; ctx.textAlign = 'center';
  ctx.fillText('[ TUNJUKKAN TANGANMU — LALU MENCIPTALAH ]', cx, cy2 + R + 62);
  ctx.textAlign = 'left';
}

// ---------------- logika per frame ----------------
function processHands(rawHands, keys) {
  S.hands = rawHands.map((lms, i) => {
    const key = keys[i] || ('h' + i);
    const mapped = lms.map(p => mapPoint(p.x, p.y));
    let sm = smooth.get(key);
    if (!sm) {
      sm = { p: mapped.map(p => ({ ...p })), v: mapped.map(() => ({ x: 0, y: 0 })) };
      lockAnim.set(key, S.t); clog('HAND[' + key + '] LOCK · 21 nodes');
    }
    const lm = new Array(21);
    for (let k = 0; k < 21; k++) {
      // filter GESIT: diam = halus, bergerak = nyaris tanpa jeda…
      const sp = d2(sm.p[k], mapped[k]);
      const a = Math.min(1, .5 + sp * .09);
      const nx = sm.p[k].x + (mapped[k].x - sm.p[k].x) * a;
      const ny = sm.p[k].y + (mapped[k].y - sm.p[k].y) * a;
      sm.v[k].x = sm.v[k].x * .5 + (nx - sm.p[k].x) * .5;
      sm.v[k].y = sm.v[k].y * .5 + (ny - sm.p[k].y) * .5;
      sm.p[k].x = nx; sm.p[k].y = ny;
      // …plus PREDIKSI: efek sedikit MENDAHULUI jari (terasa menempel)
      lm[k] = { x: nx + sm.v[k].x * .55, y: ny + sm.v[k].y * .55 };
    }
    smooth.set(key, sm);
    return { key, lm, ...analyzeHand(lm, i) };
  });
  for (const k of [...smooth.keys()]) if (!S.hands.some(h => h.key === k)) { smooth.delete(k); lockAnim.delete(k); clog('HAND[' + k + '] SIGNAL LOST'); }

  const alive = new Set();
  S.hands.forEach((h, i) => TIPS.forEach(t => {
    const key = i + '-' + t; alive.add(key);
    const arr = trails.get(key) || [];
    const last = arr[arr.length - 1];
    if (last && d2(last, h.lm[t]) > 170) arr.length = 0;
    arr.push({ x: h.lm[t].x, y: h.lm[t].y });
    if (arr.length > 18) arr.shift();
    trails.set(key, arr);
  }));
  for (const k of trails.keys()) if (!alive.has(k)) trails.delete(k);

  let label = null, lcolor = '#7ce8ff';
  const fistPulls = [];
  S.hands.forEach((h, i) => {
    // debounce kuas: gestur point harus stabil beberapa frame (hindari coretan nyasar saat transisi)
    pointFrames[i] = h.gest === 'point' ? pointFrames[i] + 1 : 0;
    if (h.gest === 'point' && pointFrames[i] >= 4) {   // ☝️ melukis
      const tip = h.lm[8];
      const spd = drawSt[i] && drawSt[i].pts.length ? d2(drawSt[i].pts[drawSt[i].pts.length - 1], tip) : 0;
      inkAdd(i, tip.x, tip.y, spd);
      label = 'MELUKIS CAHAYA'; lcolor = hsl(S.hueBase);
    } else drawSt[i] = null;
    if (h.gest === 'pinch') {                          // 🤏 mencipta
      const mid = { x: (h.lm[4].x + h.lm[8].x) / 2, y: (h.lm[4].y + h.lm[8].y) / 2 };
      if (!pinchSt[i]) pinchSt[i] = { x: mid.x, y: mid.y, charge: 0 };
      const o = pinchSt[i];
      o.x += (mid.x - o.x) * .75; o.y += (mid.y - o.y) * .75;
      o.charge = Math.min(1, o.charge + .014);
      label = 'MENCIPTA…'; lcolor = '#ffd98a';
    } else if (pinchSt[i]) {                           // lepas = kupu-kupu lahir
      clog('SPAWN butterfly ×' + (1 + Math.round(pinchSt[i].charge * 2)));
      hatch(pinchSt[i].x, pinchSt[i].y, S.hueBase, 1 + Math.round(pinchSt[i].charge * 2));
      spawn(pinchSt[i].x, pinchSt[i].y, 24, S.hueBase, 3);
      rings.push({ x: pinchSt[i].x, y: pinchSt[i].y, r: 4, max: 70, hue: S.hueBase, w: 2 });
      pinchSt[i] = null;
    }
    if (h.gest === 'palm') {                           // ✋ galaksi
      if (!galaxies[i]) galaxies[i] = makeGalaxy();
      galaxies[i].k = Math.min(1, galaxies[i].k + .03);
      if (!label) { label = 'GALAKSI TELAPAK'; lcolor = '#b18cff'; }
    } else if (galaxies[i]) {
      galaxies[i].k -= .06;
      if (galaxies[i].k <= 0) galaxies[i] = null;
    }
    if (h.gest === 'fist') {                           // ✊ gravitasi
      const c = { x: (h.lm[9].x + h.lm[0].x) / 2, y: (h.lm[9].y + h.lm[0].y) / 2 };
      if (!fists[i]) fists[i] = { x: c.x, y: c.y, charge: 0 };
      fists[i].x = c.x; fists[i].y = c.y;
      fists[i].charge = Math.min(1, fists[i].charge + .008);
      fistPulls.push(fists[i]);
      label = 'GRAVITASI'; lcolor = '#c9a6ff';
      for (let s = inks.length - 1; s >= 0; s--) {     // menghisap tinta dari ujung goresan
        const pts = inks[s].pts;
        let bite = 0;
        while (pts.length && bite < 5 && d2(pts[pts.length - 1], fists[i]) < 150) {
          const p = pts.pop(); spawn(p.x, p.y, 1, p.hue, 2, .95, 2); fists[i].charge = Math.min(1, fists[i].charge + .004); bite++;
        }
        while (pts.length && bite < 5 && d2(pts[0], fists[i]) < 150) {
          const p = pts.shift(); spawn(p.x, p.y, 1, p.hue, 2, .95, 2); fists[i].charge = Math.min(1, fists[i].charge + .004); bite++;
        }
        if (!pts.length) inks.splice(s, 1);
      }
    } else if (fists[i]) { clog('NOVA charge=' + fists[i].charge.toFixed(2)); nova(fists[i].x, fists[i].y, fists[i].charge); fists[i] = null; }
  });
  if (S.hands.length === 2 && !S.hands.some(h => h.gest === 'fist' || h.gest === 'pinch')) {
    label = 'BENANG AURORA'; lcolor = '#8affd9';       // 🙌
  }
  S.novaFlash *= .86;
  if (label) setGesture(label, lcolor);
  else if (S.t - S.gestureT > .6) setGesture(null);
  return fistPulls;
}

// ---------------- demo (tangan sintetis) ----------------
const T_OPEN = [[.50,.95],[.38,.86],[.28,.74],[.21,.63],[.15,.54],[.40,.60],[.38,.42],[.37,.28],[.36,.16],[.50,.58],[.50,.38],[.50,.22],[.50,.08],[.60,.60],[.61,.42],[.62,.28],[.63,.16],[.70,.65],[.73,.50],[.75,.38],[.77,.28]];
const T_PINCH = T_OPEN.map((p,i)=>({1:[.36,.84],2:[.27,.72],3:[.22,.60],4:[.225,.485],6:[.33,.46],7:[.26,.40],8:[.235,.47]}[i]||p));
const T_FIST = T_OPEN.map((p,i)=>({2:[.31,.76],3:[.34,.67],4:[.39,.63],6:[.40,.48],7:[.41,.58],8:[.42,.66],10:[.50,.46],11:[.50,.58],12:[.50,.68],14:[.60,.48],15:[.60,.58],16:[.59,.67],18:[.70,.55],19:[.69,.63],20:[.68,.70]}[i]||p));
const T_POINT = T_OPEN.map((p,i)=>({2:[.30,.78],3:[.34,.70],4:[.40,.66],10:[.50,.46],11:[.50,.58],12:[.50,.68],14:[.60,.48],15:[.60,.58],16:[.59,.67],18:[.70,.55],19:[.69,.63],20:[.68,.70]}[i]||p));
let demoPose = 'auto', demoT = 0;
function demoHands(dt) {
  demoT += dt;
  const seq = ['point','point','point','open','pinch','pinch','open','palm','palm','open','fist','fist','open','dual','dual','open'];
  const cur = demoPose === 'auto' ? seq[Math.floor(demoT / 1.5) % seq.length] : demoPose;
  const tpl = cur === 'pinch' ? T_PINCH : cur === 'fist' ? T_FIST : cur === 'point' ? T_POINT : T_OPEN;
  const SZ = .46;
  const mk = (tpl2, cx, cy2, ph) => tpl2.map(([x, y]) => ({
    x: (1 - (cx + (x - .5) * SZ * .72 + Math.sin(demoT * 1.1 + ph + y * 2) * .006)),
    y: cy2 + (y - .55) * SZ + Math.cos(demoT * .9 + ph) * .012,
  }));
  const drawing = cur === 'point';
  const baseX = .5 + Math.sin(demoT * (drawing ? 1.1 : .5)) * (drawing ? .16 : .1);
  const baseY = .52 + Math.cos(demoT * (drawing ? .8 : .34)) * (drawing ? .1 : .05);
  const hands = [mk(tpl, cur === 'dual' ? .30 : baseX, baseY, 0)];
  if (cur === 'dual') hands.push(mk(T_OPEN.map(([x, y]) => [1 - x, y]), .70, baseY + .02, 2));
  return hands;
}

// ---------------- loop ----------------
let lastT = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(.05, (now - lastT) / 1000); lastT = now;
  S.t += dt; S.hueBase += dt * 14;
  let raw = [], keys = [];
  if (S.demo) { raw = demoHands(dt); keys = raw.map((_, i) => 'demo' + i); }
  else if (S.ready && S.camOn && video.videoWidth) {
    const t0 = performance.now();
    try {
      const res = landmarker.detectForVideo(video, now);
      raw = res.landmarks || [];
      keys = raw.map((_, i) => (res.handednesses && res.handednesses[i] && res.handednesses[i][0]) ? res.handednesses[i][0].categoryName : 'h' + i);
    } catch (e) { raw = []; }
    S.ms = Math.round(performance.now() - t0);
  }
  const fistPulls = processHands(raw, keys);
  stepWorld(dt, fistPulls);
  stepRain();

  drawVideo();
  if (S.hands.length === 0 && S.running && butterflies.length === 0 && inks.length === 0) drawIdle();
  drawInks();
  drawTrails();
  S.hands.forEach((h, i) => { if (galaxies[i]) drawGalaxy(galaxies[i], h); });
  S.hands.forEach(h => drawHandConstellation(h));
  if (S.gestureLabel === 'BENANG AURORA' && S.hands.length === 2) drawAurora(S.hands[0], S.hands[1]);
  pinchSt.forEach(o => {                               // kepompong cahaya saat mencipta
    if (o) {
      glow(o.x, o.y, 46 + 40 * o.charge, S.hueBase, .8); glow(o.x, o.y, 18, 'w', .9);
      if (Math.random() < .5) spawn(o.x + (Math.random() - .5) * 50, o.y + (Math.random() - .5) * 50, 1, S.hueBase, -.8, .9, 1.6);
    }
  });
  fists.forEach(f => { if (f) drawFist(f); });
  drawButterflies();
  drawFx();

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
    if (!ok) { S.demo = true; el('bdemo').classList.add('on'); showBanner('kamera tidak tersedia / ditolak — berjalan di MODE DEMO'); }
  } else { S.demo = true; el('bdemo').classList.add('on'); }
  el('stat').textContent = '> memuat modul vision…';
  clog('trace.core <b>init</b>'); clog('vision.wasm loading…');
  if (!S.demo) await initModel();
  else { el('hstat').textContent = 'DEMO'; initModel(); }
  clog('vision.module <b>' + el('hstat').textContent + '</b>');
  el('intro').remove();
  S.running = true;
}
function showBanner(msg) { const b = el('banner'); b.textContent = msg; b.style.display = 'block'; setTimeout(() => b.style.display = 'none', 6000); }
el('bstart').addEventListener('click', () => begin(true));
el('bdemostart').addEventListener('click', () => begin(false));
el('bdemo').addEventListener('click', async () => {
  S.demo = !S.demo;
  el('bdemo').classList.toggle('on', S.demo);
  if (!S.demo && !S.camOn) {
    const ok = await startCam();
    if (ok && !S.ready) initModel();
    if (!ok) { S.demo = true; el('bdemo').classList.add('on'); showBanner('kamera tidak tersedia — tetap di MODE DEMO'); }
  }
});
el('bclear').addEventListener('click', () => {
  for (const s of inks) for (const p of s.pts) if (Math.random() < .2) spawn(p.x, p.y, 1, p.hue, 2);
  inks.length = 0; drawSt = [null, null];
  for (const b of butterflies) spawn(b.x, b.y, 8, b.hue, 2.6);
  butterflies.length = 0;
});
el('bsnap').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = cv.toDataURL('image/png'); a.download = 'handtrace-lumen.png'; a.click();
});

// status QA / debug
window.__HT = {
  get ready() { return S.ready; }, get running() { return S.running; },
  get hands() { return S.hands.length; }, get fps() { return S.fps; },
  get gesture() { return S.gestureLabel; }, get demo() { return S.demo; },
  get particles() { return particles.length; },
  get butterflies() { return butterflies.length; },
  get inkPoints() { let n = 0; for (const s of inks) n += s.pts.length; return n; },
  setPose(p) { demoPose = p || 'auto'; },
  start(demo = true) { if (el('intro')) begin(!demo); },
};
requestAnimationFrame(loop);
