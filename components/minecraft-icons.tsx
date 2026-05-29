import type { SVGProps } from "react"

/**
 * Pixel-art Minecraft-themed icons.
 *
 * Drawn as 16x16 viewBox SVGs with `shapeRendering: crispEdges` so they
 * read as actual in-game items rather than generic vector glyphs. Each
 * component returns a single <svg> and accepts a `size` so callers can
 * scale them uniformly while keeping the pixel grid sharp.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function pixelSvg(size: number, children: React.ReactNode, rest: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  )
}

/** Nether Star — RealVIP supporter rank. */
export function NetherStarIcon({ size = 22, ...rest }: IconProps) {
  return pixelSvg(
    size,
    <>
      {/* outer points (gold trim) */}
      <rect x="7" y="1" width="2" height="2" fill="#fff7c8" />
      <rect x="7" y="13" width="2" height="2" fill="#fff7c8" />
      <rect x="1" y="7" width="2" height="2" fill="#fff7c8" />
      <rect x="13" y="7" width="2" height="2" fill="#fff7c8" />
      {/* diagonal points */}
      <rect x="3" y="3" width="2" height="2" fill="#fff7c8" />
      <rect x="11" y="3" width="2" height="2" fill="#fff7c8" />
      <rect x="3" y="11" width="2" height="2" fill="#fff7c8" />
      <rect x="11" y="11" width="2" height="2" fill="#fff7c8" />
      {/* body */}
      <rect x="5" y="5" width="6" height="6" fill="#f6f1ff" />
      <rect x="4" y="6" width="8" height="4" fill="#f6f1ff" />
      <rect x="6" y="4" width="4" height="8" fill="#f6f1ff" />
      {/* center sparkle */}
      <rect x="7" y="7" width="2" height="2" fill="#ffffff" />
      {/* shadow */}
      <rect x="5" y="10" width="6" height="1" fill="#b9aacf" />
    </>,
    rest
  )
}

/** Elytra — Lobby Flight perk. */
export function ElytraIcon({ size = 22, ...rest }: IconProps) {
  return pixelSvg(
    size,
    <>
      {/* wing membrane left */}
      <rect x="1" y="4" width="6" height="1" fill="#6d4a44" />
      <rect x="1" y="5" width="7" height="1" fill="#8c6259" />
      <rect x="1" y="6" width="7" height="1" fill="#a17b71" />
      <rect x="2" y="7" width="6" height="1" fill="#a17b71" />
      <rect x="3" y="8" width="5" height="1" fill="#8c6259" />
      <rect x="4" y="9" width="4" height="1" fill="#6d4a44" />
      {/* wing membrane right (mirror) */}
      <rect x="9" y="4" width="6" height="1" fill="#6d4a44" />
      <rect x="8" y="5" width="7" height="1" fill="#8c6259" />
      <rect x="8" y="6" width="7" height="1" fill="#a17b71" />
      <rect x="8" y="7" width="6" height="1" fill="#a17b71" />
      <rect x="8" y="8" width="5" height="1" fill="#8c6259" />
      <rect x="8" y="9" width="4" height="1" fill="#6d4a44" />
      {/* spine */}
      <rect x="7" y="3" width="2" height="9" fill="#3d2924" />
      {/* highlights */}
      <rect x="2" y="5" width="3" height="1" fill="#c79b8d" />
      <rect x="11" y="5" width="3" height="1" fill="#c79b8d" />
    </>,
    rest
  )
}

/** Bone — Pets perk. */
export function BoneIcon({ size = 22, ...rest }: IconProps) {
  return pixelSvg(
    size,
    <>
      {/* shaft */}
      <rect x="5" y="7" width="6" height="2" fill="#f1ead8" />
      <rect x="5" y="7" width="6" height="1" fill="#ffffff" />
      <rect x="5" y="9" width="6" height="1" fill="#c8c1a8" />
      {/* left bulb */}
      <rect x="3" y="5" width="2" height="2" fill="#f1ead8" />
      <rect x="2" y="6" width="3" height="2" fill="#f1ead8" />
      <rect x="3" y="8" width="2" height="2" fill="#f1ead8" />
      <rect x="2" y="6" width="1" height="1" fill="#ffffff" />
      <rect x="2" y="8" width="3" height="1" fill="#c8c1a8" />
      {/* right bulb */}
      <rect x="11" y="5" width="2" height="2" fill="#f1ead8" />
      <rect x="11" y="6" width="3" height="2" fill="#f1ead8" />
      <rect x="11" y="8" width="2" height="2" fill="#f1ead8" />
      <rect x="13" y="6" width="1" height="1" fill="#ffffff" />
      <rect x="11" y="8" width="3" height="1" fill="#c8c1a8" />
      {/* outline */}
      <rect x="2" y="5" width="1" height="1" fill="#9a937c" />
      <rect x="4" y="4" width="1" height="1" fill="#9a937c" />
      <rect x="11" y="4" width="1" height="1" fill="#9a937c" />
      <rect x="13" y="5" width="1" height="1" fill="#9a937c" />
    </>,
    rest
  )
}

