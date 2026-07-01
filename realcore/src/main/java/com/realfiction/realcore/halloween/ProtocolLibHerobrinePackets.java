package com.realfiction.realcore.halloween;

import com.comphenix.protocol.PacketType;
import com.comphenix.protocol.ProtocolLibrary;
import com.comphenix.protocol.ProtocolManager;
import com.comphenix.protocol.events.PacketContainer;
import com.comphenix.protocol.wrappers.EnumWrappers;
import com.comphenix.protocol.wrappers.PlayerInfoData;
import com.comphenix.protocol.wrappers.WrappedChatComponent;
import com.comphenix.protocol.wrappers.WrappedGameProfile;
import com.comphenix.protocol.wrappers.WrappedSignedProperty;
import com.comphenix.protocol.wrappers.WrappedTeamParameters;
import java.util.Collection;
import java.util.EnumSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.bukkit.util.Vector;

public final class ProtocolLibHerobrinePackets {
  public record InitResult(ProtocolLibHerobrinePackets packets, boolean detected, boolean supported, String reason) {
  }

  public record ProbeCheck(String name, boolean ok, String reason) {
    public String summary() {
      return name + ": " + (ok ? "ok" : "fail " + clean(reason, "unsupported"));
    }
  }

  public record ProbeReport(
      boolean detected,
      boolean supported,
      List<ProbeCheck> checks,
      String movementMode,
      String reason
  ) {
  }

  enum MovementMode {
    ENTITY_TELEPORT_DOUBLES,
    ENTITY_TELEPORT_VECTOR,
    REL_ENTITY_MOVE_LOOK,
    ROTATION_ONLY
  }

  record MovementPlan(MovementMode mode, String status) {
  }

  private final ProtocolManager manager;
  private final Logger logger;
  private final MovementPlan movementPlan;

  private ProtocolLibHerobrinePackets(ProtocolManager manager, Logger logger, MovementPlan movementPlan) {
    this.manager = Objects.requireNonNull(manager, "manager");
    this.logger = logger;
    this.movementPlan = movementPlan == null
        ? new MovementPlan(MovementMode.ROTATION_ONLY, "rotation_only")
        : movementPlan;
  }

  public static InitResult create(Plugin owner, Logger logger) {
    Plugin protocolPlugin = Bukkit.getPluginManager().getPlugin("ProtocolLib");
    boolean detected = protocolPlugin != null && protocolPlugin.isEnabled();
    if (!detected) {
      return new InitResult(null, false, false, "ProtocolLib not detected");
    }
    try {
      ProtocolManager manager = ProtocolLibrary.getProtocolManager();
      if (manager == null) {
        return new InitResult(null, true, false, "ProtocolLib manager unavailable");
      }
      if (!WrappedTeamParameters.isSupported()) {
        return new InitResult(null, true, false, "ProtocolLib team parameters unsupported");
      }
      MovementPlan movementPlan = probe(manager);
      ProtocolLibHerobrinePackets packets = new ProtocolLibHerobrinePackets(manager, logger, movementPlan);
      return new InitResult(packets, true, true, "");
    } catch (LinkageError | RuntimeException error) {
      return new InitResult(null, true, false, shortError(error));
    }
  }

