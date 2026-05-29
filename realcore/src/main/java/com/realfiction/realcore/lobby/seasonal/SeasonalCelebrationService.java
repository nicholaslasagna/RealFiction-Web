package com.realfiction.realcore.lobby.seasonal;

import com.realfiction.realcore.lobby.LobbyConfig;
import com.realfiction.realcore.lobby.LobbyManager;
import com.realfiction.realcore.luckperms.LuckPermsService;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
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
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Supplier;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.Color;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.SoundCategory;
import org.bukkit.World;
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
    // US 250: "250 YEARS" tagline (Phase 3 spec — the headline text for
    // the America 250 anniversary celebration). The bitmap font already has
    // every glyph needed: 2, 5, 0, space, Y, E, A, R, S.
    BANNERS.put(SeasonalAmbienceTheme.US250_INDEPENDENCE_DAY,
        new Banner("REALFICTION", "250 YEARS", Color.WHITE, Color.fromRGB(255, 215, 0)));
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

  // === US 250 founding-permission constants ===
  static final String US250_FOUNDING_PERMISSION = "realfiction.event.us250.founding";
  static final String US250_FOUNDING_LEDGER_FILENAME = "us250-founders.txt";

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
  private final Set<String> firedAnthemKeys = ConcurrentHashMap.newKeySet();
  private final Map<String, Integer> broadcastCycleIndex = new ConcurrentHashMap<>();
  private volatile boolean running;
  private volatile String lastFailure = "";

  // === US 250 founding-permission state (Phase 3) ===
  /**
   * Optional LuckPerms reference for granting the founding permission.
   * Injected post-construction via {@link #configureUs250Founding} once
   * the plugin has finished booting LuckPerms (LuckPerms is created
   * AFTER LobbyManager in RealCorePlugin, so it can't be constructor-
   * injected here). If null, founding grants are skipped with a logged
   * warning rather than failing the midnight tick.
   */
  private volatile LuckPermsService luckPerms;
  /**
   * Append-only ledger file: one UUID per line. Used to prove a player
   * has already received the founding permission so a server restart or
   * a second/third time-zone midnight tick doesn't re-grant.
   */
  private volatile File foundingLedgerFile;
  /**
   * In-memory mirror of the ledger file, loaded on {@link
   * #configureUs250Founding} and updated atomically when we grant.
   * Backed by {@link ConcurrentHashMap#newKeySet()} so the midnight
   * tick (global scheduler thread) and the LuckPerms async callback
   * (LuckPerms internal executor) can both touch it safely.
   */
  private final Set<UUID> foundingGranted = ConcurrentHashMap.newKeySet();

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

  /**
   * Post-construction injection of the LuckPerms hook + plugin data
   * folder used by the US 250 midnight prestige grant.
   *
   * The plugin boot order in {@code RealCorePlugin} is LobbyManager
   * first, then LuckPerms — so we can't take these as constructor args.
   * The plugin calls this once after both services are alive.
   *
   * Loads any existing entries from the founding ledger into the
   * in-memory dedup set so a restart between time-zone midnight ticks
   * (or between holidays) does NOT cause double-grants.
   *
   * Safe to call with {@code luckPerms = null} or {@code dataFolder =
   * null} — the grant path skips with a logged warning rather than
   * crashing the midnight tick.
   */
  public synchronized void configureUs250Founding(LuckPermsService luckPerms, File pluginDataFolder) {
    this.luckPerms = luckPerms;
    if (pluginDataFolder == null) {
      this.foundingLedgerFile = null;
      logger.info("US 250 founding ledger: plugin data folder null, persistence disabled");
      return;
    }
    if (!pluginDataFolder.exists() && !pluginDataFolder.mkdirs()) {
      logger.warning("US 250 founding ledger: could not create plugin data folder "
          + pluginDataFolder.getPath());
      this.foundingLedgerFile = null;
      return;
    }
    this.foundingLedgerFile = new File(pluginDataFolder, US250_FOUNDING_LEDGER_FILENAME);
    loadFoundingLedger();
  }

  private void loadFoundingLedger() {
    File file = foundingLedgerFile;
    if (file == null || !file.exists()) {
      return;
    }
    try {
      List<String> lines = Files.readAllLines(file.toPath(), StandardCharsets.UTF_8);
      int loaded = 0;
      for (String raw : lines) {
        String line = raw.trim();
        if (line.isEmpty() || line.startsWith("#")) {
          continue;
        }
        try {
          if (foundingGranted.add(UUID.fromString(line))) {
            loaded++;
          }
        } catch (IllegalArgumentException ignore) {
          logger.fine("US 250 founding ledger: skipping non-UUID line '" + line + "'");
        }
      }
      logger.info("US 250 founding ledger loaded with " + loaded + " entries from " + file.getPath());
    } catch (IOException error) {
      logger.log(Level.WARNING, "Could not read US 250 founding ledger at " + file.getPath(), error);
    }
  }

  private synchronized void appendToFoundingLedger(UUID uuid) {
    File file = foundingLedgerFile;
    if (file == null) {
      return;
    }
    try (PrintWriter writer = new PrintWriter(
        new FileOutputStream(file, true), true, StandardCharsets.UTF_8)) {
      writer.println(uuid.toString());
    } catch (IOException error) {
      logger.log(Level.WARNING,
          "Could not append " + uuid + " to US 250 founding ledger at " + file.getPath(),
          error);
    }
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
      // US 250 specifically gets the big midnight visual show + the
      // founding-permission grant. Other patriotic events still get the
      // anthem + announce above but skip the big show / grant.
      if (event.ambienceTheme() == SeasonalAmbienceTheme.US250_INDEPENDENCE_DAY) {
        runUs250MidnightBigShow(zone);
        grantUs250FoundingToLobbyPlayers();
      }
    }
  }

  // === US 250 midnight big show ===

  /**
   * Crazy red/white/blue/gold lobby show stacked on top of the regular
   * anthem path. Four expanding firework rings, a heavy patriotic dust
   * storm, the REALFICTION / 250 YEARS banner force-painted, and a
   * full-screen Title + ActionBar for every lobby player. All work
   * dispatched through the scheduler — Folia safe.
   */
  private void runUs250MidnightBigShow(ZoneEntry zone) {
    SeasonalShowOrigin origin = ambience.origin();
    if (!origin.valid()) {
      logger.warning("US 250 midnight big show skipped: no valid origin");
      return;
    }
    Location anchor = origin.location();

    sendUs250MidnightTitle(zone);

    // Force-paint the REALFICTION / 250 YEARS sky banner immediately
    // (do not wait for the next 60s banner tick).
    SeasonalParticleTextRenderer.renderBanner(
        scheduler, anchor,
        "REALFICTION", "250 YEARS",
        Color.fromRGB(220, 32, 48),  // red
        Color.fromRGB(255, 215, 0)   // gold
    );

    // Four expanding firework rings: red/white/blue palette plus a
    // gold-accent variant. Each ring delayed so they read as a
    // ramping-up climax instead of one chaotic flash.
    SeasonalEffectPalette patriotic = SeasonalEffectPalette.patriotic();
    SeasonalEffectPalette gold = new SeasonalEffectPalette(
        Color.fromRGB(255, 215, 0),
        Color.fromRGB(220, 32, 48),
        Color.fromRGB(28, 73, 209),
        Color.WHITE,
        org.bukkit.FireworkEffect.Type.STAR);

    scheduleRingFor(anchor, 12, patriotic, 0L);
    scheduleRingFor(anchor, 16, gold,      30L);   // +1.5s
    scheduleRingFor(anchor, 20, patriotic, 60L);   // +3.0s
    scheduleRingFor(anchor, 24, gold,      100L);  // +5.0s — climax

    // Heavy patriotic dust storm at t=0.
    schedulePatrioticParticleStorm(anchor);
  }

  private void scheduleRingFor(Location anchor, int count, SeasonalEffectPalette palette, long delayTicks) {
    ScheduledTaskHandle handle = scheduler.runGlobalLater(
        () -> fireworkShowService.launchRing(anchor, count, palette),
        delayTicks);
    if (handle == null) {
      // Scheduler refused; fall back to immediate fire so we don't
      // silently drop a ring.
      fireworkShowService.launchRing(anchor, count, palette);
    }
  }

  private void schedulePatrioticParticleStorm(Location anchor) {
    scheduler.runGlobal(() -> {
      World world = anchor.getWorld();
      if (world == null) {
        return;
      }
      ThreadLocalRandom random = ThreadLocalRandom.current();
      // Big visible bursts above the spawn.
      world.spawnParticle(Particle.FIREWORK, anchor.clone().add(0, 5, 0), 80, 8, 4, 8, 0.1);
      world.spawnParticle(Particle.TOTEM_OF_UNDYING, anchor.clone().add(0, 4, 0), 40, 6, 3, 6, 0.05);

      Particle.DustOptions red = new Particle.DustOptions(Color.fromRGB(220, 32, 48), 1.6f);
      Particle.DustOptions white = new Particle.DustOptions(Color.WHITE, 1.6f);
      Particle.DustOptions blue = new Particle.DustOptions(Color.fromRGB(28, 73, 209), 1.6f);
      Particle.DustOptions gold = new Particle.DustOptions(Color.fromRGB(255, 215, 0), 1.4f);
      for (int i = 0; i < 60; i++) {
        double angle = random.nextDouble() * Math.PI * 2;
        double radius = 4 + random.nextDouble() * 8;
        double y = 2 + random.nextDouble() * 6;
        Location point = anchor.clone().add(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
        Particle.DustOptions choice = switch (i % 4) {
          case 0 -> red;
          case 1 -> white;
          case 2 -> blue;
          default -> gold;
        };
        world.spawnParticle(Particle.DUST, point, 4, 0.3, 0.3, 0.3, 0, choice, true);
      }
    });
  }

  private void sendUs250MidnightTitle(ZoneEntry zone) {
    LobbyManager lobby = lobbySupplier.get();
    if (lobby == null) {
      return;
    }
    LobbyConfig config = lobby.config();
    String title = "§c§l✯ §e§lUS 250 §c§l✯";
    String subtitle = "§f§l250 YEARS";
    String actionBar = "§6§lMIDNIGHT §7— §f§lRealFiction§6§l celebrates §c§lAmerica's 250th §7("
        + zone.label() + ")";
    for (Player player : Bukkit.getOnlinePlayers()) {
      if (player.getWorld() != null && config.isLobbyWorld(player.getWorld().getName())) {
        scheduler.runForPlayer(player, () -> {
          if (!player.isOnline()) {
            return;
          }
          // Long fade-in / hold / fade-out so the title reads as the
          // climax of the show, not a tooltip flash.
          player.sendTitle(title, subtitle, 10, 100, 30);
          player.sendActionBar(actionBar);
        });
      }
    }
  }

  /**
   * One-time LuckPerms prestige grant. Idempotent: dedup'd through both
   * the in-memory {@link #foundingGranted} set AND the persisted
   * {@link #foundingLedgerFile} so a restart between time-zone midnight
   * ticks (or between event years) does NOT double-grant.
   *
   * The actual permission write goes through {@code LuckPermsService.
   * grantPermission(uuid, permission, duration)} with {@code duration =
   * null} — confirmed permanent (no expiry node attached).
   *
   * If LuckPerms isn't available (plugin not installed / not yet loaded)
   * the call logs a warning and continues so the rest of the midnight
   * show still fires.
   */
  private void grantUs250FoundingToLobbyPlayers() {
    LuckPermsService perms = this.luckPerms;
    if (perms == null || !perms.available()) {
      logger.warning("US 250 founding grant skipped: LuckPerms not available");
      return;
    }
    LobbyManager lobby = lobbySupplier.get();
    if (lobby == null) {
      return;
    }
    LobbyConfig config = lobby.config();
    int newGrants = 0;
    for (Player player : Bukkit.getOnlinePlayers()) {
      if (player.getWorld() == null || !config.isLobbyWorld(player.getWorld().getName())) {
        continue;
      }
      UUID uuid = player.getUniqueId();
      // ConcurrentHashMap-backed set: add() returns false if already
      // present so we won't try to write the ledger twice for the same
      // UUID even under concurrent zone ticks.
      if (!foundingGranted.add(uuid)) {
        continue;
      }
      appendToFoundingLedger(uuid);
      newGrants++;
      String playerName = player.getName();
      perms.grantPermission(uuid, US250_FOUNDING_PERMISSION, null)
          .whenComplete((unused, error) -> {
            if (error != null) {
              logger.log(Level.WARNING,
                  "US 250 founding grant failed for " + uuid + " (" + playerName + ")",
                  error);
              // Don't roll back the ledger — the failure could be
              // transient and the player can be re-granted manually by
              // an admin. Removing from the ledger would risk the next
              // tick double-granting if LuckPerms recovers.
            } else {
              logger.info("US 250 founding permission granted to " + uuid + " (" + playerName + ")");
            }
          });
    }
    if (newGrants > 0) {
      logger.info("US 250 midnight: granted " + US250_FOUNDING_PERMISSION + " to "
          + newGrants + " player(s) this tick");
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
