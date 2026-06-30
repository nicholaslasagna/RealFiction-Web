package com.realfiction.realcore.halloween;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.util.concurrent.atomic.AtomicInteger;
import org.bukkit.entity.ArmorStand;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Zombie;
import org.bukkit.inventory.EntityEquipment;
import org.junit.jupiter.api.Test;

final class HerobrineStalkerCompatibilityTest {
  @Test
  void armorStandEquipmentDoesNotUseMobOnlyDropChanceApis() {
    Entity armorStand = entityProxy(ArmorStand.class);
    AtomicInteger dropChanceCalls = new AtomicInteger();
    EntityEquipment equipment = equipmentProxy(dropChanceCalls);

    HerobrineStalkerService.clearDropChancesIfSupported(armorStand, equipment);

    assertFalse(HerobrineStalkerService.supportsEquipmentDropChance(armorStand));
    assertEquals(0, dropChanceCalls.get());
  }

  @Test
  void mobEquipmentCanUseDropChanceApis() {
    Entity zombie = entityProxy(Zombie.class);
    AtomicInteger dropChanceCalls = new AtomicInteger();
    EntityEquipment equipment = equipmentProxy(dropChanceCalls);

    HerobrineStalkerService.clearDropChancesIfSupported(zombie, equipment);

    assertTrue(HerobrineStalkerService.supportsEquipmentDropChance(zombie));
    assertEquals(4, dropChanceCalls.get());
  }

  private static Entity entityProxy(Class<? extends Entity> entityInterface) {
    return (Entity) Proxy.newProxyInstance(
        entityInterface.getClassLoader(),
        new Class<?>[] { entityInterface },
        defaultInvocationHandler()
    );
  }

  private static EntityEquipment equipmentProxy(AtomicInteger dropChanceCalls) {
    return (EntityEquipment) Proxy.newProxyInstance(
        EntityEquipment.class.getClassLoader(),
        new Class<?>[] { EntityEquipment.class },
        (proxy, method, args) -> {
          if (method.getName().endsWith("DropChance")) {
            dropChanceCalls.incrementAndGet();
          }
          return defaultValue(method.getReturnType());
        }
    );
  }

  private static InvocationHandler defaultInvocationHandler() {
    return (proxy, method, args) -> defaultValue(method.getReturnType());
  }

  private static Object defaultValue(Class<?> returnType) {
    if (returnType == Boolean.TYPE) {
      return false;
    }
    if (returnType == Byte.TYPE) {
      return (byte) 0;
    }
    if (returnType == Short.TYPE) {
      return (short) 0;
    }
    if (returnType == Integer.TYPE) {
      return 0;
    }
    if (returnType == Long.TYPE) {
      return 0L;
    }
    if (returnType == Float.TYPE) {
      return 0.0f;
    }
    if (returnType == Double.TYPE) {
      return 0.0d;
    }
    if (returnType == Character.TYPE) {
      return '\0';
    }
    return null;
  }
}
