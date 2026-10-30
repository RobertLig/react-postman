import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import L from "leaflet";
import App from "./App";
import { getMeasurementSystem } from "./measurement";

afterEach(() => {
  delete window.navigator.language;
});

beforeEach(() => {
  window.fetch = jest.fn().mockResolvedValue({
    ok: true,
    text: async () => JSON.stringify({
      items: [{
        id: 7,
        type: "courier",
        userId: 3,
        postingPlace: "Berlin",
        receptionPlace: "Prague",
        postingDateTime: "2026-10-28T10:00:00",
        receptionDateTime: "2026-10-28T15:00:00",
        translations: [{ title: "Berlin to Prague", description: "Room for a small parcel." }],
      }],
      totalItems: 1,
    }),
  });
  window.sessionStorage.clear();
});

test("renders and loads route listings", async () => {
  render(<App />);

  expect(screen.getByRole("heading", { name: /send it with someone going your way/i })).toBeInTheDocument();
  expect(screen.getByText(/parcel delivery—not ride-sharing/i)).toBeInTheDocument();
  expect(await screen.findByText("Berlin to Prague")).toBeInTheDocument();
  await waitFor(() => expect(window.fetch).toHaveBeenCalledWith(
    expect.stringContaining("/announcements?page=0&size=12"),
    expect.objectContaining({ method: "GET" }),
  ));
});

test("opens route details from a listing", async () => {
  render(<App />);

  await screen.findByText("Berlin to Prague");
  fireEvent.click(screen.getByRole("button", { name: "View Berlin to Prague" }));

  expect(screen.getByRole("dialog", { name: "Berlin to Prague" })).toBeInTheDocument();
  const dialog = screen.getByRole("dialog", { name: "Berlin to Prague" });
  expect(within(dialog).getByText("Berlin")).toBeInTheDocument();
  expect(within(dialog).getByText("Prague")).toBeInTheDocument();
});

test("shows a non-interactive route map in details when coordinates are available", async () => {
  const supportsSvg = L.Browser.svg;
  L.Browser.svg = true;
  const polyline = jest.spyOn(L, "polyline");
  jest.spyOn(L.Map.prototype, "getSize").mockReturnValue(L.point(450, 300));
  const fitBounds = jest.spyOn(L.Map.prototype, "fitBounds");
  window.fetch.mockResolvedValue({
    ok: true,
    text: async () => JSON.stringify({
      items: [{
        id: 8,
        type: "courier",
        userId: 3,
        postingPlace: "Berlin",
        postingLatitude: 52.52,
        postingLongitude: 13.405,
        receptionPlace: "Prague",
        receptionLatitude: 50.0755,
        receptionLongitude: 14.4378,
        stops: [{ address: "Dresden, Germany", latitude: 51.0504, longitude: 13.7373, position: 0 }],
        postingDateTime: "2026-10-28T10:00:00",
        receptionDateTime: "2026-10-28T15:00:00",
        translations: [{ title: "Berlin to Prague", description: "" }],
      }],
      totalItems: 1,
    }),
  });

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "View Berlin to Prague" }));

  const dialog = screen.getByRole("dialog", { name: "Berlin to Prague" });
  expect(within(dialog).getByRole("img", { name: "Route map" })).toBeInTheDocument();
  await waitFor(() => expect(polyline).toHaveBeenLastCalledWith(
    [[52.52, 13.405], [51.0504, 13.7373], [50.0755, 14.4378]],
    { color: "#438b91", weight: 5, opacity: 1, interactive: false },
  ));
  expect(fitBounds).toHaveBeenCalledWith(
    [[52.52, 13.405], [51.0504, 13.7373], [50.0755, 14.4378]],
    { padding: [16, 16], maxZoom: 13 },
  );
  expect(within(dialog).getByText("Route overview")).toBeInTheDocument();
  expect(dialog.querySelectorAll(".location-map-marker")).toHaveLength(3);
  expect(dialog.querySelector(".leaflet-control-zoom")).not.toBeInTheDocument();

  polyline.mockRestore();
  fitBounds.mockRestore();
  L.Map.prototype.getSize.mockRestore();
  L.Browser.svg = supportsSvg;
});

