package com.realfiction.realcore.scheduler;

import java.util.concurrent.CompletableFuture;
import org.bukkit.Location;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

public interface RealCoreScheduler extends AutoCloseable {
  String name();

  boolean folia();

  /** Runs non-world/non-entity work asynchronously. */
  void runAsync(Runnable task);

  ScheduledTaskHandle runAsyncRepeating(Runnable task, long initialDelaySeconds, long periodSeconds);

  /**
   * Runs a synchronous repeating task on the global/main region. Use this for
   * world/server-state work such as scoreboard ticks. Delays are in ticks.
   */
  ScheduledTaskHandle runGlobalRepeating(Runnable task, long initialDelayTicks, long periodTicks);

  void runGlobal(Runnable task);

  /**
   * Runs a one-shot synchronous task on the global/main region after a tick delay.
   * Paper/Folia schedulers honor {@code delayTicks}; other implementations may run immediately.
   */
  default ScheduledTaskHandle runGlobalLater(Runnable task, long delayTicks) {
    runGlobal(task);
    return () -> {
    };
  }

  /**
   * Runs world/location work on the owning region where available. Use this for
   * block checks, entity spawns, entity removal, and other location-bound work.
   */
  default void runAt(Location location, Runnable task) {
    runGlobal(task);
  }

  /** Runs location-bound work after a tick delay. */
  default ScheduledTaskHandle runAtLater(Location location, Runnable task, long delayTicks) {
    return runGlobalLater(task, delayTicks);
  }

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
