package com.realfiction.realcore;

import com.realfiction.realcore.api.PlatformApiClient;
import com.realfiction.realcore.api.dto.HeartbeatRequest;
import com.realfiction.realcore.api.dto.HeartbeatResponse;
import com.realfiction.realcore.command.RealFictionCommand;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.cosmetics.CosmeticsConfig;
import com.realfiction.realcore.cosmetics.CosmeticsListener;
import com.realfiction.realcore.cosmetics.CosmeticsManager;
import com.realfiction.realcore.linking.AccountLinkService;
import com.realfiction.realcore.lobby.LobbyItemListener;
import com.realfiction.realcore.lobby.LobbyListener;
import com.realfiction.realcore.lobby.LobbyManager;
import com.realfiction.realcore.lobby.LobbyProtectionListener;
import com.realfiction.realcore.config.PlaytimeConfig;
import com.realfiction.realcore.config.StatsConfig;
import com.realfiction.realcore.luckperms.LuckPermsService;
import com.realfiction.realcore.menu.MenuListener;
import com.realfiction.realcore.playtime.PlaytimeListener;
import com.realfiction.realcore.playtime.PlaytimePlaceholders;
import com.realfiction.realcore.playtime.PlaytimeTracker;
import com.realfiction.realcore.stats.NetworkStatService;
import com.realfiction.realcore.rewards.RewardDispatcher;
import com.realfiction.realcore.rewards.RewardPoller;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import com.realfiction.realcore.scheduler.SchedulerFactory;
import org.bukkit.entity.Player;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.bukkit.command.PluginCommand;
import org.bukkit.plugin.java.JavaPlugin;

public final class RealCorePlugin extends JavaPlugin {
  private RealCoreConfig realCoreConfig;
  private RealCoreScheduler scheduler;
  private PlatformApiClient apiClient;
  private LuckPermsService luckPermsService;
  private AccountLinkService accountLinkService;
  private RewardPoller rewardPoller;
  private LobbyManager lobbyManager;
  private CosmeticsManager cosmeticsManager;
  private boolean servicesLoaded;
  private final String instanceId = UUID.randomUUID().toString();
  private final AtomicBoolean duplicateServerIdHandled = new AtomicBoolean(false);
  private ScheduledTaskHandle heartbeatTask;
  private PlaytimeTracker playtimeTracker;
  private NetworkStatService networkStatService;

  @Override
  public void onEnable() {
    saveDefaultConfig();
    mergeBundledConfigDefaults();
    if (!reloadRealCore(false)) {
      getLogger().severe("RealCore could not start safely. Disabling plugin.");
      getServer().getPluginManager().disablePlugin(this);
      return;
    }

    if (realCoreConfig.modules().cosmetics()) {
      setupCosmetics();
    } else {
      getLogger().info("Cosmetics module disabled by modules.cosmetics.");
    }
    if (realCoreConfig.modules().lobby()) {
      setupLobby();
    } else {
      getLogger().info("Lobby module disabled by modules.lobby.");
    }

    // Playtime listener is always registered (no-ops when the tracker is off);
    // it late-binds the tracker so a reload can swap it. PlaceholderAPI is
    // optional and only touched when present.
    getServer().getPluginManager().registerEvents(new PlaytimeListener(this), this);
    setupPlaceholders();

    RealFictionCommand commandExecutor = new RealFictionCommand(this);
    List<String> commandLabels = registerCommands(commandExecutor);

    logStartupSummary("started", commandLabels);
  }

  @Override
  public void onDisable() {
    if (lobbyManager != null) {
      lobbyManager.shutdown();
      lobbyManager = null;
    }
    if (cosmeticsManager != null) {
      cosmeticsManager.stop();
      cosmeticsManager = null;
    }
    releaseHeartbeat();
    stopServices(true);
  }

  private void setupCosmetics() {
    cosmeticsManager = new CosmeticsManager(this, scheduler, this::lobbyManager, CosmeticsConfig.from(getConfig()));
    getServer().getPluginManager().registerEvents(new CosmeticsListener(cosmeticsManager), this);
    cosmeticsManager.start();
  }

