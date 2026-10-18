import { NextResponse } from "next/server";

import { getWhatsAppConfirmationSetting, setWhatsAppConfirmations } from "@lobbystack/domain";
import { asApiResponse, businessIdFromRequest, jsonError, readJson, requireApiSession } from "@/lib/api-helpers";
import { createDomainContext } from "@/lib/domain-context";

export const dynamic = "force-dynamic";

/**
 * Whether WhatsApp can send at all on this deployment. The sender is a platform
 * setting, so a business can switch the feature on before one exists. Delivery then
 * skips the confirmation instead of failing it.
 */
function whatsAppConfigured(): { configured: boolean; template: boolean } {
  const configured = Boolean(process.env.TWILIO_WHATSAPP_FROM && process.env.TWILIO_ACCOUNT_SID);
  return { configured, template: Boolean(process.env.TWILIO_WHATSAPP_CONFIRMATION_CONTENT_SID) };
}

export async function GET(request: Request) {
  try {
    const session = await requireApiSession(request);
    const businessId = businessIdFromRequest(request);
    if (!businessId) return jsonError("businessId is required.", 400);
    const setting = await getWhatsAppConfirmationSetting(createDomainContext(), { userId: session.user.id, businessId });
    return NextResponse.json({ ...setting, ...whatsAppConfigured() });
  } catch (error) { return asApiResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireApiSession(request);
    const businessId = businessIdFromRequest(request);
    const body = await readJson(request) as { enabled?: unknown };
    if (!businessId || typeof body.enabled !== "boolean") return jsonError("businessId and enabled are required.", 400);
    const result = await setWhatsAppConfirmations(createDomainContext(), { userId: session.user.id, businessId, enabled: body.enabled });
    return NextResponse.json({ enabled: result.enabled, ...whatsAppConfigured() });
  } catch (error) { return asApiResponse(error); }
}
