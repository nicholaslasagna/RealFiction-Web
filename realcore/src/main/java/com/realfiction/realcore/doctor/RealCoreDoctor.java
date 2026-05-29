package com.realfiction.realcore.doctor;

import com.realfiction.realcore.RealCorePlugin;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.rewards.ProductPermissionResolver;
import com.realfiction.realcore.lobby.LobbyManager;
import com.realfiction.realcore.lobby.seasonal.SeasonalEventsService;
import com.realfiction.realcore.lobby.seasonal.SeasonalShowOrigin;
import com.realfiction.realcore.rewards.RewardPollTelemetry;
import com.realfiction.realcore.rewards.RewardPoller;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/** Production diagnostics for /rf doctor. */
public final class RealCoreDoctor {
  private RealCoreDoctor() {
  }

  public static List<DoctorCheck> rewards(RealCorePlugin plugin) {
    List<DoctorCheck> checks = new ArrayList<>();
    RealCoreConfig config = plugin.realCoreConfig();
    RewardPoller poller = plugin.rewardPoller();

    checks.add(check(
        config.modules().rewards() ? DoctorLevel.PASS : DoctorLevel.WARN,
        "modules.rewards",
        config.modules().rewards() ? "enabled" : "disabled"
    ));
    checks.add(check(
        config.hmacSecretConfigured() ? DoctorLevel.PASS : DoctorLevel.FAIL,
        "hmacSecret",
        config.hmacSecretConfigured() ? "configured" : "missing or CHANGE_ME"
    ));
    checks.add(check(
        config.baseUrl() != null ? DoctorLevel.PASS : DoctorLevel.FAIL,
        "baseUrl",
        config.baseUrl() == null ? "missing" : config.baseUrl().toString()
    ));
    checks.add(check(
        poller != null && poller.running() ? DoctorLevel.PASS : DoctorLevel.WARN,
        "rewardPoller",
        poller != null && poller.running() ? "running" : "stopped"
    ));
    checks.add(check(
        plugin.luckPermsAvailable() ? DoctorLevel.PASS : DoctorLevel.WARN,
        "luckPerms",
        plugin.luckPermsAvailable() ? "available" : "unavailable"
    ));
    checks.add(check(
        config.allowUnsafeRewards() ? DoctorLevel.WARN : DoctorLevel.PASS,
        "unsafeRewards",
        config.allowUnsafeRewards() ? "allowed (testing only)" : "blocked"
    ));

    int mappingCount = ProductPermissionResolver.effectiveMappings(config).size();
    checks.add(check(DoctorLevel.PASS, "productPermissionMappings", Integer.toString(mappingCount)));

    int fallbackCommands = config.commandsByProductSlug().values().stream().mapToInt(List::size).sum()
        + config.commandsByRewardKey().values().stream().mapToInt(List::size).sum();
    checks.add(check(DoctorLevel.PASS, "configuredRewardCommands", Integer.toString(fallbackCommands)));

    if (poller != null) {
      RewardPollTelemetry telemetry = poller.telemetry();
      Instant lastPoll = telemetry.lastPollAt();
      checks.add(check(
          lastPoll != null ? DoctorLevel.PASS : DoctorLevel.WARN,
          "lastPoll",
          lastPoll == null ? "never" : lastPoll.toString()
      ));
      checks.add(check(DoctorLevel.PASS, "lastPollHttpStatus", Integer.toString(telemetry.lastPollHttpStatus())));
      checks.add(check(DoctorLevel.PASS, "pendingAcks", Integer.toString(plugin.pendingAckCount())));
      checks.add(check(DoctorLevel.PASS, "deliveredLedger", Integer.toString(plugin.deliveredLedgerSize())));
      checks.add(check(DoctorLevel.PASS, "deliveredCount", Integer.toString(telemetry.deliveredCount())));
      checks.add(check(
          telemetry.failedCount() == 0 ? DoctorLevel.PASS : DoctorLevel.WARN,
          "failedDeliveries",
          Integer.toString(telemetry.failedCount())
      ));
      String lastFailure = telemetry.lastDeliveryFailure();
      if (lastFailure != null && !lastFailure.isBlank()) {
        checks.add(check(DoctorLevel.WARN, "lastFailure", lastFailure));
      }
    }

    return checks;
  }

  public static List<DoctorCheck> seasonal(RealCorePlugin plugin) {
    List<DoctorCheck> checks = new ArrayList<>();
    RealCoreConfig config = plugin.realCoreConfig();
    LobbyManager lobby = plugin.lobbyManager();

    checks.add(check(
        config != null && config.modules().lobby() ? DoctorLevel.PASS : DoctorLevel.WARN,
        "modules.lobby",
        config != null && config.modules().lobby() ? "enabled" : "disabled"
    ));

    if (lobby == null) {
      checks.add(check(DoctorLevel.WARN, "lobbyManager", "not loaded"));
      return checks;
    }

    checks.add(check(
        lobby.config().enabled() ? DoctorLevel.PASS : DoctorLevel.WARN,
        "lobby.enabled",
        lobby.config().enabled() ? "enabled" : "disabled"
    ));

    SeasonalEventsService seasonal = lobby.seasonalEventsService();
    SeasonalEventsService.SeasonalStatus status = seasonal.status();
    SeasonalShowOrigin origin = seasonal.ambience().origin();

    checks.add(check(DoctorLevel.PASS, "registeredEvents", Integer.toString(status.registeredEvents())));
    checks.add(check(
        status.calendarActiveEventId().isBlank() ? DoctorLevel.PASS : DoctorLevel.PASS,
        "calendarActive",
        status.calendarActiveEventId().isBlank() ? "none today" : status.calendarActiveEventId()
    ));
    checks.add(check(
        status.previewRunning() ? DoctorLevel.PASS : DoctorLevel.PASS,
        "previewRunning",
        status.previewRunning() ? status.previewId() : "false"
    ));
    checks.add(check(
        status.showLockRunning() ? DoctorLevel.PASS : DoctorLevel.PASS,
        "showLock",
        Boolean.toString(status.showLockRunning())
    ));
    checks.add(check(
        status.ambiencePreviewEventId().isBlank() ? DoctorLevel.PASS : DoctorLevel.PASS,
        "ambiencePreview",
        status.ambiencePreviewEventId().isBlank() ? "none" : status.ambiencePreviewEventId()
    ));
    if (status.lastPreviewFailure() != null && !status.lastPreviewFailure().isBlank()) {
      checks.add(check(DoctorLevel.WARN, "lastPreviewFailure", status.lastPreviewFailure()));
    }

    if (lobby.config().enabled()) {
      if (origin.valid()) {
        checks.add(check(DoctorLevel.PASS, "ambienceOrigin", origin.summary()));
        checks.add(check(
            seasonal.ambience().running() ? DoctorLevel.PASS : DoctorLevel.WARN,
            "ambienceArmed",
            seasonal.ambience().running() ? "task scheduled" : "not running"
        ));
      } else {
        checks.add(check(DoctorLevel.WARN, "ambienceOrigin", origin.summary()));
        checks.add(check(DoctorLevel.WARN, "ambienceArmed", "cannot resolve lobby spawn origin"));
      }
    }

    checks.add(check(
        DoctorLevel.PASS,
        "effectiveTheme",
        seasonal.ambience().effectiveTheme(LocalDate.now()).name()
    ));
    checks.add(check(DoctorLevel.PASS, "lobbyPlayers", Integer.toString(status.lobbyPlayerCount())));

    return checks;
  }

  private static DoctorCheck check(DoctorLevel level, String label, String detail) {
    return new DoctorCheck(level, label, detail);
  }
}
