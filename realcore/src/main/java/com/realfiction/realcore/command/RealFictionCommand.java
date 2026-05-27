package com.realfiction.realcore.command;

import com.realfiction.realcore.RealCorePlugin;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.lobby.LobbyManager;
import com.realfiction.realcore.playtime.PlaytimeTracker;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.config.StatsConfig;
import com.realfiction.realcore.config.GameplayEconomySyncConfig;
import com.realfiction.realcore.economy.BufferedEconomyTransactionWriter;
import com.realfiction.realcore.economy.EconomyBalanceSnapshot;
import com.realfiction.realcore.economy.EconomyService;
import com.realfiction.realcore.economy.GameplayEconomyProducer;
import com.realfiction.realcore.economy.GameplayEconomyProducerMetrics;
import com.realfiction.realcore.economy.GameplayEconomySyncService;
import com.realfiction.realcore.economy.GameplayEconomyTransactionBuffer;
import com.realfiction.realcore.economy.EconomyStagingTestTransaction;
import com.realfiction.realcore.economy.EconomyTransaction;
import com.realfiction.realcore.economy.VaultBalanceAuditService;
import com.realfiction.realcore.economy.VaultBalanceSyncService;
import com.realfiction.realcore.economy.VaultDeltaShadowService;
import com.realfiction.realcore.economy.VoteRewardLedgerShadowService;
import com.realfiction.realcore.economy.VoteRewardLedgerWriteService;
import com.realfiction.realcore.stats.BufferedNetworkStatWriter;
import com.realfiction.realcore.stats.EconomyMirrorService;
import com.realfiction.realcore.stats.NetworkStatService;
import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.OfflinePlayer;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Player;
import org.bukkit.plugin.RegisteredServiceProvider;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

public final class RealFictionCommand implements CommandExecutor, TabCompleter {
  private final RealCorePlugin plugin;

  public RealFictionCommand(RealCorePlugin plugin) {
    this.plugin = plugin;
  }

  @Override
  public boolean onCommand(@NotNull CommandSender sender, @NotNull Command command, @NotNull String label, String[] args) {
    if ("cosmetics".equalsIgnoreCase(command.getName())) {
      return handleCosmetics(sender);
    }

    String sub = args.length >= 1 ? args[0].toLowerCase(java.util.Locale.ROOT) : "";

    switch (sub) {
      case "reload":
        return handleReload(sender);
      case "status":
        return handleStatus(sender);
      case "stats":
        return handleStats(sender, args);
      case "economy":
        return handleEconomy(sender, args);
      case "rewards":
        return handleRewards(sender);
      case "link":
        return handleLink(sender, args);
      case "menu":
        return handleOpenMenu(sender, "game-menu");
      case "lobbies":
        return handleOpenMenu(sender, "lobby-selector");
      case "cosmetics":
        return handleCosmetics(sender);
      case "spawn":
        return handleSpawn(sender);
      case "setspawn":
        return handleSetSpawn(sender);
      default:
        return handleHelp(sender, label);
    }
  }

  private boolean handleReload(CommandSender sender) {
    if (!sender.hasPermission("realcore.admin")) {
      send(sender, ChatColor.RED + "You do not have permission to do that.");
      return true;
    }
    if (plugin.reloadRealCore()) {
      send(sender, ChatColor.GREEN + "RealCore reloaded.");
    } else {
      send(sender, ChatColor.RED + "RealCore reload failed. Check the server console.");
    }
    return true;
  }

  private boolean handleStatus(CommandSender sender) {
    if (!sender.hasPermission("realcore.admin")) {
      send(sender, ChatColor.RED + "You do not have permission to do that.");
      return true;
    }
    sendStatus(sender);
    return true;
  }

  private boolean handleRewards(CommandSender sender) {
    if (!sender.hasPermission("realcore.admin")) {
      send(sender, ChatColor.RED + "You do not have permission to do that.");
      return true;
    }
    send(sender, ChatColor.GOLD + "RealCore Reward Reliability");
    send(sender, ChatColor.YELLOW + "Reward polling: " + statusText(plugin.rewardPollingActive()));
    send(sender, ChatColor.YELLOW + "Locally delivered (ledger): " + ChatColor.WHITE + plugin.deliveredLedgerSize());
    send(sender, ChatColor.YELLOW + "Pending acknowledgements: " + ChatColor.WHITE + plugin.pendingAckCount());
    List<String> pending = plugin.pendingAckSummaries(10);
    if (pending.isEmpty()) {
      send(sender, ChatColor.GRAY + "No rewards awaiting acknowledgement.");
    } else {
      for (String line : pending) {
        send(sender, ChatColor.GRAY + " - " + line);
      }
    }
    return true;
  }

  private boolean handleLink(CommandSender sender, String[] args) {
    if (args.length != 2) {
      send(sender, ChatColor.YELLOW + "Usage: /realfiction link <code>");
      return true;
    }
    if (!(sender instanceof Player player)) {
      send(sender, "Only players can link a Minecraft account.");
      return true;
    }
    if (!plugin.servicesLoaded() || plugin.accountLinkService() == null) {
      send(player, ChatColor.RED + "RealFiction linking is not ready yet. Please tell staff.");
      return true;
    }
    send(player, ChatColor.YELLOW + "Checking your RealFiction link code...");
    plugin.accountLinkService().confirm(player, args[1]);
    return true;
  }

  private boolean handleOpenMenu(CommandSender sender, String menuId) {
    if (!(sender instanceof Player player)) {
      send(sender, "Only players can open menus.");
      return true;
    }
    if (!canUsePlayerCommand(sender)) {
      send(sender, ChatColor.RED + "You do not have permission to do that.");
      return true;
    }
    LobbyManager lobby = plugin.lobbyManager();
    if (lobby == null) {
      send(player, ChatColor.RED + "Lobby features are not ready yet.");
      return true;
    }
    lobby.menuService().open(player, menuId);
    return true;
  }

  private boolean handleSpawn(CommandSender sender) {
    if (!(sender instanceof Player player)) {
      send(sender, "Only players can teleport to spawn.");
      return true;
    }
    if (!canUsePlayerCommand(sender)) {
      send(sender, ChatColor.RED + "You do not have permission to do that.");
      return true;
    }
    LobbyManager lobby = plugin.lobbyManager();
    if (lobby == null || lobby.spawnLocation() == null) {
      send(player, ChatColor.RED + "Lobby spawn is not set yet.");
      return true;
    }
    lobby.teleportToSpawn(player);
    send(player, ChatColor.GREEN + "Teleporting to spawn...");
    return true;
  }

  private boolean handleSetSpawn(CommandSender sender) {
    if (!sender.hasPermission("realcore.admin")) {
      send(sender, ChatColor.RED + "You do not have permission to do that.");
      return true;
    }
    if (!(sender instanceof Player player)) {
      send(sender, "Only players can set the lobby spawn.");
      return true;
    }
    LobbyManager lobby = plugin.lobbyManager();
    if (lobby == null) {
      send(player, ChatColor.RED + "Lobby features are not ready yet.");
      return true;
    }
    if (lobby.setSpawn(player)) {
      send(player, ChatColor.GREEN + "Lobby spawn set to your current location.");
    } else {
      send(player, ChatColor.RED + "Could not set lobby spawn.");
    }
    return true;
  }

  private boolean handleCosmetics(CommandSender sender) {
    if (!(sender instanceof Player player)) {
      send(sender, "Only players can open cosmetics.");
      return true;
    }
    if (plugin.cosmeticsManager() == null) {
      send(player, ChatColor.RED + "Cosmetics are not ready yet.");
      return true;
    }
    plugin.cosmeticsManager().open(player);
    return true;
  }

