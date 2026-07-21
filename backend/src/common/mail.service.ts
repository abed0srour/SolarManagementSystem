import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

/**
 * Thin SMTP wrapper. When SMTP_HOST is not configured, sending is a no-op and
 * callers fall back to returning the code in the API response (dev mode) —
 * same pattern as the forgot-password flow.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter?: nodemailer.Transporter;

  constructor() {
    const host = process.env.SMTP_HOST;
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      });
    }
  }

  get enabled(): boolean {
    return !!this.transporter;
  }

  /** Returns true when the mail was actually handed to an SMTP server. */
  async send(to: string, subject: string, text: string): Promise<boolean> {
    if (!this.transporter) {
      this.logger.warn(`SMTP not configured — mail to ${to} ("${subject}") not sent`);
      return false;
    }
    try {
      await this.transporter.sendMail({
        from: process.env.MAIL_FROM ?? process.env.SMTP_USER,
        to,
        subject,
        text,
      });
    } catch (e: any) {
      this.logger.error(`Failed to send mail to ${to}: ${e?.message}`);
      throw new ServiceUnavailableException(
        'Could not send the email — check the SMTP settings in backend/.env (for Gmail, SMTP_PASS must be an app password)',
      );
    }
    return true;
  }
}
