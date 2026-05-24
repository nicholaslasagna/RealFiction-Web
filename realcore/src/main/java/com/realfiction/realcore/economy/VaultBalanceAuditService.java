package com.realfiction.realcore.economy;

import com.realfiction.realcore.RealCorePlugin;
import com.realfiction.realcore.config.RealCoreConfig;
import java.io.IOException;
import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.logging.Level;
import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.entity.Player;
import org.bukkit.plugin.RegisteredServiceProvider;

/**
 * Read-only Vault balance audit helper.
 *
 * <p>This service never mutates Vault/EssentialsX balances, never writes the
 * global economy ledger, and never calls the RealFiction website API. It exists
 * solely to export local balances so staff can compare current economy state
 * across servers before any future migration/import work.
 */
public final class VaultBalanceAuditService {
  public static final int DEFAULT_ALL_LIMIT = 1000;
  public static final int HARD_MAX_LIMIT = 10_000;

  private static final String ECONOMY_CLASS = "net.milkbowl.vault.economy.Economy";
  private static final DateTimeFormatter FILE_TIMESTAMP =
      DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").withZone(ZoneOffset.UTC);

  private final RealCorePlugin plugin;
  private final RealCoreConfig config;

  public VaultBalanceAuditService(RealCorePlugin plugin, RealCoreConfig config) {
    this.plugin = plugin;
    this.config = config;
  }

  public AuditReport audit(Mode mode, int requestedLimit) {
    if (config == null) {
      return AuditReport.unavailable("RealCore config is not loaded.");
    }
    ProviderBinding provider = bindEconomyProvider();
    if (provider == null) {
      return AuditReport.unavailable("Vault Economy provider is not available.");
    }

    int limit = normalizeLimit(requestedLimit);
    List<PlayerRef> players = mode == Mode.ALL ? allKnownPlayers(limit) : onlinePlayers(limit);
    List<AuditEntry> entries = new ArrayList<>();
    int failures = 0;

    for (PlayerRef player : players) {
      Double balance = invokeGetBalance(provider, player.offlinePlayer());
      if (balance == null) {
        failures++;
        continue;
      }
      entries.add(new AuditEntry(
          config.serverId(),
          config.serverGroup(),
          player.uuid(),
          player.username(),
          formatBalance(balance)
      ));
    }
    entries.sort(Comparator.comparing(AuditEntry::username, String.CASE_INSENSITIVE_ORDER)
        .thenComparing(entry -> entry.minecraftUuid().toString()));

    try {
      Path exportPath = writeCsv(mode, entries);
      return new AuditReport(true, provider.name(), mode, players.size(), entries, exportPath, failures, "");
    } catch (IOException error) {
      plugin.getLogger().log(Level.WARNING, "Could not write Vault balance audit CSV", error);
      return new AuditReport(true, provider.name(), mode, players.size(), entries, null, failures,
          "Could not write audit CSV: " + error.getMessage());
    }
  }

  public static int normalizeLimit(int requestedLimit) {
    if (requestedLimit <= 0) {
      return DEFAULT_ALL_LIMIT;
    }
    return Math.min(requestedLimit, HARD_MAX_LIMIT);
  }

  public static List<String> csvLines(List<AuditEntry> entries) {
    List<String> lines = new ArrayList<>();
    lines.add("serverId,serverGroup,minecraftUuid,username,localVaultBalance");
    for (AuditEntry entry : entries) {
      lines.add(String.join(",",
          csvEscape(entry.serverId()),
          csvEscape(entry.serverGroup()),
          csvEscape(entry.minecraftUuid().toString()),
          csvEscape(entry.username()),
          csvEscape(entry.localVaultBalance())
      ));
    }
    return lines;
  }

  static String csvEscape(String value) {
    String safe = value == null ? "" : value;
    boolean quote = safe.contains(",") || safe.contains("\"") || safe.contains("\n") || safe.contains("\r");
    String escaped = safe.replace("\"", "\"\"");
    return quote ? "\"" + escaped + "\"" : escaped;
  }

