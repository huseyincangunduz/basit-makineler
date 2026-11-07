(function () {
'use strict';


// --- Modül: state.js ---
/**
 * Basit Makineler: Çarklar ve Kasnaklar - Durum (State) Yönetimi
 * Her mil (axle) bir merkez noktasıdır ve üzerinde 1 veya daha fazla
 * eş merkezli (üst üste binen) çark (gear) veya kasnak (pulley) taşıyabilir.
 */
const BASE_R = 42; // 1r yarıçapın piksel karşılığı
const TEETH_PER_R = 12; // 1r çark üzerindeki diş sayısı (2r=24, 3r=36, 4r=48)
const WHEEL_PALETTE = [
  '#3b82f6', // Mavi
  '#f59e0b', // Kehribar / Turuncu
  '#10b981', // Zümrüt Yeşili
  '#ec4899', // Pembe
  '#8b5cf6', // Mor
  '#06b6d4', // Camgöbeği
  '#ef4444', // Kırmızı
  '#84cc16'  // Açık Yeşil
];

const LABELS = ['K', 'L', 'M', 'N', 'P', 'R', 'S', 'T', 'U', 'V', 'Y', 'Z', 'A', 'B', 'C', 'D'];
const state = {
  axles: [],         // [{ id, x, y, angle, isMotor, motorDir, motorTurns }]
  wheels: [],        // [{ id, axleId, type: 'gear'|'pulley', r: 1|2|3|4, label, color, phaseOffset }]
  belts: [],         // [{ id, wheelAId, wheelBId, cross: boolean, offset: number }]
  loads: [],         // [{ id, wheelId, side: 'left'|'right', label: 'G' }]

  // Etkileşim durumu
  toolMode: 'select', // 'select' | 'add-gear' | 'add-pulley' | 'belt-open' | 'belt-cross' | 'add-load'
  selectedRadius: 2,  // 1 | 2 | 3 | 4
  selectedAxleId: null,
  selectedWheelId: null,
  beltStartWheelId: null,

  // Simülasyon durumu
  isRunning: false,
  stepAnimation: null, // { progress: 0..1, targetTurns: 1 }
  showLabels: true,
  showTurns: true,
  snapEnabled: true,

  // Kamera (Pan / Zoom)
  camera: {
    x: 0,
    y: 0,
    zoom: 1
  },

  // Kinematik çözücü sonuçları
  kinematics: {
    isJammed: false,
    jammedPairs: [],
    axleResults: new Map(), // axleId -> { nFrac: {num, den}, dir: -1|0|1, omega: number }
    meshedPairs: []         // [{ wheelA, wheelB }]
  }
};

let idCounter = 1;
function nextId(prefix = 'id') {
  return `${prefix}_${idCounter++}`;
}
function getNextLabel() {
  const used = new Set(state.wheels.map(w => w.label));
  for (const ch of LABELS) {
    if (!used.has(ch)) return ch;
  }
  return `Ç${state.wheels.length + 1}`;
}
function getNextColor() {
  return WHEEL_PALETTE[state.wheels.length % WHEEL_PALETTE.length];
}
function getAxleById(axleId) {
  return state.axles.find(a => a.id === axleId) || null;
}
function getWheelById(wheelId) {
  return state.wheels.find(w => w.id === wheelId) || null;
}

/**
 * Bir mil üzerindeki tüm çarkları büyükten küçüğe (alttan üste doğru çizim için) döndürür.
 */
function getWheelsOnAxle(axleId) {
  return state.wheels
    .filter(w => w.axleId === axleId)
    .sort((a, b) => b.r - a.r);
}

/**
 * Yeni bir mil ve üzerinde ilk çarkı/kasnağı oluşturur.
 */
function createAxleWithWheel({ x, y, type = 'gear', r = 2, label = null, color = null, isMotor = false, motorDir = 1, motorTurns = 1 }) {
  const hasMotor = state.axles.some(a => a.isMotor);
  const axle = {
    id: nextId('axle'),
    x,
    y,
    angle: 0,
    isMotor: isMotor || !hasMotor,
    motorDir: motorDir,    // 1: Saat Yönü (CW), -1: Saat Yönünün Tersi (CCW)
    motorTurns: motorTurns // Referans tur sayısı (varsayılan 1)
  };
  state.axles.push(axle);

  const wheel = addWheelToAxle(axle.id, { type, r, label, color });
  return { axle, wheel };
}

/**
 * Mevcut bir milin üzerine eş merkezli (üst üste binen) yeni bir çark/kasnak ekler.
 * Aynı milde aynı yarıçap (r) ve aynı türde çark varsa uyarı döner veya mevcut olanı günceller.
 */
function addWheelToAxle(axleId, { type = 'gear', r = 2, label = null, color = null }) {
  const axle = getAxleById(axleId);
  if (!axle) return null;

  // Aynı milde aynı yarıçapta başka bir çark var mı kontrol et
  const existingSameR = state.wheels.find(w => w.axleId === axleId && w.r === r);
  if (existingSameR) {
    // Türünü değiştir veya seç
    existingSameR.type = type;
    state.selectedAxleId = axleId;
    state.selectedWheelId = existingSameR.id;
    return existingSameR;
  }

  const wheel = {
    id: nextId('wheel'),
    axleId,
    type,
    r: Number(r),
    label: label || getNextLabel(),
    color: color || getNextColor(),
    phaseOffset: 0
  };
  state.wheels.push(wheel);
  state.selectedAxleId = axleId;
  state.selectedWheelId = wheel.id;
  return wheel;
}

/**
 * İki farklı mili eş merkezli (üst üste) olacak şekilde tek bir milde birleştirir.
 */
function mergeAxlesCoaxially(sourceAxleId, targetAxleId) {
  if (sourceAxleId === targetAxleId) return false;
  const sourceAxle = getAxleById(sourceAxleId);
  const targetAxle = getAxleById(targetAxleId);
  if (!sourceAxle || !targetAxle) return false;

  const sourceWheels = getWheelsOnAxle(sourceAxleId);
  const targetRadii = new Set(getWheelsOnAxle(targetAxleId).map(w => w.r));

  // Eğer yarıçapların tamamı çakışıyorsa birleştirme yapma
  const nonConflicting = sourceWheels.filter(w => !targetRadii.has(w.r));
  if (nonConflicting.length === 0) return false;

  for (const w of sourceWheels) {
    if (!targetRadii.has(w.r)) {
      w.axleId = targetAxleId;
      targetRadii.add(w.r);
    } else {
      // Çakışan çarkı ve bağlı kayışları temizle
      removeWheel(w.id);
    }
  }

  if (sourceAxle.isMotor && !targetAxle.isMotor) {
    targetAxle.isMotor = true;
    targetAxle.motorDir = sourceAxle.motorDir;
    targetAxle.motorTurns = sourceAxle.motorTurns;
  }

  state.axles = state.axles.filter(a => a.id !== sourceAxleId);
  state.selectedAxleId = targetAxleId;
  return true;
}

/**
 * Tek bir çarkı siler. Milde başka çark kalmadıysa mili de siler.
 */
function removeWheel(wheelId) {
  const wheel = getWheelById(wheelId);
  if (!wheel) return;
  const axleId = wheel.axleId;

  // Bağlı kayışları ve yükleri sil
  state.belts = state.belts.filter(b => b.wheelAId !== wheelId && b.wheelBId !== wheelId);
  state.loads = state.loads.filter(l => l.wheelId !== wheelId);
  state.wheels = state.wheels.filter(w => w.id !== wheelId);

  const remaining = getWheelsOnAxle(axleId);
  if (remaining.length === 0) {
    const wasMotor = getAxleById(axleId)?.isMotor;
    state.axles = state.axles.filter(a => a.id !== axleId);
    if (wasMotor && state.axles.length > 0 && !state.axles.some(a => a.isMotor)) {
      state.axles[0].isMotor = true;
    }
    if (state.selectedAxleId === axleId) {
      state.selectedAxleId = null;
      state.selectedWheelId = null;
    }
  } else if (state.selectedWheelId === wheelId) {
    state.selectedWheelId = remaining[0].id;
  }
}

/**
 * Bir mili ve üzerindeki tüm eş merkezli çarkları siler.
 */
function removeAxle(axleId) {
  const wheels = getWheelsOnAxle(axleId);
  for (const w of wheels) {
    removeWheel(w.id);
  }
}

/**
 * İki çark/kasnak arasına düz veya çapraz kayış ekler.
 */
function addOrUpdateBelt(wheelAId, wheelBId, cross = false) {
  const wA = getWheelById(wheelAId);
  const wB = getWheelById(wheelBId);
  if (!wA || !wB || wA.axleId === wB.axleId) return null;

  // Mevcut kayış varsa güncelle
  const existing = state.belts.find(
    b => (b.wheelAId === wheelAId && b.wheelBId === wheelBId) ||
         (b.wheelAId === wheelBId && b.wheelBId === wheelAId)
  );
  if (existing) {
    existing.cross = cross;
    return existing;
  }

  const belt = {
    id: nextId('belt'),
    wheelAId,
    wheelBId,
    cross,
    offset: 0
  };
  state.belts.push(belt);
  return belt;
}
function removeBelt(beltId) {
  state.belts = state.belts.filter(b => b.id !== beltId);
}

/**
 * Bir çarka/kasnağa yük (ağırlık) bağlar veya yönünü (sol/sağ ip) değiştirir.
 */
function toggleLoadOnWheel(wheelId) {
  const existingIdx = state.loads.findIndex(l => l.wheelId === wheelId);
  if (existingIdx !== -1) {
    const existing = state.loads[existingIdx];
    if (existing.side === 'right') {
      existing.side = 'left';
      return existing;
    } else {
      state.loads.splice(existingIdx, 1);
      return null;
    }
  }

  const wheel = getWheelById(wheelId);
  if (!wheel) return null;

  const load = {
    id: nextId('load'),
    wheelId,
    side: 'right',
    label: `G_${wheel.label}`
  };
  state.loads.push(load);
  return load;
}
function setMotorAxle(axleId, dir = 1, turns = 1) {
  for (const a of state.axles) {
    if (a.id === axleId) {
      a.isMotor = true;
      a.motorDir = dir;
      a.motorTurns = turns;
    } else {
      a.isMotor = false;
    }
  }
}
function clearScene() {
  state.axles = [];
  state.wheels = [];
  state.belts = [];
  state.loads = [];
  state.selectedAxleId = null;
  state.selectedWheelId = null;
  state.beltStartWheelId = null;
  state.isRunning = false;
  state.stepAnimation = null;
  idCounter = 1;
}


// --- Modül: physics.js ---
/**
 * Basit Makineler: Kinematik Çözücü, Kesir Hesaplayıcı ve Mıknatıslanma (Snap) Motoru
 */
function gcd(a, b) {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a || 1;
}
function makeFrac(num, den = 1) {
  if (den === 0) return { num: 0, den: 1 };
  const sign = (num < 0) !== (den < 0) ? -1 : 1;
  const g = gcd(num, den);
  return {
    num: sign * (Math.abs(Math.round(num)) / g),
    den: Math.abs(Math.round(den)) / g
  };
}
function mulFrac(f1, f2) {
  return makeFrac(f1.num * f2.num, f1.den * f2.den);
}
function eqFrac(f1, f2) {
  return f1.num * f2.den === f2.num * f1.den;
}
function absFracString(frac) {
  const n = Math.abs(frac.num);
  const d = frac.den;
  if (n === 0) return '0';
  if (d === 1) return `${n}`;
  return `${n}/${d}`;
}

/**
 * Sahnedeki tüm dişli temaslarını, kayış bağlantılarını ve eş merkezli çarkları
 * tarayarak her milin dönüş yönünü, tur sayısını ve kilitlenme (jam) durumunu çözer.
 */
function solveKinematics() {
  const meshedPairs = [];
  const adj = new Map(); // axleId -> Array<{ toAxleId, ratioNum, ratioDen, wheelA, wheelB, type }>

  for (const axle of state.axles) {
    adj.set(axle.id, []);
  }

  // 1. Dişli temaslarını tespit et (Farklı millerdeki 'gear' tipindeki çarklar)
  const gears = state.wheels.filter(w => w.type === 'gear');
  for (let i = 0; i < gears.length; i++) {
    for (let j = i + 1; j < gears.length; j++) {
      const wA = gears[i];
      const wB = gears[j];
      if (wA.axleId === wB.axleId) continue;

      const axleA = getAxleById(wA.axleId);
      const axleB = getAxleById(wB.axleId);
      if (!axleA || !axleB) continue;

      const dist = Math.hypot(axleB.x - axleA.x, axleB.y - axleA.y);
      const idealDist = (wA.r + wB.r) * BASE_R;

      if (Math.abs(dist - idealDist) <= 5.5) {
        meshedPairs.push({ wheelA: wA, wheelB: wB });
        // Dişli temasında dönüş yönü zıttır: nB = -nA * (rA / rB)
        adj.get(axleA.id).push({
          toAxleId: axleB.id,
          ratioNum: -wA.r,
          ratioDen: wB.r,
          wheelA: wA,
          wheelB: wB,
          connType: 'gear'
        });
        adj.get(axleB.id).push({
          toAxleId: axleA.id,
          ratioNum: -wB.r,
          ratioDen: wA.r,
          wheelA: wB,
          wheelB: wA,
          connType: 'gear'
        });
      }
    }
  }

  // 2. Kayış bağlantılarını ekle
  for (const belt of state.belts) {
    const wA = getWheelById(belt.wheelAId);
    const wB = getWheelById(belt.wheelBId);
    if (!wA || !wB || wA.axleId === wB.axleId) continue;

    const sign = belt.cross ? -1 : 1; // Düz kayış: +1, Çapraz kayış: -1
    adj.get(wA.axleId).push({
      toAxleId: wB.axleId,
      ratioNum: sign * wA.r,
      ratioDen: wB.r,
      wheelA: wA,
      wheelB: wB,
      connType: belt.cross ? 'belt-cross' : 'belt-open',
      beltId: belt.id
    });
    adj.get(wB.axleId).push({
      toAxleId: wA.axleId,
      ratioNum: sign * wB.r,
      ratioDen: wA.r,
      wheelA: wB,
      wheelB: wA,
      connType: belt.cross ? 'belt-cross' : 'belt-open',
      beltId: belt.id
    });
  }

  // 3. Motor milinden başlayarak BFS ile tüm bağlı millerin hız/tur oranlarını çöz
  const axleResults = new Map();
  let isJammed = false;
  const jammedPairs = [];

  const motorAxles = state.axles.filter(a => a.isMotor);
  const queue = [];

  for (const motor of motorAxles) {
    // motorTurns tam sayı veya buçuklu olabilir (örn: 1, 2, 3)
    const baseNum = Math.round(motor.motorTurns * 2) * motor.motorDir;
    const startFrac = makeFrac(baseNum, 2);
    axleResults.set(motor.id, {
      nFrac: startFrac,
      dir: Math.sign(startFrac.num),
      omega: startFrac.num / startFrac.den
    });
    queue.push(motor.id);
  }

  while (queue.length > 0) {
    const currAxleId = queue.shift();
    const currRes = axleResults.get(currAxleId);
    const edges = adj.get(currAxleId) || [];

    for (const edge of edges) {
      const ratio = makeFrac(edge.ratioNum, edge.ratioDen);
      const nextFrac = mulFrac(currRes.nFrac, ratio);

      if (!axleResults.has(edge.toAxleId)) {
        axleResults.set(edge.toAxleId, {
          nFrac: nextFrac,
          dir: Math.sign(nextFrac.num),
          omega: nextFrac.num / nextFrac.den
        });
        queue.push(edge.toAxleId);

        // Dişli çarkların dişlerinin görsel olarak tam iç içe geçmesi için faz açısı hizalaması
        if (edge.connType === 'gear') {
          alignGearPhase(edge.wheelA, edge.wheelB);
        }
      } else {
        const existing = axleResults.get(edge.toAxleId);
        if (!eqFrac(existing.nFrac, nextFrac)) {
          isJammed = true;
          jammedPairs.push({ wheelA: edge.wheelA, wheelB: edge.wheelB });
        }
      }
    }
  }

  // Bağlantısız kalan millere 0 tur ata
  for (const axle of state.axles) {
    if (!axleResults.has(axle.id)) {
      axleResults.set(axle.id, {
        nFrac: { num: 0, den: 1 },
        dir: 0,
        omega: 0
      });
    }
  }

  // Eğer sistem kilitlendiyse (jammed), kimse dönemez (omega = 0 olarak işaretlenir ancak teorik çelişki bildirilir)
  state.kinematics = {
    isJammed,
    jammedPairs,
    axleResults,
    meshedPairs
  };

  return state.kinematics;
}

/**
 * İki kenetlenmiş dişli çarkın dişlerinin üst üste binmemesi (biri diş tepe noktasındayken
 * diğerinin diş çukurunda olması) için görsel faz farkını hesaplar.
 */
function alignGearPhase(wA, wB) {
  const axleA = getAxleById(wA.axleId);
  const axleB = getAxleById(wB.axleId);
  if (!axleA || !axleB) return;

  const theta = Math.atan2(axleB.y - axleA.y, axleB.x - axleA.x);
  const teethA = wA.r * TEETH_PER_R;
  const teethB = wB.r * TEETH_PER_R;

  // wA'nın temas noktasındaki diş fazı:
  const phaseAtContactA = (axleA.angle + wA.phaseOffset - theta) * teethA;
  // wB'nin temas noktası theta + PI yönündedir ve yarım diş (PI radyan diş fazı) kaydırılmalıdır:
  wB.phaseOffset = (theta + Math.PI) - axleB.angle - (phaseAtContactA + Math.PI) / teethB;
}

/**
 * Bir mil sürüklenirken diğer millerin merkezine (eş merkezli / üst üste) veya
 * diğer dişlilerin kenetlenme mesafesine (r1 + r2) mıknatıslanmasını hesaplar.
 */
function computeSnapPosition(draggedAxleId, rawX, rawY) {
  if (!state.snapEnabled) {
    return { x: rawX, y: rawY, snapType: null, targetAxleId: null, meshInfo: null };
  }

  const draggedWheels = getWheelsOnAxle(draggedAxleId);

  // 1. Eş merkezli (Üst Üste) Mıknatıslanma Kontrolü
  for (const otherAxle of state.axles) {
    if (otherAxle.id === draggedAxleId) continue;
    const distToCenter = Math.hypot(rawX - otherAxle.x, rawY - otherAxle.y);
    if (distToCenter < 30) {
      return {
        x: otherAxle.x,
        y: otherAxle.y,
        snapType: 'coaxial',
        targetAxleId: otherAxle.id,
        meshInfo: null
      };
    }
  }

  // 2. Dişli Kenetlenme (r1 + r2) Mıknatıslanma Kontrolü
  const draggedGears = draggedWheels.filter(w => w.type === 'gear');
  let bestSnap = null;
  let minDiff = 18; // Piksel cinsinden yakalama eşiği

  for (const myGear of draggedGears) {
    for (const otherGear of state.wheels) {
      if (otherGear.axleId === draggedAxleId || otherGear.type !== 'gear') continue;
      const otherAxle = getAxleById(otherGear.axleId);
      if (!otherAxle) continue;

      const idealDist = (myGear.r + otherGear.r) * BASE_R;
      const dx = rawX - otherAxle.x;
      const dy = rawY - otherAxle.y;
      const dist = Math.hypot(dx, dy);
      const diff = Math.abs(dist - idealDist);

      if (diff < minDiff && dist > 1) {
        minDiff = diff;
        let angle = Math.atan2(dy, dx);

        // Yatay ve dikey eksenlere (0, 90, 180, -90 derece) yakınsa açısal mıknatıslanma uygula
        const cardinalAngles = [0, Math.PI / 2, Math.PI, -Math.PI, -Math.PI / 2];
        for (const ca of cardinalAngles) {
          if (Math.abs(angle - ca) < 0.09) {
            angle = ca;
            break;
          }
        }

        bestSnap = {
          x: otherAxle.x + Math.cos(angle) * idealDist,
          y: otherAxle.y + Math.sin(angle) * idealDist,
          snapType: 'mesh',
          targetAxleId: otherAxle.id,
          meshInfo: { myGear, otherGear }
        };
      }
    }
  }

  if (bestSnap) return bestSnap;

  return { x: rawX, y: rawY, snapType: null, targetAxleId: null, meshInfo: null };
}

/**
 * Bir yükün (G) bağlı olduğu çarkın dönüşüne göre kaç πr yükseldiğini veya alçaldığını hesaplar.
 */
function computeLoadMovement(load) {
  const wheel = getWheelById(load.wheelId);
  if (!wheel) return null;
  const axle = getAxleById(wheel.axleId);
  if (!axle) return null;

  const kin = state.kinematics.axleResults.get(axle.id);
  if (!kin || state.kinematics.isJammed) {
    return { wheel, axle, piRFrac: { num: 0, den: 1 }, direction: 'stopped', currentDispPx: 0 };
  }

  // h = n * 2 * π * (wheel.r * r) = (2 * n * wheel.r) * πr
  // Saat yönünde (dir > 0) dönerken sağdaki ip aşağı (-), soldaki ip yukarı (+) gider.
  const sideFactor = load.side === 'right' ? -1 : 1;
  const piRFrac = mulFrac(kin.nFrac, makeFrac(2 * wheel.r * sideFactor, 1));

  let direction = 'stopped';
  if (piRFrac.num > 0) direction = 'up';
  if (piRFrac.num < 0) direction = 'down';

  // Anlık görsel yer değiştirme (axle.angle radyan cinsinden)
  // s = -sideFactor * angle * R
  const rawDisp = sideFactor * (-axle.angle) * (wheel.r * BASE_R * 0.32);
  const currentDispPx = Math.max(-75, Math.min(75, rawDisp));

  return {
    wheel,
    axle,
    piRFrac,
    direction,
    currentDispPx
  };
}


// --- Modül: renderer.js ---
/**
 * Basit Makineler: HTML5 Canvas Çizim Motoru
 * Dişli çarklar, eş merkezli (üst üste) katmanlar, düz/çapraz kayış teğetleri ve asılı yükleri çizer.
 */
function renderScene(canvas, ctx, hoverInfo = null) {
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
function isDarkModeActive() {
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


// --- Modül: presets.js ---
/**
 * Basit Makineler: Hazır Ders Düzenekleri (Presets)
 */
function loadPreset(presetKey) {
  clearScene();
  state.camera = { x: 0, y: -15, zoom: 1 };

  if (presetKey === 'empty') {
    return;
  }

  if (presetKey === 'coaxial-combo') {
    // 1. Mil: K dişlisi (2r) - Motor
    const { axle: a1, wheel: wK } = createAxleWithWheel({
      x: -240,
      y: 0,
      type: 'gear',
      r: 2,
      label: 'K',
      color: '#3b82f6',
      isMotor: true,
      motorDir: 1,
      motorTurns: 1
    });

    // 2. Mil: K(2r) ile kenetli L(3r) dişlisi + Üstünde eş merkezli M(1r) kasnağı
    // Mesafe = (2r + 3r) * BASE_R = 5 * BASE_R
    const { axle: a2, wheel: wL } = createAxleWithWheel({
      x: a1.x + 5 * BASE_R,
      y: 0,
      type: 'gear',
      r: 3,
      label: 'L',
      color: '#10b981'
    });
    const wM = addWheelToAxle(a2.id, {
      type: 'pulley',
      r: 1,
      label: 'M',
      color: '#f59e0b'
    });

    // 3. Mil: M(1r) kasnağına çapraz kayışla bağlı N(2r) kasnağı
    const { axle: a3, wheel: wN } = createAxleWithWheel({
      x: a2.x + 250,
      y: 0,
      type: 'pulley',
      r: 2,
      label: 'N',
      color: '#ec4899'
    });

    addOrUpdateBelt(wM.id, wN.id, true); // Çapraz kayış
    toggleLoadOnWheel(wN.id);            // N kasnağına yük as

    state.selectedAxleId = a2.id;
    state.selectedWheelId = wM.id;
    return;
  }

  if (presetKey === 'gear-train') {
    // K(1r) -> L(2r) -> M(3r)
    const { axle: a1 } = createAxleWithWheel({
      x: -220,
      y: 0,
      type: 'gear',
      r: 1,
      label: 'K',
      color: '#3b82f6',
      isMotor: true,
      motorDir: 1,
      motorTurns: 3
    });

    const { axle: a2 } = createAxleWithWheel({
      x: a1.x + (1 + 2) * BASE_R,
      y: 0,
      type: 'gear',
      r: 2,
      label: 'L',
      color: '#f59e0b'
    });

    createAxleWithWheel({
      x: a2.x + (2 + 3) * BASE_R,
      y: 0,
      type: 'gear',
      r: 3,
      label: 'M',
      color: '#10b981'
    });

    state.selectedAxleId = a1.id;
    return;
  }

  if (presetKey === 'belts-compare') {
    // K(3r) --Düz Kayış--> L(1r) & üstünde M(2r) --Çapraz Kayış--> N(2r)
    const { wheel: wK } = createAxleWithWheel({
      x: -250,
      y: 0,
      type: 'pulley',
      r: 3,
      label: 'K',
      color: '#3b82f6',
      isMotor: true,
      motorDir: 1,
      motorTurns: 1
    });

    const { axle: a2, wheel: wL } = createAxleWithWheel({
      x: 10,
      y: 0,
      type: 'pulley',
      r: 1,
      label: 'L',
      color: '#10b981'
    });

    const wM = addWheelToAxle(a2.id, {
      type: 'pulley',
      r: 2,
      label: 'M',
      color: '#f59e0b'
    });

    const { wheel: wN } = createAxleWithWheel({
      x: 250,
      y: 0,
      type: 'pulley',
      r: 2,
      label: 'N',
      color: '#8b5cf6'
    });

    addOrUpdateBelt(wK.id, wL.id, false); // Düz kayış
    addOrUpdateBelt(wM.id, wN.id, true);  // Çapraz kayış
    state.selectedAxleId = a2.id;
    return;
  }

  if (presetKey === 'hoist-load') {
    // Eş merkezli çıkrık / kasnak sistemi ve asılı yükler
    const { axle: a1, wheel: wK } = createAxleWithWheel({
      x: -150,
      y: -25,
      type: 'pulley',
      r: 2,
      label: 'K',
      color: '#3b82f6',
      isMotor: true,
      motorDir: 1,
      motorTurns: 1
    });

    const { axle: a2, wheel: wL } = createAxleWithWheel({
      x: 130,
      y: -25,
      type: 'pulley',
      r: 3,
      label: 'L',
      color: '#10b981'
    });

    const wM = addWheelToAxle(a2.id, {
      type: 'pulley',
      r: 1,
      label: 'M',
      color: '#ec4899'
    });

    addOrUpdateBelt(wK.id, wL.id, false);
    toggleLoadOnWheel(wK.id);
    toggleLoadOnWheel(wM.id);
    state.selectedAxleId = a2.id;
  }
}


// --- Modül: main.js ---
/**
 * Basit Makineler: Ana Uygulama, Etkileşim ve Animasyon Döngüsü
 */


const canvas = document.getElementById('sim-canvas');
const ctx = canvas.getContext('2d');

// UI Referansları
const btnPlayPause = document.getElementById('btn-play-pause');
const playIcon = document.getElementById('play-icon');
const playText = document.getElementById('play-text');
const btnStepTurn = document.getElementById('btn-step-turn');
const btnResetTurns = document.getElementById('btn-reset-turns');
const presetSelect = document.getElementById('preset-select');
const btnClear = document.getElementById('btn-clear');
const btnTheme = document.getElementById('btn-theme');

const statusBanner = document.getElementById('status-banner');
const jamAlert = document.getElementById('jam-alert');
const hudMotorInfo = document.getElementById('hud-motor-info');
const tableRefTurns = document.getElementById('table-ref-turns');

const inspectorContent = document.getElementById('inspector-content');
const kinematicsTbody = document.getElementById('kinematics-tbody');
const loadsSection = document.getElementById('loads-section');
const loadsSummary = document.getElementById('loads-summary');
const beltsList = document.getElementById('belts-list');

const chkShowLabels = document.getElementById('chk-show-labels');
const chkShowTurns = document.getElementById('chk-show-turns');
const chkSnapGrid = document.getElementById('chk-snap-grid');

const btnZoomIn = document.getElementById('btn-zoom-in');
const btnZoomOut = document.getElementById('btn-zoom-out');
const btnZoomReset = document.getElementById('btn-zoom-reset');
const zoomLabel = document.getElementById('zoom-label');

// Etkileşim Değişkenleri
let draggingAxleId = null;
let dragOffset = { x: 0, y: 0 };
let isPanning = false;
let panStart = { x: 0, y: 0 };
let pendingCoaxialTargetId = null;
let hoverInfo = null;
let lastFrameTime = performance.now();

function init() {
  // Sistem renk şeması değişimini dinle (modern-web-guidance: dark-mode)
  const darkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  darkMediaQuery.addEventListener('change', () => {
    renderScene(canvas, ctx, hoverInfo);
  });

  bindToolbarEvents();
  bindCanvasEvents();

  // Varsayılan hazır düzeneği yükle
  loadPreset('coaxial-combo');
  refreshAll();

  requestAnimationFrame(animationLoop);
}

function refreshAll() {
  solveKinematics();
  updateStatusAndAlerts();
  updateInspectorUI();
  updateKinematicsTableUI();
  updateLoadsAndBeltsUI();
  renderScene(canvas, ctx, hoverInfo);
}

function bindToolbarEvents() {
  // Oynat / Duraklat
  btnPlayPause.addEventListener('click', () => {
    state.isRunning = !state.isRunning;
    state.stepAnimation = null;
    syncPlayButtonUI();
  });

  // +1 Tam Tur Döndür
  btnStepTurn.addEventListener('click', () => {
    state.isRunning = false;
    syncPlayButtonUI();
    state.stepAnimation = {
      elapsedRad: 0,
      targetRad: Math.PI * 2
    };
  });

  // Açıları Sıfırla
  btnResetTurns.addEventListener('click', () => {
    state.isRunning = false;
    state.stepAnimation = null;
    syncPlayButtonUI();
    for (const axle of state.axles) {
      axle.angle = 0;
    }
    for (const belt of state.belts) {
      belt.offset = 0;
    }
    refreshAll();
  });

  // Hazır Düzenek Seçimi
  presetSelect.addEventListener('change', (e) => {
    loadPreset(e.target.value);
    syncPlayButtonUI();
    refreshAll();
  });

  // Sahneyi Temizle
  btnClear.addEventListener('click', () => {
    clearScene();
    presetSelect.value = 'empty';
    syncPlayButtonUI();
    refreshAll();
  });

  // Tema Değiştir
  btnTheme.addEventListener('click', () => {
    const currentlyDark = isDarkModeActive();
    document.documentElement.setAttribute('data-theme', currentlyDark ? 'light' : 'dark');
    renderScene(canvas, ctx, hoverInfo);
  });

  // Sol Panel Mod Seçimi
  document.querySelectorAll('input[name="tool-mode"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      state.toolMode = e.target.value;
      state.beltStartWheelId = null;
      updateModeBanner();
      renderScene(canvas, ctx, hoverInfo);
    });
  });

  // Yarıçap Seçimi (1r, 2r, 3r, 4r)
  document.querySelectorAll('input[name="wheel-radius"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      const newR = Number(e.target.value);
      state.selectedRadius = newR;

      // Eğer Seç & Taşı modundaysak ve bir çark seçiliyse yarıçapını güncelle
      if (state.toolMode === 'select' && state.selectedWheelId) {
        const w = getWheelById(state.selectedWheelId);
        if (w) {
          const sameR = state.wheels.find(other => other.axleId === w.axleId && other.id !== w.id && other.r === newR);
          if (!sameR) {
            w.r = newR;
            refreshAll();
          } else {
            setBanner(`⚠️ Bu milde zaten ${newR}r yarıçaplı bir çark (${sameR.label}) bulunuyor.`);
          }
        }
      }
    });
  });

  // Görünüm Onay Kutuları
  chkShowLabels.addEventListener('change', (e) => {
    state.showLabels = e.target.checked;
    renderScene(canvas, ctx, hoverInfo);
  });
  chkShowTurns.addEventListener('change', (e) => {
    state.showTurns = e.target.checked;
    renderScene(canvas, ctx, hoverInfo);
  });
  chkSnapGrid.addEventListener('change', (e) => {
    state.snapEnabled = e.target.checked;
  });

  // Yakınlaştırma Kontrolleri
  btnZoomIn.addEventListener('click', () => setZoom(state.camera.zoom * 1.15));
  btnZoomOut.addEventListener('click', () => setZoom(state.camera.zoom / 1.15));
  btnZoomReset.addEventListener('click', () => {
    state.camera = { x: 0, y: -15, zoom: 1 };
    zoomLabel.textContent = '100%';
    renderScene(canvas, ctx, hoverInfo);
  });
}

