//entry point
import express from "express";
import dotenv from "dotenv";
import productsRouter from "./routes/products.js";

dotenv.config();

const app = express();
app.use(express.json());

// Health check
app.get("/health", (req, res) => res.json({ status: "ok" }));

// rutas
app.use("/products", productsRouter);

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`Orders API running on port ${PORT}`);
});
