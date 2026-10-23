// Twilio toll-free numbers can only text numbers in the US and Canada.
const TOLL_FREE = /^\+18(?:00|33|44|55|66|77|88)\d{7}$/;

/** Whether a sender can text this number. False without a sender. */
export function canTextNumber(from: string | null | undefined, to: string | null | undefined): boolean {
  if (!from || !to) return false;
  return !TOLL_FREE.test(from) || to.startsWith("+1");
}

// Twilio errors that fail the same way on every retry: an invalid number (21211),
// a country the account can't text (21408), an unsubscribed recipient (21610),
// a number the sender can't reach (21612) and a number that can't get texts (21614).
const PERMANENT_SMS_ERROR_CODES = new Set([21211, 21408, 21610, 21612, 21614]);

/** The Twilio error code when an SMS send failed in a way a retry can't fix. */
export function permanentSmsErrorCode(error: unknown): number | undefined {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "number" && PERMANENT_SMS_ERROR_CODES.has(code) ? code : undefined;
}

// WhatsApp errors that fail the same way on every retry: an invalid number
// (21211, 63024), a recipient with no WhatsApp account (63003), a sender that
// isn't a WhatsApp channel (63007), a sandbox recipient who hasn't joined
// (63015), and a message outside the 24-hour window that has no approved
// template (63016).
const PERMANENT_WHATSAPP_ERROR_CODES = new Set([21211, 63003, 63007, 63015, 63016, 63024]);

/** The Twilio error code when a WhatsApp send failed in a way a retry can't fix. */
export function permanentWhatsAppErrorCode(error: unknown): number | undefined {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "number" && PERMANENT_WHATSAPP_ERROR_CODES.has(code) ? code : undefined;
}
