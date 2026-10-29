import { reverseGeocodeLocation, searchLocations } from "./geocoding";

afterEach(() => {
  jest.restoreAllMocks();
});

test("requests place names using the browser's preferred language", async () => {
  Object.defineProperty(navigator, "languages", {
    configurable: true,
    value: ["fr-CA", "en-US"],
  });
  Object.defineProperty(navigator, "language", {
    configurable: true,
    value: "en-US",
  });
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      features: [{
        properties: { name: "Montréal", city: "Montréal", country: "Canada", osm_type: "R", osm_id: 1 },
        geometry: { coordinates: [-73.5673, 45.5019] },
      }],
    }),
  });

  const locations = await searchLocations("Montréal");
  const requestUrl = new URL(global.fetch.mock.calls[0][0]);

  expect(requestUrl.searchParams.get("lang")).toBe("fr");
  expect(locations[0]).toEqual(expect.objectContaining({
    label: "Montréal, Canada",
    latitude: 45.5019,
    longitude: -73.5673,
  }));
});

test("falls back to the browser language when the preference list is unavailable", async () => {
  Object.defineProperty(navigator, "languages", {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(navigator, "language", {
    configurable: true,
    value: "pl-PL",
  });
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ features: [] }),
  });

  await searchLocations("Warszawa");

  expect(new URL(global.fetch.mock.calls[0][0]).searchParams.get("lang")).toBe("pl");
});

test("reverse geocodes map clicks using the localized Photon endpoint", async () => {
  Object.defineProperty(navigator, "languages", {
    configurable: true,
    value: ["de-DE"],
  });
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      features: [{
        properties: { name: "Berlin", city: "Berlin", country: "Deutschland", osm_type: "R", osm_id: 2 },
        geometry: { coordinates: [13.4, 52.5] },
      }],
    }),
  });

  const place = await reverseGeocodeLocation(52.51, 13.41);
  const requestUrl = new URL(global.fetch.mock.calls[0][0]);

  expect(requestUrl.pathname).toBe("/reverse");
  expect(requestUrl.searchParams.get("lat")).toBe("52.51");
  expect(requestUrl.searchParams.get("lon")).toBe("13.41");
  expect(requestUrl.searchParams.get("lang")).toBe("de");
  expect(place.label).toBe("Berlin, Deutschland");
});