  private boolean handleHelp(CommandSender sender, String label) {
    send(sender, ChatColor.GOLD + "RealFiction");
    send(sender, ChatColor.YELLOW + "Use " + ChatColor.WHITE + "/" + label + " link <code>" + ChatColor.YELLOW + " to link your account.");
    if (canUsePlayerCommand(sender)) {
      send(sender, ChatColor.YELLOW + "Use " + ChatColor.WHITE + "/" + label + " menu" + ChatColor.YELLOW + " for the game menu, "
          + ChatColor.WHITE + "/" + label + " lobbies" + ChatColor.YELLOW + ", or " + ChatColor.WHITE + "/" + label + " spawn" + ChatColor.YELLOW + ".");
    }
    if (sender instanceof Player) {
      send(sender, ChatColor.YELLOW + "Use " + ChatColor.WHITE + "/" + label + " cosmetics" + ChatColor.YELLOW + " to open cosmetics.");
    }
    if (sender.hasPermission("realcore.admin")) {
      send(sender, ChatColor.YELLOW + "Admin: " + ChatColor.WHITE + "/" + label
          + " status|stats|stats flush|economy|economy audit|economy balance|economy shadow|economy syncfromdb|economy flush|economy test|rewards|reload|setspawn");
    }
    return true;
  }

  private boolean canUsePlayerCommand(CommandSender sender) {
    if (sender.hasPermission("realcore.admin")) {
      return true;
    }
    LobbyManager lobby = plugin.lobbyManager();
    return lobby != null && lobby.config().playerCommands();
  }

  private void sendStatus(CommandSender sender) {
    RealCoreConfig config = plugin.realCoreConfig();
    send(sender, ChatColor.GOLD + "RealCore Status");
    send(sender, ChatColor.YELLOW + "Plugin: " + statusText(plugin.isEnabled() && plugin.servicesLoaded()));

    if (config == null) {
      send(sender, ChatColor.RED + "Config is not loaded. Check the server console.");
      return;
    }

    RealCoreScheduler scheduler = plugin.scheduler();
    LobbyManager lobby = plugin.lobbyManager();
    send(sender, ChatColor.YELLOW + "Server ID: " + ChatColor.WHITE + config.serverId());
    send(sender, ChatColor.YELLOW + "Base URL: " + ChatColor.WHITE + config.baseUrl());
    send(sender, ChatColor.YELLOW + "Poll interval: " + ChatColor.WHITE + config.pollInterval().toSeconds() + "s");
    send(sender, ChatColor.YELLOW + "Scheduler: " + ChatColor.WHITE + (scheduler == null ? "not loaded" : scheduler.name()));
    send(sender, ChatColor.YELLOW + "Reward polling: " + statusText(plugin.rewardPollingActive()));
    send(sender, ChatColor.YELLOW + "Pending acks: " + ChatColor.WHITE + plugin.pendingAckCount()
        + ChatColor.GRAY + " (delivered ledger: " + plugin.deliveredLedgerSize() + ")");
    send(sender, ChatColor.YELLOW + "LuckPerms: " + statusText(plugin.luckPermsAvailable()));
    send(sender, ChatColor.YELLOW + "Website auth: " + statusText(config.hmacSecretConfigured()));
    if (lobby != null) {
      send(sender, ChatColor.YELLOW + "Lobby module: " + statusText(lobby.config().enabled()));
      send(sender, ChatColor.YELLOW + "Lobby worlds: " + ChatColor.WHITE + String.join(", ", lobby.config().worlds()));
      String menus = lobby.menuRegistry().keys().isEmpty()
          ? "none"
          : String.join(", ", lobby.menuRegistry().keys());
      send(sender, ChatColor.YELLOW + "Menus: " + ChatColor.WHITE + menus
          + ChatColor.GRAY + " (" + lobby.menuRegistry().count() + ")");
    }
    send(sender, ChatColor.YELLOW + "Cosmetics: " + statusText(plugin.cosmeticsManager() != null));
    appendPlaytimeStatus(sender, config);
    appendNetworkStatsStatus(sender, config);
    appendEconomyStatus(sender);
  }

  private void appendPlaytimeStatus(CommandSender sender, RealCoreConfig config) {
    if (!config.modules().playtime()) {
      send(sender, ChatColor.YELLOW + "Playtime: " + ChatColor.GRAY + "disabled (module off)");
      return;
    }
    PlaytimeTracker tracker = plugin.playtimeTracker();
    if (tracker == null) {
      send(sender, ChatColor.YELLOW + "Playtime: " + ChatColor.RED + "not ready");
      return;
    }
    send(sender, ChatColor.YELLOW + "Playtime: " + ChatColor.GREEN + "ready"
        + ChatColor.GRAY + " (" + tracker.activeSessionCount() + " active, "
        + tracker.pendingEventCount() + " pending)");
  }

  private void appendNetworkStatsStatus(CommandSender sender, RealCoreConfig config) {
    if (!config.modules().stats()) {
      send(sender, ChatColor.YELLOW + "Stat cache: " + ChatColor.GRAY + "disabled (module off)");
      return;
    }
    NetworkStatService stats = plugin.networkStatService();
    if (stats == null) {
      send(sender, ChatColor.YELLOW + "Stat cache: " + ChatColor.RED + "not ready");
    } else {
      long ago = stats.lastRefreshAgoSeconds();
      send(sender, ChatColor.YELLOW + "Stat cache: " + ChatColor.GREEN + stats.cachedKeyCount() + " keys"
          + ChatColor.GRAY + ", top " + stats.configuredTopN()
          + ", every " + stats.refreshIntervalSeconds() + "s");
      send(sender, ChatColor.YELLOW + "Stat refresh: " + ChatColor.WHITE + stats.refreshSuccessCount()
          + " ok / " + stats.refreshFailureCount() + " fail"
          + (ago >= 0 ? ChatColor.GRAY + ", last " + ago + "s ago" : ChatColor.GRAY + ", never refreshed"));
      String failure = stats.lastFailureMessage();
      if (failure != null && !failure.isBlank()) {
        send(sender, ChatColor.YELLOW + "Last stat error: " + ChatColor.RED + failure);
      }
      send(sender, ChatColor.YELLOW + "Stat keys: " + ChatColor.WHITE + String.join(", ", stats.configuredStatKeys()));
    }
    appendNetworkStatWriterStatus(sender);
  }

  private void appendNetworkStatWriterStatus(CommandSender sender) {
    BufferedNetworkStatWriter writer = plugin.bufferedNetworkStatWriter();
    if (writer == null) {
      send(sender, ChatColor.YELLOW + "Stat writer: " + ChatColor.RED + "not ready");
      return;
    }
    long ago = writer.lastFlushAgoSeconds();
    send(sender, ChatColor.YELLOW + "Stat writer: " + ChatColor.GREEN + writer.queuedEventCount() + " queued"
        + ChatColor.GRAY + " (working " + writer.workingEventCountSnapshot()
        + ", retry batches " + writer.pendingBatchCount() + ")"
        + ", every " + writer.flushIntervalSeconds() + "s, buffer " + writer.bufferSize());
    send(sender, ChatColor.YELLOW + "Stat flush: " + ChatColor.WHITE + writer.flushSuccessCount()
        + " ok / " + writer.flushFailureCount() + " fail"
        + ChatColor.GRAY + ", " + writer.duplicateBatchCount() + " duplicate, dropped "
        + writer.droppedBatchCount() + " batches / " + writer.droppedEventCount() + " events"
        + (ago >= 0 ? ", last " + ago + "s ago" : ", never flushed"));
    String failure = writer.lastFailureMessage();
    if (failure != null && !failure.isBlank()) {
      send(sender, ChatColor.YELLOW + "Last writer error: " + ChatColor.RED + failure);
    }
    appendStatProducerStatus(sender);
  }

