package com.realfiction.realvotebridge;

import com.google.inject.Inject;
import com.velocitypowered.api.event.EventHandler;
import com.velocitypowered.api.event.PostOrder;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.event.proxy.ProxyShutdownEvent;
import com.velocitypowered.api.plugin.Dependency;
import com.velocitypowered.api.plugin.Plugin;
import com.velocitypowered.api.plugin.PluginContainer;
import com.velocitypowered.api.plugin.annotation.DataDirectory;
import com.velocitypowered.api.proxy.ProxyServer;
import java.nio.file.Path;
import java.time.Clock;
import java.util.Optional;
import org.slf4j.Logger;

@Plugin(
    id = "realvotebridge",
    name = "RealVoteBridge",
    version = "0.1.0-SNAPSHOT",
    description = "Forwards Velocity NuVotifier votes into RealFiction rewards.",
    authors = {"RealFiction"},
    dependencies = {@Dependency(id = "nuvotifier", optional = true)}
)
public final class RealVoteBridgePlugin {
  private static final String VOTIFIER_EVENT_CLASS = "com.vexsoftware.votifier.velocity.event.VotifierEvent";

  private final ProxyServer proxy;
  private final Logger logger;
  private final Path dataDirectory;
  private BridgeConfig config;
  private VoteForwarder forwarder;

  @Inject
  public RealVoteBridgePlugin(ProxyServer proxy, Logger logger, @DataDirectory Path dataDirectory) {
    this.proxy = proxy;
    this.logger = logger;
    this.dataDirectory = dataDirectory;
  }

  @Subscribe
  public void onProxyInitialize(ProxyInitializeEvent event) {
    try {
      config = BridgeConfig.load(dataDirectory);
    } catch (Exception error) {
      logger.warn("RealVoteBridge disabled: could not load config.yml ({})", error.getMessage());
      return;
    }

    if (!config.enabled()) {
      logger.info("RealVoteBridge disabled in config.yml.");
      return;
    }

    if (!config.ready()) {
      logger.warn("RealVoteBridge loaded, but hmacSecret/server settings are not ready. Votes will not be forwarded yet.");
    } else {
      forwarder = new VoteForwarder(config, logger);
      logger.info("RealVoteBridge auth ready: serverId={} baseUrl={}", config.serverId(), config.baseUrl());
    }

    registerNuVotifierListener();
  }

  @Subscribe
  public void onProxyShutdown(ProxyShutdownEvent event) {
    proxy.getEventManager().unregisterListeners(this);
    if (forwarder != null) {
      forwarder.close();
      forwarder = null;
    }
  }

  @SuppressWarnings({"rawtypes", "unchecked"})
  private void registerNuVotifierListener() {
    Optional<PluginContainer> nuVotifier = proxy.getPluginManager().getPlugin("nuvotifier");
    if (nuVotifier.isEmpty()) {
      logger.warn("NuVotifier is not loaded. RealVoteBridge is idle.");
      return;
    }

    try {
      ClassLoader classLoader = nuVotifier
          .flatMap(pluginContainer -> pluginContainer.getInstance())
          .map(instance -> instance.getClass().getClassLoader())
          .orElse(getClass().getClassLoader());
      Class<?> eventClass = Class.forName(VOTIFIER_EVENT_CLASS, false, classLoader);
      EventHandler handler = event -> handleVoteEvent(event);
      proxy.getEventManager().register(this, (Class) eventClass, PostOrder.NORMAL, handler);
      logger.info("RealVoteBridge hooked NuVotifier vote events.");
    } catch (ClassNotFoundException error) {
      logger.warn("NuVotifier is loaded, but its Velocity vote event class was not found. RealVoteBridge is idle.");
    }
  }

  private void handleVoteEvent(Object event) {
    Optional<VotePayload> payload = VoteEventAdapter.fromEvent(event, Clock.systemUTC());

    if (payload.isEmpty()) {
      logger.warn("Vote received, but RealVoteBridge could not read the player or vote site.");
      return;
    }

    VotePayload vote = payload.get();
    logger.info("Vote received: player={} site={}", vote.minecraftUsername(), vote.site());

    if (forwarder == null || config == null || !config.ready()) {
      logger.warn("Vote was not forwarded because RealVoteBridge auth is not ready.");
      return;
    }

    forwarder.forward(vote)
        .exceptionally(error -> {
          logger.warn("Vote forward failed: player={} site={} error={}", vote.minecraftUsername(), vote.site(), cleanMessage(error));
          return null;
        });
  }

  private String cleanMessage(Throwable error) {
    Throwable cursor = error;
    while (cursor.getCause() != null) {
      cursor = cursor.getCause();
    }
    String message = cursor.getMessage();
    if (message == null || message.isBlank()) {
      message = cursor.getClass().getSimpleName();
    }
    return message.length() > 220 ? message.substring(0, 220) : message;
  }
}
