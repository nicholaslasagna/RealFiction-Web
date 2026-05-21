package com.realfiction.realcore.scoreboard;

import com.realfiction.realcore.lobby.LobbyConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import com.realfiction.realcore.text.Text;
import java.util.List;
import java.util.function.Supplier;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.bukkit.scoreboard.Criteria;
import org.bukkit.scoreboard.DisplaySlot;
import org.bukkit.scoreboard.Objective;
import org.bukkit.scoreboard.Scoreboard;
import org.bukkit.scoreboard.ScoreboardManager;
import org.bukkit.scoreboard.Team;

/**
 * Per-player sidebar scoreboard. The global tick reads server-wide counts; each
 * player's board is built and applied on that player's scheduler (Folia-safe).
 * Lines use stable team entries to avoid flicker between refreshes.
 */
public final class ScoreboardService {
  private static final String OBJECTIVE = "realcore";
  private static final int MAX_LINES = 15;
  private static final LegacyComponentSerializer LEGACY = LegacyComponentSerializer.legacySection();

  private final RealCoreScheduler scheduler;
  private final Supplier<LobbyConfig> configSupplier;
  private ScheduledTaskHandle task;

  public ScoreboardService(Plugin plugin, RealCoreScheduler scheduler, Supplier<LobbyConfig> configSupplier) {
    this.scheduler = scheduler;
    this.configSupplier = configSupplier;
  }

  public void start() {
    stop();
    LobbyConfig config = configSupplier.get();
    long period = config == null ? 20L : config.scoreboard().refreshTicks();
    task = scheduler.runGlobalRepeating(this::tick, period, period);
  }

  public void stop() {
    if (task != null) {
      task.cancel();
      task = null;
    }
  }

  private void tick() {
    LobbyConfig config = configSupplier.get();
    if (config == null || !config.scoreboard().enabled()) {
      return;
    }
    int online = Bukkit.getOnlinePlayers().size();
    int maxOnline = Bukkit.getMaxPlayers();
    for (Player player : Bukkit.getOnlinePlayers()) {
      scheduler.runForPlayer(player, () -> updatePlayer(player, config, online, maxOnline));
    }
  }

  public void clearFor(Player player) {
    scheduler.runForPlayer(player, () -> resetToMain(player));
  }

  /** Applies the scoreboard to a single player immediately (e.g. on join). */
  public void refresh(Player player) {
    LobbyConfig config = configSupplier.get();
    if (config == null || !config.scoreboard().enabled()) {
      return;
    }
    scheduler.runGlobal(() -> {
      int online = Bukkit.getOnlinePlayers().size();
      int maxOnline = Bukkit.getMaxPlayers();
      scheduler.runForPlayer(player, () -> updatePlayer(player, config, online, maxOnline));
    });
  }

  private void updatePlayer(Player player, LobbyConfig config, int online, int maxOnline) {
    if (!player.isOnline()) {
      return;
    }
    ScoreboardManager manager = Bukkit.getScoreboardManager();
    if (manager == null) {
      return;
    }
    if (!config.isLobbyWorld(player.getWorld().getName())) {
      resetToMain(player);
      return;
    }

    Scoreboard board = player.getScoreboard();
    if (board == null || board.getObjective(OBJECTIVE) == null) {
      board = manager.getNewScoreboard();
    }

    Objective objective = board.getObjective(OBJECTIVE);
    Component title = component(Text.color(config.scoreboard().title()));
    if (objective == null) {
      objective = board.registerNewObjective(OBJECTIVE, Criteria.DUMMY, title);
      objective.setDisplaySlot(DisplaySlot.SIDEBAR);
    } else {
      objective.displayName(title);
    }

    List<String> lines = config.scoreboard().lines();
    int size = Math.min(lines.size(), MAX_LINES);
    for (int i = 0; i < size; i++) {
      String content = Text.color(
          Text.placeholders(lines.get(i), player.getName(), player.getUniqueId().toString(), online, maxOnline));
      String entry = lineEntry(i);
      Team team = board.getTeam("rc_line_" + i);
      if (team == null) {
        team = board.registerNewTeam("rc_line_" + i);
      }
      if (!team.hasEntry(entry)) {
        team.addEntry(entry);
      }
      team.prefix(component(content));
      objective.getScore(entry).setScore(size - i);
    }
    for (int i = size; i < MAX_LINES; i++) {
      board.resetScores(lineEntry(i));
      Team team = board.getTeam("rc_line_" + i);
      if (team != null) {
        team.unregister();
      }
    }

    if (player.getScoreboard() != board) {
      player.setScoreboard(board);
    }
  }

  private void resetToMain(Player player) {
    ScoreboardManager manager = Bukkit.getScoreboardManager();
    if (manager == null) {
      return;
    }
    Scoreboard current = player.getScoreboard();
    if (current != null && current.getObjective(OBJECTIVE) != null) {
      player.setScoreboard(manager.getMainScoreboard());
    }
  }

  private static Component component(String legacy) {
    return LEGACY.deserialize(legacy);
  }

  private static String lineEntry(int index) {
    // Distinct, invisible per-line entry so identical line text never collides.
    return ChatColor.values()[index % ChatColor.values().length].toString() + ChatColor.RESET;
  }
}
