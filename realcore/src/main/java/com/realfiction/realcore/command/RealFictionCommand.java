package com.realfiction.realcore.command;

import com.realfiction.realcore.RealCorePlugin;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.lobby.LobbyManager;
import com.realfiction.realcore.playtime.PlaytimeTracker;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.config.StatsConfig;
import com.realfiction.realcore.economy.BufferedEconomyTransactionWriter;
import com.realfiction.realcore.economy.EconomyService;
import com.realfiction.realcore.stats.BufferedNetworkStatWriter;
import com.realfiction.realcore.stats.EconomyMirrorService;
import com.realfiction.realcore.stats.NetworkStatService;
import java.util.ArrayList;
import java.util.List;
import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Player;
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
      send(sender, ChatColor.YELLOW + "Admin: " + ChatColor.WHITE + "/" + label + " status|stats|stats flush|economy|economy flush|rewards|reload|setspawn");
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

    send(sender, ChatColor.GOLD + "RealCore Global Economy");
    appendEconomyStatus(sender);
    send(sender, ChatColor.GRAY + "Phase 3 is client foundation only: no Vault provider, no EssentialsX balance changes.");
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
    sendEconomyWriterStatus(sender, economy.writer());
  }

  private void sendEconomyWriterStatus(CommandSender sender, BufferedEconomyTransactionWriter writer) {
    long ago = writer.lastFlushAgoSeconds();
    send(sender, ChatColor.YELLOW + "Economy writer: " + ChatColor.WHITE + writer.queuedTransactionCount()
        + " queued" + ChatColor.GRAY + " (working " + writer.workingTransactionCount()
        + ", pending " + writer.pendingTransactionCount()
        + ", retry batches " + writer.pendingBatchCount() + ")");
    send(sender, ChatColor.YELLOW + "Economy batches: " + ChatColor.WHITE + writer.sentBatchCount()
        + " sent / " + writer.failedBatchCount() + " failed"
        + ChatColor.GRAY + ", " + writer.duplicateBatchCount() + " duplicate batches, "
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

  private String statusText(boolean ok) {
    return (ok ? ChatColor.GREEN + "ready" : ChatColor.RED + "not ready");
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
      return List.of("flush");
    }
    return List.of();
  }
}
