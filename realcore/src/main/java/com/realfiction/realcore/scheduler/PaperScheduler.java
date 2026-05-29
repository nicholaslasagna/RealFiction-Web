package com.realfiction.realcore.scheduler;

import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.bukkit.scheduler.BukkitTask;

final class PaperScheduler implements RealCoreScheduler {
  private final Plugin plugin;
  private final Set<BukkitTask> tasks = ConcurrentHashMap.newKeySet();

  PaperScheduler(Plugin plugin) {
    this.plugin = plugin;
  }

  @Override
  public String name() {
    return "Paper/Purpur";
  }

  @Override
  public boolean folia() {
    return false;
  }

  @Override
  public void runAsync(Runnable task) {
    Bukkit.getScheduler().runTaskAsynchronously(plugin, task);
  }

  @Override
  public ScheduledTaskHandle runAsyncRepeating(Runnable task, long initialDelaySeconds, long periodSeconds) {
    BukkitTask bukkitTask = Bukkit.getScheduler().runTaskTimerAsynchronously(
        plugin,
        task,
        secondsToTicks(initialDelaySeconds),
        secondsToTicks(periodSeconds)
    );
    tasks.add(bukkitTask);
    return () -> {
      bukkitTask.cancel();
      tasks.remove(bukkitTask);
    };
  }

  @Override
  public ScheduledTaskHandle runGlobalRepeating(Runnable task, long initialDelayTicks, long periodTicks) {
    BukkitTask bukkitTask = Bukkit.getScheduler().runTaskTimer(
        plugin,
        task,
        Math.max(1L, initialDelayTicks),
        Math.max(1L, periodTicks)
    );
    tasks.add(bukkitTask);
    return () -> {
      bukkitTask.cancel();
      tasks.remove(bukkitTask);
    };
  }

  @Override
  public void runGlobal(Runnable task) {
    Bukkit.getScheduler().runTask(plugin, task);
  }

  @Override
  public ScheduledTaskHandle runGlobalLater(Runnable task, long delayTicks) {
    BukkitTask bukkitTask = Bukkit.getScheduler().runTaskLater(
        plugin,
        task,
        Math.max(0L, delayTicks)
    );
    tasks.add(bukkitTask);
    return () -> {
      bukkitTask.cancel();
      tasks.remove(bukkitTask);
    };
  }

  @Override
  public void runForPlayer(Player player, Runnable task) {
    runGlobal(task);
  }

  @Override
  public void runForPlayerLater(Player player, Runnable task, long delayTicks) {
    Bukkit.getScheduler().runTaskLater(plugin, task, Math.max(1L, delayTicks));
  }

  @Override
  public CompletableFuture<Void> dispatchConsoleCommand(String command) {
    CompletableFuture<Void> future = new CompletableFuture<>();
    runGlobal(() -> {
      try {
        boolean accepted = Bukkit.dispatchCommand(Bukkit.getConsoleSender(), command);
        if (!accepted) {
          future.completeExceptionally(new IllegalStateException("Command was not accepted: " + command));
          return;
        }
        future.complete(null);
      } catch (Exception error) {
        future.completeExceptionally(error);
      }
    });
    return future;
  }

  @Override
  public void close() {
    tasks.forEach(BukkitTask::cancel);
    tasks.clear();
    Bukkit.getScheduler().cancelTasks(plugin);
  }

  private long secondsToTicks(long seconds) {
    return Math.max(1L, seconds) * 20L;
  }
}
