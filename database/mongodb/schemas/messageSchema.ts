import { Schema, model } from "mongoose";

const messageSchema = new Schema({
    chatID: { type: String, required: true, index: true },
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },

    // search metadata for the turn this message belongs to.
    // queries are set on the user message, sources on the assistant reply.
    searchPerformed: { type: Boolean, default: false },
    queries: { type: [String], default: [] },
    sources: { type: [String], default: [] }
}, { timestamps: true });

// history is always read as "every message in this chat, oldest first"
messageSchema.index({ chatID: 1, createdAt: 1 });

export default model("messages", messageSchema);
