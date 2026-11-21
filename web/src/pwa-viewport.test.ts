import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

describe("PWA 视口固定与禁止缩放规范", () => {
  const htmlPath = path.resolve(process.cwd(), "index.html")
  const cssPath = path.resolve(process.cwd(), "src/index.css")

  it("index.html 视口 meta 标签包含 maximum-scale=1.0 与 user-scalable=no", () => {
    const html = readFileSync(htmlPath, "utf8")
    const viewportMatch = html.match(
      /<meta\s+name="viewport"\s+content="([^"]+)"/s
    )
    expect(viewportMatch).not.toBeNull()
    const content = viewportMatch![1]
    expect(content).toContain("width=device-width")
    expect(content).toContain("initial-scale=1.0")
    expect(content).toMatch(/maximum-scale=1(?:\.0)?/)
    expect(content).toContain("user-scalable=no")
  })

  it("index.html 内联脚本中注册了 iOS gesturestart 拦截以调用 preventDefault", () => {
    const html = readFileSync(htmlPath, "utf8")
    expect(html).toContain('document.addEventListener("gesturestart"')
    expect(html).toContain("e.preventDefault()")

    // 在 DOM 环境中实际测试该拦截行为
    const listenerCodeMatch = html.match(
      /document\.addEventListener\("gesturestart",\s*\(([^)]*)\)\s*=>\s*\{([\s\S]*?)\}\)/
    )
    expect(listenerCodeMatch).not.toBeNull()

    // 动态执行一次监听绑定并派发事件验证
    const handler = new Function("e", listenerCodeMatch![2])
    const event = new Event("gesturestart", { cancelable: true })
    handler(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it("index.css 在全局 html, body 上声明 touch-action: manipulation 防双击缩放", () => {
    const css = readFileSync(cssPath, "utf8")
    expect(css).toMatch(/html,\s*body\s*\{[^}]*touch-action:\s*manipulation;/s)
  })
})
