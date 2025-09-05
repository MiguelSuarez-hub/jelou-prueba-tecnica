//routes config
import { Router } from "express";
import { z } from "zod";
import { pool } from "./db.js";
import { authenticate, serviceAuth } from "./auth.js";

const router = Router();

// Zod schema para crear cliente
const customerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.email("Invalid email"),
  phone: z.string().min(5, "Phone is required"),
});

// POST /customers
router.post("/customers", async (req, res) => {
  try {
    const parsed = customerSchema.parse(req.body);

    const [result] = await pool.execute(
      "INSERT INTO customers (name, email, phone) VALUES (?, ?, ?)",
      [parsed.name, parsed.email, parsed.phone]
    );

    return res.status(201).json({
      id: result.insertId,
      ...parsed,
    });
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ error: err.errors });
    }
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Email already exists" });
    }
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/customers", async (req, res) => {
  try {
    // Validamos query params
    const schema = z.object({
      search: z.string().optional(),
      limit: z.string().regex(/^\d+$/).transform(Number).default("10"),
    });

    const parsed = schema.parse(req.query);

    const { search, limit } = parsed;

    let query = "SELECT id, name, email, phone FROM customers";
    let params = [];

    if (search) {
      query += " WHERE name LIKE ? OR email LIKE ?";
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ` LIMIT ${limit}`;

    const [rows] = await pool.execute(query, params);

    res.json(rows);
  } catch (err) {
    console.error("Error fetching customers:", err);
    res.status(500).json({ error: "Failed to fetch customers" });
  }
});

// GET /customers/:id
router.get("/customers/:id", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT id, name, email, phone, created_at FROM customers WHERE id = ?",
      [req.params.id]
    );

    if (rows.length === 0)
      return res.status(404).json({ error: "Customer not found" });

    return res.json(rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// GET /internal/customers/:id (requiere SERVICE_TOKEN)
router.get("/internal/customers/:id", serviceAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT id, name, email, phone, created_at FROM customers WHERE id = ?",
      [req.params.id]
    );

    if (rows.length === 0)
      return res.status(404).json({ error: "Customer not found" });

    return res.json(rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
