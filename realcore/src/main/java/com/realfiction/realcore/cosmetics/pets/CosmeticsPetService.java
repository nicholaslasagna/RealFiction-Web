package com.realfiction.realcore.cosmetics.pets;

import com.realfiction.realcore.cosmetics.CosmeticCategory;
import com.realfiction.realcore.cosmetics.CosmeticOption;
import com.realfiction.realcore.cosmetics.CosmeticSelection;
import com.realfiction.realcore.cosmetics.CosmeticsConfig;
import com.realfiction.realcore.cosmetics.CosmeticsStorage;
import com.realfiction.realcore.lobby.LobbyConfig;
import com.realfiction.realcore.lobby.LobbyManager;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.Color;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.World;
import org.bukkit.entity.Allay;
import org.bukkit.entity.ArmorStand;
import org.bukkit.entity.Axolotl;
import org.bukkit.entity.Bat;
import org.bukkit.entity.Bee;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Fox;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Mob;
import org.bukkit.entity.Parrot;
import org.bukkit.entity.Player;
import org.bukkit.entity.Rabbit;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.SkullMeta;
import org.bukkit.plugin.Plugin;
import org.bukkit.util.Vector;

/**
 * Lobby cosmetic pets: spawn, follow, particles, cleanup. Folia-safe via player scheduler.
 */
public final class CosmeticsPetService {
  public static final long MOVE_TICK_PERIOD = PetMovementMath.MOVE_TICK_PERIOD;

  private final Plugin plugin;
  private final RealCoreScheduler scheduler;
  private final Supplier<LobbyManager> lobbySupplier;
  private final Logger logger;
  private final Map<UUID, PetActiveState> activePets = new ConcurrentHashMap<>();
  private final PetRuntimeDiagnostics diagnostics = new PetRuntimeDiagnostics();
  private final PetParticleSafeSpawner particleSpawner;

  private volatile CosmeticsConfig cosmeticsConfig;
  private volatile CosmeticsStorage cosmeticsStorage;
  private ScheduledTaskHandle tickTask;
  private volatile boolean enabled = true;

  public CosmeticsPetService(
      Plugin plugin,
      RealCoreScheduler scheduler,
      Supplier<LobbyManager> lobbySupplier
  ) {
    this.plugin = plugin;
    this.scheduler = scheduler;
    this.lobbySupplier = lobbySupplier;
    this.logger = plugin.getLogger();
    this.particleSpawner = new PetParticleSafeSpawner(this.logger);
  }

  public void bindCosmetics(CosmeticsConfig config, CosmeticsStorage storage) {
    this.cosmeticsConfig = config;
    this.cosmeticsStorage = storage;
  }

  public void start() {
    stop();
    tickTask = scheduler.runGlobalRepeating(this::tickAll, MOVE_TICK_PERIOD, MOVE_TICK_PERIOD);
  }

  public long moveTickPeriod() {
    return MOVE_TICK_PERIOD;
  }

  public void stop() {
    if (tickTask != null) {
      tickTask.cancel();
      tickTask = null;
    }
    for (UUID playerId : activePets.keySet().toArray(UUID[]::new)) {
      despawn(playerId, "service-stop");
    }
    activePets.clear();
  }

  public int activePetCount() {
    return activePets.size();
  }

  public int selectedPetCount() {
    CosmeticsConfig config = cosmeticsConfig;
    CosmeticsStorage storage = cosmeticsStorage;
    if (config == null || storage == null) {
      return 0;
    }
    int count = 0;
    for (Player player : Bukkit.getOnlinePlayers()) {
      String petId = storage.selection(player.getUniqueId()).selectedPet();
      if (petId != null && !petId.isBlank() && PetCosmetics.definition(petId) != null) {
        count++;
      }
    }
    return count;
  }

  public PetRuntimeDiagnostics diagnostics() {
    return diagnostics;
  }

  public void apply(Player player, CosmeticsConfig config, CosmeticSelection selection) {
    if (player == null) {
      return;
    }
    scheduler.runForPlayer(player, () -> tickPlayer(player, config, selection));
  }

  public void onPlayerQuit(UUID playerId) {
    despawn(playerId, "quit");
  }

  public void clearPlayer(UUID playerId) {
    despawn(playerId, "clear");
  }

  public void setEnabled(boolean enabled) {
    this.enabled = enabled;
    if (!enabled) {
      stop();
    }
  }

