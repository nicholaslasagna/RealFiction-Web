package com.realfiction.realcore.halloween;

import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.bukkit.Location;

public final class HerobrineSighting {
  private final UUID sightingId;
  private final UUID playerUuid;
  private final String playerName;
  private final HerobrineAppearanceHandle appearance;
  private final Instant createdAt;
  private final Instant vanishAt;
  private final boolean miningIntent;
  private final boolean silhouette;
  private final boolean windowStalk;
  private final AtomicReference<Location> location;
  private final AtomicBoolean vanishing = new AtomicBoolean(false);
  private final AtomicBoolean lightningOmenScheduled = new AtomicBoolean(false);
  private final AtomicBoolean omenMarkerScheduled = new AtomicBoolean(false);
  private final AtomicLong lastSoundAtMillis = new AtomicLong(0);
  private final AtomicReference<Instant> proximityEnteredAt = new AtomicReference<>();

  public HerobrineSighting(
      UUID sightingId,
      UUID playerUuid,
      String playerName,
      HerobrineAppearanceHandle appearance,
      Instant createdAt,
      Instant vanishAt,
      boolean miningIntent,
      boolean silhouette,
      Location location
  ) {
    this(sightingId, playerUuid, playerName, appearance, createdAt, vanishAt, miningIntent, silhouette, false, location);
  }

  public HerobrineSighting(
      UUID sightingId,
      UUID playerUuid,
      String playerName,
      HerobrineAppearanceHandle appearance,
      Instant createdAt,
      Instant vanishAt,
      boolean miningIntent,
      boolean silhouette,
      boolean windowStalk,
      Location location
  ) {
    this.sightingId = sightingId;
    this.playerUuid = playerUuid;
    this.playerName = playerName == null ? "" : playerName;
    this.appearance = appearance;
    this.createdAt = createdAt;
    this.vanishAt = vanishAt;
    this.miningIntent = miningIntent;
    this.silhouette = silhouette;
    this.windowStalk = windowStalk;
    this.location = new AtomicReference<>(location == null ? null : location.clone());
  }

  public HerobrineSighting(
      UUID sightingId,
      UUID playerUuid,
      String playerName,
      UUID entityUuid,
      Instant createdAt,
      Instant vanishAt,
      boolean miningIntent,
      boolean silhouette,
      Location location
  ) {
    this(
        sightingId,
        playerUuid,
        playerName,
        new StaticAppearanceHandle(sightingId, playerUuid, entityUuid, location),
        createdAt,
        vanishAt,
        miningIntent,
        silhouette,
        false,
        location
    );
  }

  public UUID sightingId() {
    return sightingId;
  }

  public UUID playerUuid() {
    return playerUuid;
  }

  public String playerName() {
    return playerName;
  }

  public HerobrineAppearanceHandle appearance() {
    return appearance;
  }

  public UUID entityUuid() {
    return appearance == null ? null : appearance.bukkitEntityUuid().orElse(null);
  }

  public Instant createdAt() {
    return createdAt;
  }

  public Instant vanishAt() {
    return vanishAt;
  }

  public boolean miningIntent() {
    return miningIntent;
  }

  public boolean silhouette() {
    return silhouette;
  }

  public boolean windowStalk() {
    return windowStalk;
  }

  public Location location() {
    Location value = location.get();
    return value == null ? null : value.clone();
  }

  public void updateLocation(Location next) {
    if (next != null) {
      location.set(next.clone());
      if (appearance != null) {
        appearance.updateLocation(next);
      }
    }
  }

  public boolean markVanishing() {
    return vanishing.compareAndSet(false, true);
  }

  public boolean vanishing() {
    return vanishing.get();
  }

  public boolean markLightningOmenScheduled() {
    return lightningOmenScheduled.compareAndSet(false, true);
  }

  public boolean markOmenMarkerScheduled() {
    return omenMarkerScheduled.compareAndSet(false, true);
  }

  public boolean soundCooldownElapsed(long nowMillis, long cooldownMillis) {
    long last = lastSoundAtMillis.get();
    if (last > 0 && nowMillis - last < cooldownMillis) {
      return false;
    }
    return lastSoundAtMillis.compareAndSet(last, nowMillis);
  }

  public Instant proximityEnteredAt() {
    return proximityEnteredAt.get();
  }

  public void markProximityEnteredAt(Instant now) {
    proximityEnteredAt.compareAndSet(null, now);
  }

  public void clearProximityEnteredAt() {
    proximityEnteredAt.set(null);
  }

  private static final class StaticAppearanceHandle implements HerobrineAppearanceHandle {
    private final UUID sightingId;
    private final UUID viewerUuid;
    private final UUID entityUuid;
    private volatile Location location;
    private volatile boolean active = true;

    private StaticAppearanceHandle(UUID sightingId, UUID viewerUuid, UUID entityUuid, Location location) {
      this.sightingId = sightingId;
      this.viewerUuid = viewerUuid;
      this.entityUuid = entityUuid;
      this.location = location == null ? null : location.clone();
    }

    @Override
    public UUID sightingId() {
      return sightingId;
    }

    @Override
    public UUID viewerUuid() {
      return viewerUuid;
    }

    @Override
    public String backend() {
      return HerobrineAppearanceConfig.MODE_ARMOR_STAND;
    }

    @Override
    public Location location() {
      Location value = location;
      return value == null ? null : value.clone();
    }

    @Override
    public void updateLocation(Location location) {
      if (location != null) {
        this.location = location.clone();
      }
    }

    @Override
    public void face(Location target) {
    }

    @Override
    public void despawn(String reason) {
      active = false;
    }

    @Override
    public boolean active() {
      return active;
    }

    @Override
    public java.util.Optional<UUID> bukkitEntityUuid() {
      return java.util.Optional.ofNullable(entityUuid);
    }
  }
}
