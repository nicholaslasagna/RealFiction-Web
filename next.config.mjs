/** @type {import('next').NextConfig} */
const nextConfig = {
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
