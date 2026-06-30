package com.realfiction.realcore.halloween;

import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import org.bukkit.Location;

public final class PacketNpcSession {
  private final UUID sessionId;
  private final UUID viewerUuid;
  private final UUID profileUuid;
  private final int entityId;
  private final long serviceGeneration;
  private final long sessionGeneration;
  private final String teamName;
  private final String profileName;
  private final AtomicBoolean active = new AtomicBoolean(true);
  private final AtomicBoolean tabListed = new AtomicBoolean(false);
  private volatile Location location;

  public PacketNpcSession(
      UUID sessionId,
      UUID viewerUuid,
      UUID profileUuid,
      int entityId,
      long serviceGeneration,
      long sessionGeneration,
      String teamName,
      String profileName,
      Location location
  ) {
    this.sessionId = sessionId;
    this.viewerUuid = viewerUuid;
    this.profileUuid = profileUuid;
    this.entityId = entityId;
    this.serviceGeneration = serviceGeneration;
    this.sessionGeneration = sessionGeneration;
    this.teamName = teamName == null ? "" : teamName;
    this.profileName = profileName == null ? "Herobrine" : profileName;
    this.location = location == null ? null : location.clone();
  }

  public UUID sessionId() {
    return sessionId;
  }

  public UUID viewerUuid() {
    return viewerUuid;
  }

  public UUID profileUuid() {
    return profileUuid;
  }

  public int entityId() {
    return entityId;
  }

  public long serviceGeneration() {
    return serviceGeneration;
  }

  public long sessionGeneration() {
    return sessionGeneration;
  }

  public String teamName() {
    return teamName;
  }

  public String profileName() {
    return profileName;
  }

  public Location location() {
    Location current = location;
    return current == null ? null : current.clone();
  }

  public void updateLocation(Location next) {
    if (next != null) {
      location = next.clone();
    }
  }

  public boolean active() {
    return active.get();
  }

  public boolean deactivate() {
    return active.compareAndSet(true, false);
  }

  public boolean tabListed() {
    return tabListed.get();
  }

  public void markTabListed() {
    tabListed.set(true);
  }

  public boolean clearTabListed() {
    return tabListed.getAndSet(false);
  }

  public boolean accepts(long serviceGeneration, long sessionGeneration) {
    return active()
        && this.serviceGeneration == serviceGeneration
        && this.sessionGeneration == sessionGeneration;
  }
}
