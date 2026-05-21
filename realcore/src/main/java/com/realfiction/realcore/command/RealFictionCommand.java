package com.realfiction.realcore.command;

import com.realfiction.realcore.RealCorePlugin;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
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
    if (args.length >= 1 && args[0].equalsIgnoreCase("reload")) {
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

    if (args.length >= 1 && args[0].equalsIgnoreCase("status")) {
      if (!sender.hasPermission("realcore.admin")) {
        send(sender, ChatColor.RED + "You do not have permission to do that.");
        return true;
      }
      sendStatus(sender);
      return true;
    }

    if (args.length == 2 && args[0].equalsIgnoreCase("link")) {
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

    send(sender, ChatColor.GOLD + "RealFiction");
    send(sender, ChatColor.YELLOW + "Use " + ChatColor.WHITE + "/" + label + " link <code>" + ChatColor.YELLOW + " to link your account.");
    if (sender.hasPermission("realcore.admin")) {
      send(sender, ChatColor.YELLOW + "Use " + ChatColor.WHITE + "/" + label + " status" + ChatColor.YELLOW + " to check RealCore.");
    }
    return true;
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
    send(sender, ChatColor.YELLOW + "Server ID: " + ChatColor.WHITE + config.serverId());
    send(sender, ChatColor.YELLOW + "Base URL: " + ChatColor.WHITE + config.baseUrl());
    send(sender, ChatColor.YELLOW + "Poll interval: " + ChatColor.WHITE + config.pollInterval().toSeconds() + "s");
    send(sender, ChatColor.YELLOW + "Scheduler: " + ChatColor.WHITE + (scheduler == null ? "not loaded" : scheduler.name()));
    send(sender, ChatColor.YELLOW + "Reward polling: " + statusText(plugin.rewardPollingActive()));
    send(sender, ChatColor.YELLOW + "LuckPerms: " + statusText(plugin.luckPermsAvailable()));
    send(sender, ChatColor.YELLOW + "Website auth: " + statusText(config.hmacSecretConfigured()));
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
      if (sender.hasPermission("realcore.admin")) {
        return List.of("link", "status", "reload");
      }
      return List.of("link");
    }
    return List.of();
  }
}
