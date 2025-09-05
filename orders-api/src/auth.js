// auth config
import jwt from "jsonwebtoken";

export function authenticate(req, res, next) {
  const header = req.headers["authorization"];
  if (!header) return res.status(401).json({ error: "Missing Authorization header" });

  const token = header.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Invalid Authorization header" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: "Invalid or expired token" });
  }
}

// Para endpoints internos (ej: confirmación de pedidos con Customers API)
export function authenticateService(req, res, next) {
  const header = req.headers["authorization"];
  if (!header) return res.status(401).json({ error: "Missing Authorization header" });

  const token = header.split(" ")[1];
  if (token !== process.env.SERVICE_TOKEN) {
    return res.status(403).json({ error: "Forbidden" });
  }

  next();
}
