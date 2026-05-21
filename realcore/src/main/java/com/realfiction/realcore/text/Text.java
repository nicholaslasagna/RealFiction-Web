package com.realfiction.realcore.text;

import java.util.ArrayList;
import java.util.List;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.bukkit.ChatColor;

/** Small text helper for &-style colors and placeholder substitution. */
public final class Text {
  private Text() {
  }

  /** Converts a legacy &/section colored string into an Adventure Component. */
  public static Component component(String legacy) {
    return LegacyComponentSerializer.legacySection().deserialize(color(legacy));
  }

  public static String color(String input) {
    if (input == null) {
      return "";
    }
    return ChatColor.translateAlternateColorCodes('&', input);
  }

  public static List<String> color(List<String> input) {
    List<String> out = new ArrayList<>();
    if (input == null) {
      return out;
    }
    for (String line : input) {
      out.add(color(line));
    }
    return out;
  }

  /** Replaces RealCore placeholders (%player%, %uuid%, %online%, %max_online%). */
  public static String placeholders(String input, String player, String uuid, int online, int maxOnline) {
    if (input == null) {
      return "";
    }
    return input
        .replace("%player%", player == null ? "" : player)
        .replace("%uuid%", uuid == null ? "" : uuid)
        .replace("%online%", Integer.toString(online))
        .replace("%max_online%", Integer.toString(maxOnline));
  }
}
