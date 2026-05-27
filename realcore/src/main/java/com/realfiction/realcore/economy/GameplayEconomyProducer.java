package com.realfiction.realcore.economy;

/**
 * Gameplay economy event producer (shop sells, future earn sources).
 */
public interface GameplayEconomyProducer {
  String id();

  void start();

  void stop();

  boolean running();

  GameplayEconomyProducerMetrics metrics();

  String statusSummary();
}
