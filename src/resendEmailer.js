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
        apiKey: this.config.email.apiKey ? '***' + this.config.email.apiKey.slice(-4) : 'MISSING',
      });

      const data = await this.resend.emails.send({
        from: this.config.email.from,
        to: [this.config.email.to],
        subject: subject,
        text: text,
      });

      console.log('[Resend] API Response:', JSON.stringify(data, null, 2));
      
      // Resend v4 returns data in different structure
      const emailId = data.id || data.data?.id || data.response?.id;
      const success = data.id || data.data?.id || (data.response && !data.response.error);

      if (success) {
        console.log('[Resend] Email sent successfully:', emailId);
        return {
          sent: true,
          id: emailId,
          details: 'Email sent successfully via Resend',
        };
      } else {
        console.error('[Resend] API returned error:', data);
        return {
          sent: false,
          reason: data.message || 'Resend API returned error',
          details: JSON.stringify(data),
        };
      }
    } catch (error) {
      console.error('[Resend] Send failed:', error.message);
      console.error('[Resend] Error details:', error);
      return {
        sent: false,
        reason: error.message,
        details: error.stack,
      };
    }
  }
}

module.exports = { ResendClient };
