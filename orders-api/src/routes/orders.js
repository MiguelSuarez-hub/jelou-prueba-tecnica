import { Router } from "express";
import  pool  from "../db.js";
import axios from "axios";

const router = Router();

// 🔹 POST /orders → crea una orden
router.post("/", async (req, res) => {
  const { customer_id, items } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1️⃣ Validar cliente en Customers API
    const customerRes = await axios.get(
      `${process.env.CUSTOMERS_API_BASE}/internal/customers/${customer_id}`,
      { headers: { Authorization: `Bearer ${process.env.SERVICE_TOKEN}` } }
    );
    if (!customerRes.data) {
      throw new Error("Cliente no encontrado");
    }

    // 2️⃣ Validar stock y calcular total
    let total_cents = 0;
    const itemDetails = [];

    for (const item of items) {
      const [rows] = await conn.query(
        "SELECT id, name, price_cents, stock FROM products WHERE id = ?",
        [item.product_id]
      );
      if (rows.length === 0) throw new Error("Producto no encontrado");

      const product = rows[0];
      if (product.stock < item.qty) throw new Error("Stock insuficiente");

      const subtotal = product.price_cents * item.qty;
      total_cents += subtotal;

      itemDetails.push({
        product_id: product.id,
        qty: item.qty,
        unit_price_cents: product.price_cents,
        subtotal_cents: subtotal,
      });

      // Descontar stock
      await conn.query(
        "UPDATE products SET stock = stock - ? WHERE id = ?",
        [item.qty, product.id]
      );
    }

    // 3️⃣ Insertar orden
    const [orderResult] = await conn.query(
      "INSERT INTO orders (customer_id, status, total_cents) VALUES (?, 'CREATED', ?)",
      [customer_id, total_cents]
    );

    const orderId = orderResult.insertId;

    // 4️⃣ Insertar items
    for (const detail of itemDetails) {
      await conn.query(
        "INSERT INTO order_items (order_id, product_id, qty, unit_price_cents, subtotal_cents) VALUES (?, ?, ?, ?, ?)",
        [
          orderId,
          detail.product_id,
          detail.qty,
          detail.unit_price_cents,
          detail.subtotal_cents,
        ]
      );
    }

    await conn.commit();

    res.status(201).json({
      id: orderId,
      status: "CREATED",
      total_cents,
      items: itemDetails,
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// 🔹 GET /orders/:id → incluye items
router.get("/:id", async (req, res) => {
  const orderId = req.params.id;
  const [orders] = await pool.query("SELECT * FROM orders WHERE id = ?", [
    orderId,
  ]);
  if (orders.length === 0) return res.status(404).json({ error: "No existe" });

  const [items] = await pool.query(
    "SELECT product_id, qty, unit_price_cents, subtotal_cents FROM order_items WHERE order_id = ?",
    [orderId]
  );

  res.json({ ...orders[0], items });
});

// 🔹 GET /orders → filtrado básico
router.get("/", async (req, res) => {
  const { status, limit = 10 } = req.query;

  let sql = "SELECT * FROM orders WHERE 1=1";
  const params = [];

  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }

  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(Number(limit));

  const [orders] = await pool.query(sql, params);
  res.json(orders);
});

export default router;
