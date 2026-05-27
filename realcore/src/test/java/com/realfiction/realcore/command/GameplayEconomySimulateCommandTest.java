package com.realfiction.realcore.command;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import org.bukkit.command.CommandSender;
import org.junit.jupiter.api.Test;

final class GameplayEconomySimulateCommandTest {
  @Test
  void requiresAdminPermission() {
    List<String> messages = new ArrayList<>();
    CommandSender denied = sender(false, messages);
    boolean handled = GameplayEconomySimulateCommand.handle(
        null,
        denied,
        new String[] {"economy", "gameplay", "simulate", "earn", "Alex", "10", "manual_simulator", "e1"}
    );
    assertTrue(handled);
    assertTrue(messages.stream().anyMatch(m -> m.contains("permission")));
  }

  @Test
  void consoleOperatorHasAdminPermission() {
    assertTrue(GameplayEconomySimulateCommand.isAuthorized(sender(true, new ArrayList<>())));
  }

  @Test
  void normalPlayerSenderDenied() {
    assertFalse(GameplayEconomySimulateCommand.isAuthorized(sender(false, new ArrayList<>())));
  }

  private static CommandSender sender(boolean admin, List<String> messages) {
    return (CommandSender) Proxy.newProxyInstance(
        CommandSender.class.getClassLoader(),
        new Class<?>[] {CommandSender.class},
        (proxy, method, args) -> {
          String name = method.getName();
          if ("hasPermission".equals(name)) {
            return admin;
          }
          if ("sendMessage".equals(name) && args != null) {
            if (args.length == 1 && args[0] instanceof String text) {
              messages.add(text);
            } else if (args.length == 2 && args[1] instanceof String text) {
              messages.add(text);
            }
            return null;
          }
          if (method.getReturnType() == boolean.class) {
            return false;
          }
          if (method.getReturnType() == int.class) {
            return 0;
          }
          return null;
        });
  }
}
