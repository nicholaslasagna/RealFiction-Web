package com.realfiction.realcore;

import com.realfiction.realcore.api.PlatformApiClient;
import com.realfiction.realcore.command.RealFictionCommand;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.linking.AccountLinkService;
import com.realfiction.realcore.luckperms.LuckPermsService;
import com.realfiction.realcore.rewards.RewardDispatcher;
import com.realfiction.realcore.rewards.RewardPoller;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.SchedulerFactory;
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
  private boolean servicesLoaded;

  @Override
  public void onEnable() {
    saveDefaultConfig();
    if (!reloadRealCore()) {
      getLogger().severe("RealCore could not start safely. Disabling plugin.");
      getServer().getPluginManager().disablePlugin(this);
      return;
    }

    PluginCommand command = Objects.requireNonNull(getCommand("realfiction"), "realfiction command missing");
    RealFictionCommand commandExecutor = new RealFictionCommand(this);
    command.setExecutor(commandExecutor);
    command.setTabCompleter(commandExecutor);

    getLogger().info("RealCore enabled for serverId=" + realCoreConfig.serverId());
  }

  @Override
  public void onDisable() {
    stopServices(true);
  }

  public boolean reloadRealCore() {
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

      if (!realCoreConfig.hmacSecretConfigured()) {
        getLogger().warning("RealCore hmacSecret is not configured. Website calls will fail until config.yml is updated.");
        return true;
      }

      rewardPoller.start();
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
