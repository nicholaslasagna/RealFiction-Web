package com.realfiction.realcore.stats;

import com.realfiction.realcore.RealCorePlugin;
import com.realfiction.realcore.api.PlatformApiClient;
import com.realfiction.realcore.api.dto.StatLeaderboardRequest;
import com.realfiction.realcore.api.dto.StatLeaderboardResponse;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.config.StatsConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Level;

/**
 * Generic, reusable leaderboard cache for any network stat key (playtime.total,
 * votes.total, economy.balance, factions.power, ...). Periodically pulls cached
 * top-N snapshots from the website and serves them to placeholders/holograms, so
 * the database is never hit on the placeholder hot path.
 *
 * <p><b>Dual cache (playtime):</b> legacy {@code %realcore_playtime_*%} placeholders
 * read {@link com.realfiction.realcore.playtime.PlaytimeTracker}'s in-memory cache,
 * fed by {@code POST /api/plugin/playtime/leaderboard} ({@code playtime_leaderboard}
 * RPC over {@code playtime_totals}). Generic {@code %realcore_stat_playtime.*%}
 * placeholders read this service, fed by {@code POST /api/plugin/stats/leaderboard}
 * ({@code get_stat_leaderboard} over {@code network_stat_totals} /
 * {@code network_leaderboard_cache}). Both sources mirror the same authoritative
 * playtime totals and converge after each refresh; a successful playtime flush
 * also triggers {@link #refreshPlaytimeKeys()} so stat placeholders stay close to
 * legacy ones without waiting for the full refresh interval.
 *
 * <p>Folia-safe: the only periodic work is an async fetch + a ConcurrentHashMap
 * write; it never touches the Bukkit API.
 */
public final class NetworkStatService {
  private final RealCorePlugin plugin;
  private final RealCoreConfig config;
  private final StatsConfig statsConfig;
  private final RealCoreScheduler scheduler;
  private final PlatformApiClient apiClient;

  private final Map<String, List<StatLeaderboardResponse.Entry>> cache = new ConcurrentHashMap<>();
  private final AtomicBoolean running = new AtomicBoolean(false);
  private final AtomicInteger refreshSuccess = new AtomicInteger();
  private final AtomicInteger refreshFailure = new AtomicInteger();
  private volatile long lastRefreshMillis = 0L;
  private volatile String lastFailureMessage = "";
  private ScheduledTaskHandle handle;

  public NetworkStatService(RealCorePlugin plugin, RealCoreConfig config, StatsConfig statsConfig,
                            RealCoreScheduler scheduler, PlatformApiClient apiClient) {
    this.plugin = plugin;
    this.config = config;
    this.statsConfig = statsConfig;
    this.scheduler = scheduler;
    this.apiClient = apiClient;
  }

  public void start() {
    if (!running.compareAndSet(false, true)) {
      return;
    }
    handle = scheduler.runAsyncRepeating(this::refreshAll, 10, statsConfig.refreshInterval().toSeconds());
  }

  public void stop() {
    running.set(false);
    if (handle != null) {
      handle.cancel();
      handle = null;
    }
    cache.clear();
  }

  /** Cached top-N for a stat key (empty until the first refresh lands). */
  public List<StatLeaderboardResponse.Entry> top(String statKey) {
    if (statKey == null) {
      return List.of();
    }
    return cache.getOrDefault(statKey, List.of());
  }

  // Observability.
  public int cachedKeyCount() {
    return cache.size();
  }

  public int refreshSuccessCount() {
    return refreshSuccess.get();
  }

  public int refreshFailureCount() {
    return refreshFailure.get();
  }

  public long lastRefreshAgoSeconds() {
    return lastRefreshMillis == 0L ? -1L : (System.currentTimeMillis() - lastRefreshMillis) / 1000L;
  }

  public String lastFailureMessage() {
    return lastFailureMessage;
  }

  public List<String> configuredStatKeys() {
    return statsConfig.leaderboardKeys();
  }

  public int configuredTopN() {
    return statsConfig.leaderboardSize();
  }

  public long refreshIntervalSeconds() {
    return statsConfig.refreshInterval().toSeconds();
  }

  /** Refreshes configured keys prefixed with {@code playtime.} (called after a playtime flush). */
  public void refreshPlaytimeKeys() {
    if (!running.get() || !config.hmacSecretConfigured()) {
      return;
    }
    for (String statKey : statsConfig.leaderboardKeys()) {
      if (statKey.startsWith("playtime.")) {
        refreshKey(statKey);
      }
    }
  }

  private void refreshAll() {
    if (!running.get() || !config.hmacSecretConfigured()) {
      return;
    }
    for (String statKey : statsConfig.leaderboardKeys()) {
      refreshKey(statKey);
    }
  }

  private void refreshKey(String statKey) {
    StatLeaderboardRequest request =
        new StatLeaderboardRequest(config.serverId(), statKey, "player", statsConfig.leaderboardSize(), 60);
    apiClient.fetchStatLeaderboard(request).whenComplete((response, error) -> {
      if (error != null) {
        refreshFailure.incrementAndGet();
        lastFailureMessage = statKey + ": " + error.getMessage();
        if (config.debug()) {
          plugin.getLogger().log(Level.WARNING, "Stat leaderboard fetch failed (" + statKey + ")", error);
        }
        return;
      }
      if (response == null || response.entries == null) {
        refreshFailure.incrementAndGet();
        lastFailureMessage = statKey + ": empty response";
        return;
      }
      cache.put(statKey, List.copyOf(response.entries));
      refreshSuccess.incrementAndGet();
      lastRefreshMillis = System.currentTimeMillis();
      lastFailureMessage = "";
    });
  }
}
