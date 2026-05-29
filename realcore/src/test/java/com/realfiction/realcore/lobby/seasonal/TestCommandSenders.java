package com.realfiction.realcore.lobby.seasonal;

import java.lang.reflect.Proxy;
import org.bukkit.command.CommandSender;

final class TestCommandSenders {
  private TestCommandSenders() {
  }

  static CommandSender named(String name) {
    return (CommandSender) Proxy.newProxyInstance(
        CommandSender.class.getClassLoader(),
        new Class<?>[] {CommandSender.class},
        (proxy, method, args) -> {
          if ("name".equals(method.getName()) || "getName".equals(method.getName())) {
            return name;
          }
          if (method.getReturnType() == boolean.class) {
            return false;
          }
          if (method.getReturnType() == String.class) {
            return name;
          }
          return null;
        }
    );
  }
}
