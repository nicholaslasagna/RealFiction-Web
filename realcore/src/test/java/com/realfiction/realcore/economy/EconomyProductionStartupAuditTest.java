package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.config.RealCoreConfig;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

final class EconomyProductionStartupAuditTest {

  @Test
  void safeDefaultsProduceNoWarnings() throws InvalidConfigurationException {
    EconomyProductionStartupAudit.Result result = EconomyProductionStartupAudit.audit(safeConfig());
    assertFalse(result.hasWarnings());
  }

  @Test
  void liveGameplaySyncProducesWarning() throws InvalidConfigurationException {
    RealCoreConfig config = load("""
        server:
          id: smp-1
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            dryRun: false
            categories:
              shopSell: true
            producers:
              economyShopGuiSell:
                enabled: true
                dryRun: false
        """);
    EconomyProductionStartupAudit.Result result = EconomyProductionStartupAudit.audit(config);
    assertTrue(result.hasWarnings());
    assertTrue(result.warnings().stream().anyMatch(w -> w.contains("dryRun=false")));
  }

  private static RealCoreConfig safeConfig() throws InvalidConfigurationException {
    return load("""
        server:
          id: smp-1
        modules:
          economy: false
        economy:
          enabled: false
        """);
  }

  private static RealCoreConfig load(String yaml) throws InvalidConfigurationException {
    YamlConfiguration configuration = new YamlConfiguration();
    configuration.loadFromString(yaml);
    configuration.set("baseUrl", "https://realfiction.live");
    configuration.set("hmacSecret", "test-secret");
    return RealCoreConfig.from(configuration);
  }
}
