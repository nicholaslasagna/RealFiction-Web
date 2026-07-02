package com.realfiction.realcore.command;

import com.realfiction.realcore.RealCorePlugin;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.economy.GameplayCreditService;
import com.realfiction.realcore.economy.GameplayEconomySimulatorService;
import com.realfiction.realcore.economy.GameplayEconomySyncService;
import com.realfiction.realcore.economy.GenericGameplayEconomyProducerService;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.entity.Player;

/**
 * /rf economy gameplay-credit <player> <amountMinor> <source> <reason> [eventId]
 *
 * Console-first bridge used by trusted plugins (RealParkour) to award
 * gameplay money through the canonical gameplay sync ledger path. Players
 * need the high-trust {@code realcore.economy.gameplay_credit} permission.
 * All economy policy (enablement, dry-run, Anarchy, backend/source
 * allowlists, caps, dedup) is enforced by the generic gameplay producer.
 *
 * Without an explicit {@code eventId} each invocation generates a unique one,
 * so the command itself is NOT idempotent — callers own dedup (RealParkour
 * persists milestone keys). Pass a deterministic eventId to opt into
 * producer-side duplicate rejection.
 */
public final class GameplayCreditCommand {
  public static final String PERMISSION = "realcore.economy.gameplay_credit";

  private GameplayCreditCommand() {}

  static boolean isAuthorized(CommandSender sender) {
    if (sender instanceof ConsoleCommandSender) {
      return true;
    }
    return sender != null && sender.hasPermission(PERMISSION);
  }

  public static boolean handle(RealCorePlugin plugin, CommandSender sender, String[] args) {
    if (!isAuthorized(sender)) {
      send(sender, ChatColor.RED + "You do not have permission to do that.");
      return true;
    }
    // args: [economy, gameplay-credit, player, amountMinor, source, reason, eventId?]
    if (args.length < 6 || args.length > 7) {
      sendUsage(sender);
      return true;
    }

    RealCoreConfig config = plugin.realCoreConfig();
    if (config == null) {
      send(sender, ChatColor.RED + "RealCore config is not loaded.");
      return true;
    }
    GameplayEconomySyncService sync = plugin.gameplayEconomySyncService();
    GenericGameplayEconomyProducerService producer = sync == null ? null : sync.genericProducer();
    if (producer == null) {
      send(sender, ChatColor.RED + "Gameplay economy sync is not loaded.");
      return true;
    }

    // PR 1 of the bridge: online players only, resolved by exact name.
    Player target = Bukkit.getPlayerExact(args[2]);
    if (target == null) {
      send(sender, ChatColor.RED + "Player must be online: " + args[2]);
      return true;
    }
    Long amountMinor = GameplayEconomySimulatorService.parsePositiveAmount(args[3]);
    if (amountMinor == null) {
      send(sender, ChatColor.RED + "amountMinor must be a positive integer.");
      return true;
    }
    String eventId = args.length == 7 ? args[6] : "credit-" + UUID.randomUUID();

    GameplayCreditService.CreditResponse response = GameplayCreditService.credit(
        config,
        producer,
        new GameplayCreditService.CreditRequest(
            target.getUniqueId(),
            target.getName(),
            amountMinor,
            args[4],
            args[5],
            eventId
        )
    );

    String summary = "player=" + target.getName() + "(" + target.getUniqueId() + ")"
        + " amountMinor=" + amountMinor
        + " source=" + args[4]
        + " reason=" + args[5]
        + " backend=" + config.serverId()
        + " sender=" + sender.getName();

    if (response.accepted()) {
      String mode = response.dryRun() ? "DRY-RUN (no ledger write)" : "LIVE (queued to ledger)";
      send(sender, ChatColor.GREEN + "Gameplay credit accepted — " + mode);
      send(sender, ChatColor.GRAY + summary);
      plugin.getLogger().info("[GameplayCredit] accepted " + (response.dryRun() ? "dryRun " : "live ")
          + summary + " idempotencyKey=" + response.idempotencyKey());
      return true;
    }

    send(sender, ChatColor.RED + "Gameplay credit rejected — " + response.rejectionReason());
    send(sender, ChatColor.GRAY + summary);
    plugin.getLogger().warning("[GameplayCredit] rejected (" + response.rejectionReason() + ") " + summary);
    return true;
  }

  private static void sendUsage(CommandSender sender) {
    send(sender, ChatColor.YELLOW
        + "Usage: /rf economy gameplay-credit <player> <amountMinor> <source> <reason> [eventId]");
    send(sender, ChatColor.GRAY
        + "Example: /rf economy gameplay-credit Alex 2500 lobby_parkour parkour_first_completion");
    send(sender, ChatColor.GRAY
        + "Requires economy.gameplaySync + generic enabled, allowlisted backend and source.");
  }

  private static void send(CommandSender sender, String message) {
    sender.sendMessage(message);
  }
}
