import { describe, expect, it } from "vitest";

import { appointmentNotificationSkipReason, appointmentTemplateVariables, buildAppointmentNotification, CANCELLATION_CONFIRMATION, WHATSAPP_BOOKING_CONFIRMATION } from "./notifications";

// A text to a subscribed contact from a business number that can reach them.
const text = { channel: "sms", smsConsentStatus: "subscribed", operatorBlockedAt: null, senderPhone: "+14165550000", contactPhone: "+14165550100", contactEmail: null };
const cancellation = { ...text, kind: CANCELLATION_CONFIRMATION, appointmentStatus: "canceled" };

describe("appointment notification delivery", () => {
  it("sends the cancellation text for a cancelled appointment to a subscribed contact", () => {
    expect(appointmentNotificationSkipReason(cancellation)).toBeNull();
  });

  it("sends nothing else for a cancelled appointment, and no cancellation text for one still booked", () => {
    for (const kind of ["booking_confirmation", "appointment_reminder"]) {
      expect(appointmentNotificationSkipReason({ ...text, kind, appointmentStatus: "canceled" })).toBe("appointment_status");
      expect(appointmentNotificationSkipReason({ ...text, kind, appointmentStatus: "confirmed" })).toBeNull();
    }
    expect(appointmentNotificationSkipReason({ ...cancellation, appointmentStatus: "confirmed" })).toBe("appointment_status");
  });

  it.each([
    ["declined", { smsConsentStatus: "declined" }, "sms_consent"],
    ["opted_out", { smsConsentStatus: "opted_out" }, "sms_consent"],
    ["never asked", { smsConsentStatus: null }, "sms_consent"],
    ["blocked by the business", { operatorBlockedAt: new Date() }, "sms_blocked"],
    ["without an SMS number", { senderPhone: null }, "sms_unreachable"],
    ["a toll-free number abroad", { senderPhone: "+18445550100", contactPhone: "+381695021111" }, "sms_unreachable"],
  ] as const)("skips the cancellation text for a contact %s", (_label, change, reason) => {
    expect(appointmentNotificationSkipReason({ ...cancellation, ...change })).toBe(reason);
  });
});

// A WhatsApp confirmation: the business turned it on, and the customer agreed to texts.
const whatsapp = { kind: WHATSAPP_BOOKING_CONFIRMATION, channel: "whatsapp", appointmentStatus: "confirmed", smsConsentStatus: "subscribed", operatorBlockedAt: null, senderPhone: null, contactPhone: "+14165550100", contactEmail: null, whatsappEnabled: true };

describe("WhatsApp booking confirmation", () => {
  it("goes to a subscribed customer's phone when the business has it on", () => {
    expect(appointmentNotificationSkipReason(whatsapp)).toBeNull();
  });

  it("doesn't need an SMS sender: WhatsApp has its own platform sender", () => {
    expect(appointmentNotificationSkipReason({ ...whatsapp, senderPhone: null })).toBeNull();
  });

  it.each([
    ["the business turned WhatsApp off after it was queued", { whatsappEnabled: false }, "whatsapp_disabled"],
    ["the setting is missing", { whatsappEnabled: undefined }, "whatsapp_disabled"],
    ["the customer declined texts", { smsConsentStatus: "declined" }, "sms_consent"],
    ["the customer texted STOP", { smsConsentStatus: "opted_out" }, "sms_consent"],
    ["the customer was never asked", { smsConsentStatus: null }, "sms_consent"],
    ["the business blocked the customer", { operatorBlockedAt: new Date() }, "sms_blocked"],
    ["there is no phone number", { contactPhone: null }, "whatsapp_unreachable"],
    ["the number isn't E.164", { contactPhone: "4165550100" }, "whatsapp_unreachable"],
  ] as const)("is skipped when %s", (_label, change, reason) => {
    expect(appointmentNotificationSkipReason({ ...whatsapp, ...change })).toBe(reason);
  });

  it("is skipped once the appointment is cancelled", () => {
    expect(appointmentNotificationSkipReason({ ...whatsapp, appointmentStatus: "canceled" })).toBe("appointment_status");
  });

  it("uses its own kind, so it doesn't collide with the SMS confirmation's unique row", () => {
    expect(WHATSAPP_BOOKING_CONFIRMATION).not.toBe("booking_confirmation");
  });

  it("words the confirmation like the SMS one, without the SMS opt-out line, and fills the template in order", () => {
    const base = { kind: WHATSAPP_BOOKING_CONFIRMATION, locale: "en" as const, businessName: "Maple Clinic", serviceName: "Cleaning", startsAt: new Date("2026-10-20T15:00:00Z"), timezone: "America/Toronto" };
    const sms = buildAppointmentNotification({ ...base, channel: "sms" });
    const wa = buildAppointmentNotification({ ...base, channel: "whatsapp" });
    expect(wa.body).toContain("Maple Clinic: your Cleaning appointment is confirmed for");
    expect(wa.body).not.toMatch(/STOP|HELP/);
    expect(sms.body).toMatch(/STOP/);
    expect(appointmentTemplateVariables(base)).toEqual({ "1": "Maple Clinic", "2": "Cleaning", "3": expect.stringContaining("2026") });
  });
});
