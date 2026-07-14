import { describe, it, expect } from "vitest";
import {
  travelMemberToForm,
  travelFormToPayload,
  travelFormsEqual,
  type TravelFormValue,
} from "./travelForm";

// Pure form <-> payload logic for the two-leg travel model (arrival +
// departure). Kept out of the "use client" TravelControls module so it can be
// unit-tested without pulling in React/tRPC.

describe("travelMemberToForm", () => {
  it("reads both the arrival and departure legs off a member row", () => {
    const form = travelMemberToForm({
      travel_mode: "flying",
      travel_detail: "Landing PNS",
      flight_arrival_time: "2026-09-09T15:30:00",
      departure_mode: "driving",
      departure_detail: "Carpool out",
      departure_time: "2026-09-13T11:00:00",
    });
    expect(form.mode).toBe("flying");
    expect(form.arrivalDate).toBe("2026-09-09");
    expect(form.arrivalTime).toBe("15:30");
    expect(form.departureMode).toBe("driving");
    expect(form.departureDate).toBe("2026-09-13");
    expect(form.departureTime).toBe("11:00");
    expect(form.departureDetail).toBe("Carpool out");
  });

  it("defaults an absent leg to null mode / empty fields", () => {
    const form = travelMemberToForm({ travel_mode: "flying", flight_arrival_time: "2026-09-09T00:00:00" });
    expect(form.departureMode).toBeNull();
    expect(form.departureDate).toBe("");
    expect(form.departureDetail).toBe("");
  });
});

function baseForm(overrides: Partial<TravelFormValue> = {}): TravelFormValue {
  return {
    mode: null,
    detail: "",
    arrivalDate: "",
    arrivalTime: "",
    departureMode: null,
    departureDetail: "",
    departureDate: "",
    departureTime: "",
    ...overrides,
  };
}

describe("travelFormToPayload", () => {
  it("builds the departure timestamp from date + time", () => {
    const payload = travelFormToPayload(
      baseForm({ departureMode: "flying", departureDate: "2026-09-13", departureTime: "22:15", departureDetail: "Red-eye" })
    );
    expect(payload.departureMode).toBe("flying");
    expect(payload.departureTime).toBe("2026-09-13T22:15:00");
    expect(payload.departureDetail).toBe("Red-eye");
  });

  it("uses a midnight sentinel for a date-only departure", () => {
    const payload = travelFormToPayload(baseForm({ departureMode: "driving", departureDate: "2026-09-13" }));
    expect(payload.departureTime).toBe("2026-09-13T00:00:00");
  });

  it("keeps the legs independent — a null arrival mode never wipes the departure", () => {
    const payload = travelFormToPayload(
      baseForm({ mode: null, departureMode: "flying", departureDate: "2026-09-13", departureTime: "22:15" })
    );
    // Arrival cleared...
    expect(payload.travelMode).toBeNull();
    expect(payload.flightArrivalTime).toBeNull();
    // ...departure preserved.
    expect(payload.departureMode).toBe("flying");
    expect(payload.departureTime).toBe("2026-09-13T22:15:00");
  });

  it("drops an orphan departure detail/date when no departure mode is picked", () => {
    const payload = travelFormToPayload(baseForm({ departureMode: null, departureDetail: "orphan", departureDate: "2026-09-13" }));
    expect(payload.departureMode).toBeNull();
    expect(payload.departureDetail).toBeNull();
    expect(payload.departureTime).toBeNull();
  });
});

describe("travelFormsEqual", () => {
  it("detects a change in the departure leg", () => {
    const a = baseForm({ mode: "flying", arrivalDate: "2026-09-09" });
    const b = baseForm({ mode: "flying", arrivalDate: "2026-09-09", departureMode: "driving" });
    expect(travelFormsEqual(a, b)).toBe(false);
  });

  it("treats identical two-leg forms as equal", () => {
    const mk = () => baseForm({ mode: "flying", arrivalDate: "2026-09-09", departureMode: "driving", departureDate: "2026-09-13" });
    expect(travelFormsEqual(mk(), mk())).toBe(true);
  });
});
