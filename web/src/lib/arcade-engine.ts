/**
 * Pix 街机 Boss 战核心算法与游戏计算
 * 参数、曲线与绘图逻辑严格对齐 design/arcade-prototype.html
 */

/** 预估生图预期总时长（约 2 分钟量级，LCM 提速后基线） */
export const ESTIMATED_GEN_DURATION_SEC = 120
export const ESTIMATED_GEN_DURATION_MS = ESTIMATED_GEN_DURATION_SEC * 1000

/** 满幅拖拽向量参考距离（像素） */
export const JOY_DRAG_MAX_PX = 48

export interface BattleStageInfo {
  until: number
  textKey: string
  step: string
}

export const BATTLE_STAGES: BattleStageInfo[] = [
  {
    until: 20,
    textKey: "arcade.stage.summoning",
    step: "STAGE 1 / 4 · SUMMONING"
  },
  {
    until: 50,
    textKey: "arcade.stage.takingShape",
    step: "STAGE 2 / 4 · TAKING SHAPE"
  },
  {
    until: 80,
    textKey: "arcade.stage.revealing",
    step: "STAGE 3 / 4 · REVEALING"
  },
  {
    until: 96,
    textKey: "arcade.stage.finalPhase",
    step: "STAGE 4 / 4 · FINAL PHASE"
  },
  {
    until: 101,
    textKey: "arcade.stage.finishing",
    step: "STAGE 4 / 4 · FINISHING"
  }
]

export function getBattleStage(progress: number): BattleStageInfo {
  for (const stage of BATTLE_STAGES) {
    if (progress < stage.until) return stage
  }
  return BATTLE_STAGES[BATTLE_STAGES.length - 1]
}

export interface BossSkin {
  body: string
  belly: string
  horn: string
  spike: string
}

export const BOSS_SKINS: BossSkin[] = [
  { body: "#8b5cf6", belly: "#ddd0ff", horn: "#ffd94d", spike: "#6d28d9" },
  { body: "#e8362d", belly: "#ffc9c2", horn: "#fff3c4", spike: "#991b1b" },
  { body: "#17c3b2", belly: "#c9f7f1", horn: "#ff8fab", spike: "#0d8f83" },
  { body: "#f59e0b", belly: "#ffedc2", horn: "#7c2d12", spike: "#b45309" },
  { body: "#3b82f6", belly: "#cfe4ff", horn: "#7dff8a", spike: "#1e40af" }
]

export const PRESET_PROMPT_KEYS = [
  "arcade.preset.shiba",
  "arcade.preset.castle",
  "arcade.preset.catAstronaut",
  "arcade.preset.mushroom",
  "arcade.preset.giraffe",
  "arcade.preset.octopus",
  "arcade.preset.penguin",
  "arcade.preset.whale"
]