  public static ProbeReport diagnose(Logger logger) {
    Plugin protocolPlugin = Bukkit.getPluginManager().getPlugin("ProtocolLib");
    boolean detected = protocolPlugin != null && protocolPlugin.isEnabled();
    if (!detected) {
      return new ProbeReport(false, false, List.of(), "unavailable", "ProtocolLib not detected");
    }
    try {
      ProtocolManager manager = ProtocolLibrary.getProtocolManager();
      if (manager == null) {
        return new ProbeReport(true, false, List.of(), "unavailable", "ProtocolLib manager unavailable");
      }
      List<ProbeCheck> checks = new java.util.ArrayList<>();
      checks.add(check("player info add/remove", () -> {
        PacketContainer info = manager.createPacket(PacketType.Play.Server.PLAYER_INFO);
        require(info.getPlayerInfoActions().size() > 0, "PLAYER_INFO getPlayerInfoActions unavailable");
        require(info.getPlayerInfoDataLists().size() > 0, "PLAYER_INFO getPlayerInfoDataLists unavailable");
        require(manager.createPacket(PacketType.Play.Server.PLAYER_INFO_REMOVE).getUUIDLists().size() > 0,
            "PLAYER_INFO_REMOVE getUUIDLists unavailable");
      }));
      checks.add(check("spawn packet", () -> {
        PacketContainer spawn = manager.createPacket(PacketType.Play.Server.SPAWN_ENTITY);
        require(spawn.getIntegers().size() > 0, "SPAWN_ENTITY getIntegers entity id unavailable");
        require(spawn.getUUIDs().size() > 0, "SPAWN_ENTITY getUUIDs profile uuid unavailable");
        require(spawn.getEntityTypeModifier().size() > 0, "SPAWN_ENTITY getEntityTypeModifier type unavailable");
        require(spawn.getDoubles().size() >= 3, "SPAWN_ENTITY getDoubles coordinates unavailable");
      }));
      checks.add(check("destroy packet", () -> require(
          manager.createPacket(PacketType.Play.Server.ENTITY_DESTROY).getIntLists().size() > 0,
          "ENTITY_DESTROY getIntLists entity ids unavailable")));
      checks.add(check("rotation packet", () -> {
        require(manager.createPacket(PacketType.Play.Server.ENTITY_HEAD_ROTATION).getBytes().size() > 0,
            "ENTITY_HEAD_ROTATION getBytes yaw unavailable");
        require(manager.createPacket(PacketType.Play.Server.ENTITY_LOOK).getBytes().size() >= 2,
            "ENTITY_LOOK getBytes rotation unavailable");
      }));
      checks.add(check("scoreboard team/nameplate", () -> {
        require(WrappedTeamParameters.isSupported(), "ProtocolLib team parameters unsupported");
        PacketContainer team = manager.createPacket(PacketType.Play.Server.SCOREBOARD_TEAM);
        require(team.getStrings().size() > 0, "SCOREBOARD_TEAM getStrings team name unavailable");
        require(team.getIntegers().size() > 0, "SCOREBOARD_TEAM getIntegers mode unavailable");
        require(team.getOptionalTeamParameters().size() > 0, "SCOREBOARD_TEAM getOptionalTeamParameters unavailable");
        require(team.getSpecificModifier(Collection.class).size() > 0,
            "SCOREBOARD_TEAM getSpecificModifier(Collection) players unavailable");
      }));

      MovementPlan movement = diagnoseMovement(manager);
      boolean supported = checks.stream().allMatch(ProbeCheck::ok);
      String reason = supported
          ? ""
          : checks.stream()
              .filter(probe -> !probe.ok())
              .map(probe -> probe.name() + " " + clean(probe.reason(), "unsupported"))
              .findFirst()
              .orElse("packet backend unsupported");
      return new ProbeReport(true, supported, List.copyOf(checks), movement.status(), reason);
    } catch (LinkageError | RuntimeException error) {
      if (logger != null) {
        logger.fine("Herobrine packet probe failed: " + shortError(error));
      }
      return new ProbeReport(true, false, List.of(), "unavailable", shortError(error));
    }
  }