function setZoom(newZoom) {
  state.camera.zoom = Math.max(0.45, Math.min(2.2, newZoom));
  zoomLabel.textContent = `${Math.round(state.camera.zoom * 100)}%`;
  renderScene(canvas, ctx, hoverInfo);
}

function syncPlayButtonUI() {
  if (state.isRunning) {
    btnPlayPause.classList.add('running');
    playIcon.textContent = '⏸';
    playText.textContent = 'Duraklat';
  } else {
    btnPlayPause.classList.remove('running');
    playIcon.textContent = '▶';
    playText.textContent = 'Döndür';
  }
}

function updateModeBanner() {
  const messages = {
    'select': '🖐️ Seç & Taşı Modu: Çarkları sürükleyin. Başka bir çarkın merkezine bırakırsanız üst üste (eş merkezli) biner; yanına yaklaştırırsanız dişliler kenetlenir.',
    'add-gear': `⚙️ Dişli Çark Ekleme Modu (${state.selectedRadius}r): Boşluğa tıklayarak yeni dişli oluşturun veya mevcut bir çarkın merkezine tıklayarak üstüne eş merkezli ekleyin.`,
    'add-pulley': `⭕ Kasnak Ekleme Modu (${state.selectedRadius}r): Boşluğa tıklayarak yeni kasnak ekleyin veya mevcut bir çarkın merkezine tıklayarak üstüne eş merkezli ekleyin.`,
    'belt-open': '🔗 Düz Kayış Bağlama: Sırayla iki farklı mildeki çarka veya kasnağa tıklayın (Dönüş yönleri aynı olur).',
    'belt-cross': '❌ Çapraz Kayış Bağlama: Sırayla iki farklı mildeki çarka veya kasnağa tıklayın (Dönüş yönleri zıt olur).',
    'add-load': '🏋️ Yük (Ağırlık) Asma: İp ve G ağırlığı bağlamak (veya yönünü değiştirmek / kaldırmak) istediğiniz çarka tıklayın.'
  };
  setBanner(messages[state.toolMode] || '');
}

