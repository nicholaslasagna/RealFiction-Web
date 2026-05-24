package com.realfiction.realcore.economy;

final class EconomyBalanceFormat {
  private EconomyBalanceFormat() {
  }

  static String formatMinor(long amountMinor, int scale) {
    int safeScale = Math.max(1, scale);
    long absolute = Math.abs(amountMinor);
    long whole = absolute / safeScale;
    long fractional = absolute % safeScale;
    return "$" + (amountMinor < 0 ? "-" : "") + whole + "." + String.format("%02d", fractional);
  }
}
