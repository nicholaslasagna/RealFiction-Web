package com.realfiction.realcore.economy;

import com.realfiction.realcore.config.RealCoreConfig;
import java.util.logging.Logger;
import org.bukkit.plugin.Plugin;

/**
 * Captures EconomyShopGUI buy {@code PostTransactionEvent} instances via reflection.
 */
public final class EconomyShopGuiBuyProducer extends AbstractEconomyShopGuiProducer {
  public static final String ID = "economyShopGuiBuy";
  public static final String SOURCE = "EconomyShopGUI";

  public EconomyShopGuiBuyProducer(
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
        config.economy().gameplaySync().producers().economyShopGuiBuy()
    );
  }

  @Override
  protected boolean acceptsTransactionType(String typeNameUpper) {
    return typeContains(typeNameUpper, "BUY");
  }

  @Override
  protected String hookLabel() {
    return "BUY";
  }

  @Override
  protected String registrationLogMessage() {
    return "Gameplay sync EconomyShopGUI buy producer registered.";
  }

  @Override
  protected String captureReasonLabel() {
    return "EconomyShopGUI buy";
  }
}
