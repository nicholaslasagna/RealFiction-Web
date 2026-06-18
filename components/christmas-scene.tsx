"use client"

import { useEffect, useRef } from "react"

const GARLAND_COLORS = ["#ff5a5a", "#54c878", "#ffd24d", "#6ea8ff", "#fff3c4"]
const LIGHT_RGB = ["255,90,90", "90,200,120", "255,210,90", "120,170,255", "255,245,210"]
const GARLAND_COUNT = 28

type Flake = {
  x: number
  y: number
  vy: number
  drift: number
  size: number
  phase: number
  phaseSpeed: number
  amp: number
  alpha: number
}

type Light = {
  x: number
  y: number
  r: number
  color: string
  phase: number
  phaseSpeed: number
  baseAlpha: number
}

/**
 * Dedicated Christmas scene: layered parallax snowfall (nearer flakes fall
 * faster/brighter), twinkling out-of-focus light bokeh, a string of garland
 * lights across the top, and a soft ground-snow drift.
 *
 * Transparent, fixed, click-through. Respects prefers-reduced-motion (canvas
 * renders nothing, garland stops twinkling), pauses when hidden, DPR-capped.
 */
export function ChristmasScene() {
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
    const rand = (min: number, max: number) => min + Math.random() * (max - min)

    const makeFlake = (seeded: boolean): Flake => {
      const size = rand(1, 6)
      const depth = (size - 1) / 5
      return {
        x: rand(0, width),
        y: seeded ? rand(0, height) : -size,
        vy: 0.5 + depth * 2.1,
        drift: rand(-0.2, 0.2),
        size,
        phase: rand(0, Math.PI * 2),
        phaseSpeed: rand(0.01, 0.03),
        amp: 0.3 + depth * 1.2,
        alpha: 0.5 + depth * 0.5
      }
    }

    const flakes: Flake[] = Array.from({ length: 145 }, () => makeFlake(true))
    const lights: Light[] = Array.from({ length: 14 }, () => ({
      x: 0,
      y: 0,
      r: rand(30, 90),
      color: LIGHT_RGB[(Math.random() * LIGHT_RGB.length) | 0],
      phase: rand(0, Math.PI * 2),
      phaseSpeed: rand(0.01, 0.035),
      baseAlpha: rand(0.1, 0.22)
    }))

    let raf = 0
    let running = true

    const resize = () => {
      width = window.innerWidth
      height = window.innerHeight
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      for (const light of lights) {
        light.x = Math.random() * width
        light.y = Math.random() * height * 0.7
      }
    }
    resize()

    const frame = () => {
      if (!running) return
      ctx.clearRect(0, 0, width, height)

      // Out-of-focus twinkling lights — additive glow.
      ctx.globalCompositeOperation = "lighter"
      for (const light of lights) {
        light.phase += light.phaseSpeed
        const alpha = light.baseAlpha * (0.45 + 0.55 * Math.sin(light.phase))
        if (alpha <= 0) continue
        const grad = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, light.r)
        grad.addColorStop(0, `rgba(${light.color}, ${alpha})`)
        grad.addColorStop(1, `rgba(${light.color}, 0)`)
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(light.x, light.y, light.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalCompositeOperation = "source-over"

      // Parallax snow.
      ctx.fillStyle = "#f4f9ff"
      for (const flake of flakes) {
        flake.y += flake.vy
        flake.phase += flake.phaseSpeed
        flake.x += Math.sin(flake.phase) * flake.amp + flake.drift
        if (flake.y > height + flake.size) {
          flake.y = -flake.size
          flake.x = Math.random() * width
        }
        if (flake.x > width + 12) flake.x = -12
        else if (flake.x < -12) flake.x = width + 12
        ctx.globalAlpha = flake.alpha
        ctx.beginPath()
        ctx.arc(flake.x, flake.y, flake.size, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    const onResize = () => resize()
    const onVisibility = () => {
      if (document.hidden) {
        running = false
        cancelAnimationFrame(raf)
      } else if (!running) {
        running = true
        raf = requestAnimationFrame(frame)
      }
    }
    window.addEventListener("resize", onResize)
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      running = false
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", onResize)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])

  return (
    <>
      <div className="xmas-garland" aria-hidden="true">
        {Array.from({ length: GARLAND_COUNT }, (_, index) => (
          <span
            key={index}
            className="xmas-light"
            style={{ color: GARLAND_COLORS[index % GARLAND_COLORS.length], animationDelay: `${(index % 6) * 0.32}s` }}
          />
        ))}
      </div>
      <div className="xmas-drift" aria-hidden="true" />
      <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60]" />
    </>
  )
}