test("shows departure and arrival times and ordered stops in route details", async () => {
  window.fetch.mockResolvedValue({
    ok: true,
    text: async () => JSON.stringify({
      items: [{
        id: 8,
        type: "courier",
        userId: 3,
        postingPlace: "Berlin",
        receptionPlace: "Prague",
        postingDateTime: "2026-10-28T10:00:00",
        receptionDateTime: "2026-10-28T15:00:00",
        stops: [
          { address: "Dresden, Germany", position: 1 },
          { address: "Leipzig, Germany", position: 0 },
        ],
        translations: [{ title: "Berlin to Prague", description: "Room for a small parcel." }],
      }],
      totalItems: 1,
    }),
  });

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "View Berlin to Prague" }));

  const dialog = screen.getByRole("dialog", { name: "Berlin to Prague" });
  expect(within(dialog).getByText("Leaving")).toBeInTheDocument();
  expect(within(dialog).getByText(/10:00/)).toBeInTheDocument();
  expect(within(dialog).getByText("Arriving by")).toBeInTheDocument();
  expect(within(dialog).getByText(/3:00/)).toBeInTheDocument();
  const stops = within(dialog).getByRole("list", { name: "" });
  expect(within(stops).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    "1Leipzig, Germany",
    "2Dresden, Germany",
  ]);
});

test.each([
  ["en-US", "Up to 22 lb", "3.9 × 7.9 × 11.8 in"],
  ["pl-PL", "Up to 10 kg", "10 × 20 × 30 cm"],
])("formats stored metric parcel limits for the %s browser locale", async (locale, expectedWeight, expectedDimensions) => {
  Object.defineProperty(window.navigator, "language", { configurable: true, value: locale });
  window.fetch.mockResolvedValue({
    ok: true,
    text: async () => JSON.stringify({
      items: [{
        id: 8,
        type: "courier",
        userId: 3,
        postingPlace: "Berlin",
        receptionPlace: "Prague",
        weight: { value: 10, unit: "metric" },
        dimensions: { width: 10, height: 20, length: 30, unit: "metric" },
        translations: [{ title: "Berlin to Prague", description: "" }],
      }],
      totalItems: 1,
    }),
  });

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "View Berlin to Prague" }));

  const dialog = screen.getByRole("dialog", { name: "Berlin to Prague" });
  expect(within(dialog).getByText(expectedWeight)).toBeInTheDocument();
  expect(within(dialog).getByText(expectedDimensions)).toBeInTheDocument();
});

test("keeps the photo gallery in the saved position order after sorting", async () => {
  window.sessionStorage.setItem("wayline.accessToken", "test-token");
  let sortRequest;
  window.fetch.mockImplementation(async (input, options = {}) => {
    const url = String(input);
    if (url.includes("/users/me")) {
      return {
        ok: true,
        text: async () => JSON.stringify({ id: 3, name: "Taylor Traveler", email: "taylor@example.com" }),
      };
    }
    if (url.includes("/photos/sort")) {
      sortRequest = JSON.parse(options.body);
      return {
        ok: true,
        text: async () => JSON.stringify([
          { id: 11, url: "https://images.example/first.jpg", position: 1 },
          { id: 12, url: "https://images.example/second.jpg", position: 0 },
        ]),
      };
    }
    return {
      ok: true,
      text: async () => JSON.stringify({
        items: [{
          id: 7,
          type: "sender",
          userId: 3,
          postingPlace: "Berlin",
          receptionPlace: "Prague",
          postingDateTime: "2026-10-28T10:00:00",
          receptionDateTime: "2026-10-28T15:00:00",
          translations: [{ title: "Berlin to Prague", description: "Room for a small parcel." }],
          photos: [
            { id: 11, url: "https://images.example/first.jpg", position: 0 },
            { id: 12, url: "https://images.example/second.jpg", position: 1 },
          ],
        }],
        totalItems: 1,
      }),
    };
  });

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "View Berlin to Prague" }));
  const dialog = screen.getByRole("dialog", { name: "Berlin to Prague" });
  expect(within(dialog).getByText("Add parcel photos")).toBeInTheDocument();
  fireEvent.click(within(dialog).getAllByRole("button", { name: "Move photo later" })[0]);

  await waitFor(() => {
    expect(sortRequest.map(({ id, position }) => ({ id, position }))).toEqual([
      { id: 12, position: 0 },
      { id: 11, position: 1 },
    ]);
    expect(Array.from(dialog.querySelectorAll(".photo-gallery img")).map((image) => image.src)).toEqual([
      "https://images.example/second.jpg",
      "https://images.example/first.jpg",
    ]);
  });
});

