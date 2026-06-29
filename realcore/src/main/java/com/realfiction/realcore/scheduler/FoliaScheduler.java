package com.realfiction.realcore.scheduler;

import io.papermc.paper.threadedregions.scheduler.ScheduledTask;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

final class FoliaScheduler implements RealCoreScheduler {
  private final Plugin plugin;
  private final Set<ScheduledTask> tasks = ConcurrentHashMap.newKeySet();

  FoliaScheduler(Plugin plugin) {
    this.plugin = plugin;
  }

  @Override
  public String name() {
    return "Folia";
  }

  @Override
  public boolean folia() {
    return true;
  }

  @Override
  public void runAsync(Runnable task) {
    Bukkit.getAsyncScheduler().runNow(plugin, ignored -> task.run());
  }

  @Override
  public ScheduledTaskHandle runAsyncRepeating(Runnable task, long initialDelaySeconds, long periodSeconds) {
    ScheduledTask scheduledTask = Bukkit.getAsyncScheduler().runAtFixedRate(
        plugin,
        ignored -> task.run(),
        initialDelaySeconds,
        periodSeconds,
        TimeUnit.SECONDS
    );
    tasks.add(scheduledTask);
    return () -> {
      scheduledTask.cancel();
      tasks.remove(scheduledTask);
    };
  }

  @Override
  public ScheduledTaskHandle runGlobalRepeating(Runnable task, long initialDelayTicks, long periodTicks) {
    ScheduledTask scheduledTask = Bukkit.getGlobalRegionScheduler().runAtFixedRate(
        plugin,
        ignored -> task.run(),
        Math.max(1L, initialDelayTicks),
        Math.max(1L, periodTicks)
    );
    tasks.add(scheduledTask);
    return () -> {
      scheduledTask.cancel();
      tasks.remove(scheduledTask);
    };
  }

  @Override
  public void runGlobal(Runnable task) {
    Bukkit.getGlobalRegionScheduler().run(plugin, ignored -> task.run());
  }

  @Override
  public ScheduledTaskHandle runGlobalLater(Runnable task, long delayTicks) {
    ScheduledTask scheduledTask = Bukkit.getGlobalRegionScheduler().runDelayed(
        plugin,
        ignored -> task.run(),
        Math.max(0L, delayTicks)
    );
    tasks.add(scheduledTask);
    return () -> {
      scheduledTask.cancel();
      tasks.remove(scheduledTask);
    };
  }

  @Override
  public void runAt(Location location, Runnable task) {
    if (location == null || location.getWorld() == null) {
      runGlobal(task);
      return;
    }
    Bukkit.getRegionScheduler().run(plugin, location, ignored -> task.run());
  }

  @Override
  public ScheduledTaskHandle runAtLater(Location location, Runnable task, long delayTicks) {
    if (location == null || location.getWorld() == null) {
      return runGlobalLater(task, delayTicks);
    }
    ScheduledTask scheduledTask = Bukkit.getRegionScheduler().runDelayed(
        plugin,
        location,
        ignored -> task.run(),
        Math.max(1L, delayTicks)
    );
    tasks.add(scheduledTask);
    return () -> {
      scheduledTask.cancel();
      tasks.remove(scheduledTask);
    };
  }

  @Override
  public void runForPlayer(Player player, Runnable task) {
    player.getScheduler().run(plugin, ignored -> task.run(), () -> {
    });
  }

  @Override
  public void runForPlayerLater(Player player, Runnable task, long delayTicks) {
    player.getScheduler().runDelayed(plugin, ignored -> task.run(), () -> {
    }, Math.max(1L, delayTicks));
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
    tasks.forEach(ScheduledTask::cancel);
    tasks.clear();
    Bukkit.getAsyncScheduler().cancelTasks(plugin);
    Bukkit.getGlobalRegionScheduler().cancelTasks(plugin);
  }
}
