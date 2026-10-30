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

function formatNumber(value, locale) {
  const resolvedLocale = locale || navigator.language || "en";
  return new Intl.NumberFormat(resolvedLocale, { maximumFractionDigits: 1 }).format(value);
}

export function formatStoredWeight(value, locale) {
  const system = getMeasurementSystem(locale);
  const displayedValue = system === "imperial" ? Number(value) * 2.2046226218 : Number(value);
  return `${formatNumber(displayedValue, locale)} ${system === "imperial" ? "lb" : "kg"}`;
}

export function formatStoredDimensions(dimensions, locale) {
  const system = getMeasurementSystem(locale);
  const factor = system === "imperial" ? 1 / 2.54 : 1;
  const unit = system === "imperial" ? "in" : "cm";
  const formattedDimensions = [dimensions.width, dimensions.height, dimensions.length]
    .map((value) => formatNumber(Number(value) * factor, locale));
  return `${formattedDimensions.join(" × ")} ${unit}`;
}
