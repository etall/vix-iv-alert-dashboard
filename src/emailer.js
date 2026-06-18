const net = require("node:net");
const tls = require("node:tls");

function encodeBase64(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

function formatEmail({ from, to, subject, text }) {
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${encodeBase64(subject)}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
  ].join("\r\n");
}

class SmtpClient {
  constructor(config) {
    this.config = config;
  }

  isConfigured() {
    const email = this.config.email;
    return Boolean(email.host && email.port && email.user && email.pass && email.from && email.to);
  }

  connect() {
    const email = this.config.email;
    return new Promise((resolve, reject) => {
      console.log(`[SMTP] Connecting to ${email.host}:${email.port} (SSL: ${email.ssl})`);
      const socket = email.ssl
        ? tls.connect(email.port, email.host, { servername: email.host }, () => {
            console.log('[SMTP] TLS connection established');
            resolve(socket);
          })
        : net.connect(email.port, email.host, () => {
            console.log('[SMTP] TCP connection established');
            resolve(socket);
          });
      socket.once('data', (chunk) => {
        console.log('[SMTP] Server greeting:', chunk.toString('utf8').trim());
      });
      socket.once('error', (err) => {
        console.error('[SMTP] Connection error:', err.message);
        reject(err);
      });
    });
  }

  async send({ subject, text }) {
    if (!this.isConfigured()) {
      const reason = 'SMTP is not configured. Check: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ALERT_FROM, ALERT_TO';
      console.error('[SMTP]', reason);
      return { sent: false, reason };
    }

    console.log('[SMTP] Starting email send process...');
    console.log('[SMTP] Config:', {
      host: this.config.email.host,
      port: this.config.email.port,
      ssl: this.config.email.ssl,
      user: this.config.email.user,
      from: this.config.email.from,
      to: this.config.email.to,
    });

    try {
      const socket = await this.connect();
      const read = () => new Promise((resolve, reject) => {
        socket.once('data', (chunk) => {
          const response = chunk.toString('utf8');
          console.log('[SMTP] Response:', response.trim());
          resolve(response);
        });
        socket.once('error', (err) => {
          console.error('[SMTP] Read error:', err.message);
          reject(err);
        });
      });
      const write = async (line) => {
        console.log('[SMTP] Sending:', line.includes('AUTH LOGIN') || line.length === 24 ? '[CREDENTIALS]' : line);
        socket.write(`${line}\r\n`);
        return read();
      };

      await read();
      let response = await write(`EHLO ${this.config.email.host}`);
      if (!this.config.email.ssl && response.startsWith('250')) {
        console.log('[SMTP] Initiating STARTTLS...');
        response = await write('STARTTLS');
        if (!response.startsWith('220')) {
          throw new Error(`STARTTLS failed: ${response}`);
        }
        console.log('[SMTP] Upgrading to TLS...');
        const secure = tls.connect({ socket, servername: this.config.email.host });
        await new Promise((resolve, reject) => {
          secure.once('secureConnect', () => {
            console.log('[SMTP] TLS upgrade successful');
            resolve();
          });
          secure.once('error', reject);
        });
        return this.sendSecure(secure, subject, text);
      }
      return this.sendSecure(socket, subject, text, true);
    } catch (error) {
      console.error('[SMTP] Send failed:', error.message);
      console.error('[SMTP] Stack:', error.stack);
      return { sent: false, reason: error.message, details: error.stack };
    }
  }

  async sendSecure(socket, subject, text, alreadyGreeted = false) {
    const email = this.config.email;
    const read = () => new Promise((resolve, reject) => {
      socket.once('data', (chunk) => {
        const response = chunk.toString('utf8');
        console.log('[SMTP] Response:', response.trim());
        resolve(response);
      });
      socket.once('error', (err) => {
        console.error('[SMTP] Read error:', err.message);
        reject(err);
      });
    });
    const write = async (line) => {
      const logLine = line.includes('AUTH LOGIN') || line.length === 24 || line === email.pass
        ? '[CREDENTIALS]'
        : line;
      console.log('[SMTP] Sending:', logLine);
      socket.write(`${line}\r\n`);
      return read();
    };

    try {
      if (!alreadyGreeted) {
        console.log('[SMTP] Sending EHLO...');
        await write(`EHLO ${email.host}`);
      }

      console.log('[SMTP] Starting authentication...');
      await write('AUTH LOGIN');
      await write(encodeBase64(email.user));
      const authResponse = await write(encodeBase64(email.pass));

      if (!authResponse.startsWith('235') && !authResponse.includes('Authentication successful')) {
        throw new Error(`Authentication failed: ${authResponse}. Check SMTP_USER and SMTP_PASS (use authorization code, not login password)`);
      }
      console.log('[SMTP] Authentication successful');

      console.log('[SMTP] Sending email content...');
      await write(`MAIL FROM:<${email.from}>`);
      await write(`RCPT TO:<${email.to}>`);
      await write('DATA');
      socket.write(`${formatEmail({ from: email.from, to: email.to, subject, text })}\r\n.\r\n`);
      const response = await read();

      console.log('[SMTP] Email send response:', response.trim());
      await write('QUIT');
      socket.end();

      const sent = response.startsWith('250') || response.includes('OK');
      return {
        sent,
        response: response.trim(),
        details: sent ? 'Email sent successfully' : `Server rejected: ${response}`,
      };
    } catch (error) {
      console.error('[SMTP] sendSecure failed:', error.message);
      socket.end();
      throw error;
    }
  }
}

module.exports = { SmtpClient };
