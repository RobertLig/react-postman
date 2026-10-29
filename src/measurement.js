const IMPERIAL_REGIONS = new Set(["US", "LR", "MM"]);

export function getMeasurementSystem(locale) {
  let region = "";
  try {
    region = new Intl.Locale(locale || navigator.language).region || "";
  } catch {
    region = (locale || "").match(/[-_]([a-z]{2})(?:[-_]|$)/i)?.[1] || "";
  }

  return IMPERIAL_REGIONS.has(region.toUpperCase()) ? "imperial" : "metric";
}
