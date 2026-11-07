/**
 * Basit Makineler: Çarklar ve Kasnaklar - Durum (State) Yönetimi
 * Her mil (axle) bir merkez noktasıdır ve üzerinde 1 veya daha fazla
 * eş merkezli (üst üste binen) çark (gear) veya kasnak (pulley) taşıyabilir.
 */

export const BASE_R = 42; // 1r yarıçapın piksel karşılığı
export const TEETH_PER_R = 12; // 1r çark üzerindeki diş sayısı (2r=24, 3r=36, 4r=48)

export const WHEEL_PALETTE = [
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

export const state = {
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
export function nextId(prefix = 'id') {
  return `${prefix}_${idCounter++}`;
}

export function getNextLabel() {
  const used = new Set(state.wheels.map(w => w.label));
  for (const ch of LABELS) {
    if (!used.has(ch)) return ch;
  }
  return `Ç${state.wheels.length + 1}`;
}

export function getNextColor() {
  return WHEEL_PALETTE[state.wheels.length % WHEEL_PALETTE.length];
}

export function getAxleById(axleId) {
  return state.axles.find(a => a.id === axleId) || null;
}

export function getWheelById(wheelId) {
  return state.wheels.find(w => w.id === wheelId) || null;
}

/**
 * Bir mil üzerindeki tüm çarkları büyükten küçüğe (alttan üste doğru çizim için) döndürür.
 */
export function getWheelsOnAxle(axleId) {
  return state.wheels
    .filter(w => w.axleId === axleId)
    .sort((a, b) => b.r - a.r);
}

/**
 * Yeni bir mil ve üzerinde ilk çarkı/kasnağı oluşturur.
 */
export function createAxleWithWheel({ x, y, type = 'gear', r = 2, label = null, color = null, isMotor = false, motorDir = 1, motorTurns = 1 }) {
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
export function addWheelToAxle(axleId, { type = 'gear', r = 2, label = null, color = null }) {
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
export function mergeAxlesCoaxially(sourceAxleId, targetAxleId) {
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
export function removeWheel(wheelId) {
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
export function removeAxle(axleId) {
  const wheels = getWheelsOnAxle(axleId);
  for (const w of wheels) {
    removeWheel(w.id);
  }
}

/**
 * İki çark/kasnak arasına düz veya çapraz kayış ekler.
 */
export function addOrUpdateBelt(wheelAId, wheelBId, cross = false) {
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

export function removeBelt(beltId) {
  state.belts = state.belts.filter(b => b.id !== beltId);
}

/**
 * Bir çarka/kasnağa yük (ağırlık) bağlar veya yönünü (sol/sağ ip) değiştirir.
 */
export function toggleLoadOnWheel(wheelId) {
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

export function setMotorAxle(axleId, dir = 1, turns = 1) {
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

export function clearScene() {
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
