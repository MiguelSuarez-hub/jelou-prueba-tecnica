//entry point
import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import routes from "./routes.js";

dotenv.config();
const app = express();

app.use(bodyParser.json());

// Health check
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Rutas principales
app.use("/", routes);

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`✅ Customers API running on port ${port}`);
});