  private static MovementPlan probe(ProtocolManager manager) {
    PacketContainer info = manager.createPacket(PacketType.Play.Server.PLAYER_INFO);
    require(info.getPlayerInfoActions().size() > 0, "PLAYER_INFO getPlayerInfoActions unavailable");
    require(info.getPlayerInfoDataLists().size() > 0, "PLAYER_INFO getPlayerInfoDataLists unavailable");
    require(manager.createPacket(PacketType.Play.Server.PLAYER_INFO_REMOVE).getUUIDLists().size() > 0,
        "PLAYER_INFO_REMOVE getUUIDLists unavailable");
    PacketContainer spawn = manager.createPacket(PacketType.Play.Server.SPAWN_ENTITY);
    require(spawn.getIntegers().size() > 0, "SPAWN_ENTITY getIntegers entity id unavailable");
    require(spawn.getUUIDs().size() > 0, "SPAWN_ENTITY getUUIDs profile uuid unavailable");
    require(spawn.getEntityTypeModifier().size() > 0, "SPAWN_ENTITY getEntityTypeModifier type unavailable");
    require(spawn.getDoubles().size() >= 3, "SPAWN_ENTITY getDoubles coordinates unavailable");
    require(manager.createPacket(PacketType.Play.Server.ENTITY_DESTROY).getIntLists().size() > 0,
        "ENTITY_DESTROY getIntLists entity ids unavailable");
    require(manager.createPacket(PacketType.Play.Server.ENTITY_HEAD_ROTATION).getBytes().size() > 0,
        "ENTITY_HEAD_ROTATION getBytes yaw unavailable");
    require(manager.createPacket(PacketType.Play.Server.ENTITY_LOOK).getBytes().size() >= 2,
        "ENTITY_LOOK getBytes rotation unavailable");
    PacketContainer team = manager.createPacket(PacketType.Play.Server.SCOREBOARD_TEAM);
    require(team.getStrings().size() > 0, "SCOREBOARD_TEAM getStrings team name unavailable");
    require(team.getIntegers().size() > 0, "SCOREBOARD_TEAM getIntegers mode unavailable");
    require(team.getOptionalTeamParameters().size() > 0, "SCOREBOARD_TEAM getOptionalTeamParameters unavailable");
    require(team.getSpecificModifier(Collection.class).size() > 0, "SCOREBOARD_TEAM getSpecificModifier(Collection) players unavailable");

    return diagnoseMovement(manager);
  }

  private static MovementPlan diagnoseMovement(ProtocolManager manager) {
    int teleportDoubles = 0;
    int teleportVectors = 0;
    String teleportFailure = "";
    try {
      PacketContainer teleport = manager.createPacket(PacketType.Play.Server.ENTITY_TELEPORT);
      teleportDoubles = teleport.getDoubles().size();
      teleportVectors = teleport.getVectors().size();
    } catch (LinkageError | RuntimeException error) {
      teleportFailure = "ENTITY_TELEPORT create/read failed: " + shortError(error);
    }

    int relativeShorts = 0;
    int relativeBytes = 0;
    String relativeFailure = "";
    try {
      PacketContainer relative = manager.createPacket(PacketType.Play.Server.REL_ENTITY_MOVE_LOOK);
      relativeShorts = relative.getShorts().size();
      relativeBytes = relative.getBytes().size();
    } catch (LinkageError | RuntimeException error) {
      relativeFailure = "REL_ENTITY_MOVE_LOOK create/read failed: " + shortError(error);
    }

    return chooseMovementPlan(
        teleportDoubles,
        teleportVectors,
        relativeShorts,
        relativeBytes,
        teleportFailure,
        relativeFailure
    );
  }

  static MovementPlan chooseMovementPlan(
      int teleportDoubleCount,
      int teleportVectorCount,
      int relativeShortCount,
      int relativeByteCount
  ) {
    return chooseMovementPlan(teleportDoubleCount, teleportVectorCount, relativeShortCount, relativeByteCount, "", "");
  }

  static MovementPlan chooseMovementPlan(
      int teleportDoubleCount,
      int teleportVectorCount,
      int relativeShortCount,
      int relativeByteCount,
      String teleportFailure,
      String relativeFailure
  ) {
    if (teleportDoubleCount >= 3) {
      return new MovementPlan(MovementMode.ENTITY_TELEPORT_DOUBLES, "entity_teleport_doubles");
    }
    if (teleportVectorCount >= 1) {
      return new MovementPlan(MovementMode.ENTITY_TELEPORT_VECTOR, "entity_teleport_vector");
    }
    if (relativeShortCount >= 3 && relativeByteCount >= 2) {
      return new MovementPlan(
          MovementMode.REL_ENTITY_MOVE_LOOK,
          "rel_entity_move_look; " + movementMissing("ENTITY_TELEPORT missing getDoubles/getVectors coordinates", teleportFailure)
      );
    }
    return new MovementPlan(
        MovementMode.ROTATION_ONLY,
        "rotation_only; " + movementMissing("ENTITY_TELEPORT missing getDoubles/getVectors coordinates", teleportFailure)
            + "; " + movementMissing("REL_ENTITY_MOVE_LOOK missing getShorts/getBytes movement", relativeFailure)
    );
  }

