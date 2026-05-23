package com.realfiction.realcore.playtime;

import com.realfiction.realcore.RealCorePlugin;
import com.realfiction.realcore.api.PlatformApiClient;
import com.realfiction.realcore.api.dto.PlaytimeLeaderboardRequest;
import com.realfiction.realcore.api.dto.PlaytimeLeaderboardResponse;
import com.realfiction.realcore.api.dto.PlaytimeSyncRequest;
import com.realfiction.realcore.config.PlaytimeConfig;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.stats.NetworkStatService;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Queue;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.logging.Level;

/**
 * Tracks per-backend play sessions and reports them to the website so totals span
 * the whole network.
 *
 * <p>Folia-safe by construction: join/quit handlers capture only primitives
 * (UUID + name) on their own thread and hand them here; the async flusher and
 * leaderboard fetch never touch the Bukkit API - they read the in-memory session
 * map and call the HTTP client only.
 *
 * <p>Each connection gets a client session id, and every report carries the
 * cumulative "seconds since join" for that session, so the website adds only the
 * positive delta - duplicate/retried flushes (including a re-sent end) add zero.
 *
 * <p>Leaderboard cache here backs legacy {@code %realcore_playtime_*%} placeholders
 * ({@code playtime_leaderboard} RPC). Generic {@code %realcore_stat_playtime.*%}
 * placeholders use {@link NetworkStatService} instead; see that class for how the
 * two caches converge.
 */
public final class PlaytimeTracker {
  private final RealCorePlugin plugin;
  private final RealCoreConfig config;
  private final PlaytimeConfig playtimeConfig;
  private final RealCoreScheduler scheduler;
  private final PlatformApiClient apiClient;

  private final Map<UUID, ActiveSession> sessions = new ConcurrentHashMap<>();
  private final Queue<PlaytimeSyncRequest.Event> pendingDiscrete = new ConcurrentLinkedQueue<>();
  private final Map<String, List<PlaytimeLeaderboardResponse.Entry>> leaderboard = new ConcurrentHashMap<>();
  private final Map<UUID, Long> playerTotals = new ConcurrentHashMap<>();

  private final AtomicBoolean running = new AtomicBoolean(false);
  private final AtomicBoolean flushRunning = new AtomicBoolean(false);
  private final AtomicBoolean needsReconcile = new AtomicBoolean(true);
  private volatile long lastSyncAtMillis = 0L;
  private ScheduledTaskHandle flushHandle;
  private ScheduledTaskHandle leaderboardHandle;

  public PlaytimeTracker(RealCorePlugin plugin, RealCoreConfig config, PlaytimeConfig playtimeConfig,
                         RealCoreScheduler scheduler, PlatformApiClient apiClient) {
    this.plugin = plugin;
    this.config = config;
    this.playtimeConfig = playtimeConfig;
    this.scheduler = scheduler;
    this.apiClient = apiClient;
  }

  public void start() {
    if (!running.compareAndSet(false, true)) {
      return;
    }
    needsReconcile.set(true);
    flushHandle = scheduler.runAsyncRepeating(this::flushSafely, 5, playtimeConfig.flushInterval().toSeconds());
    leaderboardHandle = scheduler.runAsyncRepeating(this::refreshLeaderboards, 8, playtimeConfig.leaderboardRefresh().toSeconds());
  }

  public void stop() {
    running.set(false);
    if (flushHandle != null) {
      flushHandle.cancel();
      flushHandle = null;
    }
    if (leaderboardHandle != null) {
      leaderboardHandle.cancel();
      leaderboardHandle = null;
    }
    sessions.clear();
    pendingDiscrete.clear();
  }

  // ---- Called from the listener (on-thread, primitives only) ---------------

  public void onJoin(UUID uuid, String name) {
    if (!running.get() || uuid == null) {
      return;
    }
    String sessionId = UUID.randomUUID().toString();
    sessions.put(uuid, new ActiveSession(sessionId, name, System.currentTimeMillis()));
    pendingDiscrete.add(new PlaytimeSyncRequest.Event("start", sessionId, uuid.toString(), name, 0));
  }

  public void onQuit(UUID uuid, String name) {
    if (uuid == null) {
      return;
    }
    ActiveSession session = sessions.remove(uuid);
    if (session == null) {
      return;
    }
    long seconds = Math.max(0L, (System.currentTimeMillis() - session.joinedAtMillis) / 1000L);
    String username = name != null ? name : session.username;
    pendingDiscrete.add(new PlaytimeSyncRequest.Event("end", session.sessionId, uuid.toString(), username, seconds));
  }

  // ---- Observability -------------------------------------------------------

  public int activeSessionCount() {
    return sessions.size();
  }

  public int pendingEventCount() {
    return pendingDiscrete.size();
  }

  public long lastSyncAgoSeconds() {
    return lastSyncAtMillis == 0L ? -1L : (System.currentTimeMillis() - lastSyncAtMillis) / 1000L;
  }

