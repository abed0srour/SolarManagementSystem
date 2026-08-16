/**
 * Click-to-chat links for the "Share via WhatsApp" buttons.
 *
 * These point straight at web.whatsapp.com rather than at wa.me. wa.me is the
 * generic entry point: it shows a "Continue to Chat" interstitial and then hands
 * off to the desktop app when one is installed, which is an extra click and the
 * wrong client. `web.whatsapp.com/send` opens the browser client on the chat
 * itself.
 *
 * The link can only carry text — no click-to-chat URL can attach a file — so it
 * opens the conversation with the message typed and the invoice PDF is attached
 * by hand before sending.
 */

/**
 * Reduce a hand-typed phone number to the digits WhatsApp accepts.
 *
 * Numbers are entered free-form ("+961 76 675 348"), and the `phone` parameter
 * wants full international digits with no punctuation. Anything it cannot
 * resolve lands on "Phone number shared via url is invalid" instead of the
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
 * Open WhatsApp Web on the client's chat with `text` prefilled, ready to send.
 *
 * Returns false when the stored number was unusable. That case cannot open a
 * chat — there is nobody to open it with — so it falls back to wa.me's contact
 * picker, which keeps the typed message and lets the sender choose the
 * recipient. The caller pairs the false with a toast explaining why.
 */
export function openWhatsApp(phone: string | null | undefined, text: string): boolean {
  const number = waNumber(phone);
  const message = encodeURIComponent(text);
  window.open(
    number ? `https://web.whatsapp.com/send?phone=${number}&text=${message}` : `https://wa.me/?text=${message}`,
    '_blank',
    'noopener,noreferrer',
  );
  return number !== null;
}
