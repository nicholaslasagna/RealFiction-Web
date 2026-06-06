package com.realfiction.realcore.economy;

import com.realfiction.realcore.RealCorePlugin;
import com.realfiction.realcore.config.EconomyProviderConfig;
import java.util.List;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.OfflinePlayer;
import org.bukkit.command.Command;
import org.bukkit.command.CommandMap;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/**
 * Player-facing economy command(s) registered only while RealCore is the live Vault economy.
 *
 * <p>EssentialsX's own {@code /balance} reads Essentials' internal economy and bypasses Vault, so
 * after going live an operator disables Essentials' {@code balance/bal/money} commands and these
 * take over — reading the shared RealCore balance. Registered dynamically on go-live and removed on
 * stop, so when RealCore is not the economy it doesn't touch these commands at all.
 */
public final class EconomyPlayerCommands {
  private final RealCorePlugin plugin;
  private final EconomyProviderService service;
  private BalanceCommand balanceCommand;

  public EconomyPlayerCommands(RealCorePlugin plugin, EconomyProviderService service) {
    this.plugin = plugin;
    this.service = service;
  }

  public void register() {
    try {
      CommandMap map = Bukkit.getCommandMap();
      balanceCommand = new BalanceCommand();
      map.register("realcore", balanceCommand);
      plugin.getLogger().info("Registered /balance for the RealCore economy. Disable EssentialsX's "
          + "balance/bal/money commands so /balance shows the shared balance.");
    } catch (Throwable error) {
      plugin.getLogger().warning("Could not register /balance: " + error.getMessage());
    }
  }

  public void unregister() {
    if (balanceCommand == null) {
      return;
    }
    try {
      balanceCommand.unregister(Bukkit.getCommandMap());
    } catch (Throwable ignored) {
      // best effort
    }
    balanceCommand = null;
  }

  private String format(double amount) {
    EconomyProviderConfig pc = plugin.realCoreConfig().economy().provider();
    return pc.currencySymbol() + String.format("%,." + pc.fractionalDigits() + "f", amount);
  }

  private final class BalanceCommand extends Command {
    BalanceCommand() {
      super("balance", "Show your RealFiction balance.", "/balance [player]", List.of("bal", "money"));
    }

    @Override
    public boolean execute(CommandSender sender, String label, String[] args) {
      if (!service.live()) {
        sender.sendMessage(ChatColor.RED + "The economy is not available right now.");
        return true;
      }
      OfflinePlayer target;
      boolean other = args.length >= 1;
      if (other) {
        target = Bukkit.getOfflinePlayerIfCached(args[0]);
        if (target == null) {
          sender.sendMessage(ChatColor.RED + "That player has not been seen recently.");
          return true;
        }
      } else if (sender instanceof Player player) {
        target = player;
      } else {
        sender.sendMessage(ChatColor.YELLOW + "Usage: /balance <player>");
        return true;
      }
      double balance = service.balanceDouble(target.getUniqueId());
      String who = other ? (target.getName() + "'s") : "Your";
      sender.sendMessage(ChatColor.GREEN + who + " balance: " + ChatColor.WHITE + format(balance));
      return true;
    }

    @Override
    public List<String> tabComplete(CommandSender sender, String alias, String[] args) {
      return List.of();
    }
  }
}
