import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("fixture API behavior", () => {
  beforeEach(() => vi.resetModules());
  it("keeps edits across polls and isolates device histories", async () => {
    const { api } = await import("./api");
    await api.updateDevice("walker-1", {
      name: "Dad’s walker",
      limit_minutes: 360,
    });
    const detail = await api.device("walker-1");
    expect(detail.device.name).toBe("Dad’s walker");
    expect(detail.device.events).toEqual([]);
    expect(
      (await api.devices()).devices.find((d) => d.id === "walker-1")
        ?.limit_minutes,
    ).toBe(360);
  });
  it("resolves an alert and updates both history and overview", async () => {
    const { api } = await import("./api");
    await api.resolve(88);
    const detail = await api.device("fridge-1");
    expect(detail.device.active_alert).toBeNull();
    expect(detail.device.alerts.find((a) => a.id === 88)?.resolved_by).toBe(
      "family",
    );
    expect((await api.devices()).devices[0].status).toBe("ok");
  });
  it("supports the contact lifecycle and empty delete response", async () => {
    const { api } = await import("./api");
    const contact = await api.addContact({
      name: "Test",
      phone: "+14045550124",
    });
    expect((await api.contacts()).some((c) => c.id === contact.id)).toBe(true);
    await api.deleteContact(contact.id);
    expect((await api.contacts()).some((c) => c.id === contact.id)).toBe(false);
  });
  it("resets history while keeping devices and contacts", async () => {
    const { api } = await import("./api");
    await api.reset();
    const detail = await api.device("fridge-1");
    expect(detail.device.events).toEqual([]);
    expect(detail.device.baseline.ready).toBe(false);
    expect((await api.devices()).devices).toHaveLength(3);
    expect(await api.contacts()).toHaveLength(2);
  });
});

describe("live API transport", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_USE_MOCK", "false");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it("sends JSON updates and handles empty DELETE responses", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const { api } = await import("./api");
    await expect(api.deleteContact(3)).resolves.toBeUndefined();
    expect(fetch.mock.calls[0][0]).toBe("/api/contacts/3");
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ server_now: "now", device: { name: "Kitchen" } }),
      ),
    );
    await api.updateDevice("fridge-1", { name: "Kitchen" });
    expect(fetch.mock.calls[1][1].body).toBe(
      JSON.stringify({ name: "Kitchen" }),
    );
  });
  it("surfaces server errors without substituting fixtures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "Unknown device" }), {
          status: 404,
        }),
      ),
    );
    const { api } = await import("./api");
    await expect(api.device("missing")).rejects.toThrow("Unknown device");
  });
});
