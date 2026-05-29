package com.realfiction.realcore.lobby.seasonal;

import com.realfiction.realcore.lobby.LobbyConfig;
import com.realfiction.realcore.lobby.LobbyManager;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.Month;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Supplier;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.Color;
import org.bukkit.Location;
import org.bukkit.Sound;
import org.bukkit.SoundCategory;
import org.bukkit.entity.Player;

/**
 * Big-show layer on top of the spawn ambience particles.
 *
 * The existing {@link SeasonalSpawnAmbienceService} already runs the gentle
 * particle-and-sound ticks across the calendar window
 * ({@link SeasonalEventWindow#aroundHoliday(LocalDate)} — 15 days before
 * through 5 days after the holiday). This service stacks the "this is a
 * holiday" feel:
 *
 * <ul>
 *   <li><b>Distant fireworks.</b> Every ~90 seconds during the window, a
 *       handful of fireworks pop in the sky at a random distance from the
 *       lobby spawn so it reads as a fireworks show somewhere out beyond
 *       the build, not on top of the player.</li>
 *   <li><b>REALFICTION sky banner.</b> Every ~60 seconds the
 *       {@link SeasonalParticleTextRenderer} paints "REALFICTION" and a
 *       per-theme tagline overhead in theme colors.</li>
 *   <li><b>Themed broadcasts.</b> Every ~6 minutes a chat line goes out to
 *       lobby players from a per-theme pool ("Happy Independence Day", "On
 *       Memorial Day we remember...", etc.). Cycled so the same line never
 *       fires twice in a row.</li>
 *   <li><b>US national anthem at midnight.</b> For patriotic events
 *       (Independence Day, Memorial Day, Veterans Day, US 250) a
 *       transposed Star-Spangled Banner opening line plays through
 *       Minecraft note-block sounds when the clock strikes midnight in
 *       <i>Eastern, Central, and Pacific</i> time on the holiday's peak
 *       date — three plays so US players in any zone hear it as it
 *       crosses midnight locally.</li>
 * </ul>
 *
 * Folia-safe: every world/entity interaction is dispatched through
 * {@link RealCoreScheduler}'s global or per-player paths.
 */
public final class SeasonalCelebrationService {
  // === cadence (ticks; 20 ticks = 1 second) ===
  private static final long FIREWORK_PERIOD_TICKS = 1800L;       // ~90s
  private static final long BANNER_PERIOD_TICKS = 1200L;         // ~60s
  private static final long BROADCAST_PERIOD_TICKS = 7200L;      // ~6 min
  private static final long MIDNIGHT_CHECK_PERIOD_TICKS = 600L;  // ~30s

  // === distant firework geometry ===
  private static final int FIREWORK_MIN_DISTANCE = 55;
  private static final int FIREWORK_MAX_DISTANCE = 110;
  private static final int FIREWORK_MIN_COUNT = 3;
  private static final int FIREWORK_MAX_COUNT = 7;
  private static final int FIREWORK_SKY_OFFSET_MIN = 20;
  private static final int FIREWORK_SKY_OFFSET_MAX = 38;

  // === US time zones that get the anthem at midnight ===
  private static final List<ZoneEntry> US_MIDNIGHT_ZONES = List.of(
      new ZoneEntry("EST/EDT", ZoneId.of("America/New_York")),
      new ZoneEntry("CST/CDT", ZoneId.of("America/Chicago")),
      new ZoneEntry("PST/PDT", ZoneId.of("America/Los_Angeles"))
  );

