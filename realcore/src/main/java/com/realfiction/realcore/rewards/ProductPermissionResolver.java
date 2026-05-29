package com.realfiction.realcore.rewards;

import com.realfiction.realcore.api.dto.RewardPayload;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.cosmetics.CosmeticsConstants;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.logging.Logger;

/** Resolves store product slugs to LuckPerms permissions without new config keys. */
public final class ProductPermissionResolver {
  private static final Map<String, String> BUILTIN_SLUGS = Map.ofEntries(
      Map.entry("realpets-pack", CosmeticsConstants.PERM_PETS),
      Map.entry("particle-vault", CosmeticsConstants.PERM_PARTICLES),
      Map.entry("username-colors", CosmeticsConstants.PERM_USERNAME_COLORS),
      Map.entry("lobby-flight", CosmeticsConstants.PERM_LOBBY_FLIGHT),
      Map.entry("cosmetic-atelier", CosmeticsConstants.PERM_ATELIER)
  );

  private ProductPermissionResolver() {
  }

  public static ResolveResult resolve(RealCoreConfig config, RewardPayload reward, Logger logger) {
    if (reward == null || reward.delivery == null) {
      return ResolveResult.none();
    }
    String slug = reward.delivery.productSlug;
    if (slug == null || slug.isBlank()) {
      return ResolveResult.none();
    }
    String normalized = slug.trim().toLowerCase(Locale.ROOT);

    String fromConfig = firstConfigPermission(config, slug, normalized);
    if (fromConfig != null) {
      return ResolveResult.mapped(normalized, fromConfig, Source.CONFIG);
    }

    String builtin = BUILTIN_SLUGS.get(normalized);
    if (builtin != null) {
      return ResolveResult.mapped(normalized, builtin, Source.BUILTIN);
    }

    String fromPayload = permissionFromPayload(reward);
    if (fromPayload != null) {
      return ResolveResult.mapped(normalized, fromPayload, Source.PAYLOAD_LUCKPERMS);
    }

    if (logger != null) {
      logger.warning("Unknown product slug '" + slug + "' for rewardId=" + reward.id
          + " rewardKey=" + reward.rewardKey + "; no permission mapped.");
    }
    return ResolveResult.unknown(normalized);
  }

  public static Map<String, String> effectiveMappings(RealCoreConfig config) {
    Map<String, String> merged = new LinkedHashMap<>(BUILTIN_SLUGS);
    merged.putAll(config.productPermissions());
    return Map.copyOf(merged);
  }

  private static String firstConfigPermission(RealCoreConfig config, String slug, String normalized) {
    for (String key : List.of(slug.trim(), normalized)) {
      String value = config.productPermissions().get(key);
      if (value != null && !value.isBlank()) {
        return value.trim();
      }
    }
    return null;
  }

  private static String permissionFromPayload(RewardPayload reward) {
    if (reward.delivery.luckPerms != null && reward.delivery.luckPerms.permission != null
        && !reward.delivery.luckPerms.permission.isBlank()) {
      return reward.delivery.luckPerms.permission.trim();
    }
    if (reward.entitlement != null && reward.entitlement.key != null
        && reward.entitlement.key.startsWith("realfiction.")) {
      return reward.entitlement.key.trim();
    }
    return null;
  }

  public enum Source {
    CONFIG,
    BUILTIN,
    PAYLOAD_LUCKPERMS,
    UNKNOWN,
    NONE
  }

  public record ResolveResult(String productSlug, String permission, Source source) {
    static ResolveResult none() {
      return new ResolveResult("", "", Source.NONE);
    }

    static ResolveResult mapped(String slug, String permission, Source source) {
      return new ResolveResult(slug, permission, source);
    }

    static ResolveResult unknown(String slug) {
      return new ResolveResult(slug, "", Source.UNKNOWN);
    }

    boolean hasPermission() {
      return permission != null && !permission.isBlank();
    }
  }
}