  public List<PlaytimeLeaderboardResponse.Entry> topPlaytime(String group) {
    return leaderboard.getOrDefault(group, List.of());
  }

  /** Network-wide seconds for a player: cached total plus live time on this server. */
  public long playerTotalSeconds(UUID uuid) {
    if (uuid == null) {
      return 0L;
    }
    long base = playerTotals.getOrDefault(uuid, 0L);
    ActiveSession active = sessions.get(uuid);
    if (active != null) {
      base += Math.max(0L, (System.currentTimeMillis() - active.joinedAtMillis) / 1000L);
    }
    return base;
  }

  // ---- Flush ---------------------------------------------------------------

  private void flushSafely() {
    if (!running.get() || !flushRunning.compareAndSet(false, true)) {
      return;
    }
    try {
      doFlush().whenComplete((ignored, error) -> flushRunning.set(false));
    } catch (RuntimeException error) {
      flushRunning.set(false);
      plugin.getLogger().log(Level.WARNING, "Playtime flush failed", error);
    }
  }

  private CompletableFuture<Void> doFlush() {
    boolean reconcile = needsReconcile.getAndSet(false);

    List<PlaytimeSyncRequest.Event> discrete = new ArrayList<>();
    PlaytimeSyncRequest.Event event;
    while ((event = pendingDiscrete.poll()) != null && discrete.size() < 500) {
      discrete.add(event);
    }

    List<PlaytimeSyncRequest.Event> events = new ArrayList<>(discrete);
    long now = System.currentTimeMillis();
    for (Map.Entry<UUID, ActiveSession> entry : sessions.entrySet()) {
      ActiveSession session = entry.getValue();
      long seconds = Math.max(0L, (now - session.joinedAtMillis) / 1000L);
      events.add(new PlaytimeSyncRequest.Event("progress", session.sessionId, entry.getKey().toString(), session.username, seconds));
    }

    if (events.isEmpty() && !reconcile) {
      return CompletableFuture.completedFuture(null);
    }

    PlaytimeSyncRequest request = new PlaytimeSyncRequest(config.serverId(), config.serverGroup(), reconcile, events);
    return apiClient.syncPlaytime(request).handle((response, error) -> {
      if (error != null) {
        // Start/end are one-shot, so re-queue them; progress regenerates next tick.
        pendingDiscrete.addAll(discrete);
        if (reconcile) {
          needsReconcile.set(true);
        }
        if (config.debug()) {
          plugin.getLogger().log(Level.WARNING, "Playtime sync failed; will retry: " + cleanMessage(error), error);
        }
      } else {
        lastSyncAtMillis = System.currentTimeMillis();
        NetworkStatService stats = plugin.networkStatService();
        if (stats != null) {
          stats.refreshPlaytimeKeys();
        }
      }
      return null;
    });
  }

  // ---- Leaderboard cache ---------------------------------------------------

  private void refreshLeaderboards() {
    if (!running.get() || !config.hmacSecretConfigured()) {
      return;
    }
    for (String group : playtimeConfig.leaderboardGroups()) {
      int limit = "all".equalsIgnoreCase(group) ? 100 : playtimeConfig.leaderboardSize();
      apiClient.fetchPlaytimeLeaderboard(new PlaytimeLeaderboardRequest(config.serverId(), group, limit))
          .whenComplete((response, error) -> {
            if (error != null) {
              if (config.debug()) {
                plugin.getLogger().log(Level.WARNING, "Leaderboard fetch failed (" + group + ")", error);
              }
              return;
            }
            if (response == null || response.entries == null) {
              return;
            }
            leaderboard.put(group, List.copyOf(response.entries));
            if ("all".equalsIgnoreCase(group)) {
              Map<UUID, Long> totals = new HashMap<>();
              for (PlaytimeLeaderboardResponse.Entry entry : response.entries) {
                UUID id = parseUuid(entry.uuid);
                if (id != null) {
                  totals.put(id, entry.seconds);
                }
              }
              playerTotals.keySet().retainAll(totals.keySet());
              playerTotals.putAll(totals);
            }
          });
    }
  }

  private UUID parseUuid(String value) {
    if (value == null || value.isBlank()) {
      return null;
    }
    try {
      return UUID.fromString(value.trim());
    } catch (IllegalArgumentException ignored) {
      return null;
    }
  }

  private String cleanMessage(Throwable error) {
    Throwable cursor = error;
    while (cursor.getCause() != null) {
      cursor = cursor.getCause();
    }
    String message = cursor.getMessage();
    return message == null || message.isBlank() ? cursor.getClass().getSimpleName() : message;
  }

  private static final class ActiveSession {
    private final String sessionId;
    private final String username;
    private final long joinedAtMillis;

    private ActiveSession(String sessionId, String username, long joinedAtMillis) {
      this.sessionId = sessionId;
      this.username = username;
      this.joinedAtMillis = joinedAtMillis;
    }
  }
}
