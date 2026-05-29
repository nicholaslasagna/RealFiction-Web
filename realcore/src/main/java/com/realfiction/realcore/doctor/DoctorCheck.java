package com.realfiction.realcore.doctor;

/** One diagnostic line for /rf doctor. */
public record DoctorCheck(DoctorLevel level, String label, String detail) {
  public String formatLine() {
    return "[" + level.name() + "] " + label + ": " + (detail == null || detail.isBlank() ? "ok" : detail);
  }
}
