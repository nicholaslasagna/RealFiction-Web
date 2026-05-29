package com.realfiction.realcore.lobby.seasonal;

import org.bukkit.Color;
import org.bukkit.FireworkEffect;

/** Firework/particle colors for a seasonal preview theme. */
public record SeasonalEffectPalette(
    Color primary,
    Color secondary,
    Color accent,
    Color sparkle,
    FireworkEffect.Type burstType
) {
  public static SeasonalEffectPalette patriotic() {
    return new SeasonalEffectPalette(Color.RED, Color.WHITE, Color.BLUE, Color.fromRGB(255, 215, 0),
        FireworkEffect.Type.BALL_LARGE);
  }

  public static SeasonalEffectPalette christmas() {
    return new SeasonalEffectPalette(Color.fromRGB(220, 20, 60), Color.WHITE, Color.fromRGB(0, 128, 0),
        Color.fromRGB(255, 215, 0), FireworkEffect.Type.BURST);
  }

  public static SeasonalEffectPalette halloween() {
    return new SeasonalEffectPalette(Color.fromRGB(255, 140, 0), Color.fromRGB(128, 0, 128),
        Color.fromRGB(40, 0, 60), Color.fromRGB(200, 80, 255), FireworkEffect.Type.BURST);
  }

  public static SeasonalEffectPalette newYears() {
    return new SeasonalEffectPalette(Color.fromRGB(255, 215, 0), Color.WHITE, Color.fromRGB(180, 80, 255),
        Color.AQUA, FireworkEffect.Type.BALL);
  }

  public static SeasonalEffectPalette generic(SeasonalAmbienceTheme theme) {
    return switch (theme) {
      case US250_INDEPENDENCE_DAY, INDEPENDENCE_DAY, VETERANS_DAY, MEMORIAL_DAY -> patriotic();
      case CHRISTMAS -> christmas();
      case HALLOWEEN -> halloween();
      case NEW_YEARS, CHINESE_NEW_YEAR -> newYears();
      default -> new SeasonalEffectPalette(Color.AQUA, Color.WHITE, Color.YELLOW, Color.LIME,
          FireworkEffect.Type.BALL);
    };
  }
}
