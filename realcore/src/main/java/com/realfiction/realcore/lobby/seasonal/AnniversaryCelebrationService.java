package com.realfiction.realcore.lobby.seasonal;

import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import com.realfiction.realcore.text.Text;
import java.time.Duration;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.logging.Level;
import java.util.logging.Logger;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.TextColor;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.title.Title;
import org.bukkit.Bukkit;
import org.bukkit.Color;
import org.bukkit.FireworkEffect;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.entity.Player;

/**
 * An extravagant ~30-second anniversary celebration with two themes:
 *
 * <ul>
 *   <li><b>LOVE</b> (the default / {@code true}): a romantic show — gold→pink→
 *       white gradient title, hearts of fireworks + heart particle outlines,
 *       sweet rotating lines, chimes.</li>
 *   <li><b>REALFICTION</b> ({@code false}): the network's own birthday — an
 *       equally huge, vibrant "thank you" — gold→aqua→white gradient, a STAR of
 *       fireworks, grateful community lines, and a triumphant fanfare.</li>
 * </ul>
 *
 * <p>Both paint a big "HAPPY N YEAR ANNIVERSARY" title + sky banner, rotating
 * actionbar/title/chat lines, a wide field of choreographed fireworks (a
 * sweeping outer ring + bursts spread well out around the center), floating
 * sparkle particles, and a grand finale.
 *
 * <h2>Safety / no crashes</h2>
 * <ul>
 *   <li>Only one celebration at a time (an {@link AtomicBoolean} guard).</li>
 *   <li>The repeating task is held and cancels itself after the run — nothing is
 *       left ticking.</li>
 *   <li>Every frame/effect is wrapped; the first failure is logged once (no
 *       per-tick spam) and can never break the loop.</li>
 *   <li>Particles are limited to no-data types (HEART, END_ROD, FIREWORK,
 *       TOTEM_OF_UNDYING) + DUST-with-data via {@link SeasonalParticleTextRenderer}.
 *       The crash-prone PORTAL/DRAGON_BREATH "missing Float" particles are
 *       deliberately avoided.</li>
 *   <li>Firework counts are capped per frame (never hundreds per tick).</li>
 *   <li>The center is a fixed cloned {@link Location}, so a player logging out
 *       mid-show never breaks it.</li>
 * </ul>
 *
 * <h2>Folia-safe</h2>
 * Timer via {@link RealCoreScheduler#runGlobalRepeating}; fireworks via
 * {@link FireworkShowService} and sky text via {@link SeasonalParticleTextRenderer}
 * (both scheduler-dispatched); titles/actionbars/sounds/particles per player via
 * {@link RealCoreScheduler#runForPlayer} / {@link RealCoreScheduler#runGlobal}.
 */
public final class AnniversaryCelebrationService {
  private static final long PERIOD_TICKS = 10L; // a frame every half second
  private static final int TOTAL_FRAMES = 60; // ~30 seconds
  private static final int FINALE_FRAME = 48; // last ~6 seconds ramp up

  private static final int MIN_PER_BURST = 3;
  private static final int MAX_PER_BURST = 6;
  private static final int FINALE_MIN_PER_BURST = 6;
  private static final int FINALE_MAX_PER_BURST = 10;
  // Wide field — reaches well beyond the old 7-block radius (~15 blocks further).
  private static final double INNER_SPREAD = 10.0D;
  private static final double OUTER_RING_RADIUS = 22.0D;
  private static final double HEIGHT_MIN = 4.0D; // overhead so blasts stay clear of players
  private static final double HEIGHT_VARIANCE = 8.0D;

  private static final int MESSAGE_EVERY_FRAMES = 4; // an actionbar line every ~2s
  private static final int TITLE_EVERY_FRAMES = 12; // a title flash every ~6s

  private static final int[] GRAD_WHITE = {255, 255, 255};

  private final RealCoreScheduler scheduler;
  private final Logger logger;
  private final FireworkShowService fireworks;
  private final AtomicBoolean running = new AtomicBoolean(false);
  private volatile ScheduledTaskHandle task;
  private volatile boolean loggedFrameFailure = false;

