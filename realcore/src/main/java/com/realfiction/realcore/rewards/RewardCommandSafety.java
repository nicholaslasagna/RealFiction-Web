package com.realfiction.realcore.rewards;

import com.realfiction.realcore.api.dto.RewardPayload;
import com.realfiction.realcore.config.RealCoreConfig;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/** Validates console reward commands and sanitizes player tokens. */
public final class RewardCommandSafety {
  private static final Pattern MINECRAFT_USERNAME = Pattern.compile("^[a-zA-Z0-9_]{1,16}$");
  private static final Set<String> BLOCKED_SUBSTRINGS = Set.of(
      ";", "|", "&&", "||", "`", "\n", "\r"
  );
  private static final Set<String> BLOCKED_COMMANDS = Set.of(
      "op ", "deop ", "stop", "reload", "rl ", "plugins", "pl ", "ban ", "pardon ",
      "kick ", "whitelist ", "save-all", "save-off", "save-on", "mv ", "sudo ",
      "execute as @a", "execute as @e", "execute as @r", "execute run op"
  );

  private RewardCommandSafety() {
  }

  public static String safeUsername(RewardPayload reward) {
    String username = reward == null ? null : reward.minecraftUsername();
    if (username != null && MINECRAFT_USERNAME.matcher(username.trim()).matches()) {
      return username.trim();
    }
    return null;
  }

  public static String safePlayerToken(RewardPayload reward) {
    String username = safeUsername(reward);
    if (username != null) {
      return username;
    }
    String uuid = reward == null ? null : reward.minecraftUuid();
    if (uuid != null && !uuid.isBlank()) {
      return uuid.trim();
    }
    return "unknown";
  }

  public static SafetyResult validateCommands(
      RealCoreConfig config,
      RewardPayload reward,
      List<String> commands
  ) {
    if (commands == null || commands.isEmpty()) {
      return SafetyResult.ok(List.of());
    }
    List<String> safe = new ArrayList<>();
    for (String raw : commands) {
      if (raw == null || raw.isBlank()) {
        continue;
      }
      String resolved = RewardCommandFormatter.applyPlaceholders(raw, reward, config.serverId());
      resolved = resolved.replace("{player}", safePlayerToken(reward))
          .replace("{username}", safePlayerToken(reward));
      SafetyResult one = validateResolved(resolved, config.allowUnsafeRewards());
      if (!one.allowed()) {
        return one;
      }
      safe.add(resolved);
    }
    return SafetyResult.ok(safe);
  }

  static SafetyResult validateResolved(String command, boolean allowUnsafeRewards) {
    String trimmed = command.trim();
    if (trimmed.isEmpty()) {
      return SafetyResult.ok(List.of());
    }
    String lower = trimmed.toLowerCase(Locale.ROOT);
    for (String blocked : BLOCKED_SUBSTRINGS) {
      if (trimmed.contains(blocked)) {
        return SafetyResult.blocked("Command contains blocked token '" + blocked + "': " + trimmed);
      }
    }
    if (!allowUnsafeRewards) {
      for (String blocked : BLOCKED_COMMANDS) {
        if (lower.startsWith(blocked) || lower.contains(" " + blocked)) {
          return SafetyResult.blocked("Unsafe command blocked (allowUnsafeRewards=false): " + trimmed);
        }
      }
      if (!matchesSafePrefix(lower)) {
        return SafetyResult.blocked("Command prefix not allowed (allowUnsafeRewards=false): " + trimmed);
      }
    }
    if (containsUnknownPlaceholder(trimmed)) {
      return SafetyResult.blocked("Command contains unknown placeholder: " + trimmed);
    }
    return SafetyResult.ok(List.of(trimmed));
  }

  private static boolean matchesSafePrefix(String lower) {
    return lower.startsWith("eco give ")
        || lower.startsWith("tellraw ")
        || lower.startsWith("broadcast ")
        || lower.startsWith("msg ")
        || lower.startsWith("say ")
        || lower.startsWith("lp user ")
        || lower.startsWith("luckperms user ")
        || lower.startsWith("minecraft:tellraw ")
        || lower.startsWith("[");
  }

  private static boolean containsUnknownPlaceholder(String command) {
    int start = command.indexOf('{');
    while (start >= 0) {
      int end = command.indexOf('}', start);
      if (end < 0) {
        return true;
      }
      String key = command.substring(start + 1, end);
      if (!RewardCommandFormatter.ALLOWED_PLACEHOLDERS.contains(key)) {
        return true;
      }
      start = command.indexOf('{', end + 1);
    }
    return false;
  }

  public record SafetyResult(boolean allowed, String reason, List<String> commands) {
    static SafetyResult ok(List<String> commands) {
      return new SafetyResult(true, null, List.copyOf(commands));
    }

    static SafetyResult blocked(String reason) {
      return new SafetyResult(false, reason, List.of());
    }
  }
}
