package com.realfiction.realcore.economy;

import com.realfiction.realcore.config.EconomyProviderConfig;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Collections;
import java.util.List;
import net.milkbowl.vault.economy.Economy;
import net.milkbowl.vault.economy.EconomyResponse;
import net.milkbowl.vault.economy.EconomyResponse.ResponseType;
import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;

/**
 * Vault {@link Economy} implementation backed by RealCore's shared Supabase economy.
 *
 * <p>The {@link OfflinePlayer} methods (which carry the UUID) do the real work against
 * {@link EconomyProviderService}'s cache + write-through; the deprecated name-based methods delegate
 * to them. Banks are not supported. No-op until {@link EconomyProviderService} is live.
 */
@SuppressWarnings("deprecation") // the name-based Economy methods + Bukkit.getOfflinePlayer(String) are required by the API
public final class EconomyVaultProvider implements Economy {
  private final EconomyProviderService service;
  private final EconomyProviderConfig config;

  public EconomyVaultProvider(EconomyProviderService service, EconomyProviderConfig config) {
    this.service = service;
    this.config = config;
  }

  // -- metadata ---------------------------------------------------------------

  @Override
  public boolean isEnabled() {
    return service.live();
  }

  @Override
  public String getName() {
    return "RealCore";
  }

  @Override
  public boolean hasBankSupport() {
    return false;
  }

  @Override
  public int fractionalDigits() {
    return config.fractionalDigits();
  }

  @Override
  public String format(double amount) {
    BigDecimal value = BigDecimal.valueOf(amount).setScale(config.fractionalDigits(), RoundingMode.HALF_UP);
    return config.currencySymbol() + value.toPlainString();
  }

  @Override
  public String currencyNamePlural() {
    return config.currencyNamePlural();
  }

  @Override
  public String currencyNameSingular() {
    return config.currencyNameSingular();
  }

  // -- accounts (RealCore auto-provisions on preload) -------------------------

  @Override
  public boolean hasAccount(OfflinePlayer player) {
    return player != null;
  }

  @Override
  public boolean hasAccount(OfflinePlayer player, String worldName) {
    return player != null;
  }

  @Override
  public boolean createPlayerAccount(OfflinePlayer player) {
    return true;
  }

  @Override
  public boolean createPlayerAccount(OfflinePlayer player, String worldName) {
    return true;
  }

  // -- balance ----------------------------------------------------------------

  @Override
  public double getBalance(OfflinePlayer player) {
    return player == null ? 0d : service.balanceDouble(player.getUniqueId());
  }

  @Override
  public double getBalance(OfflinePlayer player, String world) {
    return getBalance(player);
  }

  @Override
  public boolean has(OfflinePlayer player, double amount) {
    return player != null && service.hasBalance(player.getUniqueId(), amount);
  }

  @Override
  public boolean has(OfflinePlayer player, String worldName, double amount) {
    return has(player, amount);
  }

  // -- mutations --------------------------------------------------------------

  @Override
  public EconomyResponse depositPlayer(OfflinePlayer player, double amount) {
    if (player == null) {
      return fail(amount, 0d, "Unknown player.");
    }
    return toResponse(amount, service.deposit(player.getUniqueId(), player.getName(), amount));
  }

  @Override
  public EconomyResponse depositPlayer(OfflinePlayer player, String worldName, double amount) {
    return depositPlayer(player, amount);
  }

  @Override
  public EconomyResponse withdrawPlayer(OfflinePlayer player, double amount) {
    if (player == null) {
      return fail(amount, 0d, "Unknown player.");
    }
    return toResponse(amount, service.withdraw(player.getUniqueId(), player.getName(), amount));
  }

  @Override
  public EconomyResponse withdrawPlayer(OfflinePlayer player, String worldName, double amount) {
    return withdrawPlayer(player, amount);
  }

  // -- deprecated name-based delegations --------------------------------------

  @Override
  public boolean hasAccount(String playerName) {
    return hasAccount(offline(playerName));
  }

  @Override
  public boolean hasAccount(String playerName, String worldName) {
    return hasAccount(offline(playerName), worldName);
  }

  @Override
  public double getBalance(String playerName) {
    return getBalance(offline(playerName));
  }

  @Override
  public double getBalance(String playerName, String world) {
    return getBalance(offline(playerName), world);
  }

  @Override
  public boolean has(String playerName, double amount) {
    return has(offline(playerName), amount);
  }

  @Override
  public boolean has(String playerName, String worldName, double amount) {
    return has(offline(playerName), worldName, amount);
  }

  @Override
  public EconomyResponse withdrawPlayer(String playerName, double amount) {
    return withdrawPlayer(offline(playerName), amount);
  }

  @Override
  public EconomyResponse withdrawPlayer(String playerName, String worldName, double amount) {
    return withdrawPlayer(offline(playerName), worldName, amount);
  }

  @Override
  public EconomyResponse depositPlayer(String playerName, double amount) {
    return depositPlayer(offline(playerName), amount);
  }

  @Override
  public EconomyResponse depositPlayer(String playerName, String worldName, double amount) {
    return depositPlayer(offline(playerName), worldName, amount);
  }

  @Override
  public boolean createPlayerAccount(String playerName) {
    return true;
  }

  @Override
  public boolean createPlayerAccount(String playerName, String worldName) {
    return true;
  }

  // -- banks: unsupported -----------------------------------------------------

  @Override
  public EconomyResponse createBank(String name, String player) {
    return notImplemented();
  }

  @Override
  public EconomyResponse createBank(String name, OfflinePlayer player) {
    return notImplemented();
  }

  @Override
  public EconomyResponse deleteBank(String name) {
    return notImplemented();
  }

  @Override
  public EconomyResponse bankBalance(String name) {
    return notImplemented();
  }

  @Override
  public EconomyResponse bankHas(String name, double amount) {
    return notImplemented();
  }

  @Override
  public EconomyResponse bankWithdraw(String name, double amount) {
    return notImplemented();
  }

  @Override
  public EconomyResponse bankDeposit(String name, double amount) {
    return notImplemented();
  }

  @Override
  public EconomyResponse isBankOwner(String name, String playerName) {
    return notImplemented();
  }

  @Override
  public EconomyResponse isBankOwner(String name, OfflinePlayer player) {
    return notImplemented();
  }

  @Override
  public EconomyResponse isBankMember(String name, String playerName) {
    return notImplemented();
  }

  @Override
  public EconomyResponse isBankMember(String name, OfflinePlayer player) {
    return notImplemented();
  }

  @Override
  public List<String> getBanks() {
    return Collections.emptyList();
  }

  // -- helpers ----------------------------------------------------------------

  private OfflinePlayer offline(String name) {
    return Bukkit.getOfflinePlayer(name);
  }

  private EconomyResponse toResponse(double amount, EconomyProviderService.TxResult result) {
    return new EconomyResponse(
        amount,
        result.balance(),
        result.success() ? ResponseType.SUCCESS : ResponseType.FAILURE,
        result.success() ? "" : result.error());
  }

  private EconomyResponse fail(double amount, double balance, String error) {
    return new EconomyResponse(amount, balance, ResponseType.FAILURE, error);
  }

  private EconomyResponse notImplemented() {
    return new EconomyResponse(0d, 0d, ResponseType.NOT_IMPLEMENTED, "RealCore economy has no bank support.");
  }
}