  private void setupLobby() {
    lobbyManager = new LobbyManager(this, scheduler, getConfig());
    if (cosmeticsManager != null) {
      lobbyManager.flightService().setFlightEnabledPredicate(cosmeticsManager::isLobbyFlightSelected);
    }
    var pluginManager = getServer().getPluginManager();
    pluginManager.registerEvents(new LobbyListener(lobbyManager), this);
    pluginManager.registerEvents(new LobbyProtectionListener(lobbyManager), this);
    pluginManager.registerEvents(new LobbyItemListener(lobbyManager), this);
    pluginManager.registerEvents(new MenuListener(lobbyManager.menuService()), this);
    lobbyManager.start();
    getLogger().info("RealCore lobby module loaded (" + lobbyManager.menuRegistry().count()
        + " menus, worlds: " + String.join(", ", lobbyManager.config().worlds()) + ").");
  }

  public boolean reloadRealCore() {
    return reloadRealCore(true);
  }

  private boolean reloadRealCore(boolean logSummary) {
    stopServices(false);

    try {
      reloadConfig();
      mergeBundledConfigDefaults();
      realCoreConfig = RealCoreConfig.from(getConfig());
      if (scheduler == null) {
        scheduler = SchedulerFactory.create(this);
      }
      apiClient = new PlatformApiClient(realCoreConfig, getLogger());
      luckPermsService = new LuckPermsService(this);
      RewardDispatcher dispatcher = new RewardDispatcher(this, realCoreConfig, scheduler, luckPermsService);
      accountLinkService = new AccountLinkService(this, realCoreConfig, scheduler, apiClient);
      rewardPoller = new RewardPoller(this, realCoreConfig, scheduler, apiClient, dispatcher);
      servicesLoaded = true;

      if (lobbyManager != null) {
        lobbyManager.reload(getConfig());
      }
      if (cosmeticsManager != null) {
        cosmeticsManager.reload(CosmeticsConfig.from(getConfig()));
      }

      if (!realCoreConfig.hmacSecretConfigured()) {
        getLogger().warning("RealCore hmacSecret is not configured. Website calls will fail until config.yml is updated.");
        if (logSummary) {
          logStartupSummary("reloaded", registeredCommandLabels());
        }
        return true;
      }

      if (realCoreConfig.modules().rewards()) {
        rewardPoller.start();
      } else {
        getLogger().info("Reward delivery poller disabled by modules.rewards.");
      }
      startHeartbeat();
      if (realCoreConfig.modules().playtime()) {
        setupPlaytime();
      } else {
        getLogger().info("Playtime module disabled by modules.playtime.");
      }
      if (shouldRunNetworkStats()) {
        setupNetworkStats();
      } else {
        getLogger().info("Network stat cache disabled (modules.stats or stats.enabled).");
      }
      if (logSummary) {
        logStartupSummary("reloaded", registeredCommandLabels());
      }
      return true;
    } catch (RuntimeException error) {
      servicesLoaded = false;
      getLogger().severe("RealCore reload failed: " + error.getMessage());
      stopServices(false);
      return false;
    }
  }

  public RealCoreConfig realCoreConfig() {
    return realCoreConfig;
  }

  public AccountLinkService accountLinkService() {
    return accountLinkService;
  }

  public boolean servicesLoaded() {
    return servicesLoaded;
  }

  public boolean luckPermsAvailable() {
    return luckPermsService != null && luckPermsService.available();
  }

  public boolean rewardPollingActive() {
    return rewardPoller != null && rewardPoller.running();
  }

  public int pendingAckCount() {
    return rewardPoller == null ? 0 : rewardPoller.pendingAckCount();
  }

  public int deliveredLedgerSize() {
    return rewardPoller == null ? 0 : rewardPoller.deliveredLedgerSize();
  }

  public List<String> pendingAckSummaries(int limit) {
    return rewardPoller == null ? List.of() : rewardPoller.pendingAckSummaries(limit);
  }

  public RealCoreScheduler scheduler() {
    return scheduler;
  }

  public LobbyManager lobbyManager() {
    return lobbyManager;
  }

  public CosmeticsManager cosmeticsManager() {
    return cosmeticsManager;
  }

  public PlaytimeTracker playtimeTracker() {
    return playtimeTracker;
  }

  public NetworkStatService networkStatService() {
    return networkStatService;
  }

  private List<String> registerCommands(RealFictionCommand commandExecutor) {
    List<String> labels = List.of("realfiction", "rf", "realcore", "cosmetics");
    for (String label : labels) {
      PluginCommand command = Objects.requireNonNull(getCommand(label), label + " command missing");
      command.setExecutor(commandExecutor);
      command.setTabCompleter(commandExecutor);
    }
    return labels;
  }

