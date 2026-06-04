const SAVE_KEY = "neonIdlePinballSave.v1";

const canvas = document.getElementById("pinballCanvas");
const ctx = canvas.getContext("2d");

const ui = {
  energy: document.getElementById("energyValue"),
  baseReward: document.getElementById("baseRewardValue"),
  dropInterval: document.getElementById("dropIntervalValue"),
  machineLevel: document.getElementById("machineLevelValue"),
  bonusGaugeText: document.getElementById("bonusGaugeText"),
  bonusGaugeFill: document.getElementById("bonusGaugeFill"),
  bonusGaugeCard: document.getElementById("bonusGaugeCard"),
  nextDrop: document.getElementById("nextDropValue"),
  upgradeList: document.getElementById("upgradeList"),
  offlineNotice: document.getElementById("offlineNotice"),
  soundToggle: document.getElementById("soundToggle"),
};

const slots = [
  {
    id: "stable",
    name: "Stable",
    label: "Stable Slot",
    effect: "x1.2",
    detail: "+8 Gauge",
    multiplier: 1.2,
    gaugeGain: 8,
  },
  {
    id: "boost",
    name: "Boost",
    label: "Boost Slot",
    effect: "x1.8",
    detail: "+10 Gauge",
    multiplier: 1.8,
    gaugeGain: 10,
  },
  {
    id: "core",
    name: "Core",
    label: "Core Slot",
    effect: "x3.0 · +20",
    detail: "+20 Gauge",
    multiplier: 3,
    gaugeGain: 20,
  },
  {
    id: "speed",
    name: "Speed",
    label: "Speed Slot",
    effect: "x1.5 · -Wait",
    detail: "-Wait",
    multiplier: 1.5,
    gaugeGain: 10,
    nextDelayFactor: 0.5,
  },
  {
    id: "charge",
    name: "Charge",
    label: "Charge Slot",
    effect: "x1.0 · +15",
    detail: "+15 Gauge",
    multiplier: 1,
    gaugeGain: 15,
  },
];
const slotMultipliers = slots.map((slot) => slot.multiplier);
const averageSlotMultiplier =
  slotMultipliers.reduce((sum, value) => sum + value, 0) / slotMultipliers.length;
const dropSpeedIntervals = [0, 10, 8, 6, 4, 2, 0];
const machineLevelThresholds = [0, 1_000, 10_000, 100_000, 1_000_000];

const UPGRADE_CLICK_COOLDOWN_MS = 150;
const UPGRADE_FLASH_MS = 360;
const PEG_FLASH_SECONDS = 0.16;
const BALL_TIMEOUT_SECONDS = 20;
const BONUS_GAUGE_MAX = 100;
const BONUS_READY_MULTIPLIER = 5;
const VELOCITY_UNIT = 60;
const MAX_VELOCITY_X = 8 * VELOCITY_UNIT;
const MAX_VELOCITY_Y = 12 * VELOCITY_UNIT;
const COLLISION_DAMPING = 0.965;

const upgrades = [
  {
    id: "energyValue",
    name: "Energy Value",
    description: "提高每次結算的基礎 Energy 收益。",
    baseCost: 35,
    growth: 1.55,
  },
  {
    id: "dropSpeed",
    name: "Drop Speed",
    description: "依等級縮短落球等待，Lv.6 結算後無延遲。",
    baseCost: 55,
    growth: 1.7,
    maxLevel: 6,
  },
  {
    id: "bouncePower",
    name: "Bounce Power",
    description: "提高球撞擊釘子後的反彈力。",
    baseCost: 40,
    growth: 1.6,
    maxLevel: 12,
  },
  {
    id: "scoreMultiplier",
    name: "Score Multiplier",
    description: "提高全部得分槽結算後的總收益倍率。",
    baseCost: 85,
    growth: 1.85,
  },
];

const defaultLevels = upgrades.reduce((levels, upgrade) => {
  levels[upgrade.id] = upgrade.id === "dropSpeed" ? 1 : 0;
  return levels;
}, {});