  private static String movementMissing(String missing, String failure) {
    String cleanFailure = failure == null ? "" : failure.trim();
    return cleanFailure.isBlank() ? missing : missing + " (" + cleanFailure + ")";
  }

  public String movementStatus() {
    return movementPlan.status();
  }

  public void spawn(Player viewer, PacketNpcSession session, HerobrineSkinProfileService.SkinProfile skin, Location target, Location lookAt) {
    WrappedGameProfile profile = profile(session, skin);
    send(viewer, teamPacket(session, 0));
    send(viewer, playerInfoPacket(session, profile, true));
    session.markTabListed();
    send(viewer, spawnPacket(session, target, lookAt));
    sendRotation(viewer, session, lookAt);
  }

  public void removeFromTab(Player viewer, PacketNpcSession session) {
    if (!session.clearTabListed()) {
      return;
    }
    send(viewer, tabRemovePacket(session));
  }

  public void rotate(Player viewer, PacketNpcSession session, Location lookAt) {
    sendRotation(viewer, session, lookAt);
  }

  public void teleport(Player viewer, PacketNpcSession session, Location next, Location lookAt) {
    if (next == null) {
      return;
    }
    try {
      sendMovement(viewer, session, next, lookAt);
    } catch (RuntimeException error) {
      if (logger != null) {
        logger.fine("Herobrine packet NPC movement fell back to rotation only: " + shortError(error));
      }
    }
    sendRotation(viewer, session, lookAt);
  }

  private void sendMovement(Player viewer, PacketNpcSession session, Location next, Location lookAt) {
    switch (movementPlan.mode()) {
      case ENTITY_TELEPORT_DOUBLES -> sendTeleportDoubles(viewer, session, next, lookAt);
      case ENTITY_TELEPORT_VECTOR -> sendTeleportVector(viewer, session, next, lookAt);
      case REL_ENTITY_MOVE_LOOK -> sendRelativeMoveLook(viewer, session, next, lookAt);
      case ROTATION_ONLY -> {
        return;
      }
    }
    session.updateLocation(next);
  }

  private void sendTeleportDoubles(Player viewer, PacketNpcSession session, Location next, Location lookAt) {
    PacketContainer packet = manager.createPacket(PacketType.Play.Server.ENTITY_TELEPORT);
    packet.getIntegers().writeSafely(0, session.entityId());
    packet.getDoubles().writeSafely(0, next.getX());
    packet.getDoubles().writeSafely(1, next.getY());
    packet.getDoubles().writeSafely(2, next.getZ());
    packet.getBytes().writeSafely(0, angleByte(yawToward(next, lookAt)));
    packet.getBytes().writeSafely(1, angleByte(pitchToward(next, lookAt)));
    packet.getBooleans().writeSafely(0, true);
    send(viewer, packet);
  }

  private void sendTeleportVector(Player viewer, PacketNpcSession session, Location next, Location lookAt) {
    PacketContainer packet = manager.createPacket(PacketType.Play.Server.ENTITY_TELEPORT);
    packet.getIntegers().writeSafely(0, session.entityId());
    packet.getVectors().writeSafely(0, new Vector(next.getX(), next.getY(), next.getZ()));
    packet.getBytes().writeSafely(0, angleByte(yawToward(next, lookAt)));
    packet.getBytes().writeSafely(1, angleByte(pitchToward(next, lookAt)));
    packet.getBooleans().writeSafely(0, true);
    send(viewer, packet);
  }

