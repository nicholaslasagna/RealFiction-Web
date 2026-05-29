package com.realfiction.realcore.cosmetics;

import com.realfiction.realcore.cosmetics.pets.CosmeticsPetService;
import com.realfiction.realcore.cosmetics.pets.PetCosmetics;
import com.realfiction.realcore.item.ItemFactory;
import com.realfiction.realcore.lobby.LobbyManager;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import com.realfiction.realcore.text.Text;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.entity.Player;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.plugin.Plugin;

public final class CosmeticsManager {
  private final Plugin plugin;
  private final RealCoreScheduler scheduler;
  private final Supplier<LobbyManager> lobbySupplier;
  private CosmeticsConfig config;
  private CosmeticsStorage storage;
  private CosmeticsPetService petService;
  private ScheduledTaskHandle particleTask;

  public CosmeticsManager(Plugin plugin, RealCoreScheduler scheduler, Supplier<LobbyManager> lobbySupplier,
      CosmeticsConfig config) {
    this.plugin = plugin;
    this.scheduler = scheduler;
    this.lobbySupplier = lobbySupplier;
    this.config = config;
    this.storage = new CosmeticsStorage(plugin.getDataFolder(), plugin.getLogger());
    this.petService = new CosmeticsPetService(plugin, scheduler, lobbySupplier);
  }

  public void start() {
    stop();
    if (!config.enabled()) {
      return;
    }
    particleTask = scheduler.runGlobalRepeating(this::tickParticles, 20L, 10L);
    petService.bindCosmetics(config, storage);
    petService.setEnabled(true);
    petService.start();
    for (Player player : Bukkit.getOnlinePlayers()) {
      applyPlayerCosmetics(player);
    }
  }

  public void stop() {
    if (particleTask != null) {
      particleTask.cancel();
      particleTask = null;
    }
    if (petService != null) {
      petService.stop();
    }
  }

  public void reload(CosmeticsConfig newConfig) {
    this.config = newConfig;
    this.storage.reload();
    start();
  }

  public int activePetCount() {
    return petService == null ? 0 : petService.activePetCount();
  }

  public int petDefinitionCount() {
    return PetCosmetics.definitionCount();
  }

  public int selectedPetCount() {
    return petService == null ? 0 : petService.selectedPetCount();
  }

  public String lastPetSpawnFailure() {
    return petService == null ? "" : petService.diagnostics().lastSpawnFailure();
  }

  public long petMoveTickPeriod() {
    return petService == null ? 0L : petService.moveTickPeriod();
  }

  public boolean isLobbyFlightSelected(Player player) {
    return player.hasPermission("realfiction.lobby.flight") && storage.selection(player.getUniqueId()).lobbyFlight();
  }

  public void open(Player player) {
    if (!config.enabled()) {
      scheduler.send(player, ChatColor.RED + "Cosmetics are not available right now.");
      return;
    }
    scheduler.runForPlayer(player, () -> openRootNow(player));
  }

  public void applyPlayerCosmetics(Player player) {
    scheduler.runForPlayer(player, () -> {
      if (!player.isOnline()) {
        return;
      }
      CosmeticSelection raw = storage.selection(player.getUniqueId());
      CosmeticsPermissions.SanitizeResult sanitized = CosmeticsPermissions.sanitize(player, config, raw);
      if (sanitized.changed()) {
        storage.save(player.getUniqueId(), sanitized.selection());
      }
      CosmeticSelection selection = sanitized.selection();
      CosmeticOption color = config.option(CosmeticCategory.USERNAME_COLORS, selection.usernameColor());
      if (color != null && CosmeticsPermissions.canUseOption(player, color) && color.colorCode() != null
          && !color.colorCode().isBlank()) {
        player.setPlayerListName(Text.color(color.colorCode() + player.getName()));
      } else {
        player.setPlayerListName(player.getName());
      }
      petService.apply(player, config, selection);
    });
  }

  public void onPlayerQuit(java.util.UUID playerId) {
    if (petService != null) {
      petService.onPlayerQuit(playerId);
    }
  }

  /** Refreshes the cosmetics GUI when the player still has it open after entitlement changes. */
  public void refreshGuiIfOpen(Player player) {
    if (player == null || !player.isOnline() || !config.enabled()) {
      return;
    }
    if (!(player.getOpenInventory().getTopInventory().getHolder() instanceof CosmeticsHolder holder)) {
      return;
    }
    if (holder.view() == CosmeticsHolder.View.ROOT) {
      open(player);
      return;
    }
    CosmeticCategory category = holder.category();
    if (category != null) {
      scheduler.runForPlayer(player, () -> openCategoryNow(player, category));
    }
  }

  public void handleClick(InventoryClickEvent event, CosmeticsHolder holder) {
    event.setCancelled(true);
    if (!(event.getWhoClicked() instanceof Player player)) {
      return;
    }
    String action = holder.action(event.getRawSlot());
    if (action == null || action.isBlank()) {
      return;
    }
    if ("back".equals(action)) {
      open(player);
      return;
    }
    if (holder.view() == CosmeticsHolder.View.ROOT) {
      CosmeticCategory category = CosmeticCategory.fromId(action);
      if (category != null) {
        scheduler.runForPlayer(player, () -> openCategoryNow(player, category));
      }
      return;
    }
    CosmeticCategory category = holder.category();
    CosmeticOption option = config.option(category, action);
    if (option != null) {
      select(player, category, option);
    }
  }

