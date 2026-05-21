package com.realfiction.realcore.proxy;

import com.realfiction.realcore.scheduler.RealCoreScheduler;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.messaging.Messenger;

/**
 * Sends players to other backend servers through the proxy (Velocity/Bungee)
 * using the standard "BungeeCord" plugin messaging channel. Velocity exposes
 * this channel when bungee plugin messaging is enabled (default).
 *
 * <p>Plugin messages must be sent from an online player's connection, so the
 * send is routed through the player scheduler for Folia safety.
 */
public final class ProxyService {
  public static final String BUNGEE_CHANNEL = "BungeeCord";

  private final Plugin plugin;
  private final RealCoreScheduler scheduler;
  private volatile boolean registered;

  public ProxyService(Plugin plugin, RealCoreScheduler scheduler) {
    this.plugin = plugin;
    this.scheduler = scheduler;
  }

  public void register() {
    Messenger messenger = plugin.getServer().getMessenger();
    if (!messenger.isOutgoingChannelRegistered(plugin, BUNGEE_CHANNEL)) {
      messenger.registerOutgoingPluginChannel(plugin, BUNGEE_CHANNEL);
    }
    registered = true;
  }

  public void unregister() {
    if (registered) {
      plugin.getServer().getMessenger().unregisterOutgoingPluginChannel(plugin, BUNGEE_CHANNEL);
      registered = false;
    }
  }

  public void connect(Player player, String serverName) {
    if (serverName == null || serverName.isBlank()) {
      return;
    }
    byte[] payload = buildConnect(serverName.trim());
    if (payload == null) {
      return;
    }
    scheduler.runForPlayer(player, () -> {
      if (player.isOnline()) {
        player.sendPluginMessage(plugin, BUNGEE_CHANNEL, payload);
      }
    });
  }

  private byte[] buildConnect(String serverName) {
    try (ByteArrayOutputStream out = new ByteArrayOutputStream();
        DataOutputStream data = new DataOutputStream(out)) {
      data.writeUTF("Connect");
      data.writeUTF(serverName);
      return out.toByteArray();
    } catch (IOException error) {
      plugin.getLogger().warning("RealCore failed to build proxy connect message: " + error.getMessage());
      return null;
    }
  }
}
