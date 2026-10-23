import { describe, expect, it } from "vitest";

import { canTextNumber, permanentSmsErrorCode, permanentWhatsAppErrorCode } from "./smsReach";

describe("canTextNumber", () => {
  it("lets toll-free numbers text only US and Canadian numbers", () => {
    expect(canTextNumber("+18445550100", "+14165550134")).toBe(true);
    expect(canTextNumber("+18445550100", "+381695021111")).toBe(false);
    expect(canTextNumber("+18005550100", "+447700900123")).toBe(false);
  });

  it("leaves local numbers to the provider", () => {
    expect(canTextNumber("+14165550100", "+381695021111")).toBe(true);
  });

  it("can't text without a sender or a recipient", () => {
    expect(canTextNumber(undefined, "+14165550134")).toBe(false);
    expect(canTextNumber("+14165550100", null)).toBe(false);
  });
});

describe("permanentSmsErrorCode", () => {
  it("recognizes Twilio errors a retry can't fix", () => {
    expect(permanentSmsErrorCode(Object.assign(new Error("Permission to send an SMS has not been enabled"), { code: 21408, status: 400 }))).toBe(21408);
    expect(permanentSmsErrorCode({ code: 21211 })).toBe(21211);
  });

  it("leaves other failures to the retry", () => {
    expect(permanentSmsErrorCode(Object.assign(new Error("Too many requests"), { code: 20429, status: 429 }))).toBeUndefined();
    expect(permanentSmsErrorCode(new Error("socket hang up"))).toBeUndefined();
    expect(permanentSmsErrorCode(undefined)).toBeUndefined();
  });
});

describe("permanentWhatsAppErrorCode", () => {
  it("names the Twilio WhatsApp errors a retry can't fix", () => {
    for (const code of [21211, 63003, 63007, 63015, 63016, 63024]) expect(permanentWhatsAppErrorCode({ code })).toBe(code);
  });

  it("leaves rate limits and unknown failures to retry", () => {
    expect(permanentWhatsAppErrorCode({ code: 63018 })).toBeUndefined();
    expect(permanentWhatsAppErrorCode({ code: "63016" })).toBeUndefined();
    expect(permanentWhatsAppErrorCode(new Error("network"))).toBeUndefined();
    expect(permanentWhatsAppErrorCode(undefined)).toBeUndefined();
  });
});
