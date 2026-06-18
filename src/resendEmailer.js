const { Resend } = require("resend");

class ResendClient {
  constructor(config) {
    this.config = config;
    this.resend = config.email.apiKey ? new Resend(config.email.apiKey) : null;
  }

  isConfigured() {
    return Boolean(this.resend && this.config.email.from && this.config.email.to);
  }

  async send({ subject, text }) {
    if (!this.isConfigured()) {
      const reason = 'Resend is not configured. Check: RESEND_API_KEY, ALERT_FROM, ALERT_TO';
      console.error('[Resend]', reason);
      return { sent: false, reason };
    }

    try {
      console.log('[Resend] Sending email...');
      console.log('[Resend] Config:', {
        from: this.config.email.from,
        to: this.config.email.to,
      });

      const data = await this.resend.emails.send({
        from: this.config.email.from,
        to: [this.config.email.to],
        subject: subject,
        text: text,
      });

      console.log('[Resend] Email sent successfully:', data.id);
      return {
        sent: true,
        id: data.id,
        details: 'Email sent successfully via Resend',
      };
    } catch (error) {
      console.error('[Resend] Send failed:', error.message);
      return {
        sent: false,
        reason: error.message,
        details: error.stack,
      };
    }
  }
}

module.exports = { ResendClient };