function setBanner(htmlText) {
  statusBanner.innerHTML = htmlText;
}

/**
 * Ekran koordinatlarını dünya (sahne) koordinatlarına dönüştürür.
 */
function screenToWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const sx = clientX - rect.left;
  const sy = clientY - rect.top;
  const worldX = (sx - rect.width / 2 - state.camera.x) / state.camera.zoom;
  const worldY = (sy - rect.height / 2 - state.camera.y) / state.camera.zoom;
  return { worldX, worldY };
}

/**
 * Verilen dünya koordinatında en üst katmandaki (en küçük yarıçaplı eş merkezli) çarkı bulur.
 */
function hitTestWheel(worldX, worldY) {
  // Milleri ters sırayla tara, her milde küçük yarıçaptan büyüğe doğru kontrol et (üstteki önce seçilsin)
  for (let i = state.axles.length - 1; i >= 0; i--) {
    const axle = state.axles[i];
    const dist = Math.hypot(worldX - axle.x, worldY - axle.y);
    const wheelsSmallToLarge = [...getWheelsOnAxle(axle.id)].reverse();

    for (const w of wheelsSmallToLarge) {
      const rPx = w.r * BASE_R + 5;
      if (dist <= rPx) {
        return { axle, wheel: w };
      }
    }
  }
  return null;
}