  private void appendStatProducerStatus(CommandSender sender) {
    StatsConfig statsConfig = StatsConfig.from(plugin.getConfig().getConfigurationSection("stats"));
    StatsConfig.ProducerConfig producers = statsConfig.producers();
    send(sender, ChatColor.YELLOW + "Producers: "
        + ChatColor.GRAY + "kills/deaths=" + statusToggle(producers.killsDeaths())
        + ChatColor.GRAY + ", blocks_broken=" + statusToggle(producers.blocksBroken())
        + ChatColor.GRAY + ", votes=" + statusToggle(producers.votes())
        + ChatColor.GRAY + ", economy_mirror=" + statusToggle(producers.economyMirror()));
    if (producers.economyMirror()) {
      EconomyMirrorService mirror = plugin.economyMirrorService();
      if (mirror == null) {
        send(sender, ChatColor.YELLOW + "Economy mirror: " + ChatColor.RED + "not ready");
      } else {
        long ago = mirror.lastMirrorAgoSeconds();
        String availability = mirror.economyAvailable() ? ChatColor.GREEN + "vault bound" : ChatColor.GRAY + "vault dormant";
        send(sender, ChatColor.YELLOW + "Economy mirror: " + availability
            + ChatColor.GRAY + ", every " + mirror.intervalSeconds() + "s"
            + ", " + mirror.mirroredPlayerCount() + " mirrored / " + mirror.failureCount() + " failures"
            + (ago >= 0 ? ", last " + ago + "s ago" : ", never run"));
      }
    }
  }

  private String statusToggle(boolean on) {
    return on ? ChatColor.GREEN + "on" + ChatColor.GRAY : ChatColor.RED + "off" + ChatColor.GRAY;
  }

  private boolean handleStats(CommandSender sender, String[] args) {
    if (!sender.hasPermission("realcore.admin")) {
      send(sender, ChatColor.RED + "You do not have permission to do that.");
      return true;
    }
    if (args.length >= 2 && "flush".equalsIgnoreCase(args[1])) {
      return handleStatsFlush(sender);
    }
    RealCoreConfig config = plugin.realCoreConfig();
    if (config == null) {
      send(sender, ChatColor.RED + "Config is not loaded.");
      return true;
    }
    send(sender, ChatColor.GOLD + "RealCore Network Stats");
    appendPlaytimeStatus(sender, config);
    appendNetworkStatsStatus(sender, config);
    return true;
  }

  private boolean handleEconomy(CommandSender sender, String[] args) {
    if (!sender.hasPermission("realcore.admin")) {
      send(sender, ChatColor.RED + "You do not have permission to do that.");
      return true;
    }
    if (args.length >= 2 && "flush".equalsIgnoreCase(args[1])) {
      EconomyService economy = plugin.economyService();
      if (economy == null || !economy.writerRunning()) {
        send(sender, ChatColor.RED + "Global economy writer is not running.");
        return true;
      }
      int queuedBefore = economy.writer().queuedTransactionCount();
      economy.requestFlush();
      send(sender, ChatColor.GREEN + "Global economy flush requested" + ChatColor.GRAY
          + " (" + queuedBefore + " queued before; flush is async, see /rf economy for the result).");
      return true;
    }
    if (args.length >= 2 && "test".equalsIgnoreCase(args[1])) {
      return handleEconomyTest(sender, args);
    }
    if (args.length >= 2 && "audit".equalsIgnoreCase(args[1])) {
      return handleEconomyAudit(sender, args);
    }
    if (args.length >= 2 && "syncfromdb".equalsIgnoreCase(args[1])) {
      return handleEconomySyncFromDb(sender, args);
    }
    if (args.length >= 2 && "sync-vault".equalsIgnoreCase(args[1])) {
      return handleEconomyVaultSync(sender, args);
    }
    if (args.length >= 2 && "balance".equalsIgnoreCase(args[1])) {
      return handleEconomyBalance(sender, args);
    }
    if (args.length >= 2 && "shadow".equalsIgnoreCase(args[1])) {
      send(sender, ChatColor.GOLD + "RealCore Vault Delta Shadow");
      appendVaultDeltaShadowStatus(sender, true);
      return true;
    }
    if (args.length >= 2 && "gameplay".equalsIgnoreCase(args[1])) {
      send(sender, ChatColor.GOLD + "RealCore Gameplay Economy Sync");
      if (args.length >= 3 && "producers".equalsIgnoreCase(args[2])) {
        appendGameplayProducerStatus(sender);
      } else {
        appendGameplayEconomyStatus(sender, true);
      }
      return true;
    }

    send(sender, ChatColor.GOLD + "RealCore Global Economy");
    appendEconomyStatus(sender);
    send(sender, ChatColor.GRAY + "No Vault provider is registered by RealCore.");
    return true;
  }

  private boolean handleEconomyAudit(CommandSender sender, String[] args) {
    VaultBalanceAuditService.Mode mode;
    int limit = VaultBalanceAuditService.DEFAULT_ALL_LIMIT;
    try {
      mode = args.length >= 3 ? VaultBalanceAuditService.Mode.parse(args[2]) : VaultBalanceAuditService.Mode.ONLINE;
      if (args.length >= 4) {
        limit = Integer.parseInt(args[3]);
      }
    } catch (IllegalArgumentException error) {
      send(sender, ChatColor.YELLOW + "Usage: /rf economy audit [online|all] [limit]");
      send(sender, ChatColor.GRAY + "This is read-only and exports local Vault balances for staff review.");
      return true;
    }

    VaultBalanceAuditService service = new VaultBalanceAuditService(plugin, plugin.realCoreConfig());
    send(sender, ChatColor.YELLOW + "Starting local Vault balance audit..."
        + ChatColor.GRAY + " This is read-only and exports a CSV.");
    RealCoreScheduler scheduler = plugin.scheduler();
    VaultBalanceAuditService.Mode auditMode = mode;
    int auditLimit = limit;
    Runnable auditTask = () -> sendEconomyAuditReport(sender, service.audit(auditMode, auditLimit));
    if (scheduler != null) {
      scheduler.runAsync(auditTask);
    } else {
      auditTask.run();
    }
    return true;
  }

  private void sendEconomyAuditReport(CommandSender sender, VaultBalanceAuditService.AuditReport report) {
    if (!report.providerAvailable()) {
      send(sender, ChatColor.RED + report.error());
      send(sender, ChatColor.GRAY + "No balances were read or exported.");
      return;
    }

    send(sender, ChatColor.GOLD + "Local Vault Balance Audit");
    send(sender, ChatColor.YELLOW + "Mode: " + ChatColor.WHITE + report.mode().name().toLowerCase(java.util.Locale.ROOT)
        + ChatColor.GRAY + " (read-only)");
    RealCoreConfig config = plugin.realCoreConfig();
    if (config != null) {
      send(sender, ChatColor.YELLOW + "Server: " + ChatColor.WHITE + config.serverId()
          + ChatColor.GRAY + " (" + config.serverGroup() + ")");
    }
    send(sender, ChatColor.YELLOW + "Provider: " + ChatColor.WHITE + report.providerName());
    send(sender, ChatColor.YELLOW + "Rows: " + ChatColor.WHITE + report.entries().size()
        + ChatColor.GRAY + " exported, " + report.scanned() + " scanned, " + report.failureCount() + " failed");
    if (report.exportPath() != null) {
      send(sender, ChatColor.YELLOW + "CSV: " + ChatColor.WHITE + report.exportPath());
    }
    if (report.error() != null && !report.error().isBlank()) {
      send(sender, ChatColor.YELLOW + "Export warning: " + ChatColor.RED + report.error());
    }
    if (report.entries().isEmpty()) {
      send(sender, ChatColor.GRAY + "No local balances found for this audit mode.");
      return;
    }
    int shown = Math.min(8, report.entries().size());
    for (int i = 0; i < shown; i++) {
      VaultBalanceAuditService.AuditEntry entry = report.entries().get(i);
      send(sender, ChatColor.GRAY + " - " + entry.username() + " "
          + ChatColor.DARK_GRAY + "(" + entry.minecraftUuid() + ") "
          + ChatColor.WHITE + "$" + entry.localVaultBalance());
    }
    if (report.entries().size() > shown) {
      send(sender, ChatColor.GRAY + "And " + (report.entries().size() - shown) + " more in the CSV.");
    }
    send(sender, ChatColor.GRAY + "Audit only: no Vault, EssentialsX, website, or global economy writes were made.");
  }

