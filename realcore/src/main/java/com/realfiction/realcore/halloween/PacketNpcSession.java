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

  // Debug packet-send trace: which clientbound phases were actually dispatched for this
  // session. Server-side truth only — it cannot prove the client rendered anything.
  private volatile boolean teamSent;
  private volatile boolean playerInfoAddSent;
  private volatile boolean spawnPacketSent;
  private volatile boolean metadataSent;
  private volatile boolean rotationSent;
  private volatile boolean tabRemoveSent;
  private volatile boolean destroySent;

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

  public void markTeamSent() {
    teamSent = true;
  }

  public void markPlayerInfoAddSent() {
    playerInfoAddSent = true;
  }

  public void markSpawnPacketSent() {
    spawnPacketSent = true;
  }

  public void markMetadataSent() {
    metadataSent = true;
  }

  public void markRotationSent() {
    rotationSent = true;
  }

  public void markTabRemoveSent() {
    tabRemoveSent = true;
  }

  public void markDestroySent() {
    destroySent = true;
  }

  public String traceSummary() {
    return "playerInfoAddSent=" + playerInfoAddSent
        + " spawnPacketSent=" + spawnPacketSent
        + " metadataSent=" + metadataSent
        + " rotationSent=" + rotationSent
        + " scoreboardTeamSent=" + teamSent
        + " tabRemoveSent=" + tabRemoveSent
        + " destroySent=" + destroySent
        + " fakeEntityId=" + entityId
        + " fakeProfileUuid=" + profileUuid
        + " spawnEntityType=PLAYER";
  }
}