function bindCanvasEvents() {
  canvas.addEventListener('pointerdown', (e) => {
    const { worldX, worldY } = screenToWorld(e.clientX, e.clientY);
    const hit = hitTestWheel(worldX, worldY);

    // 1. Yeni Dişli veya Kasnak Ekleme Modu
    if (state.toolMode === 'add-gear' || state.toolMode === 'add-pulley') {
      const wheelType = state.toolMode === 'add-gear' ? 'gear' : 'pulley';

      // Mevcut bir milin merkezine yakın tıklandıysa eş merkezli (üst üste) ekle!
      for (const axle of state.axles) {
        if (Math.hypot(worldX - axle.x, worldY - axle.y) < 36) {
          addWheelToAxle(axle.id, { type: wheelType, r: state.selectedRadius });
          refreshAll();
          return;
        }
      }

      // Boşluğa tıklandıysa yeni mil oluştur ve mıknatıslanma uygula
      const { axle } = createAxleWithWheel({
        x: worldX,
        y: worldY,
        type: wheelType,
        r: state.selectedRadius
      });
      const snap = computeSnapPosition(axle.id, worldX, worldY);
      axle.x = snap.x;
      axle.y = snap.y;
      refreshAll();
      return;
    }

    // 2. Düz veya Çapraz Kayış Bağlama Modu
    if (state.toolMode === 'belt-open' || state.toolMode === 'belt-cross') {
      if (!hit) {
        state.beltStartWheelId = null;
        renderScene(canvas, ctx, hoverInfo);
        return;
      }

      if (!state.beltStartWheelId) {
        state.beltStartWheelId = hit.wheel.id;
        state.selectedAxleId = hit.axle.id;
        state.selectedWheelId = hit.wheel.id;
        setBanner(`🔗 İlk çark seçildi: <strong>${hit.wheel.label} (${hit.wheel.r}r)</strong>. Şimdi bağlamak istediğiniz ikinci çarka tıklayın.`);
        refreshAll();
      } else {
        const firstWheel = getWheelById(state.beltStartWheelId);
        if (firstWheel && firstWheel.axleId !== hit.axle.id) {
          const isCross = state.toolMode === 'belt-cross';
          addOrUpdateBelt(firstWheel.id, hit.wheel.id, isCross);
          state.beltStartWheelId = null;
          setBanner(`✅ <strong>${firstWheel.label}</strong> ve <strong>${hit.wheel.label}</strong> arasına ${isCross ? 'çapraz' : 'düz'} kayış bağlandı.`);
          refreshAll();
        } else {
          state.beltStartWheelId = hit.wheel.id;
          refreshAll();
        }
      }
      return;
    }

    // 3. Yük Asma Modu
    if (state.toolMode === 'add-load') {
      if (hit) {
        const load = toggleLoadOnWheel(hit.wheel.id);
        state.selectedAxleId = hit.axle.id;
        state.selectedWheelId = hit.wheel.id;
        if (load) {
          setBanner(`🏋️ <strong>${hit.wheel.label} (${hit.wheel.r}r)</strong> çarkının ${load.side === 'right' ? 'sağ' : 'sol'} kenarına yük asıldı.`);
        } else {
          setBanner(`🗑️ <strong>${hit.wheel.label}</strong> çarkındaki yük kaldırıldı.`);
        }
        refreshAll();
      }
      return;
    }

    // 4. Seç & Taşı Modu
    if (hit) {
      state.selectedAxleId = hit.axle.id;
      state.selectedWheelId = hit.wheel.id;
      draggingAxleId = hit.axle.id;
      dragOffset.x = worldX - hit.axle.x;
      dragOffset.y = worldY - hit.axle.y;
      pendingCoaxialTargetId = null;

      // Seçili çarkın yarıçap hapını sol panelde işaretle
      const rRadio = document.querySelector(`input[name="wheel-radius"][value="${hit.wheel.r}"]`);
      if (rRadio) rRadio.checked = true;
      state.selectedRadius = hit.wheel.r;

      canvas.setPointerCapture(e.pointerId);
      refreshAll();
    } else {
      state.selectedAxleId = null;
      state.selectedWheelId = null;
      isPanning = true;
      panStart.x = e.clientX - state.camera.x;
      panStart.y = e.clientY - state.camera.y;
      canvas.setPointerCapture(e.pointerId);
      refreshAll();
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const { worldX, worldY } = screenToWorld(e.clientX, e.clientY);

    if (draggingAxleId) {
      const axle = getAxleById(draggingAxleId);
      if (axle) {
        const rawX = worldX - dragOffset.x;
        const rawY = worldY - dragOffset.y;
        const snap = computeSnapPosition(draggingAxleId, rawX, rawY);

        axle.x = snap.x;
        axle.y = snap.y;
        pendingCoaxialTargetId = snap.snapType === 'coaxial' ? snap.targetAxleId : null;

        if (snap.snapType === 'coaxial') {
          setBanner('🎯 <strong>Eş Merkezli Birleştirme:</strong> Fareyi bıraktığınızda bu çark diğer milin üzerine (üst üste) yerleşecek!');
        } else if (snap.snapType === 'mesh') {
          const { myGear, otherGear } = snap.meshInfo;
          setBanner(`⚙️ <strong>Dişli Kenetlendi:</strong> ${myGear.label} (${myGear.r}r) ile ${otherGear.label} (${otherGear.r}r) dıştan temas halinde.`);
        }

        solveKinematics();
        updateStatusAndAlerts();
        updateKinematicsTableUI();
        updateLoadsAndBeltsUI();
        renderScene(canvas, ctx, hoverInfo);
      }
      return;
    }

    if (isPanning) {
      state.camera.x = e.clientX - panStart.x;
      state.camera.y = e.clientY - panStart.y;
      renderScene(canvas, ctx, hoverInfo);
      return;
    }

    // Hover önizleme bilgisi
    hoverInfo = {
      worldX,
      worldY,
      snapX: worldX,
      snapY: worldY,
      snapType: null
    };

    if (state.toolMode === 'add-gear' || state.toolMode === 'add-pulley') {
      for (const axle of state.axles) {
        if (Math.hypot(worldX - axle.x, worldY - axle.y) < 36) {
          hoverInfo.snapX = axle.x;
          hoverInfo.snapY = axle.y;
          hoverInfo.snapType = 'coaxial';
          break;
        }
      }
    }

    renderScene(canvas, ctx, hoverInfo);
  });

  canvas.addEventListener('pointerup', () => {
    if (draggingAxleId && pendingCoaxialTargetId) {
      const merged = mergeAxlesCoaxially(draggingAxleId, pendingCoaxialTargetId);
      if (merged) {
        setBanner('✅ Çarklar <strong>eş merkezli (üst üste)</strong> olarak aynı milde birleştirildi! Aynı yönde ve eşit tur sayısında dönerler.');
      } else {
        setBanner('⚠️ Hedef milde aynı yarıçaplı çark bulunduğu için birleştirilemedi.');
      }
    }
    draggingAxleId = null;
    pendingCoaxialTargetId = null;
    isPanning = false;
    refreshAll();
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom(state.camera.zoom * factor);
  }, { passive: false });

  window.addEventListener('resize', () => {
    renderScene(canvas, ctx, hoverInfo);
  });
}

function updateStatusAndAlerts() {
  jamAlert.hidden = !state.kinematics.isJammed;

  const motorAxle = state.axles.find(a => a.isMotor);
  if (motorAxle) {
    const motorWheels = getWheelsOnAxle(motorAxle.id);
    const names = motorWheels.map(w => w.label).join(', ');
    const dirStr = motorAxle.motorDir > 0 ? 'Saat Yönü ↻' : 'Saat Yönü Tersi ↺';
    hudMotorInfo.textContent = `${names}: ${motorAxle.motorTurns} Tur (${dirStr})`;
    tableRefTurns.textContent = `${motorAxle.motorTurns}`;
  } else {
    hudMotorInfo.textContent = 'Motor Seçilmedi';
    tableRefTurns.textContent = '0';
  }
}

/**
 * Sağ Paneldeki Seçili Mil / Eş Merkezli Çark Denetçisini oluşturur.
 */
function updateInspectorUI() {
  const axle = getAxleById(state.selectedAxleId);
  if (!axle) {
    inspectorContent.className = 'inspector-empty';
    inspectorContent.textContent = 'Sahneden bir çarka veya mile tıklayarak özelliklerini düzenleyebilir, aynı merkeze üst üste ikinci bir çark/kasnak ekleyebilirsiniz.';
    return;
  }

  const wheels = getWheelsOnAxle(axle.id);
  const usedRadii = new Set(wheels.map(w => w.r));
  const availableRadii = [1, 2, 3, 4].filter(r => !usedRadii.has(r));

  inspectorContent.className = 'inspector-card';
  inspectorContent.innerHTML = `
    <div class="inspector-header">
      <span class="axle-badge">📍 Mil (${wheels.map(w => w.label).join(' + ')}) ${wheels.length > 1 ? '— Eş Merkezli' : ''}</span>
      <button type="button" class="btn danger-ghost" id="ins-del-axle" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">Mili Sil</button>
    </div>

    <div class="motor-controls-box">
      <div class="motor-row">
        <label class="checkbox-row">
          <input type="checkbox" id="ins-is-motor" ${axle.isMotor ? 'checked' : ''}>
          <strong>⚡ Giriş (Motor) Mili Yap</strong>
        </label>
      </div>
      ${axle.isMotor ? `
        <div class="motor-row">
          <span>Dönüş Yönü:</span>
          <button type="button" class="btn secondary" id="ins-toggle-dir" style="padding: 0.25rem 0.55rem; font-size: 0.78rem;">
            ${axle.motorDir > 0 ? '↻ Saat Yönü' : '↺ Saat Yönü Tersi'}
          </button>
        </div>
        <div class="motor-row">
          <span>Giriş Tur Sayısı (<var>n</var>):</span>
          <select id="ins-motor-turns" style="padding: 0.2rem 0.4rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-panel);">
            ${[0.5, 1, 1.5, 2, 3, 4, 6].map(val => `<option value="${val}" ${axle.motorTurns === val ? 'selected' : ''}>${val} tur</option>`).join('')}
          </select>
        </div>
      ` : ''}
    </div>

    <div class="coaxial-stack-list">
      <span class="section-hint">Bu Merkezdeki Üst Üste Çarklar (${wheels.length} katman):</span>
      ${wheels.map(w => `
        <div class="coaxial-item ${state.selectedWheelId === w.id ? 'selected-wheel' : ''}" data-wid="${w.id}">
          <div style="display:flex; align-items:center; gap:0.4rem;">
            <span class="wheel-swatch" style="background:${w.color}"></span>
            <strong>${w.label}</strong>
            <span>(${w.type === 'gear' ? '⚙️ Dişli' : '⭕ Kasnak'})</span>
          </div>
          <div style="display:flex; align-items:center; gap:0.3rem;">
            <select class="ins-wheel-r" data-wid="${w.id}" title="Yarıçap" style="padding:0.15rem 0.3rem; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-subtle); font-weight:700;">
              ${[1, 2, 3, 4].map(rVal => `
                <option value="${rVal}" ${w.r === rVal ? 'selected' : ''} ${usedRadii.has(rVal) && w.r !== rVal ? 'disabled' : ''}>${rVal}r</option>
              `).join('')}
            </select>
            <button type="button" class="btn icon-btn ins-wheel-load" data-wid="${w.id}" title="Yük As / Değiştir" style="padding:0.15rem 0.35rem; font-size:0.75rem;">🏋️</button>
            <button type="button" class="btn danger-ghost ins-wheel-del" data-wid="${w.id}" title="Bu katmanı sil" style="padding:0.15rem 0.4rem; font-size:0.75rem;">✕</button>
          </div>
        </div>
      `).join('')}
    </div>

    ${availableRadii.length > 0 ? `
      <div class="stack-add-bar">
        <span class="section-hint" style="width:100%;">Aynı merkeze üst üste ekle (${availableRadii[0]}r):</span>
        <button type="button" class="btn secondary" id="ins-add-coaxial-gear" style="flex:1; font-size:0.76rem; padding:0.35rem;">
          + ⚙️ Dişli (${availableRadii[0]}r)
        </button>
        <button type="button" class="btn secondary" id="ins-add-coaxial-pulley" style="flex:1; font-size:0.76rem; padding:0.35rem;">
          + ⭕ Kasnak (${availableRadii[0]}r)
        </button>
      </div>
    ` : '<p class="section-hint">Bu milde tüm yarıçap katmanları (1r..4r) dolu.</p>'}
  `;

  // Inspector içi olay dinleyicileri
  document.getElementById('ins-del-axle')?.addEventListener('click', () => {
    removeAxle(axle.id);
    refreshAll();
  });

  document.getElementById('ins-is-motor')?.addEventListener('change', (e) => {
    if (e.target.checked) {
      setMotorAxle(axle.id, axle.motorDir || 1, axle.motorTurns || 1);
    } else {
      axle.isMotor = false;
    }
    refreshAll();
  });

  document.getElementById('ins-toggle-dir')?.addEventListener('click', () => {
    axle.motorDir = -axle.motorDir;
    refreshAll();
  });

  document.getElementById('ins-motor-turns')?.addEventListener('change', (e) => {
    axle.motorTurns = Number(e.target.value);
    refreshAll();
  });

  inspectorContent.querySelectorAll('.ins-wheel-r').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const w = getWheelById(e.target.dataset.wid);
      if (w) {
        w.r = Number(e.target.value);
        refreshAll();
      }
    });
  });

  inspectorContent.querySelectorAll('.ins-wheel-load').forEach(btn => {
    btn.addEventListener('click', () => {
      toggleLoadOnWheel(btn.dataset.wid);
      refreshAll();
    });
  });

  inspectorContent.querySelectorAll('.ins-wheel-del').forEach(btn => {
    btn.addEventListener('click', () => {
      removeWheel(btn.dataset.wid);
      refreshAll();
    });
  });

  document.getElementById('ins-add-coaxial-gear')?.addEventListener('click', () => {
    addWheelToAxle(axle.id, { type: 'gear', r: availableRadii[0] });
    refreshAll();
  });

  document.getElementById('ins-add-coaxial-pulley')?.addEventListener('click', () => {
    addWheelToAxle(axle.id, { type: 'pulley', r: availableRadii[0] });
    refreshAll();
  });
}