  private void openRootNow(Player player) {
    Map<Integer, String> actions = new HashMap<>();
    CosmeticsHolder holder = new CosmeticsHolder(CosmeticsHolder.View.ROOT, null, actions);
    Inventory inventory = Bukkit.createInventory(holder, config.size(), Text.color(config.title()));
    holder.setInventory(inventory);

    for (Map.Entry<CosmeticCategory, Integer> entry : config.categorySlots().entrySet()) {
      CosmeticCategory category = entry.getKey();
      CosmeticsConfig.CategorySettings settings = config.categories().get(category);
      if (settings == null || !settings.enabled()) {
        continue;
      }
      boolean unlocked = CosmeticsPermissions.canUseCategory(player, category, settings);
      inventory.setItem(entry.getValue(), icon(settings.material(), settings.displayName(),
          List.of(unlocked ? "&aUnlocked cosmetics inside." : "&cLocked. Visit the store to unlock."), unlocked, 1, player));
      actions.put(entry.getValue(), category.id());
    }

    player.openInventory(inventory);
  }

  private void openCategoryNow(Player player, CosmeticCategory category) {
    Map<Integer, String> actions = new HashMap<>();
    CosmeticsHolder holder = new CosmeticsHolder(CosmeticsHolder.View.CATEGORY, category, actions);
    Inventory inventory = Bukkit.createInventory(holder, 36, Text.color("&a" + category.displayName()));
    holder.setInventory(inventory);

    int slot = 10;
    for (CosmeticOption option : config.options(category)) {
      boolean unlocked = CosmeticsPermissions.canUseOption(player, option);
      boolean selected = selected(player, option);
      inventory.setItem(slot, icon(option.material(), option.displayName(), lore(option, unlocked, selected),
          unlocked || selected, 1, player));
      actions.put(slot, option.id());
      slot++;
      if (slot == 17) {
        slot = 19;
      }
    }
    inventory.setItem(31, icon("ARROW", "&eBack", List.of("&7Return to cosmetics."), true, 1, player));
    actions.put(31, "back");
    player.openInventory(inventory);
  }

  private void select(Player player, CosmeticCategory category, CosmeticOption option) {
    if (!CosmeticsPermissions.canUseOption(player, option)) {
      scheduler.send(player, ChatColor.RED + "You have not unlocked that cosmetic yet.");
      return;
    }
    if (option.placeholder()) {
      scheduler.send(player, ChatColor.YELLOW + "That cosmetic is unlocked, but it is coming soon.");
      return;
    }

    CosmeticSelection current = storage.selection(player.getUniqueId());
    boolean alreadySelected = CosmeticsSelectionLogic.isSelected(current, category, option.id());
    CosmeticSelection next = CosmeticsSelectionLogic.applySelection(current, category, option.id(), alreadySelected);
    storage.save(player.getUniqueId(), next);
    applyPlayerCosmetics(player);
    LobbyManager lobby = lobbySupplier.get();
    if (category == CosmeticCategory.LOBBY_FLIGHT && lobby != null) {
      lobby.flightService().applyFor(player, lobby.config());
    }
    scheduler.send(player, ChatColor.GREEN + "Cosmetic updated.");
    scheduler.runForPlayer(player, () -> openCategoryNow(player, category));
  }

  private void tickParticles() {
    for (Player player : Bukkit.getOnlinePlayers()) {
      scheduler.runForPlayer(player, () -> spawnSelectedParticles(player));
    }
  }

  private void spawnSelectedParticles(Player player) {
    if (!player.isOnline()) {
      return;
    }
    CosmeticSelection selection = storage.selection(player.getUniqueId());
    CosmeticOption aura = config.option(CosmeticCategory.PARTICLES, selection.particleAura());
    CosmeticOption trail = config.option(CosmeticCategory.TRAILS, selection.trail());
    if (aura != null && CosmeticsPermissions.canUseOption(player, aura)) {
      spawnParticle(player, aura.particle(), 0.35D, 0.8D, 6);
    }
    if (trail != null && CosmeticsPermissions.canUseOption(player, trail)) {
      spawnParticle(player, trail.particle(), 0.15D, 0.1D, 4);
    }
  }

  private void spawnParticle(Player player, String particleName, double spread, double yOffset, int count) {
    Particle particle = parseParticle(particleName);
    if (particle == null) {
      return;
    }
    player.getWorld().spawnParticle(particle, player.getLocation().add(0.0D, yOffset, 0.0D), count, spread, spread, spread, 0.01D);
  }

  private boolean selected(Player player, CosmeticOption option) {
    CosmeticSelection selection = storage.selection(player.getUniqueId());
    return CosmeticsSelectionLogic.isSelected(selection, option.category(), option.id());
  }

  private List<String> lore(CosmeticOption option, boolean unlocked, boolean selected) {
    String state = selected ? "&aSelected" : unlocked ? "&aUnlocked" : "&cLocked";
    if (option.lore().isEmpty()) {
      return List.of(state);
    }
    java.util.ArrayList<String> lore = new java.util.ArrayList<>(option.lore());
    lore.add("");
    lore.add(state);
    return lore;
  }

  private ItemStack icon(String material, String name, List<String> lore, boolean glow, int amount, Player player) {
    ItemStack item = ItemFactory.build(material, name, lore, glow, amount, player);
    if (item.getType() == Material.BARRIER && glow) {
      ItemMeta meta = item.getItemMeta();
      if (meta != null) {
        item.setItemMeta(meta);
      }
    }
    return item;
  }

  private Particle parseParticle(String name) {
    if (name == null || name.isBlank()) {
      return null;
    }
    try {
      return Particle.valueOf(name.trim().toUpperCase(java.util.Locale.ROOT));
    } catch (IllegalArgumentException ignored) {
      return null;
    }
  }
}