  private void tickAll() {
    CosmeticsConfig config = cosmeticsConfig;
    CosmeticsStorage storage = cosmeticsStorage;
    if (!enabled || config == null || storage == null) {
      return;
    }
    for (Player player : Bukkit.getOnlinePlayers()) {
      UUID playerId = player.getUniqueId();
      CosmeticSelection selection = storage.selection(playerId);
      scheduler.runForPlayer(player, () -> {
        if (!player.isOnline()) {
          despawn(playerId, "offline");
          return;
        }
        tickPlayer(player, config, selection);
      });
    }
  }

  private void tickPlayer(Player player, CosmeticsConfig config, CosmeticSelection selection) {
    UUID playerId = player.getUniqueId();
    PetIntent intent = resolveIntent(player, config, selection);

    if (!intent.shouldHavePet()) {
      if (activePets.containsKey(playerId)) {
        despawn(playerId, intent.despawnReason());
      }
      return;
    }

    PetDefinition definition = intent.definition();
    PetActiveState state = activePets.get(playerId);
    Entity entity = state == null ? null : findEntity(state.entityId());

    if (entity == null || entity.isDead() || !entity.isValid()
        || state == null || !definition.id().equals(state.petId())) {
      if (state != null) {
        despawn(playerId, "respawn-invalid");
      }
      spawnActivePet(player, definition);
      return;
    }

    PetActiveState nextState = followPet(entity, player, definition, state);
    PetSilenceConfigurer.apply(entity);
    activePets.put(playerId, nextState);

    if (PetMovementMath.shouldSpawnParticles(nextState.moveTick())) {
      spawnAmbientParticle(player, entity.getLocation().add(0, 0.55, 0), definition, nextState.animationTick());
      if ("tiny-dragon".equals(definition.id())) {
        spawnDragonBodyParticles(player, entity.getLocation());
      }
    }
  }

  private void spawnActivePet(Player player, PetDefinition definition) {
    Entity entity = spawnPet(player, definition);
    if (entity == null) {
      diagnostics.recordSpawnFailure(definition.id(), "spawn returned null");
      logger.warning("Cosmetic pet spawn failed for " + player.getName() + " pet=" + definition.id());
      return;
    }
    diagnostics.clearSpawnFailure();
    activePets.put(player.getUniqueId(), PetActiveState.initial(entity.getUniqueId(), definition.id(), entity.getLocation()));
    logger.info("Cosmetic pet spawned for " + player.getName() + " pet=" + definition.id()
        + " entity=" + entity.getType());
  }

  private PetActiveState followPet(Entity entity, Player player, PetDefinition definition, PetActiveState state) {
    World playerWorld = player.getWorld();
    Location desired = PetFollowMath.followLocation(player, definition.followStyle(), state.animationTick() + 1);
    if (playerWorld != null) {
      desired.setWorld(playerWorld);
    }

    boolean differentWorld = !sameWorld(entity, player);
    Location current = entity.getLocation();
    double distanceSq = differentWorld ? Double.MAX_VALUE : current.distanceSquared(desired);
    boolean displayPet = definition.displayPet() || entity instanceof ArmorStand;

    // Only a big jump (player teleported, changed world, or fell far behind)
    // snaps — everything else moves smoothly so it never reads as teleporting.
    if (PetMovementMath.shouldForceSnap(distanceSq, differentWorld)) {
      applyPetPosition(entity, player, desired);
      return state.nextMoveTick().withLastTarget(desired);
    }

    if (displayPet) {
      // Armor-stand display pets interpolate teleports smoothly client-side.
      Location next = PetMovementMath.interpolateDisplay(current, desired, Math.sqrt(distanceSq));
      applyPetPosition(entity, player, next);
      return state.nextMoveTick().withLastTarget(next);
    }

    // Walking pets (ground mobs): navigate with the pathfinder so they actually
    // WALK to the follow point with normal leg animation. Re-issued every move
    // tick so they track the player; the force-snap above handles the player
    // teleporting or the pet falling far behind. This replaces the old
    // velocity-on-an-AI-disabled-mob path, which left walking pets frozen until
    // a snap — they "only teleported when very far, otherwise stood still".
    if (entity instanceof Mob walkingMob && !definition.floating()) {
      walkingMob.getPathfinder().moveTo(desired, PetMovementMath.WALK_SPEED);
      return state.nextMoveTick().withLastTarget(desired);
    }

    // Floating pets glide toward the target with real velocity (no gravity) so
    // the client renders smooth hovering motion, and turn to face the direction
    // of travel via setRotation, which rotates the entity without snapping its
    // position the way a teleport would.
    if (entity instanceof LivingEntity living) {
      living.setGravity(false);
      living.setVelocity(PetMovementMath.glideVelocity(current, desired));
      living.setRotation(
          PetMovementMath.faceYaw(current, desired, current.getYaw(), player.getLocation().getYaw()),
          0f);
    }
    return state.nextMoveTick().withLastTarget(desired);
  }

