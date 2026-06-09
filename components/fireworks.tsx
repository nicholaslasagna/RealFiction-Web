"use client"

import { useEffect, useRef } from "react"

// Red / white / blue, with a little gold for sparkle.
const COLORS = ["#ef4444", "#f8fafc", "#3b82f6", "#fbbf24", "#dc2626", "#93c5fd"]
const MAX_ROCKETS = 14
const MAX_PARTICLES = 1400

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  color: string
  size: number
}

type Rocket = {
  x: number
  y: number
  vx: number
  vy: number
  targetY: number
  color: string
  trail: Array<{ x: number; y: number }>
}

/**
 * A self-contained canvas fireworks display.
 *
 * Transparent, fixed, full-viewport, and click-through (pointer-events: none), so
 * it never blocks the UI. Rockets arc up and burst into gravity-driven particle
 * showers; clicking empty page area launches one at the cursor. It respects
 * prefers-reduced-motion (renders nothing), pauses when the tab is hidden, and
 * caps rockets/particles so it stays cheap.
 */
export function Fireworks({ colors }: { colors?: string[] } = {}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reducedMotion) {
      return
    }

    let width = window.innerWidth
    let height = window.innerHeight

    const rockets: Rocket[] = []
    const particles: Particle[] = []
    let raf = 0
    let running = true
    let lastLaunch = 0
    let nextLaunchIn = 600

    const rand = (min: number, max: number) => min + Math.random() * (max - min)
    const palette = colors && colors.length ? colors : COLORS
    const randomColor = () => palette[(Math.random() * palette.length) | 0]

    const resize = () => {
      width = window.innerWidth
      height = window.innerHeight
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    const launch = (targetX?: number, targetY?: number) => {
      if (rockets.length >= MAX_ROCKETS) return
      const tx = targetX ?? rand(width * 0.15, width * 0.85)
      const ty = targetY ?? rand(height * 0.1, height * 0.45)
      const startX = tx + rand(-30, 30)
      rockets.push({
        x: startX,
        y: height + 8,
        vx: (tx - startX) / 64,
        vy: -rand(8.5, 11.5),
        targetY: ty,
        color: randomColor(),
        trail: []
      })
    }

    const burst = (x: number, y: number, color: string) => {
      if (particles.length >= MAX_PARTICLES) return
      const count = 56 + ((Math.random() * 44) | 0)
      const power = rand(2.4, 5)
      const multicolor = Math.random() < 0.45
      for (let i = 0; i < count; i += 1) {
        const angle = (Math.PI * 2 * i) / count + rand(-0.08, 0.08)
        const speed = power * rand(0.35, 1)
        particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          maxLife: rand(48, 92),
          color: multicolor ? randomColor() : color,
          size: rand(1.4, 2.8)
        })
      }
    }

    const frame = (time: number) => {
      if (!running) return
      ctx.clearRect(0, 0, width, height)
      ctx.globalCompositeOperation = "lighter"

      if (time - lastLaunch > nextLaunchIn) {
        lastLaunch = time
        nextLaunchIn = rand(560, 1000)
        launch()
        if (Math.random() < 0.35) launch()
      }

      for (let i = rockets.length - 1; i >= 0; i -= 1) {
        const r = rockets[i]
        r.x += r.vx
        r.y += r.vy
        r.vy += 0.12
        r.trail.push({ x: r.x, y: r.y })
        if (r.trail.length > 7) r.trail.shift()
        for (let j = 0; j < r.trail.length; j += 1) {
          const point = r.trail[j]
          ctx.globalAlpha = (j / r.trail.length) * 0.7
          ctx.fillStyle = r.color
          ctx.beginPath()
          ctx.arc(point.x, point.y, 1.8, 0, Math.PI * 2)
          ctx.fill()
        }
        if (r.vy >= -0.6 || r.y <= r.targetY) {
          burst(r.x, r.y, r.color)
          rockets.splice(i, 1)
        }
      }

      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const p = particles[i]
        p.life += 1
        if (p.life >= p.maxLife) {
          particles.splice(i, 1)
          continue
        }
        p.x += p.vx
        p.y += p.vy
        p.vy += 0.036
        p.vx *= 0.986
        p.vy *= 0.986
        ctx.globalAlpha = 1 - p.life / p.maxLife
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.globalAlpha = 1
      raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)

    const onResize = () => resize()
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      // Only the page backdrop launches fireworks — never hijack real controls.
      if (target?.closest("a, button, input, textarea, select, label, [role='button'], [role='link']")) {
        return
      }
      launch(event.clientX, event.clientY)
    }
    const onVisibility = () => {
      if (document.hidden) {
        running = false
        cancelAnimationFrame(raf)
      } else if (!running) {
        running = true
        lastLaunch = performance.now()
        raf = requestAnimationFrame(frame)
      }
    }

    window.addEventListener("resize", onResize)
    window.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      running = false
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", onResize)
      window.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [colors])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[60]"
      style={{ mixBlendMode: "screen" }}
    />
  )
}
