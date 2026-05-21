package com.realfiction.realcore.cosmetics;

import java.io.File;
import java.io.IOException;
import java.util.UUID;
import java.util.logging.Logger;
import org.bukkit.configuration.file.YamlConfiguration;

public final class CosmeticsStorage {
  private final File file;
  private final Logger logger;
  private YamlConfiguration data;

  public CosmeticsStorage(File dataFolder, Logger logger) {
    this.file = new File(dataFolder, "cosmetics.yml");
    this.logger = logger;
    reload();
  }

  public synchronized void reload() {
    this.data = YamlConfiguration.loadConfiguration(file);
  }

  public synchronized CosmeticSelection selection(UUID playerId) {
    String root = "players." + playerId;
    if (!data.isConfigurationSection(root)) {
      return CosmeticSelection.defaults();
    }
    return new CosmeticSelection(
        data.getString(root + ".usernameColor", ""),
        data.getString(root + ".particleAura", ""),
        data.getString(root + ".trail", ""),
        data.getBoolean(root + ".lobbyFlight", true)
    );
  }

  public synchronized void save(UUID playerId, CosmeticSelection selection) {
    String root = "players." + playerId;
    data.set(root + ".usernameColor", selection.usernameColor());
    data.set(root + ".particleAura", selection.particleAura());
    data.set(root + ".trail", selection.trail());
    data.set(root + ".lobbyFlight", selection.lobbyFlight());
    try {
      data.save(file);
    } catch (IOException error) {
      logger.warning("RealCore could not save cosmetics.yml: " + error.getMessage());
    }
  }
}