/** Firework Rocket — Particles perk. */
export function FireworkRocketIcon({ size = 22, ...rest }: IconProps) {
  return pixelSvg(
    size,
    <>
      {/* paper tube */}
      <rect x="6" y="3" width="4" height="7" fill="#e5e1d4" />
      <rect x="6" y="3" width="1" height="7" fill="#ffffff" />
      <rect x="9" y="3" width="1" height="7" fill="#b8b3a1" />
      {/* red band */}
      <rect x="6" y="5" width="4" height="1" fill="#c4292d" />
      <rect x="6" y="7" width="4" height="1" fill="#c4292d" />
      {/* cap */}
      <rect x="6" y="2" width="4" height="1" fill="#888272" />
      <rect x="7" y="1" width="2" height="1" fill="#888272" />
      {/* fuse */}
      <rect x="8" y="0" width="1" height="2" fill="#6b3f1e" />
      {/* stick */}
      <rect x="7" y="10" width="2" height="5" fill="#7a5530" />
      <rect x="7" y="10" width="1" height="5" fill="#a17646" />
    </>,
    rest
  )
}

/** Dye splash — Username Colors perk. */
export function DyeIcon({ size = 22, ...rest }: IconProps) {
  return pixelSvg(
    size,
    <>
      {/* color blocks arranged as a 3x3 dye palette */}
      <rect x="2" y="2" width="3" height="3" fill="#c4292d" />
      <rect x="6" y="2" width="3" height="3" fill="#f2c66d" />
      <rect x="10" y="2" width="3" height="3" fill="#3eb336" />
      <rect x="2" y="6" width="3" height="3" fill="#4e9bd5" />
      <rect x="6" y="6" width="3" height="3" fill="#f6f1ff" />
      <rect x="10" y="6" width="3" height="3" fill="#b94ec4" />
      <rect x="2" y="10" width="3" height="3" fill="#2a2826" />
      <rect x="6" y="10" width="3" height="3" fill="#d97757" />
      <rect x="10" y="10" width="3" height="3" fill="#f5d28a" />
      {/* highlights — top-left pixel of each block */}
      <rect x="2" y="2" width="1" height="1" fill="#ff7a7e" />
      <rect x="6" y="2" width="1" height="1" fill="#ffe9a8" />
      <rect x="10" y="2" width="1" height="1" fill="#92e088" />
      <rect x="2" y="6" width="1" height="1" fill="#9ed1f5" />
      <rect x="10" y="6" width="1" height="1" fill="#e89cf5" />
      <rect x="2" y="10" width="1" height="1" fill="#6c6964" />
      <rect x="6" y="10" width="1" height="1" fill="#ffae8e" />
      <rect x="10" y="10" width="1" height="1" fill="#fff0c4" />
    </>,
    rest
  )
}

/** Crafting Table — generic "perks" / shop hero icon. */
export function CraftingTableIcon({ size = 22, ...rest }: IconProps) {
  return pixelSvg(
    size,
    <>
      {/* top surface (grid) */}
      <rect x="2" y="2" width="12" height="5" fill="#7a5530" />
      <rect x="2" y="2" width="12" height="1" fill="#a17646" />
      <rect x="2" y="2" width="1" height="5" fill="#a17646" />
      <rect x="13" y="2" width="1" height="5" fill="#583c20" />
      {/* 3x3 grid lines */}
      <rect x="6" y="2" width="1" height="5" fill="#583c20" />
      <rect x="10" y="2" width="1" height="5" fill="#583c20" />
      <rect x="2" y="4" width="12" height="1" fill="#583c20" />
      {/* sides */}
      <rect x="2" y="7" width="12" height="7" fill="#5b3a1d" />
      <rect x="2" y="7" width="12" height="1" fill="#7a5530" />
      <rect x="2" y="7" width="1" height="7" fill="#7a5530" />
      <rect x="13" y="7" width="1" height="7" fill="#3e2814" />
      {/* leg shadow */}
      <rect x="2" y="13" width="12" height="1" fill="#3e2814" />
    </>,
    rest
  )
}

