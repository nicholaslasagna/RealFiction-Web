package com.realfiction.realcore.halloween;

import com.realfiction.realcore.scheduler.RealCoreScheduler;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import org.bukkit.Color;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.World;
import org.bukkit.entity.ArmorStand;
import org.bukkit.entity.Entity;
import org.bukkit.inventory.EntityEquipment;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.LeatherArmorMeta;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;
import org.bukkit.util.Vector;

public final class ArmorStandHerobrineAppearance {
  private final RealCoreScheduler scheduler;
  private final NamespacedKey markerKey;
  private final NamespacedKey sightingKey;
  private final Supplier<ItemStack> headSupplier;

  public ArmorStandHerobrineAppearance(
      RealCoreScheduler scheduler,
      NamespacedKey markerKey,
      NamespacedKey sightingKey,
      Supplier<ItemStack> headSupplier
  ) {
    this.scheduler = scheduler;
    this.markerKey = markerKey;
    this.sightingKey = sightingKey;
    this.headSupplier = headSupplier;
  }

  public HerobrineAppearanceHandle spawn(UUID sightingId, UUID playerUuid, Location playerLocation, Location safe) {
    if (safe == null || safe.getWorld() == null) {
      throw new IllegalArgumentException("safe location is required");
    }
    ArmorStand stand = safe.getWorld().spawn(safe, ArmorStand.class, entity -> configureStand(entity, sightingId, playerUuid, playerLocation, safe));
    return new ArmorStandHandle(sightingId, playerUuid, stand.getUniqueId(), stand.getLocation());
  }

  void configureStand(ArmorStand stand, UUID sightingId, UUID playerUuid, Location playerLocation, Location safe) {
    stand.addScoreboardTag(HerobrineStalkerService.SCOREBOARD_TAG);
    stand.getPersistentDataContainer().set(markerKey, PersistentDataType.STRING, playerUuid.toString());
    stand.getPersistentDataContainer().set(sightingKey, PersistentDataType.STRING, sightingId.toString());
    stand.setPersistent(false);
    stand.setRemoveWhenFarAway(true);
    stand.setCustomName(null);
    stand.setCustomNameVisible(false);
    stand.setVisible(false);
    stand.setInvulnerable(true);
    stand.setSilent(true);
    stand.setGravity(false);
    stand.setCollidable(false);
    stand.setMarker(false);
    stand.setSmall(false);
    stand.setBasePlate(false);
    stand.setArms(true);
    stand.setCanPickupItems(false);
    stand.setRotation(yawToward(safe, playerLocation), 0.0f);
    EntityEquipment equipment = stand.getEquipment();
    if (equipment != null) {
      configureArmorStandEquipment(
          equipment,
          headSupplier.get(),
          leather(Material.LEATHER_CHESTPLATE, Color.fromRGB(24, 94, 171)),
          leather(Material.LEATHER_LEGGINGS, Color.fromRGB(34, 61, 150)),
          leather(Material.LEATHER_BOOTS, Color.fromRGB(22, 22, 22))
      );
    }
  }

  static void configureArmorStandEquipment(
      EntityEquipment equipment,
      ItemStack helmet,
      ItemStack chestplate,
      ItemStack leggings,
      ItemStack boots
  ) {
    if (equipment == null) {
      return;
    }
    equipment.setHelmet(helmet);
    equipment.setChestplate(chestplate);
    equipment.setLeggings(leggings);
    equipment.setBoots(boots);
  }

  private static ItemStack leather(Material material, Color color) {
    ItemStack item = new ItemStack(material);
    if (item.getItemMeta() instanceof LeatherArmorMeta meta) {
      meta.setColor(color);
      item.setItemMeta(meta);
    }
    return item;
  }

  private static float yawToward(Location from, Location target) {
    double dx = target.getX() - from.getX();
    double dz = target.getZ() - from.getZ();
    return (float) Math.toDegrees(Math.atan2(-dx, dz));
  }

  private final class ArmorStandHandle implements HerobrineAppearanceHandle {
    private final UUID sightingId;
    private final UUID viewerUuid;
    private final UUID entityUuid;
    private volatile Location location;
    private volatile boolean active = true;

