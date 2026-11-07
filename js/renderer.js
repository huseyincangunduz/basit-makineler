/**
 * Basit Makineler: HTML5 Canvas Çizim Motoru
 * Dişli çarklar, eş merkezli (üst üste) katmanlar, düz/çapraz kayış teğetleri ve asılı yükleri çizer.
 */

import { state, BASE_R, TEETH_PER_R, getAxleById, getWheelById, getWheelsOnAxle } from './state.js';
import { absFracString, computeLoadMovement } from './physics.js';

export function renderScene(canvas, ctx, hoverInfo = null) {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
  }

  const isDark = isDarkModeActive();
  ctx.save();
  ctx.scale(dpr, dpr);

  // 1. Arka Plan ve Mühendislik Izgarası
  ctx.fillStyle = isDark ? '#0f172a' : '#f1f5f9';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(width / 2 + state.camera.x, height / 2 + state.camera.y);
  ctx.scale(state.camera.zoom, state.camera.zoom);

  drawGrid(ctx, width, height, isDark);

  // 2. Dişli Temas Noktası (Mesh) Vurguları (Alt Katman)
  for (const pair of state.kinematics.meshedPairs) {
    drawMeshContactHighlight(ctx, pair.wheelA, pair.wheelB, isDark);
  }

  // 3. Çarkları ve Kasnakları Çiz (Her milde büyük yarıçap altta, küçük yarıçap üstte)
  for (const axle of state.axles) {
    const wheels = getWheelsOnAxle(axle.id); // Büyükten küçüğe sıralı
    for (const wheel of wheels) {
      const isSelected = state.selectedWheelId === wheel.id || state.selectedAxleId === axle.id;
      const isBeltSource = state.beltStartWheelId === wheel.id;
      drawWheel(ctx, axle, wheel, isSelected, isBeltSource, isDark);
    }
  }

  // 4. Kayış Bağlantılarını Çiz (Çarkların üzerinde teğet olarak görünsün)
  for (const belt of state.belts) {
    drawBelt(ctx, belt, isDark);
  }

  // 5. Asılı Yükleri (Ağırlık / İp) Çiz
  for (const load of state.loads) {
    drawHangingLoad(ctx, load, isDark);
  }

  // 6. Mil Merkezlerini, Etiketleri ve Dönüş Oklarını Çiz (En Üst Katman)
  for (const axle of state.axles) {
    drawAxleCenterAndOverlays(ctx, axle, isDark);
  }

  // 7. Etkileşimli Önizleme (Kayış bağlama veya yeni çark ekleme önizlemesi)
  if (hoverInfo) {
    drawInteractionPreview(ctx, hoverInfo, isDark);
  }

  ctx.restore();
  ctx.restore();
}

export function isDarkModeActive() {
  const explicitTheme = document.documentElement.getAttribute('data-theme');
  if (explicitTheme === 'dark') return true;
  if (explicitTheme === 'light') return false;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function drawGrid(ctx, width, height, isDark) {
  const step = BASE_R; // Her kare tam 1r boyunda!
  const halfW = (width / state.camera.zoom) + Math.abs(state.camera.x / state.camera.zoom) + step * 4;
  const halfH = (height / state.camera.zoom) + Math.abs(state.camera.y / state.camera.zoom) + step * 4;

  const startX = -Math.ceil(halfW / step) * step;
  const endX = Math.ceil(halfW / step) * step;
  const startY = -Math.ceil(halfH / step) * step;
  const endY = Math.ceil(halfH / step) * step;

  ctx.lineWidth = 1 / state.camera.zoom;
  ctx.strokeStyle = isDark ? 'rgba(148, 163, 184, 0.1)' : 'rgba(100, 116, 139, 0.14)';

  ctx.beginPath();
  for (let x = startX; x <= endX; x += step) {
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
  }
  for (let y = startY; y <= endY; y += step) {
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
  }
  ctx.stroke();

  // Merkez eksen çizgileri
  ctx.strokeStyle = isDark ? 'rgba(148, 163, 184, 0.22)' : 'rgba(100, 116, 139, 0.25)';
  ctx.beginPath();
  ctx.moveTo(startX, 0);
  ctx.lineTo(endX, 0);
  ctx.moveTo(0, startY);
  ctx.lineTo(0, endY);
  ctx.stroke();
}

function drawWheel(ctx, axle, wheel, isSelected, isBeltSource, isDark) {
  const pitchR = wheel.r * BASE_R;
  const rotAngle = axle.angle + (wheel.phaseOffset || 0);

  ctx.save();
  ctx.translate(axle.x, axle.y);
  ctx.rotate(rotAngle);

  // Gölge (Üst üste binen çarkların katman ayrımını belirginleştirir)
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.65)' : 'rgba(15, 23, 42, 0.22)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;

  if (wheel.type === 'gear') {
    drawGearShape(ctx, pitchR, wheel.r * TEETH_PER_R, wheel.color, isSelected, isBeltSource, isDark);
  } else {
    drawPulleyShape(ctx, pitchR, wheel.color, isSelected, isBeltSource, isDark);
  }

  ctx.shadowColor = 'transparent';

  // Dönüşün net takip edilebilmesi için iç kollar (spokes) ve referans noktası
  drawWheelSpokes(ctx, pitchR, wheel.color, isDark);

  ctx.restore();
}

