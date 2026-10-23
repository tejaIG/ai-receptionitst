-- A business can also confirm each booked appointment to the customer on
-- WhatsApp, next to the SMS confirmation. Off until an operator turns it on in
-- Integrations. The WhatsApp sender and message template are platform settings
-- (TWILIO_WHATSAPP_FROM, TWILIO_WHATSAPP_CONFIRMATION_CONTENT_SID), so the only
-- per-business state is this switch.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS whatsapp_confirmations_enabled boolean NOT NULL DEFAULT false;
