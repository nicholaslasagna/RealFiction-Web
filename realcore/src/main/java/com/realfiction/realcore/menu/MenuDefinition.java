package com.realfiction.realcore.menu;

import java.util.List;

/** A config-driven inventory menu (Game Menu, Lobby Selector, ...). */
public record MenuDefinition(
    String id,
    String title,
    int size,
    String fillerMaterial,
    String fillerName,
    List<MenuItemSpec> items
) {
}