  private boolean handleEconomyBalance(CommandSender sender, String[] args) {
    if (args.length != 3) {
      send(sender, ChatColor.YELLOW + "Usage: /rf economy balance <online-player|uuid>");
      send(sender, ChatColor.GRAY + "Read-only: shows cached DB economy balance and local Vault delta when available.");
      return true;
    }

    EconomyService economy = plugin.economyService();
    if (economy == null) {
      send(sender, ChatColor.RED + "Global economy is not loaded.");
      return true;
    }
    String guard = economy.dbBalanceReadGuardReason();
    if (!guard.isBlank()) {
      send(sender, ChatColor.RED + "DB balance reads are disabled: " + guard);
      return true;
    }

    Player online = Bukkit.getPlayerExact(args[2]);
    UUID uuid;
    String displayName;
    if (online != null) {
      uuid = online.getUniqueId();
      displayName = online.getName();
    } else {
      try {
        uuid = UUID.fromString(args[2]);
        displayName = args[2];
      } catch (IllegalArgumentException error) {
        send(sender, ChatColor.RED + "Use an online player name or a valid player UUID.");
        return true;
      }
    }

    EconomyBalanceSnapshot cached = economy.cachedBalance(uuid);
    if (cached != null) {
      send(sender, ChatColor.YELLOW + "Cached DB balance for " + displayName + ": "
          + ChatColor.WHITE + cached.formattedDollars()
          + ChatColor.GRAY + " (" + cached.balanceMinor() + " minor, age " + cacheAgeSeconds(cached) + "s)");
    }

    send(sender, ChatColor.YELLOW + "Loading DB balance for " + displayName + "...");
    economy.fetchBalanceReadOnly(uuid).thenCompose(snapshot ->
        readVaultBalance(uuid, snapshot.scale()).thenApply(vault -> new BalanceView(snapshot, vault))
    ).whenComplete((view, error) -> {
      if (error != null) {
        send(sender, ChatColor.RED + "DB balance read failed: " + rootMessage(error));
        return;
      }
      send(sender, ChatColor.GREEN + "DB balance: " + ChatColor.WHITE + view.snapshot().formattedDollars()
          + ChatColor.GRAY + " (" + view.snapshot().balanceMinor() + " minor)");
      if (view.vault().available()) {
        long delta = view.vault().balanceMinor() - view.snapshot().balanceMinor();
        send(sender, ChatColor.YELLOW + "Vault balance: " + ChatColor.WHITE + view.vault().formatted()
            + ChatColor.GRAY + " (deltaMinor=" + delta + ", provider=" + view.vault().providerName() + ")");
      } else {
        send(sender, ChatColor.GRAY + "Vault balance: unavailable (" + view.vault().reason() + ")");
      }
      send(sender, ChatColor.GRAY + "Read-only: no DB, Vault, reward, or ledger writes were made.");
    });
    return true;
  }

  private boolean handleEconomyVaultSync(CommandSender sender, String[] args) {
    send(sender, ChatColor.YELLOW + "Use /rf economy syncfromdb <player> --dry-run or --apply.");
    send(sender, ChatColor.GRAY + "The old sync-vault command is disabled so DB-to-Vault alignment uses the stricter Phase 4 gates.");
    return true;
  }

  private boolean handleEconomySyncFromDb(CommandSender sender, String[] args) {
    EconomyService economy = plugin.economyService();
    RealCoreConfig config = plugin.realCoreConfig();
    if (economy == null || config == null) {
      send(sender, ChatColor.RED + "Global economy is not loaded.");
      return true;
    }
    String guard = VaultBalanceSyncService.guardReason(config, economy);
    if (!guard.isBlank()) {
      send(sender, ChatColor.RED + "DB-to-Vault sync is disabled: " + guard);
      return true;
    }

    SyncMode mode;
    try {
      mode = parseSyncMode(args, config.economy().syncVaultFromDbDryRunDefault());
    } catch (IllegalArgumentException error) {
      sendSyncFromDbUsage(sender, error.getMessage());
      return true;
    }

    List<VaultBalanceSyncService.Target> targets = resolveSyncFromDbTargets(sender, args, config);
    if (targets.isEmpty()) {
      return true;
    }

    send(sender, ChatColor.YELLOW + "Starting DB-to-Vault alignment "
        + (mode.dryRun() ? ChatColor.GRAY + "(dry-run)" : ChatColor.RED + "(apply)")
        + ChatColor.GRAY + " for " + targets.size() + " requested player(s).");
    VaultBalanceSyncService service = new VaultBalanceSyncService(plugin, config, economy);
    service.syncTargets(targets, mode.dryRun(), sender.getName()).whenComplete((report, error) -> {
      if (error != null) {
        send(sender, ChatColor.RED + "DB-to-Vault sync failed: " + rootMessage(error));
        return;
      }
      sendSyncFromDbReport(sender, report);
    });
    return true;
  }

  private void sendSyncFromDbUsage(CommandSender sender, String reason) {
    if (reason != null && !reason.isBlank()) {
      send(sender, ChatColor.RED + reason);
    }
    send(sender, ChatColor.YELLOW + "Usage: /rf economy syncfromdb <player|uuid> [--dry-run|--apply]");
    send(sender, ChatColor.YELLOW + "Usage: /rf economy syncfromdb --online [--dry-run|--apply]");
    send(sender, ChatColor.GRAY + "Manual only: reads DB balance, then optionally aligns local Vault. No DB writes.");
  }

  private SyncMode parseSyncMode(String[] args, boolean dryRunDefault) {
    boolean dryRun = false;
    boolean apply = false;
    for (String arg : args) {
      if ("--dry-run".equalsIgnoreCase(arg)) {
        dryRun = true;
      } else if ("--apply".equalsIgnoreCase(arg)) {
        apply = true;
      }
    }
    if (dryRun && apply) {
      throw new IllegalArgumentException("Choose either --dry-run or --apply, not both.");
    }
    return new SyncMode(!apply && (dryRun || dryRunDefault));
  }

