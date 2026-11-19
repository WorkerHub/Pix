import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import {
  calcEstimatedProgress,
  drawMonsterShape,
  getBossSkin,
  type BattleStageInfo,
  getBattleStage
} from "@/lib/arcade-engine"
import { sndShoot, sndHit, sndHurt, sndBoom } from "@/lib/arcade-audio"

const BW = 480
const BH = 360

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  t: number
  color: string
  size: number
}

interface DmgNum {
  x: number
  y: number
  val: number
  t: number
}

interface Bolt {
  x: number
  y: number
  vx: number
  vy: number
}

interface Orb {
  x: number
  y: number
  vx: number
  vy: number
  r: number
}

export interface ArcadeBattleCanvasProps {
  prompt: string
  submittedAt: number | null
  isDone: boolean
  joyVec: { x: number; y: number }
  attackTrigger: number
  onScoreUpdate: (score: number, hits: number, hurts: number) => void
  onProgressUpdate: (progress: number, stage: BattleStageInfo) => void
  onBattleExplode: () => void
  onScreenShake: () => void
}

export function ArcadeBattleCanvas({
  prompt,
  submittedAt,
  isDone,
  joyVec,
  attackTrigger,
  onScoreUpdate,
  onProgressUpdate,
  onBattleExplode,
  onScreenShake
}: ArcadeBattleCanvasProps) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const bossOffRef = useRef<HTMLCanvasElement | null>(null)

  // 外部输入和回调的稳定引用，避免反复拆建 rAF 循环
  const joyVecRef = useRef(joyVec)
  joyVecRef.current = joyVec
  const isDoneRef = useRef(isDone)
  isDoneRef.current = isDone
  const submittedAtRef = useRef(submittedAt)
  submittedAtRef.current = submittedAt
  const onScoreUpdateRef = useRef(onScoreUpdate)
  onScoreUpdateRef.current = onScoreUpdate
  const onProgressUpdateRef = useRef(onProgressUpdate)
  onProgressUpdateRef.current = onProgressUpdate
  const onBattleExplodeRef = useRef(onBattleExplode)
  onBattleExplodeRef.current = onBattleExplode
  const onScreenShakeRef = useRef(onScreenShake)
  onScreenShakeRef.current = onScreenShake

  // 内部稳定引用的 mutable 状态
  const stateRef = useRef({
    score: 0,
    hits: 0,
    hurts: 0,
    progress: 0,
    phase: "fight" as "fight" | "explode",
    explodeStart: 0,
    hasExploded: false,
    attackCd: 0,
    hero: { x: 84, y: 196, r: 15, invuln: 0, attackAnim: 0, moving: false },
    boss: { x: 388, y: 178, r: 84, shake: 0, flash: 0, fireIn: 1.2 },
    orbs: [] as Orb[],
    bolts: [] as Bolt[],
    parts: [] as Particle[],
    dmgNums: [] as DmgNum[],
    bossSkin: getBossSkin(prompt),
    lastTs: 0
  })

  // 响应外部 prompt 改变重新选定 Boss 皮肤
  useEffect(() => {
    stateRef.current.bossSkin = getBossSkin(prompt)
  }, [prompt])

  // 攻击指令响应
  const lastAttackTriggerRef = useRef(attackTrigger)
  useEffect(() => {
    if (attackTrigger > lastAttackTriggerRef.current) {
      lastAttackTriggerRef.current = attackTrigger
      const s = stateRef.current
      if (s.phase !== "fight" || s.attackCd > 0) return
      s.attackCd = 0.22
      s.hero.attackAnim = 0.22
      s.bolts.push({
        x: s.hero.x + 16,
        y: s.hero.y - 4,
        vx: 470,
        vy: (s.boss.y - s.hero.y) * 1.4
      })
      sndShoot()
    }
  }, [attackTrigger])

  // 动画循环
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    if (!bossOffRef.current) {
      bossOffRef.current = document.createElement("canvas")
    }
    const bossOff = bossOffRef.current
    const bossOffCtx = bossOff.getContext("2d")

    let rafId: number
    const state = stateRef.current

    // 初始化背景星空
    const arenaStars: { x: number; y: number; s: number }[] = []
    let seed = 42
    const rng = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 4294967296
    }
    for (let i = 0; i < 46; i++) {
      arenaStars.push({
        x: rng() * BW,
        y: rng() * BH * 0.6,
        s: rng() < 0.3 ? 2 : 1
      })
    }

    const burst = (
      x: number,
      y: number,
      n: number,
      colors: string[],
      speed: number,
      size: number
    ) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2
        const sp = (0.3 + Math.random() * 0.7) * speed
        state.parts.push({
          x,
          y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 40,
          life: 0.55 + Math.random() * 0.6,
          t: 0,
          color: colors[i % colors.length],
          size: size * (0.6 + Math.random() * 0.8)
        })
      }
    }

    const spawnOrb = () => {
      const dx = state.hero.x - state.boss.x
      const dy = state.hero.y - state.boss.y
      const d = Math.sqrt(dx * dx + dy * dy) || 1
      const sp = 118 + state.progress * 0.55 + Math.random() * 36
      const spread = (Math.random() - 0.5) * 0.35
      const vx = (dx / d) * sp
      const vy = (dy / d) * sp
      const cs = Math.cos(spread)
      const sn = Math.sin(spread)
      state.orbs.push({
        x: state.boss.x - 58,
        y: state.boss.y + 6,
        vx: vx * cs - vy * sn,
        vy: vx * sn + vy * cs,
        r: 8.5
      })

      if (state.progress > 58 && Math.random() < 0.45) {
        const a1 = spread + 0.42
        const a2 = spread - 0.42
        state.orbs.push({
          x: state.boss.x - 58,
          y: state.boss.y + 6,
          vx: (dx / d) * sp * Math.cos(a1) - (dy / d) * sp * Math.sin(a1),
          vy: (dx / d) * sp * Math.sin(a1) + (dy / d) * sp * Math.cos(a1),
          r: 8
        })
        state.orbs.push({
          x: state.boss.x - 58,
          y: state.boss.y + 6,
          vx: (dx / d) * sp * Math.cos(a2) - (dy / d) * sp * Math.sin(a2),
          vy: (dx / d) * sp * Math.sin(a2) + (dy / d) * sp * Math.cos(a2),
          r: 8
        })
      }
    }

    const loop = (ts: number) => {
      rafId = requestAnimationFrame(loop)
      if (!state.lastTs) state.lastTs = ts
      const dt = Math.min(0.05, (ts - state.lastTs) / 1000)
      state.lastTs = ts
      const t = ts / 1000

      // 计算真实墙钟已消耗时间（毫秒）
      const elapsedMs = submittedAtRef.current
        ? Date.now() - submittedAtRef.current
        : 0

      if (state.phase === "fight") {
        let p = calcEstimatedProgress(elapsedMs)
        if (isDoneRef.current) {
          p = 100
        }
        state.progress = p

        const stage = getBattleStage(p)
        onProgressUpdateRef.current(p, stage)

        // 英雄移动（摇杆向量驱动）
        const mx = joyVecRef.current.x
        const my = joyVecRef.current.y
        const mag = Math.sqrt(mx * mx + my * my)
        state.hero.moving = mag > 0.12
        if (state.hero.moving) {
          const cl = Math.min(1, mag)
          state.hero.x += (mx / (mag || 1)) * cl * 205 * dt
          state.hero.y += (my / (mag || 1)) * cl * 205 * dt
          state.hero.x = Math.max(24, Math.min(298, state.hero.x))
          state.hero.y = Math.max(46, Math.min(322, state.hero.y))
        }

        if (state.hero.invuln > 0) state.hero.invuln -= dt
        if (state.hero.attackAnim > 0) state.hero.attackAnim -= dt
        if (state.attackCd > 0) state.attackCd -= dt
        if (state.boss.shake > 0)
          state.boss.shake = Math.max(0, state.boss.shake - dt * 46)
        if (state.boss.flash > 0) state.boss.flash -= dt

        // Boss 发射弹幕
        state.boss.fireIn -= dt
        if (state.boss.fireIn <= 0) {
          spawnOrb()
          state.boss.fireIn = Math.max(0.62, 1.25 - state.progress * 0.006)
        }

        // 敌方光球步进与英雄受击判定
        for (let oi = state.orbs.length - 1; oi >= 0; oi--) {
          const o = state.orbs[oi]
          o.x += o.vx * dt
          o.y += o.vy * dt
          if (o.x < -20 || o.x > BW + 20 || o.y < -20 || o.y > BH + 20) {
            state.orbs.splice(oi, 1)
            continue
          }
          const ddx = o.x - state.hero.x
          const ddy = o.y - state.hero.y
          if (
            state.hero.invuln <= 0 &&
            ddx * ddx + ddy * ddy <
              (o.r + state.hero.r - 2) * (o.r + state.hero.r - 2)
          ) {
            state.orbs.splice(oi, 1)
            state.hero.invuln = 0.9
            state.hurts++
            state.score = Math.max(0, state.score - 50)
            onScoreUpdateRef.current(state.score, state.hits, state.hurts)
            burst(
              state.hero.x,
              state.hero.y,
              10,
              ["#ff6a52", "#ffd94d", "#ffffff"],
              130,
              4
            )
            onScreenShakeRef.current()
            sndHurt()
          }
        }

        // 我方光剑步进与 Boss 受击判定
        for (let bi = state.bolts.length - 1; bi >= 0; bi--) {
          const b = state.bolts[bi]
          b.x += b.vx * dt
          b.y += b.vy * dt
          if (b.x > state.boss.x - 52 && Math.abs(b.y - state.boss.y) < 86) {
            state.bolts.splice(bi, 1)
            const dmg = 8 + Math.floor(Math.random() * 15)
            state.score += dmg
            state.hits++
            onScoreUpdateRef.current(state.score, state.hits, state.hurts)
            state.boss.shake = 9
            state.boss.flash = 0.09
            state.dmgNums.push({
              x: state.boss.x - 40 - Math.random() * 30,
              y: state.boss.y - 56 - Math.random() * 26,
              val: dmg,
              t: 0
            })
            burst(b.x, b.y, 9, ["#ffd94d", "#7dff8a", "#ffffff"], 150, 3.6)
            sndHit()
            continue
          }
          if (b.x > BW + 24) state.bolts.splice(bi, 1)
        }

        // 步进特效粒子与伤害数字
        stepFx(dt)

        // 绘制各层
        drawArena(ctx, t, arenaStars)
        drawBoss(ctx, bossOff, bossOffCtx, t)
        drawOrbs(ctx, t)
        drawBolts(ctx)
        drawHero(ctx, t)
        drawFx(ctx)

        // 当生图已完成且进度已达 100%，触发 Boss 爆开动画
        if (isDoneRef.current && !state.hasExploded) {
          state.hasExploded = true
          state.phase = "explode"
          state.explodeStart = performance.now()
          burst(
            state.boss.x,
            state.boss.y,
            90,
            [
              "#ffc61a",
              "#17c3b2",
              "#ff6a52",
              "#7dff8a",
              "#ffd1ec",
              "#8fe3ff",
              "#ffffff"
            ],
            300,
            5.5
          )
          burst(
            state.boss.x,
            state.boss.y,
            40,
            ["#ffffff", "#ffd94d"],
            190,
            3.4
          )
          state.orbs = []
          state.bolts = []
          sndBoom()
          onScreenShakeRef.current()
        }
      } else {
        // 爆开阶段
        stepFx(dt)
        drawArena(ctx, t, arenaStars)
        drawHero(ctx, t)
        drawFx(ctx)

        if (performance.now() - state.explodeStart > 950) {
          onBattleExplodeRef.current()
        }
      }
    }

    const stepFx = (dt: number) => {
      for (let i = state.parts.length - 1; i >= 0; i--) {
        const p = state.parts[i]
        p.t += dt
        if (p.t >= p.life) {
          state.parts.splice(i, 1)
          continue
        }
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.vy += 300 * dt
      }
      for (let j = state.dmgNums.length - 1; j >= 0; j--) {
        const d = state.dmgNums[j]
        d.t += dt
        d.y -= 34 * dt
        if (d.t > 0.85) state.dmgNums.splice(j, 1)
      }
    }

    const drawArena = (
      c: CanvasRenderingContext2D,
      t: number,
      stars: { x: number; y: number; s: number }[]
    ) => {
      const g = c.createLinearGradient(0, 0, 0, BH)
      g.addColorStop(0, "#141b38")
      g.addColorStop(0.7, "#1d1440")
      g.addColorStop(1, "#241433")
      c.fillStyle = g
      c.fillRect(0, 0, BW, BH)
      c.fillStyle = "#ffffff"
      stars.forEach((st, i) => {
        if (i % 3 !== 0 || Math.sin(t * 2 + i) > -0.3) {
          c.globalAlpha = 0.5 + 0.4 * Math.sin(t * 1.5 + i)
          c.fillRect(st.x, st.y, st.s, st.s)
        }
      })
      c.globalAlpha = 1

      // 远景地平线山脊
      c.fillStyle = "#0d0a24"
      c.beginPath()
      c.moveTo(0, 300)
      c.lineTo(70, 262)
      c.lineTo(150, 292)
      c.lineTo(240, 258)
      c.lineTo(330, 290)
      c.lineTo(420, 264)
      c.lineTo(480, 288)
      c.lineTo(480, 360)
      c.lineTo(0, 360)
      c.fill()

      // 霓虹网格地面
      c.strokeStyle = "rgba(23,195,178,.16)"
      c.lineWidth = 1
      for (let gx = 0; gx <= BW; gx += 40) {
        c.beginPath()
        c.moveTo(gx, 306)
        c.lineTo(gx - 14, 360)
        c.stroke()
      }
      for (let gy = 312; gy <= 360; gy += 14) {
        c.beginPath()
        c.moveTo(0, gy)
        c.lineTo(BW, gy)
        c.stroke()
      }
      c.fillStyle = "rgba(23,195,178,.08)"
      c.fillRect(0, 304, BW, 3)
    }

    const drawBoss = (
      c: CanvasRenderingContext2D,
      off: HTMLCanvasElement,
      offCtx: CanvasRenderingContext2D | null,
      t: number
    ) => {
      if (!offCtx) return
      const res = Math.max(14, Math.round(14 + (state.progress / 100) * 86))
      off.width = res
      off.height = res
      offCtx.clearRect(0, 0, res, res)
      drawMonsterShape(offCtx, res, state.bossSkin, false, state.boss.flash > 0)
      const reveal = Math.min(1, state.progress / 62)
      if (reveal < 1) {
        offCtx.globalAlpha = 1 - reveal
        drawMonsterShape(offCtx, res, state.bossSkin, true, false)
        offCtx.globalAlpha = 1
      }
      const bobY = Math.sin(t * 1.4) * 5
      const shX =
        state.boss.shake > 0 ? (Math.random() - 0.5) * state.boss.shake : 0
      const shY =
        state.boss.shake > 0
          ? (Math.random() - 0.5) * state.boss.shake * 0.6
          : 0
      c.imageSmoothingEnabled = false
      c.drawImage(
        off,
        state.boss.x - 96 + shX,
        state.boss.y - 104 + bobY + shY,
        192,
        208
      )
    }

    const drawHero = (c: CanvasRenderingContext2D, t: number) => {
      const x = state.hero.x
      const y = state.hero.y + (state.hero.moving ? 0 : Math.sin(t * 2.4) * 2.2)
      const breathe = state.hero.moving ? 1 : 1 + Math.sin(t * 2.4) * 0.035
      if (state.hero.invuln > 0 && Math.floor(t * 18) % 2 === 0) {
        c.globalAlpha = 0.35
      }

      // 阴影
      c.fillStyle = "rgba(0,0,0,.3)"
      c.beginPath()
      c.ellipse(state.hero.x, state.hero.y + 24, 16, 5, 0, 0, Math.PI * 2)
      c.fill()

      c.save()
      c.translate(x, y)
      c.scale(1, breathe)

      // 佩剑挥舞
      const swA =
        state.hero.attackAnim > 0
          ? -0.5 + (0.22 - state.hero.attackAnim) * 4
          : 0.5
      c.save()
      c.translate(13, -2)
      c.rotate(swA)
      c.fillStyle = "#cfd8dc"
      c.fillRect(2, -2.4, 17, 4.8)
      c.fillStyle = "#ffd94d"
      c.fillRect(-2, -4, 4.5, 8.5)
      c.restore()

      // 躯干
      c.fillStyle = "#17c3b2"
      c.beginPath()
      if (c.roundRect) {
        c.roundRect(-13, -6, 26, 26, 8)
      } else {
        c.rect(-13, -6, 26, 26)
      }
      c.fill()
      c.fillStyle = "#0d8f83"
      c.fillRect(-13, 12, 26, 8)

      // 头部
      c.fillStyle = "#ffd9b3"
      c.beginPath()
      c.arc(0, -16, 11.5, 0, Math.PI * 2)
      c.fill()

      // 红色鸭舌帽
      c.fillStyle = "#e8362d"
      c.beginPath()
      c.arc(0, -18.5, 11.5, Math.PI, 0)
      c.fill()
      c.fillRect(-11.5, -19.5, 26, 4)

      // 眼睛与腮红
      c.fillStyle = "#221d33"
      c.beginPath()
      c.arc(4.5, -15, 1.9, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = "rgba(255,110,130,.6)"
      c.beginPath()
      c.arc(8, -11, 2.6, 0, Math.PI * 2)
      c.fill()

      c.restore()
      c.globalAlpha = 1
    }

    const drawOrbs = (c: CanvasRenderingContext2D, t: number) => {
      state.orbs.forEach((o) => {
        const pulse = 1 + Math.sin(t * 9 + o.x) * 0.15
        c.fillStyle = "rgba(216,80,255,.25)"
        c.beginPath()
        c.arc(o.x, o.y, o.r * 1.9 * pulse, 0, Math.PI * 2)
        c.fill()
        c.fillStyle = "#d850ff"
        c.beginPath()
        c.arc(o.x, o.y, o.r * pulse, 0, Math.PI * 2)
        c.fill()
        c.fillStyle = "#ffb3ff"
        c.beginPath()
        c.arc(o.x - o.r * 0.3, o.y - o.r * 0.3, o.r * 0.38, 0, Math.PI * 2)
        c.fill()
      })
    }

    const drawBolts = (c: CanvasRenderingContext2D) => {
      state.bolts.forEach((b) => {
        c.save()
        c.translate(b.x, b.y)
        c.rotate(Math.PI / 4)
        c.fillStyle = "#ffd94d"
        c.fillRect(-6, -6, 12, 12)
        c.fillStyle = "#fff3b0"
        c.fillRect(-3, -3, 6, 6)
        c.restore()
      })
    }

    const drawFx = (c: CanvasRenderingContext2D) => {
      state.parts.forEach((p) => {
        c.globalAlpha = Math.max(0, 1 - p.t / p.life)
        c.fillStyle = p.color
        c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size)
      })
      c.globalAlpha = 1
      state.dmgNums.forEach((d) => {
        c.globalAlpha = Math.max(0, 1 - d.t / 0.85)
        c.font = "700 17px 'Noto Sans SC',sans-serif"
        c.fillStyle = "#ffd94d"
        c.strokeStyle = "#221d33"
        c.lineWidth = 3.5
        c.strokeText(`-${d.val}`, d.x, d.y)
        c.fillText(`-${d.val}`, d.x, d.y)
      })
      c.globalAlpha = 1
    }

    rafId = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(rafId)
    }
  }, [])

  // 当 isDone 激活但处于无 Canvas 环境（如 jsdom 单元测试）时，或超时兜底，触发完成回调
  useEffect(() => {
    if (!isDone) return
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) {
      onBattleExplodeRef.current()
      return
    }
    const timer = setTimeout(() => {
      onBattleExplodeRef.current()
    }, 1500)
    return () => clearTimeout(timer)
  }, [isDone])

  return (
    <div className="battle-wrap">
      <canvas
        id="battleCanvas"
        ref={canvasRef}
        width={BW}
        height={BH}
        aria-label={t("arcade.battle.canvasAria")}
      />
    </div>
  )
}