const state = {
  energy: 0,
  levels: { ...defaultLevels },
  ball: null,
  pegs: [],
  effects: [],
  spawnTimer: 1.2,
  lastFrame: 0,
  width: 480,
  height: 680,
  dpr: 1,
  saveTimer: 0,
  lastScoreText: "",
  totalEarnedEnergy: 0,
  machineLevel: 1,
  bonusGauge: 0,
  bonusReady: false,
  slotFlashes: slots.map(() => 0),
  upgradeCooldownUntil: {},
  upgradeFlashUntil: {},
};

const audio = {
  enabled: false,
  unlocked: false,
  context: null,
  lastPegSoundAt: 0,
};

function loadSave() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) {
    return;
  }

  try {
    const save = JSON.parse(raw);
    if (Number.isFinite(save.energy)) {
      state.energy = Math.max(0, save.energy);
    }

    if (Number.isFinite(save.totalEarnedEnergy)) {
      state.totalEarnedEnergy = Math.max(0, save.totalEarnedEnergy, state.energy);
    } else {
      state.totalEarnedEnergy = Math.max(0, state.energy);
    }

    if (save.levels && typeof save.levels === "object") {
      for (const upgrade of upgrades) {
        const savedLevel = Number(save.levels[upgrade.id]);
        const minLevel = upgrade.id === "dropSpeed" ? 1 : 0;
        const normalizedLevel = Number.isFinite(savedLevel)
          ? Math.max(minLevel, Math.floor(savedLevel))
          : minLevel;
        state.levels[upgrade.id] = upgrade.maxLevel
          ? Math.min(upgrade.maxLevel, normalizedLevel)
          : normalizedLevel;
      }
    }

    if (Number.isFinite(save.machineLevel)) {
      state.machineLevel = Math.max(1, Math.min(5, Math.floor(save.machineLevel)));
    }

    if (Number.isFinite(save.bonusGauge)) {
      state.bonusGauge = Math.max(0, Math.min(BONUS_GAUGE_MAX, save.bonusGauge));
    }

    state.bonusReady = Boolean(save.bonusReady);
    if (state.bonusGauge >= BONUS_GAUGE_MAX) {
      state.bonusGauge = BONUS_GAUGE_MAX;
      state.bonusReady = true;
    }
    audio.enabled = Boolean(save.audioEnabled);

    if (Number.isFinite(save.lastSeen)) {
      applyOfflineEarnings(save.lastSeen);
    }

    syncMachineLevel({ notify: false });
  } catch (error) {
    console.warn("Save data could not be loaded.", error);
  }
}

function persist() {
  localStorage.setItem(
    SAVE_KEY,
    JSON.stringify({
      energy: state.energy,
      levels: state.levels,
      totalEarnedEnergy: state.totalEarnedEnergy,
      machineLevel: state.machineLevel,
      bonusGauge: state.bonusGauge,
      bonusReady: state.bonusReady,
      audioEnabled: audio.enabled,
      lastSeen: Date.now(),
    })
  );
}

function applyOfflineEarnings(lastSeen) {
  const elapsedSeconds = Math.max(0, (Date.now() - lastSeen) / 1000);
  if (elapsedSeconds < 20) {
    return;
  }

  const onlineEstimatePerSecond =
    (getBaseReward() * averageSlotMultiplier * getScoreMultiplier()) /
    (getDropInterval() + 2.4);
  const offlineGain = Math.floor(onlineEstimatePerSecond * elapsedSeconds * 0.3);

  if (offlineGain <= 0) {
    return;
  }

  const previousLevel = state.machineLevel;
  addEnergy(offlineGain, { notifyMachineLevel: false });
  const levelText =
    state.machineLevel > previousLevel ? ` · Machine Level Up! Lv.${state.machineLevel}` : "";
  showNotice(`離線期間獲得 ${formatNumber(offlineGain)} Energy${levelText}`);
  persist();
}

function addEnergy(amount, options = {}) {
  const { notifyMachineLevel = true } = options;
  const gain = Math.max(0, amount);
  if (gain <= 0) {
    return false;
  }

  state.energy += gain;
  state.totalEarnedEnergy += gain;
  return syncMachineLevel({ notify: notifyMachineLevel });
}

