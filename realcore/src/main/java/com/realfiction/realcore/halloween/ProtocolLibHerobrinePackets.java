package com.realfiction.realcore.halloween;

import com.comphenix.protocol.PacketType;
import com.comphenix.protocol.ProtocolLibrary;
import com.comphenix.protocol.ProtocolManager;
import com.comphenix.protocol.events.PacketContainer;
import com.comphenix.protocol.wrappers.EnumWrappers;
import com.comphenix.protocol.wrappers.PlayerInfoData;
import com.comphenix.protocol.wrappers.WrappedChatComponent;
import com.comphenix.protocol.wrappers.WrappedDataValue;
import com.comphenix.protocol.wrappers.WrappedDataWatcher;
import com.comphenix.protocol.wrappers.WrappedGameProfile;
import com.comphenix.protocol.wrappers.WrappedSignedProperty;
import com.comphenix.protocol.wrappers.WrappedTeamParameters;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.bukkit.util.Vector;

public final class ProtocolLibHerobrinePackets {
  static final String PLAYER_INFO_NATIVE_ENTRY_UNSUPPORTED =
      "PLAYER_INFO_UPDATE native entry payload unsupported";

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

  record PlayerInfoPayloadInspection(boolean nativeCompatible, String reason) {
  }

  private record ProbeOutcome(ProbeReport report, MovementPlan movementPlan) {
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
      ProbeOutcome outcome = probe(manager, logger);
      if (!outcome.report().supported()) {
        return new InitResult(null, true, false, outcome.report().reason());
      }
      ProtocolLibHerobrinePackets packets = new ProtocolLibHerobrinePackets(manager, logger, outcome.movementPlan());
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
      return probe(manager, logger).report();
    } catch (LinkageError | RuntimeException error) {
      if (logger != null) {
        logger.fine("Herobrine packet probe failed: " + shortError(error));
      }
      return new ProbeReport(true, false, List.of(), "unavailable", shortError(error));
    }
  }

  private static ProbeOutcome probe(ProtocolManager manager, Logger logger) {
    MovementPlan movement = diagnoseMovement(manager);
    ProtocolLibHerobrinePackets packets = new ProtocolLibHerobrinePackets(manager, logger, movement);
    PacketNpcSession probeSession = probeSession();
    WrappedGameProfile probeProfile = new WrappedGameProfile(probeSession.profileUuid(), probeSession.profileName());

    List<ProbeCheck> checks = new ArrayList<>();
    checks.add(check("player info add/update", () -> packets.playerInfoPacket(probeSession, probeProfile, true)));
    checks.add(check("player info remove", () -> packets.tabRemovePacket(probeSession)));
    checks.add(check("spawn packet", () -> {
      PacketContainer spawn = manager.createPacket(PacketType.Play.Server.SPAWN_ENTITY);
      require(spawn.getIntegers().size() > 0, "SPAWN_ENTITY getIntegers entity id unavailable");
      require(spawn.getUUIDs().size() > 0, "SPAWN_ENTITY getUUIDs profile uuid unavailable");
      require(spawn.getEntityTypeModifier().size() > 0, "SPAWN_ENTITY getEntityTypeModifier type unavailable");
      require(spawn.getDoubles().size() >= 3, "SPAWN_ENTITY getDoubles coordinates unavailable");
    }));
    checks.add(check("metadata packet", () -> require(
        manager.createPacket(PacketType.Play.Server.ENTITY_METADATA).getDataValueCollectionModifier().size() > 0,
        "ENTITY_METADATA getDataValueCollectionModifier unavailable")));
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

    return new ProbeOutcome(buildProbeReport(true, checks, movement), movement);
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
    session.markTeamSent();
    send(viewer, playerInfoPacket(session, profile, true));
    session.markPlayerInfoAddSent();
    session.markTabListed();
    send(viewer, spawnPacket(session, target, lookAt));
    session.markSpawnPacketSent();
    sendSkinLayerMetadata(viewer, session);
    sendRotation(viewer, session, lookAt);
  }

  /**
   * Enables all skin overlay layers (hat/jacket/sleeves/pants) on the fake player. Cosmetic
   * only — a missing metadata packet still renders the base skin — so failures are swallowed
   * and simply leave the trace flag unset.
   */
  private void sendSkinLayerMetadata(Player viewer, PacketNpcSession session) {
    try {
      PacketContainer packet = manager.createPacket(PacketType.Play.Server.ENTITY_METADATA);
      packet.getIntegers().writeSafely(0, session.entityId());
      if (packet.getDataValueCollectionModifier().size() == 0) {
        return;
      }
      WrappedDataValue skinParts = new WrappedDataValue(
          17, WrappedDataWatcher.Registry.get(Byte.class), (byte) 0x7F);
      packet.getDataValueCollectionModifier().writeSafely(0, List.of(skinParts));
      send(viewer, packet);
      session.markMetadataSent();
    } catch (LinkageError | RuntimeException error) {
      if (logger != null) {
        logger.fine("Herobrine packet NPC skin layer metadata skipped: " + shortError(error));
      }
    }
  }

  public void removeFromTab(Player viewer, PacketNpcSession session) {
    if (!session.clearTabListed()) {
      return;
    }
    send(viewer, tabRemovePacket(session));
    session.markTabRemoveSent();
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
    session.markDestroySent();
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
    Set<EnumWrappers.PlayerInfoAction> actions = EnumSet.of(
        EnumWrappers.PlayerInfoAction.ADD_PLAYER,
        EnumWrappers.PlayerInfoAction.UPDATE_LISTED,
        EnumWrappers.PlayerInfoAction.UPDATE_LATENCY,
        EnumWrappers.PlayerInfoAction.UPDATE_GAME_MODE,
        EnumWrappers.PlayerInfoAction.UPDATE_DISPLAY_NAME
    );
    PlayerInfoData data = new PlayerInfoData(
        session.profileUuid(),
        0,
        listed,
        EnumWrappers.NativeGameMode.SURVIVAL,
        profile,
        WrappedChatComponent.fromText("")
    );
    return playerInfoPacket(actions, List.of(data));
  }

  private PacketContainer playerInfoPacket(Set<EnumWrappers.PlayerInfoAction> actions, List<PlayerInfoData> data) {
    try {
      PacketContainer packet = playerInfoPacketViaNativeConstructor(actions, data);
      PlayerInfoPayloadInspection inspection = inspectPlayerInfoPayload(packet.getHandle());
      if (!inspection.nativeCompatible()) {
        throw new IllegalStateException(inspection.reason());
      }
      return packet;
    } catch (LinkageError | RuntimeException error) {
      String detail = shortError(error);
      if (detail.startsWith(PLAYER_INFO_NATIVE_ENTRY_UNSUPPORTED)) {
        throw new IllegalStateException(detail, error);
      }
      throw new IllegalStateException(PLAYER_INFO_NATIVE_ENTRY_UNSUPPORTED + ": " + detail, error);
    }
  }

  @SuppressWarnings({"rawtypes", "unchecked"})
  private PacketContainer playerInfoPacketViaNativeConstructor(
      Set<EnumWrappers.PlayerInfoAction> actions,
      List<PlayerInfoData> data
  ) {
    EnumSet nativeActions = null;
    for (EnumWrappers.PlayerInfoAction action : actions) {
      Object nativeAction = EnumWrappers.getPlayerInfoActionConverter().getGeneric(action);
      if (!(nativeAction instanceof Enum<?> nativeEnum)) {
        throw new IllegalStateException("PLAYER_INFO action converter returned non-enum");
      }
      if (nativeActions == null) {
        nativeActions = EnumSet.noneOf((Class<Enum>) nativeEnum.getDeclaringClass());
      }
      nativeActions.add(nativeEnum);
    }
    if (nativeActions == null) {
      throw new IllegalStateException("PLAYER_INFO action set is empty");
    }

    List<Object> nativeEntries = new ArrayList<>();
    for (PlayerInfoData datum : data) {
      nativeEntries.add(PlayerInfoData.getConverter().getGeneric(datum));
    }

    Class<?> packetClass = manager.createPacket(PacketType.Play.Server.PLAYER_INFO).getHandle().getClass();
    List<Constructor<?>> constructors = new ArrayList<>();
    for (Constructor<?> constructor : packetClass.getDeclaredConstructors()) {
      Class<?>[] parameters = constructor.getParameterTypes();
      if (parameters.length == 2
          && EnumSet.class.isAssignableFrom(parameters[0])
          && Collection.class.isAssignableFrom(parameters[1])) {
        constructors.add(constructor);
      }
    }
    constructors.sort(Comparator.comparingInt(ProtocolLibHerobrinePackets::playerInfoConstructorScore));
    List<String> failures = new ArrayList<>();
    for (Constructor<?> constructor : constructors) {
      try {
        constructor.setAccessible(true);
        Object handle = constructor.newInstance(nativeActions, nativeEntries);
        return PacketContainer.fromPacket(handle);
      } catch (IllegalAccessException | InstantiationException | IllegalArgumentException error) {
        failures.add(constructor + " -> " + shortError(error));
      } catch (InvocationTargetException error) {
        failures.add(constructor + " -> " + shortError(error.getCause() == null ? error : error.getCause()));
      }
    }
    throw new IllegalStateException("no usable PLAYER_INFO constructor for actions+entries: " + failures);
  }

  private static PlayerInfoPayloadInspection inspectPlayerInfoPayload(Object handle) {
    if (handle == null) {
      return unsupportedPlayerInfoPayload("packet handle is null");
    }
    boolean foundNativeEntry = false;
    Class<?> type = handle.getClass();
    while (type != null && type != Object.class) {
      for (Field field : type.getDeclaredFields()) {
        if (Modifier.isStatic(field.getModifiers())) {
          continue;
        }
        Object value;
        try {
          field.setAccessible(true);
          value = field.get(handle);
        } catch (IllegalAccessException | RuntimeException error) {
          return unsupportedPlayerInfoPayload("cannot inspect " + field.getName() + ": " + shortError(error));
        }
        if (!(value instanceof Collection<?> collection)) {
          continue;
        }
        PlayerInfoPayloadInspection inspection = inspectPlayerInfoEntryCollection(collection);
        if (!inspection.nativeCompatible()) {
          return inspection;
        }
        if ("native entries ok".equals(inspection.reason())) {
          foundNativeEntry = true;
        }
      }
      type = type.getSuperclass();
    }
    return foundNativeEntry
        ? new PlayerInfoPayloadInspection(true, "native entries ok")
        : unsupportedPlayerInfoPayload("no native Entry collection found");
  }

  static PlayerInfoPayloadInspection inspectPlayerInfoEntryCollection(Collection<?> collection) {
    if (collection == null || collection.isEmpty()) {
      return new PlayerInfoPayloadInspection(true, "empty collection ignored");
    }
    List<String> classNames = new ArrayList<>();
    for (Object entry : collection) {
      if (entry != null) {
        classNames.add(entry.getClass().getName());
      }
    }
    return inspectPlayerInfoEntryClassNames(classNames);
  }

  static PlayerInfoPayloadInspection inspectPlayerInfoEntryClassNames(Collection<String> classNames) {
    if (classNames == null || classNames.isEmpty()) {
      return new PlayerInfoPayloadInspection(true, "empty collection ignored");
    }
    boolean sawNativeEntry = false;
    for (String className : classNames) {
      if (PlayerInfoData.class.getName().equals(className)) {
        return unsupportedPlayerInfoPayload("entries contain ProtocolLib PlayerInfoData wrappers");
      }
      if (isNativePlayerInfoEntryClassName(className)) {
        sawNativeEntry = true;
      }
    }
    return sawNativeEntry
        ? new PlayerInfoPayloadInspection(true, "native entries ok")
        : new PlayerInfoPayloadInspection(true, "non-entry collection ignored");
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
    session.markRotationSent();
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
    if (error == null) {
      return "unknown error";
    }
    String message = error.getMessage();
    if (message == null || message.isBlank()) {
      Throwable cause = error.getCause();
      return cause == null ? error.getClass().getSimpleName() : error.getClass().getSimpleName() + ": " + shortError(cause);
    }
    Throwable cause = error.getCause();
    if (cause != null && ("Minecraft error.".equals(message) || "Cannot construct packet due to a security limitation.".equals(message))) {
      return message + ": " + shortError(cause);
    }
    return message;
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

  /**
   * Honest server-side render confidence. The server can only prove packets were accepted
   * for dispatch — never that the client drew pixels. On protocol 775 (1.20.2+) the required
   * client sequence for a visible fake player is PLAYER_INFO_UPDATE(ADD_PLAYER, native
   * entries) followed by generic SPAWN_ENTITY(type=PLAYER, matching UUID) on the same
   * connection; metadata only affects skin overlay layers.
   */
  static String renderConfidence(boolean playerInfoOk, boolean spawnOk, boolean metadataOk) {
    if (playerInfoOk && spawnOk) {
      return metadataOk
          ? "high (info+spawn+metadata constructible; client render not directly verifiable)"
          : "medium (info+spawn ok; metadata unavailable so skin overlay layers may be missing)";
    }
    return "low (" + (playerInfoOk ? "spawn packet unavailable" : "player info unavailable") + ")";
  }

  static ProbeReport buildProbeReport(boolean detected, List<ProbeCheck> checks, MovementPlan movement) {
    List<ProbeCheck> safeChecks = checks == null ? List.of() : List.copyOf(checks);
    boolean supported = detected && safeChecks.stream().allMatch(ProbeCheck::ok);
    String reason = supported
        ? ""
        : safeChecks.stream()
            .filter(probe -> !probe.ok())
            .map(ProtocolLibHerobrinePackets::probeFailureReason)
            .findFirst()
            .orElse(detected ? "packet backend unsupported" : "ProtocolLib not detected");
    return new ProbeReport(
        detected,
        supported,
        safeChecks,
        movement == null ? "unavailable" : movement.status(),
        reason
    );
  }

  private static int playerInfoConstructorScore(Constructor<?> constructor) {
    Class<?>[] parameters = constructor.getParameterTypes();
    if (parameters.length >= 2 && List.class.isAssignableFrom(parameters[1])) {
      return 0;
    }
    if (parameters.length >= 2 && Collection.class.isAssignableFrom(parameters[1])) {
      return 1;
    }
    return 2;
  }

  private static String probeFailureReason(ProbeCheck probe) {
    String reason = clean(probe.reason(), "unsupported");
    if (reason.startsWith(PLAYER_INFO_NATIVE_ENTRY_UNSUPPORTED)) {
      return reason;
    }
    return probe.name() + " " + reason;
  }

  private static PlayerInfoPayloadInspection unsupportedPlayerInfoPayload(String reason) {
    String detail = clean(reason, "unknown payload shape");
    return new PlayerInfoPayloadInspection(false, PLAYER_INFO_NATIVE_ENTRY_UNSUPPORTED + ": " + detail);
  }

  private static boolean isNativePlayerInfoEntryClassName(String className) {
    return className != null && className.contains("ClientboundPlayerInfoUpdatePacket$Entry");
  }

  private static PacketNpcSession probeSession() {
    UUID sessionId = UUID.nameUUIDFromBytes("realcore-herobrine-packet-probe-session".getBytes(java.nio.charset.StandardCharsets.UTF_8));
    UUID viewerId = UUID.nameUUIDFromBytes("realcore-herobrine-packet-probe-viewer".getBytes(java.nio.charset.StandardCharsets.UTF_8));
    UUID profileId = UUID.nameUUIDFromBytes("realcore-herobrine-packet-probe-profile".getBytes(java.nio.charset.StandardCharsets.UTF_8));
    return new PacketNpcSession(sessionId, viewerId, profileId, 1_450_000_001, 1L, 1L, "rfhbprobe", "Herobrine", null);
  }
}