  private List<VaultBalanceSyncService.Target> resolveSyncFromDbTargets(
      CommandSender sender,
      String[] args,
      RealCoreConfig config
  ) {
    if (args.length < 3) {
      sendSyncFromDbUsage(sender, "");
      return List.of();
    }
    if ("--online".equalsIgnoreCase(args[2])) {
      List<VaultBalanceSyncService.Target> targets = Bukkit.getOnlinePlayers().stream()
          .map(player -> new VaultBalanceSyncService.Target(player.getUniqueId(), player.getName(), true))
          .toList();
      if (targets.isEmpty()) {
        send(sender, ChatColor.YELLOW + "No online players are available to scan.");
      } else if (targets.size() > config.economy().syncVaultFromDbMaxPlayersPerRun()) {
        send(sender, ChatColor.YELLOW + "Online scan will be limited to "
            + config.economy().syncVaultFromDbMaxPlayersPerRun()
            + ChatColor.GRAY + " player(s) by economy.syncVaultFromDbMaxPlayersPerRun.");
      }
      return targets;
    }

    Player online = Bukkit.getPlayerExact(args[2]);
    if (online != null) {
      return List.of(new VaultBalanceSyncService.Target(online.getUniqueId(), online.getName(), true));
    }
    if (config.economy().syncVaultFromDbRequireOnline()) {
      send(sender, ChatColor.RED + "Player must be online because economy.syncVaultFromDbRequireOnline=true.");
      return List.of();
    }
    try {
      UUID uuid = UUID.fromString(args[2]);
      return List.of(new VaultBalanceSyncService.Target(uuid, args[2], false));
    } catch (IllegalArgumentException error) {
      send(sender, ChatColor.RED + "Use an online player name or a valid player UUID.");
      return List.of();
    }
  }

  private void sendSyncFromDbReport(CommandSender sender, VaultBalanceSyncService.SyncReport report) {
    send(sender, ChatColor.GOLD + "DB-to-Vault alignment summary");
    send(sender, ChatColor.YELLOW + "Mode: "
        + (report.dryRun() ? ChatColor.GRAY + "dry-run" : ChatColor.RED + "apply")
        + ChatColor.GRAY + " (DB remains canonical; no DB writes were made)");
    send(sender, ChatColor.YELLOW + "Scanned: " + ChatColor.WHITE + report.scanned()
        + ChatColor.GRAY + ", would update " + report.wouldUpdate()
        + ", applied " + report.applied()
        + ", skipped " + report.skipped()
        + ", failed " + report.failed());
    send(sender, ChatColor.YELLOW + "Deltas: " + ChatColor.WHITE
        + "largest=" + report.largestDeltaMinor()
        + ChatColor.GRAY + ", positive=" + report.totalPositiveDeltaMinor()
        + ", negative=" + report.totalNegativeDeltaMinor());
    if (report.notScannedDueToLimit() > 0) {
      send(sender, ChatColor.YELLOW + "Not scanned due to run limit: " + ChatColor.WHITE + report.notScannedDueToLimit());
    }
    int shown = Math.min(8, report.results().size());
    for (int i = 0; i < shown; i++) {
      VaultBalanceSyncService.SyncResult result = report.results().get(i);
      send(sender, ChatColor.GRAY + " - " + result.username()
          + " " + result.action().name().toLowerCase(java.util.Locale.ROOT)
          + " db=" + result.targetMinor()
          + " vault=" + result.beforeMinor()
          + " delta=" + result.deltaMinor()
          + (result.reason().isBlank() ? "" : " reason=" + result.reason()));
    }
    if (report.results().size() > shown) {
      send(sender, ChatColor.GRAY + "And " + (report.results().size() - shown)
          + " more result(s) in the local audit log.");
    }
    send(sender, ChatColor.GRAY + "Audit log written locally under plugins/RealCore/audits.");
  }

  private boolean handleEconomyTest(CommandSender sender, String[] args) {
    if (args.length != 6) {
      send(sender, ChatColor.YELLOW + "Usage: /rf economy test <uuid> <username> <amountMinor> <testId>");
      send(sender, ChatColor.GRAY + "Example: /rf economy test 00000000-0000-0000-0000-000000000123 Alex 100 smoke-test-1");
      return true;
    }

    EconomyService economy = plugin.economyService();
    RealCoreConfig config = plugin.realCoreConfig();
    if (economy == null || config == null) {
      send(sender, ChatColor.RED + "Global economy is not loaded.");
      return true;
    }
    if (!economy.configuredEnabled()) {
      send(sender, ChatColor.RED + "Global economy is disabled by economy.enabled=false.");
      return true;
    }
    if (!config.modules().economy()) {
      send(sender, ChatColor.RED + "Global economy is disabled by modules.economy=false.");
      return true;
    }
    if (!economy.mutationsAllowed()) {
      send(sender, ChatColor.RED + "This server is read-only for the global economy.");
      return true;
    }
    if (!economy.writerRunning()) {
      send(sender, ChatColor.RED + "Global economy writer is not running: " + economy.disabledReason());
      return true;
    }

    UUID uuid;
    long amountMinor;
    try {
      uuid = UUID.fromString(args[2]);
      amountMinor = Long.parseLong(args[4]);
    } catch (IllegalArgumentException error) {
      send(sender, ChatColor.RED + "Use a valid player UUID and whole-number minor amount.");
      return true;
    }

    try {
      EconomyTransaction transaction = EconomyStagingTestTransaction.create(config, uuid, args[3], amountMinor, args[5]);
      if (!economy.enqueue(transaction)) {
        send(sender, ChatColor.RED + "Could not queue the staging economy test. Check /rf economy.");
        return true;
      }
      send(sender, ChatColor.GREEN + "Queued staging economy test for " + args[3] + "."
          + ChatColor.GRAY + " amountMinor=" + amountMinor
          + ", idempotency=" + transaction.idempotencyKey().substring(0, Math.min(24, transaction.idempotencyKey().length())) + "...");
      send(sender, ChatColor.GRAY + "It will send on the next writer flush, or use /rf economy flush.");
    } catch (IllegalArgumentException | IllegalStateException error) {
      send(sender, ChatColor.RED + error.getMessage());
    }
    return true;
  }

  private void appendEconomyStatus(CommandSender sender) {
    EconomyService economy = plugin.economyService();
    RealCoreConfig config = plugin.realCoreConfig();
    if (config == null) {
      send(sender, ChatColor.YELLOW + "Global economy: " + ChatColor.RED + "config not loaded");
      return;
    }
    if (economy == null) {
      send(sender, ChatColor.YELLOW + "Global economy: " + ChatColor.RED + "not loaded");
      return;
    }
    if (!economy.configuredEnabled()) {
      send(sender, ChatColor.YELLOW + "Global economy: " + ChatColor.GRAY + "disabled (economy.enabled=false)");
      send(sender, ChatColor.YELLOW + "Economy currency: " + ChatColor.WHITE + economy.currencyKey());
      appendDbBalanceReadStatus(sender, economy);
      appendVoteRewardLedgerShadowStatus(sender);
      appendVoteRewardLedgerWriteStatus(sender);
      appendVaultDeltaShadowStatus(sender, false);
      appendGameplayEconomyStatus(sender, false);
      return;
    }
    String state = economy.writerRunning() ? ChatColor.GREEN + "ready" : ChatColor.RED + "not ready";
    if (!economy.mutationsAllowed()) {
      state = ChatColor.GRAY + "read-only";
    }
    send(sender, ChatColor.YELLOW + "Global economy: " + state
        + ChatColor.GRAY + (economy.disabledReason().isBlank() ? "" : " (" + economy.disabledReason() + ")"));
    send(sender, ChatColor.YELLOW + "Economy currency: " + ChatColor.WHITE + economy.currencyKey()
        + ChatColor.GRAY + " ($1.00 = 100)");
    send(sender, ChatColor.YELLOW + "Economy flush: " + ChatColor.WHITE + economy.flushIntervalSeconds()
        + "s" + ChatColor.GRAY + ", max batch " + economy.maxBatchSize()
        + ", buffer " + economy.bufferSize());
    send(sender, ChatColor.YELLOW + "Staging test max: " + ChatColor.WHITE
        + economy.stagingTestMaxCreditMinor() + ChatColor.GRAY + " minor units");
    send(sender, ChatColor.YELLOW + "Vault sync after DB: "
        + (economy.syncVaultAfterDb() ? ChatColor.GREEN + "enabled" : ChatColor.GRAY + "disabled")
        + ChatColor.GRAY + ", max delta " + economy.syncVaultMaxDeltaMinor() + " minor units");
    send(sender, ChatColor.YELLOW + "Manual DB-to-Vault sync: "
        + (economy.syncVaultFromDbEnabled() ? ChatColor.GREEN + "enabled" : ChatColor.GRAY + "disabled")
        + ChatColor.GRAY + ", dry-run default " + economy.syncVaultFromDbDryRunDefault()
        + ", max players " + economy.syncVaultFromDbMaxPlayersPerRun()
        + ", max delta " + economy.syncVaultFromDbMaxDeltaMinor()
        + ", require online " + economy.syncVaultFromDbRequireOnline());
    send(sender, ChatColor.YELLOW + "Manual DB-to-Vault allowlist: " + ChatColor.WHITE
        + economy.syncVaultFromDbAllowlistSummary());
    appendDbBalanceReadStatus(sender, economy);
    appendVoteRewardLedgerShadowStatus(sender);
    appendVoteRewardLedgerWriteStatus(sender);
    appendVaultDeltaShadowStatus(sender, false);
    appendGameplayEconomyStatus(sender, false);
    sendEconomyWriterStatus(sender, economy.writer());
  }

