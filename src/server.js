import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import chatRoutes from "./routes/chatRoutes.js";
import vapiRoutes from "./routes/vapiRoutes.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use("/chat", chatRoutes);
app.use("/", vapiRoutes);

// ── Health check ───────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "Wardly Clinical Intake API" });
});

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3500;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