function calculateMachineLevel() {
  let level = 1;
  for (let index = 0; index < machineLevelThresholds.length; index += 1) {
    if (state.totalEarnedEnergy >= machineLevelThresholds[index]) {
      level = index + 1;
    }
  }
  return Math.max(1, Math.min(5, level));
}

function syncMachineLevel(options = {}) {
  const { notify = false } = options;
  const nextLevel = calculateMachineLevel();
  const leveledUp = nextLevel > state.machineLevel;

  state.machineLevel = nextLevel;
  applyMachineLevelVisuals();

  if (leveledUp && notify) {
    showNotice(`Machine Level Up! Lv.${nextLevel}`);
  }

  return leveledUp;
}

function applyMachineLevelVisuals() {
  document.body.dataset.machineLevel = String(state.machineLevel);
}

function showNotice(message) {
  ui.offlineNotice.textContent = message;
  ui.offlineNotice.hidden = false;
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => {
    ui.offlineNotice.hidden = true;
  }, 5200);
}

function setupAudioToggle() {
  if (!ui.soundToggle) {
    return;
  }

  ui.soundToggle.addEventListener("click", () => {
    audio.enabled = !audio.enabled;
    if (audio.enabled) {
      unlockAudio();
    }
    updateSoundToggle();
    persist();
  });

  document.addEventListener(
    "pointerdown",
    () => {
      if (audio.enabled) {
        unlockAudio();
      }
    },
    { once: true }
  );

  updateSoundToggle();
}

function updateSoundToggle() {
  if (!ui.soundToggle) {
    return;
  }

  ui.soundToggle.textContent = audio.enabled ? "音效：開" : "音效：關";
  ui.soundToggle.setAttribute("aria-pressed", String(audio.enabled));
}

function getAudioContext() {
  if (audio.context) {
    return audio.context;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }

  try {
    audio.context = new AudioContextClass();
  } catch (error) {
    audio.enabled = false;
    updateSoundToggle();
    return null;
  }

  return audio.context;
}

function unlockAudio() {
  const context = getAudioContext();
  if (!context) {
    return;
  }

  audio.unlocked = true;
  if (context.state === "suspended") {
    context.resume().catch(() => {});
  }
}

function playTone(frequency, duration, type = "sine", volume = 0.035) {
  if (!audio.enabled || !audio.unlocked) {
    return;
  }

  const context = getAudioContext();
  if (!context) {
    return;
  }

  try {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  } catch (error) {
    audio.enabled = false;
    updateSoundToggle();
  }
}

function playPegSound(impact) {
  const now = performance.now();
  if (now - audio.lastPegSoundAt < 55) {
    return;
  }

  audio.lastPegSoundAt = now;
  const frequency = 320 + Math.min(impact, 360) * 0.45;
  playTone(frequency, 0.045, "triangle", 0.024);
}

function playScoreSound(multiplier) {
  playTone(420 + multiplier * 115, 0.12, "sine", 0.04);
}

function getBaseReward() {
  return 10 + state.levels.energyValue * 5;
}

function getDropInterval() {
  const level = getDropSpeedLevel();
  return dropSpeedIntervals[level] ?? dropSpeedIntervals[0];
}

function getDropSpeedLevel() {
  return Math.max(1, Math.min(6, state.levels.dropSpeed || 1));
}

function isInstantDrop() {
  return getDropSpeedLevel() >= 6;
}

function formatDropInterval() {
  return isInstantDrop() ? "Instant" : `${getDropInterval().toFixed(1)} 秒`;
}

function getBounceRestitution() {
  return Math.min(0.72, 0.6 + state.levels.bouncePower * 0.01);
}

function getScoreMultiplier() {
  return 1 + state.levels.scoreMultiplier * 0.18;
}

function getUpgradeCost(upgrade) {
  const level = state.levels[upgrade.id] || 0;
  const costLevel = upgrade.id === "dropSpeed" ? Math.max(0, level - 1) : level;
  return Math.floor(upgrade.baseCost * upgrade.growth ** costLevel);
}

