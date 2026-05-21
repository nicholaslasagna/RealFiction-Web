package com.realfiction.realcore.menu;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

final class MenuActionParserTest {
  @Test
  void parsesCloseInventory() {
    MenuAction action = MenuActionParser.parse("[CLOSE_INVENTORY]");
    assertEquals(MenuAction.Type.CLOSE_INVENTORY, action.type());
  }

  @Test
  void parsesMessageKeepingText() {
    MenuAction action = MenuActionParser.parse("[MESSAGE] &aHello there");
    assertEquals(MenuAction.Type.MESSAGE, action.type());
    assertEquals("&aHello there", action.value());
  }

  @Test
  void parsesConsoleCommand() {
    MenuAction action = MenuActionParser.parse("[COMMAND] console; cp teleport %player% Arcade Lobby_Games 10 0 36 270 1.95");
    assertEquals(MenuAction.Type.CONSOLE_COMMAND, action.type());
    assertEquals("cp teleport %player% Arcade Lobby_Games 10 0 36 270 1.95", action.value());
  }

  @Test
  void parsesPlayerCommandAndStripsLeadingSlash() {
    MenuAction action = MenuActionParser.parse("[COMMAND] player; /ajparkour start");
    assertEquals(MenuAction.Type.PLAYER_COMMAND, action.type());
    assertEquals("ajparkour start", action.value());
  }

  @Test
  void parsesProxy() {
    MenuAction action = MenuActionParser.parse("[PROXY] RealAnarchy");
    assertEquals(MenuAction.Type.PROXY, action.type());
    assertEquals("RealAnarchy", action.value());
  }

  @Test
  void rejectsUnknownType() {
    assertThrows(IllegalArgumentException.class, () -> MenuActionParser.parse("[TELEPORT] here"));
  }

  @Test
  void rejectsMissingBrackets() {
    assertThrows(IllegalArgumentException.class, () -> MenuActionParser.parse("CLOSE_INVENTORY"));
  }

  @Test
  void rejectsCommandWithoutSenderSeparator() {
    assertThrows(IllegalArgumentException.class, () -> MenuActionParser.parse("[COMMAND] cp teleport here"));
  }

  @Test
  void rejectsCommandWithBadSender() {
    assertThrows(IllegalArgumentException.class, () -> MenuActionParser.parse("[COMMAND] moderator; cp teleport"));
  }

  @Test
  void rejectsBlankProxy() {
    assertThrows(IllegalArgumentException.class, () -> MenuActionParser.parse("[PROXY]"));
  }

  @Test
  void parseAllSkipsBlanks() {
    List<MenuAction> actions = MenuActionParser.parseAll(Arrays.asList("[CLOSE_INVENTORY]", "", "  ", "[PROXY] SMP"));
    assertEquals(2, actions.size());
    assertEquals(MenuAction.Type.CLOSE_INVENTORY, actions.get(0).type());
    assertEquals(MenuAction.Type.PROXY, actions.get(1).type());
  }
}
