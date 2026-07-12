
const express = require("express");
const cors = require("cors");
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
    console.log("ERROR LEYENDO JSON:", file, error.message);
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || "").trim().toLowerCase());
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function brevoConfigured() {
  return Boolean(process.env.BREVO_API_KEY && process.env.MAIL_FROM);
}

function printBrevoStatus() {
  console.log("========== BREVO CONFIG CHECK ==========");
  console.log("BASE_URL:", BASE_URL);
  console.log("BREVO_API_KEY existe:", process.env.BREVO_API_KEY ? "SI" : "NO");
  console.log("MAIL_FROM:", process.env.MAIL_FROM || "NO DEFINIDO");
  console.log("MAIL_FROM_NAME:", process.env.MAIL_FROM_NAME || "SportBook Pro");
  console.log("========================================");
}

async function sendBrevoEmail({ to, subject, html, text }) {
  if (!brevoConfigured()) {
    printBrevoStatus();
    throw new Error("Brevo no está configurado. Falta BREVO_API_KEY o MAIL_FROM en Render.");
  }

  const payload = {
    sender: {
      name: process.env.MAIL_FROM_NAME || "SportBook Pro",
      email: process.env.MAIL_FROM
    },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    textContent: text
  };

  console.log("Enviando correo con Brevo API a:", to);

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "api-key": process.env.BREVO_API_KEY
    },
    body: JSON.stringify(payload)
  });

  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (e) {
    data = { raw };
  }

  if (!response.ok) {
    console.error("ERROR BREVO API ❌");
    console.error("status:", response.status);
    console.error("respuesta:", data);
    throw new Error(data.message || data.code || `Brevo API error ${response.status}`);
  }

  console.log("CORREO ENVIADO CON BREVO ✅", data);
  return data;
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "SportBook Pro",
    time: new Date().toISOString(),
    baseUrl: BASE_URL
  });
});

app.get("/api/brevo-check", async (req, res) => {
  printBrevoStatus();

  if (!brevoConfigured()) {
    return res.status(500).json({
      ok: false,
      message: "Brevo no está configurado. Falta BREVO_API_KEY o MAIL_FROM en Render."
    });
  }

  return res.json({
    ok: true,
    message: "Brevo configurado. API Key y remitente detectados.",
    mailFrom: process.env.MAIL_FROM,
    mailFromName: process.env.MAIL_FROM_NAME || "SportBook Pro"
  });
});

app.post("/api/register", (req, res) => {
  const { nombre, email, password } = req.body || {};
  const cleanEmail = String(email || "").trim().toLowerCase();

  console.log("REGISTRO SOLICITADO:", cleanEmail);

  if (!nombre || !isValidEmail(cleanEmail) || !password || String(password).length < 6) {
    return res.status(400).json({ ok: false, message: "Datos de registro inválidos." });
  }

  const users = readJson(usersFile, []);
  const exists = users.some(u => u.email === cleanEmail);

  if (exists) {
    console.log("USUARIO YA EXISTE:", cleanEmail);
    return res.json({ ok: true, message: "El usuario ya existe en el servidor." });
  }

  users.push({
    nombre: String(nombre).trim(),
    email: cleanEmail,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString()
  });

  writeJson(usersFile, users);

  console.log("USUARIO REGISTRADO OK:", cleanEmail);
  return res.json({ ok: true, message: "Usuario registrado correctamente." });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  const cleanEmail = String(email || "").trim().toLowerCase();

  console.log("LOGIN SOLICITADO:", cleanEmail);

  if (cleanEmail === "cliente@sportbook.com" && password === "123456") {
    return res.json({ ok: true, nombre: "Cliente demo", email: cleanEmail });
  }

  const users = readJson(usersFile, []);
  const user = users.find(u => u.email === cleanEmail && u.passwordHash === hashPassword(password));

  if (!user) {
    console.log("LOGIN FALLIDO:", cleanEmail);
    return res.status(401).json({ ok: false, message: "Correo o contraseña incorrectos." });
  }

  console.log("LOGIN OK:", cleanEmail);
  return res.json({ ok: true, nombre: user.nombre, email: user.email });
});

