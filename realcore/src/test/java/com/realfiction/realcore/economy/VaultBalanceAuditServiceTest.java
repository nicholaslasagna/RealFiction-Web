package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class VaultBalanceAuditServiceTest {
  @Test
  void csvIncludesServerIdentityAndEscapesPlayerNames() {
    UUID uuid = UUID.fromString("00000000-0000-0000-0000-000000000123");
    VaultBalanceAuditService.AuditEntry entry = new VaultBalanceAuditService.AuditEntry(
        "lobby-1",
        "lobby",
        uuid,
        "Alex, \"Builder\"",
        "250.75"
    );

    List<String> lines = VaultBalanceAuditService.csvLines(List.of(entry));

    assertEquals("serverId,serverGroup,minecraftUuid,username,localVaultBalance", lines.get(0));
    assertEquals(
        "lobby-1,lobby,00000000-0000-0000-0000-000000000123,\"Alex, \"\"Builder\"\"\",250.75",
        lines.get(1)
    );
  }

  @Test
  void limitIsBoundedForLargeAudits() {
    assertEquals(VaultBalanceAuditService.DEFAULT_ALL_LIMIT, VaultBalanceAuditService.normalizeLimit(0));
    assertEquals(25, VaultBalanceAuditService.normalizeLimit(25));
    assertEquals(VaultBalanceAuditService.HARD_MAX_LIMIT, VaultBalanceAuditService.normalizeLimit(Integer.MAX_VALUE));
  }

  @Test
  void modeParsingDefaultsToOnlineAndRejectsUnknownValues() {
    assertEquals(VaultBalanceAuditService.Mode.ONLINE, VaultBalanceAuditService.Mode.parse(null));
    assertEquals(VaultBalanceAuditService.Mode.ONLINE, VaultBalanceAuditService.Mode.parse("online"));
    assertEquals(VaultBalanceAuditService.Mode.ALL, VaultBalanceAuditService.Mode.parse("all"));

    assertThrows(IllegalArgumentException.class, () -> VaultBalanceAuditService.Mode.parse("write"));
  }
}
