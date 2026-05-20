"use client"

import { motion, type HTMLMotionProps } from "framer-motion"

import { cn } from "@/lib/utils"

export function Reveal({
  className,
  delay = 0,
  ...props
}: HTMLMotionProps<"div"> & { delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0.88, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1], delay }}
      className={cn(className)}
      {...props}
    />
  )
}

export function MotionBackground() {
  return (
    <motion.div
      aria-hidden
      className="absolute inset-0 -z-10 opacity-80"
      animate={{
        backgroundPosition: ["0% 0%", "100% 40%", "0% 0%"]
      }}
      transition={{
        duration: 18,
        repeat: Infinity,
        ease: "easeInOut"
      }}
      style={{
        backgroundImage:
          "linear-gradient(120deg, rgba(71,199,255,0.14), rgba(236,176,87,0.08), rgba(50,214,166,0.11), rgba(6,16,28,0))",
        backgroundSize: "220% 220%"
      }}
    />
  )
}