function getUpgradeEffectLabel(upgrade) {
  const level = state.levels[upgrade.id] || 0;
  if (upgrade.id === "energyValue") {
    return `基礎 +${level * 5}`;
  }
  if (upgrade.id === "dropSpeed") {
    return formatDropInterval();
  }
  if (upgrade.id === "bouncePower") {
    return `反彈 ${(getBounceRestitution() * 100).toFixed(0)}%`;
  }
  return `總倍率 x${getScoreMultiplier().toFixed(2)}`;
}

function canBuy(upgrade) {
  if (upgrade.maxLevel && state.levels[upgrade.id] >= upgrade.maxLevel) {
    return false;
  }
  return state.energy >= getUpgradeCost(upgrade);
}

function buyUpgrade(id) {
  const upgrade = upgrades.find((item) => item.id === id);
  if (!upgrade) {
    return;
  }

  const now = Date.now();
  if ((state.upgradeCooldownUntil[id] || 0) > now) {
    return;
  }

  state.upgradeCooldownUntil[id] = now + UPGRADE_CLICK_COOLDOWN_MS;

  if (!canBuy(upgrade)) {
    updateUI();
    return;
  }

  const cost = getUpgradeCost(upgrade);
  state.energy -= cost;
  state.levels[id] += 1;
  state.upgradeFlashUntil[id] = now + UPGRADE_FLASH_MS;
  persist();
  updateUI();
}

function createUpgradeButtons() {
  ui.upgradeList.innerHTML = "";
  for (const upgrade of upgrades) {
    const card = document.createElement("article");
    card.className = "upgrade-card";

    const title = document.createElement("h3");
    title.textContent = upgrade.name;

    const description = document.createElement("p");
    description.textContent = upgrade.description;

    const meta = document.createElement("div");
    meta.className = "upgrade-meta";

    const level = document.createElement("span");
    level.dataset.role = "level";

    const effect = document.createElement("span");
    effect.dataset.role = "effect";

    meta.append(level, effect);

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.upgradeId = upgrade.id;
    button.addEventListener("click", () => buyUpgrade(upgrade.id));

    card.append(title, description, meta, button);
    ui.upgradeList.append(card);
  }
}

function updateUpgradeButtons() {
  const now = Date.now();

  for (const card of ui.upgradeList.querySelectorAll(".upgrade-card")) {
    const button = card.querySelector("button");
    const upgrade = upgrades.find((item) => item.id === button.dataset.upgradeId);
    const level = state.levels[upgrade.id] || 0;
    const isMaxed = Boolean(upgrade.maxLevel && level >= upgrade.maxLevel);
    const isCooling = (state.upgradeCooldownUntil[upgrade.id] || 0) > now;

    card.classList.toggle(
      "is-flashing",
      (state.upgradeFlashUntil[upgrade.id] || 0) > now
    );

    card.querySelector('[data-role="level"]').textContent = upgrade.maxLevel
      ? `Lv ${level}/${upgrade.maxLevel}`
      : `Lv ${level}`;
    card.querySelector('[data-role="effect"]').textContent =
      getUpgradeEffectLabel(upgrade);

    if (isMaxed) {
      button.textContent = "已達上限";
      button.disabled = true;
    } else {
      const cost = getUpgradeCost(upgrade);
      button.textContent = `升級：${formatNumber(cost)} Energy`;
      button.disabled = isCooling || state.energy < cost;
    }
  }
}

function updateUI() {
  ui.energy.textContent = formatNumber(Math.floor(state.energy));
  ui.baseReward.textContent = formatNumber(getBaseReward());
  ui.dropInterval.textContent = `Lv.${getDropSpeedLevel()} · ${formatDropInterval()}`;
  ui.machineLevel.textContent = `Lv.${state.machineLevel}`;

  const bonusPercent = state.bonusReady
    ? 100
    : Math.max(0, Math.min(100, state.bonusGauge));
  ui.bonusGaugeText.textContent = state.bonusReady
    ? `Ready x${BONUS_READY_MULTIPLIER}`
    : `${Math.floor(state.bonusGauge)} / ${BONUS_GAUGE_MAX}`;
  ui.bonusGaugeFill.style.width = `${bonusPercent}%`;
  ui.bonusGaugeCard.classList.toggle("is-ready", state.bonusReady);
  applyMachineLevelVisuals();

  if (state.ball) {
    ui.nextDrop.textContent = "結算中";
  } else if (isInstantDrop()) {
    ui.nextDrop.textContent = "無延遲";
  } else {
    ui.nextDrop.textContent = `${Math.max(0, state.spawnTimer).toFixed(1)} 秒`;
  }

  updateUpgradeButtons();
}

