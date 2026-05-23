package com.realfiction.realcore.config;

import java.time.Duration;
import java.util.List;
import org.bukkit.configuration.ConfigurationSection;

/**
 * Configuration for the network stat subsystem.
 *
 * <p>Three cooperating pieces live under {@code stats:}:
 * <ul>
 *   <li>The leaderboard read cache ({@link #refreshInterval}, {@link #leaderboardSize},
 *       {@link #leaderboardKeys}) used by {@code NetworkStatService} for placeholders
 *       and holograms.</li>
 *   <li>The buffered write path ({@link #writer}) used by
 *       {@code BufferedNetworkStatWriter}: how often it flushes events to the
 *       website and the hard cap on the in-memory queue.</li>
 *   <li>The producer toggles ({@link #producers}) controlling which gameplay
 *       listeners (kills, deaths, blocks broken, votes, economy mirror) feed
 *       the writer.</li>
 * </ul>
 */
public record StatsConfig(
    boolean enabled,
    Duration refreshInterval,
    int leaderboardSize,
    List<String> leaderboardKeys,
    WriterConfig writer,
    ProducerConfig producers
) {
  public static StatsConfig defaults() {
    return new StatsConfig(true, Duration.ofSeconds(120), 10, defaultKeys(), WriterConfig.defaults(), ProducerConfig.defaults());
  }

  public static StatsConfig from(ConfigurationSection section) {
    if (section == null) {
      return defaults();
    }
    boolean enabled = section.getBoolean("enabled", true);
    long refresh = Math.max(30, section.getLong("refreshSeconds", 120));
    int size = Math.max(1, Math.min(100, section.getInt("leaderboardSize", 10)));
    List<String> keys = section.getStringList("leaderboards");
    if (keys.isEmpty()) {
      keys = defaultKeys();
    }
    WriterConfig writer = WriterConfig.from(section.getConfigurationSection("writer"));
    ProducerConfig producers = ProducerConfig.from(section.getConfigurationSection("producers"));
    return new StatsConfig(enabled, Duration.ofSeconds(refresh), size, List.copyOf(keys), writer, producers);
  }

  private static List<String> defaultKeys() {
    return List.of(
        "playtime.total",
        "playtime.lobby",
        "playtime.smp",
        "playtime.factions",
        "playtime.anarchy",
        "playtime.arcade"
    );
  }

  /**
   * Writer-side knobs.
   *
   * @param flushInterval how often {@code BufferedNetworkStatWriter} drains its
   *     in-memory buffer and POSTs a batch (default 30s, min 5s, max 5m).
   * @param bufferSize    hard cap on the number of distinct (statKey, subjectId,
   *     mode) entries the writer holds in memory across the working buffer plus
   *     any pending retry batches. New events that would exceed this cap are
   *     dropped and a counter is incremented (default 50000).
   */
  public record WriterConfig(Duration flushInterval, int bufferSize) {
    public static WriterConfig defaults() {
      return new WriterConfig(Duration.ofSeconds(30), 50_000);
    }

    public static WriterConfig from(ConfigurationSection section) {
      if (section == null) {
        return defaults();
      }
      long flush = section.getLong("flushSeconds", 30);
      flush = Math.max(5, Math.min(300, flush));
      int buffer = section.getInt("bufferSize", 50_000);
      buffer = Math.max(1_000, Math.min(1_000_000, buffer));
      return new WriterConfig(Duration.ofSeconds(flush), buffer);
    }

    public long flushIntervalSeconds() {
      return flushInterval.toSeconds();
    }
  }

  /**
   * Producer toggles. Each is independent and falls back to a safe default when
   * the section is missing. economyMirror defaults <em>off</em> because it
   * requires Vault and may not be desired on every backend.
   *
   * @param killsDeaths           PlayerDeathEvent → kills.total / kills.&lt;group&gt;,
   *                              deaths.total / deaths.&lt;group&gt;
   * @param blocksBroken          BlockBreakEvent → blocks_broken.total / blocks_broken.&lt;group&gt;
   * @param votes                 successful vote.standard reward delivery → votes.total / votes.&lt;group&gt;
   * @param economyMirror         periodic Vault balance mirror → money.total (set mode)
   * @param economyMirrorInterval poll interval for the economy mirror
   */
  public record ProducerConfig(
      boolean killsDeaths,
      boolean blocksBroken,
      boolean votes,
      boolean economyMirror,
      Duration economyMirrorInterval
  ) {
    public static ProducerConfig defaults() {
      return new ProducerConfig(true, true, true, false, Duration.ofMinutes(5));
    }

    public static ProducerConfig from(ConfigurationSection section) {
      if (section == null) {
        return defaults();
      }
      boolean killsDeaths = section.getBoolean("killsDeaths", true);
      boolean blocksBroken = section.getBoolean("blocksBroken", true);
      boolean votes = section.getBoolean("votes", true);
      boolean economyMirror = section.getBoolean("economyMirror", false);
      long mirrorSeconds = Math.max(60, section.getLong("economyMirrorSeconds", 300));
      return new ProducerConfig(killsDeaths, blocksBroken, votes, economyMirror, Duration.ofSeconds(mirrorSeconds));
    }

    public long economyMirrorIntervalSeconds() {
      return economyMirrorInterval.toSeconds();
    }
  }
}