function updateKinematicsTableUI() {
  if (state.wheels.length === 0) {
    kinematicsTbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">Sahnede çark yok</td></tr>';
    return;
  }

  kinematicsTbody.innerHTML = state.wheels.map(w => {
    const kin = state.kinematics.axleResults.get(w.axleId);
    const isActive = state.selectedWheelId === w.id || state.selectedAxleId === w.axleId;

    let dirHtml = '<span class="dir-pill stopped">Duruyor</span>';
    let turnHtml = '<span class="frac">0</span>';

    if (state.kinematics.isJammed) {
      dirHtml = '<span class="dir-pill stopped">Kilitli</span>';
      turnHtml = '<span class="frac">—</span>';
    } else if (kin && kin.dir !== 0) {
      dirHtml = kin.dir > 0
        ? '<span class="dir-pill cw">↻ Saat Yönü</span>'
        : '<span class="dir-pill ccw">↺ Saat Tersi</span>';
      turnHtml = `<span class="frac">${absFracString(kin.nFrac)}</span>`;
    }

    return `
      <tr class="${isActive ? 'active-row' : ''}" data-wid="${w.id}" data-aid="${w.axleId}">
        <td>
          <span class="wheel-swatch" style="background:${w.color}; vertical-align:middle; margin-right:4px;"></span>
          <strong>${w.label}</strong>
        </td>
        <td>${w.type === 'gear' ? 'Dişli' : 'Kasnak'}</td>
        <td><strong>${w.r}<var>r</var></strong></td>
        <td>${dirHtml}</td>
        <td>${turnHtml}</td>
      </tr>
    `;
  }).join('');

  kinematicsTbody.querySelectorAll('tr[data-wid]').forEach(row => {
    row.addEventListener('click', () => {
      state.selectedAxleId = row.dataset.aid;
      state.selectedWheelId = row.dataset.wid;
      updateInspectorUI();
      updateKinematicsTableUI();
      renderScene(canvas, ctx, hoverInfo);
    });
  });
}