test("hides the add-photo control when the gallery reaches its three-photo limit", async () => {
    window.sessionStorage.setItem("wayline.accessToken", "test-token");
    window.fetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/users/me")) {
        return {
          ok: true,
          text: async () => JSON.stringify({ id: 3, name: "Taylor Traveler", email: "taylor@example.com" }),
        };
      }
      return {
        ok: true,
        text: async () => JSON.stringify({
          items: [{
            id: 7,
            type: "sender",
            userId: 3,
            postingPlace: "Berlin",
            receptionPlace: "Prague",
            postingDateTime: "2026-10-28T10:00:00",
            receptionDateTime: "2026-10-28T15:00:00",
            translations: [{ title: "Berlin to Prague", description: "Room for a small parcel." }],
            photos: [0, 1, 2].map((position) => ({
              id: position + 11,
              url: `https://images.example/${position}.jpg`,
              position,
            })),
          }],
          totalItems: 1,
        }),
      };
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "View Berlin to Prague" }));

    const dialog = screen.getByRole("dialog", { name: "Berlin to Prague" });
    expect(dialog.querySelectorAll(".photo-gallery img")).toHaveLength(3);
    expect(within(dialog).queryByText("Add parcel photos")).not.toBeInTheDocument();
});

test("opens the account dialog from the header", async () => {
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: "Log in" }));

  expect(screen.getByRole("dialog", { name: "Welcome back." })).toBeInTheDocument();
  expect(screen.getByLabelText("Email address")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Forgot your password?" })).toBeInTheDocument();
});

test("shows parcel photos only for ads requesting a courier", async () => {
  window.sessionStorage.setItem("wayline.accessToken", "test-token");
  window.fetch.mockImplementation(async (url) => ({
    ok: true,
    text: async () => JSON.stringify(url.includes("/users/me")
      ? { id: 3, name: "Taylor Traveler", email: "taylor@example.com" }
      : { items: [], totalItems: 0 }),
  }));

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /Post an ad/ }));

  expect(screen.queryByText("Add parcel photos")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /I need a parcel delivered/ }));
  expect(screen.getByText("Add parcel photos")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /I can deliver a parcel/ }));
  expect(screen.queryByText("Add parcel photos")).not.toBeInTheDocument();
});

