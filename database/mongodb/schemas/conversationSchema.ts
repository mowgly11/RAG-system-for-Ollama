import { Schema, model } from "mongoose";

const conversationSchema = new Schema({
    chatID: { type: String, required: true, unique: true },

    // stays null until the first user message, which becomes the label in the picker
    title: { type: String, default: null },

    messageCount: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: () => new Date() }
}, { timestamps: true });

// the picker lists the most recently used conversations first
conversationSchema.index({ lastMessageAt: -1 });

export default model("conversations", conversationSchema);
