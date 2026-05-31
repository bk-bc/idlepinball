const SAVE_KEY = "neonIdlePinballSave.v1";

const canvas = document.getElementById("pinballCanvas");
const ctx = canvas.getContext("2d");

const ui = {
  energy: document.getElementById("energyValue"),
  baseReward: document.getElementById("baseRewardValue"),
  dropInterval: document.getElementById("dropIntervalValue"),
  nextDrop: document.getElementById("nextDropValue"),
  upgradeList: document.getElementById("upgradeList"),
  offlineNotice: document.getElementById("offlineNotice"),
};

const slotMultipliers = [1, 2, 3, 2, 1];
const averageSlotMultiplier =
  slotMultipliers.reduce((sum, value) => sum + value, 0) / slotMultipliers.length;

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
    description: "降低自動落球間隔，最低 3 秒。",
    baseCost: 55,
    growth: 1.7,
    maxLevel: 10,
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
  levels[upgrade.id] = 0;
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

    if (save.levels && typeof save.levels === "object") {
      for (const upgrade of upgrades) {
        const savedLevel = Number(save.levels[upgrade.id]);
        state.levels[upgrade.id] = Number.isFinite(savedLevel)
          ? Math.max(0, Math.floor(savedLevel))
          : 0;
      }
    }

    if (Number.isFinite(save.lastSeen)) {
      applyOfflineEarnings(save.lastSeen);
    }
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

  state.energy += offlineGain;
  showNotice(`離線收益 +${formatNumber(offlineGain)} Energy`);
}

function showNotice(message) {
  ui.offlineNotice.textContent = message;
  ui.offlineNotice.hidden = false;
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => {
    ui.offlineNotice.hidden = true;
  }, 5200);
}

function getBaseReward() {
  return 10 + state.levels.energyValue * 5;
}

function getDropInterval() {
  return Math.max(3, 8 - state.levels.dropSpeed * 0.5);
}

function getBounceRestitution() {
  return Math.min(0.98, 0.64 + state.levels.bouncePower * 0.035);
}

function getScoreMultiplier() {
  return 1 + state.levels.scoreMultiplier * 0.18;
}

function getUpgradeCost(upgrade) {
  const level = state.levels[upgrade.id] || 0;
  return Math.floor(upgrade.baseCost * upgrade.growth ** level);
}

function getUpgradeEffectLabel(upgrade) {
  const level = state.levels[upgrade.id] || 0;
  if (upgrade.id === "energyValue") {
    return `基礎 +${level * 5}`;
  }
  if (upgrade.id === "dropSpeed") {
    return `${getDropInterval().toFixed(1)} 秒`;
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
  if (!upgrade || !canBuy(upgrade)) {
    return;
  }

  const cost = getUpgradeCost(upgrade);
  state.energy -= cost;
  state.levels[id] += 1;
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
  for (const card of ui.upgradeList.querySelectorAll(".upgrade-card")) {
    const button = card.querySelector("button");
    const upgrade = upgrades.find((item) => item.id === button.dataset.upgradeId);
    const level = state.levels[upgrade.id] || 0;
    const isMaxed = Boolean(upgrade.maxLevel && level >= upgrade.maxLevel);

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
      button.disabled = state.energy < cost;
    }
  }
}

function updateUI() {
  ui.energy.textContent = formatNumber(Math.floor(state.energy));
  ui.baseReward.textContent = formatNumber(getBaseReward());
  ui.dropInterval.textContent = `${getDropInterval().toFixed(1)} 秒`;

  if (state.ball) {
    ui.nextDrop.textContent = "結算中";
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
    trail: [],
  };
}

function update(dt) {
  const safeDt = Math.min(dt, 0.034);

  if (!state.ball) {
    state.spawnTimer -= safeDt;
    if (state.spawnTimer <= 0) {
      spawnBall();
    }
  } else {
    updateBall(state.ball, safeDt);
  }

  updateEffects(safeDt);

  state.saveTimer += safeDt;
  if (state.saveTimer > 5) {
    state.saveTimer = 0;
    persist();
  }
}

