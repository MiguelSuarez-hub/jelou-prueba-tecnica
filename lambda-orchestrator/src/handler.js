import { orchestrateOrder } from "./orchestrator.js";

export async function main(event) {
  try {
    const body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    const result = await orchestrateOrder(body);
    return {
      statusCode: 201,
      body: JSON.stringify({ success: true, ...result }),
    };
  } catch (err) {
    console.error("Error in orchestrator:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
}
