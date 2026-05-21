package com.realfiction.realcore.scheduler;

import java.util.concurrent.CompletableFuture;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

public interface RealCoreScheduler extends AutoCloseable {
  String name();

  boolean folia();

  ScheduledTaskHandle runAsyncRepeating(Runnable task, long initialDelaySeconds, long periodSeconds);

  void runGlobal(Runnable task);

  void runForPlayer(Player player, Runnable task);

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
