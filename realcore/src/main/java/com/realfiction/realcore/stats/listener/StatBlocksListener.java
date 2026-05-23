package com.realfiction.realcore.stats.listener;

import com.realfiction.realcore.stats.producer.BlockStatProducer;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;

/**
 * Bukkit listener for block-break events. Volume can be high; the writer
 * aggregates per (statKey, player) so each flush window produces a single
 * event per player regardless of how many breaks happened.
 *
 * <p>{@code ignoreCancelled = true} so cancelled breaks (WorldGuard, claims,
 * lobby protection, ...) never count.
 */
public final class StatBlocksListener implements Listener {
  private volatile BlockStatProducer producer;

  public StatBlocksListener(BlockStatProducer producer) {
    this.producer = producer;
  }

  public void setProducer(BlockStatProducer producer) {
    this.producer = producer;
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onBlockBreak(BlockBreakEvent event) {
    BlockStatProducer current = producer;
    if (current == null) {
      return;
    }
    Player player = event.getPlayer();
    if (player == null) {
      return;
    }
    current.recordBreak(player.getUniqueId(), player.getName());
  }
}