  private void applyPetPosition(Entity entity, Player player, Location location) {
    if (location.getWorld() == null && player.getWorld() != null) {
      location.setWorld(player.getWorld());
    }
    float yaw = PetMovementMath.resolveYaw(entity.getLocation(), location, player.getLocation().getYaw());
    location.setYaw(yaw);
    location.setPitch(0f);
    if (entity instanceof LivingEntity living) {
      living.setVelocity(new Vector(0, 0, 0));
      living.teleportAsync(location);
    } else {
      entity.teleport(location);
    }
  }

  private PetIntent resolveIntent(Player player, CosmeticsConfig config, CosmeticSelection selection) {
    String petId = selection == null ? "" : selection.selectedPet();
    CosmeticOption option = petId == null || petId.isBlank()
        ? null
        : config.option(CosmeticCategory.PETS, petId);
    PetDefinition definition = PetCosmetics.definition(petId);
    boolean equip = PetLobbyRules.shouldEquipPet(
        enabled,
        player.isOnline(),
        player.isDead(),
        player.isInvisible(),
        isLobbyWorld(player),
        petId,
        option != null && !option.placeholder(),
        option != null && canUseOption(player, option),
        definition
    );
    if (!equip) {
      return PetIntent.none(despawnReason(player, petId, option, definition, isLobbyWorld(player)));
    }
    return PetIntent.yes(definition);
  }

  private static String despawnReason(
      Player player,
      String petId,
      CosmeticOption option,
      PetDefinition definition,
      boolean inLobbyWorld
  ) {
    if (!player.isOnline() || player.isDead()) {
      return "offline-or-dead";
    }
    if (player.isInvisible()) {
      return "vanished";
    }
    if (!inLobbyWorld) {
      return "left-lobby";
    }
    if (petId == null || petId.isBlank()) {
      return "no-selection";
    }
    if (option == null || option.placeholder()) {
      return "invalid-option";
    }
    if (definition == null) {
      return "unknown-definition";
    }
    return "permission-lost";
  }

  private void spawnAmbientParticle(Player owner, Location at, PetDefinition definition, int phase) {
    World world = at.getWorld();
    if (world == null) {
      return;
    }
    Particle particle = definition.ambientParticle();
    String petId = definition.id();
    if (particle == Particle.DUST && "liberty-eagle".equals(petId)) {
      Color[] colors = {Color.RED, Color.WHITE, Color.BLUE};
      Color color = colors[Math.floorMod(phase, colors.length)];
      particleSpawner.tryRun(petId, "DUST", "spawnAmbientParticle.liberty-eagle", () ->
          world.spawnParticle(
              Particle.DUST,
              at,
              2,
              0.12,
              0.12,
              0.12,
              0.0,
              new Particle.DustOptions(color, 0.9f),
              true
          )
      );
      return;
    }
    if (particle == Particle.HEART && "fox-friend".equals(petId) && phase % 4 != 0) {
      return;
    }
    particleSpawner.tryRun(petId, particle.name(), "spawnAmbientParticle.default", () ->
        world.spawnParticle(particle, at, 1, 0.08, 0.08, 0.08, 0.0, null, true)
    );
  }

