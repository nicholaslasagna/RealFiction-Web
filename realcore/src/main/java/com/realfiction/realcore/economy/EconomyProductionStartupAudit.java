package com.realfiction.realcore.economy;

import com.realfiction.realcore.config.EconomyConfig;
import com.realfiction.realcore.config.GameplayEconomyProducerConfig;
import com.realfiction.realcore.config.GameplayEconomySyncConfig;
import com.realfiction.realcore.config.RealCoreConfig;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Logs a production-oriented summary of economy flags at startup/reload.
 * Does not change config or enable features.
 */
public final class EconomyProductionStartupAudit {
  private EconomyProductionStartupAudit() {}

  public record Result(List<String> warnings, List<String> infos) {
    public boolean hasWarnings() {
      return !warnings.isEmpty();
    }
  }

  public static Result audit(RealCoreConfig config) {
    List<String> warnings = new ArrayList<>();
    List<String> infos = new ArrayList<>();
    if (config == null) {
      warnings.add("RealCore config is not loaded");
      return new Result(List.copyOf(warnings), List.copyOf(infos));
    }

    EconomyConfig economy = config.economy();
    GameplayEconomySyncConfig gameplay = economy.gameplaySync();
    String serverId = config.serverId() == null ? "" : config.serverId().trim();
    String serverGroup = config.serverGroup() == null ? "" : config.serverGroup().trim();

    infos.add(String.format(
        Locale.US,
        "Economy flags: modules.economy=%s economy.enabled=%s gameplaySync.enabled=%s gameplaySync.dryRun=%s server=%s group=%s",
        config.modules().economy(),
        economy.enabled(),
        gameplay.enabled(),
        gameplay.dryRun(),
        serverId,
        serverGroup
    ));

    if (economy.voteRewardsLedgerWritesEnabled()) {
      warnings.add("economy.voteRewardsLedgerWritesEnabled=true — verify this is intentional for server.id="
          + serverId + " (Lobby1 vote path only unless explicitly approved).");
    }

    if (gameplay.enabled() && !gameplay.dryRun()) {
      warnings.add("economy.gameplaySync.dryRun=false — gameplay ledger writes are ARMED when producers and DB policy allow.");
    }

    warnProducerState(warnings, "economyShopGuiSell", gameplay.producers().economyShopGuiSell(), gameplay);
    warnProducerState(warnings, "economyShopGuiBuy", gameplay.producers().economyShopGuiBuy(), gameplay);

    if (gameplay.generic().enabled()) {
      warnings.add("economy.gameplaySync.generic.enabled=true — internal generic producer is active (still requires category flags).");
    }

    if (config.modules().economy() && economy.enabled() && gameplay.enabled() && !gameplay.dryRun()) {
      GameplayEconomyProducerConfig sell = gameplay.producers().economyShopGuiSell();
      if (sell.enabled() && !sell.dryRun() && gameplay.shopSell()) {
        warnings.add("shop_sell live capture path is fully armed (producer enabled, producer dryRun=false, category shopSell=true).");
      }
      GameplayEconomyProducerConfig buy = gameplay.producers().economyShopGuiBuy();
      if (buy.enabled() && !buy.dryRun() && gameplay.shopBuy()) {
        warnings.add("shop_buy live capture path is fully armed (producer enabled, producer dryRun=false, category shopBuy=true).");
      }
    }

    if ("anarchy".equalsIgnoreCase(serverGroup)) {
      infos.add("Anarchy server group — global economy mutations are blocked by policy.");
    } else if (!gameplay.backendAllowlist().contains(serverId.toLowerCase(Locale.ROOT))) {
      infos.add("server.id is not in gameplaySync.backendAllowlist — gameplay sync will not capture on this backend.");
    }

    return new Result(List.copyOf(warnings), List.copyOf(infos));
  }

  private static void warnProducerState(
      List<String> warnings,
      String name,
      GameplayEconomyProducerConfig producer,
      GameplayEconomySyncConfig gameplay
  ) {
    if (!producer.enabled()) {
      return;
    }
    if (producer.dryRun() || gameplay.dryRun()) {
      return;
    }
    warnings.add("Producer " + name + " is enabled with dryRun=false while gameplaySync.dryRun=false — live capture possible.");
  }

  public static void log(Logger logger, RealCoreConfig config) {
    if (logger == null) {
      return;
    }
    Result result = audit(config);
    for (String info : result.infos()) {
      logger.info("[EconomyProduction] " + info);
    }
    for (String warning : result.warnings()) {
      logger.log(Level.WARNING, "[EconomyProduction] " + warning);
    }
  }
}
