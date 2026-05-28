/**
 * Mockup-styled footer (.rf-footer class):
 *   - Centered layout on navy-deep bg
 *   - Big wordmark home link
 *   - Business + Support email blocks
 *   - Simple copyright line
 */
export function SiteFooter() {
  return (
    <footer className="rf-footer">
      <a className="home-link" href="/">
        realfiction.live
      </a>
      <h4>Business Inquiries:</h4>
      <p className="email">business@realfiction.live</p>
      <h4>General Support:</h4>
      <p className="email">support@realfiction.live</p>
      <p className="copyright">
        © 2026 RealFiction · Not affiliated with Mojang or Microsoft.
      </p>
    </footer>
  )
}