function drawGearShape(ctx, pitchR, teethCount, color, isSelected, isBeltSource, isDark) {
  const addendum = 6.5;   // Diş üstü yüksekliği
  const dedendum = 6.5;   // Diş dibi derinliği
  const outerR = pitchR + addendum;
  const rootR = pitchR - dedendum;
  const stepAngle = (Math.PI * 2) / teethCount;

  ctx.beginPath();
  for (let i = 0; i < teethCount; i++) {
    const baseA = i * stepAngle;
    const a1 = baseA - stepAngle * 0.34;
    const a2 = baseA - stepAngle * 0.16;
    const a3 = baseA + stepAngle * 0.16;
    const a4 = baseA + stepAngle * 0.34;
    const a5 = baseA + stepAngle * 0.66;

    if (i === 0) {
      ctx.moveTo(Math.cos(a1) * rootR, Math.sin(a1) * rootR);
    } else {
      ctx.lineTo(Math.cos(a1) * rootR, Math.sin(a1) * rootR);
    }
    ctx.lineTo(Math.cos(a2) * outerR, Math.sin(a2) * outerR);
    ctx.lineTo(Math.cos(a3) * outerR, Math.sin(a3) * outerR);
    ctx.lineTo(Math.cos(a4) * rootR, Math.sin(a4) * rootR);
    ctx.arc(0, 0, rootR, a4, a5, false);
  }
  ctx.closePath();

  ctx.fillStyle = hexWithAlpha(color, isDark ? 0.85 : 0.9);
  ctx.fill();

  ctx.lineWidth = isSelected || isBeltSource ? 3 : 2;
  ctx.strokeStyle = isBeltSource
    ? '#facc15'
    : isSelected
      ? (isDark ? '#ffffff' : '#0f172a')
      : shadeColor(color, -28);
  ctx.stroke();

  // Pitch (Bölüm Dairesi) kesikli kılavuz çemberi
  ctx.save();
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.arc(0, 0, pitchR, 0, Math.PI * 2);
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.stroke();
  ctx.restore();
}

function drawPulleyShape(ctx, pitchR, color, isSelected, isBeltSource, isDark) {
  ctx.beginPath();
  ctx.arc(0, 0, pitchR, 0, Math.PI * 2);
  ctx.fillStyle = hexWithAlpha(color, isDark ? 0.82 : 0.88);
  ctx.fill();

  ctx.lineWidth = isSelected || isBeltSource ? 3.5 : 2.5;
  ctx.strokeStyle = isBeltSource
    ? '#facc15'
    : isSelected
      ? (isDark ? '#ffffff' : '#0f172a')
      : shadeColor(color, -30);
  ctx.stroke();

  // Kasnak oluğu (iç çember)
  ctx.save();
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(10, pitchR - 6), 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.stroke();
  ctx.restore();
}

function drawWheelSpokes(ctx, pitchR, color, isDark) {
  const innerR = Math.max(12, pitchR - 14);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 2;

  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 10, Math.sin(a) * 10);
    ctx.lineTo(Math.cos(a) * innerR, Math.sin(a) * innerR);
    ctx.stroke();
  }

  // Referans dönüş işaretçisi (Tur sayısını gözle takip etmek için beyaz/koyu nokta)
  const markerDist = Math.max(16, pitchR - 14);
  ctx.beginPath();
  ctx.arc(markerDist, 0, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = shadeColor(color, -45);
  ctx.stroke();
}

