package com.realfiction.realcore.halloween;

import java.util.Optional;
import java.util.UUID;
import org.bukkit.Location;

public interface HerobrineAppearanceHandle {
  UUID sightingId();

  UUID viewerUuid();

  String backend();

  Location location();

  void updateLocation(Location location);

  void face(Location target);

  default void stepAwayFrom(Location target) {
  }

  void despawn(String reason);

  boolean active();

  default Optional<UUID> bukkitEntityUuid() {
    return Optional.empty();
  }
}
