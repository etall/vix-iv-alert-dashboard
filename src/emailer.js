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
      const socket = email.ssl
        ? tls.connect(email.port, email.host, { servername: email.host }, () => resolve(socket))
        : net.connect(email.port, email.host, () => resolve(socket));
      socket.once("error", reject);
    });
  }

  async send({ subject, text }) {
    if (!this.isConfigured()) {
      return { sent: false, reason: "SMTP is not configured." };
    }

    const socket = await this.connect();
    const read = () => new Promise((resolve, reject) => {
      socket.once("data", (chunk) => resolve(chunk.toString("utf8")));
      socket.once("error", reject);
    });
    const write = async (line) => {
      socket.write(`${line}\r\n`);
      return read();
    };

    await read();
    let response = await write(`EHLO ${this.config.email.host}`);
    if (!this.config.email.ssl && response.startsWith("250")) {
      response = await write("STARTTLS");
      if (!response.startsWith("220")) throw new Error(`STARTTLS failed: ${response}`);
      const secure = tls.connect({ socket, servername: this.config.email.host });
      await new Promise((resolve) => secure.once("secureConnect", resolve));
      return this.sendSecure(secure, subject, text);
    }
    return this.sendSecure(socket, subject, text, true);
  }

  async sendSecure(socket, subject, text, alreadyGreeted = false) {
    const email = this.config.email;
    const read = () => new Promise((resolve, reject) => {
      socket.once("data", (chunk) => resolve(chunk.toString("utf8")));
      socket.once("error", reject);
    });
    const write = async (line) => {
      socket.write(`${line}\r\n`);
      return read();
    };

    if (!alreadyGreeted) await write(`EHLO ${email.host}`);
    await write("AUTH LOGIN");
    await write(encodeBase64(email.user));
    await write(encodeBase64(email.pass));
    await write(`MAIL FROM:<${email.from}>`);
    await write(`RCPT TO:<${email.to}>`);
    await write("DATA");
    socket.write(`${formatEmail({ from: email.from, to: email.to, subject, text })}\r\n.\r\n`);
    const response = await read();
    await write("QUIT");
    socket.end();
    return { sent: response.startsWith("250"), response };
  }
}

module.exports = { SmtpClient };
