import { Injectable } from '@nestjs/common';
import { createTransport } from 'nodemailer';

// SMTP_URL (Mailpit en dev : smtp://localhost:1025, SMTP OVH/Brevo en prod).
// Absente : transport JSON, rien n'est envoyé (exigée en production par loadEnv).
@Injectable()
export class MailService {
  private readonly transport = createTransport(process.env.SMTP_URL || { jsonTransport: true });

  async send(to: string, subject: string, text: string): Promise<void> {
    await this.transport.sendMail({ from: process.env.MAIL_FROM || 'BudgeTracker <no-reply@localhost>', to, subject, text });
  }
}
