"use client"

import { useEffect, useRef } from "react"

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", serif'

type Bat = {
  x: number
  baseY: number
  vx: number
  phase: number
  phaseSpeed: number
  amp: number
  size: number
  flap: number
  flapSpeed: number
}

type Ember = {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  life: number
  maxLife: number
  flick: number
  hue: number
}

type Ghost = {
  x: number
  y: number
  vy: number
  size: number
  phase: number
  phaseSpeed: number
  maxAlpha: number
}

/**
 * Dedicated Halloween scene: bats swooping across on sine paths (with a wing
 * flap), glowing embers rising from the ground, and a few ghosts drifting up
 * and fading. Rendered with a low fog band + edge vignette for atmosphere.
 *
 * Transparent, fixed, click-through. Respects prefers-reduced-motion (renders
 * nothing), pauses when the tab is hidden, DPR-capped, fixed pools. No rapid
 * flashing — ember flicker and bat flap are slow and local.
 */
export function HalloweenHaunt() {
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

    const spawnBat = (seeded: boolean): Bat => {
      const size = rand(20, 40)
      const dir = Math.random() < 0.5 ? 1 : -1
      return {
        x: seeded ? rand(0, width) : dir > 0 ? -size : width + size,
        baseY: rand(height * 0.08, height * 0.6),
        vx: dir * rand(0.8, 2.2),
        phase: rand(0, Math.PI * 2),
        phaseSpeed: rand(0.01, 0.03),
        amp: rand(10, 40),
        size,
        flap: rand(0, Math.PI * 2),
        flapSpeed: rand(0.18, 0.32)
      }
    }

    const spawnEmber = (seeded: boolean): Ember => ({
      x: rand(0, width),
      y: seeded ? rand(0, height) : height + rand(0, 40),
      vx: rand(-0.3, 0.3),
      vy: -rand(0.4, 1.2),
      size: rand(1.2, 3),
      life: 0,
      maxLife: rand(120, 260),
      flick: rand(0, Math.PI * 2),
      hue: rand(16, 40)
    })

    const spawnGhost = (seeded: boolean): Ghost => ({
      x: rand(width * 0.1, width * 0.9),
      y: seeded ? rand(0, height) : height + rand(20, 120),
      vy: -rand(0.3, 0.7),
      size: rand(30, 56),
      phase: rand(0, Math.PI * 2),
      phaseSpeed: rand(0.008, 0.02),
      maxAlpha: rand(0.18, 0.4)
    })

    const bats: Bat[] = Array.from({ length: 10 }, () => spawnBat(true))
    const embers: Ember[] = Array.from({ length: 45 }, () => spawnEmber(true))
    const ghosts: Ghost[] = Array.from({ length: 3 }, () => spawnGhost(true))

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

      // Rising embers — additive glow.
      ctx.globalCompositeOperation = "lighter"
      for (const ember of embers) {
        ember.life += 1
        ember.x += ember.vx
        ember.y += ember.vy
        ember.flick += 0.1
        if (ember.life >= ember.maxLife || ember.y < -10) {
          Object.assign(ember, spawnEmber(false))
          continue
        }
        const fade = 1 - ember.life / ember.maxLife
        const flicker = 0.6 + 0.4 * Math.sin(ember.flick)
        ctx.globalAlpha = fade * flicker
        ctx.fillStyle = `hsl(${ember.hue}, 100%, 60%)`
        ctx.beginPath()
        ctx.arc(ember.x, ember.y, ember.size, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalCompositeOperation = "source-over"

      // Drifting ghosts — fade as they rise.
      for (const ghost of ghosts) {
        ghost.y += ghost.vy
        ghost.phase += ghost.phaseSpeed
        ghost.x += Math.sin(ghost.phase) * 0.5
        if (ghost.y < -ghost.size) {
          Object.assign(ghost, spawnGhost(false))
        }
        const rise = Math.max(0, Math.min(1, (ghost.y / height) * 1.4))
        ctx.globalAlpha = ghost.maxAlpha * rise
        ctx.font = `${ghost.size}px ${EMOJI_FONT}`
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillText("👻", ghost.x, ghost.y)
      }

      // Swooping bats — sine path + wing flap (vertical squash).
      ctx.globalAlpha = 1
      for (const bat of bats) {
        bat.x += bat.vx
        bat.phase += bat.phaseSpeed
        bat.flap += bat.flapSpeed
        if ((bat.vx > 0 && bat.x > width + bat.size) || (bat.vx < 0 && bat.x < -bat.size)) {
          Object.assign(bat, spawnBat(false))
        }
        const y = bat.baseY + Math.sin(bat.phase) * bat.amp
        const flapScale = 0.55 + 0.45 * Math.abs(Math.sin(bat.flap))
        ctx.save()
        ctx.translate(bat.x, y)
        ctx.scale(bat.vx < 0 ? -1 : 1, flapScale)
        ctx.font = `${bat.size}px ${EMOJI_FONT}`
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillText("🦇", 0, 0)
        ctx.restore()
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
      <div aria-hidden="true" className="hw-vignette" />
      <div aria-hidden="true" className="hw-fog" />
      <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60]" />
    </>
  )
}