/** Diamond chestplate — Cosmetics category (appearance / gear). */
export function ArmorIcon({ size = 22, ...rest }: IconProps) {
  return pixelSvg(
    size,
    <>
      {/* shoulder pads */}
      <rect x="2" y="3" width="4" height="3" fill="#4fd0c4" />
      <rect x="10" y="3" width="4" height="3" fill="#4fd0c4" />
      {/* torso */}
      <rect x="2" y="6" width="12" height="6" fill="#4fd0c4" />
      {/* neck hole */}
      <rect x="6" y="3" width="4" height="2" fill="#0a1a2a" />
      {/* top highlights */}
      <rect x="2" y="3" width="4" height="1" fill="#8af0e6" />
      <rect x="10" y="3" width="4" height="1" fill="#8af0e6" />
      <rect x="2" y="6" width="12" height="1" fill="#8af0e6" />
      {/* center seam */}
      <rect x="7" y="6" width="2" height="6" fill="#33b3a7" />
      {/* bottom shadow */}
      <rect x="2" y="11" width="12" height="1" fill="#2a9b90" />
      {/* outline */}
      <rect x="2" y="3" width="1" height="9" fill="#176b63" />
      <rect x="13" y="3" width="1" height="9" fill="#176b63" />
      <rect x="2" y="12" width="12" height="1" fill="#176b63" />
    </>,
    rest
  )
}

/** Chest — Gift Cards category (loot / a gift to open). */
export function ChestIcon({ size = 22, ...rest }: IconProps) {
  return pixelSvg(
    size,
    <>
      {/* lid */}
      <rect x="2" y="3" width="12" height="4" fill="#7a5530" />
      <rect x="2" y="3" width="12" height="1" fill="#9a6e3f" />
      {/* body */}
      <rect x="2" y="7" width="12" height="6" fill="#6b481f" />
      {/* lid / body seam */}
      <rect x="2" y="7" width="12" height="1" fill="#3e2814" />
      {/* plank divisions */}
      <rect x="6" y="8" width="1" height="5" fill="#5b3a1d" />
      <rect x="9" y="8" width="1" height="5" fill="#5b3a1d" />
      {/* iron latch */}
      <rect x="7" y="5" width="2" height="4" fill="#cfcfcf" />
      <rect x="7" y="5" width="2" height="1" fill="#efefef" />
      <rect x="7" y="8" width="2" height="1" fill="#8a8a8a" />
      {/* outline */}
      <rect x="2" y="3" width="1" height="10" fill="#3e2814" />
      <rect x="13" y="3" width="1" height="10" fill="#3e2814" />
      <rect x="2" y="12" width="12" height="1" fill="#3e2814" />
    </>,
    rest
  )
}

/** Oak door — sign out (leave the server). */
export function DoorIcon({ size = 22, ...rest }: IconProps) {
  return pixelSvg(
    size,
    <>
      {/* door slab */}
      <rect x="4" y="2" width="8" height="12" fill="#8a5a2b" />
      {/* top + left highlight */}
      <rect x="4" y="2" width="8" height="1" fill="#a8743c" />
      <rect x="4" y="2" width="1" height="12" fill="#a8743c" />
      {/* panel inset lines */}
      <rect x="5" y="4" width="6" height="1" fill="#5e3c1c" />
      <rect x="5" y="9" width="6" height="1" fill="#5e3c1c" />
      <rect x="8" y="3" width="1" height="10" fill="#5e3c1c" />
      {/* knob */}
      <rect x="10" y="8" width="1" height="2" fill="#2a2a2a" />
      {/* outline */}
      <rect x="3" y="2" width="1" height="12" fill="#3e2814" />
      <rect x="12" y="2" width="1" height="12" fill="#3e2814" />
      <rect x="4" y="13" width="8" height="1" fill="#3e2814" />
    </>,
    rest
  )
}