function drawMeshContactHighlight(ctx, wA, wB, isDark) {
  const axleA = getAxleById(wA.axleId);
  const axleB = getAxleById(wB.axleId);
  if (!axleA || !axleB) return;

  const angle = Math.atan2(axleB.y - axleA.y, axleB.x - axleA.x);
  const contactX = axleA.x + Math.cos(angle) * (wA.r * BASE_R);
  const contactY = axleA.y + Math.sin(angle) * (wA.r * BASE_R);

  ctx.save();
  ctx.beginPath();
  ctx.arc(contactX, contactY, 9, 0, Math.PI * 2);
  ctx.fillStyle = isDark ? 'rgba(56, 189, 248, 0.28)' : 'rgba(37, 99, 235, 0.2)';
  ctx.fill();
  ctx.restore();
}

/**
 * İki çark/kasnak arasındaki düz (open) veya çapraz (crossed) kayışı
 * tam teğet geometrisiyle çizer.
 */
function drawBelt(ctx, belt, isDark) {
  const wA = getWheelById(belt.wheelAId);
  const wB = getWheelById(belt.wheelBId);
  if (!wA || !wB) return;

  const axleA = getAxleById(wA.axleId);
  const axleB = getAxleById(wB.axleId);
  if (!axleA || !axleB) return;

  const x1 = axleA.x;
  const y1 = axleA.y;
  const r1 = wA.r * BASE_R;

  const x2 = axleB.x;
  const y2 = axleB.y;
  const r2 = wB.r * BASE_R;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const d = Math.hypot(dx, dy);
  if (d < 10) return;

  const baseAngle = Math.atan2(dy, dx);

  ctx.save();

  if (!belt.cross) {
    // DÜZ KAYIŞ (Outer Common Tangents)
    const ratio = Math.max(-0.999, Math.min(0.999, (r1 - r2) / d));
    const alpha = Math.acos(ratio);

    const a1 = baseAngle - alpha;
    const a2 = baseAngle + alpha;

    const p1Top = { x: x1 + r1 * Math.cos(a1), y: y1 + r1 * Math.sin(a1) };
    const p2Top = { x: x2 + r2 * Math.cos(a1), y: y2 + r2 * Math.sin(a1) };

    const p1Bot = { x: x1 + r1 * Math.cos(a2), y: y1 + r1 * Math.sin(a2) };
    const p2Bot = { x: x2 + r2 * Math.cos(a2), y: y2 + r2 * Math.sin(a2) };

    ctx.beginPath();
    ctx.moveTo(p1Top.x, p1Top.y);
    ctx.lineTo(p2Top.x, p2Top.y);
    ctx.arc(x2, y2, r2, a1, a2, false);
    ctx.lineTo(p1Bot.x, p1Bot.y);
    ctx.arc(x1, y1, r1, a2, a1, false);
    ctx.closePath();

    strokeBeltPath(ctx, belt, false, isDark);
  } else {
    // ÇAPRAZ KAYIŞ (Inner Common Tangents)
    const ratio = Math.max(-0.95, Math.min(0.95, (r1 + r2) / d));
    const alpha = d > (r1 + r2) ? Math.acos(ratio) : 0.25;

    const t1A = baseAngle - alpha;
    const t2A = baseAngle - alpha + Math.PI;

    const t1B = baseAngle + alpha;
    const t2B = baseAngle + alpha - Math.PI;

    const p1A = { x: x1 + r1 * Math.cos(t1A), y: y1 + r1 * Math.sin(t1A) };
    const p2A = { x: x2 + r2 * Math.cos(t2A), y: y2 + r2 * Math.sin(t2A) };

    const p1B = { x: x1 + r1 * Math.cos(t1B), y: y1 + r1 * Math.sin(t1B) };
    const p2B = { x: x2 + r2 * Math.cos(t2B), y: y2 + r2 * Math.sin(t2B) };

    ctx.beginPath();
    ctx.moveTo(p1A.x, p1A.y);
    ctx.lineTo(p2A.x, p2A.y);
    ctx.arc(x2, y2, r2, t2A, t2B, true);
    ctx.lineTo(p1B.x, p1B.y);
    ctx.arc(x1, y1, r1, t1B, t1A, false);
    ctx.closePath();

    strokeBeltPath(ctx, belt, true, isDark);
  }

  ctx.restore();
}

