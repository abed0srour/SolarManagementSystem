/**
 * Click-to-chat links for the "Share via WhatsApp" buttons.
 *
 * wa.me is WhatsApp's own click-to-chat endpoint, and it is what the buttons
 * point at rather than web.whatsapp.com: it hands the chat to the desktop app
 * when one is installed and falls back to WhatsApp Web otherwise, so one link
 * works for whichever the staff member happens to use.
 *
 * The link can only carry text — the click-to-chat API has no way to attach a
 * file — so the message opens the conversation and the invoice PDF is attached
 * by hand before sending.
 */

/**
 * Reduce a hand-typed phone number to the digits wa.me accepts.
 *
 * Numbers are entered free-form ("+961 76 675 348"), and wa.me wants full
 * international digits with no punctuation. Anything it cannot resolve makes
 * WhatsApp open on "Phone number shared via url is invalid" instead of the
 * chat, so an unusable number returns null and the caller opens the contact
 * picker rather than a broken chat.
 */
export function waNumber(phone?: string | null): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  // "00" is the dial-out prefix — the country code is what follows it.
  const intl = digits.startsWith('00') ? digits.slice(2) : digits;
  /*
   * A leading zero that survives is a national trunk prefix ("03 123 456"),
   * which means no country code was ever typed. There is nothing in the record
   * to infer one from, so this is not a number wa.me can dial.
   */
  if (!intl || intl.startsWith('0') || intl.length < 8) return null;
  return intl;
}

/**
 * Open the client's chat with `text` prefilled, ready to send.
 *
 * Returns false when the stored number was unusable and WhatsApp opened on its
 * contact picker instead, so the caller can say why.
 */
export function openWhatsApp(phone: string | null | undefined, text: string): boolean {
  const number = waNumber(phone);
  window.open(
    `https://wa.me/${number ?? ''}?text=${encodeURIComponent(text)}`,
    '_blank',
    'noopener,noreferrer',
  );
  return number !== null;
}
