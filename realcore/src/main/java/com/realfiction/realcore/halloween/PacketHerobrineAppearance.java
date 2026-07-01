package com.realfiction.realcore.halloween;

import com.realfiction.realcore.scheduler.RealCoreScheduler;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.LongSupplier;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.Player;

public final class PacketHerobrineAppearance {
  private final RealCoreScheduler scheduler;
  private final ProtocolLibHerobrinePackets packets;
  private final HerobrineSkinProfileService skinProfiles;
  private final Logger logger;
  private final LongSupplier serviceGenerationSupplier;
  private final Map<UUID, PacketNpcSession> sessions = new ConcurrentHashMap<>();
  private final AtomicInteger entityIds = new AtomicInteger(1_450_000_000);

  public PacketHerobrineAppearance(
      RealCoreScheduler scheduler,
      ProtocolLibHerobrinePackets packets,
      HerobrineSkinProfileService skinProfiles,
      Logger logger,
      LongSupplier serviceGenerationSupplier
  ) {
    this.scheduler = scheduler;
    this.packets = packets;
    this.skinProfiles = skinProfiles;
    this.logger = logger;
    this.serviceGenerationSupplier = serviceGenerationSupplier == null ? () -> Long.MIN_VALUE : serviceGenerationSupplier;
  }

  public HerobrineAppearanceHandle spawn(
      UUID sightingId,
      UUID viewerUuid,
      String viewerName,
      Location safe,
      Location lookAt,
      HerobrineAppearanceConfig config,
      long serviceGeneration
  ) {
    Player viewer = Bukkit.getPlayer(viewerUuid);
    if (viewer == null || !viewer.isOnline()) {
      throw new IllegalStateException("viewer offline");
    }
    if (safe == null || safe.getWorld() == null || !viewer.getWorld().equals(safe.getWorld())) {
      throw new IllegalStateException("viewer world changed");
    }
    String profileName = safeProfileName(config.skinOwner());
    UUID profileUuid = UUID.nameUUIDFromBytes(("realcore-herobrine:" + sightingId).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    PacketNpcSession session = new PacketNpcSession(
        sightingId,
        viewerUuid,
        profileUuid,
        entityIds.incrementAndGet(),
        serviceGeneration,
        ThreadLocalRandom.current().nextLong(Long.MAX_VALUE),
        teamName(sightingId),
        profileName,
        safe
    );
    HerobrineSkinProfileService.SkinProfile skin = skinProfiles.cached(config.skinOwner());
    try {
      packets.spawn(viewer, session, skin, safe, lookAt);
    } catch (RuntimeException error) {
      try {
        packets.despawn(viewer, session);
      } catch (RuntimeException cleanupError) {
        if (logger != null) {
          logger.fine("Best-effort packet NPC cleanup after spawn failure also failed: " + cleanupError.getMessage());
        }
      }
      throw error;
    }
    sessions.put(session.sessionId(), session);
    scheduleTabRemoval(viewer, session, config.hideFromTabAfterTicks());
    return new PacketHandle(session);
  }

  public int activeSessionCount() {
    return sessions.size();
  }

  public void cleanupAll(String reason) {
    for (PacketNpcSession session : List.copyOf(sessions.values())) {
      despawn(session, reason);
    }
  }

  public String skinStatus(String owner) {
    return skinProfiles.status(owner);
  }

  private void scheduleTabRemoval(Player viewer, PacketNpcSession session, int delayTicks) {
    scheduler.runForPlayerLater(viewer, () -> {
      if (!sessionCurrent(session)) {
        return;
      }
      Player current = Bukkit.getPlayer(session.viewerUuid());
      if (current == null || !current.isOnline()) {
        return;
      }
      packets.removeFromTab(current, session);
    }, delayTicks);
  }

  private void despawn(PacketNpcSession session, String reason) {
    if (!session.deactivate()) {
      return;
    }
    sessions.remove(session.sessionId());
    Player viewer = Bukkit.getPlayer(session.viewerUuid());
    if (viewer != null && viewer.isOnline()) {
      scheduler.runForPlayer(viewer, () -> packets.despawn(viewer, session));
    }
    if (logger != null) {
      logger.fine("Herobrine packet NPC despawned: " + session.sessionId() + " reason=" + reason);
    }
  }

  private static String safeProfileName(String skinOwner) {
    String cleaned = skinOwner == null ? "" : skinOwner.replaceAll("[^A-Za-z0-9_]", "").trim();
    if (cleaned.isBlank()) {
      return "Herobrine";
    }
    return cleaned.length() > 16 ? cleaned.substring(0, 16) : cleaned;
  }

  private static String teamName(UUID sightingId) {
    String compact = sightingId.toString().replace("-", "");
    return "rfhb" + compact.substring(0, Math.min(12, compact.length()));
  }

  private final class PacketHandle implements HerobrineAppearanceHandle {
    private final PacketNpcSession session;

    private PacketHandle(PacketNpcSession session) {
      this.session = session;
    }

    @Override
    public UUID sightingId() {
      return session.sessionId();
    }

    @Override
    public UUID viewerUuid() {
      return session.viewerUuid();
    }

    @Override
    public String backend() {
      return HerobrineAppearanceConfig.MODE_PACKET_NPC;
    }

    @Override
    public Location location() {
      return session.location();
    }

    @Override
    public void updateLocation(Location location) {
      session.updateLocation(location);
    }

    @Override
    public void face(Location target) {
      if (!session.active()) {
        return;
      }
      Player viewer = Bukkit.getPlayer(session.viewerUuid());
      if (viewer == null || !viewer.isOnline()) {
        return;
      }
      scheduler.runForPlayer(viewer, () -> {
        if (sessionCurrent(session)) {
          packets.rotate(viewer, session, target);
        }
      });
    }

    @Override
    public void stepAwayFrom(Location target) {
      if (!session.active()) {
        return;
      }
      Location current = session.location();
      if (current == null || target == null) {
        return;
      }
      org.bukkit.util.Vector away = current.toVector().subtract(target.toVector());
      if (away.lengthSquared() < 0.001) {
        away = new org.bukkit.util.Vector(0, 0, 1);
      }
      away.normalize().multiply(0.85);
      Location next = current.clone().add(away);
      Player viewer = Bukkit.getPlayer(session.viewerUuid());
      if (viewer == null || !viewer.isOnline()) {
        return;
      }
      scheduler.runForPlayer(viewer, () -> {
        if (sessionCurrent(session)) {
          packets.teleport(viewer, session, next, target);
        }
      });
    }

    @Override
    public void despawn(String reason) {
      PacketHerobrineAppearance.this.despawn(session, reason);
    }

    @Override
    public boolean active() {
      return session.active();
    }

    @Override
    public java.util.Optional<String> packetDebug() {
      return java.util.Optional.of(session.traceSummary());
    }
  }

  private boolean sessionCurrent(PacketNpcSession session) {
    return session != null && session.accepts(serviceGenerationSupplier.getAsLong(), session.sessionGeneration());
  }
}
