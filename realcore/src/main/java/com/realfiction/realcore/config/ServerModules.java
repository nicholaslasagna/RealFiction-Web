package com.realfiction.realcore.config;

import org.bukkit.configuration.ConfigurationSection;

/**
 * Per-backend feature toggles so one RealCore jar can run different roles across
 * the network (a full lobby, a votes-only SMP, a cosmetics+menus arcade, etc.).
 *
 * <p>Three modules gate real subsystems today:
 * <ul>
 *   <li>{@code rewards} - the website reward delivery poller (votes + store grants)</li>
 *   <li>{@code cosmetics} - the in-game cosmetics GUI/manager</li>
 *   <li>{@code lobby} - the lobby manager (menus, scoreboard, flight, protection, items)</li>
 *   <li>{@code playtime} - network playtime session tracking</li>
 *   <li>{@code stats} - generic stat leaderboard cache for placeholders</li>
 * </ul>
 * The remaining flags ({@code menus}, {@code scoreboards}, {@code economy},
 * {@code votes}, {@code punishments}, {@code chat}) are parsed and reported for
 * forward compatibility; menus/scoreboards are sub-features of the lobby module,
 * economy is a disabled-by-default client foundation controlled by
 * {@code economy.enabled}, votes are realized through reward delivery +
 * configured commands, and punishments/chat are reserved for future integrations.
 *
 * <p>Defaults keep a single-server install (the current Lobby1) running with
 * everything enabled, so an existing config without a {@code modules} section is
 * unaffected.
 */
public record ServerModules(
    boolean rewards,
    boolean cosmetics,
    boolean lobby,
    boolean menus,
    boolean scoreboards,
    boolean economy,
    boolean votes,
    boolean punishments,
    boolean chat,
    boolean playtime,
    boolean stats
) {
  public static ServerModules defaults() {
    return new ServerModules(true, true, true, true, true, false, true, false, false, true, true);
  }

  public static ServerModules from(ConfigurationSection section) {
    if (section == null) {
      return defaults();
    }
    boolean votes = section.getBoolean("votes", true);
    return new ServerModules(
        // "rewards" gates the poller; fall back to the "votes" flag so a config
        // that only sets votes:false still disables reward delivery.
        section.getBoolean("rewards", votes),
        section.getBoolean("cosmetics", true),
        section.getBoolean("lobby", true),
        section.getBoolean("menus", true),
        section.getBoolean("scoreboards", true),
        section.getBoolean("economy", false),
        votes,
        section.getBoolean("punishments", false),
        section.getBoolean("chat", false),
        // Network playtime tracking; enabled everywhere by default so totals
        // span every backend.
        section.getBoolean("playtime", true),
        // Generic stat leaderboard cache (playtime/votes/economy/...).
        section.getBoolean("stats", true)
    );
  }

  public String summary() {
    StringBuilder builder = new StringBuilder();
    appendFlag(builder, "rewards", rewards);
    appendFlag(builder, "cosmetics", cosmetics);
    appendFlag(builder, "lobby", lobby);
    appendFlag(builder, "menus", menus);
    appendFlag(builder, "scoreboards", scoreboards);
    appendFlag(builder, "economy", economy);
    appendFlag(builder, "votes", votes);
    appendFlag(builder, "punishments", punishments);
    appendFlag(builder, "chat", chat);
    appendFlag(builder, "playtime", playtime);
    appendFlag(builder, "stats", stats);
    return builder.toString();
  }

  private static void appendFlag(StringBuilder builder, String name, boolean value) {
    if (builder.length() > 0) {
      builder.append(", ");
    }
    builder.append(name).append('=').append(value ? "on" : "off");
  }
}
