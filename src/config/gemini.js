import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

export const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
