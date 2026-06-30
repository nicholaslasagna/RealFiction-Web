package com.realfiction.realcore.halloween;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import java.lang.reflect.Proxy;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicInteger;
import org.bukkit.inventory.EntityEquipment;
import org.junit.jupiter.api.Test;

final class HerobrineStalkerArmorStandEquipmentTest {
  @Test
  void armorStandEquipmentPathDoesNotCallDropChanceApis() {
    AtomicInteger equipmentSetCalls = new AtomicInteger();
    EntityEquipment equipment = (EntityEquipment) Proxy.newProxyInstance(
        EntityEquipment.class.getClassLoader(),
        new Class<?>[] {EntityEquipment.class},
        (proxy, method, args) -> {
          if (method.getName().endsWith("DropChance")) {
            throw new AssertionError("ArmorStand Herobrine equipment must not call " + method.getName());
          }
          if (method.getName().startsWith("set") && args != null && args.length == 1) {
            equipmentSetCalls.incrementAndGet();
          }
          return defaultValue(method.getReturnType());
        }
    );

    HerobrineStalkerService.configureArmorStandEquipment(
        equipment,
        null,
        null,
        null,
        null
    );

    assertEquals(4, equipmentSetCalls.get(), "Herobrine should only set four visible equipment slots");
  }

  @Test
  void productionRealCoreSourceDoesNotContainDropChanceCalls() throws Exception {
    Path sourceRoot = Path.of("src/main/java/com/realfiction/realcore");
    try (var paths = Files.walk(sourceRoot)) {
      boolean hasDropChance = paths
          .filter(Files::isRegularFile)
          .filter(path -> path.toString().endsWith(".java"))
          .map(path -> {
            try {
              return Files.readString(path);
            } catch (Exception exception) {
              throw new RuntimeException(exception);
            }
          })
          .anyMatch(source -> source.contains("DropChance"));
      assertFalse(hasDropChance, "Production RealCore source must not call Bukkit DropChance APIs");
    }
  }

  private static Object defaultValue(Class<?> type) {
    if (!type.isPrimitive()) {
      return null;
    }
    if (type == boolean.class) {
      return false;
    }
    if (type == byte.class) {
      return (byte) 0;
    }
    if (type == short.class) {
      return (short) 0;
    }
    if (type == int.class) {
      return 0;
    }
    if (type == long.class) {
      return 0L;
    }
    if (type == float.class) {
      return 0.0f;
    }
    if (type == double.class) {
      return 0.0d;
    }
    if (type == char.class) {
      return '\0';
    }
    return null;
  }
}