function updateBall(ball, dt) {
  const gravity = 780;
  ball.vy += gravity * dt;
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
  }
}

function handleWallCollision(ball) {
  const restitution = 0.72;
  const left = 18 + ball.r;
  const right = state.width - 18 - ball.r;
  if (ball.x < left) {
    ball.x = left;
    ball.vx = Math.abs(ball.vx) * restitution;
  } else if (ball.x > right) {
    ball.x = right;
    ball.vx = -Math.abs(ball.vx) * restitution;
  }

  if (ball.y < ball.r) {
    ball.y = ball.r;
    ball.vy = Math.abs(ball.vy) * restitution;
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

    const kick = 18 + state.levels.bouncePower * 3;
    ball.vx += nx * kick + (Math.random() - 0.5) * 18;
    ball.vy -= Math.abs(ny) * kick * 0.25;
  }
}

function getSlotTop() {
  return state.height - Math.max(82, state.height * 0.14);
}

function scoreBall(ball) {
  const slotWidth = state.width / slotMultipliers.length;
  const slotIndex = Math.max(
    0,
    Math.min(slotMultipliers.length - 1, Math.floor(ball.x / slotWidth))
  );
  const slotMultiplier = slotMultipliers[slotIndex];
  const reward = Math.floor(getBaseReward() * slotMultiplier * getScoreMultiplier());

  state.energy += reward;
  state.lastScoreText = `+${formatNumber(reward)} Energy · x${slotMultiplier}`;
  state.effects.push({
    text: state.lastScoreText,
    x: slotWidth * slotIndex + slotWidth / 2,
    y: getSlotTop() - 12,
    age: 0,
  });
  state.ball = null;
  state.spawnTimer = getDropInterval();
  persist();
  updateUI();
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
  ctx.globalAlpha = 0.36;
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
  ctx.strokeStyle = "rgba(255, 216, 107, 0.72)";
  roundedRect(9, 9, width - 18, height - 18, 12);
  ctx.stroke();

  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(88, 246, 255, 0.32)";
  roundedRect(17, 17, width - 34, height - 34, 8);
  ctx.stroke();
  ctx.restore();
}

function drawPegs() {
  for (const peg of state.pegs) {
    const glow = ctx.createRadialGradient(peg.x, peg.y, 1, peg.x, peg.y, peg.r * 3.2);
    glow.addColorStop(0, "rgba(255, 226, 135, 0.78)");
    glow.addColorStop(1, "rgba(255, 216, 107, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(peg.x, peg.y, peg.r * 3.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#f6cf68";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.58)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(peg.x, peg.y, peg.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawSlots() {
  const slotTop = getSlotTop();
  const slotWidth = state.width / slotMultipliers.length;

  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.34)";
  ctx.fillRect(18, slotTop, state.width - 36, state.height - slotTop - 18);

  for (let index = 0; index < slotMultipliers.length; index += 1) {
    const x = index * slotWidth;
    const isCenter = index === 2;
    const gradient = ctx.createLinearGradient(0, slotTop, 0, state.height);
    gradient.addColorStop(
      0,
      isCenter ? "rgba(255, 216, 107, 0.3)" : "rgba(255, 216, 107, 0.13)"
    );
    gradient.addColorStop(1, "rgba(255, 216, 107, 0.03)");
    ctx.fillStyle = gradient;
    ctx.fillRect(x + 2, slotTop + 2, slotWidth - 4, state.height - slotTop - 20);

    ctx.strokeStyle = "rgba(255, 216, 107, 0.45)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, slotTop);
    ctx.lineTo(x, state.height - 18);
    ctx.stroke();

    ctx.fillStyle = isCenter ? "#fff0a8" : "#ffd86b";
    ctx.font = `800 ${Math.max(17, state.width * 0.043)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(255, 216, 107, 0.45)";
    ctx.shadowBlur = 12;
    ctx.fillText(`x${slotMultipliers[index]}`, x + slotWidth / 2, slotTop + 36);
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
  const progress = 1 - Math.max(0, Math.min(1, state.spawnTimer / getDropInterval()));
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
createUpgradeButtons();
resizeCanvas();
updateUI();
requestAnimationFrame(loop);