  // === Star-Spangled Banner opening phrase, transposed to fit the
  // Minecraft note-block range (F#3..F#5 = pitch 0.5..2.0).
  //   "Oh-oh, say can you see, by the dawn's early light..."
  // delayTicks are relative to t=0 (the first note). ===
  private static final List<AnthemNote> ANTHEM = List.of(
      new AnthemNote(0,   0.707f),  // "Oh"      C4
      new AnthemNote(10,  0.707f),  // "oh"      C4
      new AnthemNote(22,  0.944f),  // "say"     F4
      new AnthemNote(34,  1.189f),  // "can"     A4
      new AnthemNote(46,  1.414f),  // "you"     C5
      new AnthemNote(58,  1.888f),  // "see,"    F5  (climax)
      new AnthemNote(82,  1.782f),  // "by"      E5
      new AnthemNote(94,  1.587f),  // "the"     D5
      new AnthemNote(106, 1.414f),  // "dawn's"  C5
      new AnthemNote(118, 1.189f),  // "ear-"    A4
      new AnthemNote(130, 0.944f),  // "-ly"     F4
      new AnthemNote(142, 1.189f),  // "light"   A4
      new AnthemNote(166, 0.944f)   // tail resolution F4
  );

  // === per-theme banner copy + colors. Top line is always REALFICTION
  // so the brand stays anchored; bottom line is a short tagline using
  // letters present in ParticleBitmapFont. ===
  private static final Map<SeasonalAmbienceTheme, Banner> BANNERS = new HashMap<>();
  static {
    BANNERS.put(SeasonalAmbienceTheme.INDEPENDENCE_DAY,
        new Banner("REALFICTION", "USA", Color.fromRGB(220, 32, 48), Color.fromRGB(28, 73, 209)));
    BANNERS.put(SeasonalAmbienceTheme.US250_INDEPENDENCE_DAY,
        new Banner("REALFICTION", "USA 250", Color.WHITE, Color.fromRGB(28, 73, 209)));
    BANNERS.put(SeasonalAmbienceTheme.MEMORIAL_DAY,
        new Banner("REALFICTION", "HONOR THEM", Color.WHITE, Color.fromRGB(28, 73, 209)));
    BANNERS.put(SeasonalAmbienceTheme.VETERANS_DAY,
        new Banner("REALFICTION", "THANK YOU", Color.WHITE, Color.fromRGB(220, 32, 48)));
    BANNERS.put(SeasonalAmbienceTheme.CHRISTMAS,
        new Banner("REALFICTION", "MERRY", Color.fromRGB(40, 175, 60), Color.fromRGB(220, 32, 48)));
    BANNERS.put(SeasonalAmbienceTheme.NEW_YEARS,
        new Banner("REALFICTION", "CHEERS", Color.fromRGB(255, 215, 0), Color.WHITE));
    BANNERS.put(SeasonalAmbienceTheme.CHINESE_NEW_YEAR,
        new Banner("REALFICTION", "LUNAR", Color.fromRGB(255, 215, 0), Color.fromRGB(220, 32, 48)));
    BANNERS.put(SeasonalAmbienceTheme.VALENTINES_DAY,
        new Banner("REALFICTION", "HEARTS", Color.fromRGB(255, 105, 180), Color.fromRGB(220, 32, 48)));
    BANNERS.put(SeasonalAmbienceTheme.EASTER,
        new Banner("REALFICTION", "EASTER", Color.fromRGB(255, 182, 193), Color.fromRGB(186, 222, 255)));
    BANNERS.put(SeasonalAmbienceTheme.THANKSGIVING,
        new Banner("REALFICTION", "THANKS", Color.fromRGB(255, 140, 0), Color.fromRGB(165, 79, 32)));
    BANNERS.put(SeasonalAmbienceTheme.HANUKKAH,
        new Banner("REALFICTION", "SHALOM", Color.fromRGB(80, 160, 255), Color.WHITE));
    // HALLOWEEN intentionally banner-less — its W glyph isn't in the
    // bitmap font yet, so we just paint REALFICTION solo on orange.
    BANNERS.put(SeasonalAmbienceTheme.HALLOWEEN,
        new Banner("REALFICTION", null, Color.fromRGB(255, 140, 0), Color.fromRGB(128, 0, 128)));
  }

