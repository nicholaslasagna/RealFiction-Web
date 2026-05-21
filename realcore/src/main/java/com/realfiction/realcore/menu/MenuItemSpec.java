package com.realfiction.realcore.menu;

import java.util.List;

/** A single clickable icon inside a {@link MenuDefinition}. */
public record MenuItemSpec(
    int slot,
    String material,
    String name,
    List<String> lore,
    boolean glow,
    int amount,
    List<MenuAction> actions
) {
}
