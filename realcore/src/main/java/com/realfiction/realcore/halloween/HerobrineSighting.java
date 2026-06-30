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
  private final UUID entityUuid;
  private final Instant createdAt;
  private final Instant vanishAt;
  private final boolean miningIntent;
  private final boolean silhouette;
  private final AtomicReference<Location> location;
  private final AtomicBoolean vanishing = new AtomicBoolean(false);
  private final AtomicBoolean lightningOmenScheduled = new AtomicBoolean(false);
  private final AtomicBoolean omenMarkerScheduled = new AtomicBoolean(false);
  private final AtomicLong lastSoundAtMillis = new AtomicLong(0);

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
    this.sightingId = sightingId;
    this.playerUuid = playerUuid;
    this.playerName = playerName == null ? "" : playerName;
    this.entityUuid = entityUuid;
    this.createdAt = createdAt;
    this.vanishAt = vanishAt;
    this.miningIntent = miningIntent;
    this.silhouette = silhouette;
    this.location = new AtomicReference<>(location == null ? null : location.clone());
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

  public UUID entityUuid() {
    return entityUuid;
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

  public Location location() {
    Location value = location.get();
    return value == null ? null : value.clone();
  }

  public void updateLocation(Location next) {
    if (next != null) {
      location.set(next.clone());
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
}
