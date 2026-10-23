import { eq } from "drizzle-orm";

import { auditLogs, businesses, withBusinessTransaction } from "@lobbystack/db";

import { requireBusinessMembership } from "../authz";
import type { DomainContext } from "./context";

/** Whether this business also confirms booked appointments to customers on WhatsApp. Any member may read it. */
export async function getWhatsAppConfirmationSetting(
  context: DomainContext,
  input: { userId: string; businessId: string },
): Promise<{ enabled: boolean }> {
  return await withBusinessTransaction(context.db, { ...input, actorType: "operator" }, async (tx) => {
    await requireBusinessMembership(tx, input);
    const [row] = await tx.select({ enabled: businesses.whatsappConfirmationsEnabled }).from(businesses).where(eq(businesses.id, input.businessId)).limit(1);
    return { enabled: row?.enabled ?? false };
  });
}

/**
 * Turns WhatsApp confirmations on or off. It only changes what the next booking
 * queues: a confirmation already queued is checked against the setting again
 * when it is sent, so turning it off also stops those.
 */
export async function setWhatsAppConfirmations(
  context: DomainContext,
  input: { userId: string; businessId: string; enabled: boolean },
): Promise<{ enabled: boolean; changed: boolean }> {
  return await withBusinessTransaction(context.db, { ...input, actorType: "operator" }, async (tx) => {
    await requireBusinessMembership(tx, { userId: input.userId, businessId: input.businessId, minimumRole: "business_admin" });
    const [current] = await tx.select({ enabled: businesses.whatsappConfirmationsEnabled }).from(businesses).where(eq(businesses.id, input.businessId)).limit(1);
    if (!current) throw new Error("Business not found.");
    if (current.enabled === input.enabled) return { enabled: input.enabled, changed: false };
    await tx.update(businesses).set({ whatsappConfirmationsEnabled: input.enabled, updatedAt: new Date() }).where(eq(businesses.id, input.businessId));
    await tx.insert(auditLogs).values({
      businessId: input.businessId,
      actorUserId: input.userId,
      eventType: input.enabled ? "whatsapp_confirmations.enabled" : "whatsapp_confirmations.disabled",
      entityType: "business",
      entityId: input.businessId,
      payload: { source: "operator" },
    });
    return { enabled: input.enabled, changed: true };
  });
}
