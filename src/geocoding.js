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

function getCoordinates(feature) {
  const [longitude, latitude] = feature.geometry?.coordinates || [];
  return { latitude, longitude };
}

function toLocation(feature) {
  const { latitude, longitude } = getCoordinates(feature);
  const properties = feature.properties || {};
  const label = formatPlaceLabel(properties);
  if (!label || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    id: `${properties.osm_type || "place"}/${properties.osm_id || feature.id || `${longitude},${latitude}`}`,
    label,
    latitude,
    longitude,
    bounds: feature.bbox || null,
  };
}

async function fetchPhoton(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Location lookup failed (${response.status}).`);
  }
  return response.json();
}

export async function searchLocations(query, { signal } = {}) {
  const url = new URL(PHOTON_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "6");
  url.searchParams.set("lang", getPreferredLanguage());

  const result = await fetchPhoton(url, signal);
  return (result.features || []).map(toLocation).filter(Boolean);
}

export async function reverseGeocodeLocation(latitude, longitude, { signal } = {}) {
  const url = new URL(PHOTON_ENDPOINT);
  url.pathname = url.pathname.replace(/\/api\/?$/, "/reverse");
  if (!url.pathname.endsWith("/reverse")) url.pathname = `${url.pathname.replace(/\/$/, "")}/reverse`;
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("lang", getPreferredLanguage());

  const result = await fetchPhoton(url, signal);
  return (result.features || []).map(toLocation).find(Boolean) || null;
}
