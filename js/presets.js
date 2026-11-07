/**
 * Basit Makineler: Hazır Ders Düzenekleri (Presets)
 */

import {
  BASE_R,
  clearScene,
  createAxleWithWheel,
  addWheelToAxle,
  addOrUpdateBelt,
  toggleLoadOnWheel,
  state
} from './state.js';

export function loadPreset(presetKey) {
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
