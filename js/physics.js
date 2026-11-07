/**
 * Basit Makineler: Kinematik Çözücü, Kesir Hesaplayıcı ve Mıknatıslanma (Snap) Motoru
 */

import { state, BASE_R, TEETH_PER_R, getAxleById, getWheelById, getWheelsOnAxle } from './state.js';

export function gcd(a, b) {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a || 1;
}

export function makeFrac(num, den = 1) {
  if (den === 0) return { num: 0, den: 1 };
  const sign = (num < 0) !== (den < 0) ? -1 : 1;
  const g = gcd(num, den);
  return {
    num: sign * (Math.abs(Math.round(num)) / g),
    den: Math.abs(Math.round(den)) / g
  };
}

export function mulFrac(f1, f2) {
  return makeFrac(f1.num * f2.num, f1.den * f2.den);
}

export function eqFrac(f1, f2) {
  return f1.num * f2.den === f2.num * f1.den;
}

export function absFracString(frac) {
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
export function solveKinematics() {
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
export function computeSnapPosition(draggedAxleId, rawX, rawY) {
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
export function computeLoadMovement(load) {
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