  private void appendGameplayEconomyStatus(CommandSender sender, boolean detailed) {
    RealCoreConfig config = plugin.realCoreConfig();
    GameplayEconomyTransactionBuffer buffer = plugin.gameplayEconomyTransactionBuffer();
    if (config == null) {
      send(sender, ChatColor.YELLOW + "Gameplay sync: " + ChatColor.RED + "config not loaded");
      return;
    }
    GameplayEconomySyncConfig gameplay = config.economy().gameplaySync();
    if (buffer == null) {
      send(sender, ChatColor.YELLOW + "Gameplay sync: " + ChatColor.RED + "not loaded");
      return;
    }
    String enabled = gameplay.enabled() ? ChatColor.GREEN + "enabled" : ChatColor.GRAY + "disabled";
    String dryRun = gameplay.dryRun() ? ChatColor.YELLOW + "dry-run" : ChatColor.GREEN + "live enqueue";
    send(sender, ChatColor.YELLOW + "Gameplay sync: " + enabled
        + ChatColor.GRAY + ", " + dryRun
        + ChatColor.GRAY + ", allowlist " + String.join(", ", gameplay.backendAllowlist()));
    send(sender, ChatColor.YELLOW + "Gameplay categories: "
        + ChatColor.WHITE + categoryToggle("earn", gameplay.gameplayEarn())
        + ChatColor.GRAY + ", "
        + ChatColor.WHITE + categoryToggle("spend", gameplay.gameplaySpend())
        + ChatColor.GRAY + ", "
        + ChatColor.WHITE + categoryToggle("shop_sell", gameplay.shopSell())
        + ChatColor.GRAY + ", "
        + ChatColor.WHITE + categoryToggle("shop_buy", gameplay.shopBuy()));
    send(sender, ChatColor.YELLOW + "Gameplay caps: " + ChatColor.WHITE
        + "credit " + gameplay.maxCreditMinorPerTx()
        + ChatColor.GRAY + " / "
        + ChatColor.WHITE + "debit " + gameplay.maxDebitMinorPerTx()
        + ChatColor.GRAY + " minor, batch " + gameplay.maxBatchSize()
        + ChatColor.GRAY + ", buffer " + gameplay.bufferSize()
        + ChatColor.GRAY + ", flush " + gameplay.flushInterval().toSeconds() + "s");
    send(sender, ChatColor.YELLOW + "Gameplay buffer: " + ChatColor.WHITE + buffer.acceptedCount()
        + " accepted" + ChatColor.GRAY + ", " + buffer.dryRunCount() + " dry-run, "
        + buffer.rejectedCount() + " rejected"
        + ChatColor.GRAY + ", writer queued " + buffer.writerQueuedCount());
    if (!buffer.lastAcceptedMessage().isBlank()) {
      send(sender, ChatColor.YELLOW + "Last accepted: " + ChatColor.GRAY + buffer.lastAcceptedMessage());
    }
    if (!buffer.lastRejectedMessage().isBlank()) {
      send(sender, ChatColor.YELLOW + "Last rejected: " + ChatColor.RED + buffer.lastRejectedMessage());
    }
    appendGameplayProducerStatus(sender);
    if (detailed) {
      EconomyService economy = plugin.economyService();
      if (economy == null) {
        send(sender, ChatColor.YELLOW + "Global writer: " + ChatColor.RED + "not loaded");
      } else if (!economy.writerRunning()) {
        send(sender, ChatColor.YELLOW + "Global writer: " + ChatColor.RED + "not running"
            + ChatColor.GRAY + (economy.disabledReason().isBlank() ? "" : " (" + economy.disabledReason() + ")"));
      } else {
        sendEconomyWriterStatus(sender, economy.writer());
      }
    }
  }

  private void appendGameplayProducerStatus(CommandSender sender) {
    GameplayEconomySyncService sync = plugin.gameplayEconomySyncService();
    RealCoreConfig config = plugin.realCoreConfig();
    if (config == null) {
      send(sender, ChatColor.YELLOW + "Gameplay producers: " + ChatColor.RED + "config not loaded");
      return;
    }
    if (sync == null) {
      send(sender, ChatColor.YELLOW + "Gameplay producers: " + ChatColor.RED + "not loaded");
      return;
    }
    var producerConfig = config.economy().gameplaySync().producers().economyShopGuiSell();
    send(sender, ChatColor.YELLOW + "Producer economyShopGuiSell: "
        + (producerConfig.enabled() ? ChatColor.GREEN + "enabled" : ChatColor.GRAY + "disabled")
        + ChatColor.GRAY + ", category " + producerConfig.category().ledgerCategory().apiValue()
        + ", producer dry-run " + statusToggle(producerConfig.dryRun())
        + ", maxEventsPerFlush " + producerConfig.maxEventsPerFlush());
    GameplayEconomyProducer producer = sync.producer(com.realfiction.realcore.economy.EconomyShopGuiSellProducer.ID);
    if (producer != null) {
      send(sender, ChatColor.YELLOW + "Hook: " + ChatColor.WHITE + producer.statusSummary()
          + ChatColor.GRAY + ", running=" + producer.running());
    }
    GameplayEconomyProducerMetrics metrics = sync.metrics();
    send(sender, ChatColor.YELLOW + "Producer metrics: " + ChatColor.WHITE + metrics.captured()
        + " captured" + ChatColor.GRAY + ", " + metrics.dryRunCaptured() + " dry-run, "
        + metrics.queued() + " queued, dup " + metrics.duplicateRejected()
        + ", invalid " + metrics.invalidRejected() + ", over-cap " + metrics.overCapRejected()
        + ", disabled " + metrics.producerDisabledRejected());
    send(sender, ChatColor.YELLOW + "Dedup cache: " + ChatColor.WHITE + sync.dedupCacheSize() + " keys"
        + ChatColor.GRAY + " (TTL " + config.economy().gameplaySync().producers().dedupCacheTtl().toSeconds() + "s)");
    if (!metrics.lastEventSummary().isBlank()) {
      send(sender, ChatColor.YELLOW + "Last event: " + ChatColor.GRAY + metrics.lastEventSummary());
    }
    send(sender, ChatColor.GRAY + "Use /rf economy gameplay producers for producer-only status.");
  }

