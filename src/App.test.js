import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import L from "leaflet";
import App from "./App";
import { getMeasurementSystem } from "./measurement";

afterEach(() => {
  delete window.navigator.language;
  delete window.navigator.languages;
  window.history.replaceState({}, "", "/");
});

function setBrowserLocale(locale) {
  Object.defineProperty(window.navigator, "language", { configurable: true, value: locale });
  Object.defineProperty(window.navigator, "languages", { configurable: true, value: [locale] });
}

beforeEach(() => {
  setBrowserLocale("en-US");
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

test("loads a page from its URL and responds to browser history navigation", async () => {
  window.history.replaceState({}, "", "/messages");
  render(<App />);

  expect(await screen.findByRole("heading", { name: "Conversations" })).toBeInTheDocument();

  window.history.replaceState({}, "", "/");
  fireEvent.popState(window);
  expect(await screen.findByRole("heading", { name: /send it with someone going your way/i })).toBeInTheDocument();
});

test("shows the Messages nav dot for an unread update in any conversation", async () => {
  const token = "messages-notification-token";
  const originalWebSocket = window.WebSocket;
  const sockets = [];
  window.sessionStorage.setItem("wayline.accessToken", token);
  window.WebSocket = class MockWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;

    constructor(url) {
      this.url = url;
      this.readyState = MockWebSocket.CONNECTING;
      sockets.push(this);
    }

    close() {
      this.readyState = 3;
    }
  };
  window.fetch.mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname;
    const result = path === "/users/me"
      ? { id: 7, name: "Regular User" }
      : path === "/conversations/list"
        ? [{ id: 10, unreadCount: 0 }, { id: 20, unreadCount: 0 }]
        : { items: [], totalItems: 0 };
    return { ok: true, text: async () => JSON.stringify(result) };
  });

  let unmount = () => {};
  try {
    ({ unmount } = render(<App />));
    await waitFor(() => expect(sockets).toHaveLength(2));
    expect(sockets.map((socket) => new URL(socket.url).pathname)).toEqual([
      "/ws/chat/10",
      "/ws/chat/20",
    ]);

    act(() => {
      sockets[1].onmessage({
        data: JSON.stringify({ event: "UNREAD_COUNT_UPDATE", conversationId: 20, unreadCount: 1 }),
      });
    });

    const messagesNavButton = await screen.findByRole("button", { name: /^Messages/ });
    expect(messagesNavButton.querySelector(".unread-dot")).toBeInTheDocument();
  } finally {
    unmount();
    window.WebSocket = originalWebSocket;
  }
});

test("does not mark a previous conversation message as read after switching conversations", async () => {
  const token = "conversation-read-token";
  const originalWebSocket = window.WebSocket;
  const conversations = [
    { id: 10, participants: [{ id: 7, name: "Current User" }, { id: 80, name: "Alex" }] },
    { id: 20, participants: [{ id: 7, name: "Current User" }, { id: 90, name: "Sam" }] },
  ];
  const readEvents = [];
  window.sessionStorage.setItem("wayline.accessToken", token);
  window.WebSocket = class MockWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;

    constructor() {
      this.readyState = MockWebSocket.CONNECTING;
    }

    close() {
      this.readyState = 3;
    }
  };
  window.fetch.mockImplementation(async (input, options = {}) => {
    const path = new URL(String(input)).pathname;
    let result = { items: [], totalItems: 0 };
    if (path === "/users/me") result = { id: 7, name: "Current User" };
    if (path === "/conversations/list") result = conversations;
    if (path === "/conversations/10/messages") {
      result = {
        messages: [{ id: 101, senderId: 80, content: "Message from Alex", createdAt: "2026-10-28T10:00:00Z" }],
        hasMore: false,
      };
    }
    if (path === "/conversations/20/messages") {
      result = {
        messages: [{ id: 201, senderId: 90, content: "Message from Sam", createdAt: "2026-10-28T11:00:00Z" }],
        hasMore: false,
      };
    }
    if (path === "/events") readEvents.push(JSON.parse(options.body));
    return { ok: true, text: async () => JSON.stringify(result) };
  });

  try {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^Messages/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Alex.*Open conversation/ }));
    expect(await screen.findByText("Message from Alex")).toBeInTheDocument();
    await waitFor(() => {
      expect(readEvents).toContainEqual({ conversationId: 10, messageId: 101, type: "READ" });
    });

    fireEvent.click(screen.getByRole("button", { name: "Find deliveries" }));
    fireEvent.click(screen.getByRole("button", { name: /^Messages/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Sam.*Open conversation/ }));
    expect(await screen.findByText("Message from Sam")).toBeInTheDocument();
    await waitFor(() => {
      expect(readEvents).toContainEqual({ conversationId: 20, messageId: 201, type: "READ" });
    });

    expect(readEvents).not.toContainEqual({ conversationId: 20, messageId: 101, type: "READ" });
  } finally {
    window.WebSocket = originalWebSocket;
  }
});