  // === themed broadcast pool. Vanilla Bukkit chat colors so they look
  // right in console + in-game even without resource packs. ===
  private static final Map<SeasonalAmbienceTheme, List<String>> BROADCASTS = new HashMap<>();
  static {
    BROADCASTS.put(SeasonalAmbienceTheme.INDEPENDENCE_DAY, List.of(
        "§e§lRealFiction §7| §6Happy Independence Day! §7Fireworks light up the sky around the lobby.",
        "§e§lRealFiction §7| §c§lRed§r§7, §f§lwhite§r§7, and §9§lblue§r§7 — find a high vantage and enjoy the show.",
        "§e§lRealFiction §7| §6Look up — the sparkles spell §e§lREALFICTION§r §6overhead during the holiday."
    ));
    BROADCASTS.put(SeasonalAmbienceTheme.US250_INDEPENDENCE_DAY, List.of(
        "§e§lRealFiction §7| §6§lAmerica 250§r §7— special event running across the network.",
        "§e§lRealFiction §7| §6Banner overhead reads §e§lREALFICTION §6today. Look up!",
        "§e§lRealFiction §7| §6Big fireworks every couple of minutes. Stick around."
    ));
    BROADCASTS.put(SeasonalAmbienceTheme.MEMORIAL_DAY, List.of(
        "§e§lRealFiction §7| §6On §c§lMemorial Day§r §6we remember those who served. §7Take a moment."
    ));
    BROADCASTS.put(SeasonalAmbienceTheme.VETERANS_DAY, List.of(
        "§e§lRealFiction §7| §6Honoring veterans across the network today. §7Thank you for your service."
    ));
    BROADCASTS.put(SeasonalAmbienceTheme.CHRISTMAS, List.of(
        "§e§lRealFiction §7| §a§lMerry Christmas§r §6from the whole crew.",
        "§e§lRealFiction §7| §6Snow drifts overhead — sky banner is live in the lobby."
    ));
    BROADCASTS.put(SeasonalAmbienceTheme.NEW_YEARS, List.of(
        "§e§lRealFiction §7| §a§lHappy New Year!§r §6Big fireworks rolling all night.",
        "§e§lRealFiction §7| §6Look up — sparkle banner spells §e§lREALFICTION §6overhead."
    ));
    BROADCASTS.put(SeasonalAmbienceTheme.CHINESE_NEW_YEAR, List.of(
        "§e§lRealFiction §7| §6§lLunar New Year§r §6celebrations are live in the lobby."
    ));
    BROADCASTS.put(SeasonalAmbienceTheme.VALENTINES_DAY, List.of(
        "§e§lRealFiction §7| §c§lHappy Valentine's Day§r §6from the lobby crew."
    ));
    BROADCASTS.put(SeasonalAmbienceTheme.HALLOWEEN, List.of(
        "§e§lRealFiction §7| §6Spooky season is in full swing. §7Stay close to the torchlight.",
        "§e§lRealFiction §7| §6Bats overhead, pumpkins everywhere — happy Halloween!"
    ));
    BROADCASTS.put(SeasonalAmbienceTheme.EASTER, List.of(
        "§e§lRealFiction §7| §d§lHappy Easter§r §6from RealFiction."
    ));
    BROADCASTS.put(SeasonalAmbienceTheme.THANKSGIVING, List.of(
        "§e§lRealFiction §7| §6Happy §a§lThanksgiving§r §6— grateful you're on the network."
    ));
    BROADCASTS.put(SeasonalAmbienceTheme.HANUKKAH, List.of(
        "§e§lRealFiction §7| §b§lHappy Hanukkah§r §6from the network."
    ));
  }

  // === dependencies ===
  private final RealCoreScheduler scheduler;
  private final Supplier<LobbyManager> lobbySupplier;
  private final FireworkShowService fireworkShowService;
  private final SeasonalSpawnAmbienceService ambience;
  private final Logger logger;

