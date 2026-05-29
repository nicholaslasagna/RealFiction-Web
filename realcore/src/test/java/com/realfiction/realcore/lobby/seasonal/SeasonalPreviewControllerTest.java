package com.realfiction.realcore.lobby.seasonal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.lobby.LobbyConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.util.List;
import java.util.logging.Logger;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

final class SeasonalPreviewControllerTest {
  @Test
  void unknownEventSetsFailureMessage() {
    SeasonalPreviewController controller = controller(null);
    SeasonalPreviewController.PreviewStartResult result =
        controller.preview("bogus_event", TestCommandSenders.named("test"));
    assertFalse(result.success());
    assertFalse(controller.previewRunning());
    assertTrue(
        controller.lastPreviewFailure().contains("unknown event id")
            || controller.lastPreviewFailure().contains("lobby module")
    );
  }

  @Test
  void stopPreviewClearsShowLock() {
    SeasonalPreviewController controller = controller(null);
    controller.stopPreview();
    assertFalse(controller.previewRunning());
    assertFalse(controller.showLockRunning());
    assertEquals("", controller.previewId());
  }

  @Test
  void failedPreviewClearsRunningFlag() {
    SeasonalPreviewController controller = controller(null);
    SeasonalPreviewController.PreviewStartResult result =
        controller.preview("christmas", TestCommandSenders.named("test"));
    assertFalse(result.success());
    assertFalse(controller.previewRunning());
    assertFalse(controller.showLockRunning());
  }

  @Test
  void lobbySpawnPresentPreferredInConfig() {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.set("lobby.enabled", true);
    yaml.set("lobby.worlds", List.of("Lobby1"));
    yaml.set("lobby.spawn.world", "Lobby1");
    yaml.set("lobby.spawn.x", 10.0);
    yaml.set("lobby.spawn.y", 65.0);
    yaml.set("lobby.spawn.z", -20.0);
    LobbyConfig config = LobbyConfig.from(yaml);
    assertTrue(config.spawn().present());
  }

  @Test
  void spawnWorldWithoutCoordsUsesWorldSpawnPath() {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.set("lobby.enabled", true);
    yaml.set("lobby.worlds", List.of("Lobby1"));
    yaml.set("lobby.spawn.world", "Lobby1");
    LobbyConfig config = LobbyConfig.from(yaml);
    assertFalse(config.spawn().present());
    assertEquals("Lobby1", config.spawn().world());
  }

  private static SeasonalPreviewController controller(LobbyConfig config) {
    SeasonalEventRegistry registry = new SeasonalEventRegistry();
    SeasonalSpawnAmbienceService ambience = new SeasonalSpawnAmbienceService(noopScheduler(), () -> null, registry);
    return new SeasonalPreviewController(noopScheduler(), () -> null, ambience, Logger.getLogger("test"));
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
      public ScheduledTaskHandle runAsyncRepeating(Runnable task, long initialDelaySeconds, long periodSeconds) {
        return () -> {
        };
      }

      @Override
      public ScheduledTaskHandle runGlobalRepeating(Runnable task, long initialDelayTicks, long periodTicks) {
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