  public AnniversaryCelebrationService(RealCoreScheduler scheduler, Logger logger) {
    this.scheduler = scheduler;
    this.logger = logger;
    this.fireworks = new FireworkShowService(scheduler);
  }

  public boolean isRunning() {
    return running.get();
  }

  /**
   * Starts a celebration centered on {@code center}.
   *
   * @param lovey {@code true} for the romantic show, {@code false} for the
   *     RealFiction network "thank you" show.
   * @return {@code false} if a celebration is already running or the location is
   *     unusable.
   */
  public boolean start(int years, boolean lovey, Location center) {
    if (center == null || center.getWorld() == null || scheduler == null) {
      return false;
    }
    if (!running.compareAndSet(false, true)) {
      return false;
    }

    final Location origin = center.clone();
    final Theme theme = lovey ? loveTheme(years) : realfictionTheme(years);

    // Opening flourish: gradient headline, sky banner, rising chimes, launch.
    safely(() -> {
      broadcastTitle(gradient(theme.header, theme, true), Text.component(theme.messages[0]), 400, 2600, 800);
      broadcastChat(theme.openChat);
      renderSkyBanner(origin, years, theme.skyLines[0], theme);
      playOpeningChime();
      fireworks.launchRing(origin, 10, theme.palettes[0]);
      launchOuterRing(origin, theme, 0, 8);
    });

    final int[] frame = {0};
    task = scheduler.runGlobalRepeating(() -> {
      int n = frame[0]++;
      safely(() -> tickFrame(origin, theme, years, n));
      if (n >= TOTAL_FRAMES) {
        finish(origin, theme);
      }
    }, PERIOD_TICKS, PERIOD_TICKS);
    return true;
  }

  /** Stops any running celebration and cancels its task. Safe to call twice. */
  public void stop() {
    ScheduledTaskHandle handle = task;
    task = null;
    running.set(false);
    if (handle != null) {
      handle.cancel();
    }
  }

  // ---------------------------------------------------------------------------
  // Per-frame choreography (shared by both themes).
  // ---------------------------------------------------------------------------
  private void tickFrame(Location origin, Theme theme, int years, int n) {
    boolean finale = n >= FINALE_FRAME;

    // Bursts spread across the wide inner field, plus a sweeping outer ring.
    launchBurst(origin, theme, finale);
    launchOuterRing(origin, theme, n, finale ? 4 : 2);

    // Sparkle fountain + floating accent particles (hearts or golden totems).
    spawnSparkles(origin, theme, finale ? 3 : 1);

    // Rotating lines on the action bar every couple seconds.
    if (n > 0 && n % MESSAGE_EVERY_FRAMES == 0) {
      broadcastActionBar(Text.component(theme.messages[(n / MESSAGE_EVERY_FRAMES) % theme.messages.length]));
      playSoftSparkle();
    }

    // A bigger title flash + chat line + refreshed sky banner every ~6s.
    if (n > 0 && n % TITLE_EVERY_FRAMES == 0) {
      String line = theme.messages[(n / TITLE_EVERY_FRAMES) % theme.messages.length];
      broadcastTitle(gradient(theme.header, theme, false), Text.component(line), 250, 1800, 600);
      broadcastChat(line);
      renderSkyBanner(origin, years, theme.skyLines[(n / TITLE_EVERY_FRAMES) % theme.skyLines.length], theme);
    }

    // Grand finale: paint the theme's shape (heart or star) once, then stay dense.
    if (n == FINALE_FRAME) {
      broadcastTitle(gradient(theme.finaleTitle, theme, true), Text.component(theme.finaleSubtitle), 300, 2200, 700);
      launchShape(origin, theme);
      spawnShapeOutline(origin, theme);
      playFinaleFanfare();
    }
  }

  private void finish(Location origin, Theme theme) {
    safely(() -> {
      fireworks.launchRing(origin, 14, theme.finalePalette);
      launchBurst(origin, theme, true);
      launchOuterRing(origin, theme, 0, 10);
      spawnShapeOutline(origin, theme);
      broadcastChat(theme.closeChat);
      playFinaleFanfare();
    });
    stop();
  }

