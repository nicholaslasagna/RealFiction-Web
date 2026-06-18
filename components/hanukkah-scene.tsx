"use client"

import { useEffect, useRef } from "react"

const STAR_RGB = ["255,255,255", "170,205,255", "255,222,150"] // white, blue, gold
const MENORAH_COUNT = 9

type Mote = {
  x: number
  y: number
  vy: number
  drift: number
  r: number
  color: string
  phase: number
  phaseSpeed: number
  baseAlpha: number
}

type Star = {
  x: number
  y: number
  size: number
  rot: number
  color: string
  phase: number
  phaseSpeed: number
  baseAlpha: number
  vy: number
}

/** Draws a filled six-pointed star (two overlapping triangles) at (cx, cy). */
function drawStarOfDavid(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, rot: number) {
  ctx.beginPath()
  for (let triangle = 0; triangle < 2; triangle += 1) {
    const base = rot + triangle * Math.PI
    for (let point = 0; point < 3; point += 1) {
      const angle = base + (point * 2 * Math.PI) / 3
      const x = cx + r * Math.cos(angle)
      const y = cy + r * Math.sin(angle)
      if (point === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
  }
  ctx.fill()
}

/**
 * Dedicated Hanukkah scene — a Festival of Lights: warm candlelight motes rise
 * and twinkle, Stars of David drift gently down in blue/white/gold, a row of
 * nine menorah flames glows across the top (shamash raised), with a warm ground
 * glow. Transparent, fixed, click-through. Respects prefers-reduced-motion
 * (canvas renders nothing, flames stop flickering), pauses when hidden,
 * DPR-capped.
 */
export function HanukkahScene() {
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

    const makeMote = (seeded: boolean): Mote => ({
      x: rand(0, width),
      y: seeded ? rand(0, height) : height + rand(0, 40),
      vy: -rand(0.25, 0.85),
      drift: rand(-0.25, 0.25),
      r: rand(16, 46),
      color: Math.random() < 0.78 ? "255,205,120" : "150,185,255",
      phase: rand(0, Math.PI * 2),
      phaseSpeed: rand(0.012, 0.03),
      baseAlpha: rand(0.08, 0.18)
    })

    const makeStar = (seeded: boolean): Star => ({
      x: rand(0, width),
      y: seeded ? rand(0, height) : -10,
      size: rand(4, 10),
      rot: rand(0, Math.PI),
      color: STAR_RGB[(Math.random() * STAR_RGB.length) | 0],
      phase: rand(0, Math.PI * 2),
      phaseSpeed: rand(0.01, 0.03),
      baseAlpha: rand(0.4, 0.9),
      vy: rand(0.08, 0.32)
    })

    const motes: Mote[] = Array.from({ length: 30 }, () => makeMote(true))
    const stars: Star[] = Array.from({ length: 40 }, () => makeStar(true))

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
    }
    resize()

    const frame = () => {
      if (!running) return
      ctx.clearRect(0, 0, width, height)

      // Rising candlelight — additive glow, fading as it climbs.
      ctx.globalCompositeOperation = "lighter"
      for (const mote of motes) {
        mote.y += mote.vy
        mote.phase += mote.phaseSpeed
        mote.x += Math.sin(mote.phase) * 0.4 + mote.drift
        if (mote.y < -mote.r) {
          Object.assign(mote, makeMote(false))
          continue
        }
        const rise = Math.max(0, Math.min(1, mote.y / height))
        const twinkle = 0.5 + 0.5 * Math.sin(mote.phase)
        const alpha = mote.baseAlpha * rise * twinkle
        const grad = ctx.createRadialGradient(mote.x, mote.y, 0, mote.x, mote.y, mote.r)
        grad.addColorStop(0, `rgba(${mote.color}, ${alpha})`)
        grad.addColorStop(1, `rgba(${mote.color}, 0)`)
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(mote.x, mote.y, mote.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalCompositeOperation = "source-over"

      // Twinkling Stars of David drifting gently down.
      for (const star of stars) {
        star.y += star.vy
        star.phase += star.phaseSpeed
        if (star.y > height + star.size) {
          Object.assign(star, makeStar(false))
        }
        const alpha = star.baseAlpha * (0.4 + 0.6 * Math.sin(star.phase))
        if (alpha <= 0.02) continue
        ctx.fillStyle = `rgba(${star.color}, ${alpha})`
        drawStarOfDavid(ctx, star.x, star.y, star.size, star.rot)
      }

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
      <div className="hk-menorah" aria-hidden="true">
        {Array.from({ length: MENORAH_COUNT }, (_, index) => (
          <span
            key={index}
            className={index === 4 ? "hk-flame hk-flame--shamash" : "hk-flame"}
            style={{ animationDelay: `${(index % 5) * 0.4}s` }}
          />
        ))}
      </div>
      <div className="hk-glow" aria-hidden="true" />
      <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60]" />
    </>
  )
}
