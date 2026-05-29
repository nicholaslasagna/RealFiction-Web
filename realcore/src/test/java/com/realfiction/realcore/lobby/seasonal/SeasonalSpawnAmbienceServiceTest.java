package com.realfiction.realcore.lobby.seasonal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.lobby.LobbyConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import java.time.LocalDate;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

final class SeasonalSpawnAmbienceServiceTest {
  @Test
  void inactiveWithNoLobbyPlayers() {
    SeasonalSpawnAmbienceService ambience = new SeasonalSpawnAmbienceService(
        noopScheduler(),
        () -> null,
        new SeasonalEventRegistry()
    );
    ambience.start();
    assertFalse(ambience.shouldRunAmbience(LocalDate.of(2026, 7, 4)));
  }

  @Test
  void previewOverridesCalendarEvent() {
    SeasonalEventRegistry registry = new SeasonalEventRegistry();
    SeasonalSpawnAmbienceService ambience = new SeasonalSpawnAmbienceService(noopScheduler(), () -> null, registry);
    LocalDate christmas = LocalDate.of(2025, 12, 25);
    assertEquals("christmas", registry.activeEvent(christmas).id());
    ambience.setPreviewEventId("halloween");
    assertEquals("halloween", ambience.effectiveEvent(christmas).id());
    assertEquals(SeasonalAmbienceTheme.HALLOWEEN, ambience.effectiveTheme(christmas));
  }

  @Test
  void stopPreviewClearsOverride() {
    SeasonalSpawnAmbienceService ambience = new SeasonalSpawnAmbienceService(
        noopScheduler(),
        () -> null,
        new SeasonalEventRegistry()
    );
    ambience.setPreviewEventId("easter");
    ambience.clearPreview();
    assertEquals("", ambience.previewEventId());
    assertNull(ambience.effectiveEvent(LocalDate.of(2026, 8, 1)));
  }

  @Test
  void lobbySpawnPresentPreferredInConfig() {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.set("lobby.enabled", true);
    yaml.set("lobby.worlds", java.util.List.of("Lobby1"));
    yaml.set("lobby.spawn.world", "Lobby1");
    yaml.set("lobby.spawn.x", 10.0);
    yaml.set("lobby.spawn.y", 65.0);
    yaml.set("lobby.spawn.z", -20.0);
    LobbyConfig config = LobbyConfig.from(yaml);
    assertTrue(config.spawn().present());
    assertEquals("Lobby1", config.spawn().world());
    assertEquals(10.0, config.spawn().x());
  }

  private static RealCoreScheduler noopScheduler() {
    return new RealCoreScheduler() {
      @Override
      public String name() {
        return "noop";
      }

      @Override
      public boolean folia() {
        return false;
      }

      @Override
      public void runAsync(Runnable task) {
      }

      @Override
      public com.realfiction.realcore.scheduler.ScheduledTaskHandle runAsyncRepeating(
          Runnable task,
          long initialDelaySeconds,
          long periodSeconds
      ) {
        return () -> {
        };
      }

      @Override
      public com.realfiction.realcore.scheduler.ScheduledTaskHandle runGlobalRepeating(
          Runnable task,
          long initialDelayTicks,
          long periodTicks
      ) {
        return () -> {
        };
      }

      @Override
      public void runGlobal(Runnable task) {
      }

      @Override
      public void runForPlayer(org.bukkit.entity.Player player, Runnable task) {
      }

      @Override
      public void runForPlayerLater(org.bukkit.entity.Player player, Runnable task, long delayTicks) {
      }

      @Override
      public java.util.concurrent.CompletableFuture<Void> dispatchConsoleCommand(String command) {
        return java.util.concurrent.CompletableFuture.completedFuture(null);
      }

      @Override
      public void close() {
      }
    };
  }
}