  /**
   * Renders the trailing body sparkle for the Tiny Dragon pet.
   *
   * <p>Particle history on Purpur 26.1.2 / Java 25: several particles that
   * used to accept {@code null} data now require typed data and throw
   * {@code IllegalArgumentException: missing required data class
   * java.lang.Float} otherwise. PORTAL broke first (swapped out), then
   * DRAGON_BREATH started throwing the same way. Both are now replaced with
   * particles confirmed no-data on this server: {@link Particle#WITCH}
   * (purple magical haze — reads as dragon breath) and {@link Particle#END_ROD}
   * (white twinkle, also the registry's tiny-dragon ambient particle). The
   * calls still go through {@link PetParticleSafeSpawner} so any future
   * particle-contract regression is caught and logged once, not every tick.
   */
  private void spawnDragonBodyParticles(Player owner, Location headLocation) {
    World world = headLocation.getWorld();
    if (world == null) {
      return;
    }
    Location body = headLocation.clone().subtract(0, 0.35, 0);
    particleSpawner.tryRun("tiny-dragon", "WITCH", "spawnDragonBodyParticles", () ->
        world.spawnParticle(Particle.WITCH, body, 2, 0.25, 0.08, 0.25, 0.01, null, true)
    );
    particleSpawner.tryRun("tiny-dragon", "END_ROD", "spawnDragonBodyParticles", () ->
        world.spawnParticle(Particle.END_ROD, body, 1, 0.15, 0.05, 0.15, 0.02, null, true)
    );
  }

  private Entity spawnPet(Player owner, PetDefinition definition) {
    Location spawn = PetFollowMath.followLocation(owner, definition.followStyle(), 0);
    if (spawn.getWorld() == null) {
      return null;
    }
    try {
      if (definition.displayPet() || "tiny-dragon".equals(definition.id())) {
        return spawnDisplayPet(owner, spawn, definition);
      }
      return switch (definition.entityType()) {
        case ALLAY -> spawnAllay(owner, spawn, definition);
        case FOX -> spawnFox(owner, spawn, definition);
        case PARROT -> spawnParrot(owner, spawn, definition);
        case BEE -> spawnBee(owner, spawn, definition);
        case AXOLOTL -> spawnAxolotl(owner, spawn, definition);
        case RABBIT -> spawnRabbit(owner, spawn, definition);
        case BAT -> spawnBat(owner, spawn, definition);
        case ARMOR_STAND -> spawnDisplayPet(owner, spawn, definition);
        default -> spawnDisplayPet(owner, spawn, definition);
      };
    } catch (Exception error) {
      logger.log(Level.WARNING, "Cosmetic pet spawn failed for " + definition.id() + ": " + error.getMessage(), error);
      diagnostics.recordSpawnFailure(definition.id(), error.getMessage());
      return spawnDisplayPet(owner, spawn, definition);
    }
  }

  private ArmorStand spawnDisplayPet(Player owner, Location spawn, PetDefinition definition) {
    return spawn.getWorld().spawn(spawn, ArmorStand.class, stand -> {
      stand.setInvisible(true);
      stand.setMarker(true);
      stand.setSmall(true);
      stand.setGravity(false);
      stand.setBasePlate(false);
      stand.setArms(false);
      stand.setCollidable(false);
      stand.setPersistent(false);
      stand.setInvulnerable(true);
      stand.setCustomNameVisible(false);
      ItemStack head = new ItemStack(definition.displayHead() == null ? Material.DRAGON_HEAD : definition.displayHead());
      if (head.getType() == Material.PLAYER_HEAD) {
        SkullMeta meta = (SkullMeta) head.getItemMeta();
        if (meta != null) {
          meta.setOwningPlayer(owner);
          head.setItemMeta(meta);
        }
      }
      if (stand.getEquipment() != null) {
        stand.getEquipment().setHelmet(head);
      }
      tagPet(stand, owner);
      PetSilenceConfigurer.apply(stand);
    });
  }

  private Allay spawnAllay(Player owner, Location spawn, PetDefinition definition) {
    return spawn.getWorld().spawn(spawn, Allay.class, allay -> configureLiving(allay, owner, definition));
  }

  private Fox spawnFox(Player owner, Location spawn, PetDefinition definition) {
    return spawn.getWorld().spawn(spawn, Fox.class, fox -> {
      configureLiving(fox, owner, definition);
      fox.setBaby();
      if ("snow-fox".equals(definition.id())) {
        fox.setFoxType(Fox.Type.SNOW);
      }
    });
  }

  private Parrot spawnParrot(Player owner, Location spawn, PetDefinition definition) {
    return spawn.getWorld().spawn(spawn, Parrot.class, parrot -> {
      configureLiving(parrot, owner, definition);
      parrot.setBaby();
    });
  }

  private Bee spawnBee(Player owner, Location spawn, PetDefinition definition) {
    return spawn.getWorld().spawn(spawn, Bee.class, bee -> {
      configureLiving(bee, owner, definition);
      bee.setAnger(0);
      bee.setHasNectar(false);
      bee.setHasStung(false);
    });
  }

