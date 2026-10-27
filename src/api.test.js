import { apiRequest, clearSession, getTokenRole, uploadFile } from "./api";

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.fetch = jest.fn();
});

test("reads the role claim for role-gated UI", () => {
  const payload = window.btoa(JSON.stringify({ groups: ["ADMIN"] }));
  expect(getTokenRole(`header.${payload}.signature`)).toBe("ADMIN");
  expect(getTokenRole("invalid-token")).toBe("");
});

test("refreshes an expired access token and retries the request", async () => {
  window.fetch
    .mockResolvedValueOnce(response(401, { error: "unauthorized" }))
    .mockResolvedValueOnce(response(200, { token: "fresh-token" }))
    .mockResolvedValueOnce(response(200, { id: 8 }));

  await expect(apiRequest("/users/me", { token: "expired-token" })).resolves.toEqual({ id: 8 });

  expect(window.fetch).toHaveBeenNthCalledWith(
    2,
    expect.stringContaining("/auth/refresh"),
    expect.objectContaining({ method: "POST", credentials: "include" }),
  );
  expect(window.fetch).toHaveBeenNthCalledWith(
    3,
    expect.any(String),
    expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer fresh-token" }) }),
  );
  clearSession();
});

test("uploads the selected file using the signed content type", async () => {
  window.fetch.mockResolvedValueOnce(response(200, null));
  const file = new File(["photo"], "route.png", { type: "image/png" });

  await uploadFile("https://storage.example/upload", file);

  expect(window.fetch).toHaveBeenCalledWith(
    "https://storage.example/upload",
    expect.objectContaining({
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: file,
    }),
  );
});
