/**
 * 工作台提示词输入框高度控制与持久化
 *
 * 规格约束：
 * 1. 拖拽使用 Pointer Events，实时改变输入框高度；
 * 2. 下限为当前默认高度（112px，对应 4 行文本区高度）；
 * 3. 上限保证其余控件（尺寸、模型、按钮）始终完整可见，页面维持一屏不滚动；
 * 4. 高度持久化到 localStorage，使用独立 key，绝不干扰任务恢复（#38 的 app-gen-job）。
 */

export const PROMPT_HEIGHT_STORAGE_KEY = "app-prompt-height"

/** 默认高度（对应 rows={4} 与内边距的基础可视高度） */
export const PROMPT_HEIGHT_DEFAULT = 112

/** 下限：当前默认高度 */
export const PROMPT_HEIGHT_MIN = 112

/** 移动端画布区必须保留的最小可见高度，保证画布核心可见且一屏不滚动 */
export const MIN_CANVAS_HEIGHT = 180

/** 控制面板内部除输入框外的其他控件及间距内边距预估占高（兜底） */
export const CONTROL_PANEL_REST_HEIGHT_DEFAULT = 280

/**
 * 钳制高度在 [min, max] 范围内。
 * 非有限数回落 min；max 若小于 min 则以 min 为准。
 */
export function clampPromptHeight(
  height: number,
  min: number = PROMPT_HEIGHT_MIN,
  max: number = 600
): number {
  if (!Number.isFinite(height)) return min
  const effectiveMin = Math.max(0, min)
  const effectiveMax = Math.max(effectiveMin, max)
  return Math.min(effectiveMax, Math.max(effectiveMin, Math.round(height)))
}

/**
 * 从 localStorage 读取持久化的高度。
 * 缺失、异常或非数字回落默认高度；读取结果钳制在下限以上。
 */
export function readStoredPromptHeight(): number {
  try {
    const raw = window.localStorage.getItem(PROMPT_HEIGHT_STORAGE_KEY)
    if (raw === null) return PROMPT_HEIGHT_DEFAULT
    const parsed = Number.parseFloat(raw)
    if (!Number.isFinite(parsed)) return PROMPT_HEIGHT_DEFAULT
    return Math.max(PROMPT_HEIGHT_MIN, Math.round(parsed))
  } catch {
    return PROMPT_HEIGHT_DEFAULT
  }
}

/**
 * 将高度持久化到 localStorage。
 * 存储不可用（如隐私模式）静默忽略。
 */
export function writeStoredPromptHeight(height: number): void {
  try {
    const clamped = Math.max(PROMPT_HEIGHT_MIN, Math.round(height))
    window.localStorage.setItem(PROMPT_HEIGHT_STORAGE_KEY, String(clamped))
  } catch {
    // 存储不可用时只影响刷新后的恢复，不阻碍当前拖拽交互
  }
}

/**
 * 动态计算提示词输入框允许的最大高度上限。
 *
 * @param isDesktop 是否为桌面两列排布（lg 1024px 及以上）
 * @param rootHeight 工作台视口根容器实际高度
 * @param panelHeight 控制面板容器当前实际高度
 * @param restHeight 控制面板内除输入框以外控件的占高（尺寸切换、模型选择、生成按钮及间距）
 * @param minCanvasHeight 移动端画布区保留的最小高度
 * @param minPromptHeight 输入框允许的下限
 */
export function calculateMaxPromptHeight({
  isDesktop,
  rootHeight,
  panelHeight,
  restHeight = CONTROL_PANEL_REST_HEIGHT_DEFAULT,
  minCanvasHeight = MIN_CANVAS_HEIGHT,
  minPromptHeight = PROMPT_HEIGHT_MIN
}: {
  isDesktop: boolean
  rootHeight: number
  panelHeight?: number
  restHeight?: number
  minCanvasHeight?: number
  minPromptHeight?: number
}): number {
  let availablePanelHeight: number

  if (isDesktop) {
    // 桌面端：控制面板为整列高，可用空间取决于面板实际高度或视口根高度
    availablePanelHeight =
      panelHeight && panelHeight > 0
        ? panelHeight
        : rootHeight > 0
          ? rootHeight - 32
          : 700
  } else {
    // 移动端：单列上下布局，页面总高扣除画布最小可见区与外层 gap（12px）
    const effectiveRoot = rootHeight > 0 ? rootHeight - 24 : 600
    availablePanelHeight = effectiveRoot - minCanvasHeight - 12
  }

  const effectiveRest =
    restHeight > 0 ? restHeight : CONTROL_PANEL_REST_HEIGHT_DEFAULT
  const calculatedMax = Math.round(availablePanelHeight - effectiveRest)

  return Math.max(minPromptHeight, calculatedMax)
}
