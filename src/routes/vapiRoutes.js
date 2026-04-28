import express from "express";
import { startCall, webhookVapi, getLatestBrief } from "../controllers/vapiController.js";

const router = express.Router();

router.post("/start-call", startCall);
router.post("/webhook/vapi", webhookVapi);
router.get("/latest-brief", getLatestBrief);

export default router;
