package com.realfiction.realcore;

import com.realfiction.realcore.api.PlatformApiClient;
import com.realfiction.realcore.api.dto.HeartbeatRequest;
import com.realfiction.realcore.api.dto.HeartbeatResponse;
import com.realfiction.realcore.command.RealFictionCommand;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.cosmetics.CosmeticsConfig;
import com.realfiction.realcore.cosmetics.CosmeticsListener;
import com.realfiction.realcore.cosmetics.CosmeticEntitlementNotifier;
import com.realfiction.realcore.cosmetics.CosmeticsManager;
import com.realfiction.realcore.economy.EconomyProductionStartupAudit;
import com.realfiction.realcore.economy.EconomyProviderListener;
import com.realfiction.realcore.economy.EconomyProviderService;
import com.realfiction.realcore.economy.EconomyReconciliationListener;
import com.realfiction.realcore.economy.EconomyReconciliationService;
import com.realfiction.realcore.economy.EconomyService;
import com.realfiction.realcore.economy.GameplayEconomySyncService;
import com.realfiction.realcore.economy.GameplayEconomyTransactionBuffer;
import com.realfiction.realcore.economy.GameplayEconomyWriterMetrics;
import com.realfiction.realcore.economy.GameplaySyncLogger;
import com.realfiction.realcore.economy.VaultDeltaShadowService;
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
import com.realfiction.realcore.stats.BufferedNetworkStatWriter;
import com.realfiction.realcore.stats.EconomyMirrorService;
import com.realfiction.realcore.stats.NetworkStatService;
import com.realfiction.realcore.stats.NetworkStatWriter;
import com.realfiction.realcore.stats.listener.StatBlocksListener;
import com.realfiction.realcore.stats.listener.StatKillsListener;
import com.realfiction.realcore.stats.producer.BlockStatProducer;
import com.realfiction.realcore.stats.producer.KillStatProducer;
import com.realfiction.realcore.stats.producer.VoteStatProducer;
import com.realfiction.realcore.economy.VoteRewardLedgerShadowService;
import com.realfiction.realcore.economy.VoteRewardLedgerWriteService;
import com.realfiction.realcore.halloween.HerobrineStalkerListener;
import com.realfiction.realcore.halloween.HerobrineStalkerService;
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
  private BufferedNetworkStatWriter networkStatWriter;
  private EconomyMirrorService economyMirrorService;
  private EconomyService economyService;
  private GameplayEconomyWriterMetrics gameplayEconomyWriterMetrics;
  private GameplaySyncLogger gameplaySyncLogger;
  private GameplayEconomyTransactionBuffer gameplayEconomyTransactionBuffer;
  private GameplayEconomySyncService gameplayEconomySyncService;
  private VaultDeltaShadowService vaultDeltaShadowService;
  private EconomyReconciliationService economyReconciliationService;
  private EconomyProviderService economyProviderService;
  private VoteRewardLedgerShadowService voteRewardLedgerShadowService;
  private VoteRewardLedgerWriteService voteRewardLedgerWriteService;
  private HerobrineStalkerService herobrineStalkerService;
  // Listeners are registered exactly once on enable; producers are swapped on
  // reload so the new writer/group are picked up without a restart.
  private StatKillsListener statKillsListener;
  private StatBlocksListener statBlocksListener;

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
    // Stat producer listeners are also late-bound: they register once and the
    // inner producer reference is swapped on reload by setupNetworkStats().
    statKillsListener = new StatKillsListener(noopKillProducer());
    statBlocksListener = new StatBlocksListener(noopBlockProducer());
    getServer().getPluginManager().registerEvents(statKillsListener, this);
    getServer().getPluginManager().registerEvents(statBlocksListener, this);
    // Always registered; late-binds the reconciliation service and no-ops while it is disabled.
    getServer().getPluginManager().registerEvents(new EconomyReconciliationListener(this), this);
    // Always registered; late-binds the economy provider (shadow/preload) and no-ops while disabled.
    getServer().getPluginManager().registerEvents(new EconomyProviderListener(this), this);
    getServer().getPluginManager().registerEvents(new HerobrineStalkerListener(this::herobrineStalkerService), this);
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
    // Phase 3 wiring: the seasonal celebration service can't take
    // LuckPerms at construction (LobbyManager runs before
    // LuckPermsService.create in reloadRealCore — actually after, but
    // before this setup method finishes), so we forward LuckPerms +
    // the plugin data folder once both are guaranteed to exist. Calling
    // this with luckPermsService=null is safe; the service skips the
    // founding-grant path with a logged warning rather than crashing.
    lobbyManager.seasonalEventsService()
        .configureUs250Founding(luckPermsService, getDataFolder());
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
      EconomyProductionStartupAudit.log(getLogger(), realCoreConfig);
      if (scheduler == null) {
        scheduler = SchedulerFactory.create(this);
      }
      apiClient = new PlatformApiClient(realCoreConfig, getLogger());
      luckPermsService = LuckPermsService.create(this);
      voteRewardLedgerShadowService = new VoteRewardLedgerShadowService(realCoreConfig, getLogger());
      voteRewardLedgerWriteService = new VoteRewardLedgerWriteService(
          realCoreConfig, apiClient::postEconomyTransactions, getLogger());
      CosmeticEntitlementNotifier entitlementNotifier = new CosmeticEntitlementNotifier(
          this, scheduler, this::cosmeticsManager, this::lobbyManager);
      RewardDispatcher dispatcher = new RewardDispatcher(
          this,
          realCoreConfig,
          scheduler,
          luckPermsService,
          voteRewardLedgerShadowService,
          voteRewardLedgerWriteService,
          entitlementNotifier);
      accountLinkService = new AccountLinkService(this, realCoreConfig, scheduler, apiClient);
      rewardPoller = new RewardPoller(this, realCoreConfig, scheduler, apiClient, dispatcher);
      gameplaySyncLogger = new GameplaySyncLogger(getLogger());
      gameplayEconomyWriterMetrics = new GameplayEconomyWriterMetrics();
      economyService = new EconomyService(
          realCoreConfig, scheduler, apiClient, getLogger(), gameplayEconomyWriterMetrics, gameplaySyncLogger);
      gameplayEconomyTransactionBuffer = new GameplayEconomyTransactionBuffer(
          realCoreConfig, economyService, gameplayEconomyWriterMetrics, gameplaySyncLogger, getLogger());
      gameplayEconomySyncService = new GameplayEconomySyncService(
          this,
          realCoreConfig,
          gameplayEconomyTransactionBuffer,
          gameplayEconomyWriterMetrics,
          gameplaySyncLogger,
          scheduler,
          getLogger());
      gameplayEconomySyncService.start();
      herobrineStalkerService = new HerobrineStalkerService(this, realCoreConfig, scheduler, getLogger());
      herobrineStalkerService.start();
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
      economyService.start();
      vaultDeltaShadowService = new VaultDeltaShadowService(this, realCoreConfig, economyService, scheduler, getLogger());
      vaultDeltaShadowService.start();
      economyReconciliationService = new EconomyReconciliationService(
          this, realCoreConfig, economyService, scheduler, getLogger());
      economyReconciliationService.start();
      economyProviderService = new EconomyProviderService(
          this, realCoreConfig, economyService, scheduler, getLogger());
      economyProviderService.start();
      if (!economyService.configuredEnabled()) {
        getLogger().info("Global economy client disabled by economy.enabled.");
      } else if (!economyService.writerRunning()) {
        getLogger().info("Global economy writer not running: " + economyService.disabledReason());
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

  public RewardPoller rewardPoller() {
    return rewardPoller;
  }

  public boolean forceRetryRewardAck(String rewardId) {
    return rewardPoller != null && rewardPoller.forceRetryAck(rewardId);
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

  /**
   * Buffered, async stat writer. Producers (kills/deaths/blocks/votes/economy
   * mirror) call {@link NetworkStatWriter#increment} or {@code set} from any
   * thread; the buffered impl handles batching, retries, and Folia safety.
   * Returns {@code null} when the stats module is off or the writer hasn't
   * loaded yet (e.g. before {@code reloadRealCore}).
   */
  public NetworkStatWriter networkStatWriter() {
    return networkStatWriter;
  }

  /** Concrete writer for /rf stats observability. */
  public BufferedNetworkStatWriter bufferedNetworkStatWriter() {
    return networkStatWriter;
  }

  public EconomyMirrorService economyMirrorService() {
    return economyMirrorService;
  }

  public EconomyService economyService() {
    return economyService;
  }

  public EconomyReconciliationService economyReconciliationService() {
    return economyReconciliationService;
  }

  public EconomyProviderService economyProviderService() {
    return economyProviderService;
  }

  public GameplayEconomyTransactionBuffer gameplayEconomyTransactionBuffer() {
    return gameplayEconomyTransactionBuffer;
  }

  public GameplayEconomySyncService gameplayEconomySyncService() {
    return gameplayEconomySyncService;
  }

  public VaultDeltaShadowService vaultDeltaShadowService() {
    return vaultDeltaShadowService;
  }

  public VoteRewardLedgerShadowService voteRewardLedgerShadowService() {
    return voteRewardLedgerShadowService;
  }

  public VoteRewardLedgerWriteService voteRewardLedgerWriteService() {
    return voteRewardLedgerWriteService;
  }

  public HerobrineStalkerService herobrineStalkerService() {
    return herobrineStalkerService;
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
      String writerSummary = networkStatWriter == null
          ? ", writer not ready"
          : ", writer " + networkStatWriter.queuedEventCount() + " queued/"
              + networkStatWriter.flushIntervalSeconds() + "s";
      stats = networkStatService.cachedKeyCount() + " keys, top "
          + networkStatService.configuredTopN()
          + ", refresh " + networkStatService.refreshIntervalSeconds() + "s, "
          + networkStatService.refreshSuccessCount() + " ok/"
          + networkStatService.refreshFailureCount() + " fail"
          + (ago >= 0 ? ", last " + ago + "s ago" : ", never refreshed")
          + writerSummary;
    }
    String economy;
    if (economyService == null) {
      economy = "not loaded";
    } else if (!economyService.configuredEnabled()) {
      economy = "disabled";
    } else if (!economyService.mutationsAllowed()) {
      economy = "read-only (" + economyService.disabledReason() + ")";
    } else {
      economy = economyService.writerRunning()
          ? "ready (" + economyService.writer().queuedTransactionCount() + " queued)"
          : "not ready (" + economyService.disabledReason() + ")";
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
    getLogger().info("| Global economy: " + economy);
    if (herobrineStalkerService != null) {
      getLogger().info("| Halloween Herobrine: " + herobrineStalkerService.statusSummary());
    }
    if (voteRewardLedgerShadowService != null) {
      getLogger().info("| Vote reward ledger shadow: "
          + (voteRewardLedgerShadowService.enabled() ? "enabled" : "disabled")
          + " (dryRun=" + voteRewardLedgerShadowService.configuredDryRun()
          + ", observed=" + voteRewardLedgerShadowService.observedCount() + ")");
    }
    if (voteRewardLedgerWriteService != null) {
      getLogger().info("| Vote reward ledger writes: "
          + (voteRewardLedgerWriteService.writesEnabled() ? "enabled" : "disabled")
          + " (fallbackCommands=" + voteRewardLedgerWriteService.fallbackCommandsEnabled()
          + ", success=" + voteRewardLedgerWriteService.successCount()
          + ", duplicate=" + voteRewardLedgerWriteService.duplicateSuccessCount()
          + ", failures=" + voteRewardLedgerWriteService.failureCount()
          + ", fallbacks=" + voteRewardLedgerWriteService.fallbackCount() + ")");
    }
    if (vaultDeltaShadowService != null) {
      long ago = vaultDeltaShadowService.lastRunAgoSeconds();
      getLogger().info("| Vault delta shadow: "
          + (vaultDeltaShadowService.running() ? "running" : "disabled")
          + " (sampled=" + vaultDeltaShadowService.sampledCount()
          + ", matched=" + vaultDeltaShadowService.matchedCount()
          + ", deltas=" + vaultDeltaShadowService.deltaCount()
          + ", severe=" + vaultDeltaShadowService.severeDeltaCount()
          + ", skipped=" + vaultDeltaShadowService.skippedCount()
          + ", failures=" + vaultDeltaShadowService.failureCount()
          + (ago >= 0 ? ", last " + ago + "s ago" : ", never run") + ")");
    }
    if (economyService != null) {
      long ago = economyService.lastBalanceReadAgoSeconds();
      getLogger().info("| DB balance reads: "
          + (economyService.dbBalanceReadAllowed() ? "enabled" : "disabled")
          + " (cache=" + economyService.cachedBalanceCount()
          + ", ok=" + economyService.balanceReadSuccessCount()
          + ", failures=" + economyService.balanceReadFailureCount()
          + (ago >= 0 ? ", last " + ago + "s ago" : ", never read") + ")");
    }
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
    StatsConfig statsConfig = StatsConfig.from(getConfig().getConfigurationSection("stats"));
    networkStatService = new NetworkStatService(
        this,
        realCoreConfig,
        statsConfig,
        scheduler,
        apiClient);
    networkStatService.start();

    networkStatWriter = new BufferedNetworkStatWriter(
        realCoreConfig,
        statsConfig.writer(),
        scheduler,
        apiClient::postStatEvents,
        getLogger());
    networkStatWriter.start();

    bindStatProducers(statsConfig, realCoreConfig.serverGroup());
  }

  private void bindStatProducers(StatsConfig statsConfig, String group) {
    StatsConfig.ProducerConfig producers = statsConfig.producers();
    if (statKillsListener != null) {
      statKillsListener.setProducer(producers.killsDeaths()
          ? new KillStatProducer(networkStatWriter, group)
          : noopKillProducer());
    }
    if (statBlocksListener != null) {
      statBlocksListener.setProducer(producers.blocksBroken()
          ? new BlockStatProducer(networkStatWriter, group)
          : noopBlockProducer());
    }
    // Vote producer hooks the reward poller. Only enable when both stats and
    // votes-producer flags are on AND reward polling is active. Disabling at
    // runtime swaps the observer back to a no-op so a /rf reload cleanly stops
    // counting without restarting the poller.
    if (rewardPoller != null) {
      if (producers.votes()) {
        rewardPoller.setDeliveryObserver(new VoteStatProducer(networkStatWriter, group));
      } else {
        rewardPoller.setDeliveryObserver(null);
      }
    }
    // Economy mirror is heavier; only start when explicitly enabled.
    if (producers.economyMirror()) {
      economyMirrorService = new EconomyMirrorService(this, networkStatWriter, scheduler, producers.economyMirrorInterval());
      economyMirrorService.start();
    }
  }

  private static KillStatProducer noopKillProducer() {
    return new KillStatProducer(NoopStatWriter.INSTANCE, null);
  }

  private static BlockStatProducer noopBlockProducer() {
    return new BlockStatProducer(NoopStatWriter.INSTANCE, null);
  }

  private static final class NoopStatWriter implements NetworkStatWriter {
    private static final NoopStatWriter INSTANCE = new NoopStatWriter();

    @Override public void increment(String statKey, java.util.UUID subject, String displayName, long delta) {}
    @Override public void set(String statKey, java.util.UUID subject, String displayName, double value) {}
    @Override public void requestFlush() {}
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
        || !getConfig().isConfigurationSection("rewards.messages")
        || !getConfig().isConfigurationSection("rewards.economy")
        || !getConfig().isConfigurationSection("economy")
        || !getConfig().isConfigurationSection("halloween")
        || !getConfig().isConfigurationSection("halloween.herobrineStalker")
        || !getConfig().contains("halloween.herobrineStalker.servers.allowlist")
        || !getConfig().contains("halloween.herobrineStalker.servers.denylist")
        || !getConfig().contains("economy.dbBalanceReadEnabled")
        || !getConfig().contains("economy.dbBalanceReadBackendAllowlist")
        || !getConfig().contains("economy.dbBalanceReadCacheSeconds")
        || !getConfig().contains("economy.dbBalanceReadMaxPlayersPerBatch")
        || !getConfig().contains("economy.syncVaultFromDbEnabled")
        || !getConfig().contains("economy.syncVaultFromDbBackendAllowlist")
        || !getConfig().contains("economy.syncVaultFromDbMaxPlayersPerRun")
        || !getConfig().contains("economy.syncVaultFromDbMaxDeltaMinor")
        || !getConfig().contains("economy.syncVaultFromDbRequireOnline")
        || !getConfig().contains("economy.syncVaultFromDbDryRunDefault")
        || !getConfig().contains("economy.voteRewardsToLedger")
        || !getConfig().contains("economy.voteRewardsLedgerDryRun")
        || !getConfig().contains("economy.voteRewardsLedgerWritesEnabled")
        || !getConfig().contains("economy.voteRewardsLedgerFallbackCommands")
        || !getConfig().contains("economy.vaultDeltaShadowEnabled")
        || !getConfig().contains("economy.vaultDeltaShadowIntervalSeconds")
        || !getConfig().contains("economy.vaultDeltaShadowMaxPlayersPerRun")
        || !getConfig().contains("economy.vaultDeltaShadowMinDeltaMinor")
        || !getConfig().contains("economy.vaultDeltaShadowMaxLoggedDeltaMinor")
        || !getConfig().contains("economy.vaultDeltaShadowBackendAllowlist")
        || !getConfig().contains("economy.shadow.warningDeltaMinor")
        || !getConfig().contains("economy.shadow.severeDeltaMinor")
        || !getConfig().contains("economy.shadow.ignoreNegativeOneMinorNoise")
        || !getConfig().contains("economy.shadow.repeatedOffenderThreshold")
        || !getConfig().contains("economy.shadow.observationCacheSize")
        || !getConfig().isConfigurationSection("economy.gameplaySync")
        || !getConfig().isConfigurationSection("economy.gameplaySync.producers")
        || !getConfig().isConfigurationSection("economy.gameplaySync.observability")
        || !getConfig().contains("economy.gameplaySync.producers.economyShopGuiBuy")
        || !getConfig().isConfigurationSection("economy.gameplaySync.generic")
        || !getConfig().contains("economy.gameplaySync.dedupCacheSeconds")
        || !getConfig().contains("economy.gameplaySync.dedupCacheMaxEntries");
    if (!missingLobbyDefaults) {
      return;
    }
    getConfig().options().copyDefaults(true);
    saveConfig();
    reloadConfig();
  }

  private void stopServices(boolean closeScheduler) {
    servicesLoaded = false;
    if (economyProviderService != null) {
      economyProviderService.stop();
      economyProviderService = null;
    }
    if (economyReconciliationService != null) {
      economyReconciliationService.stop();
      economyReconciliationService = null;
    }
    if (vaultDeltaShadowService != null) {
      vaultDeltaShadowService.stop();
      vaultDeltaShadowService = null;
    }
    if (economyService != null) {
      economyService.stop();
      economyService = null;
    }
    if (gameplayEconomySyncService != null) {
      gameplayEconomySyncService.stop();
      gameplayEconomySyncService = null;
    }
    gameplayEconomyWriterMetrics = null;
    gameplaySyncLogger = null;
    gameplayEconomyTransactionBuffer = null;
    voteRewardLedgerShadowService = null;
    voteRewardLedgerWriteService = null;
    if (herobrineStalkerService != null) {
      herobrineStalkerService.stop();
      herobrineStalkerService = null;
    }
    if (economyMirrorService != null) {
      economyMirrorService.stop();
      economyMirrorService = null;
    }
    // Drop the producers back to no-ops so a stale writer reference (about to
    // be cleared) is never visible to listeners during a reload window.
    if (statKillsListener != null) {
      statKillsListener.setProducer(noopKillProducer());
    }
    if (statBlocksListener != null) {
      statBlocksListener.setProducer(noopBlockProducer());
    }
    if (rewardPoller != null) {
      rewardPoller.setDeliveryObserver(null);
    }
    if (networkStatWriter != null) {
      // Best-effort final flush so anything queued at shutdown gets POSTed
      // before the API client closes. The flush is async; we simply trigger it
      // and let the writer's stop() drop anything still in-flight afterwards.
      try {
        networkStatWriter.requestFlush();
      } catch (RuntimeException ignored) {
        // nothing useful to do during shutdown
      }
      networkStatWriter.stop();
      networkStatWriter = null;
    }
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