  private List<String> registeredCommandLabels() {
    return List.of("realfiction", "rf", "realcore", "cosmetics");
  }

  private void logStartupSummary(String action, List<String> commandLabels) {
    RealCoreConfig config = realCoreConfig;
    String version = getDescription().getVersion();
    String schedulerName = scheduler == null ? "not loaded" : scheduler.name();
    String serverId = config == null ? "not loaded" : config.serverId();
    String serverGroup = config == null ? "not loaded" : config.serverGroup();
    String displayName = config == null ? "not loaded" : config.displayName();
    String moduleSummary = config == null ? "not loaded" : config.modules().summary();
    String polling;
    if (config != null && !config.modules().rewards()) {
      polling = "disabled (module off)";
    } else {
      polling = rewardPollingActive() ? "ready" : "not ready";
    }
    String websiteAuth = config != null && config.hmacSecretConfigured() ? "ready" : "not ready";
    String luckPerms = luckPermsAvailable() ? "ready" : "not ready";
    String cosmetics = cosmeticsManager == null ? "not loaded" : "ready";
    String playtime;
    if (config != null && !config.modules().playtime()) {
      playtime = "disabled (module off)";
    } else if (playtimeTracker == null) {
      playtime = "not ready";
    } else {
      playtime = "ready (" + playtimeTracker.activeSessionCount() + " active, "
          + playtimeTracker.pendingEventCount() + " pending)";
    }
    String stats;
    if (config != null && !shouldRunNetworkStats()) {
      stats = "disabled";
    } else if (networkStatService == null) {
      stats = "not ready";
    } else {
      long ago = networkStatService.lastRefreshAgoSeconds();
      stats = networkStatService.cachedKeyCount() + " keys, top "
          + networkStatService.configuredTopN()
          + ", refresh " + networkStatService.refreshIntervalSeconds() + "s, "
          + networkStatService.refreshSuccessCount() + " ok/"
          + networkStatService.refreshFailureCount() + " fail"
          + (ago >= 0 ? ", last " + ago + "s ago" : ", never refreshed");
    }
    String commands = "/" + String.join(", /", commandLabels);
    String menus = lobbyManager == null ? "not loaded" : String.join(", ", lobbyManager.menuRegistry().keys());

    getLogger().info("+--------------------------------------------------+");
    getLogger().info("| RealCore " + version + " " + action);
    getLogger().info("| Scheduler: " + schedulerName);
    getLogger().info("| Server: " + serverId + " (" + displayName + ", group: " + serverGroup + ")");
    getLogger().info("| Instance: " + instanceId);
    getLogger().info("| Modules: " + moduleSummary);
    getLogger().info("| Reward polling: " + polling);
    if (config != null && config.modules().rewards()) {
      getLogger().info("| Reward ledger: " + deliveredLedgerSize() + " delivered, " + pendingAckCount() + " pending ack");
    }
    getLogger().info("| Website auth: " + websiteAuth);
    getLogger().info("| LuckPerms: " + luckPerms);
    getLogger().info("| Cosmetics: " + cosmetics);
    getLogger().info("| Playtime: " + playtime);
    getLogger().info("| Stats: " + stats);
    getLogger().info("| Commands: " + commands);
    getLogger().info("| Menus: " + (menus.isBlank() ? "none" : menus));
    getLogger().info("+--------------------------------------------------+");
  }

  private void startHeartbeat() {
    if (scheduler == null || apiClient == null || realCoreConfig == null || !realCoreConfig.hmacSecretConfigured()) {
      return;
    }
    // Identity heartbeat runs regardless of modules: the website uses it to spot
    // two backends sharing one serverId. First beat at +1s acts as the startup
    // duplicate-id check; it is async so it never blocks (Folia-safe) enable.
    heartbeatTask = scheduler.runAsyncRepeating(this::heartbeatTick, 1, 30);
  }

  private void heartbeatTick() {
    PlatformApiClient client = this.apiClient;
    RealCoreConfig cfg = this.realCoreConfig;
    if (client == null || cfg == null) {
      return;
    }
    HeartbeatRequest request =
        new HeartbeatRequest(cfg.serverId(), instanceId, cfg.serverGroup(), cfg.displayName(), false);
    client.heartbeat(request)
        .thenAccept(this::handleHeartbeat)
        .exceptionally(error -> {
          if (cfg.debug()) {
            getLogger().warning("Server heartbeat failed: " + error.getMessage());
          }
          return null;
        });
  }