  private String categoryToggle(String label, boolean on) {
    return label + "=" + (on ? "on" : "off");
  }

  private void appendDbBalanceReadStatus(CommandSender sender, EconomyService economy) {
    String guard = economy.dbBalanceReadGuardReason();
    long ago = economy.lastBalanceReadAgoSeconds();
    send(sender, ChatColor.YELLOW + "DB balance reads: "
        + (guard.isBlank() ? ChatColor.GREEN + "enabled" : ChatColor.GRAY + "disabled")
        + ChatColor.GRAY + (guard.isBlank() ? "" : " (" + guard + ")"));
    send(sender, ChatColor.YELLOW + "DB read cache: " + ChatColor.WHITE + economy.cachedBalanceCount()
        + " cached" + ChatColor.GRAY + ", ttl " + economy.dbBalanceReadCacheSeconds()
        + "s, max players/batch " + economy.dbBalanceReadMaxPlayersPerBatch());
    send(sender, ChatColor.YELLOW + "DB read results: " + ChatColor.WHITE + economy.balanceReadSuccessCount()
        + " ok / " + economy.balanceReadFailureCount() + " failed"
        + ChatColor.GRAY + ", avg " + economy.averageBalanceReadLatencyMillis()
        + "ms, last latency " + economy.lastBalanceReadLatencyMillis() + "ms"
        + (ago >= 0 ? ", last " + ago + "s ago" : ", never read"));
    send(sender, ChatColor.YELLOW + "DB read allowlist: " + ChatColor.WHITE + economy.dbBalanceReadAllowlistSummary());
  }

  private void appendVaultDeltaShadowStatus(CommandSender sender, boolean detailed) {
    VaultDeltaShadowService shadow = plugin.vaultDeltaShadowService();
    RealCoreConfig config = plugin.realCoreConfig();
    if (config == null) {
      send(sender, ChatColor.YELLOW + "Vault delta shadow: " + ChatColor.RED + "config not loaded");
      return;
    }
    String guard = VaultDeltaShadowService.guardReason(config);
    if (shadow == null) {
      send(sender, ChatColor.YELLOW + "Vault delta shadow: " + ChatColor.GRAY + "disabled"
          + ChatColor.GRAY + (guard.isBlank() ? "" : " (" + guard + ")"));
      send(sender, ChatColor.YELLOW + "Shadow allowlist: " + ChatColor.WHITE
          + String.join(", ", config.economy().vaultDeltaShadowBackendAllowlist()));
      return;
    }
    long ago = shadow.lastRunAgoSeconds();
    send(sender, ChatColor.YELLOW + "Vault delta shadow: "
        + (shadow.running() ? ChatColor.GREEN + "running" : ChatColor.GRAY + "disabled")
        + ChatColor.GRAY + ", sampled " + shadow.sampledCount()
        + ", matched " + shadow.matchedCount()
        + ", deltas " + shadow.deltaCount()
        + ", severe " + shadow.severeDeltaCount()
        + ", skipped " + shadow.skippedCount()
        + ", failures " + shadow.failureCount()
        + (ago >= 0 ? ", last " + ago + "s ago" : ", never run"));
    send(sender, ChatColor.YELLOW + "Shadow health: " + ChatColor.WHITE + shadow.estimatedSyncHealth()
        + ChatColor.GRAY + ", avg abs delta " + shadow.averageAbsDeltaMinor()
        + ", largest abs " + shadow.largestAbsDeltaMinor());
    if (shadow.lastFailure() != null && !shadow.lastFailure().isBlank()) {
      send(sender, ChatColor.YELLOW + "Last shadow error: " + ChatColor.RED + shadow.lastFailure());
    }
    if (!detailed) {
      return;
    }
    send(sender, ChatColor.YELLOW + "Shadow allowlist: " + ChatColor.WHITE
        + String.join(", ", config.economy().vaultDeltaShadowBackendAllowlist()));
    send(sender, ChatColor.YELLOW + "Delta counts: " + ChatColor.WHITE + shadow.exactMatchCount()
        + " exact" + ChatColor.GRAY + ", " + shadow.positiveDeltaCount() + " positive, "
        + shadow.negativeDeltaCount() + " negative, " + shadow.ignoredDeltaCount() + " ignored, "
        + shadow.cappedDeltaCount() + " capped");
    send(sender, ChatColor.YELLOW + "Latency: " + ChatColor.WHITE + shadow.averageDbReadLatencyMillis()
        + "ms avg DB" + ChatColor.GRAY + " (last " + shadow.lastDbReadLatencyMillis() + "ms), "
        + shadow.averageVaultReadLatencyMillis() + "ms avg Vault"
        + " (last " + shadow.lastVaultReadLatencyMillis() + "ms)");
    send(sender, ChatColor.YELLOW + "Last run duration: " + ChatColor.WHITE
        + shadow.lastRunDurationMillis() + "ms" + ChatColor.GRAY
        + ", recent observations " + shadow.recentObservationCount());
    send(sender, ChatColor.YELLOW + "Repeated offender threshold: " + ChatColor.WHITE
        + config.economy().shadow().repeatedOffenderThreshold() + ChatColor.GRAY + " divergent samples");
    List<VaultDeltaShadowService.OffenderSummary> offenders = shadow.topOffenders(5);
    if (offenders.isEmpty()) {
      send(sender, ChatColor.GRAY + "Top offenders: none");
      return;
    }
    send(sender, ChatColor.YELLOW + "Top offenders:");
    for (VaultDeltaShadowService.OffenderSummary offender : offenders) {
      send(sender, ChatColor.GRAY + " - " + offender.username() + " "
          + ChatColor.DARK_GRAY + "(" + offender.uuid() + ") "
          + ChatColor.WHITE + offender.count() + " divergent samples");
    }
  }

  private void appendVoteRewardLedgerShadowStatus(CommandSender sender) {
    VoteRewardLedgerShadowService shadow = plugin.voteRewardLedgerShadowService();
    if (shadow == null) {
      send(sender, ChatColor.YELLOW + "Vote reward ledger shadow: " + ChatColor.RED + "not loaded");
      return;
    }
    send(sender, ChatColor.YELLOW + "Vote reward ledger shadow: "
        + (shadow.enabled() ? ChatColor.GREEN + "enabled" : ChatColor.GRAY + "disabled")
        + ChatColor.GRAY + ", dry-run " + statusToggle(shadow.configuredDryRun())
        + ", mappings " + shadow.mappingCount()
        + ", observed " + shadow.observedCount());
    if (shadow.configuredLedgerWrites()) {
      send(sender, ChatColor.GRAY + "Shadow observation is on; real writes use economy.voteRewardsLedgerWritesEnabled.");
    }
  }

  private void appendVoteRewardLedgerWriteStatus(CommandSender sender) {
    VoteRewardLedgerWriteService writer = plugin.voteRewardLedgerWriteService();
    if (writer == null) {
      send(sender, ChatColor.YELLOW + "Vote reward ledger writes: " + ChatColor.RED + "not loaded");
      return;
    }
    send(sender, ChatColor.YELLOW + "Vote reward ledger writes: "
        + (writer.writesEnabled() ? ChatColor.GREEN + "enabled" : ChatColor.GRAY + "disabled")
        + ChatColor.GRAY + ", fallback commands " + statusToggle(writer.fallbackCommandsEnabled())
        + ", mappings " + writer.mappingCount());
    send(sender, ChatColor.YELLOW + "Vote ledger results: " + ChatColor.WHITE + writer.successCount()
        + " success / " + writer.duplicateSuccessCount() + " duplicate"
        + ChatColor.GRAY + ", " + writer.failureCount() + " fail, " + writer.fallbackCount() + " fallback");
  }

