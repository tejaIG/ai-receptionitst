import { randomInt, randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { afterAll, describe, expect, it } from "vitest";
import { auditLogs, businessHours, businessMemberships, businesses, createDatabaseClient, notifications, outboxMessages, receptionistProfiles, services, staff, users, type Database, type DatabaseTransaction } from "@lobbystack/db";

import { bookAppointment, cancelAppointment } from "./booking";
import type { SmsConsentAnswer } from "./contactSmsConsent";
import { resolveNotificationDelivery, WHATSAPP_BOOKING_CONFIRMATION } from "./notifications";
import { getWhatsAppConfirmationSetting, setWhatsAppConfirmations } from "./whatsapp";

// Explicit opt-in only; never fall back to DATABASE_URL or load an env file.
const testUrl = process.env.LOBBYSTACK_RELIABILITY_TEST_DATABASE_URL;
if (testUrl) {
  const url = new URL(testUrl);
  if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) || !/test/i.test(url.pathname)) {
    throw new Error("WhatsApp confirmation integration tests require a dedicated local test database.");
  }
}
const client = testUrl ? createDatabaseClient("lobbystack_migrator", { DATABASE_URL: testUrl }) : undefined;
afterAll(async () => { await client?.pool.end(); });

async function rollbackTest(run: (tx: DatabaseTransaction) => Promise<void>) {
  const rollback = new Error("rollback test fixture");
  try {
    await client!.db.transaction(async (tx) => {
      await run(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

/** A North American number no other fixture uses. */
const phone = () => `+1647${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;

// The worker's resolvers trust its login identity, so worker steps switch the
// session user. Operator steps run as the app role. Fixtures run as the owner.
async function asWorker(tx: DatabaseTransaction) { await tx.execute(sql`reset role`); await tx.execute(sql`reset session authorization`); await tx.execute(sql`set local session authorization lobbystack_worker`); }
async function asApp(tx: DatabaseTransaction) { await tx.execute(sql`reset session authorization`); await tx.execute(sql`set local role lobbystack_app`); }
async function asOwner(tx: DatabaseTransaction) { await tx.execute(sql`reset role`); await tx.execute(sql`reset session authorization`); }

/** A business open all day with an owner, a scheduler and a viewer, and one service to book. */
async function seed(tx: DatabaseTransaction, options: { whatsapp: boolean }) {
  await asOwner(tx);
  const businessId = randomUUID();
  const [ownerId, schedulerId, viewerId] = [randomUUID(), randomUUID(), randomUUID()];
  await tx.insert(businesses).values({ id: businessId, slug: businessId, name: "Javor", timezone: "UTC", businessType: "test", telemetryEnabled: false, deploymentMode: "self_hosted_standard", whatsappConfirmationsEnabled: options.whatsapp });
  for (const [id, role] of [[ownerId, "business_owner"], [schedulerId, "scheduler"], [viewerId, "viewer"]] as const) {
    await tx.insert(users).values({ id, email: `${id}@example.invalid`, normalizedEmail: `${id}@example.invalid` });
    await tx.insert(businessMemberships).values({ businessId, userId: id, role });
  }
  await tx.insert(receptionistProfiles).values({ businessId, greeting: "Hi", tone: "warm", summary: "Test", bookingPolicy: "Book", transferMode: "never", bookingMode: "instant" });
  await tx.insert(staff).values({ businessId, name: "Sam", timezone: "UTC" });
  const [service] = await tx.insert(services).values({ businessId, name: "Cut", slug: "cut", durationMinutes: 30 }).returning();
  await tx.insert(businessHours).values(Array.from({ length: 7 }, (_, dayOfWeek) => ({ businessId, dayOfWeek, openMinutes: 0, closeMinutes: 1439 })));
  const db = tx as unknown as Database;
  let slots = 0;
  const nextStart = () => DateTime.utc().plus({ days: 3 + slots++ }).set({ hour: 12, minute: 0, second: 0, millisecond: 0 }).toISO()!;
  const book = async (contactPhone: string, smsConsent?: SmsConsentAnswer) => {
    await asWorker(tx);
    return (await bookAppointment({ db }, { businessId, serviceId: service!.id, startsAt: nextStart(), timezone: "UTC", contactPhone, sourceChannel: "voice", ...(smsConsent ? { smsConsent } : {}) })).appointmentId;
  };
  const rowsFor = async (appointmentId: string) => {
    await asOwner(tx);
    return await tx.select({ id: notifications.id, channel: notifications.channel, kind: notifications.kind, status: notifications.status }).from(notifications).where(eq(notifications.relatedId, appointmentId));
  };
  /** Resolves the appointment's WhatsApp confirmation, as the worker does when it's due. */
  const deliverWhatsApp = async (appointmentId: string) => {
    await asOwner(tx);
    const [row] = await tx.update(notifications).set({ scheduledFor: new Date(Date.now() - 1000) }).where(and(eq(notifications.relatedId, appointmentId), eq(notifications.kind, WHATSAPP_BOOKING_CONFIRMATION))).returning({ id: notifications.id });
    await asWorker(tx);
    return await resolveNotificationDelivery({ db }, { businessId, notificationId: row!.id });
  };
  return { db, businessId, ownerId, schedulerId, viewerId, book, rowsFor, deliverWhatsApp };
}

describe.skipIf(!client)("WhatsApp booking confirmation", () => {
  it("queues nothing extra while the business has WhatsApp off", async () => {
    await rollbackTest(async (tx) => {
      const fixture = await seed(tx, { whatsapp: false });
      const appointmentId = await fixture.book(phone(), "agreed");
      const rows = await fixture.rowsFor(appointmentId);
      expect(rows.map((row) => row.kind).sort()).toEqual(["appointment_reminder", "booking_confirmation"]);
      expect(rows.every((row) => row.channel === "sms")).toBe(true);
    });
  });

  it("queues a WhatsApp confirmation next to the SMS one, with its own dispatch job", async () => {
    await rollbackTest(async (tx) => {
      const fixture = await seed(tx, { whatsapp: true });
      const appointmentId = await fixture.book(phone(), "agreed");
      const rows = await fixture.rowsFor(appointmentId);
      expect(rows.find((row) => row.kind === "booking_confirmation")).toMatchObject({ channel: "sms", status: "pending" });
      const whatsapp = rows.find((row) => row.kind === WHATSAPP_BOOKING_CONFIRMATION);
      expect(whatsapp).toMatchObject({ channel: "whatsapp", status: "pending" });
      const jobs = await tx.select({ payload: outboxMessages.payload }).from(outboxMessages).where(and(eq(outboxMessages.topic, "notification.dispatch"), eq(outboxMessages.aggregateId, appointmentId)));
      expect(jobs.map((job) => job.payload.notificationId)).toContain(whatsapp!.id);
    });
  });

  it("resolves to the customer's number and the template values, with no SMS sender", async () => {
    await rollbackTest(async (tx) => {
      const fixture = await seed(tx, { whatsapp: true });
      const customer = phone();
      const appointmentId = await fixture.book(customer, "agreed");
      const resolution = await fixture.deliverWhatsApp(appointmentId);
      expect(resolution).toMatchObject({ kind: "ready", delivery: { channel: "whatsapp", to: customer, kind: WHATSAPP_BOOKING_CONFIRMATION, relatedId: appointmentId } });
      if (resolution?.kind !== "ready") throw new Error("expected a ready delivery");
      expect(resolution.delivery.from).toBeUndefined();
      expect(resolution.delivery.body).toContain("Javor: your Cut appointment is confirmed for");
      expect(resolution.delivery.body).not.toMatch(/STOP|HELP/);
      expect(resolution.delivery.contentVariables).toMatchObject({ "1": "Javor", "2": "Cut" });
    });
  });

  it("skips a customer who never agreed to texts", async () => {
    await rollbackTest(async (tx) => {
      const fixture = await seed(tx, { whatsapp: true });
      const appointmentId = await fixture.book(phone());
      expect(await fixture.deliverWhatsApp(appointmentId)).toMatchObject({ kind: "skipped" });
    });
  });

  it("skips a confirmation queued before the business turned WhatsApp off", async () => {
    await rollbackTest(async (tx) => {
      const fixture = await seed(tx, { whatsapp: true });
      const appointmentId = await fixture.book(phone(), "agreed");
      await asApp(tx);
      await setWhatsAppConfirmations({ db: fixture.db }, { userId: fixture.ownerId, businessId: fixture.businessId, enabled: false });
      expect(await fixture.deliverWhatsApp(appointmentId)).toMatchObject({ kind: "skipped" });
    });
  });

  it("skips the WhatsApp confirmation of an appointment that was cancelled", async () => {
    await rollbackTest(async (tx) => {
      const fixture = await seed(tx, { whatsapp: true });
      const appointmentId = await fixture.book(phone(), "agreed");
      await asApp(tx);
      await cancelAppointment({ db: fixture.db }, { userId: fixture.ownerId, businessId: fixture.businessId, appointmentId });
      expect(await fixture.deliverWhatsApp(appointmentId)).toMatchObject({ kind: "skipped" });
    });
  });

  it("lets an administrator switch it on and off, and records who did", async () => {
    await rollbackTest(async (tx) => {
      const fixture = await seed(tx, { whatsapp: false });
      await asApp(tx);
      expect(await getWhatsAppConfirmationSetting({ db: fixture.db }, { userId: fixture.viewerId, businessId: fixture.businessId })).toEqual({ enabled: false });
      expect(await setWhatsAppConfirmations({ db: fixture.db }, { userId: fixture.ownerId, businessId: fixture.businessId, enabled: true })).toEqual({ enabled: true, changed: true });
      expect(await setWhatsAppConfirmations({ db: fixture.db }, { userId: fixture.ownerId, businessId: fixture.businessId, enabled: true })).toEqual({ enabled: true, changed: false });
      expect(await getWhatsAppConfirmationSetting({ db: fixture.db }, { userId: fixture.viewerId, businessId: fixture.businessId })).toEqual({ enabled: true });
      await asOwner(tx);
      const audit = await tx.select({ eventType: auditLogs.eventType, actorUserId: auditLogs.actorUserId }).from(auditLogs).where(and(eq(auditLogs.businessId, fixture.businessId), sql`${auditLogs.eventType} like 'whatsapp_confirmations.%'`));
      expect(audit).toEqual([{ eventType: "whatsapp_confirmations.enabled", actorUserId: fixture.ownerId }]);
    });
  });

  it("keeps schedulers and viewers from changing it", async () => {
    await rollbackTest(async (tx) => {
      const fixture = await seed(tx, { whatsapp: false });
      await asApp(tx);
      for (const userId of [fixture.schedulerId, fixture.viewerId]) {
        await expect(setWhatsAppConfirmations({ db: fixture.db }, { userId, businessId: fixture.businessId, enabled: true })).rejects.toThrow();
      }
      await asOwner(tx);
      const [row] = await tx.select({ enabled: businesses.whatsappConfirmationsEnabled }).from(businesses).where(eq(businesses.id, fixture.businessId));
      expect(row?.enabled).toBe(false);
    });
  });

  it("keeps one business's setting from reaching another's", async () => {
    await rollbackTest(async (tx) => {
      const first = await seed(tx, { whatsapp: false });
      const second = await seed(tx, { whatsapp: false });
      await asApp(tx);
      await setWhatsAppConfirmations({ db: first.db }, { userId: first.ownerId, businessId: first.businessId, enabled: true });
      // The first business's owner is no member of the second.
      await expect(setWhatsAppConfirmations({ db: first.db }, { userId: first.ownerId, businessId: second.businessId, enabled: true })).rejects.toThrow();
      expect(await getWhatsAppConfirmationSetting({ db: second.db }, { userId: second.ownerId, businessId: second.businessId })).toEqual({ enabled: false });
    });
  });
});
