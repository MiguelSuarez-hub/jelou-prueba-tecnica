import { Router } from "express";
import pool from "../db.js";

const router = Router();

/**
 * POST /products
 * Crear un nuevo producto
 */
router.post("/", async (req, res) => {
  try {
    const { sku, name, price_cents, stock } = req.body;
    if (!sku || !name || !price_cents || stock == null) {
      return res.status(400).json({ error: "sku, name, price_cents, stock son requeridos" });
    }

    const [result] = await pool.query(
      "INSERT INTO products (sku, name, price_cents, stock) VALUES (?, ?, ?, ?)",
      [sku, name, price_cents, stock]
    );

    const [rows] = await pool.query("SELECT * FROM products WHERE id = ?", [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Error en POST /products:", err);
    res.status(500).json({ error: "Error al crear producto" });
  }
});

/**
 * PATCH /products/:id
 * Actualizar precio o stock
 */
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { price_cents, stock } = req.body;

    if (price_cents == null && stock == null) {
      return res.status(400).json({ error: "Debes enviar price_cents o stock" });
    }

    let updates = [];
    let values = [];

    if (price_cents != null) {
      updates.push("price_cents = ?");
      values.push(price_cents);
    }
    if (stock != null) {
      updates.push("stock = ?");
      values.push(stock);
    }

    values.push(id);

    await pool.query(`UPDATE products SET ${updates.join(", ")} WHERE id = ?`, values);

    const [rows] = await pool.query("SELECT * FROM products WHERE id = ?", [id]);
    if (rows.length === 0) return res.status(404).json({ error: "Producto no encontrado" });

    res.json(rows[0]);
  } catch (err) {
    console.error("Error en PATCH /products/:id:", err);
    res.status(500).json({ error: "Error al actualizar producto" });
  }
});

/**
 * GET /products/:id
 * Obtener un producto por ID
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query("SELECT * FROM products WHERE id = ?", [id]);
    if (rows.length === 0) return res.status(404).json({ error: "Producto no encontrado" });
    res.json(rows[0]);
  } catch (err) {
    console.error("Error en GET /products/:id:", err);
    res.status(500).json({ error: "Error al obtener producto" });
  }
});

/**
 * GET /products?search=&cursor=&limit=
 * Listado con búsqueda y paginación tipo cursor
 */
router.get("/", async (req, res) => {
  try {
    const { search = "", cursor = 0, limit = 10 } = req.query;

    const [rows] = await pool.query(
      `SELECT id, sku, name, price_cents, stock 
       FROM products
       WHERE name LIKE ? OR sku LIKE ?
       AND id > ?
       ORDER BY id ASC
       LIMIT ?`,
      [`%${search}%`, `%${search}%`, cursor, parseInt(limit)]
    );

    res.json({
      data: rows,
      nextCursor: rows.length > 0 ? rows[rows.length - 1].id : null,
    });
  } catch (err) {
    console.error("Error en GET /products:", err);
    res.status(500).json({ error: "Error al listar productos" });
  }
});

export default router;