function formatNumber(value) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 10_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return Math.floor(value).toLocaleString("zh-Hant");
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(320, rect.width);
  const height = Math.max(390, rect.height);

  state.width = width;
  state.height = height;
  state.dpr = dpr;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  buildPegs();
}

function buildPegs() {
  const width = state.width;
  const height = state.height;
  const top = height * 0.18;
  const rowGap = height * 0.08;
  const radius = Math.max(5.5, Math.min(8, width * 0.015));
  const pegs = [];

  for (let row = 0; row < 7; row += 1) {
    const count = row % 2 === 0 ? 5 : 6;
    const usableWidth = width * 0.74;
    const startX = (width - usableWidth) / 2;
    const step = usableWidth / (count - 1);
    const y = top + row * rowGap;

    for (let col = 0; col < count; col += 1) {
      pegs.push({
        x: startX + col * step,
        y,
        r: radius,
        flash: 0,
      });
    }
  }

  state.pegs = pegs;
}

function spawnBall() {
  const radius = Math.max(9, Math.min(13, state.width * 0.024));
  state.ball = {
    x: state.width / 2 + (Math.random() - 0.5) * state.width * 0.14,
    y: 34,
    vx: (Math.random() - 0.5) * 80,
    vy: 20,
    r: radius,
    age: 0,
    trail: [],
  };
}

function update(dt) {
  const safeDt = Math.min(dt, 0.034);

  if (!state.ball) {
    if (isInstantDrop()) {
      spawnBall();
    } else {
      state.spawnTimer -= safeDt;
      if (state.spawnTimer <= 0) {
        spawnBall();
      }
    }
  } else {
    updateBall(state.ball, safeDt);
  }

  updatePegs(safeDt);
  updateSlotFlashes(safeDt);
  updateEffects(safeDt);

  state.saveTimer += safeDt;
  if (state.saveTimer > 5) {
    state.saveTimer = 0;
    persist();
  }
}

function updateBall(ball, dt) {
  const gravity = 780;
  ball.age += dt;
  ball.vy += gravity * dt;
  clampBallVelocity(ball);
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  ball.trail.push({ x: ball.x, y: ball.y });
  if (ball.trail.length > 5) {
    ball.trail.shift();
  }

  handleWallCollision(ball);

  for (const peg of state.pegs) {
    resolveCircleCollision(ball, peg);
  }

  const catchLine = getSlotTop() + Math.max(18, state.height * 0.035);
  if (ball.y + ball.r >= catchLine) {
    scoreBall(ball);
    return;
  }

  if (ball.age >= BALL_TIMEOUT_SECONDS) {
    scoreBall(ball, getLowestSlotIndex());
  }
}

function handleWallCollision(ball) {
  const restitution = 0.72;
  const left = 18 + ball.r;
  const right = state.width - 18 - ball.r;
  let collided = false;

  if (ball.x < left) {
    ball.x = left;
    ball.vx = Math.abs(ball.vx) * restitution;
    collided = true;
  } else if (ball.x > right) {
    ball.x = right;
    ball.vx = -Math.abs(ball.vx) * restitution;
    collided = true;
  }

  if (ball.y < ball.r) {
    ball.y = ball.r;
    ball.vy = Math.abs(ball.vy) * restitution;
    collided = true;
  }

  if (collided) {
    applyCollisionDamping(ball);
  }
}

