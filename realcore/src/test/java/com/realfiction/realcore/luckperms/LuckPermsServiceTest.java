package com.realfiction.realcore.luckperms;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.lang.reflect.Proxy;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CompletionException;
import java.util.logging.Logger;
import org.bukkit.Server;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.PluginManager;
import org.junit.jupiter.api.Test;

final class LuckPermsServiceTest {
  @Test
  void factoryReturnsUnavailableServiceWhenLuckPermsPluginIsMissing() {
    LuckPermsService service = LuckPermsService.create(pluginWithoutLuckPerms());

    assertFalse(service.available());
    assertThrows(
        CompletionException.class,
        () -> service.grantPermission(UUID.randomUUID(), "realfiction.test", Duration.ofMinutes(5)).join()
    );
  }

  private Plugin pluginWithoutLuckPerms() {
    PluginManager pluginManager = proxy(PluginManager.class, (method, args) -> {
      if ("isPluginEnabled".equals(method.getName())) {
        return false;
      }
      return defaultValue(method.getReturnType());
    });
    Server server = proxy(Server.class, (method, args) -> {
      if ("getPluginManager".equals(method.getName())) {
        return pluginManager;
      }
      return defaultValue(method.getReturnType());
    });
    Logger logger = Logger.getLogger("RealCoreTest");

    return proxy(Plugin.class, (method, args) -> switch (method.getName()) {
      case "getServer" -> server;
      case "getLogger" -> logger;
      default -> defaultValue(method.getReturnType());
    });
  }

  @SuppressWarnings("unchecked")
  private <T> T proxy(Class<T> type, Invocation invocation) {
    return (T) Proxy.newProxyInstance(
        type.getClassLoader(),
        new Class<?>[] { type },
        (proxy, method, args) -> {
          if ("toString".equals(method.getName())) {
            return type.getSimpleName() + "Proxy";
          }
          if ("hashCode".equals(method.getName())) {
            return System.identityHashCode(proxy);
          }
          if ("equals".equals(method.getName())) {
            return proxy == args[0];
          }
          return invocation.invoke(method, args);
        }
    );
  }

  private Object defaultValue(Class<?> type) {
    if (!type.isPrimitive()) {
      return null;
    }
    if (type == boolean.class) {
      return false;
    }
    if (type == char.class) {
      return '\0';
    }
    if (type == byte.class || type == short.class || type == int.class || type == long.class) {
      return 0;
    }
    if (type == float.class || type == double.class) {
      return 0.0;
    }
    return null;
  }

  @FunctionalInterface
  private interface Invocation {
    Object invoke(java.lang.reflect.Method method, Object[] args);
  }
}
