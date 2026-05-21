package com.realfiction.realcore.scheduler;

import java.util.concurrent.CompletableFuture;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

public interface RealCoreScheduler extends AutoCloseable {
  String name();

  boolean folia();

  ScheduledTaskHandle runAsyncRepeating(Runnable task, long initialDelaySeconds, long periodSeconds);

  /**
   * Runs a synchronous repeating task on the global/main region. Use this for
   * world/server-state work such as scoreboard ticks. Delays are in ticks.
   */
  ScheduledTaskHandle runGlobalRepeating(Runnable task, long initialDelayTicks, long periodTicks);

  void runGlobal(Runnable task);

  void runForPlayer(Player player, Runnable task);

  /** Runs a player-context task after a tick delay (Folia: player scheduler). */
  void runForPlayerLater(Player player, Runnable task, long delayTicks);

  CompletableFuture<Void> dispatchConsoleCommand(String command);

  default void send(CommandSender sender, String message) {
    if (sender instanceof Player player) {
      runForPlayer(player, () -> player.sendMessage(message));
      return;
    }
    runGlobal(() -> sender.sendMessage(message));
  }

  @Override
  void close();
}