function strokeBeltPath(ctx, belt, isCross, isDark) {
  // Ana kayış gövdesi
  ctx.lineWidth = 6;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = isCross
    ? (isDark ? '#f97316' : '#c2410c')
    : (isDark ? '#e2e8f0' : '#1e293b');
  ctx.stroke();

  // Hareketli iç dikiş çizgileri
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);
  ctx.lineDashOffset = -(belt.offset || 0);
  ctx.strokeStyle = isCross ? '#fef08a' : '#38bdf8';
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawHangingLoad(ctx, load, isDark) {
  const mov = computeLoadMovement(load);
  if (!mov) return;

  const { wheel, axle, piRFrac, direction, currentDispPx } = mov;
  const R = wheel.r * BASE_R;
  const ropeX = axle.x + (load.side === 'right' ? R : -R);
  const startY = axle.y;
  const baseLength = 125;
  const loadY = startY + baseLength + currentDispPx;

  ctx.save();

  // İp çizimi
  ctx.beginPath();
  ctx.moveTo(ropeX, startY);
  ctx.lineTo(ropeX, loadY);
  ctx.lineWidth = 3;
  ctx.strokeStyle = isDark ? '#cbd5e1' : '#334155';
  ctx.stroke();

  // Yük kutusu (G)
  const boxW = 46;
  const boxH = 40;
  ctx.fillStyle = isDark ? '#475569' : '#334155';
  ctx.strokeStyle = wheel.color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(ropeX - boxW / 2, loadY, boxW, boxH, 6);
  ctx.fill();
  ctx.stroke();

  // Yük Etiketi
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`G (${wheel.label})`, ropeX, loadY + 14);

  // İlerleme miktarı (h = ... πr)
  const hStr = piRFrac.num === 0 ? '0' : `${absFracString(piRFrac)}πr`;
  const dirArrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '•';
  ctx.fillStyle = direction === 'up' ? '#4ade80' : direction === 'down' ? '#fbbf24' : '#94a3b8';
  ctx.font = 'bold 11px ui-monospace, monospace';
  ctx.fillText(`${dirArrow} ${hStr}`, ropeX, loadY + 29);

  ctx.restore();
}

