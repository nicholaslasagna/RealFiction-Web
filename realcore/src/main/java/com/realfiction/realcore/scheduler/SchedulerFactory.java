package com.realfiction.realcore.scheduler;

import org.bukkit.plugin.Plugin;

public final class SchedulerFactory {
  private SchedulerFactory() {
  }

  public static RealCoreScheduler create(Plugin plugin) {
    if (isFolia()) {
      plugin.getLogger().info("RealCore detected Folia scheduler APIs.");
      return new FoliaScheduler(plugin);
    }

    plugin.getLogger().info("RealCore using Paper/Purpur scheduler APIs.");
    return new PaperScheduler(plugin);
  }

  static boolean isFolia() {
    return isClassPresent("io.papermc.paper.threadedregions.RegionizedServer", SchedulerFactory.class.getClassLoader());
  }

  static boolean isClassPresent(String className, ClassLoader classLoader) {
    try {
      Class.forName(className, false, classLoader);
      return true;
    } catch (ClassNotFoundException | LinkageError ignored) {
      return false;
    }
  }
}