test("previews selected route photos and releases previews when removed", async () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = jest.fn()
    .mockReturnValueOnce("blob:route-photo-preview")
    .mockReturnValueOnce("blob:route-photo-preview-2");
  URL.revokeObjectURL = jest.fn();
  window.sessionStorage.setItem("wayline.accessToken", "test-token");
  window.fetch.mockImplementation(async (url) => ({
    ok: true,
    text: async () => JSON.stringify(String(url).includes("/users/me")
      ? { id: 3, name: "Taylor Traveler", email: "taylor@example.com" }
      : { items: [], totalItems: 0 }),
  }));

  const { unmount } = render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /Post an ad/ }));
  fireEvent.click(screen.getByRole("button", { name: /I need a parcel delivered/ }));
  const photo = new File(["photo"], "parcel.png", { type: "image/png" });
  const secondPhoto = new File(["photo 2"], "parcel-2.png", { type: "image/png" });
  const picker = screen.getByLabelText("Add parcel photos");
  fireEvent.change(picker, { target: { files: [photo] } });
  fireEvent.change(picker, { target: { files: [secondPhoto] } });

  expect(screen.getByRole("img", { name: "Preview of parcel.png" })).toHaveAttribute("src", "blob:route-photo-preview");
  fireEvent.click(screen.getByRole("button", { name: "Move photo 2 up" }));
  expect(screen.getAllByRole("img").map((image) => image.getAttribute("alt"))).toEqual([
    "Preview of parcel-2.png",
    "Preview of parcel.png",
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Remove parcel-2.png" }));
  expect(screen.queryByRole("img", { name: "Preview of parcel-2.png" })).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:route-photo-preview-2");

  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:route-photo-preview");
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

test("selects geocoded cities and stops without exposing coordinate inputs", async () => {
  const supportsSvg = L.Browser.svg;
  L.Browser.svg = true;
  const polyline = jest.spyOn(L, "polyline");
  window.sessionStorage.setItem("wayline.accessToken", "test-token");
  window.fetch.mockImplementation(async (input, options = {}) => {
    const url = String(input);
    if (url.includes("photon.komoot.io")) {
      const query = new URL(url).searchParams.get("q").toLowerCase();
      const place = query.startsWith("ber")
        ? { name: "Berlin", country: "Germany", longitude: 13.405, latitude: 52.52 }
        : query.startsWith("pra")
          ? { name: "Prague", country: "Czechia", longitude: 14.4378, latitude: 50.0755 }
          : query.startsWith("leip")
            ? { name: "Leipzig", country: "Germany", longitude: 12.3731, latitude: 51.3397 }
          : { name: "Dresden", country: "Germany", longitude: 13.7373, latitude: 51.0504 };
      return {
        ok: true,
        json: async () => ({
          features: [{
            id: "place-1",
            properties: { name: place.name, city: place.name, country: place.country, osm_type: "R", osm_id: 1 },
            geometry: { coordinates: [place.longitude, place.latitude] },
            bbox: [place.longitude - 0.1, place.latitude - 0.1, place.longitude + 0.1, place.latitude + 0.1],
          }],
        }),
      };
    }

    if (url.includes("/users/me")) {
      return {
        ok: true,
        text: async () => JSON.stringify({ id: 3, name: "Taylor Traveler", email: "taylor@example.com" }),
      };
    }
    if (url.endsWith("/announcements") && options.method === "POST") {
      return {
        ok: true,
        text: async () => JSON.stringify({ announcement: { id: 9, ...JSON.parse(options.body) } }),
      };
    }
    return {
      ok: true,
      text: async () => JSON.stringify({ items: [], totalItems: 0 }),
    };
  });

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /Post an ad/ }));

  await userEvent.type(screen.getByRole("combobox", { name: "Starting city" }), "Ber");
  fireEvent.click(await screen.findByRole("option", { name: "Berlin, Germany" }));
  expect(document.querySelector(".location-map-marker.active")).toBeInTheDocument();
  await userEvent.type(screen.getByRole("combobox", { name: "Destination city" }), "Pra");
  fireEvent.click(await screen.findByRole("option", { name: "Prague, Czechia" }));
  fireEvent.click(screen.getByRole("button", { name: "Add stop" }));
  expect(screen.getByText("Active field: Stop 1")).toBeInTheDocument();
  await userEvent.type(screen.getByRole("combobox", { name: "Stop address" }), "Dres");
  fireEvent.click(await screen.findByRole("option", { name: "Dresden, Germany" }));
  fireEvent.click(screen.getByRole("button", { name: "Add stop" }));
  const stopInputs = screen.getAllByRole("combobox", { name: "Stop address" });
  await userEvent.type(stopInputs[1], "Leip");
  fireEvent.click(await screen.findByRole("option", { name: "Leipzig, Germany" }));

  expect(document.querySelectorAll(".location-map-marker")).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "Move stop 2 up" }));
  await waitFor(() => expect(polyline).toHaveBeenLastCalledWith(
    [[52.52, 13.405], [51.3397, 12.3731], [51.0504, 13.7373], [50.0755, 14.4378]],
    { color: "#438b91", weight: 5, opacity: 1 },
  ));
  polyline.mockRestore();
  L.Browser.svg = supportsSvg;
  expect(screen.queryByLabelText(/latitude|longitude/i)).not.toBeInTheDocument();
  const measurementSystem = getMeasurementSystem(navigator.language);
  fireEvent.click(screen.getByRole("checkbox", { name: "I can share a weight limit" }));
  await userEvent.type(screen.getByLabelText(`Maximum weight (${measurementSystem === "imperial" ? "lb" : "kg"})`), "10");
  fireEvent.click(screen.getByRole("checkbox", { name: "I can share maximum parcel dimensions" }));
  await userEvent.type(screen.getByLabelText(`Width (${measurementSystem === "imperial" ? "in" : "cm"})`), "10");
  await userEvent.type(screen.getByLabelText(`Height (${measurementSystem === "imperial" ? "in" : "cm"})`), "20");
  await userEvent.type(screen.getByLabelText(`Length (${measurementSystem === "imperial" ? "in" : "cm"})`), "30");
  await userEvent.type(screen.getByLabelText("Give your route a title"), "Berlin parcel trip");
  fireEvent.change(screen.getByLabelText("Leaving"), { target: { value: "2026-10-30T10:00" } });
  fireEvent.change(screen.getByLabelText("Arriving by"), { target: { value: "2026-10-30T15:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Publish ad" }));

  await waitFor(() => {
    const createRequest = window.fetch.mock.calls.find(
      ([url, options]) => String(url).endsWith("/announcements") && options.method === "POST",
    );
    expect(createRequest).toBeDefined();
    expect(JSON.parse(createRequest[1].body)).toEqual(expect.objectContaining({
      postingPlace: "Berlin, Germany",
      postingLatitude: 52.52,
      postingLongitude: 13.405,
      receptionPlace: "Prague, Czechia",
      receptionLatitude: 50.0755,
      receptionLongitude: 14.4378,
      weight: { value: 10, unit: measurementSystem },
      dimensions: {
        width: 10,
        height: 20,
        length: 30,
        unit: measurementSystem,
      },
      stops: [
        { address: "Leipzig, Germany", latitude: 51.3397, longitude: 12.3731, position: 0 },
        { address: "Dresden, Germany", latitude: 51.0504, longitude: 13.7373, position: 1 },
      ],
    }));
  });
});