  private void handleHeartbeat(HeartbeatResponse response) {
    if (response == null || !response.conflict) {
      return;
    }
    if (!duplicateServerIdHandled.compareAndSet(false, true)) {
      return;
    }
    RealCoreConfig cfg = this.realCoreConfig;
    String serverId = cfg == null ? "?" : cfg.serverId();
    getLogger().severe("Another live backend already uses serverId '" + serverId + "' (active instance "
        + (response.activeInstance == null ? "unknown" : response.activeInstance) + "). Give each server a unique server.id.");
    if (cfg != null && cfg.refuseOnDuplicateServerId()) {
      getLogger().severe("server.refuseOnDuplicate is true; disabling RealCore to avoid a split identity.");
      RealCoreScheduler sched = this.scheduler;
      if (sched != null) {
        sched.runGlobal(() -> getServer().getPluginManager().disablePlugin(this));
      } else {
        getServer().getPluginManager().disablePlugin(this);
      }
    }
  }

  private void releaseHeartbeat() {
    PlatformApiClient client = this.apiClient;
    RealCoreConfig cfg = this.realCoreConfig;
    if (client == null || cfg == null || !cfg.hmacSecretConfigured()) {
      return;
    }
    try {
      client.heartbeat(new HeartbeatRequest(cfg.serverId(), instanceId, cfg.serverGroup(), cfg.displayName(), true))
          .get(2, TimeUnit.SECONDS);
    } catch (Exception ignored) {
      // Best-effort release; a stale registry row simply ages out via the timeout.
    }
  }

  private void setupPlaytime() {
    playtimeTracker = new PlaytimeTracker(
        this,
        realCoreConfig,
        PlaytimeConfig.from(getConfig().getConfigurationSection("playtime")),
        scheduler,
        apiClient);
    playtimeTracker.start();

    // Seed players already online (e.g. after /rf reload). Capture the online
    // list on the global region thread so this stays Folia-safe.
    PlaytimeTracker tracker = playtimeTracker;
    scheduler.runGlobal(() -> {
      for (Player player : getServer().getOnlinePlayers()) {
        tracker.onJoin(player.getUniqueId(), player.getName());
      }
    });
  }

  private boolean shouldRunNetworkStats() {
    if (realCoreConfig == null || !realCoreConfig.modules().stats()) {
      return false;
    }
    return StatsConfig.from(getConfig().getConfigurationSection("stats")).enabled();
  }

  private void setupNetworkStats() {
    networkStatService = new NetworkStatService(
        this,
        realCoreConfig,
        StatsConfig.from(getConfig().getConfigurationSection("stats")),
        scheduler,
        apiClient);
    networkStatService.start();
  }

  private void setupPlaceholders() {
    if (getServer().getPluginManager().getPlugin("PlaceholderAPI") == null) {
      return;
    }
    try {
      new PlaytimePlaceholders(this, getDescription().getVersion()).register();
      getLogger().info("Registered RealCore PlaceholderAPI expansion (realcore).");
    } catch (Throwable error) {
      getLogger().warning("Could not register PlaceholderAPI expansion: " + error.getMessage());
    }
  }

  private void mergeBundledConfigDefaults() {
    reloadConfig();
    boolean missingLobbyDefaults = !getConfig().isConfigurationSection("menus")
        || !getConfig().isConfigurationSection("doubleJump")
        || !getConfig().isConfigurationSection("walkSpeed")
        || !getConfig().isConfigurationSection("proxy.serverAliases")
        || !getConfig().isConfigurationSection("cosmetics")
        || !getConfig().isConfigurationSection("rewards.messages");
    if (!missingLobbyDefaults) {
      return;
    }
    getConfig().options().copyDefaults(true);
    saveConfig();
    reloadConfig();
  }

  private void stopServices(boolean closeScheduler) {
    servicesLoaded = false;
    if (networkStatService != null) {
      networkStatService.stop();
      networkStatService = null;
    }
    if (playtimeTracker != null) {
      playtimeTracker.stop();
      playtimeTracker = null;
    }
    if (heartbeatTask != null) {
      heartbeatTask.cancel();
      heartbeatTask = null;
    }
    if (rewardPoller != null) {
      rewardPoller.stop();
      rewardPoller = null;
    }
    if (apiClient != null) {
      apiClient.close();
      apiClient = null;
    }
    if (closeScheduler && scheduler != null) {
      scheduler.close();
      scheduler = null;
    }
    luckPermsService = null;
    accountLinkService = null;
  }
}
