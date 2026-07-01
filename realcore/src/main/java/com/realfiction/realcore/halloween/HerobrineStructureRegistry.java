package com.realfiction.realcore.halloween;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.logging.Logger;

/**
 * Persistent registry of Herobrine omen structures and every block they changed.
 *
 * <p>Core safety rule: no persistent block may exist without a restorable record here.
 * Serialization is hand-rolled JsonObject work (no reflection) and every save writes a
 * temp file first, then atomically replaces the registry, so a crash never corrupts it.
 * All mutating methods are synchronized; the file is tiny (a handful of structures).
 */
public final class HerobrineStructureRegistry {
  public record TrackedBlock(int x, int y, int z, String originalData, String placedData) {
  }

  public record TrackedStructure(
      UUID id,
      String world,
      String type,
      int centerX,
      int centerY,
      int centerZ,
      List<TrackedBlock> blocks,
      String reason,
      long createdAtMillis,
      Long restoredAtMillis
  ) {
    public boolean restored() {
      return restoredAtMillis != null;
    }

    public TrackedStructure withRestoredAt(long millis) {
      return new TrackedStructure(id, world, type, centerX, centerY, centerZ, blocks, reason, createdAtMillis, millis);
    }
  }

  private final Path file;
  private final Logger logger;
  private final Map<UUID, TrackedStructure> structures = new LinkedHashMap<>();

  public HerobrineStructureRegistry(Path file, Logger logger) {
    this.file = file;
    this.logger = logger;
  }

  public synchronized void load() {
    structures.clear();
    if (!Files.exists(file)) {
      return;
    }
    try {
      String raw = Files.readString(file, StandardCharsets.UTF_8);
      if (raw.isBlank()) {
        return;
      }
      JsonObject root = JsonParser.parseString(raw).getAsJsonObject();
      JsonArray list = root.has("structures") ? root.getAsJsonArray("structures") : new JsonArray();
      for (JsonElement element : list) {
        TrackedStructure structure = fromJson(element.getAsJsonObject());
        structures.put(structure.id(), structure);
      }
    } catch (IOException | RuntimeException error) {
      // Fail closed for placement (callers should treat a load failure as "cannot track"),
      // but never delete or overwrite the existing file with an empty registry.
      if (logger != null) {
        logger.severe("Failed to load Herobrine structure registry " + file + ": " + error.getMessage());
      }
      throw new IllegalStateException("Herobrine structure registry unavailable", error);
    }
  }

  /** Adds and saves. Throws (leaving no record) if the save fails — caller must not place. */
  public synchronized void addAndSave(TrackedStructure structure) throws IOException {
    structures.put(structure.id(), structure);
    try {
      save();
    } catch (IOException | RuntimeException error) {
      structures.remove(structure.id());
      throw error;
    }
  }

  public synchronized void removeAndSaveBestEffort(UUID id) {
    structures.remove(id);
    try {
      save();
    } catch (IOException | RuntimeException error) {
      if (logger != null) {
        logger.warning("Failed to save Herobrine structure registry after remove: " + error.getMessage());
      }
    }
  }

  public synchronized void markRestored(UUID id, long millis) throws IOException {
    TrackedStructure structure = structures.get(id);
    if (structure == null || structure.restored()) {
      return;
    }
    structures.put(id, structure.withRestoredAt(millis));
    save();
  }

  /** Removes restored entries; returns how many were dropped. */
  public synchronized int cleanupRestored() throws IOException {
    int before = structures.size();
    structures.values().removeIf(TrackedStructure::restored);
    int removed = before - structures.size();
    if (removed > 0) {
      save();
    }
    return removed;
  }

  public synchronized Optional<TrackedStructure> get(UUID id) {
    return Optional.ofNullable(structures.get(id));
  }

  public synchronized List<TrackedStructure> all() {
    List<TrackedStructure> copy = new ArrayList<>(structures.values());
    copy.sort(Comparator.comparingLong(TrackedStructure::createdAtMillis));
    return copy;
  }

  public synchronized List<TrackedStructure> activeIn(String world) {
    return all().stream()
        .filter(structure -> !structure.restored() && structure.world().equalsIgnoreCase(world))
        .toList();
  }

  public synchronized int activeCount(String world) {
    return activeIn(world).size();
  }

  public synchronized int activeCountTotal() {
    return (int) all().stream().filter(structure -> !structure.restored()).count();
  }

  private void save() throws IOException {
    JsonArray list = new JsonArray();
    for (TrackedStructure structure : structures.values()) {
      list.add(toJson(structure));
    }
    JsonObject root = new JsonObject();
    root.addProperty("version", 1);
    root.add("structures", list);

    Path parent = file.toAbsolutePath().getParent();
    if (parent != null) {
      Files.createDirectories(parent);
    }
    Path temp = file.resolveSibling(file.getFileName() + ".tmp");
    Files.writeString(temp, root.toString(), StandardCharsets.UTF_8);
    try {
      Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    } catch (AtomicMoveNotSupportedException fallback) {
      Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING);
    }
  }

  static JsonObject toJson(TrackedStructure structure) {
    JsonObject json = new JsonObject();
    json.addProperty("id", structure.id().toString());
    json.addProperty("world", structure.world());
    json.addProperty("type", structure.type());
    json.addProperty("centerX", structure.centerX());
    json.addProperty("centerY", structure.centerY());
    json.addProperty("centerZ", structure.centerZ());
    json.addProperty("reason", structure.reason());
    json.addProperty("createdAtMillis", structure.createdAtMillis());
    if (structure.restoredAtMillis() != null) {
      json.addProperty("restoredAtMillis", structure.restoredAtMillis());
    }
    JsonArray blocks = new JsonArray();
    for (TrackedBlock block : structure.blocks()) {
      JsonObject entry = new JsonObject();
      entry.addProperty("x", block.x());
      entry.addProperty("y", block.y());
      entry.addProperty("z", block.z());
      entry.addProperty("original", block.originalData());
      entry.addProperty("placed", block.placedData());
      blocks.add(entry);
    }
    json.add("blocks", blocks);
    return json;
  }

  static TrackedStructure fromJson(JsonObject json) {
    List<TrackedBlock> blocks = new ArrayList<>();
    JsonArray blockList = json.has("blocks") ? json.getAsJsonArray("blocks") : new JsonArray();
    for (JsonElement element : blockList) {
      JsonObject entry = element.getAsJsonObject();
      blocks.add(new TrackedBlock(
          entry.get("x").getAsInt(),
          entry.get("y").getAsInt(),
          entry.get("z").getAsInt(),
          entry.get("original").getAsString(),
          entry.get("placed").getAsString()
      ));
    }
    return new TrackedStructure(
        UUID.fromString(json.get("id").getAsString()),
        json.get("world").getAsString(),
        json.get("type").getAsString(),
        json.get("centerX").getAsInt(),
        json.get("centerY").getAsInt(),
        json.get("centerZ").getAsInt(),
        List.copyOf(blocks),
        json.has("reason") ? json.get("reason").getAsString() : "herobrine_omen",
        json.get("createdAtMillis").getAsLong(),
        json.has("restoredAtMillis") ? json.get("restoredAtMillis").getAsLong() : null
    );
  }
}