  // === runtime state ===
  private ScheduledTaskHandle fireworksTask;
  private ScheduledTaskHandle bannerTask;
  private ScheduledTaskHandle broadcastTask;
  private ScheduledTaskHandle midnightTask;
  /**
   * Anthem dedup key set: "{themeId}|{zone}|{localDate}". The midnight
   * task fires only when the matching key isn't already present, then
   * adds it. Survives only for the JVM lifetime, which is exactly the
   * window we care about — a server restart between the same zone's
   * midnight and the next zone's midnight is rare enough to accept a
   * duplicate.
   */
  private final java.util.Set<String> firedAnthemKeys = ConcurrentHashMap.newKeySet();
  private final Map<String, Integer> broadcastCycleIndex = new ConcurrentHashMap<>();
  private volatile boolean running;
  private volatile String lastFailure = "";

  public SeasonalCelebrationService(
      RealCoreScheduler scheduler,
      Supplier<LobbyManager> lobbySupplier,
      SeasonalSpawnAmbienceService ambience,
      Logger logger
  ) {
    this.scheduler = scheduler;
    this.lobbySupplier = lobbySupplier;
    this.ambience = ambience;
    this.fireworkShowService = new FireworkShowService(scheduler);
    this.logger = logger;
  }

  public void start() {
    stop();
    LobbyManager lobby = lobbySupplier.get();
    if (lobby == null || !lobby.config().enabled()) {
      return;
    }
    fireworksTask = scheduler.runGlobalRepeating(
        this::fireworksTick, FIREWORK_PERIOD_TICKS, FIREWORK_PERIOD_TICKS);
    bannerTask = scheduler.runGlobalRepeating(
        this::bannerTick, BANNER_PERIOD_TICKS, BANNER_PERIOD_TICKS);
    broadcastTask = scheduler.runGlobalRepeating(
        this::broadcastTick, BROADCAST_PERIOD_TICKS, BROADCAST_PERIOD_TICKS);
    midnightTask = scheduler.runGlobalRepeating(
        this::midnightTick, MIDNIGHT_CHECK_PERIOD_TICKS, MIDNIGHT_CHECK_PERIOD_TICKS);
    running = true;
  }

  public void stop() {
    if (fireworksTask != null) {
      fireworksTask.cancel();
      fireworksTask = null;
    }
    if (bannerTask != null) {
      bannerTask.cancel();
      bannerTask = null;
    }
    if (broadcastTask != null) {
      broadcastTask.cancel();
      broadcastTask = null;
    }
    if (midnightTask != null) {
      midnightTask.cancel();
      midnightTask = null;
    }
    running = false;
  }

  public void reload() {
    stop();
    LobbyManager lobby = lobbySupplier.get();
    if (lobby != null && lobby.config().enabled()) {
      start();
    }
  }

  public boolean running() {
    return running;
  }

  public String lastFailure() {
    return lastFailure;
  }

  // === firework tick — distant ring of bursts at random sky locations ===
  private void fireworksTick() {
    SeasonalEventDefinition event = ambience.effectiveEvent(LocalDate.now());
    if (event == null) {
      return;
    }
    SeasonalShowOrigin origin = ambience.origin();
    if (!origin.valid() || ambience.lobbyPlayerCount() <= 0) {
      return;
    }
    Location anchor = origin.location();
    SeasonalEffectPalette palette = SeasonalEffectPalette.generic(event.ambienceTheme());

    ThreadLocalRandom random = ThreadLocalRandom.current();
    int count = FIREWORK_MIN_COUNT + random.nextInt(FIREWORK_MAX_COUNT - FIREWORK_MIN_COUNT + 1);
    for (int i = 0; i < count; i++) {
      double angle = random.nextDouble() * Math.PI * 2;
      double distance = FIREWORK_MIN_DISTANCE
          + random.nextDouble() * (FIREWORK_MAX_DISTANCE - FIREWORK_MIN_DISTANCE);
      double skyOffset = FIREWORK_SKY_OFFSET_MIN
          + random.nextDouble() * (FIREWORK_SKY_OFFSET_MAX - FIREWORK_SKY_OFFSET_MIN);
      Location pad = anchor.clone().add(
          Math.cos(angle) * distance,
          skyOffset,
          Math.sin(angle) * distance
      );
      // Each burst goes through the scheduler internally — FireworkShowService
      // already dispatches via runGlobal, so this loop is Folia-safe.
      fireworkShowService.burstAt(pad, palette);
    }
  }

