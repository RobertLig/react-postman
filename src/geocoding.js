const PHOTON_ENDPOINT =
  process.env.REACT_APP_GEOCODING_URL || "https://photon.komoot.io/api/";

function getPreferredLanguage() {
  const preferences = [
    ...(Array.isArray(navigator.languages) ? navigator.languages : []),
    navigator.language,
  ];

  for (const preference of preferences) {
    if (typeof preference !== "string" || !preference.trim()) continue;
    try {
      const language = new Intl.Locale(preference).language;
      if (language && language !== "und") return language;
    } catch {
      continue;
    }
  }

  return "en";
}

function formatPlaceLabel(properties) {
  const name = properties.name || properties.street || properties.locality;
  const locality = properties.city || properties.locality || properties.district;
  return [...new Set([name, locality, properties.state, properties.country].filter(Boolean))].join(", ");
}

export async function searchLocations(query, { signal } = {}) {
  const url = new URL(PHOTON_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "6");
  url.searchParams.set("lang", getPreferredLanguage());

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Location search failed (${response.status}).`);
  }

  const result = await response.json();
  return (result.features || []).flatMap((feature) => {
    const [longitude, latitude] = feature.geometry?.coordinates || [];
    const properties = feature.properties || {};
    const label = formatPlaceLabel(properties);
    if (!label || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];

    return [{
      id: `${properties.osm_type || "place"}/${properties.osm_id || feature.id || `${longitude},${latitude}`}`,
      label,
      latitude,
      longitude,
      bounds: feature.bbox || null,
    }];
  });
}