/** Compass — points to spawn / home. */
export function CompassIcon({ size = 22, ...rest }: IconProps) {
  return pixelSvg(
    size,
    <>
      {/* ring */}
      <rect x="5" y="2" width="6" height="1" fill="#8a8f98" />
      <rect x="5" y="13" width="6" height="1" fill="#8a8f98" />
      <rect x="2" y="5" width="1" height="6" fill="#8a8f98" />
      <rect x="13" y="5" width="1" height="6" fill="#8a8f98" />
      <rect x="3" y="3" width="2" height="2" fill="#8a8f98" />
      <rect x="11" y="3" width="2" height="2" fill="#8a8f98" />
      <rect x="3" y="11" width="2" height="2" fill="#8a8f98" />
      <rect x="11" y="11" width="2" height="2" fill="#8a8f98" />
      {/* face */}
      <rect x="4" y="4" width="8" height="8" fill="#23303f" />
      <rect x="5" y="4" width="6" height="1" fill="#33455a" />
      {/* needle north (red) */}
      <rect x="7" y="4" width="2" height="4" fill="#d2433f" />
      {/* needle south (white) */}
      <rect x="7" y="8" width="2" height="3" fill="#e8e8e8" />
      {/* gold pivot */}
      <rect x="7" y="7" width="2" height="2" fill="#f2c66d" />
    </>,
    rest
  )
}

/** Gear — settings. */
export function GearIcon({ size = 22, ...rest }: IconProps) {
  return pixelSvg(
    size,
    <>
      {/* cardinal teeth */}
      <rect x="7" y="1" width="2" height="2" fill="#9aa0a8" />
      <rect x="7" y="13" width="2" height="2" fill="#9aa0a8" />
      <rect x="1" y="7" width="2" height="2" fill="#9aa0a8" />
      <rect x="13" y="7" width="2" height="2" fill="#9aa0a8" />
      {/* diagonal teeth */}
      <rect x="3" y="3" width="2" height="2" fill="#9aa0a8" />
      <rect x="11" y="3" width="2" height="2" fill="#9aa0a8" />
      <rect x="3" y="11" width="2" height="2" fill="#9aa0a8" />
      <rect x="11" y="11" width="2" height="2" fill="#9aa0a8" />
      {/* body */}
      <rect x="4" y="4" width="8" height="8" fill="#c2c7ce" />
      <rect x="4" y="4" width="8" height="1" fill="#e2e6ea" />
      <rect x="4" y="4" width="1" height="8" fill="#e2e6ea" />
      <rect x="4" y="11" width="8" height="1" fill="#7e848c" />
      <rect x="11" y="4" width="1" height="8" fill="#7e848c" />
      {/* center hole */}
      <rect x="6" y="6" width="4" height="4" fill="#23303f" />
    </>,
    rest
  )
}

/** Steve head — the linked Minecraft player. */
export function SteveHeadIcon({ size = 22, ...rest }: IconProps) {
  return pixelSvg(
    size,
    <>
      {/* hair */}
      <rect x="3" y="2" width="10" height="3" fill="#3a2a16" />
      <rect x="3" y="5" width="2" height="2" fill="#3a2a16" />
      <rect x="11" y="5" width="2" height="2" fill="#3a2a16" />
      {/* face skin */}
      <rect x="5" y="5" width="6" height="8" fill="#b07a4e" />
      <rect x="3" y="7" width="2" height="6" fill="#b07a4e" />
      <rect x="11" y="7" width="2" height="6" fill="#b07a4e" />
      <rect x="5" y="5" width="6" height="1" fill="#c79066" />
      {/* eye whites */}
      <rect x="5" y="7" width="2" height="2" fill="#e8e8e8" />
      <rect x="9" y="7" width="2" height="2" fill="#e8e8e8" />
      {/* pupils */}
      <rect x="6" y="7" width="1" height="2" fill="#3b5ca8" />
      <rect x="10" y="7" width="1" height="2" fill="#3b5ca8" />
      {/* nose + mouth */}
      <rect x="7" y="9" width="2" height="1" fill="#8a5e38" />
      <rect x="6" y="11" width="4" height="1" fill="#8a5e38" />
    </>,
    rest
  )
}

