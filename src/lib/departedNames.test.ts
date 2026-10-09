import { describe, it, expect } from "vitest";
import { withDeparted, departedMap } from "./departedNames";

describe("withDeparted — names for people who left, for lookup only", () => {
  const members = new Map([["u1", "Ann"], ["u2", "Bob"]]);

  it("fills an id the member list does not have", () => {
    const out = withDeparted(members, new Map([["u3", "Cal"]]), (n) => n);
    expect(out.get("u3")).toBe("Cal");
  });

  it("a CURRENT member always wins over a departure record (someone who came back)", () => {
    const out = withDeparted(members, new Map([["u1", "Old Ann"]]), (n) => n);
    expect(out.get("u1")).toBe("Ann");
  });

  it("hands the id to the value builder, so object values are complete", () => {
    const byId = new Map([["u1", { id: "u1", name: "Ann" }]]);
    const out = withDeparted(byId, new Map([["u3", "Cal"]]), (name, id) => ({ id, name }));
    expect(out.get("u3")).toEqual({ id: "u3", name: "Cal" });
  });

  it("never mutates the member map it was given", () => {
    withDeparted(members, new Map([["u3", "Cal"]]), (n) => n);
    expect([...members.keys()]).toEqual(["u1", "u2"]);
  });

  it("with no departures loaded yet, it is the member map unchanged", () => {
    expect(withDeparted(members, undefined, (n) => n)).toEqual(members);
  });

  it("departedMap turns the procedure's rows into the map withDeparted takes", () => {
    expect(departedMap([{ userId: "u3", displayName: "Cal" }]).get("u3")).toBe("Cal");
    expect(departedMap(undefined).size).toBe(0);
  });
});