function drawAxleCenterAndOverlays(ctx, axle, isDark) {
  const wheels = getWheelsOnAxle(axle.id);
  const kin = state.kinematics.axleResults.get(axle.id);

  ctx.save();

  // 1. Mil Merkezi (Somun / Pim)
  ctx.beginPath();
  ctx.arc(axle.x, axle.y, 8, 0, Math.PI * 2);
  ctx.fillStyle = axle.isMotor ? '#f59e0b' : (isDark ? '#e2e8f0' : '#1e293b');
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = isDark ? '#0f172a' : '#ffffff';
  ctx.stroke();

  // Eş merkezli (birden fazla çarklı) mil ise merkezde halkalı vurgu
  if (wheels.length > 1) {
    ctx.beginPath();
    ctx.arc(axle.x, axle.y, 12.5, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = isDark ? '#38bdf8' : '#2563eb';
    ctx.stroke();
  }

  // 2. Her Katmandaki Çarkın Yarıçap ve Harf Etiketi (K: 3r, L: r vb.)
  if (state.showLabels) {
    wheels.forEach((w, idx) => {
      const rPx = w.r * BASE_R;
      // Etiketleri farklı açılara yerleştir ki üst üste binen çarklarda çakışmasın
      const labelAngles = [-Math.PI / 2, Math.PI / 4, -Math.PI * 0.75, Math.PI * 0.75];
      const ang = labelAngles[idx % labelAngles.length];
      const badgeDist = Math.max(22, rPx - 19);
      const bx = axle.x + Math.cos(ang) * badgeDist;
      const by = axle.y + Math.sin(ang) * badgeDist;

      const text = `${w.label} (${w.r}r)`;
      ctx.font = 'bold 12px system-ui, sans-serif';
      const tw = ctx.measureText(text).width + 10;

      ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.86)' : 'rgba(255, 255, 255, 0.92)';
      ctx.strokeStyle = w.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(bx - tw / 2, by - 10, tw, 20, 5);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isDark ? '#f8fafc' : '#0f172a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, bx, by);
    });
  }

  // 3. Dönüş Yönü ve Tur Sayısı Rozeti (Milin altında veya üstünde)
  if (state.showTurns && kin && wheels.length > 0) {
    const maxR = wheels[0].r * BASE_R;
    const badgeY = axle.y + maxR + 24;

    let turnText = '0 tur (Duruyor)';
    let pillColor = isDark ? '#94a3b8' : '#475569';

    if (state.kinematics.isJammed) {
      turnText = '⚠️ KİLİTLİ';
      pillColor = '#ef4444';
    } else if (kin.dir !== 0) {
      const arrow = kin.dir > 0 ? '↻' : '↺';
      const fracStr = absFracString(kin.nFrac);
      const motorTag = axle.isMotor ? '⚡ ' : '';
      turnText = `${motorTag}${fracStr} tur ${arrow}`;
      pillColor = kin.dir > 0
        ? (isDark ? '#38bdf8' : '#1d4ed8')
        : (isDark ? '#fbbf24' : '#b45309');
    }

    ctx.font = 'bold 12.5px system-ui, sans-serif';
    const bw = ctx.measureText(turnText).width + 16;

    ctx.fillStyle = isDark ? 'rgba(30, 41, 59, 0.94)' : 'rgba(255, 255, 255, 0.95)';
    ctx.strokeStyle = pillColor;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(axle.x - bw / 2, badgeY - 12, bw, 24, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = pillColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(turnText, axle.x, badgeY);
  }

  ctx.restore();
}

function drawInteractionPreview(ctx, hoverInfo, isDark) {
  ctx.save();

  // Kayış bağlama sırasında birinci çarktan fareye uzanan kılavuz çizgi
  if ((state.toolMode === 'belt-open' || state.toolMode === 'belt-cross') && state.beltStartWheelId) {
    const startWheel = getWheelById(state.beltStartWheelId);
    const startAxle = startWheel ? getAxleById(startWheel.axleId) : null;
    if (startAxle) {
      ctx.beginPath();
      ctx.moveTo(startAxle.x, startAxle.y);
      ctx.lineTo(hoverInfo.worldX, hoverInfo.worldY);
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = state.toolMode === 'belt-cross' ? '#f97316' : '#38bdf8';
      ctx.stroke();
    }
  }

  // Yeni çark/kasnak ekleme modunda yarı saydam önizleme çemberi
  if (state.toolMode === 'add-gear' || state.toolMode === 'add-pulley') {
    const rPx = state.selectedRadius * BASE_R;
    ctx.beginPath();
    ctx.arc(hoverInfo.snapX, hoverInfo.snapY, rPx, 0, Math.PI * 2);
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = hoverInfo.snapType === 'coaxial'
      ? '#10b981'
      : (isDark ? '#38bdf8' : '#2563eb');
    ctx.fillStyle = hoverInfo.snapType === 'coaxial'
      ? 'rgba(16, 185, 129, 0.15)'
      : 'rgba(56, 189, 248, 0.12)';
    ctx.fill();
    ctx.stroke();

    if (hoverInfo.snapType === 'coaxial') {
      ctx.setLineDash([]);
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.fillStyle = '#10b981';
      ctx.textAlign = 'center';
      ctx.fillText('🎯 Eş Merkezli (Üst Üste) Ekle', hoverInfo.snapX, hoverInfo.snapY - rPx - 12);
    }
  }

  ctx.restore();
}

function hexWithAlpha(hex, alpha) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function shadeColor(hex, percent) {
  const clean = hex.replace('#', '');
  let r = parseInt(clean.substring(0, 2), 16);
  let g = parseInt(clean.substring(2, 4), 16);
  let b = parseInt(clean.substring(4, 6), 16);

  r = Math.max(0, Math.min(255, Math.round(r + (255 * percent) / 100)));
  g = Math.max(0, Math.min(255, Math.round(g + (255 * percent) / 100)));
  b = Math.max(0, Math.min(255, Math.round(b + (255 * percent) / 100)));

  return `rgb(${r}, ${g}, ${b})`;
}