/** Grass block — the world / main server. */
export function GrassBlockIcon({ size = 22, ...rest }: IconProps) {
  return pixelSvg(
    size,
    <>
      {/* grass top */}
      <rect x="2" y="3" width="12" height="4" fill="#5fae3a" />
      <rect x="2" y="3" width="12" height="1" fill="#7bc24f" />
      {/* dirt */}
      <rect x="2" y="7" width="12" height="6" fill="#8a6043" />
      {/* grass blades over dirt */}
      <rect x="3" y="7" width="1" height="1" fill="#5fae3a" />
      <rect x="6" y="7" width="1" height="1" fill="#5fae3a" />
      <rect x="9" y="7" width="1" height="1" fill="#5fae3a" />
      <rect x="12" y="7" width="1" height="1" fill="#5fae3a" />
      {/* dirt specks */}
      <rect x="4" y="9" width="2" height="2" fill="#6e4a32" />
      <rect x="9" y="10" width="2" height="2" fill="#6e4a32" />
      {/* outline */}
      <rect x="2" y="3" width="1" height="10" fill="#2f2a22" />
      <rect x="13" y="3" width="1" height="10" fill="#2f2a22" />
      <rect x="2" y="12" width="12" height="1" fill="#2f2a22" />
    </>,
    rest
  )
}

/** Written book — support / write to us. */
export function BookIcon({ size = 22, ...rest }: IconProps) {
  return pixelSvg(
    size,
    <>
      {/* spine */}
      <rect x="3" y="2" width="2" height="12" fill="#6f2a2a" />
      {/* cover */}
      <rect x="5" y="2" width="7" height="12" fill="#9a3b3b" />
      <rect x="5" y="2" width="7" height="1" fill="#bd5a5a" />
      {/* page edges (opening side) */}
      <rect x="12" y="3" width="2" height="10" fill="#f1ead8" />
      <rect x="13" y="3" width="1" height="10" fill="#cfc6ad" />
      {/* gold binding bands */}
      <rect x="6" y="5" width="5" height="1" fill="#f2c66d" />
      <rect x="6" y="10" width="5" height="1" fill="#f2c66d" />
      {/* outline */}
      <rect x="3" y="2" width="1" height="12" fill="#3a1414" />
      <rect x="3" y="2" width="9" height="1" fill="#3a1414" />
      <rect x="3" y="13" width="9" height="1" fill="#3a1414" />
      <rect x="12" y="13" width="2" height="1" fill="#3a1414" />
    </>,
    rest
  )
}

/** Emerald — business / trade. */
export function EmeraldIcon({ size = 22, ...rest }: IconProps) {
  return pixelSvg(
    size,
    <>
      {/* body */}
      <rect x="6" y="2" width="4" height="1" fill="#34c878" />
      <rect x="5" y="3" width="6" height="1" fill="#34c878" />
      <rect x="4" y="4" width="8" height="6" fill="#34c878" />
      <rect x="5" y="10" width="6" height="1" fill="#34c878" />
      <rect x="6" y="11" width="4" height="1" fill="#34c878" />
      <rect x="7" y="12" width="2" height="1" fill="#34c878" />
      {/* light facet (top-left) */}
      <rect x="5" y="3" width="3" height="1" fill="#7af0ac" />
      <rect x="4" y="4" width="2" height="3" fill="#5fe89a" />
      {/* dark facet (bottom-right) */}
      <rect x="10" y="4" width="2" height="6" fill="#1f9e57" />
      <rect x="8" y="10" width="3" height="1" fill="#1f9e57" />
      {/* center seam + sparkle */}
      <rect x="8" y="3" width="1" height="9" fill="#26a861" />
      <rect x="6" y="5" width="1" height="1" fill="#ffffff" />
      {/* outline */}
      <rect x="6" y="1" width="4" height="1" fill="#10502e" />
      <rect x="4" y="3" width="1" height="1" fill="#10502e" />
      <rect x="11" y="3" width="1" height="1" fill="#10502e" />
      <rect x="3" y="4" width="1" height="6" fill="#10502e" />
      <rect x="12" y="4" width="1" height="6" fill="#10502e" />
      <rect x="7" y="13" width="2" height="1" fill="#10502e" />
    </>,
    rest
  )
}