  // ---------------------------------------------------------------------------
  // Fireworks.
  // ---------------------------------------------------------------------------
  private void launchBurst(Location origin, Theme theme, boolean finale) {
    World world = origin.getWorld();
    if (world == null) {
      return;
    }
    ThreadLocalRandom rng = ThreadLocalRandom.current();
    int min = finale ? FINALE_MIN_PER_BURST : MIN_PER_BURST;
    int max = finale ? FINALE_MAX_PER_BURST : MAX_PER_BURST;
    int count = min + rng.nextInt(max - min + 1);
    for (int i = 0; i < count; i++) {
      double angle = rng.nextDouble() * Math.PI * 2.0D;
      double radius = rng.nextDouble() * INNER_SPREAD;
      Location at = origin.clone().add(
          Math.cos(angle) * radius,
          HEIGHT_MIN + rng.nextDouble() * HEIGHT_VARIANCE,
          Math.sin(angle) * radius);
      fireworks.burstAt(at, theme.palettes[rng.nextInt(theme.palettes.length)]);
    }
  }

  /** A sweeping ring of fireworks far out around the show, rotating each frame. */
  private void launchOuterRing(Location origin, Theme theme, int frame, int count) {
    World world = origin.getWorld();
    if (world == null || count <= 0) {
      return;
    }
    double spin = frame * 0.5D;
    for (int i = 0; i < count; i++) {
      double angle = spin + (Math.PI * 2.0D * i) / count;
      Location at = origin.clone().add(
          Math.cos(angle) * OUTER_RING_RADIUS,
          HEIGHT_MIN + 2.0D + ThreadLocalRandom.current().nextDouble() * (HEIGHT_VARIANCE - 2.0D),
          Math.sin(angle) * OUTER_RING_RADIUS);
      fireworks.burstAt(at, theme.palettes[i % theme.palettes.length]);
    }
  }

  /** Paints the theme's shape (heart or 5-point star) in fireworks overhead. */
  private void launchShape(Location origin, Theme theme) {
    World world = origin.getWorld();
    if (world == null) {
      return;
    }
    for (double[] p : theme.heart ? heartPoints(16, 0.16D, 7.0D) : starPoints(20, 7.0D, 8.0D)) {
      fireworks.burstAt(origin.clone().add(p[0], p[1], 0), theme.finalePalette);
    }
  }

  // ---------------------------------------------------------------------------
  // Particles (no-data / DUST only — crash-safe on this server build).
  // ---------------------------------------------------------------------------
  private void spawnSparkles(Location origin, Theme theme, int clusters) {
    World world = origin.getWorld();
    if (world == null) {
      return;
    }
    ThreadLocalRandom rng = ThreadLocalRandom.current();
    scheduler.runGlobal(() -> {
      try {
        // A bright sparkle fountain rising from the center.
        world.spawnParticle(Particle.FIREWORK, origin.clone().add(0, 1.0D, 0), 12, 0.5, 1.5, 0.5, 0.08, null, true);
        world.spawnParticle(Particle.END_ROD, origin.clone().add(0, 1.0D, 0), 8, 0.4, 1.2, 0.4, 0.05, null, true);
        for (int i = 0; i < clusters; i++) {
          Location at = origin.clone().add(
              rng.nextDouble(-6.0D, 6.0D), rng.nextDouble(1.0D, 4.0D), rng.nextDouble(-6.0D, 6.0D));
          world.spawnParticle(theme.accent, at, 2, 0.4, 0.5, 0.4, 0.01, null, true);
          world.spawnParticle(Particle.END_ROD, at, 3, 0.3, 0.5, 0.3, 0.01, null, true);
        }
      } catch (Throwable ignored) {
        // Never let a particle hiccup interrupt the show.
      }
    });
  }

  /** The theme's shape outline drawn with accent + DUST particles in the air. */
  private void spawnShapeOutline(Location origin, Theme theme) {
    World world = origin.getWorld();
    if (world == null) {
      return;
    }
    scheduler.runGlobal(() -> {
      try {
        Particle.DustOptions dust = new Particle.DustOptions(theme.dust, 1.4f);
        Iterable<double[]> pts = theme.heart ? heartPoints(48, 0.18D, 6.0D) : starPoints(60, 6.0D, 7.0D);
        int i = 0;
        for (double[] p : pts) {
          Location at = origin.clone().add(p[0], p[1], 0);
          world.spawnParticle(Particle.DUST, at, 1, 0, 0, 0, 0, dust, true);
          if (i++ % 6 == 0) {
            world.spawnParticle(theme.accent, at, 1, 0, 0, 0, 0, null, true);
          }
        }
      } catch (Throwable ignored) {
        // best effort
      }
    });
  }

