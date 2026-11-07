/**
 * Basit Makineler: Ana Uygulama, Etkileşim ve Animasyon Döngüsü
 */

import {
  state,
  BASE_R,
  getAxleById,
  getWheelById,
  getWheelsOnAxle,
  createAxleWithWheel,
  addWheelToAxle,
  mergeAxlesCoaxially,
  removeWheel,
  removeAxle,
  addOrUpdateBelt,
  removeBelt,
  toggleLoadOnWheel,
  setMotorAxle,
  clearScene
} from './state.js';

import {
  solveKinematics,
  computeSnapPosition,
  absFracString,
  computeLoadMovement
} from './physics.js';

import { renderScene, isDarkModeActive } from './renderer.js';
import { loadPreset } from './presets.js';

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
