package com.realfiction.realcore.command;

import com.realfiction.realcore.RealCorePlugin;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.lobby.LobbyManager;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
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
    String sub = args.length >= 1 ? args[0].toLowerCase(java.util.Locale.ROOT) : "";

    switch (sub) {
      case "reload":
        return handleReload(sender);
      case "status":
        return handleStatus(sender);
      case "link":
        return handleLink(sender, args);
      case "menu":
        return handleOpenMenu(sender, "game-menu");
      case "lobbies":
        return handleOpenMenu(sender, "lobby-selector");
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

  private boolean handleHelp(CommandSender sender, String label) {
    send(sender, ChatColor.GOLD + "RealFiction");
    send(sender, ChatColor.YELLOW + "Use " + ChatColor.WHITE + "/" + label + " link <code>" + ChatColor.YELLOW + " to link your account.");
    if (canUsePlayerCommand(sender)) {
      send(sender, ChatColor.YELLOW + "Use " + ChatColor.WHITE + "/" + label + " menu" + ChatColor.YELLOW + " for the game menu, "
          + ChatColor.WHITE + "/" + label + " lobbies" + ChatColor.YELLOW + ", or " + ChatColor.WHITE + "/" + label + " spawn" + ChatColor.YELLOW + ".");
    }
    if (sender.hasPermission("realcore.admin")) {
      send(sender, ChatColor.YELLOW + "Admin: " + ChatColor.WHITE + "/" + label + " status|reload|setspawn");
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
    send(sender, ChatColor.YELLOW + "LuckPerms: " + statusText(plugin.luckPermsAvailable()));
    send(sender, ChatColor.YELLOW + "Website auth: " + statusText(config.hmacSecretConfigured()));
    if (lobby != null) {
      send(sender, ChatColor.YELLOW + "Lobby module: " + statusText(lobby.config().enabled()));
      send(sender, ChatColor.YELLOW + "Lobby worlds: " + ChatColor.WHITE + String.join(", ", lobby.config().worlds()));
      send(sender, ChatColor.YELLOW + "Menus loaded: " + ChatColor.WHITE + lobby.menuRegistry().count());
    }
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
      if (sender.hasPermission("realcore.admin")) {
        options.add("status");
        options.add("reload");
        options.add("setspawn");
      }
      return options;
    }
    return List.of();
  }
}
