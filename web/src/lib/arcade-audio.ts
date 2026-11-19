/**
 * 8-bit 复古街机音效合成器（Web Audio API）
 * 参数与原型 design/arcade-prototype.html 严格一致
 */

const SOUND_STORAGE_KEY = "arcade-sound"

let soundEnabled = true
try {
  const stored = localStorage.getItem(SOUND_STORAGE_KEY)
  if (stored !== null) {
    soundEnabled = stored === "true"
  }
} catch {
  // 忽略存储读取异常
}

let audioCtx: AudioContext | null = null

export function isSoundEnabled(): boolean {
  return soundEnabled
}

export function setSoundEnabled(enabled: boolean): void {
  soundEnabled = enabled
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, String(enabled))
  } catch {
    // 忽略存储异常
  }
}

export function initAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null
  if (!audioCtx) {
    try {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      if (AudioCtxClass) {
        audioCtx = new AudioCtxClass()
      }
    } catch {
      audioCtx = null
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {
      // 忽略自动播放恢复异常
    })
  }
  return audioCtx
}

function beep(
  freq: number,
  t0: number,
  dur: number,
  type: OscillatorType = "square",
  vol = 0.06
): void {
  if (!soundEnabled) return
  const ctx = initAudioContext()
  if (!ctx) return

  try {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.value = freq

    const start = ctx.currentTime + t0
    gain.gain.setValueAtTime(vol, start)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(start)
    osc.stop(start + dur + 0.02)
  } catch {
    // 忽略音频调度异常
  }
}

/** 点按基础音效 */
export function sndClick(): void {
  beep(660, 0, 0.07, "square", 0.05)
}

/** 投币/选定音效 */
export function sndCoin(): void {
  beep(988, 0, 0.09, "square", 0.06)
  beep(1319, 0.09, 0.28, "square", 0.06)
}

/** 开局开始音效 */
export function sndStart(): void {
  ;[392, 523, 659, 784].forEach((f, i) => {
    beep(f, i * 0.09, 0.12, "square", 0.06)
  })
}

/** 英雄发射光弹 */
export function sndShoot(): void {
  beep(880, 0, 0.06, "square", 0.035)
  beep(1320, 0.03, 0.05, "square", 0.03)
}

/** 命中 Boss */
export function sndHit(): void {
  beep(220, 0, 0.08, "sawtooth", 0.05)
  beep(330, 0.02, 0.06, "square", 0.04)
}

/** 英雄受击 */
export function sndHurt(): void {
  beep(160, 0, 0.18, "sawtooth", 0.06)
  beep(110, 0.1, 0.2, "sawtooth", 0.05)
}

/** Boss 爆炸终结音效 */
export function sndBoom(): void {
  ;[98, 130, 65, 196, 262].forEach((f, i) => {
    beep(f, i * 0.07, 0.3, "sawtooth", 0.07)
  })
  ;[523, 659, 784, 1047].forEach((f, i) => {
    beep(f, 0.25 + i * 0.09, 0.16, "triangle", 0.07)
  })
}

/** 生成通关结算音效 */
export function sndDone(): void {
  ;[523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => {
    beep(f, i * 0.11, 0.16, "triangle", 0.09)
  })
}

/** 校验或输入错误音效 */
export function sndError(): void {
  beep(196, 0, 0.16, "sawtooth", 0.06)
  beep(147, 0.14, 0.24, "sawtooth", 0.06)
}