  private void sendRelativeMoveLook(Player viewer, PacketNpcSession session, Location next, Location lookAt) {
    Location current = session.location();
    if (current == null) {
      return;
    }
    PacketContainer packet = manager.createPacket(PacketType.Play.Server.REL_ENTITY_MOVE_LOOK);
    packet.getIntegers().writeSafely(0, session.entityId());
    packet.getShorts().writeSafely(0, relativeDelta(current.getX(), next.getX()));
    packet.getShorts().writeSafely(1, relativeDelta(current.getY(), next.getY()));
    packet.getShorts().writeSafely(2, relativeDelta(current.getZ(), next.getZ()));
    packet.getBytes().writeSafely(0, angleByte(yawToward(next, lookAt)));
    packet.getBytes().writeSafely(1, angleByte(pitchToward(next, lookAt)));
    packet.getBooleans().writeSafely(0, true);
    send(viewer, packet);
  }

  public void despawn(Player viewer, PacketNpcSession session) {
    removeFromTab(viewer, session);
    PacketContainer destroy = manager.createPacket(PacketType.Play.Server.ENTITY_DESTROY);
    destroy.getIntLists().writeSafely(0, List.of(session.entityId()));
    send(viewer, destroy);
    send(viewer, teamPacket(session, 1));
  }

  private WrappedGameProfile profile(PacketNpcSession session, HerobrineSkinProfileService.SkinProfile skin) {
    WrappedGameProfile profile = new WrappedGameProfile(session.profileUuid(), session.profileName());
    if (skin != null && skin.resolved()) {
      profile.getProperties().put("textures", new WrappedSignedProperty("textures", skin.value(), skin.signature()));
    }
    return profile;
  }

  private PacketContainer playerInfoPacket(PacketNpcSession session, WrappedGameProfile profile, boolean listed) {
    PacketContainer packet = manager.createPacket(PacketType.Play.Server.PLAYER_INFO);
    packet.getPlayerInfoActions().writeSafely(0, EnumSet.of(
        EnumWrappers.PlayerInfoAction.ADD_PLAYER,
        EnumWrappers.PlayerInfoAction.UPDATE_LISTED,
        EnumWrappers.PlayerInfoAction.UPDATE_LATENCY,
        EnumWrappers.PlayerInfoAction.UPDATE_GAME_MODE,
        EnumWrappers.PlayerInfoAction.UPDATE_DISPLAY_NAME
    ));
    PlayerInfoData data = new PlayerInfoData(
        session.profileUuid(),
        0,
        listed,
        EnumWrappers.NativeGameMode.SURVIVAL,
        profile,
        WrappedChatComponent.fromText("")
    );
    packet.getPlayerInfoDataLists().writeSafely(0, List.of(data));
    return packet;
  }

  private PacketContainer tabRemovePacket(PacketNpcSession session) {
    PacketContainer packet = manager.createPacket(PacketType.Play.Server.PLAYER_INFO_REMOVE);
    packet.getUUIDLists().writeSafely(0, List.of(session.profileUuid()));
    return packet;
  }

  private PacketContainer spawnPacket(PacketNpcSession session, Location target, Location lookAt) {
    PacketContainer packet = manager.createPacket(PacketType.Play.Server.SPAWN_ENTITY);
    packet.getIntegers().writeSafely(0, session.entityId());
    packet.getIntegers().writeSafely(1, 0);
    packet.getUUIDs().writeSafely(0, session.profileUuid());
    packet.getEntityTypeModifier().writeSafely(0, EntityType.PLAYER);
    packet.getDoubles().writeSafely(0, target.getX());
    packet.getDoubles().writeSafely(1, target.getY());
    packet.getDoubles().writeSafely(2, target.getZ());
    packet.getBytes().writeSafely(0, angleByte(yawToward(target, lookAt)));
    packet.getBytes().writeSafely(1, angleByte(pitchToward(target, lookAt)));
    packet.getBytes().writeSafely(2, angleByte(yawToward(target, lookAt)));
    packet.getShorts().writeSafely(0, (short) 0);
    packet.getShorts().writeSafely(1, (short) 0);
    packet.getShorts().writeSafely(2, (short) 0);
    return packet;
  }