function updateLoadsAndBeltsUI() {
  // Asılı Yükler
  if (state.loads.length === 0) {
    loadsSection.hidden = true;
  } else {
    loadsSection.hidden = false;
    loadsSummary.innerHTML = state.loads.map(load => {
      const mov = computeLoadMovement(load);
      if (!mov) return '';
      const { wheel, piRFrac, direction } = mov;
      const hText = piRFrac.num === 0 ? '0 (Hareket Yok)' : `${absFracString(piRFrac)}πr`;
      const badge = direction === 'up'
        ? `<strong style="color:var(--success)">↑ ${hText} Yükselir</strong>`
        : direction === 'down'
          ? `<strong style="color:var(--accent-amber)">↓ ${hText} Alçalır</strong>`
          : `<span>${hText}</span>`;

      return `
        <div class="load-item">
          <span>🏋️ <strong>G (${wheel.label} - ${wheel.r}r)</strong></span>
          ${badge}
        </div>
      `;
    }).join('');
  }

  // Kayış Bağlantıları
  if (state.belts.length === 0) {
    beltsList.innerHTML = '<div class="inspector-empty">Henüz kayış bağlantısı yok. Sol panelden Düz veya Çapraz Kayış aracını seçerek bağlayabilirsiniz.</div>';
  } else {
    beltsList.innerHTML = state.belts.map(b => {
      const wA = getWheelById(b.wheelAId);
      const wB = getWheelById(b.wheelBId);
      if (!wA || !wB) return '';
      return `
        <div class="belt-item">
          <span>
            ${b.cross ? '❌ Çapraz:' : '🔗 Düz:'}
            <strong>${wA.label} (${wA.r}r)</strong> ↔ <strong>${wB.label} (${wB.r}r)</strong>
          </span>
          <div style="display:flex; gap:0.25rem;">
            <button type="button" class="btn icon-btn belt-flip-btn" data-bid="${b.id}" title="Düz / Çapraz Değiştir" style="padding:0.15rem 0.4rem; font-size:0.74rem;">⇄</button>
            <button type="button" class="btn danger-ghost belt-del-btn" data-bid="${b.id}" title="Kayışı Sil" style="padding:0.15rem 0.4rem; font-size:0.74rem;">✕</button>
          </div>
        </div>
      `;
    }).join('');

    beltsList.querySelectorAll('.belt-flip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const belt = state.belts.find(x => x.id === btn.dataset.bid);
        if (belt) {
          belt.cross = !belt.cross;
          refreshAll();
        }
      });
    });

    beltsList.querySelectorAll('.belt-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        removeBelt(btn.dataset.bid);
        refreshAll();
      });
    });
  }
}