  private ProviderBinding bindEconomyProvider() {
    Class<?> economyClass;
    try {
      economyClass = Class.forName(ECONOMY_CLASS);
    } catch (ClassNotFoundException missing) {
      return null;
    }
    RegisteredServiceProvider<?> registration = Bukkit.getServicesManager().getRegistration(economyClass);
    if (registration == null || registration.getProvider() == null) {
      return null;
    }
    Object provider = registration.getProvider();
    try {
      Method getBalance = provider.getClass().getMethod("getBalance", OfflinePlayer.class);
      String providerName = providerName(provider);
      return new ProviderBinding(provider, providerName, getBalance);
    } catch (NoSuchMethodException error) {
      plugin.getLogger().log(Level.WARNING, "Vault Economy provider has no getBalance(OfflinePlayer)", error);
      return null;
    }
  }

  private String providerName(Object provider) {
    try {
      Method getName = provider.getClass().getMethod("getName");
      Object name = getName.invoke(provider);
      if (name instanceof String string && !string.isBlank()) {
        return string;
      }
    } catch (Throwable ignored) {
      // Provider class name is good enough for an audit label.
    }
    return provider.getClass().getName();
  }

  private List<PlayerRef> onlinePlayers(int limit) {
    List<PlayerRef> players = new ArrayList<>();
    for (Player player : Bukkit.getOnlinePlayers()) {
      if (player == null) {
        continue;
      }
      OfflinePlayer offline = Bukkit.getOfflinePlayer(player.getUniqueId());
      players.add(new PlayerRef(player.getUniqueId(), player.getName(), offline));
      if (players.size() >= limit) {
        break;
      }
    }
    return players;
  }

  private List<PlayerRef> allKnownPlayers(int limit) {
    List<PlayerRef> players = new ArrayList<>();
    for (OfflinePlayer player : Bukkit.getOfflinePlayers()) {
      if (player == null || player.getUniqueId() == null) {
        continue;
      }
      players.add(new PlayerRef(player.getUniqueId(), safeUsername(player), player));
      if (players.size() >= limit) {
        break;
      }
    }
    return players;
  }

  private Double invokeGetBalance(ProviderBinding binding, OfflinePlayer player) {
    try {
      Object result = binding.getBalance().invoke(binding.provider(), player);
      if (result instanceof Number number) {
        double value = number.doubleValue();
        return Double.isFinite(value) ? value : null;
      }
      return null;
    } catch (Throwable error) {
      plugin.getLogger().log(Level.WARNING,
          "Vault balance audit failed for " + (player == null ? "?" : player.getUniqueId()), error);
      return null;
    }
  }

  private Path writeCsv(Mode mode, List<AuditEntry> entries) throws IOException {
    Path auditDir = plugin.getDataFolder().toPath().resolve("audits");
    Files.createDirectories(auditDir);
    String fileName = "vault-balance-audit-" + safeFilePart(config.serverId()) + "-"
        + mode.name().toLowerCase(Locale.ROOT) + "-"
        + FILE_TIMESTAMP.format(Instant.now()) + ".csv";
    Path exportPath = auditDir.resolve(fileName);
    Files.write(exportPath, csvLines(entries), StandardCharsets.UTF_8);
    return exportPath;
  }

  private String safeFilePart(String value) {
    String safe = value == null ? "server" : value.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9_.-]", "-");
    return safe.isBlank() ? "server" : safe;
  }

  private static String safeUsername(OfflinePlayer player) {
    String name = player.getName();
    return name == null || name.isBlank() ? "unknown" : name;
  }

  private static String formatBalance(double value) {
    return BigDecimal.valueOf(value).stripTrailingZeros().toPlainString();
  }

  private record ProviderBinding(Object provider, String name, Method getBalance) {}

  private record PlayerRef(UUID uuid, String username, OfflinePlayer offlinePlayer) {}

  public enum Mode {
    ONLINE,
    ALL;

    public static Mode parse(String value) {
      if (value == null || value.isBlank()) {
        return ONLINE;
      }
      return switch (value.toLowerCase(Locale.ROOT)) {
        case "all" -> ALL;
        case "online" -> ONLINE;
        default -> throw new IllegalArgumentException("Use online or all.");
      };
    }
  }

  public record AuditEntry(
      String serverId,
      String serverGroup,
      UUID minecraftUuid,
      String username,
      String localVaultBalance
  ) {}

  public record AuditReport(
      boolean providerAvailable,
      String providerName,
      Mode mode,
      int scanned,
      List<AuditEntry> entries,
      Path exportPath,
      int failureCount,
      String error
  ) {
    static AuditReport unavailable(String error) {
      return new AuditReport(false, "", Mode.ONLINE, 0, List.of(), null, 0, error);
    }
  }
}
