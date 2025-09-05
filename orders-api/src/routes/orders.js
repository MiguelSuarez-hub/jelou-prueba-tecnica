import { Router } from "express";
import pool from "../db.js";
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
      await conn.query("UPDATE products SET stock = stock - ? WHERE id = ?", [
        item.qty,
        product.id,
      ]);
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

router.post("/:id/confirm", async (req, res) => {
  const orderId = parseInt(req.params.id, 10);
  const idempotencyKey = req.header("X-Idempotency-Key");

  if (!idempotencyKey) {
    return res
      .status(400)
      .json({ error: "X-Idempotency-Key header is required" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Revisar si ya existe la key en DB
    const [existing] = await conn.query(
      "SELECT response_body FROM idempotency_keys WHERE idempotency_key = ? AND target_type = 'order_confirm'",
      [idempotencyKey]
    );

    if (existing.length > 0) {
      // Ya existe -> devolver la misma respuesta guardada
      await conn.commit();
      return res.json(existing[0].response_body);
    }

    // 2. Validar la orden
    const [orders] = await conn.query(
      "SELECT id, status FROM orders WHERE id = ?",
      [orderId]
    );
    if (orders.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: "Order not found" });
    }

    const order = orders[0];
    if (order.status === "CONFIRMED") {
      // Guardamos idempotencia igual para consistencia
      const response = { id: order.id, status: "CONFIRMED" };
      await conn.query(
        `INSERT INTO idempotency_keys (idempotency_key, target_type, target_id, status, response_body, expires_at)
         VALUES (?, 'order_confirm', ?, 'completed', ?, DATE_ADD(NOW(), INTERVAL 1 DAY))`,
        [idempotencyKey, orderId, JSON.stringify(response)]
      );
      await conn.commit();
      return res.json(response);
    }

    if (order.status !== "CREATED") {
      await conn.rollback();
      return res
        .status(400)
        .json({ error: "Only CREATED orders can be confirmed" });
    }

    // 3. Confirmar la orden
    await conn.query("UPDATE orders SET status = 'CONFIRMED' WHERE id = ?", [
      orderId,
    ]);

    // Obtener la orden con items y totales
    const [orderItems] = await conn.query(
      `SELECT oi.product_id, oi.qty, oi.unit_price_cents, oi.subtotal_cents
       FROM order_items oi WHERE oi.order_id = ?`,
      [orderId]
    );

    const [updated] = await conn.query(
      "SELECT id, status, total_cents FROM orders WHERE id = ?",
      [orderId]
    );
    const response = {
      id: updated[0].id,
      status: updated[0].status,
      total_cents: updated[0].total_cents,
      items: orderItems,
    };

    // 4. Guardar en idempotency_keys
    await conn.query(
      `INSERT INTO idempotency_keys (idempotency_key, target_type, target_id, status, response_body, expires_at)
       VALUES (?, 'order_confirm', ?, 'completed', ?, DATE_ADD(NOW(), INTERVAL 1 DAY))`,
      [idempotencyKey, orderId, JSON.stringify(response)]
    );

    await conn.commit();
    res.json(response);
  } catch (err) {
    await conn.rollback();
    console.error("Error confirming order:", err);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    conn.release();
  }
});

router.post("/:id/cancel", async (req, res) => {
  const { id } = req.params;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [orders] = await conn.query(
      "SELECT id, status, created_at FROM orders WHERE id = ? FOR UPDATE",
      [id]
    );

    if (orders.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: "Order not found" });
    }

    const order = orders[0];

    if (order.status === "CANCELED") {
      await conn.rollback();
      return res.status(400).json({ error: "Order already canceled" });
    }

    if (order.status === "CREATED") {
      // Restaurar stock
      const [items] = await conn.query(
        "SELECT product_id, qty FROM order_items WHERE order_id = ?",
        [id]
      );

      for (const item of items) {
        await conn.query("UPDATE products SET stock = stock + ? WHERE id = ?", [
          item.qty,
          item.product_id,
        ]);
      }

      await conn.query("UPDATE orders SET status = 'CANCELED' WHERE id = ?", [
        id,
      ]);
      await conn.commit();
      return res.json({ id: order.id, status: "CANCELED" });
    }

    if (order.status === "CONFIRMED") {
      const createdAt = new Date(order.created_at);
      const now = new Date();
      const diffMinutes = (now - createdAt) / (1000 * 60);

      if (diffMinutes > 10) {
        await conn.rollback();
        return res.status(400).json({
          error: "Confirmed order can only be canceled within 10 minutes",
        });
      }

      // Restaurar stock
      const [items] = await conn.query(
        "SELECT product_id, qty FROM order_items WHERE order_id = ?",
        [id]
      );

      for (const item of items) {
        await conn.query("UPDATE products SET stock = stock + ? WHERE id = ?", [
          item.qty,
          item.product_id,
        ]);
      }

      await conn.query("UPDATE orders SET status = 'CANCELED' WHERE id = ?", [
        id,
      ]);
      await conn.commit();
      return res.json({ id: order.id, status: "CANCELED" });
    }

    await conn.rollback();
    res.status(400).json({ error: "Invalid order status" });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    conn.release();
  }
});

export default router;