  private void sendEconomyWriterStatus(CommandSender sender, BufferedEconomyTransactionWriter writer) {
    long ago = writer.lastFlushAgoSeconds();
    send(sender, ChatColor.YELLOW + "Economy writer: " + ChatColor.WHITE + writer.queuedTransactionCount()
        + " queued" + ChatColor.GRAY + " (working " + writer.workingTransactionCount()
        + ", pending " + writer.pendingTransactionCount()
        + ", retry batches " + writer.pendingBatchCount() + ")");
    send(sender, ChatColor.YELLOW + "Economy batches: " + ChatColor.WHITE + writer.sentBatchCount()
        + " sent / " + writer.failedBatchCount() + " failed"
        + ChatColor.GRAY + ", " + writer.appliedTransactionCount() + " applied tx, "
        + writer.duplicateBatchCount() + " duplicate batches, "
        + writer.duplicateTransactionCount() + " duplicate tx, dropped "
        + writer.droppedBatchCount() + " batches / " + writer.droppedTransactionCount() + " tx"
        + (ago >= 0 ? ", last " + ago + "s ago" : ", never flushed"));
    String failure = writer.lastFailureMessage();
    if (failure != null && !failure.isBlank()) {
      send(sender, ChatColor.YELLOW + "Last economy error: " + ChatColor.RED + failure);
    }
  }

  private boolean handleStatsFlush(CommandSender sender) {
    BufferedNetworkStatWriter writer = plugin.bufferedNetworkStatWriter();
    if (writer == null || !writer.running()) {
      send(sender, ChatColor.RED + "Stat writer is not running.");
      return true;
    }
    int queuedBefore = writer.queuedEventCount();
    writer.requestFlush();
    send(sender, ChatColor.GREEN + "Stat writer flush requested" + ChatColor.GRAY
        + " (" + queuedBefore + " queued before; flush is async, see /rf stats for the result).");
    return true;
  }

  private CompletableFuture<VaultReadResult> readVaultBalance(UUID uuid, int scale) {
    CompletableFuture<VaultReadResult> future = new CompletableFuture<>();
    Runnable task = () -> {
      try {
        future.complete(readVaultBalanceOnServerThread(uuid, scale));
      } catch (Throwable error) {
        future.complete(new VaultReadResult(false, 0, "", "", rootMessage(error)));
      }
    };
    RealCoreScheduler scheduler = plugin.scheduler();
    if (scheduler == null) {
      task.run();
    } else {
      scheduler.runGlobal(task);
    }
    return future;
  }

  private VaultReadResult readVaultBalanceOnServerThread(UUID uuid, int scale) throws Exception {
    Class<?> economyClass;
    try {
      economyClass = Class.forName("net.milkbowl.vault.economy.Economy");
    } catch (ClassNotFoundException missing) {
      return new VaultReadResult(false, 0, "", "", "Vault is not installed");
    }
    RegisteredServiceProvider<?> registration = Bukkit.getServicesManager().getRegistration(economyClass);
    if (registration == null || registration.getProvider() == null) {
      return new VaultReadResult(false, 0, "", "", "Vault Economy provider is not registered");
    }
    Object provider = registration.getProvider();
    Method getBalance = provider.getClass().getMethod("getBalance", OfflinePlayer.class);
    OfflinePlayer player = Bukkit.getOfflinePlayer(uuid);
    Object result = getBalance.invoke(provider, player);
    if (!(result instanceof Number number) || !Double.isFinite(number.doubleValue())) {
      return new VaultReadResult(false, 0, "", providerName(provider), "Vault provider returned a non-numeric balance");
    }
    long minor = toMinorUnits(number.doubleValue(), scale);
    return new VaultReadResult(true, minor, formatMinor(minor, scale), providerName(provider), "");
  }

  private String providerName(Object provider) {
    try {
      Method getName = provider.getClass().getMethod("getName");
      Object name = getName.invoke(provider);
      if (name instanceof String string && !string.isBlank()) {
        return string;
      }
    } catch (Throwable ignored) {
      // Provider class name is enough for staff-only read diagnostics.
    }
    return provider.getClass().getName();
  }

  private static long toMinorUnits(double vaultBalance, int scale) {
    return BigDecimal.valueOf(vaultBalance)
        .multiply(BigDecimal.valueOf(Math.max(1, scale)))
        .setScale(0, RoundingMode.HALF_UP)
        .longValue();
  }

  private static String formatMinor(long amountMinor, int scale) {
    int safeScale = Math.max(1, scale);
    long absolute = Math.abs(amountMinor);
    long whole = absolute / safeScale;
    long fractional = absolute % safeScale;
    return "$" + (amountMinor < 0 ? "-" : "") + whole + "." + String.format("%02d", fractional);
  }

  private static long cacheAgeSeconds(EconomyBalanceSnapshot snapshot) {
    return Math.max(0, (System.currentTimeMillis() - snapshot.cachedAt().toEpochMilli()) / 1000);
  }

  private String statusText(boolean ok) {
    return (ok ? ChatColor.GREEN + "ready" : ChatColor.RED + "not ready");
  }

  private String rootMessage(Throwable error) {
    Throwable current = error;
    while (current.getCause() != null) {
      current = current.getCause();
    }
    String message = current.getMessage();
    return message == null || message.isBlank() ? current.getClass().getSimpleName() : message;
  }

  private void send(CommandSender sender, String message) {
    RealCoreScheduler scheduler = plugin.scheduler();
    if (scheduler != null) {
      scheduler.send(sender, message);
      return;
    }
    if (sender instanceof Player) {
      return;
    }
    sender.sendMessage(message);
  }

  private record BalanceView(EconomyBalanceSnapshot snapshot, VaultReadResult vault) {}

  private record SyncMode(boolean dryRun) {}

  private record VaultReadResult(boolean available, long balanceMinor, String formatted, String providerName, String reason) {}

  @Override
  public @Nullable List<String> onTabComplete(@NotNull CommandSender sender, @NotNull Command command, @NotNull String label, String[] args) {
    if (args.length == 1) {
      List<String> options = new ArrayList<>();
      options.add("link");
      if (canUsePlayerCommand(sender)) {
        options.add("menu");
        options.add("lobbies");
        options.add("spawn");
      }
      if (sender instanceof Player) {
        options.add("cosmetics");
      }
      if (sender.hasPermission("realcore.admin")) {
        options.add("status");
        options.add("stats");
        options.add("economy");
        options.add("rewards");
        options.add("reload");
        options.add("setspawn");
      }
      return options;
    }
    if (args.length == 2 && "stats".equalsIgnoreCase(args[0]) && sender.hasPermission("realcore.admin")) {
      return List.of("flush");
    }
    if (args.length == 2 && "economy".equalsIgnoreCase(args[0]) && sender.hasPermission("realcore.admin")) {
      return List.of("audit", "balance", "flush", "shadow", "syncfromdb", "test");
    }
    if (args.length == 3 && "economy".equalsIgnoreCase(args[0])
        && "syncfromdb".equalsIgnoreCase(args[1])
        && sender.hasPermission("realcore.admin")) {
      return List.of("--online");
    }
    if (args.length >= 3 && "economy".equalsIgnoreCase(args[0])
        && "syncfromdb".equalsIgnoreCase(args[1])
        && sender.hasPermission("realcore.admin")) {
      return List.of("--dry-run", "--apply");
    }
    if (args.length == 3 && "economy".equalsIgnoreCase(args[0])
        && "audit".equalsIgnoreCase(args[1])
        && sender.hasPermission("realcore.admin")) {
      return List.of("online", "all");
    }
    return List.of();
  }
}
