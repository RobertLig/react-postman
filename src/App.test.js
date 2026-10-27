import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  expect(screen.getByRole("heading", { name: /good journeys/i })).toBeInTheDocument();
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