test("prevents an admin from sending a support reply to a self-only conversation", async () => {
  const token = "profile-role-token";
  window.sessionStorage.setItem("wayline.accessToken", token);
  window.fetch.mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname;
    const result = path === "/users/me"
      ? { id: 42, name: "Admin User", role: "ADMIN" }
      : path === "/conversations/support"
        ? [{ id: 90, participants: [{ id: 42, name: "Admin User" }] }]
        : path === "/conversations/90/messages"
          ? { messages: [], hasMore: false }
          : { items: [], totalItems: 0 };
    return { ok: true, text: async () => JSON.stringify(result) };
  });

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /^Messages/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Support queue" }));
  expect(screen.getByText("OPEN REQUESTS")).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: /Member.*Support conversation/ }));

  expect(await screen.findByRole("alert")).toHaveTextContent("can’t send a message to yourself");
  expect(screen.getByRole("textbox", { name: "Write a message" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  expect(window.fetch.mock.calls.some(([url]) => String(url).includes("/messages/support/reply"))).toBe(false);
});

test.each([
  {
    role: "USER",
    currentUser: { id: 7, name: "Regular User", role: "USER" },
    otherUser: { id: 88, name: "Support Agent" },
    inboxButton: "Support",
    conversationButton: /Wayline Support.*Support conversation/,
    blockedId: 88,
  },
  {
    role: "ADMIN",
    currentUser: { id: 42, name: "Admin User", role: "ADMIN" },
    otherUser: { id: 7, name: "Member" },
    inboxButton: "Support queue",
    conversationButton: /Member.*Support conversation/,
    blockedId: 7,
  },
])("allows $role users to block a participant in support conversations", async ({
  currentUser,
  otherUser,
  inboxButton,
  conversationButton,
  blockedId,
}) => {
  const token = "support-block-token";
  window.sessionStorage.setItem("wayline.accessToken", token);
  window.confirm = jest.fn(() => true);
  window.fetch.mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname;
    const result = path === "/users/me"
      ? currentUser
      : path === "/conversations/support"
        ? [{ id: 90, participants: [currentUser, otherUser] }]
        : path === "/conversations/90/messages"
          ? { messages: [], hasMore: false }
          : { items: [], totalItems: 0 };
    return { ok: true, text: async () => JSON.stringify(result) };
  });

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /^Messages/ }));
  fireEvent.click(await screen.findByRole("button", { name: inboxButton }));
  fireEvent.click(await screen.findByRole("button", { name: conversationButton }));
  fireEvent.click(await screen.findByRole("button", { name: "Block" }));

  await waitFor(() => {
    const blockRequest = window.fetch.mock.calls.find(([url]) => new URL(String(url)).pathname === "/block");
    expect(blockRequest).toBeDefined();
    expect(blockRequest[1].method).toBe("POST");
    expect(JSON.parse(blockRequest[1].body)).toEqual({ blockedId });
  });
  expect(await screen.findByRole("button", { name: "Unblock" })).toBeInTheDocument();
});