function resolveCircleCollision(ball, peg) {
  const dx = ball.x - peg.x;
  const dy = ball.y - peg.y;
  const minDistance = ball.r + peg.r;
  const distanceSquared = dx * dx + dy * dy;

  if (distanceSquared >= minDistance * minDistance || distanceSquared === 0) {
    return;
  }

  const distance = Math.sqrt(distanceSquared);
  const nx = dx / distance;
  const ny = dy / distance;
  const overlap = minDistance - distance;

  ball.x += nx * overlap;
  ball.y += ny * overlap;

  const velocityAlongNormal = ball.vx * nx + ball.vy * ny;
  if (velocityAlongNormal < 0) {
    const restitution = getBounceRestitution();
    const impulse = -(1 + restitution) * velocityAlongNormal;
    ball.vx += impulse * nx;
    ball.vy += impulse * ny;

    const kick = 7 + state.levels.bouncePower * 0.75;
    ball.vx += nx * kick + (Math.random() - 0.5) * 6;
    ball.vy += ny * kick * 0.18;
    peg.flash = PEG_FLASH_SECONDS;
    playPegSound(Math.abs(velocityAlongNormal));
    applyCollisionDamping(ball);
  }
}

function clampBallVelocity(ball) {
  ball.vx = clamp(ball.vx, -MAX_VELOCITY_X, MAX_VELOCITY_X);
  ball.vy = clamp(ball.vy, -MAX_VELOCITY_Y, MAX_VELOCITY_Y);
}

