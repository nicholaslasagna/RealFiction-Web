package com.realfiction.realcore.command;

import com.realfiction.realcore.RealCorePlugin;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.economy.GameplayEconomySimulatorService;
import com.realfiction.realcore.economy.GameplayEconomySyncService;
import com.realfiction.realcore.economy.GenericGameplayEconomyProducerService;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/**
 * Admin simulator for generic gameplay economy events (dry-run testing only).
 */
public final class GameplayEconomySimulateCommand {
  private static final String PERMISSION = "realcore.admin";

  private GameplayEconomySimulateCommand() {}

  public static boolean isAuthorized(CommandSender sender) {
    return sender != null && sender.hasPermission(PERMISSION);
  }

  public static boolean handle(RealCorePlugin plugin, CommandSender sender, String[] args) {
    if (!isAuthorized(sender)) {
      send(sender, ChatColor.RED + "You do not have permission to do that.");
      return true;
    }
    if (args.length < 8) {
      sendUsage(sender);
      return true;
    }

    RealCoreConfig config = plugin.realCoreConfig();
    if (config == null) {
      send(sender, ChatColor.RED + "RealCore config is not loaded.");
      return true;
    }

    GameplayEconomySyncService sync = plugin.gameplayEconomySyncService();
    if (sync == null) {
      send(sender, ChatColor.RED + "Gameplay economy sync is not loaded.");
      return true;
    }

    GenericGameplayEconomyProducerService producer = sync.genericProducer();
    if (producer == null) {
      send(sender, ChatColor.RED + "Generic gameplay producer is not loaded.");
      return true;
    }

    String kind = args[3];
    String playerRef = args[4];
    Long amountMinor = GameplayEconomySimulatorService.parsePositiveAmount(args[5]);
    if (amountMinor == null) {
      send(sender, ChatColor.RED + "amountMinor must be a positive integer.");
      return true;
    }

    String source = args[6];
    String eventId = joinEventId(args, 7);

    PlayerResolution resolution = resolvePlayer(playerRef);
    if (resolution.error() != null) {
      send(sender, ChatColor.RED + resolution.error());
      return true;
    }

    GameplayEconomySimulatorService.SimulateResponse response = GameplayEconomySimulatorService.simulate(
        config,
        producer,
        new GameplayEconomySimulatorService.SimulateRequest(
            kind,
            resolution.uuid(),
            resolution.name(),
            amountMinor,
            source,
            eventId
        )
    );

    sendResponse(sender, response, producer);
    return true;
  }

  private static void sendResponse(
      CommandSender sender,
      GameplayEconomySimulatorService.SimulateResponse response,
      GenericGameplayEconomyProducerService producer
  ) {
    if (response.accepted()) {
      send(sender, ChatColor.GREEN + "Simulator: accepted"
          + (response.dryRun() ? ChatColor.YELLOW + " (dry-run)" : ChatColor.RED + " (LIVE — not approved for this tool)"));
      send(sender, ChatColor.GRAY + "category=" + response.category().ledgerCategory().apiValue()
          + " amountMinor=" + response.amountMinor()
          + " source=" + response.source()
          + " eventId=" + response.eventId()
          + " player=" + response.playerName() + "(" + response.playerUuid() + ")");
      send(sender, ChatColor.GRAY + "idempotencyKey=" + response.idempotencyKey());
      send(sender, ChatColor.GRAY + "dryRun=" + response.dryRun()
          + " generic.enabled=" + producer.genericConfig().enabled()
          + " queued=" + producer.metrics().queued()
          + " (no Vault mutation; no reward delivery)");
      return;
    }

    send(sender, ChatColor.RED + "Simulator: rejected — " + response.rejectionReason());
    if (response.category() != null) {
      send(sender, ChatColor.GRAY + "category=" + response.category().ledgerCategory().apiValue()
          + " amountMinor=" + response.amountMinor()
          + " source=" + response.source()
          + " eventId=" + response.eventId());
    }
    if (response.idempotencyKey() != null) {
      send(sender, ChatColor.GRAY + "idempotencyKey=" + response.idempotencyKey());
    }
    String last = producer.metrics().lastRejectionReason();
    if (last != null && !last.isBlank()) {
      send(sender, ChatColor.GRAY + "producer: " + last);
    }
  }

  private record PlayerResolution(UUID uuid, String name, String error) {
    static PlayerResolution ok(UUID uuid, String name) {
      return new PlayerResolution(uuid, name, null);
    }

    static PlayerResolution fail(String error) {
      return new PlayerResolution(null, null, error);
    }
  }

  private static PlayerResolution resolvePlayer(String playerRef) {
    if (playerRef == null || playerRef.isBlank()) {
      return PlayerResolution.fail("player is required");
    }
    try {
      UUID uuid = UUID.fromString(playerRef);
      Player online = Bukkit.getPlayer(uuid);
      String name = online != null ? online.getName() : playerRef;
      return PlayerResolution.ok(uuid, name);
    } catch (IllegalArgumentException ignored) {
      Player online = Bukkit.getPlayerExact(playerRef);
      if (online == null) {
        online = Bukkit.getPlayer(playerRef);
      }
      if (online == null) {
        return PlayerResolution.fail("player must be online or specify a valid UUID");
      }
      return PlayerResolution.ok(online.getUniqueId(), online.getName());
    }
  }

  private static String joinEventId(String[] args, int fromIndex) {
    StringBuilder builder = new StringBuilder(args[fromIndex]);
    for (int i = fromIndex + 1; i < args.length; i++) {
      builder.append(' ').append(args[i]);
    }
    return builder.toString().trim();
  }

  private static void sendUsage(CommandSender sender) {
    send(sender, ChatColor.YELLOW + "Usage: /rf economy gameplay simulate <earn|spend> <player|uuid> <amountMinor> <source> <eventId>");
    send(sender, ChatColor.GRAY + "Example: /rf economy gameplay simulate earn Alex 100 manual_simulator test-event-1");
    send(sender, ChatColor.GRAY + "Requires economy.gameplaySync.generic enabled with dry-run and allowlisted source.");
  }

  private static void send(CommandSender sender, String message) {
    sender.sendMessage(message);
  }
}
