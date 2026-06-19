"use client"

import { useEffect, useRef } from "react"

// Stable default so it never changes identity across renders (an inline default
// array would be a new ref each render, re-triggering the effect / re-seeding).
const DEFAULT_COLORS = ["#ffffff"]

type FallingParticlesProps = {
  /** Emoji/glyphs to draw. If omitted, soft circles are drawn (snow). */
  glyphs?: string[]
  /** Colors for circle mode. */
  colors?: string[]
  count?: number
  speedMin?: number
  speedMax?: number
  sizeMin?: number
  sizeMax?: number
  sway?: number
  spin?: boolean
}

type Flake = {
  x: number
  y: number
  vy: number
  size: number
  phase: number
  phaseSpeed: number
  amp: number
  rot: number
  vrot: number
  alpha: number
  glyph: string | null
  color: string
}

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", serif'

/**
 * A self-contained canvas of drifting particles — soft circles (snow) when no
 * `glyphs` are given, or falling/swaying emoji otherwise. Transparent, fixed,
 * full-viewport, click-through. Respects prefers-reduced-motion (renders
 * nothing), pauses when the tab is hidden, DPR-capped, and recycles a fixed
 * particle pool so it stays cheap.
 */
export function FallingParticles({
  glyphs,
  colors = DEFAULT_COLORS,
  count = 90,
  speedMin = 0.5,
  speedMax = 1.6,
  sizeMin = 8,
  sizeMax = 18,
  sway = 0.6,
  spin = false
}: FallingParticlesProps) {
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
    const pickGlyph = () => (glyphs && glyphs.length ? glyphs[(Math.random() * glyphs.length) | 0] : null)
    const pickColor = () => colors[(Math.random() * colors.length) | 0]

    const makeFlake = (seeded: boolean): Flake => ({
      x: Math.random() * width,
      y: seeded ? Math.random() * height : -rand(10, 60),
      vy: rand(speedMin, speedMax),
      size: rand(sizeMin, sizeMax),
      phase: rand(0, Math.PI * 2),
      phaseSpeed: rand(0.005, 0.02),
      amp: rand(0.3, 1) * sway,
      rot: rand(0, Math.PI * 2),
      vrot: spin ? rand(-0.03, 0.03) : 0,
      alpha: rand(0.55, 1),
      glyph: pickGlyph(),
      color: pickColor()
    })

    const flakes: Flake[] = []
    for (let i = 0; i < count; i += 1) flakes.push(makeFlake(true))

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
      for (const flake of flakes) {
        flake.y += flake.vy
        flake.phase += flake.phaseSpeed
        flake.x += Math.sin(flake.phase) * flake.amp
        flake.rot += flake.vrot
        if (flake.y > height + flake.size) {
          flake.y = -rand(10, 40)
          flake.x = Math.random() * width
          flake.glyph = pickGlyph()
          flake.color = pickColor()
        }
        ctx.globalAlpha = flake.alpha
        if (flake.glyph) {
          ctx.save()
          ctx.translate(flake.x, flake.y)
          if (flake.vrot) ctx.rotate(flake.rot)
          ctx.font = `${flake.size}px ${EMOJI_FONT}`
          ctx.textAlign = "center"
          ctx.textBaseline = "middle"
          ctx.fillText(flake.glyph, 0, 0)
          ctx.restore()
        } else {
          ctx.fillStyle = flake.color
          ctx.beginPath()
          ctx.arc(flake.x, flake.y, flake.size, 0, Math.PI * 2)
          ctx.fill()
        }
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
  }, [glyphs, colors, count, speedMin, speedMax, sizeMin, sizeMax, sway, spin])

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60]" />
}
