package com.realfiction.realcore.halloween;

import com.realfiction.realcore.scheduler.RealCoreScheduler;
import java.util.UUID;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.Plugin;

public final class HerobrineAppearanceService {
  public enum Backend {
    PACKET_NPC,
    ARMOR_STAND,
    SKIP
  }

  public record Selection(Backend backend, String reason) {
  }

  private final Plugin plugin;
  private final RealCoreScheduler scheduler;
  private final Logger logger;
  private final ArmorStandHerobrineAppearance armorStandAppearance;
  private final HerobrineSkinProfileService skinProfiles;

  private volatile PacketHerobrineAppearance packetAppearance;
  private volatile boolean protocolLibDetected;
  private volatile boolean protocolLibSupported;
  private volatile String fallbackReason = "";
  private volatile String requestedMode = HerobrineAppearanceConfig.MODE_ARMOR_STAND;
  private volatile String packetMovementStatus = "unavailable";
  private volatile long generation;

  public HerobrineAppearanceService(
      Plugin plugin,
      RealCoreScheduler scheduler,
      Logger logger,
      NamespacedKey markerKey,
      NamespacedKey sightingKey,
      java.util.function.Supplier<ItemStack> headSupplier
  ) {
    this.plugin = plugin;
    this.scheduler = scheduler;
    this.logger = logger;
    this.skinProfiles = new HerobrineSkinProfileService(logger);
    this.armorStandAppearance = new ArmorStandHerobrineAppearance(scheduler, markerKey, sightingKey, headSupplier);
  }

  public void configure(HerobrineAppearanceConfig appearance, long generation) {
    HerobrineAppearanceConfig config = appearance == null ? HerobrineAppearanceConfig.defaults("Herobrineee") : appearance;
    this.requestedMode = config.mode();
    this.generation = generation;
    this.fallbackReason = "";
    skinProfiles.preload(config.skinOwner());

    if (config.armorStandRequested()) {
      protocolLibDetected = protocolDetected();
      protocolLibSupported = false;
      packetAppearance = null;
      fallbackReason = "armor_stand requested";
      packetMovementStatus = "unavailable";
      return;
    }

    if (!protocolDetected()) {
      protocolLibDetected = false;
      protocolLibSupported = false;
      packetAppearance = null;
      fallbackReason = "ProtocolLib not detected";
      packetMovementStatus = "unavailable";
      return;
    }

    try {
      ProtocolLibHerobrinePackets.InitResult init = ProtocolLibHerobrinePackets.create(plugin, logger);
      protocolLibDetected = init.detected();
      protocolLibSupported = init.supported();
      if (init.supported()) {
        packetAppearance = new PacketHerobrineAppearance(scheduler, init.packets(), skinProfiles, logger, () -> this.generation);
        fallbackReason = "";
        packetMovementStatus = init.packets().movementStatus();
        return;
      }
      packetAppearance = null;
      fallbackReason = init.reason();
      packetMovementStatus = "unavailable";
    } catch (LinkageError | RuntimeException error) {
      protocolLibDetected = true;
      protocolLibSupported = false;
      packetAppearance = null;
      fallbackReason = shortError(error);
      packetMovementStatus = "unavailable";
    }
  }

  public Selection select(HerobrineAppearanceConfig appearance) {
    return select(appearance, packetAppearance != null && protocolLibSupported, fallbackReason);
  }

  static Selection select(HerobrineAppearanceConfig appearance, boolean packetSupported, String fallbackReason) {
    HerobrineAppearanceConfig config = appearance == null ? HerobrineAppearanceConfig.defaults("Herobrineee") : appearance;
    if (config.armorStandRequested()) {
      return new Selection(Backend.ARMOR_STAND, "armor_stand requested");
    }
    if (packetSupported) {
      return new Selection(Backend.PACKET_NPC, "");
    }
    String reason = fallbackReason == null || fallbackReason.isBlank() ? "packet backend unavailable" : fallbackReason;
    if (config.fallbackToArmorStand()) {
      return new Selection(Backend.ARMOR_STAND, reason);
    }
    return new Selection(Backend.SKIP, reason);
  }

  public HerobrineAppearanceHandle spawnArmorStand(UUID sightingId, UUID playerUuid, Location playerLocation, Location safe) {
    return armorStandAppearance.spawn(sightingId, playerUuid, playerLocation, safe);
  }

  public HerobrineAppearanceHandle spawnPacket(
      UUID sightingId,
      UUID playerUuid,
      String playerName,
      Location safe,
      Location lookAt,
      HerobrineAppearanceConfig config
  ) {
    PacketHerobrineAppearance packet = packetAppearance;
    if (packet == null) {
      throw new IllegalStateException("packet backend unavailable");
    }
    return packet.spawn(sightingId, playerUuid, playerName, safe, lookAt, config, generation);
  }

  public void cleanupAll(String reason) {
    PacketHerobrineAppearance packet = packetAppearance;
    if (packet != null) {
      packet.cleanupAll(reason);
    }
  }

  public HerobrineAppearanceStatus status(HerobrineAppearanceConfig appearance) {
    HerobrineAppearanceConfig config = appearance == null ? HerobrineAppearanceConfig.defaults("Herobrineee") : appearance;
    Selection selection = select(config);
    String activeBackend = switch (selection.backend()) {
      case PACKET_NPC -> HerobrineAppearanceConfig.MODE_PACKET_NPC;
      case ARMOR_STAND -> HerobrineAppearanceConfig.MODE_ARMOR_STAND;
      case SKIP -> "none";
    };
    PacketHerobrineAppearance packet = packetAppearance;
    int sessions = packet == null ? 0 : packet.activeSessionCount();
    String reason = selection.backend() == Backend.PACKET_NPC ? "" : selection.reason();
    String skin = packet == null ? skinProfiles.status(config.skinOwner()) : packet.skinStatus(config.skinOwner());
    return new HerobrineAppearanceStatus(
        config.mode(),
        activeBackend,
        protocolLibDetected,
        protocolLibSupported,
        reason,
        sessions,
        skin,
        packetMovementStatus
    );
  }

  public int activePacketSessions() {
    PacketHerobrineAppearance packet = packetAppearance;
    return packet == null ? 0 : packet.activeSessionCount();
  }

  public String fallbackReason() {
    return fallbackReason;
  }

  private boolean protocolDetected() {
    Plugin protocol = Bukkit.getPluginManager().getPlugin("ProtocolLib");
    return protocol != null && protocol.isEnabled();
  }

  private static String shortError(Throwable error) {
    String message = error.getMessage();
    return message == null || message.isBlank() ? error.getClass().getSimpleName() : message;
  }
}