test.each([
  {
    role: "USER",
    currentUser: { id: 7, name: "Regular User", role: "USER" },
    otherUser: { id: 88, name: "Support Agent" },
    inboxButton: "Support",
    conversationButton: /Wayline Support.*Support conversation/,
  },
  {
    role: "ADMIN",
    currentUser: { id: 42, name: "Admin User", role: "ADMIN" },
    otherUser: { id: 7, name: "Member" },
    inboxButton: "Support queue",
    conversationButton: /Member.*Support conversation/,
  },
])("searches messages in $role support conversations", async ({
  currentUser,
  otherUser,
  inboxButton,
  conversationButton,
}) => {
  const token = "support-search-token";
  window.sessionStorage.setItem("wayline.accessToken", token);
  window.fetch.mockImplementation(async (input) => {
    const url = new URL(String(input));
    const result = url.pathname === "/users/me"
      ? currentUser
      : url.pathname === "/conversations/support"
        ? [{ id: 90, participants: [currentUser, otherUser] }]
        : url.pathname === "/conversations/90/messages"
          ? { messages: [], hasMore: false }
          : url.pathname === "/conversations/90/search"
            ? { messages: [{ id: 91, senderId: otherUser.id, content: "Found support answer", createdAt: "2026-10-28T10:00:00Z" }] }
            : { items: [], totalItems: 0 };
    return { ok: true, text: async () => JSON.stringify(result) };
  });

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /^Messages/ }));
  fireEvent.click(await screen.findByRole("button", { name: inboxButton }));
  fireEvent.click(await screen.findByRole("button", { name: conversationButton }));
  fireEvent.change(await screen.findByRole("textbox", { name: "Search this conversation" }), {
    target: { value: "billing help" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search messages" }));

  expect(await screen.findByText("Found support answer")).toBeInTheDocument();
  await waitFor(() => {
    const searchRequest = window.fetch.mock.calls.find(([input]) => new URL(String(input)).pathname === "/conversations/90/search");
    expect(searchRequest).toBeDefined();
    expect(new URL(String(searchRequest[0])).searchParams.get("query")).toBe("billing help");
  });
});

test.each([
  {
    role: "USER",
    currentUser: { id: 7, name: "Regular User", role: "USER" },
    otherUser: { id: 88, name: "Support Agent" },
    inboxButton: "Support",
    conversationButton: /Wayline Support.*Support conversation/,
    hideLabel: "Hide conversation with Support Agent",
  },
  {
    role: "ADMIN",
    currentUser: { id: 42, name: "Admin User", role: "ADMIN" },
    otherUser: { id: 7, name: "Member" },
    inboxButton: "Support queue",
    conversationButton: /Member.*Support conversation/,
    hideLabel: "Hide conversation with Member",
  },
])("hides and restores support conversations for $role", async ({
  currentUser,
  otherUser,
  inboxButton,
  conversationButton,
  hideLabel,
}) => {
  const token = "support-hide-token";
  let hidden = false;
  window.sessionStorage.setItem("wayline.accessToken", token);
  window.fetch.mockImplementation(async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.pathname === "/conversations/90" && options.method === "DELETE") hidden = true;
    if (url.pathname === "/conversations/90/restore" && options.method === "POST") hidden = false;
    const result = url.pathname === "/users/me"
      ? currentUser
      : url.pathname === "/conversations/support"
        ? hidden ? [] : [{ id: 90, participants: [currentUser, otherUser] }]
        : url.pathname === "/conversations/90/messages"
          ? { messages: [], hasMore: false }
          : { items: [], totalItems: 0 };
    return { ok: true, text: async () => JSON.stringify(result) };
  });

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /^Messages/ }));
  fireEvent.click(await screen.findByRole("button", { name: inboxButton }));
  fireEvent.click(await screen.findByRole("button", { name: conversationButton }));
  fireEvent.click(screen.getByRole("button", { name: hideLabel }));

  const restoreButton = await screen.findByRole("button", { name: "Restore recently hidden conversation" });
  expect(hidden).toBe(true);
  fireEvent.click(restoreButton);
  expect(await screen.findByRole("button", { name: conversationButton })).toBeInTheDocument();
  expect(hidden).toBe(false);
  expect(window.fetch.mock.calls.some(([url, options]) =>
    new URL(String(url)).pathname === "/conversations/90" && options.method === "DELETE")).toBe(true);
  expect(window.fetch.mock.calls.some(([url, options]) =>
    new URL(String(url)).pathname === "/conversations/90/restore" && options.method === "POST")).toBe(true);
});