test("clears optional profile fields and sends null values to the API", async () => {
  window.sessionStorage.setItem("wayline.accessToken", "test-token");
  window.fetch.mockImplementation(async (url, options = {}) => {
    const body = url.includes("/users/me")
      ? {
          id: 3,
          name: "Taylor Traveler",
          email: "taylor@example.com",
          ageRange: "RANGE_30_39",
          gender: "FEMALE",
          phone: "+123456789",
        }
      : {
          items: [],
          totalItems: 0,
        };
    return {
      ok: true,
      text: async () => JSON.stringify(body),
    };
  });

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /Taylor Traveler/ }));
  fireEvent.click(screen.getByRole("button", { name: "Clear age range" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear gender" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear phone number" }));
  fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));

  await waitFor(() => {
    const update = window.fetch.mock.calls.find(
      ([url, options]) => url.includes("/users/me") && options.method === "PUT",
    );
    expect(update).toBeDefined();
    expect(JSON.parse(update[1].body)).toEqual(expect.objectContaining({
      ageRange: null,
      gender: null,
      phone: null,
    }));
  });
});

test("refreshes delivery ads after deleting the account", async () => {
  window.sessionStorage.setItem("wayline.accessToken", "test-token");
  const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
  window.fetch.mockImplementation(async (input, options = {}) => {
    const url = String(input);
    if (url.includes("/users/me") && options.method === "DELETE") {
      return { ok: true, text: async () => "" };
    }
    if (url.includes("/users/me")) {
      return {
        ok: true,
        text: async () => JSON.stringify({ id: 3, name: "Taylor Traveler", email: "taylor@example.com" }),
      };
    }
    if (url.includes("/announcements")) {
      const deleted = window.fetch.mock.calls.some(
        ([calledUrl, calledOptions]) => String(calledUrl).includes("/users/me")
          && calledOptions.method === "DELETE",
      );
      return {
        ok: true,
        text: async () => JSON.stringify(deleted
          ? { items: [], totalItems: 0 }
          : {
              items: [{
                id: 7,
                type: "courier",
                userId: 3,
                translations: [{ title: "Berlin to Prague", description: "Room for a small parcel." }],
              }],
              totalItems: 1,
            }),
      };
    }
    return { ok: true, text: async () => "" };
  });

  render(<App />);
  expect(await screen.findByText("Berlin to Prague")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Taylor Traveler/ }));
  fireEvent.click(screen.getByRole("button", { name: "Delete account" }));

  await waitFor(() => {
    expect(screen.queryByText("Berlin to Prague")).not.toBeInTheDocument();
    expect(screen.getByText("Your Wayline account has been deleted.")).toBeInTheDocument();
  });
  expect(window.fetch).toHaveBeenCalledWith(
    expect.stringContaining("/announcements?page=0&size=12"),
    expect.objectContaining({ method: "GET" }),
  );
  confirmSpy.mockRestore();
});