function applyCollisionDamping(ball) {
  ball.vx *= COLLISION_DAMPING;
  ball.vy *= COLLISION_DAMPING;
  clampBallVelocity(ball);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getSlotTop() {
  return state.height - Math.max(82, state.height * 0.14);
}

function getLowestSlotIndex() {
  let lowestIndex = 0;
  for (let index = 1; index < slotMultipliers.length; index += 1) {
    if (slotMultipliers[index] < slotMultipliers[lowestIndex]) {
      lowestIndex = index;
    }
  }
  return lowestIndex;
}

function scoreBall(ball, forcedSlotIndex = null) {
  const slotWidth = state.width / slots.length;
  const slotIndex =
    forcedSlotIndex === null
      ? Math.max(
          0,
          Math.min(slots.length - 1, Math.floor(ball.x / slotWidth))
        )
      : Math.max(0, Math.min(slots.length - 1, forcedSlotIndex));
  const slot = slots[slotIndex];
  const consumedBonus = state.bonusReady;
  const bonusMultiplier = consumedBonus ? BONUS_READY_MULTIPLIER : 1;
  const reward = Math.floor(
    getBaseReward() * slot.multiplier * getScoreMultiplier() * bonusMultiplier
  );

  addEnergy(reward);
  state.lastScoreText = `+${formatNumber(reward)} Energy`;
  state.effects.push({
    text: state.lastScoreText,
    x: slotWidth * slotIndex + slotWidth / 2,
    y: getSlotTop() - 12,
    age: 0,
  });
  if (consumedBonus) {
    state.effects.push({
      text: `Bonus x${BONUS_READY_MULTIPLIER}`,
      x: slotWidth * slotIndex + slotWidth / 2,
      y: getSlotTop() - 34,
      age: 0,
    });
  }

  applyBonusGauge(slot, consumedBonus);
  state.slotFlashes[slotIndex] = 0.38;
  playScoreSound(slot.multiplier);
  state.ball = null;
  state.spawnTimer = getNextDropDelay(slot);
  if (isInstantDrop()) {
    spawnBall();
  }
  persist();
  updateUI();
}

function updatePegs(dt) {
  for (const peg of state.pegs) {
    peg.flash = Math.max(0, peg.flash - dt);
  }
}

function updateSlotFlashes(dt) {
  for (let index = 0; index < state.slotFlashes.length; index += 1) {
    state.slotFlashes[index] = Math.max(0, state.slotFlashes[index] - dt);
  }
}

function applyBonusGauge(slot, consumedBonus) {
  if (consumedBonus) {
    state.bonusGauge = 0;
    state.bonusReady = false;
    return;
  }

  state.bonusGauge = Math.min(BONUS_GAUGE_MAX, state.bonusGauge + slot.gaugeGain);
  if (state.bonusGauge >= BONUS_GAUGE_MAX) {
    state.bonusGauge = BONUS_GAUGE_MAX;
    state.bonusReady = true;
    showNotice(`Bonus Ready! 下一球 x${BONUS_READY_MULTIPLIER}`);
  }
}

function getNextDropDelay(slot) {
  if (isInstantDrop()) {
    return 0;
  }

  const interval = getDropInterval();
  if (slot.nextDelayFactor) {
    return Math.max(0.5, interval * slot.nextDelayFactor);
  }
  return interval;
}

function updateEffects(dt) {
  for (const effect of state.effects) {
    effect.age += dt;
    effect.y -= 24 * dt;
  }
  state.effects = state.effects.filter((effect) => effect.age < 1.1);
}

function render() {
  const width = state.width;
  const height = state.height;

  ctx.clearRect(0, 0, width, height);
  drawBoardBackground(width, height);
  drawPegs();
  drawSlots();
  drawBall();
  drawEffects();
  drawBoardFrame(width, height);
}

function drawBoardBackground(width, height) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#11100c");
  gradient.addColorStop(0.52, "#070706");
  gradient.addColorStop(1, "#171006");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = state.machineLevel >= 2 ? 0.48 : 0.36;
  ctx.strokeStyle = "rgba(255, 216, 107, 0.13)";
  ctx.lineWidth = 1;
  const spacing = 34;
  for (let y = 18; y < height; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(18, y);
    ctx.lineTo(width - 18, y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = "rgba(88, 246, 255, 0.16)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width * 0.18, 44);
  ctx.quadraticCurveTo(width * 0.5, 8, width * 0.82, 44);
  ctx.stroke();
  ctx.restore();
}

function drawBoardFrame(width, height) {
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle =
    state.machineLevel >= 5 || state.bonusReady
      ? "rgba(88, 246, 255, 0.82)"
      : "rgba(255, 216, 107, 0.72)";
  ctx.shadowColor = state.bonusReady
    ? "rgba(88, 246, 255, 0.45)"
    : "rgba(255, 216, 107, 0.18)";
  ctx.shadowBlur = state.machineLevel >= 5 || state.bonusReady ? 18 : 6;
  roundedRect(9, 9, width - 18, height - 18, 12);
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(88, 246, 255, 0.32)";
  roundedRect(17, 17, width - 34, height - 34, 8);
  ctx.stroke();
  ctx.restore();
}

function drawPegs() {
  for (const peg of state.pegs) {
    const flash = Math.max(0, Math.min(1, peg.flash / PEG_FLASH_SECONDS));
    const glowRadius = peg.r * (3.2 + flash * 2);
    const glow = ctx.createRadialGradient(peg.x, peg.y, 1, peg.x, peg.y, glowRadius);
    glow.addColorStop(
      0,
      flash > 0
        ? "rgba(88, 246, 255, 0.85)"
        : "rgba(255, 226, 135, 0.78)"
    );
    glow.addColorStop(1, "rgba(255, 216, 107, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(peg.x, peg.y, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = flash > 0 ? "#e9ffff" : "#f6cf68";
    ctx.strokeStyle =
      flash > 0 ? "rgba(88, 246, 255, 0.88)" : "rgba(255, 255, 255, 0.58)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(peg.x, peg.y, peg.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawSlots() {
  const slotTop = getSlotTop();
  const slotWidth = state.width / slots.length;

  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.34)";
  ctx.fillRect(18, slotTop, state.width - 36, state.height - slotTop - 18);

  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const x = index * slotWidth;
    const isCenter = slot.id === "core";
    const flash = Math.max(0, Math.min(1, state.slotFlashes[index] / 0.38));
    const gradient = ctx.createLinearGradient(0, slotTop, 0, state.height);
    gradient.addColorStop(
      0,
      isCenter
        ? `rgba(255, 216, 107, ${0.32 + flash * 0.22})`
        : `rgba(255, 216, 107, ${0.13 + flash * 0.18})`
    );
    gradient.addColorStop(1, flash > 0 ? "rgba(88, 246, 255, 0.12)" : "rgba(255, 216, 107, 0.03)");
    ctx.fillStyle = gradient;
    ctx.fillRect(x + 2, slotTop + 2, slotWidth - 4, state.height - slotTop - 20);

    ctx.strokeStyle =
      flash > 0
        ? "rgba(88, 246, 255, 0.82)"
        : state.machineLevel >= 3
          ? "rgba(255, 216, 107, 0.68)"
          : "rgba(255, 216, 107, 0.45)";
    ctx.lineWidth = state.machineLevel >= 3 || flash > 0 ? 2 : 1.5;
    ctx.beginPath();
    ctx.moveTo(x, slotTop);
    ctx.lineTo(x, state.height - 18);
    ctx.stroke();

    ctx.fillStyle = isCenter ? "#fff0a8" : "#ffd86b";
    ctx.font = `800 ${Math.max(12, state.width * 0.029)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(255, 216, 107, 0.45)";
    ctx.shadowBlur = isCenter || flash > 0 ? 14 : 8;
    ctx.fillText(slot.name, x + slotWidth / 2, slotTop + 24);
    ctx.font = `800 ${Math.max(14, state.width * 0.034)}px sans-serif`;
    ctx.fillText(`x${slot.multiplier.toFixed(1)}`, x + slotWidth / 2, slotTop + 47);
    ctx.font = `700 ${Math.max(10, state.width * 0.022)}px sans-serif`;
    ctx.fillStyle = flash > 0 ? "#dffcff" : "#e8dca9";
    ctx.fillText(slot.detail, x + slotWidth / 2, slotTop + 66);
    ctx.shadowBlur = 0;
  }

  ctx.strokeStyle = "rgba(255, 216, 107, 0.72)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(18, slotTop);
  ctx.lineTo(state.width - 18, slotTop);
  ctx.stroke();
  ctx.restore();
}

function drawBall() {
  const ball = state.ball;
  if (!ball) {
    drawDropPreview();
    return;
  }

  ctx.save();
  for (let index = 0; index < ball.trail.length; index += 1) {
    const point = ball.trail[index];
    const alpha = (index + 1) / ball.trail.length;
    ctx.fillStyle = `rgba(88, 246, 255, ${alpha * 0.08})`;
    ctx.beginPath();
    ctx.arc(point.x, point.y, ball.r * (0.7 + alpha * 0.35), 0, Math.PI * 2);
    ctx.fill();
  }

  const glow = ctx.createRadialGradient(ball.x, ball.y, 1, ball.x, ball.y, ball.r * 3);
  glow.addColorStop(0, "rgba(88, 246, 255, 0.56)");
  glow.addColorStop(1, "rgba(88, 246, 255, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.r * 3, 0, Math.PI * 2);
  ctx.fill();

  const gradient = ctx.createRadialGradient(
    ball.x - ball.r * 0.35,
    ball.y - ball.r * 0.42,
    ball.r * 0.2,
    ball.x,
    ball.y,
    ball.r
  );
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.26, "#bdfcff");
  gradient.addColorStop(1, "#1ba6b4");
  ctx.fillStyle = gradient;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawDropPreview() {
  const interval = getDropInterval();
  const progress =
    interval <= 0 ? 1 : 1 - Math.max(0, Math.min(1, state.spawnTimer / interval));
  const x = state.width / 2;
  const y = 36;

  ctx.save();
  ctx.globalAlpha = 0.45 + progress * 0.4;
  ctx.strokeStyle = "rgba(88, 246, 255, 0.65)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 9 + progress * 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(88, 246, 255, 0.14)";
  ctx.beginPath();
  ctx.arc(x, y, 4 + progress * 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawEffects() {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${Math.max(14, state.width * 0.035)}px sans-serif`;
  for (const effect of state.effects) {
    const alpha = Math.max(0, 1 - effect.age / 1.1);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#fff0a8";
    ctx.shadowColor = "rgba(255, 216, 107, 0.5)";
    ctx.shadowBlur = 10;
    ctx.fillText(effect.text, effect.x, effect.y);
  }
  ctx.restore();
}

function roundedRect(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function loop(timestamp) {
  if (!state.lastFrame) {
    state.lastFrame = timestamp;
  }

  const dt = (timestamp - state.lastFrame) / 1000;
  state.lastFrame = timestamp;
  update(dt);
  render();
  updateUI();
  requestAnimationFrame(loop);
}

window.addEventListener("resize", resizeCanvas);
window.addEventListener("pagehide", persist);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    persist();
  }
});

loadSave();
setupAudioToggle();
createUpgradeButtons();
resizeCanvas();
updateUI();
requestAnimationFrame(loop);