  private void sendRotation(Player viewer, PacketNpcSession session, Location lookAt) {
    Location current = session.location();
    if (current == null || lookAt == null) {
      return;
    }
    byte yaw = angleByte(yawToward(current, lookAt));
    byte pitch = angleByte(pitchToward(current, lookAt));

    PacketContainer look = manager.createPacket(PacketType.Play.Server.ENTITY_LOOK);
    look.getIntegers().writeSafely(0, session.entityId());
    look.getBytes().writeSafely(0, yaw);
    look.getBytes().writeSafely(1, pitch);
    look.getBooleans().writeSafely(0, true);
    send(viewer, look);

    PacketContainer head = manager.createPacket(PacketType.Play.Server.ENTITY_HEAD_ROTATION);
    head.getIntegers().writeSafely(0, session.entityId());
    head.getBytes().writeSafely(0, yaw);
    send(viewer, head);
  }

  private PacketContainer teamPacket(PacketNpcSession session, int mode) {
    PacketContainer packet = manager.createPacket(PacketType.Play.Server.SCOREBOARD_TEAM);
    packet.getStrings().writeSafely(0, session.teamName());
    packet.getIntegers().writeSafely(0, mode);
    if (mode == 0 || mode == 2) {
      WrappedTeamParameters parameters = WrappedTeamParameters.newBuilder()
          .displayName(WrappedChatComponent.fromText(""))
          .prefix(WrappedChatComponent.fromText(""))
          .suffix(WrappedChatComponent.fromText(""))
          .nametagVisibility("never")
          .collisionRule("never")
          .color(EnumWrappers.ChatFormatting.RESET)
          .options(0)
          .build();
      packet.getOptionalTeamParameters().writeSafely(0, Optional.of(parameters));
    }
    if (mode == 0 || mode == 3 || mode == 4) {
      writePlayers(packet, List.of(session.profileName()));
    }
    return packet;
  }

  @SuppressWarnings({"rawtypes", "unchecked"})
  private void writePlayers(PacketContainer packet, Collection<String> players) {
    packet.getSpecificModifier(Collection.class).writeSafely(0, players);
  }

  private void send(Player viewer, PacketContainer packet) {
    if (viewer == null || !viewer.isOnline()) {
      return;
    }
    try {
      manager.sendServerPacket(viewer, packet);
    } catch (RuntimeException error) {
      throw new IllegalStateException(error);
    }
  }

  private static void require(boolean condition, String reason) {
    if (!condition) {
      throw new IllegalStateException(reason);
    }
  }

  private static byte angleByte(float angle) {
    return (byte) Math.floorMod((int) (angle * 256.0f / 360.0f), 256);
  }

  private static short relativeDelta(double from, double to) {
    long encoded = Math.round((to - from) * 4096.0d);
    if (encoded > Short.MAX_VALUE) {
      return Short.MAX_VALUE;
    }
    if (encoded < Short.MIN_VALUE) {
      return Short.MIN_VALUE;
    }
    return (short) encoded;
  }

  private static float yawToward(Location from, Location target) {
    if (from == null || target == null) {
      return 0.0f;
    }
    double dx = target.getX() - from.getX();
    double dz = target.getZ() - from.getZ();
    return (float) Math.toDegrees(Math.atan2(-dx, dz));
  }

  private static float pitchToward(Location from, Location target) {
    if (from == null || target == null) {
      return 0.0f;
    }
    double dx = target.getX() - from.getX();
    double dy = target.getY() + 1.55 - (from.getY() + 1.62);
    double dz = target.getZ() - from.getZ();
    double horizontal = Math.sqrt(dx * dx + dz * dz);
    return (float) -Math.toDegrees(Math.atan2(dy, horizontal));
  }

  private static String shortError(Throwable error) {
    String message = error.getMessage();
    return message == null || message.isBlank() ? error.getClass().getSimpleName() : message;
  }

  private static ProbeCheck check(String name, Runnable probe) {
    try {
      probe.run();
      return new ProbeCheck(name, true, "");
    } catch (LinkageError | RuntimeException error) {
      return new ProbeCheck(name, false, shortError(error));
    }
  }

  private static String clean(String value, String fallback) {
    String cleaned = value == null ? "" : value.trim();
    return cleaned.isBlank() ? fallback : cleaned;
  }
}
