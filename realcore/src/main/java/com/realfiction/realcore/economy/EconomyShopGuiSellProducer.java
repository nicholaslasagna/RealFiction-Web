package com.realfiction.realcore.economy;

import com.realfiction.realcore.config.RealCoreConfig;
import java.util.logging.Logger;
import org.bukkit.plugin.Plugin;

/**
 * Captures EconomyShopGUI sell {@code PostTransactionEvent} instances via reflection.
 */
public final class EconomyShopGuiSellProducer extends AbstractEconomyShopGuiProducer {
  public static final String ID = "economyShopGuiSell";
  public static final String SOURCE = "EconomyShopGUI";

  public EconomyShopGuiSellProducer(
      Plugin plugin,
      RealCoreConfig config,
      GameplayEconomyCaptureService captureService,
      Logger logger
  ) {
    super(
        ID,
        plugin,
        config,
        captureService,
        logger,
        config.economy().gameplaySync().producers().economyShopGuiSell()
    );
  }

  @Override
  protected boolean acceptsTransactionType(String typeNameUpper) {
    return matchesSellTransactionType(typeNameUpper);
  }

  @Override
  protected String hookLabel() {
    return "SELL";
  }

  @Override
  protected String registrationLogMessage() {
    return "Gameplay sync EconomyShopGUI sell producer registered.";
  }

  @Override
  protected String captureReasonLabel() {
    return "EconomyShopGUI sell";
  }
}