app.post("/api/forgot-password", async (req, res) => {
  const { email } = req.body || {};
  const cleanEmail = String(email || "").trim().toLowerCase();

  console.log("========== RECUPERACIÓN SOLICITADA ==========");
  console.log("Correo solicitado:", cleanEmail);

  if (!isValidEmail(cleanEmail)) {
    console.log("CORREO INVALIDO:", cleanEmail);
    return res.status(400).json({ ok: false, message: "Correo inválido." });
  }

  const users = readJson(usersFile, []);
  const isDemo = cleanEmail === "cliente@sportbook.com";
  const user = users.find(u => u.email === cleanEmail);

  if (!user && !isDemo) {
    console.log("USUARIO NO REGISTRADO:", cleanEmail);
    return res.status(404).json({
      ok: false,
      message: "No existe una cuenta registrada con ese correo."
    });
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

  console.log("Token generado para:", cleanEmail);
  console.log("Reset link:", resetLink);
  printBrevoStatus();

  try {
    const html = `
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
          <p style="color:#94a3b8;font-size:12px;">También puedes copiar este enlace:</p>
          <p style="word-break:break-all;color:#94a3b8;font-size:12px;">${resetLink}</p>
        </div>
      </div>
    `;

    const text = `Recupera tu contraseña en SportBook Pro: ${resetLink}`;

    const info = await sendBrevoEmail({
      to: cleanEmail,
      subject: "Recuperación de contraseña - SportBook Pro",
      html,
      text
    });

    return res.json({
      ok: true,
      message: "Enlace enviado al correo del usuario.",
      brevo: info
    });
  } catch (error) {
    console.error("ERROR ENVIANDO CON BREVO ❌");
    console.error("message:", error.message);
    console.error("stack:", error.stack);

    return res.status(500).json({
      ok: false,
      message: "No se pudo enviar el correo con Brevo.",
      error: error.message
    });
  }
});

app.post("/api/reset-password", (req, res) => {
  const { token, email, password } = req.body || {};
  const cleanEmail = String(email || "").trim().toLowerCase();

  console.log("RESET PASSWORD SOLICITADO:", cleanEmail);

  if (!token || !isValidEmail(cleanEmail) || !password || String(password).length < 6) {
    return res.status(400).json({ ok: false, message: "Datos inválidos." });
  }

  let tokens = readJson(tokensFile, []);
  const tokenData = tokens.find(t => t.token === token && t.email === cleanEmail);

  if (!tokenData) {
    console.log("TOKEN INVALIDO:", cleanEmail);
    return res.status(400).json({ ok: false, message: "Token inválido." });
  }

  if (Date.now() > tokenData.expiresAt) {
    tokens = tokens.filter(t => t.token !== token);
    writeJson(tokensFile, tokens);
    console.log("TOKEN EXPIRADO:", cleanEmail);
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
    console.log("USUARIO NO ENCONTRADO AL RESET:", cleanEmail);
    return res.status(404).json({ ok: false, message: "Usuario no encontrado." });
  }

  writeJson(usersFile, users);

  tokens = tokens.filter(t => t.token !== token);
  writeJson(tokensFile, tokens);

  console.log("PASSWORD ACTUALIZADO OK:", cleanEmail);
  return res.json({ ok: true, message: "Contraseña actualizada correctamente." });
});

app.listen(PORT, () => {
  console.log("////////////////////////////////////////////////////////");
  console.log(`SportBook Pro ejecutándose en ${BASE_URL}`);
  console.log(`Puerto detectado: ${PORT}`);
  console.log("Abre el navegador en:", BASE_URL);
  printBrevoStatus();
  console.log("////////////////////////////////////////////////////////");
});
