package com.realfiction.realcore.menu;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Parses menu action strings into {@link MenuAction} values. */
public final class MenuActionParser {
  private MenuActionParser() {
  }

  public static MenuAction parse(String raw) {
    if (raw == null) {
      throw new IllegalArgumentException("action is null");
    }
    String trimmed = raw.trim();
    if (!trimmed.startsWith("[")) {
      throw new IllegalArgumentException("action must start with [TYPE]: " + raw);
    }
    int close = trimmed.indexOf(']');
    if (close < 0) {
      throw new IllegalArgumentException("action missing closing bracket: " + raw);
    }
    String token = trimmed.substring(1, close).trim().toUpperCase(Locale.ROOT);
    String argument = trimmed.substring(close + 1).trim();

    switch (token) {
      case "CLOSE_INVENTORY":
        return new MenuAction(MenuAction.Type.CLOSE_INVENTORY, null);
      case "MESSAGE":
        return new MenuAction(MenuAction.Type.MESSAGE, argument);
      case "PROXY":
        if (argument.isBlank()) {
          throw new IllegalArgumentException("PROXY requires a server name: " + raw);
        }
        return new MenuAction(MenuAction.Type.PROXY, argument);
      case "COMMAND":
        return parseCommand(argument, raw);
      default:
        throw new IllegalArgumentException("Unknown action type: " + token);
    }
  }

  private static MenuAction parseCommand(String argument, String raw) {
    int separator = argument.indexOf(';');
    if (separator < 0) {
      throw new IllegalArgumentException("COMMAND requires 'console;' or 'player;' prefix: " + raw);
    }
    String who = argument.substring(0, separator).trim().toLowerCase(Locale.ROOT);
    String command = argument.substring(separator + 1).trim();
    if (command.startsWith("/")) {
      command = command.substring(1).trim();
    }
    if (command.isBlank()) {
      throw new IllegalArgumentException("COMMAND requires a command body: " + raw);
    }
    return switch (who) {
      case "console" -> new MenuAction(MenuAction.Type.CONSOLE_COMMAND, command);
      case "player" -> new MenuAction(MenuAction.Type.PLAYER_COMMAND, command);
      default -> throw new IllegalArgumentException("COMMAND sender must be console or player: " + raw);
    };
  }

  /** Parses a list of actions, skipping blanks. Throws on the first invalid entry. */
  public static List<MenuAction> parseAll(List<String> raw) {
    List<MenuAction> actions = new ArrayList<>();
    if (raw == null) {
      return actions;
    }
    for (String entry : raw) {
      if (entry == null || entry.isBlank()) {
        continue;
      }
      actions.add(parse(entry));
    }
    return actions;
  }
}