  // === banner tick — paint REALFICTION + per-theme tagline overhead ===
  private void bannerTick() {
    SeasonalEventDefinition event = ambience.effectiveEvent(LocalDate.now());
    if (event == null) {
      return;
    }
    SeasonalShowOrigin origin = ambience.origin();
    if (!origin.valid() || ambience.lobbyPlayerCount() <= 0) {
      return;
    }
    Banner banner = BANNERS.getOrDefault(
        event.ambienceTheme(),
        new Banner("REALFICTION", null, Color.fromRGB(255, 215, 0), Color.WHITE));
    Location anchor = origin.location();
    if (banner.bottom() == null) {
      SeasonalParticleTextRenderer.renderLine(scheduler, anchor, banner.top(), banner.topColor(), 0.0D);
      return;
    }
    SeasonalParticleTextRenderer.renderBanner(
        scheduler, anchor, banner.top(), banner.bottom(), banner.topColor(), banner.bottomColor());
  }

  // === broadcast tick — themed chat message to everyone in lobby worlds ===
  private void broadcastTick() {
    SeasonalEventDefinition event = ambience.effectiveEvent(LocalDate.now());
    if (event == null) {
      return;
    }
    SeasonalAmbienceTheme theme = event.ambienceTheme();
    List<String> pool = BROADCASTS.get(theme);
    if (pool == null || pool.isEmpty()) {
      return;
    }
    int index = broadcastCycleIndex.compute(event.id(), (id, current) ->
        current == null ? 0 : (current + 1) % pool.size());
    String line = pool.get(index);
    LobbyManager lobby = lobbySupplier.get();
    if (lobby == null) {
      return;
    }
    LobbyConfig config = lobby.config();
    for (Player player : Bukkit.getOnlinePlayers()) {
      if (player.getWorld() != null && config.isLobbyWorld(player.getWorld().getName())) {
        // sendMessage is safe off-thread on Paper; scheduler.send also
        // re-dispatches per-player for Folia safety.
        scheduler.send(player, line);
      }
    }
  }

  // === midnight tick — check each US zone, fire the anthem at 00:00 ===
  private void midnightTick() {
    SeasonalEventDefinition event = ambience.effectiveEvent(LocalDate.now());
    if (event == null || !isAnthemTheme(event.ambienceTheme())) {
      return;
    }
    LocalDate peak = anthemPeakDay(event.ambienceTheme(), LocalDate.now().getYear());
    if (peak == null) {
      return;
    }

    for (ZoneEntry zone : US_MIDNIGHT_ZONES) {
      ZonedDateTime now = ZonedDateTime.now(zone.zoneId());
      LocalDate localDate = now.toLocalDate();
      if (!localDate.equals(peak)) {
        // Only fire on the holiday's local-zone peak day.
        continue;
      }
      // Window: 00:00 .. 00:00 + (MIDNIGHT_CHECK_PERIOD_TICKS / 20) seconds.
      // We allow a few extra seconds of slack so a slightly-late tick still
      // counts as midnight.
      LocalDateTime startOfDay = localDate.atStartOfDay();
      Duration sinceMidnight = Duration.between(startOfDay, now.toLocalDateTime());
      long allowedSlackSeconds = (MIDNIGHT_CHECK_PERIOD_TICKS / 20L) + 15L;
      if (sinceMidnight.isNegative() || sinceMidnight.getSeconds() > allowedSlackSeconds) {
        continue;
      }
      String key = event.id() + "|" + zone.label() + "|" + localDate;
      if (!firedAnthemKeys.add(key)) {
        continue;
      }
      logger.log(Level.INFO,
          "Seasonal anthem firing for event=" + event.id() + " zone=" + zone.label()
              + " localDate=" + localDate);
      announceAnthem(event, zone);
      playAnthemForAllLobbyPlayers();
    }
  }

