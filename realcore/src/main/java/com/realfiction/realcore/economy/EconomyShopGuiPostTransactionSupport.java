package com.realfiction.realcore.economy;

import java.lang.reflect.Method;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

/**
 * Reflection helpers for EconomyShopGUI {@code PostTransactionEvent} without a compile-time API dependency.
 */
final class EconomyShopGuiPostTransactionSupport {
  static final String EVENT_CLASS = "me.gypopo.economyshopgui.api.events.PostTransactionEvent";

  private EconomyShopGuiPostTransactionSupport() {}

  static boolean isEconomyShopGuiPresent() {
    return Bukkit.getPluginManager().getPlugin("EconomyShopGUI") != null
        || Bukkit.getPluginManager().getPlugin("EconomyShopGUI-Premium") != null;
  }

  @SuppressWarnings("unchecked")
  static Class<? extends org.bukkit.event.Event> eventClass() throws ClassNotFoundException {
    return (Class<? extends org.bukkit.event.Event>) Class.forName(EVENT_CLASS);
  }

  static boolean isSuccessfulTransaction(Object event) throws ReflectiveOperationException {
    Object result = invoke(event, "getTransactionResult");
    String name = result == null ? "" : result.toString();
    return name.startsWith("SUCCESS");
  }

  static String transactionTypeName(Object event) throws ReflectiveOperationException {
    Object type = invoke(event, "getTransactionType");
    return type == null ? "" : type.toString().toUpperCase(Locale.ROOT);
  }

  static long resolveVaultAmountMinor(Object event) throws ReflectiveOperationException {
    Object prices = invoke(event, "getPrices");
    if (prices instanceof Map<?, ?> priceMap && !priceMap.isEmpty()) {
      double total = 0;
      for (Map.Entry<?, ?> entry : priceMap.entrySet()) {
        Object ecoType = entry.getKey();
        String ecoName = ecoType == null ? "" : ecoType.toString().toUpperCase(Locale.ROOT);
        if (ecoName.contains("VAULT")) {
          total += toDouble(entry.getValue());
        }
      }
      if (total > 0) {
        return dollarsToMinor(total);
      }
    }
    return dollarsToMinor(toDouble(invoke(event, "getPrice")));
  }

  static String buildEventId(Object event, UUID playerUuid, long amountMinor) throws ReflectiveOperationException {
    Object type = invoke(event, "getTransactionType");
    String typeName = type == null ? "UNKNOWN" : type.toString();
    String itemPath = "unknown";
    Object shopItem = invoke(event, "getShopItem");
    if (shopItem != null) {
      try {
        Object path = invoke(shopItem, "getItemPath");
        if (path != null && !path.toString().isBlank()) {
          itemPath = path.toString();
        }
      } catch (RuntimeException ignored) {
        itemPath = shopItem.getClass().getSimpleName();
      }
    }
    int amount = (int) toDouble(invoke(event, "getAmount"));
    return typeName + ":" + itemPath + ":" + amount + ":" + amountMinor + ":" + playerUuid;
  }

  static Player requirePlayer(Object event) throws ReflectiveOperationException {
    return (Player) invoke(event, "getPlayer");
  }

  /** Upper bound aligned with {@code economy.gameplaySync.maxCreditMinorPerTx} default cap. */
  static final long MAX_VAULT_AMOUNT_MINOR = 1_000_000_000_000L;

  static long dollarsToMinor(double dollars) {
    if (Double.isNaN(dollars) || Double.isInfinite(dollars) || dollars <= 0) {
      return 0;
    }
    double minor = dollars * 100.0;
    if (minor >= MAX_VAULT_AMOUNT_MINOR) {
      return MAX_VAULT_AMOUNT_MINOR;
    }
    return Math.round(minor);
  }

  static double toDouble(Object value) {
    if (value instanceof Number number) {
      return number.doubleValue();
    }
    if (value == null) {
      return 0;
    }
    try {
      return Double.parseDouble(value.toString());
    } catch (NumberFormatException ignored) {
      return 0;
    }
  }

  static Object invoke(Object target, String methodName) throws ReflectiveOperationException {
    Method method = target.getClass().getMethod(methodName);
    return method.invoke(target);
  }
}
