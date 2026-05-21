package com.realfiction.realcore;

import com.realfiction.realcore.api.PlatformApiClient;
import com.realfiction.realcore.command.RealFictionCommand;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.linking.AccountLinkService;
import com.realfiction.realcore.lobby.LobbyItemListener;
import com.realfiction.realcore.lobby.LobbyListener;
import com.realfiction.realcore.lobby.LobbyManager;
import com.realfiction.realcore.lobby.LobbyProtectionListener;
import com.realfiction.realcore.luckperms.LuckPermsService;
import com.realfiction.realcore.menu.MenuListener;
import com.realfiction.realcore.rewards.RewardDispatcher;
import com.realfiction.realcore.rewards.RewardPoller;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.SchedulerFactory;
import java.util.List;
import java.util.Objects;
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
  private boolean servicesLoaded;

  @Override
  public void onEnable() {
    saveDefaultConfig();
    if (!reloadRealCore(false)) {
      getLogger().severe("RealCore could not start safely. Disabling plugin.");
      getServer().getPluginManager().disablePlugin(this);
      return;
    }

    setupLobby();

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
    stopServices(true);
  }

  private void setupLobby() {
    lobbyManager = new LobbyManager(this, scheduler, getConfig());
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
      realCoreConfig = RealCoreConfig.from(getConfig());
      if (scheduler == null) {
        scheduler = SchedulerFactory.create(this);
      }
      apiClient = new PlatformApiClient(realCoreConfig);
      luckPermsService = new LuckPermsService(this);
      RewardDispatcher dispatcher = new RewardDispatcher(this, realCoreConfig, scheduler, luckPermsService);
      accountLinkService = new AccountLinkService(this, realCoreConfig, scheduler, apiClient);
      rewardPoller = new RewardPoller(this, realCoreConfig, scheduler, apiClient, dispatcher);
      servicesLoaded = true;

      if (lobbyManager != null) {
        lobbyManager.reload(getConfig());
      }

      if (!realCoreConfig.hmacSecretConfigured()) {
        getLogger().warning("RealCore hmacSecret is not configured. Website calls will fail until config.yml is updated.");
        if (logSummary) {
          logStartupSummary("reloaded", registeredCommandLabels());
        }
        return true;
      }

      rewardPoller.start();
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

  public RealCoreScheduler scheduler() {
    return scheduler;
  }

  public LobbyManager lobbyManager() {
    return lobbyManager;
  }

  private List<String> registerCommands(RealFictionCommand commandExecutor) {
    List<String> labels = List.of("realfiction", "rf", "realcore");
    for (String label : labels) {
      PluginCommand command = Objects.requireNonNull(getCommand(label), label + " command missing");
      command.setExecutor(commandExecutor);
      command.setTabCompleter(commandExecutor);
    }
    return labels;
  }

  private List<String> registeredCommandLabels() {
    return List.of("realfiction", "rf", "realcore");
  }

  private void logStartupSummary(String action, List<String> commandLabels) {
    RealCoreConfig config = realCoreConfig;
    String version = getDescription().getVersion();
    String schedulerName = scheduler == null ? "not loaded" : scheduler.name();
    String serverId = config == null ? "not loaded" : config.serverId();
    String polling = rewardPollingActive() ? "ready" : "not ready";
    String websiteAuth = config != null && config.hmacSecretConfigured() ? "ready" : "not ready";
    String luckPerms = luckPermsAvailable() ? "ready" : "not ready";
    String commands = "/" + String.join(", /", commandLabels);

    getLogger().info("+--------------------------------------------------+");
    getLogger().info("| RealCore " + version + " " + action);
    getLogger().info("| Scheduler: " + schedulerName);
    getLogger().info("| Server ID: " + serverId);
    getLogger().info("| Reward polling: " + polling);
    getLogger().info("| Website auth: " + websiteAuth);
    getLogger().info("| LuckPerms: " + luckPerms);
    getLogger().info("| Commands: " + commands);
    getLogger().info("+--------------------------------------------------+");
  }

  private void stopServices(boolean closeScheduler) {
    servicesLoaded = false;
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