test.each([
  {
    role: "USER",
    currentUser: { id: 7, name: "Regular User", role: "USER" },
    otherUser: { id: 88, name: "Support Agent" },
    inboxButton: "Support",
    conversationButton: /Wayline Support.*Support conversation/,
  },
  {
    role: "ADMIN",
    currentUser: { id: 42, name: "Admin User", role: "ADMIN" },
    otherUser: { id: 7, name: "Member" },
    inboxButton: "Support queue",
    conversationButton: /Member.*Support conversation/,
  },
])("refreshes the selected support conversation after returning from another page as $role", async ({
  currentUser,
  otherUser,
  inboxButton,
  conversationButton,
}) => {
  const token = "support-refresh-token";
  let latestMessageAvailable = false;
  const initialMessage = {
    id: 91,
    senderId: otherUser.id,
    content: "Earlier support message",
    createdAt: "2026-10-28T10:00:00Z",
  };
  const latestMessage = {
    id: 92,
    senderId: otherUser.id,
    content: "New support message",
    createdAt: "2026-10-28T10:01:00Z",
  };
  window.sessionStorage.setItem("wayline.accessToken", token);
  window.fetch.mockImplementation(async (input) => {
    const url = new URL(String(input));
    const result = url.pathname === "/users/me"
      ? currentUser
      : url.pathname === "/conversations/support"
        ? [{ id: 90, participants: [currentUser, otherUser] }]
        : url.pathname === "/conversations/90/messages"
          ? {
            messages: latestMessageAvailable ? [initialMessage, latestMessage] : [initialMessage],
            hasMore: false,
          }
          : { items: [], totalItems: 0 };
    return { ok: true, text: async () => JSON.stringify(result) };
  });

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /^Messages/ }));
  fireEvent.click(await screen.findByRole("button", { name: inboxButton }));
  fireEvent.click(await screen.findByRole("button", { name: conversationButton }));
  expect(await screen.findByText("Earlier support message")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /^Find deliveries/ }));
  latestMessageAvailable = true;
  fireEvent.click(screen.getByRole("button", { name: /^Messages/ }));

  expect(await screen.findByText("New support message")).toBeInTheDocument();
  expect(window.fetch.mock.calls.filter(([input]) =>
    new URL(String(input)).pathname === "/conversations/90/messages")).toHaveLength(2);
});