function animationLoop(now) {
  const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  const baseSpeedRadPerSec = 1.65; // Motor 1 tur/birim hızda dönerken açısal hız
  let shouldStep = false;
  let deltaMotorRad = 0;

  if (!state.kinematics.isJammed) {
    if (state.isRunning) {
      shouldStep = true;
      deltaMotorRad = baseSpeedRadPerSec * dt;
    } else if (state.stepAnimation) {
      shouldStep = true;
      const stepDelta = baseSpeedRadPerSec * 1.4 * dt;
      const remaining = state.stepAnimation.targetRad - state.stepAnimation.elapsedRad;
      if (stepDelta >= remaining) {
        deltaMotorRad = remaining;
        state.stepAnimation = null;
      } else {
        deltaMotorRad = stepDelta;
        state.stepAnimation.elapsedRad += stepDelta;
      }
    }
  }

  if (shouldStep && deltaMotorRad > 0) {
    for (const axle of state.axles) {
      const kin = state.kinematics.axleResults.get(axle.id);
      if (kin && kin.omega !== 0) {
        axle.angle += deltaMotorRad * kin.omega;
      }
    }

    // Kayışların üzerindeki kesikli çizgilerin doğrusal hızla (v = omega * R) akması
    for (const belt of state.belts) {
      const wA = getWheelById(belt.wheelAId);
      if (wA) {
        const kinA = state.kinematics.axleResults.get(wA.axleId);
        if (kinA) {
          const linearSpeed = kinA.omega * (wA.r * BASE_R);
          belt.offset = ((belt.offset || 0) + deltaMotorRad * linearSpeed) % 1600;
        }
      }
    }

    renderScene(canvas, ctx, hoverInfo);
  }

  requestAnimationFrame(animationLoop);
}

init();

})();
