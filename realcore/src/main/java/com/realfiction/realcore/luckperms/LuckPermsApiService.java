package com.realfiction.realcore.luckperms;

import com.realfiction.realcore.api.dto.RewardPayload;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.luckperms.api.LuckPerms;
import net.luckperms.api.LuckPermsProvider;
import net.luckperms.api.model.data.DataMutateResult;
import net.luckperms.api.model.user.User;
import net.luckperms.api.node.Node;
import net.luckperms.api.node.NodeType;
import net.luckperms.api.node.types.InheritanceNode;
import net.luckperms.api.node.types.PermissionNode;
import net.luckperms.api.node.types.PrefixNode;
import net.luckperms.api.node.types.SuffixNode;
import org.bukkit.plugin.Plugin;

public final class LuckPermsApiService implements LuckPermsService {
  private final Plugin plugin;
  private LuckPerms luckPerms;

  public LuckPermsApiService(Plugin plugin) {
    this.plugin = plugin;
    try {
      this.luckPerms = LuckPermsProvider.get();
    } catch (IllegalStateException ignored) {
      this.luckPerms = null;
    }
  }

  @Override
  public boolean available() {
    return luckPerms != null;
  }

  @Override
  public CompletableFuture<Void> apply(RewardPayload reward) {
    if (luckPerms == null) {
      return CompletableFuture.failedFuture(new IllegalStateException("LuckPerms is not available."));
    }

    UUID uuid = parseUuid(reward.minecraftUuid());
    if (uuid == null) {
      return CompletableFuture.failedFuture(new IllegalArgumentException("Reward target is missing a valid Minecraft UUID."));
    }

    RewardPayload.LuckPermsPayload payload = reward.delivery == null ? null : reward.delivery.luckPerms;
    if (payload == null) {
      return CompletableFuture.completedFuture(null);
    }

    boolean revoke = "revoke".equalsIgnoreCase(reward.action());
    Duration duration = revoke ? null : durationFor(reward);

    return luckPerms.getUserManager().loadUser(uuid).thenCompose(user -> {
      if (payload.group != null && !payload.group.isBlank()) {
        if (revoke) {
          removeGroup(user, payload.group);
        } else {
          user.data().add(buildGroupNode(payload.group, duration));
        }
      }

      if (payload.permission != null && !payload.permission.isBlank()) {
        if (revoke) {
          removePermission(user, payload.permission);
        } else {
          user.data().add(buildPermissionNode(payload.permission, duration));
        }
      }

      if (payload.prefix != null && !payload.prefix.isBlank()) {
        if (revoke) {
          removeByPrefix(user, "prefix.");
        } else {
          user.data().add(buildPrefixNode(payload.prefix, duration));
        }
      }

      if (payload.suffix != null && !payload.suffix.isBlank()) {
        if (revoke) {
          removeByPrefix(user, "suffix.");
        } else {
          user.data().add(buildSuffixNode(payload.suffix, duration));
        }
      }

      return luckPerms.getUserManager().saveUser(user);
    });
  }

  @Override
  public CompletableFuture<Void> grantPermission(UUID uuid, String permission, Duration duration) {
    if (luckPerms == null) {
      return CompletableFuture.failedFuture(new IllegalStateException("LuckPerms is not available."));
    }
    return luckPerms.getUserManager().loadUser(uuid).thenCompose(user -> {
      user.data().add(buildPermissionNode(permission, duration));
      return luckPerms.getUserManager().saveUser(user);
    });
  }

  @Override
  public CompletableFuture<Void> revokePermission(UUID uuid, String permission) {
    if (luckPerms == null) {
      return CompletableFuture.failedFuture(new IllegalStateException("LuckPerms is not available."));
    }
    return luckPerms.getUserManager().loadUser(uuid).thenCompose(user -> {
      removePermission(user, permission);
      return luckPerms.getUserManager().saveUser(user);
    });
  }

  private Node buildGroupNode(String group, Duration duration) {
    InheritanceNode.Builder builder = InheritanceNode.builder(group);
    if (duration != null && !duration.isNegative() && !duration.isZero()) {
      builder.expiry(duration);
    }
    return builder.build();
  }

  private Node buildPermissionNode(String permission, Duration duration) {
    PermissionNode.Builder builder = PermissionNode.builder(permission);
    if (duration != null && !duration.isNegative() && !duration.isZero()) {
      builder.expiry(duration);
    }
    return builder.build();
  }

  private Node buildPrefixNode(String prefix, Duration duration) {
    PrefixNode.Builder builder = PrefixNode.builder(prefix, 100);
    if (duration != null && !duration.isNegative() && !duration.isZero()) {
      builder.expiry(duration);
    }
    return builder.build();
  }

  private Node buildSuffixNode(String suffix, Duration duration) {
    SuffixNode.Builder builder = SuffixNode.builder(suffix, 100);
    if (duration != null && !duration.isNegative() && !duration.isZero()) {
      builder.expiry(duration);
    }
    return builder.build();
  }

  private void removeGroup(User user, String group) {
    String expected = "group." + group.toLowerCase(Locale.ROOT);
    user.getNodes(NodeType.INHERITANCE).stream()
        .filter(node -> node.getKey().equalsIgnoreCase(expected))
        .forEach(node -> user.data().remove(node));
  }

  private void removePermission(User user, String permission) {
    user.getNodes().stream()
        .filter(node -> node.getKey().equalsIgnoreCase(permission))
        .forEach(node -> {
          DataMutateResult ignored = user.data().remove(node);
        });
  }

  private void removeByPrefix(User user, String prefix) {
    user.getNodes().stream()
        .filter(node -> node.getKey().toLowerCase(Locale.ROOT).startsWith(prefix))
        .forEach(node -> user.data().remove(node));
  }

  private Duration durationFor(RewardPayload reward) {
    if (reward.entitlement != null && reward.entitlement.expiresAt != null) {
      try {
        Duration duration = Duration.between(Instant.now(), Instant.parse(reward.entitlement.expiresAt));
        if (!duration.isNegative() && !duration.isZero()) {
          return duration;
        }
      } catch (RuntimeException ignored) {
        plugin.getLogger().warning("Could not parse reward expiry for rewardId=" + reward.id);
      }
    }

    if (reward.delivery != null && reward.delivery.durationDays != null && reward.delivery.durationDays > 0) {
      return Duration.ofDays(reward.delivery.durationDays);
    }

    return null;
  }

  private UUID parseUuid(String value) {
    if (value == null || value.isBlank()) {
      return null;
    }
    String trimmed = value.trim();
    if (trimmed.length() == 32) {
      trimmed = trimmed.replaceFirst(
          "([0-9a-fA-F]{8})([0-9a-fA-F]{4})([0-9a-fA-F]{4})([0-9a-fA-F]{4})([0-9a-fA-F]{12})",
          "$1-$2-$3-$4-$5"
      );
    }
    try {
      return UUID.fromString(trimmed);
    } catch (IllegalArgumentException ignored) {
      return null;
    }
  }
}