test("defaults country from locale, allows changing country, and saves international format", async () => {
  Object.defineProperty(window.navigator, "language", {
    configurable: true,
    value: "en-GB",
  });
  window.sessionStorage.setItem("wayline.accessToken", "test-token");
  window.fetch.mockImplementation(async (url) => ({
    ok: true,
    text: async () => JSON.stringify(url.includes("/users/me")
      ? { id: 3, name: "Taylor Traveler", email: "taylor@example.com" }
      : { items: [], totalItems: 0 }),
  }));

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /Taylor Traveler/ }));

  expect(document.querySelector(".selected-flag")).toHaveAttribute(
    "title",
    "United Kingdom: + 44",
  );
  fireEvent.click(document.querySelector(".selected-flag"));
  fireEvent.click(await screen.findByText("Germany"));
  expect(document.querySelector(".selected-flag")).toHaveAttribute(
    "title",
    "Germany: + 49",
  );
  await userEvent.type(screen.getByLabelText(/Phone number/), "301234567");
  fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));

  await waitFor(() => {
    const update = window.fetch.mock.calls.find(
      ([url, options]) => url.includes("/users/me") && options.method === "PUT",
    );
    expect(update).toBeDefined();
    expect(JSON.parse(update[1].body).phone).toBe("+49301234567");
  });
});

test("prefills an existing international phone number in profile settings", async () => {
  window.sessionStorage.setItem("wayline.accessToken", "test-token");
  window.fetch.mockImplementation(async (url) => ({
    ok: true,
    text: async () => JSON.stringify(url.includes("/users/me")
      ? {
          id: 3,
          name: "Taylor Traveler",
          email: "taylor@example.com",
          phone: "+48123456789",
        }
      : { items: [], totalItems: 0 }),
  }));

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /Taylor Traveler/ }));

  await waitFor(() => {
    expect(screen.getByLabelText(/Phone number/).value.replace(/\D/g, "")).toContain("48123456789");
  });
  expect(document.querySelector(".selected-flag")).toHaveAttribute(
    "title",
    "Poland: + 48",
  );
});
