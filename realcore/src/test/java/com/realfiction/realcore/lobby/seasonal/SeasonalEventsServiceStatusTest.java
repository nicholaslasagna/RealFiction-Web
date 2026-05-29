package com.realfiction.realcore.lobby.seasonal;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

final class SeasonalEventsServiceStatusTest {
  @Test
  void statusReportsLastPreviewFailure() {
    SeasonalEventsService service = new SeasonalEventsService(noopScheduler(), () -> null, Logger.getLogger("test"));
    service.preview("unknown_preview_id", TestCommandSenders.named("admin"));
    SeasonalEventsService.SeasonalStatus status = service.status();
    assertFalse(status.previewRunning());
    assertTrue(
        status.lastPreviewFailure().contains("unknown event id")
            || status.lastPreviewFailure().contains("lobby module")
    );
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
