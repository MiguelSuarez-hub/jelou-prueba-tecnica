import axios from "axios";

const CUSTOMERS_API_BASE = process.env.CUSTOMERS_API_BASE;
const ORDERS_API_BASE = process.env.ORDERS_API_BASE;
const SERVICE_TOKEN = process.env.SERVICE_TOKEN || "servicetoken123" ;

export async function orchestrateOrder({ customer_id, items, idempotency_key, correlation_id }) {
  const token = `Bearer ${SERVICE_TOKEN}`
  // 1. Validar cliente en Customers API
  const customerRes = await axios.get(`${CUSTOMERS_API_BASE}/internal/customers/${customer_id}`, {
    headers: { Authorization: token },
  });
  const customer = customerRes.data;

  // 2. Crear orden en Orders API
  const orderRes = await axios.post(`${ORDERS_API_BASE}/orders`, { customer_id, items });
  const order = orderRes.data;

  // 3. Confirmar orden con idempotencia
  const confirmRes = await axios.post(`${ORDERS_API_BASE}/orders/${order.id}/confirm`, {}, {
    headers: { "X-Idempotency-Key": idempotency_key },
  });
  const confirmedOrder = confirmRes.data;

  // 4. Respuesta consolidada
  return {
    correlationId: correlation_id,
    data: {
      customer,
      order: confirmedOrder,
    },
  };
}
