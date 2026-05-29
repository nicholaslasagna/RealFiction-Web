package com.realfiction.realcore.cosmetics;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.cosmetics.pets.PetCosmetics;
import com.realfiction.realcore.cosmetics.pets.PetDefinition;
import com.realfiction.realcore.cosmetics.pets.PetDisplayMode;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import org.bukkit.entity.EntityType;
import org.junit.jupiter.api.Test;

final class PetCosmeticsTest {
  @Test
  void mergesBuiltinPetsWhenSectionEmpty() {
    Map<CosmeticCategory, List<CosmeticOption>> options = new EnumMap<>(CosmeticCategory.class);
    for (CosmeticCategory category : CosmeticCategory.values()) {
      options.put(category, List.of());
    }
    PetCosmetics.mergeMissingBuiltins(options);
    List<CosmeticOption> pets = options.get(CosmeticCategory.PETS);
    assertTrue(pets.stream().anyMatch(option -> "emerald-sprite".equals(option.id())));
    assertTrue(pets.stream().anyMatch(option -> "tiny-dragon".equals(option.id())));
    assertTrue(pets.stream().anyMatch(option -> "liberty-eagle".equals(option.id())));
    assertTrue(pets.stream().anyMatch(option -> "bee-buzz".equals(option.id())));
    assertTrue(pets.stream().anyMatch(option -> "pet-pack".equals(option.id()) && option.placeholder()));
  }

  @Test
  void definitionsExistForCatalogPets() {
    assertNotNull(PetCosmetics.definition("emerald-sprite"));
    assertNotNull(PetCosmetics.definition("atelier-orb"));
    assertNotNull(PetCosmetics.definition("liberty-eagle"));
    assertEquals(EntityType.ALLAY, PetCosmetics.definition("emerald-sprite").entityType());
  }

  @Test
  void tinyDragonUsesDisplayArmorStandNotEnderDragon() {
    PetDefinition dragon = PetCosmetics.definition("tiny-dragon");
    assertNotNull(dragon);
    assertEquals(EntityType.ARMOR_STAND, dragon.entityType());
    assertEquals(PetDisplayMode.DISPLAY, dragon.displayMode());
    assertTrue(dragon.displayPet());
    assertEquals(org.bukkit.Material.DRAGON_HEAD, dragon.displayHead());
  }

  @Test
  void unknownPetReturnsNull() {
    assertNull(PetCosmetics.definition("not-a-pet"));
  }

  @Test
  void catalogHasMultiplePackPets() {
    assertTrue(PetCosmetics.definitionCount() >= 12);
  }
}
