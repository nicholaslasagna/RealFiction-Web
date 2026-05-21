package com.realfiction.realcore.menu;

/**
 * A parsed menu action. Parsing is intentionally free of Bukkit types so it can
 * be unit tested without a server.
 *
 * <ul>
 *   <li>{@code [CLOSE_INVENTORY]}</li>
 *   <li>{@code [MESSAGE] text}</li>
 *   <li>{@code [COMMAND] console; command}</li>
 *   <li>{@code [COMMAND] player; command}</li>
 *   <li>{@code [PROXY] serverName}</li>
 * </ul>
 */
public record MenuAction(Type type, String value) {
  public enum Type {
    CLOSE_INVENTORY,
    MESSAGE,
    CONSOLE_COMMAND,
    PLAYER_COMMAND,
    PROXY
  }
}