test("sends the advanced announcement filters in the backend search format", async () => {
  setBrowserLocale("pl-PL");
  render(<App />);

  expect(document.documentElement).toHaveAttribute("lang", "pl");
  expect(document.title).toBe("Wayline — dostawy przesyłek z podróżnymi");
  expect(screen.queryByLabelText("Search language")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Więcej filtrów"));
  fireEvent.change(screen.getByRole("textbox", { name: "Szukam" }), { target: { value: "parcel" } });
  fireEvent.change(screen.getByLabelText("Szerokość geograficzna miejsca nadania"), { target: { value: "52.52" } });
  fireEvent.change(screen.getByLabelText("Długość geograficzna miejsca nadania"), { target: { value: "13.405" } });
  fireEvent.change(screen.getByLabelText("Promień wyszukiwania (km)"), { target: { value: "25" } });
  fireEvent.change(screen.getByLabelText("Szerokość geograficzna miejsca odbioru"), { target: { value: "50.0755" } });
  fireEvent.change(screen.getByLabelText("Długość geograficzna miejsca odbioru"), { target: { value: "14.4378" } });
  fireEvent.change(screen.getByLabelText("Nadanie od"), { target: { value: "2026-10-28T10:00" } });
  fireEvent.change(screen.getByLabelText("Minimalna szerokość (cm)"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("Maksymalna waga (kg)"), { target: { value: "20" } });
  fireEvent.change(screen.getByLabelText("Wiek właściciela ogłoszenia"), { target: { value: "RANGE_30_39" } });
  fireEvent.change(screen.getByLabelText("Płeć właściciela ogłoszenia"), { target: { value: "FEMALE" } });
  fireEvent.change(screen.getByLabelText("Sortuj według"), { target: { value: "postingDate" } });
  fireEvent.change(screen.getByLabelText("Kierunek sortowania"), { target: { value: "desc" } });

  await waitFor(() => {
    const request = window.fetch.mock.calls.find(([url]) => String(url).includes("/announcements/search?"));
    expect(request).toBeDefined();
    const [url, options] = request;
    expect(new URL(String(url)).searchParams.get("page")).toBe("0");
    expect(JSON.parse(options.body)).toEqual(expect.objectContaining({
      text: "parcel",
      postingLatitude: 52.52,
      postingLongitude: 13.405,
      radiusKm: 25,
      receptionLatitude: 50.0755,
      receptionLongitude: 14.4378,
      postingFrom: "2026-10-28T10:00",
      minWidth: 10,
      maxWeight: 20,
      ownerAgeRange: "RANGE_30_39",
      ownerGender: "FEMALE",
      sortBy: "postingDate",
      sortDir: "desc",
    }));
    expect(JSON.parse(options.body)).not.toHaveProperty("userId");
    expect(JSON.parse(options.body)).not.toHaveProperty("language");
    expect(options.headers["Accept-Language"]).toBe("pl-PL");
    expect(options.method).toBe("POST");
  });
});

test("filters to the signed-in user's ads and exposes owner actions", async () => {
  window.sessionStorage.setItem("wayline.accessToken", "test-token");
  const announcement = {
    id: 15,
    type: "courier",
    userId: 3,
    postingPlace: "Berlin",
    receptionPlace: "Prague",
    translations: [{ title: "My Berlin route", description: "My delivery ad." }],
  };
  window.fetch.mockImplementation(async (input, options = {}) => {
    const url = String(input);
    if (url.includes("/users/me")) {
      return { ok: true, text: async () => JSON.stringify({ id: 3, name: "Taylor Traveler" }) };
    }
    if (url.includes("/announcements/search?")) {
      return {
        ok: true,
        text: async () => JSON.stringify({ items: [announcement], totalItems: 1, totalPages: 1 }),
      };
    }
    return {
      ok: true,
      text: async () => JSON.stringify({ items: [announcement], totalItems: 1, totalPages: 1 }),
    };
  });

  render(<App />);
  fireEvent.click(screen.getByText("More filters"));
  const myAdsFilter = await screen.findByLabelText("Show only my ads");
  await waitFor(() => expect(myAdsFilter).toBeEnabled());
  fireEvent.click(myAdsFilter);

  await waitFor(() => {
    const request = window.fetch.mock.calls.find(
      ([url, options]) => String(url).includes("/announcements/search?")
        && options.method === "POST",
    );
    expect(request).toBeDefined();
    expect(JSON.parse(request[1].body).userId).toBe(3);
  });

  fireEvent.click(await screen.findByRole("button", { name: "View My Berlin route" }));
  const dialog = screen.getByRole("dialog", { name: "My Berlin route" });
  expect(within(dialog).getByRole("button", { name: "Edit route" })).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Remove this route" })).toBeInTheDocument();
});

test("uses the browser locale for text search when the locale is not supported", async () => {
  setBrowserLocale("fr-FR");
  render(<App />);

  fireEvent.change(screen.getByLabelText("I’m looking for"), { target: { value: "parcel" } });

  await waitFor(() => {
    const request = window.fetch.mock.calls.find(([url]) => String(url).includes("/announcements/search?"));
    expect(request).toBeDefined();
    expect(request[1].headers["Accept-Language"]).toBe("fr-FR");
    expect(JSON.parse(request[1].body)).toEqual(expect.objectContaining({ text: "parcel" }));
    expect(JSON.parse(request[1].body)).not.toHaveProperty("language");
  });
});

test("shows the location picker and tracks which search field is active", async () => {
  window.fetch.mockImplementation(async (input) => {
    if (String(input).includes("/reverse")) {
      return {
        ok: true,
        json: async () => ({
          features: [{
            id: "test-town",
            properties: { name: "Test Town", city: "Test Town", country: "Poland", osm_type: "R", osm_id: 1 },
            geometry: { coordinates: [13.405, 52.52] },
          }],
        }),
      };
    }
    return {
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
    };
  });
  render(<App />);

  fireEvent.click(screen.getByText("More filters"));

  expect(await screen.findByRole("application", { name: "OpenStreetMap place picker" })).toBeInTheDocument();
  expect(screen.getByText("Active field: From")).toBeInTheDocument();

  fireEvent.focus(screen.getByPlaceholderText("Starting city"));
  fireEvent.click(screen.getByRole("application", { name: "OpenStreetMap place picker" }), {
    clientX: 120,
    clientY: 80,
  });
  await waitFor(() => expect(screen.getByPlaceholderText("Starting city").value).toBe("Test Town, Poland"));

  fireEvent.focus(screen.getByLabelText("Posting latitude"));
  expect(screen.getByText("Active field: Posting latitude")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Posting latitude"), { target: { value: "52.52" } });
  fireEvent.change(screen.getByLabelText("Posting longitude"), { target: { value: "13.405" } });

  expect(document.querySelectorAll(".search-filter-map .location-map-marker")).toHaveLength(2);
  fireEvent.focus(screen.getByLabelText("Posting latitude"));
  const postingLatitude = screen.getByLabelText("Posting latitude");
  fireEvent.click(screen.getByRole("application", { name: "OpenStreetMap place picker" }), {
    clientX: 160,
    clientY: 100,
  });
  await waitFor(() => expect(postingLatitude.value).not.toBe("52.52"));
  expect(screen.getByLabelText("Posting longitude")).toHaveValue(13.405);

  fireEvent.focus(screen.getByLabelText("Reception longitude"));
  expect(screen.getByText("Active field: Reception longitude")).toBeInTheDocument();
});

test("converts imperial parcel limits to the metric values stored by the backend", async () => {
  setBrowserLocale("en-US");
  render(<App />);

  fireEvent.click(screen.getByText("More filters"));
  fireEvent.change(screen.getByLabelText("I’m looking for"), { target: { value: "parcel" } });
  fireEvent.change(screen.getByLabelText("Search radius (mi)"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("Minimum width (in)"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("Minimum weight filter (lb)"), { target: { value: "22" } });

  await waitFor(() => {
    const request = window.fetch.mock.calls.find(([url]) => String(url).includes("/announcements/search?"));
    expect(request).toBeDefined();
    const filters = JSON.parse(request[1].body);
    expect(filters.radiusKm).toBe(16.09344);
    expect(filters.minWidth).toBe(25.4);
    expect(filters.minWeight).toBe(9.98);
  });
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

test("truncates long route place names without losing their full values", async () => {
  const startingPlace = "A very long starting place name that should not overflow the route details layout";
  const destination = "A very long destination place name that should not overflow the route details layout";
  window.fetch.mockResolvedValue({
    ok: true,
    text: async () => JSON.stringify({
      items: [{
        id: 8,
        type: "courier",
        userId: 3,
        postingPlace: startingPlace,
        receptionPlace: destination,
        translations: [{ title: "Long route", description: "" }],
      }],
      totalItems: 1,
    }),
  });

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "View Long route" }));

  const dialog = screen.getByRole("dialog", { name: "Long route" });
  const startingValue = within(dialog).getByTitle(startingPlace);
  const destinationValue = within(dialog).getByTitle(destination);
  expect(startingValue).toHaveTextContent(startingPlace);
  expect(destinationValue).toHaveTextContent(destination);
});

test("keeps long place names contained in route cards and exposes their full text", async () => {
  const startingPlace = "Gdansk, Pomeranian Voivodeship, Poland";
  const destination = "Paris, Île-de-France, France";
  window.fetch.mockResolvedValue({
    ok: true,
    text: async () => JSON.stringify({
      items: [{
        id: 8,
        type: "courier",
        userId: 3,
        postingPlace: startingPlace,
        receptionPlace: destination,
        translations: [{ title: "Long route", description: "" }],
      }],
      totalItems: 1,
    }),
  });

  render(<App />);

  const startLabel = await screen.findByTitle(startingPlace);
  const destinationLabel = screen.getByTitle(destination);
  expect(startLabel).toHaveClass("route-city-name");
  expect(destinationLabel).toHaveClass("route-city-name");
  expect(startLabel).toHaveTextContent(startingPlace);
  expect(destinationLabel).toHaveTextContent(destination);
});

test("prefills and saves every route field from the details edit form", async () => {
  const supportsSvg = L.Browser.svg;
  L.Browser.svg = true;
  jest.spyOn(L.Map.prototype, "getSize").mockReturnValue(L.point(450, 300));
  setBrowserLocale("pl-PL");
  window.sessionStorage.setItem("wayline.accessToken", "test-token");
  let savedRoute;
  const announcement = {
    id: 7,
    type: "sender",
    userId: 3,
    postingPlace: "Berlin",
    postingLatitude: 52.52,
    postingLongitude: 13.405,
    receptionPlace: "Prague",
    receptionLatitude: 50.0755,
    receptionLongitude: 14.4378,
    postingDateTime: "2026-10-28T10:00:00",
    receptionDateTime: "2026-10-28T15:00:00",
    weight: { value: 4.999999999999999, unit: "metric" },
    dimensions: { width: 4.999999999999999, height: 20.00000000001, length: 30.00000000001, unit: "metric" },
    stops: [{ id: 12, address: "Dresden", latitude: 51.0504, longitude: 13.7373, position: 0 }],
    translations: [{ title: "Berlin to Prague", description: "Room for a small parcel." }],
  };
  window.fetch.mockImplementation(async (input, options = {}) => {
    const url = String(input);
    if (url.includes("/users/me")) {
      return { ok: true, text: async () => JSON.stringify({ id: 3, name: "Taylor Traveler", email: "taylor@example.com" }) };
    }
    if (url.endsWith("/announcements/7") && options.method === "PUT") {
      savedRoute = JSON.parse(options.body);
      return { ok: true, text: async () => JSON.stringify({ announcement: { ...savedRoute, id: 7 } }) };
    }
    return {
      ok: true,
      text: async () => JSON.stringify({ items: [announcement], totalItems: 1 }),
    };
  });

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Zobacz Berlin to Prague" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Edytuj trasę" }));

  expect(within(dialog).getByText("Chcę wysłać przesyłkę")).toBeInTheDocument();
  expect(within(dialog).getByText("Przesyłka szuka kuriera")).toBeInTheDocument();
  expect(within(dialog).getByRole("heading", { name: "Dokąd ma dotrzeć przesyłka?" })).toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "Mogę dostarczyć przesyłkę" })).not.toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Miasto początkowe" })).toHaveValue("Berlin");
  expect(screen.getByRole("combobox", { name: "Miasto docelowe" })).toHaveValue("Prague");
  expect(screen.getByLabelText("Wyjazd")).toHaveValue("2026-10-28T10:00");
  expect(screen.getByLabelText("Przyjazd najpóźniej")).toHaveValue("2026-10-28T15:00");
  expect(within(dialog).getByLabelText("Maksymalna waga (kg)")).toHaveValue(5);
  expect(screen.getByLabelText("Szerokość (cm)")).toHaveValue(5);
  expect(screen.getByLabelText("Wysokość (cm)")).toHaveValue(20);
  expect(screen.getByLabelText("Długość (cm)")).toHaveValue(30);
  expect(screen.getByRole("combobox", { name: "Adres przystanku" })).toHaveValue("Dresden");
  expect(within(dialog).getByRole("application", { name: "Wybór miejsca na mapie OpenStreetMap" })).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Nadaj trasie tytuł"), { target: { value: "Updated Berlin trip" } });
  fireEvent.click(screen.getByRole("button", { name: /Zapisz trasę/ }));

  await waitFor(() => expect(savedRoute).toEqual(expect.objectContaining({
    type: "sender",
    postingPlace: "Berlin",
    postingLatitude: 52.52,
    postingLongitude: 13.405,
    receptionPlace: "Prague",
    receptionLatitude: 50.0755,
    receptionLongitude: 14.4378,
    postingDateTime: "2026-10-28T10:00",
    receptionDateTime: "2026-10-28T15:00",
    weight: { value: 5, unit: "metric" },
    dimensions: { width: 5, height: 20, length: 30, unit: "metric" },
    stops: [{ id: 12, address: "Dresden", latitude: 51.0504, longitude: 13.7373, position: 0 }],
    translations: [{ title: "Updated Berlin trip", description: "Room for a small parcel." }],
  })));

  L.Map.prototype.getSize.mockRestore();
  L.Browser.svg = supportsSvg;
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
  ["pl-PL", "Do 10 kg", "10 × 20 × 30 cm"],
])("formats stored metric parcel limits for the %s browser locale", async (locale, expectedWeight, expectedDimensions) => {
  setBrowserLocale(locale);
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
  fireEvent.click(await screen.findByRole("button", {
    name: locale === "pl-PL" ? "Zobacz Berlin to Prague" : "View Berlin to Prague",
  }));

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

test("hides the add-photo control for courier ads in the details dialog", async () => {
  window.sessionStorage.setItem("wayline.accessToken", "test-token");
  window.fetch.mockImplementation(async (input) => ({
    ok: true,
    text: async () => JSON.stringify(String(input).includes("/users/me")
      ? { id: 3, name: "Taylor Traveler", email: "taylor@example.com" }
      : {
        items: [{
          id: 7,
          type: "courier",
          userId: 3,
          postingPlace: "Berlin",
          receptionPlace: "Prague",
          translations: [{ title: "Berlin to Prague", description: "Room for a small parcel." }],
        }],
        totalItems: 1,
      }),
  }));

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "View Berlin to Prague" }));

  const dialog = screen.getByRole("dialog", { name: "Berlin to Prague" });
  expect(within(dialog).queryByText("Add parcel photos")).not.toBeInTheDocument();
});