  private Axolotl spawnAxolotl(Player owner, Location spawn, PetDefinition definition) {
    return spawn.getWorld().spawn(spawn, Axolotl.class, axolotl -> {
      configureLiving(axolotl, owner, definition);
      axolotl.setBaby();
    });
  }

  private Rabbit spawnRabbit(Player owner, Location spawn, PetDefinition definition) {
    return spawn.getWorld().spawn(spawn, Rabbit.class, rabbit -> {
      configureLiving(rabbit, owner, definition);
      rabbit.setBaby();
    });
  }

  private Bat spawnBat(Player owner, Location spawn, PetDefinition definition) {
    return spawn.getWorld().spawn(spawn, Bat.class, bat -> configureLiving(bat, owner, definition));
  }

  private void configureLiving(LivingEntity entity, Player owner, PetDefinition definition) {
    if (entity instanceof Mob mob) {
      configureMob(mob, owner, definition);
    } else {
      entity.setInvulnerable(true);
      entity.setCollidable(false);
      entity.setPersistent(false);
      entity.setCustomNameVisible(false);
      tagPet(entity, owner);
    }
    PetSilenceConfigurer.apply(entity);
    applyScale(entity, definition.effectiveScale());
  }

  private void configureMob(Mob mob, Player owner, PetDefinition definition) {
    mob.setInvulnerable(true);
    mob.setCollidable(false);
    mob.setPersistent(false);
    mob.setRemoveWhenFarAway(false);
    mob.setCustomNameVisible(false);
    if (definition.floating()) {
      // Floating pets hover via velocity — no AI, no gravity, no awareness.
      mob.setAware(false);
      mob.setAI(false);
      mob.setGravity(false);
    } else {
      // Walking pets navigate with the pathfinder (followPet), which needs AI +
      // awareness + gravity ON so the mob actually walks (and animates) along
      // the ground. They stay invulnerable, non-colliding, silent, and never
      // target anything in the lobby, so AI is purely "walk to the follow
      // point" — without it setVelocity did nothing and the pet only ever
      // teleported when it fell far behind.
      mob.setAware(true);
      mob.setAI(true);
      mob.setGravity(true);
    }
    tagPet(mob, owner);
    PetSilenceConfigurer.apply(mob);
  }

  private void tagPet(Entity entity, Player owner) {
    entity.addScoreboardTag("rf_cosmetic_pet");
    entity.addScoreboardTag("rf_owner_" + owner.getUniqueId());
  }

  private void applyScale(LivingEntity entity, float scale) {
    if (Math.abs(scale - 1f) < 0.01f) {
      return;
    }
    try {
      entity.getClass().getMethod("setScale", float.class).invoke(entity, scale);
    } catch (ReflectiveOperationException ignored) {
      // Paper scale API optional
    }
  }

  private void despawn(UUID playerId, String reason) {
    PetActiveState state = activePets.remove(playerId);
    if (state == null) {
      return;
    }
    Entity entity = findEntity(state.entityId());
    if (entity != null && !entity.isDead()) {
      entity.remove();
      logger.info("Cosmetic pet despawned playerId=" + playerId + " pet=" + state.petId() + " reason=" + reason);
    }
  }

  private Entity findEntity(UUID entityId) {
    return Bukkit.getEntity(entityId);
  }

  private boolean sameWorld(Entity entity, Player player) {
    World entityWorld = entity.getWorld();
    World playerWorld = player.getWorld();
    return entityWorld != null && entityWorld.equals(playerWorld);
  }

  private boolean isLobbyWorld(Player player) {
    LobbyManager lobby = lobbySupplier.get();
    if (lobby == null) {
      return false;
    }
    LobbyConfig config = lobby.config();
    return config.enabled() && config.isLobbyWorld(player.getWorld().getName());
  }

  private static boolean canUseOption(Player player, CosmeticOption option) {
    if (player == null || option == null) {
      return false;
    }
    if (!option.requiresPermission()) {
      return true;
    }
    return player.hasPermission(option.permission());
  }

  private record PetIntent(PetDefinition definition, String despawnReason) {
    static PetIntent yes(PetDefinition definition) {
      return new PetIntent(definition, "");
    }

    static PetIntent none(String reason) {
      return new PetIntent(null, reason);
    }

    boolean shouldHavePet() {
      return definition != null;
    }
  }
}
