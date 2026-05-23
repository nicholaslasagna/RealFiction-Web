package com.realfiction.realcore.stats.listener;

import com.realfiction.realcore.stats.producer.KillStatProducer;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.PlayerDeathEvent;

/**
 * Bukkit listener for kills/deaths. Captures victim and (optional) killer on
 * the event thread and hands UUIDs + names to the testable producer. No DB or
 * network access happens here - the producer calls
 * {@link com.realfiction.realcore.stats.NetworkStatWriter#increment} which only
 * touches a ConcurrentHashMap.
 */
public final class StatKillsListener implements Listener {
  // volatile so a reload that swaps the producer is visible immediately to any
  // event-thread reader, without coordinating with Bukkit's listener registry.
  private volatile KillStatProducer producer;

  public StatKillsListener(KillStatProducer producer) {
    this.producer = producer;
  }

  public void setProducer(KillStatProducer producer) {
    this.producer = producer;
  }

  // MONITOR so we record the death exactly once after every other plugin has
  // settled. ignoreCancelled is irrelevant for PlayerDeathEvent (it isn't
  // Cancellable) but the priority avoids surprising mid-pipeline interactions.
  @EventHandler(priority = EventPriority.MONITOR)
  public void onPlayerDeath(PlayerDeathEvent event) {
    KillStatProducer current = producer;
    if (current == null) {
      return;
    }
    Player victim = event.getEntity();
    if (victim == null) {
      return;
    }
    Player killer = victim.getKiller();
    current.recordDeath(
        victim.getUniqueId(),
        victim.getName(),
        killer == null ? null : killer.getUniqueId(),
        killer == null ? null : killer.getName());
  }
}