test("loads sender photos for details and edit when listings omit the photo collection", async () => {
  window.sessionStorage.setItem("wayline.accessToken", "test-token");
  window.fetch.mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/users/me") {
      return {
        ok: true,
        text: async () => JSON.stringify({ id: 3, name: "Taylor Traveler", email: "taylor@example.com" }),
      };
    }
    if (url.pathname === "/announcements/7") {
      return {
        ok: true,
        text: async () => JSON.stringify({
          id: 7,
          type: "sender",
          userId: 3,
          postingPlace: "Berlin",
          receptionPlace: "Prague",
          translations: [{ title: "Berlin to Prague", description: "Room for a small parcel." }],
          photos: [
            { id: 11, url: "https://images.example/first.jpg", position: 0 },
            { id: 12, url: "https://images.example/second.jpg", position: 1 },
          ],
        }),
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
          translations: [{ title: "Berlin to Prague", description: "Room for a small parcel." }],
        }],
        totalItems: 1,
      }),
    };
  });

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "View Berlin to Prague" }));

  const dialog = screen.getByRole("dialog", { name: "Berlin to Prague" });
  expect(await within(dialog).findByRole("img", { name: "Route 1" })).toHaveAttribute(
    "src",
    "https://images.example/first.jpg",
  );
  fireEvent.click(within(dialog).getByRole("button", { name: /Edit route/ }));
  expect(within(dialog).getByRole("img", { name: "Route 2" })).toHaveAttribute(
    "src",
    "https://images.example/second.jpg",
  );
});

test("opens Google-only sign-in from the header", async () => {
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));

  expect(screen.getByRole("dialog", { name: "Welcome to Wayline." })).toBeInTheDocument();
  expect(screen.getByText("Create an account or sign in securely with your Google account.")).toBeInTheDocument();
  expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
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

  expect(screen.getByRole("heading", { name: "Where are you going?" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /I need a parcel delivered/ }));
  expect(screen.getByRole("heading", { name: "Where does your parcel need to go?" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /I can deliver a parcel/ }));
  expect(screen.getByRole("heading", { name: "Where are you going?" })).toBeInTheDocument();

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
  Object.defineProperty(window.navigator, "languages", {
    configurable: true,
    value: ["en-GB"],
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