    private ArmorStandHandle(UUID sightingId, UUID viewerUuid, UUID entityUuid, Location location) {
      this.sightingId = sightingId;
      this.viewerUuid = viewerUuid;
      this.entityUuid = entityUuid;
      this.location = location == null ? null : location.clone();
    }

    @Override
    public UUID sightingId() {
      return sightingId;
    }

    @Override
    public UUID viewerUuid() {
      return viewerUuid;
    }

    @Override
    public String backend() {
      return HerobrineAppearanceConfig.MODE_ARMOR_STAND;
    }

    @Override
    public Location location() {
      Location current = location;
      return current == null ? null : current.clone();
    }

    @Override
    public void updateLocation(Location location) {
      if (location != null) {
        this.location = location.clone();
      }
    }

    @Override
    public void face(Location target) {
      Location current = location();
      if (current == null || target == null) {
        return;
      }
      scheduler.runAt(current, () -> {
        Entity entity = org.bukkit.Bukkit.getEntity(entityUuid);
        if (entity instanceof ArmorStand stand && stand.getScoreboardTags().contains(HerobrineStalkerService.SCOREBOARD_TAG)) {
          stand.setRotation(yawToward(stand.getLocation(), target), 0.0f);
          updateLocation(stand.getLocation());
        }
      });
    }

    @Override
    public void stepAwayFrom(Location target) {
      Location current = location();
      if (current == null || current.getWorld() == null || target == null) {
        return;
      }
      scheduler.runAt(current, () -> stepAwayInRegion(target));
    }

    private void stepAwayInRegion(Location target) {
      Entity entity = org.bukkit.Bukkit.getEntity(entityUuid);
      if (!(entity instanceof ArmorStand stand) || !stand.getScoreboardTags().contains(HerobrineStalkerService.SCOREBOARD_TAG)) {
        return;
      }
      Location current = stand.getLocation();
      Vector away = current.toVector().subtract(target.toVector());
      if (away.lengthSquared() < 0.001) {
        away = new Vector(0, 0, 1);
      }
      away.normalize().multiply(0.85);
      Location next = current.clone().add(away);
      if (!safeStep(next.getWorld(), next.getBlockX(), next.getBlockY(), next.getBlockZ())) {
        return;
      }
      stand.teleportAsync(next).thenAccept(success -> {
        if (Boolean.TRUE.equals(success)) {
          scheduler.runAt(next, () -> {
            Entity moved = org.bukkit.Bukkit.getEntity(entityUuid);
            if (moved instanceof ArmorStand movedStand && movedStand.getScoreboardTags().contains(HerobrineStalkerService.SCOREBOARD_TAG)) {
              movedStand.setRotation(yawToward(next, target), 0.0f);
              updateLocation(movedStand.getLocation());
            }
          });
        }
      });
    }

    private boolean safeStep(World world, int x, int y, int z) {
      if (world == null || y <= world.getMinHeight() + 1 || y >= world.getMaxHeight() - 2) {
        return false;
      }
      Material ground = world.getBlockAt(x, y - 1, z).getType();
      Material feet = world.getBlockAt(x, y, z).getType();
      Material head = world.getBlockAt(x, y + 1, z).getType();
      return solidGround(ground) && emptyForBody(feet) && emptyForBody(head);
    }

    private boolean solidGround(Material type) {
      return type.isSolid() && !dangerous(type);
    }

    private boolean emptyForBody(Material type) {
      return !dangerous(type) && (type.isAir() || !type.isSolid());
    }

    private boolean dangerous(Material type) {
      return switch (type) {
        case LAVA, FIRE, SOUL_FIRE, CACTUS, MAGMA_BLOCK, CAMPFIRE, SOUL_CAMPFIRE, POWDER_SNOW,
            NETHER_PORTAL, END_PORTAL -> true;
        default -> false;
      };
    }

    @Override
    public void despawn(String reason) {
      active = false;
      Location current = location();
      if (current == null) {
        return;
      }
      scheduler.runAt(current, () -> {
        Entity entity = org.bukkit.Bukkit.getEntity(entityUuid);
        if (entity != null && entity.getScoreboardTags().contains(HerobrineStalkerService.SCOREBOARD_TAG)) {
          entity.remove();
        }
      });
    }

    @Override
    public boolean active() {
      return active;
    }

    @Override
    public Optional<UUID> bukkitEntityUuid() {
      return Optional.of(entityUuid);
    }
  }
}