  private void renderSkyBanner(Location origin, int years, String bottom, Theme theme) {
    safely(() -> SeasonalParticleTextRenderer.renderBanner(
        scheduler, origin, "HAPPY " + years, bottom, theme.skyTop, theme.skyBottom));
  }

  // ---------------------------------------------------------------------------
  // Geometry: parametric heart + 5-point star (vertical X/Y plane).
  // Returns {dx, dy} offsets from the center.
  // ---------------------------------------------------------------------------
  private static java.util.List<double[]> heartPoints(int count, double scale, double baseHeight) {
    java.util.List<double[]> out = new java.util.ArrayList<>(count);
    for (int i = 0; i < count; i++) {
      double t = (Math.PI * 2.0D * i) / count;
      double hx = Math.pow(Math.sin(t), 3) * 16.0D;
      double hy = 13.0D * Math.cos(t) - 5.0D * Math.cos(2 * t) - 2.0D * Math.cos(3 * t) - Math.cos(4 * t);
      out.add(new double[] {hx * scale, baseHeight + hy * scale});
    }
    return out;
  }

  private static java.util.List<double[]> starPoints(int count, double outer, double baseHeight) {
    java.util.List<double[]> out = new java.util.ArrayList<>(count);
    double inner = outer * 0.42D;
    for (int i = 0; i < count; i++) {
      double frac = (double) i / count;
      double angle = -Math.PI / 2.0D + frac * Math.PI * 2.0D;
      // Five-point star radius oscillates between outer and inner tips.
      double r = (Math.floorMod((int) Math.round(frac * 10.0D), 2) == 0) ? outer : inner;
      // Smooth between tips for the dense outline, snap for the sparse formation.
      double tip = Math.cos(frac * Math.PI * 10.0D);
      r = inner + (outer - inner) * (0.5D + 0.5D * tip);
      out.add(new double[] {Math.cos(angle) * r, baseHeight + Math.sin(angle) * r});
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Sound (per player, low volume — premium, not spammy).
  // ---------------------------------------------------------------------------
  private void playOpeningChime() {
    forEachPlayerSound(player -> {
      player.playSound(player.getLocation(), Sound.UI_TOAST_CHALLENGE_COMPLETE, 0.7f, 1.0f);
      player.playSound(player.getLocation(), Sound.BLOCK_NOTE_BLOCK_BELL, 0.6f, 1.2f);
    });
  }

  private void playSoftSparkle() {
    forEachPlayerSound(player ->
        player.playSound(player.getLocation(), Sound.BLOCK_NOTE_BLOCK_CHIME, 0.35f, 1.4f));
  }

  private void playFinaleFanfare() {
    forEachPlayerSound(player -> {
      player.playSound(player.getLocation(), Sound.ENTITY_PLAYER_LEVELUP, 0.7f, 1.2f);
      player.playSound(player.getLocation(), Sound.BLOCK_NOTE_BLOCK_PLING, 0.6f, 1.6f);
    });
  }

  private void forEachPlayerSound(java.util.function.Consumer<Player> action) {
    for (Player player : Bukkit.getOnlinePlayers()) {
      scheduler.runForPlayer(player, () -> {
        try {
          action.accept(player);
        } catch (Throwable ignored) {
          // ignore
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Broadcast helpers (per player via runForPlayer — Folia-safe).
  // ---------------------------------------------------------------------------
  private void broadcastTitle(Component title, Component subtitle, int fadeInMs, int stayMs, int fadeOutMs) {
    Title built = Title.title(title, subtitle,
        Title.Times.times(Duration.ofMillis(fadeInMs), Duration.ofMillis(stayMs), Duration.ofMillis(fadeOutMs)));
    for (Player player : Bukkit.getOnlinePlayers()) {
      scheduler.runForPlayer(player, () -> player.showTitle(built));
    }
  }

  private void broadcastActionBar(Component message) {
    for (Player player : Bukkit.getOnlinePlayers()) {
      scheduler.runForPlayer(player, () -> player.sendActionBar(message));
    }
  }

  private void broadcastChat(String legacy) {
    Component message = Text.component(legacy);
    for (Player player : Bukkit.getOnlinePlayers()) {
      scheduler.runForPlayer(player, () -> player.sendMessage(message));
    }
  }

  /** A bold/normal gradient headline, built per character from the theme stops. */
  private static Component gradient(String text, Theme theme, boolean bold) {
    Component out = Component.empty();
    int len = Math.max(1, text.length() - 1);
    for (int i = 0; i < text.length(); i++) {
      double t = (double) i / len;
      int[] from;
      int[] to;
      double local;
      if (t < 0.5D) {
        from = theme.gradFrom;
        to = theme.gradMid;
        local = t / 0.5D;
      } else {
        from = theme.gradMid;
        to = theme.gradTo;
        local = (t - 0.5D) / 0.5D;
      }
      int r = (int) Math.round(from[0] + (to[0] - from[0]) * local);
      int g = (int) Math.round(from[1] + (to[1] - from[1]) * local);
      int b = (int) Math.round(from[2] + (to[2] - from[2]) * local);
      Component ch = Component.text(String.valueOf(text.charAt(i)), TextColor.color(r, g, b));
      if (bold) {
        ch = ch.decoration(TextDecoration.BOLD, true);
      }
      out = out.append(ch);
    }
    return out;
  }

  /** Runs an effect step, swallowing + logging once so the show never crashes. */
  private void safely(Runnable step) {
    try {
      step.run();
    } catch (Throwable error) {
      if (!loggedFrameFailure) {
        loggedFrameFailure = true;
        logger.log(Level.WARNING, "Anniversary celebration step failed (suppressed thereafter)", error);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Themes.
  // ---------------------------------------------------------------------------
  private static final class Theme {
    final String header;
    final String[] messages;
    final String[] skyLines;
    final String openChat;
    final String finaleTitle;
    final String finaleSubtitle;
    final String closeChat;
    final int[] gradFrom;
    final int[] gradMid;
    final int[] gradTo;
    final Color skyTop;
    final Color skyBottom;
    final Color dust;
    final Particle accent;
    final SeasonalEffectPalette[] palettes;
    final SeasonalEffectPalette finalePalette;
    final boolean heart;

    Theme(String header, String[] messages, String[] skyLines, String openChat, String finaleTitle,
        String finaleSubtitle, String closeChat, int[] gradFrom, int[] gradMid, int[] gradTo,
        Color skyTop, Color skyBottom, Color dust, Particle accent,
        SeasonalEffectPalette[] palettes, SeasonalEffectPalette finalePalette, boolean heart) {
      this.header = header;
      this.messages = messages;
      this.skyLines = skyLines;
      this.openChat = openChat;
      this.finaleTitle = finaleTitle;
      this.finaleSubtitle = finaleSubtitle;
      this.closeChat = closeChat;
      this.gradFrom = gradFrom;
      this.gradMid = gradMid;
      this.gradTo = gradTo;
      this.skyTop = skyTop;
      this.skyBottom = skyBottom;
      this.dust = dust;
      this.accent = accent;
      this.palettes = palettes;
      this.finalePalette = finalePalette;
      this.heart = heart;
    }
  }

  private static Theme loveTheme(int years) {
    return new Theme(
        "HAPPY " + years + " YEAR ANNIVERSARY",
        new String[] {
          "&dTwo hearts, one beautiful story.",
          "&dCelebrating love, loyalty, and every precious memory.",
          "&dHere's to another year of love, laughter, and forever.",
          "&dA love worth celebrating every single day.",
          "&dMay this anniversary be filled with joy, beauty, and gratitude.",
          "&dTogether, always. &c❤",
          "&6God bless this love and every year ahead.",
          "&dForever isn't long enough with you."
        },
        new String[] {"ANNIVERSARY", "FOREVER", "TRUE LOVE"},
        "&d&l✦ &6&lHAPPY " + years + " YEAR ANNIVERSARY &d&l✦",
        "Together, always",
        "&c❤ &dThank you for every year &c❤",
        "&dWith all our love — thank you for every year. &6❤",
        new int[] {255, 215, 0}, new int[] {255, 105, 180}, GRAD_WHITE,
        Color.fromRGB(255, 215, 0), Color.fromRGB(255, 120, 200), Color.fromRGB(255, 80, 150),
        Particle.HEART,
        new SeasonalEffectPalette[] {
          new SeasonalEffectPalette(Color.fromRGB(255, 40, 90), Color.fromRGB(255, 150, 200), Color.WHITE,
              Color.fromRGB(255, 215, 0), FireworkEffect.Type.BALL_LARGE),
          new SeasonalEffectPalette(Color.fromRGB(255, 120, 200), Color.WHITE, Color.fromRGB(255, 215, 0),
              Color.fromRGB(255, 40, 90), FireworkEffect.Type.STAR),
          new SeasonalEffectPalette(Color.fromRGB(255, 215, 0), Color.WHITE, Color.fromRGB(255, 120, 200),
              Color.fromRGB(255, 40, 90), FireworkEffect.Type.BURST),
          new SeasonalEffectPalette(Color.WHITE, Color.fromRGB(255, 150, 200), Color.fromRGB(255, 215, 0),
              Color.WHITE, FireworkEffect.Type.BALL_LARGE)
        },
        new SeasonalEffectPalette(Color.fromRGB(255, 40, 90), Color.fromRGB(255, 150, 200),
            Color.fromRGB(255, 215, 0), Color.fromRGB(255, 105, 180), FireworkEffect.Type.BALL),
        true);
  }

  private static Theme realfictionTheme(int years) {
    return new Theme(
        "HAPPY " + years + " YEAR ANNIVERSARY",
        new String[] {
          "&bThank you for " + years + " incredible years, &6RealFiction&b!",
          "&bBuilt by this community, for this community.",
          "&bEvery block, every battle, every memory — &6thank you&b.",
          "&bHere's to the players who make RealFiction home.",
          "&e" + years + " years strong &band the best is yet to come.",
          "&bFrom all of us — thank you for being part of the story.",
          "&6&lRaise your fireworks for RealFiction! &e✦"
        },
        new String[] {"REALFICTION", "THANK YOU", years + " YEARS"},
        "&b&l✦ &6&lHAPPY " + years + " YEAR ANNIVERSARY &b&l✦ &eRealFiction",
        "Thank you, RealFiction",
        "&6" + years + " amazing years &b&mtogether&r &e✦",
        "&bFrom all of us — thank you for " + years + " amazing years. See you in-game! &6✦",
        new int[] {255, 215, 0}, new int[] {85, 205, 252}, GRAD_WHITE,
        Color.fromRGB(255, 215, 0), Color.fromRGB(85, 205, 252), Color.fromRGB(120, 210, 255),
        Particle.TOTEM_OF_UNDYING,
        new SeasonalEffectPalette[] {
          new SeasonalEffectPalette(Color.fromRGB(255, 215, 0), Color.WHITE, Color.fromRGB(255, 140, 0),
              Color.fromRGB(255, 235, 130), FireworkEffect.Type.BALL_LARGE),
          new SeasonalEffectPalette(Color.fromRGB(85, 205, 252), Color.WHITE, Color.fromRGB(0, 120, 255),
              Color.fromRGB(180, 240, 255), FireworkEffect.Type.STAR),
          new SeasonalEffectPalette(Color.fromRGB(80, 220, 120), Color.WHITE, Color.fromRGB(255, 215, 0),
              Color.fromRGB(180, 255, 200), FireworkEffect.Type.BURST),
          new SeasonalEffectPalette(Color.fromRGB(180, 90, 255), Color.WHITE, Color.fromRGB(85, 205, 252),
              Color.fromRGB(255, 215, 0), FireworkEffect.Type.BALL_LARGE)
        },
        new SeasonalEffectPalette(Color.fromRGB(255, 215, 0), Color.fromRGB(85, 205, 252), Color.WHITE,
            Color.fromRGB(255, 235, 130), FireworkEffect.Type.STAR),
        false);
  }
}
