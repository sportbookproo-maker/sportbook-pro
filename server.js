
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const dataDir = path.join(__dirname, "data");
const usersFile = path.join(dataDir, "users.json");
const tokensFile = path.join(dataDir, "resetTokens.json");

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, "[]", "utf8");
if (!fs.existsSync(tokensFile)) fs.writeFileSync(tokensFile, "[]", "utf8");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || "").trim().toLowerCase());
}

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "false") === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/api/register", (req, res) => {
  const { nombre, email, password } = req.body || {};
  const cleanEmail = String(email || "").trim().toLowerCase();

  if (!nombre || !isValidEmail(cleanEmail) || !password || String(password).length < 6) {
    return res.status(400).json({ ok: false, message: "Datos de registro inválidos." });
  }

  const users = readJson(usersFile, []);
  const exists = users.some(u => u.email === cleanEmail);

  if (exists) {
    return res.json({ ok: true, message: "El usuario ya existe en el servidor." });
  }

  users.push({
    nombre: String(nombre).trim(),
    email: cleanEmail,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString()
  });

  writeJson(usersFile, users);

  return res.json({ ok: true, message: "Usuario registrado en servidor." });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  const cleanEmail = String(email || "").trim().toLowerCase();

  if (cleanEmail === "cliente@sportbook.com" && password === "123456") {
    return res.json({ ok: true, nombre: "Cliente demo", email: cleanEmail });
  }

  const users = readJson(usersFile, []);
  const user = users.find(u => u.email === cleanEmail && u.passwordHash === hashPassword(password));

  if (!user) {
    return res.status(401).json({ ok: false, message: "Correo o contraseña incorrectos." });
  }

  return res.json({ ok: true, nombre: user.nombre, email: user.email });
});

app.post("/api/forgot-password", async (req, res) => {
  const { email } = req.body || {};
  const cleanEmail = String(email || "").trim().toLowerCase();

  if (!isValidEmail(cleanEmail)) {
    return res.status(400).json({ ok: false, message: "Correo inválido." });
  }

  const users = readJson(usersFile, []);
  const isDemo = cleanEmail === "cliente@sportbook.com";
  const user = users.find(u => u.email === cleanEmail);

  if (!user && !isDemo) {
    return res.status(404).json({ ok: false, message: "No existe una cuenta con ese correo." });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 15 * 60 * 1000;
  const resetLink = `${BASE_URL}/#recuperar=${encodeURIComponent(token)}&email=${encodeURIComponent(cleanEmail)}`;

  let tokens = readJson(tokensFile, []);
  tokens = tokens.filter(t => t.email !== cleanEmail && Date.now() < t.expiresAt);

  tokens.push({
    email: cleanEmail,
    token,
    expiresAt,
    createdAt: new Date().toISOString()
  });

  writeJson(tokensFile, tokens);

  const transporter = createTransporter();

  if (!transporter) {
    return res.json({
      ok: true,
      simulated: true,
      message: "Enlace generado. Configura SMTP en .env para enviar correos reales.",
      resetLink
    });
  }

  try {
    await transporter.sendMail({
      from: `"SportBook Pro" <${process.env.MAIL_FROM || process.env.SMTP_USER}>`,
      to: cleanEmail,
      subject: "Recuperación de contraseña - SportBook Pro",
      html: `
        <div style="font-family:Arial,sans-serif;background:#05070b;padding:30px;color:#f8fafc;">
          <div style="max-width:620px;margin:auto;background:#0b1220;border:1px solid #ffd166;border-radius:18px;padding:26px;">
            <h2 style="color:#ffd166;margin-top:0;">SportBook Pro</h2>
            <p>Hola, solicitaste recuperar tu contraseña.</p>
            <p>Haz clic en el siguiente botón para crear una nueva contraseña:</p>
            <p style="margin:28px 0;">
              <a href="${resetLink}" style="background:#ffd166;color:#111827;text-decoration:none;padding:14px 22px;border-radius:12px;font-weight:bold;">
                Recuperar contraseña
              </a>
            </p>
            <p style="color:#cbd5e1;">Este enlace es válido por 15 minutos.</p>
            <p style="color:#cbd5e1;">Si no solicitaste este cambio, ignora este mensaje.</p>
          </div>
        </div>
      `,
      text: `Recupera tu contraseña en SportBook Pro: ${resetLink}`
    });

    return res.json({ ok: true, message: "Enlace enviado al correo del usuario." });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "No se pudo enviar el correo. Revisa tus datos SMTP.",
      error: error.message,
      resetLink
    });
  }
});

app.post("/api/reset-password", (req, res) => {
  const { token, email, password } = req.body || {};
  const cleanEmail = String(email || "").trim().toLowerCase();

  if (!token || !isValidEmail(cleanEmail) || !password || String(password).length < 6) {
    return res.status(400).json({ ok: false, message: "Datos inválidos." });
  }

  let tokens = readJson(tokensFile, []);
  const tokenData = tokens.find(t => t.token === token && t.email === cleanEmail);

  if (!tokenData) {
    return res.status(400).json({ ok: false, message: "Token inválido." });
  }

  if (Date.now() > tokenData.expiresAt) {
    tokens = tokens.filter(t => t.token !== token);
    writeJson(tokensFile, tokens);
    return res.status(400).json({ ok: false, message: "El enlace expiró." });
  }

  let users = readJson(usersFile, []);
  const idx = users.findIndex(u => u.email === cleanEmail);

  if (idx >= 0) {
    users[idx].passwordHash = hashPassword(password);
    users[idx].updatedAt = new Date().toISOString();
  } else if (cleanEmail === "cliente@sportbook.com") {
    users.push({
      nombre: "Cliente demo",
      email: cleanEmail,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  } else {
    return res.status(404).json({ ok: false, message: "Usuario no encontrado." });
  }

  writeJson(usersFile, users);

  tokens = tokens.filter(t => t.token !== token);
  writeJson(tokensFile, tokens);

  return res.json({ ok: true, message: "Contraseña actualizada correctamente." });
});

app.listen(PORT, () => {
  console.log(`SportBook Pro ejecutándose en ${BASE_URL}`);
  console.log("Abre el navegador en:", BASE_URL);
});
