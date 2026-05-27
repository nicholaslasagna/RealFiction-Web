package com.realfiction.realcore.economy;

import java.lang.reflect.Method;
import java.util.Locale;
import java.util.Map;

/**
 * Reflection helpers for EconomyShopGUI {@code PostTransactionEvent} without a
 * compile-time dependency on EconomyShopGUI-API.
 */
final class EconomyShopGuiPostTransactionSupport {
  static final String EVENT_CLASS = "me.gypopo.economyshopgui.api.events.PostTransactionEvent";

  private EconomyShopGuiPostTransactionSupport() {}

  static boolean isBuyTransaction(Object event) throws ReflectiveOperationException {
    return transactionTypeName(event).contains("BUY");
  }

  static boolean isSellTransaction(Object event) throws ReflectiveOperationException {
    return transactionTypeName(event).contains("SELL");
  }

  static boolean isSuccessfulTransaction(Object event) throws ReflectiveOperationException {
    Object result = invoke(event, "getTransactionResult");
    String name = result == null ? "" : result.toString();
    return name.startsWith("SUCCESS");
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

  static String buildEventId(Object event, java.util.UUID playerUuid, long amountMinor)
      throws ReflectiveOperationException {
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

  private static String transactionTypeName(Object event) throws ReflectiveOperationException {
    Object type = invoke(event, "getTransactionType");
    return type == null ? "" : type.toString().toUpperCase(Locale.ROOT);
  }

  static long dollarsToMinor(double dollars) {
    if (Double.isNaN(dollars) || Double.isInfinite(dollars) || dollars <= 0) {
      return 0;
    }
    return Math.round(dollars * 100.0);
  }

  private static double toDouble(Object value) {
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
