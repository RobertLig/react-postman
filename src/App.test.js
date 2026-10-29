import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

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

test("opens the account dialog from the header", async () => {
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: "Log in" }));

  expect(screen.getByRole("dialog", { name: "Welcome back." })).toBeInTheDocument();
  expect(screen.getByLabelText("Email address")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Forgot your password?" })).toBeInTheDocument();
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
