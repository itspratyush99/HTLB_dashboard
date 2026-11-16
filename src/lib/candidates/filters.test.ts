import { describe, expect, it } from "vitest";
import { cleanFilters, decodeFilters, describeFilters, encodeFilters, removeFilter } from "./filters";

const stages = [{ id: 3, name: "FAQ Invited", color: "#000", position: 3, requires_interviewer: false }];

describe("candidate filters", () => {
  it("drops empty values", () => {
    expect(cleanFilters({ q: " ", stage_ids: [], exp_min: undefined, company: " Bank ", screening: { a: { text: "" }, b: { min: 2 } } })).toEqual({
      company: "Bank",
      screening: { b: { min: 2 } },
    });
  });
  it("round-trips through the URL and ignores broken values", () => {
    const f = { stage_ids: [3], exp_min: 2 };
    expect(decodeFilters(encodeFilters(f))).toEqual(f);
    expect(decodeFilters("{not json")).toEqual({});
    expect(encodeFilters({})).toBe("");
  });
  it("describes and removes chips", () => {
    const f = { stage_ids: [3], exp_min: 2, exp_max: 5, screening: { "How many years?": { min: 1 } } };
    expect(describeFilters(f, stages, []).map((c) => c.label)).toEqual(["Stage: FAQ Invited", "Experience 2–5 yrs", "How many years? ≥ 1"]);
    expect(removeFilter(f, "exp")).toEqual({ stage_ids: [3], screening: { "How many years?": { min: 1 } } });
    expect(removeFilter(f, "screening:How many years?")).toEqual({ stage_ids: [3], exp_min: 2, exp_max: 5 });
  });
});
