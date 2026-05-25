package com.realfiction.realcore.luckperms;

import com.realfiction.realcore.api.dto.RewardPayload;
import java.lang.reflect.Constructor;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.logging.Level;
import org.bukkit.plugin.Plugin;

public interface LuckPermsService {
  static LuckPermsService create(Plugin plugin) {
    if (!plugin.getServer().getPluginManager().isPluginEnabled("LuckPerms")) {
      plugin.getLogger().warning("LuckPerms not found; permission/cosmetic grants disabled.");
      return new UnavailableLuckPermsService("LuckPerms is not installed.");
    }

    try {
      Class<?> type = Class.forName("com.realfiction.realcore.luckperms.LuckPermsApiService");
      Constructor<?> constructor = type.getConstructor(Plugin.class);
      return (LuckPermsService) constructor.newInstance(plugin);
    } catch (ReflectiveOperationException | LinkageError error) {
      plugin.getLogger().log(Level.WARNING, "LuckPerms could not be loaded; permission/cosmetic grants disabled.", error);
      return new UnavailableLuckPermsService("LuckPerms could not be loaded.");
    }
  }

  boolean available();

  CompletableFuture<Void> apply(RewardPayload reward);

  CompletableFuture<Void> grantPermission(UUID uuid, String permission, Duration duration);

  CompletableFuture<Void> revokePermission(UUID uuid, String permission);
}

final class UnavailableLuckPermsService implements LuckPermsService {
  private final String reason;

  UnavailableLuckPermsService(String reason) {
    this.reason = reason == null || reason.isBlank() ? "LuckPerms is not available." : reason;
  }

  @Override
  public boolean available() {
    return false;
  }

  @Override
  public CompletableFuture<Void> apply(RewardPayload reward) {
    return unavailable();
  }

  @Override
  public CompletableFuture<Void> grantPermission(UUID uuid, String permission, Duration duration) {
    return unavailable();
  }

  @Override
  public CompletableFuture<Void> revokePermission(UUID uuid, String permission) {
    return unavailable();
  }

  private CompletableFuture<Void> unavailable() {
    return CompletableFuture.failedFuture(new IllegalStateException(reason));
  }
}
