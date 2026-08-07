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
      <h2>Business Inquiries:</h2>
      <p className="email">business@realfiction.live</p>
      <h2>General Support:</h2>
      <p className="email">support@realfiction.live</p>
      <nav className="legal-links" aria-label="Legal">
        <a href="/privacy">Privacy Policy</a>
        <a href="/terms">Terms &amp; Refund</a>
        <a href="/rules">Rules</a>
      </nav>
      <p className="copyright">
        © 2026 RealFiction · Not affiliated with Mojang or Microsoft.
      </p>
    </footer>
  )
}