/** 32 位 FNV-1a 字符串哈希 */
export function hashStr(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 按提示词哈希确定当前局 Boss 外观配色 */
export function getBossSkin(prompt: string): BossSkin {
  return BOSS_SKINS[hashStr(prompt) % BOSS_SKINS.length]
}

/**
 * 进度估算曲线：平滑逼近，生成中 95% 封顶
 * 后端变 done 后直接拉满 100% 触发粒子爆开
 */
export function calcEstimatedProgress(
  elapsedMs: number,
  genDurationMs = ESTIMATED_GEN_DURATION_MS
): number {
  const expected = genDurationMs * 1.28
  const raw = Math.min(1, Math.max(0, elapsedMs) / expected)
  return Math.min(95, Math.floor((1 - (1 - raw) ** 1.6) * 95))
}

/** 格式化街机计时器 MM:SS.s */
export function formatGameTime(ms: number): string {
  const t = Math.max(0, ms) / 1000
  const m = Math.floor(t / 60)
  const sec = t - m * 60
  return `${m < 10 ? "0" : ""}${m}:${sec < 10 ? "0" : ""}${sec.toFixed(1)}`
}

/** 计算摇杆归一化向量 (x, y) 各在 -1..1 之间 */
export function calcJoyVector(
  dx: number,
  dy: number,
  joyDrag = JOY_DRAG_MAX_PX
): { x: number; y: number } {
  let vx = dx / joyDrag
  let vy = dy / joyDrag
  const m = Math.sqrt(vx * vx + vy * vy)
  if (m > 1) {
    vx /= m
    vy /= m
  }
  return { x: vx, y: vy }
}

/**
 * 离屏渲染怪物矢量图形
 * 支持全彩显形、剪影发光（召唤前期）与受击闪白
 */
export function drawMonsterShape(
  g: CanvasRenderingContext2D,
  S: number,
  pal: BossSkin,
  silhouette: boolean,
  flash: boolean
): void {
  const body = flash ? "#ffffff" : silhouette ? "#10182b" : pal.body
  const belly = flash ? "#ffffff" : silhouette ? "#10182b" : pal.belly
  const horn = flash ? "#ffffff" : silhouette ? "#10182b" : pal.horn
  const spike = flash ? "#ffffff" : silhouette ? "#10182b" : pal.spike
  const cx = S * 0.5
  const cy = S * 0.56

  // 背部尖刺
  g.fillStyle = spike
  for (let i = 0; i < 5; i++) {
    const a = Math.PI * (0.15 + 0.175 * i)
    const px = cx + Math.cos(a) * S * 0.335
    const py = cy - Math.sin(a) * S * 0.3
    g.beginPath()
    g.moveTo(px - S * 0.045, py + S * 0.03)
    g.lineTo(px, py - S * 0.075)
    g.lineTo(px + S * 0.045, py + S * 0.03)
    g.closePath()
    g.fill()
  }

  // 犄角
  g.fillStyle = horn
  g.beginPath()
  g.moveTo(cx - S * 0.26, cy - S * 0.26)
  g.lineTo(cx - S * 0.33, cy - S * 0.46)
  g.lineTo(cx - S * 0.13, cy - S * 0.33)
  g.closePath()
  g.fill()

  g.beginPath()
  g.moveTo(cx + S * 0.26, cy - S * 0.26)
  g.lineTo(cx + S * 0.33, cy - S * 0.46)
  g.lineTo(cx + S * 0.13, cy - S * 0.33)
  g.closePath()
  g.fill()

  // 手臂
  g.fillStyle = body
  g.beginPath()
  g.ellipse(
    cx - S * 0.37,
    cy + S * 0.1,
    S * 0.085,
    S * 0.13,
    0.5,
    0,
    Math.PI * 2
  )
  g.fill()
  g.beginPath()
  g.ellipse(
    cx + S * 0.37,
    cy + S * 0.1,
    S * 0.085,
    S * 0.13,
    -0.5,
    0,
    Math.PI * 2
  )
  g.fill()

  // 爪子
  g.fillStyle = horn
  for (let cix = -1; cix <= 1; cix++) {
    g.beginPath()
    g.moveTo(cx - S * 0.415 + cix * S * 0.035, cy + S * 0.2)
    g.lineTo(cx - S * 0.435 + cix * S * 0.035, cy + S * 0.285)
    g.lineTo(cx - S * 0.385 + cix * S * 0.035, cy + S * 0.215)
    g.closePath()
    g.fill()

    g.beginPath()
    g.moveTo(cx + S * 0.415 + cix * S * 0.035, cy + S * 0.2)
    g.lineTo(cx + S * 0.435 + cix * S * 0.035, cy + S * 0.285)
    g.lineTo(cx + S * 0.385 + cix * S * 0.035, cy + S * 0.215)
    g.closePath()
    g.fill()
  }

  // 双脚
  g.fillStyle = spike
  g.beginPath()
  g.ellipse(
    cx - S * 0.17,
    cy + S * 0.335,
    S * 0.11,
    S * 0.05,
    0,
    0,
    Math.PI * 2
  )
  g.fill()
  g.beginPath()
  g.ellipse(
    cx + S * 0.17,
    cy + S * 0.335,
    S * 0.11,
    S * 0.05,
    0,
    0,
    Math.PI * 2
  )
  g.fill()

  // 躯干
  g.fillStyle = body
  g.beginPath()
  g.ellipse(cx, cy, S * 0.335, S * 0.315, 0, 0, Math.PI * 2)
  g.fill()

  // 肚皮
  g.fillStyle = belly
  g.beginPath()
  g.ellipse(cx, cy + S * 0.11, S * 0.185, S * 0.165, 0, 0, Math.PI * 2)
  g.fill()

  if (silhouette) {
    // 召唤剪影态：仅双眼红光
    g.fillStyle = "#ff4444"
    g.shadowColor = "#ff2222"
    g.shadowBlur = S * 0.06
    g.beginPath()
    g.ellipse(
      cx - S * 0.115,
      cy - S * 0.075,
      S * 0.042,
      S * 0.058,
      0.25,
      0,
      Math.PI * 2
    )
    g.fill()
    g.beginPath()
    g.ellipse(
      cx + S * 0.115,
      cy - S * 0.075,
      S * 0.042,
      S * 0.058,
      -0.25,
      0,
      Math.PI * 2
    )
    g.fill()
    g.shadowBlur = 0
    return
  }

  // 眼睛（白底 + 黑瞳 + 愤怒眉毛）
  g.fillStyle = "#ffffff"
  g.beginPath()
  g.ellipse(
    cx - S * 0.115,
    cy - S * 0.075,
    S * 0.062,
    S * 0.075,
    0,
    0,
    Math.PI * 2
  )
  g.fill()
  g.beginPath()
  g.ellipse(
    cx + S * 0.115,
    cy - S * 0.075,
    S * 0.062,
    S * 0.075,
    0,
    0,
    Math.PI * 2
  )
  g.fill()

  g.fillStyle = flash ? "#ffffff" : "#221d33"
  g.beginPath()
  g.arc(cx - S * 0.1, cy - S * 0.06, S * 0.03, 0, Math.PI * 2)
  g.fill()
  g.beginPath()
  g.arc(cx + S * 0.1, cy - S * 0.06, S * 0.03, 0, Math.PI * 2)
  g.fill()

  g.strokeStyle = flash ? "#ffffff" : "#221d33"
  g.lineWidth = Math.max(1.5, S * 0.016)
  g.beginPath()
  g.moveTo(cx - S * 0.185, cy - S * 0.165)
  g.lineTo(cx - S * 0.05, cy - S * 0.125)
  g.stroke()
  g.beginPath()
  g.moveTo(cx + S * 0.185, cy - S * 0.165)
  g.lineTo(cx + S * 0.05, cy - S * 0.125)
  g.stroke()

  // 嘴巴与獠牙
  g.fillStyle = flash ? "#ffffff" : "#4a1020"
  g.beginPath()
  g.ellipse(cx, cy + S * 0.075, S * 0.125, S * 0.062, 0, 0, Math.PI)
  g.fill()

  g.fillStyle = "#ffffff"
  for (let f = -1; f <= 1; f++) {
    g.beginPath()
    g.moveTo(cx + f * S * 0.07 - S * 0.02, cy + S * 0.075)
    g.lineTo(cx + f * S * 0.07 + S * 0.02, cy + S * 0.075)
    g.lineTo(cx + f * S * 0.07, cy + S * 0.125)
    g.closePath()
    g.fill()
  }

  // 脸颊腮红
  g.fillStyle = "rgba(255,110,130,.5)"
  g.beginPath()
  g.arc(cx - S * 0.21, cy + S * 0.03, S * 0.035, 0, Math.PI * 2)
  g.fill()
  g.beginPath()
  g.arc(cx + S * 0.21, cy + S * 0.03, S * 0.035, 0, Math.PI * 2)
  g.fill()
}
