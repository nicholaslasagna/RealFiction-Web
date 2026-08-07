/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets a dev server run beside the two built servers the browser suite starts,
  // instead of contending with them over `.next`. Unset everywhere else.
  distDir: process.env.RF_DIST_DIR || ".next",
  images: {
    unoptimized: true
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "shop.realfiction.live" }],
        destination: "https://realfiction.live/store",
        permanent: true
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "store.realfiction.live" }],
        destination: "https://realfiction.live/store",
        permanent: true
      }
    ]
  }
}

export default nextConfig