  private void announceAnthem(SeasonalEventDefinition event, ZoneEntry zone) {
    LobbyManager lobby = lobbySupplier.get();
    if (lobby == null) {
      return;
    }
    LobbyConfig config = lobby.config();
    String message = "§e§lRealFiction §7| §6§lThe National Anthem§r §6"
        + "rings out as midnight strikes §f" + zone.label() + "§6 — "
        + "happy " + displayName(event) + ".";
    for (Player player : Bukkit.getOnlinePlayers()) {
      if (player.getWorld() != null && config.isLobbyWorld(player.getWorld().getName())) {
        scheduler.send(player, message);
      }
    }
  }

  private void playAnthemForAllLobbyPlayers() {
    LobbyManager lobby = lobbySupplier.get();
    if (lobby == null) {
      return;
    }
    LobbyConfig config = lobby.config();
    List<Player> audience = new ArrayList<>();
    for (Player player : Bukkit.getOnlinePlayers()) {
      if (player.getWorld() != null && config.isLobbyWorld(player.getWorld().getName())) {
        audience.add(player);
      }
    }
    for (Player player : audience) {
      schedulePlayerAnthem(player);
    }
  }

  private void schedulePlayerAnthem(Player player) {
    for (AnthemNote note : ANTHEM) {
      scheduler.runForPlayerLater(player, () -> {
        if (!player.isOnline()) {
          return;
        }
        player.playSound(player.getLocation(), Sound.BLOCK_NOTE_BLOCK_BELL,
            SoundCategory.AMBIENT, 0.85f, note.pitch());
      }, note.delayTicks());
    }
  }

  // === helpers ===

  static boolean isAnthemTheme(SeasonalAmbienceTheme theme) {
    return theme == SeasonalAmbienceTheme.INDEPENDENCE_DAY
        || theme == SeasonalAmbienceTheme.US250_INDEPENDENCE_DAY
        || theme == SeasonalAmbienceTheme.MEMORIAL_DAY
        || theme == SeasonalAmbienceTheme.VETERANS_DAY;
  }

  static LocalDate anthemPeakDay(SeasonalAmbienceTheme theme, int year) {
    return switch (theme) {
      case INDEPENDENCE_DAY, US250_INDEPENDENCE_DAY -> LocalDate.of(year, Month.JULY, 4);
      case VETERANS_DAY -> LocalDate.of(year, Month.NOVEMBER, 11);
      case MEMORIAL_DAY -> HolidayDateRules.memorialDay(year);
      default -> null;
    };
  }

  private static String displayName(SeasonalEventDefinition event) {
    if (event == null || event.displayName() == null || event.displayName().isBlank()) {
      return "Holiday";
    }
    return event.displayName();
  }

  /** Snapshot for status/dump commands. */
  public Snapshot snapshot() {
    return new Snapshot(
        running,
        fireworksTask != null,
        bannerTask != null,
        broadcastTask != null,
        midnightTask != null,
        Collections.unmodifiableMap(new HashMap<>(broadcastCycleIndex)),
        firedAnthemKeys.size(),
        lastFailure);
  }

  /** A single note in the transposed Star-Spangled Banner opening phrase. */
  private record AnthemNote(long delayTicks, float pitch) {
  }

  private record ZoneEntry(String label, ZoneId zoneId) {
  }

  /** Two-line sky banner for a given theme; bottom may be null. */
  private record Banner(String top, String bottom, Color topColor, Color bottomColor) {
  }

  /** Status snapshot returned by {@link #snapshot()}. */
  public record Snapshot(
      boolean running,
      boolean fireworksTaskActive,
      boolean bannerTaskActive,
      boolean broadcastTaskActive,
      boolean midnightTaskActive,
      Map<String, Integer> broadcastCycleIndexByEvent,
      int firedAnthemKeyCount,
      String lastFailure
  ) {
    public String summary() {
      return String.format(
          Locale.ROOT,
          "running=%s fireworks=%s banner=%s broadcast=%s midnight=%s firedAnthems=%d",
          running, fireworksTaskActive, bannerTaskActive, broadcastTaskActive,
          midnightTaskActive, firedAnthemKeyCount);
    }
  }
}
