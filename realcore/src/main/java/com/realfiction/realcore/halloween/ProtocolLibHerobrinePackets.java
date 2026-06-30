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

public final class ProtocolLibHerobrinePackets {
  public record InitResult(ProtocolLibHerobrinePackets packets, boolean detected, boolean supported, String reason) {
  }

  private final ProtocolManager manager;
  private final Logger logger;

  private ProtocolLibHerobrinePackets(ProtocolManager manager, Logger logger) {
    this.manager = Objects.requireNonNull(manager, "manager");
    this.logger = logger;
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
      ProtocolLibHerobrinePackets packets = new ProtocolLibHerobrinePackets(manager, logger);
      packets.probe();
      return new InitResult(packets, true, true, "");
    } catch (LinkageError | RuntimeException error) {
      return new InitResult(null, true, false, shortError(error));
    }
  }

  private void probe() {
    PacketContainer info = manager.createPacket(PacketType.Play.Server.PLAYER_INFO);
    require(info.getPlayerInfoActions().size() > 0, "PLAYER_INFO actions unavailable");
    require(info.getPlayerInfoDataLists().size() > 0, "PLAYER_INFO data unavailable");
    require(manager.createPacket(PacketType.Play.Server.PLAYER_INFO_REMOVE).getUUIDLists().size() > 0,
        "PLAYER_INFO_REMOVE uuid list unavailable");
    PacketContainer spawn = manager.createPacket(PacketType.Play.Server.SPAWN_ENTITY);
    require(spawn.getIntegers().size() > 0, "SPAWN_ENTITY id unavailable");
    require(spawn.getUUIDs().size() > 0, "SPAWN_ENTITY uuid unavailable");
    require(spawn.getEntityTypeModifier().size() > 0, "SPAWN_ENTITY type unavailable");
    require(spawn.getDoubles().size() >= 3, "SPAWN_ENTITY coordinates unavailable");
    require(manager.createPacket(PacketType.Play.Server.ENTITY_DESTROY).getIntLists().size() > 0,
        "ENTITY_DESTROY ids unavailable");
    require(manager.createPacket(PacketType.Play.Server.ENTITY_HEAD_ROTATION).getBytes().size() > 0,
        "ENTITY_HEAD_ROTATION yaw unavailable");
    require(manager.createPacket(PacketType.Play.Server.ENTITY_LOOK).getBytes().size() >= 2,
        "ENTITY_LOOK rotation unavailable");
    require(manager.createPacket(PacketType.Play.Server.ENTITY_TELEPORT).getDoubles().size() >= 3,
        "ENTITY_TELEPORT coordinates unavailable");
    PacketContainer team = manager.createPacket(PacketType.Play.Server.SCOREBOARD_TEAM);
    require(team.getStrings().size() > 0, "SCOREBOARD_TEAM name unavailable");
    require(team.getIntegers().size() > 0, "SCOREBOARD_TEAM mode unavailable");
    require(team.getOptionalTeamParameters().size() > 0, "SCOREBOARD_TEAM parameters unavailable");
    require(team.getSpecificModifier(Collection.class).size() > 0, "SCOREBOARD_TEAM players unavailable");
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
    session.updateLocation(next);
    PacketContainer packet = manager.createPacket(PacketType.Play.Server.ENTITY_TELEPORT);
    packet.getIntegers().writeSafely(0, session.entityId());
    packet.getDoubles().writeSafely(0, next.getX());
    packet.getDoubles().writeSafely(1, next.getY());
    packet.getDoubles().writeSafely(2, next.getZ());
    packet.getBytes().writeSafely(0, angleByte(yawToward(next, lookAt)));
    packet.getBytes().writeSafely(1, angleByte(pitchToward(next, lookAt)));
    packet.getBooleans().writeSafely(0, true);
    send(viewer, packet);
    sendRotation(viewer, session, lookAt);
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
}
