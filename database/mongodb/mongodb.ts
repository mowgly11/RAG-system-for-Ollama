import mongoose from "mongoose";
import { env } from "../../env";

// mongoose is CommonJS. Bun resolves `connect`, `Schema` and `model` as named
// exports but not `connection`, so the connection is reached off the default.
export default async function connectMongoDB() {
    // registered before connecting, otherwise the first "connected" event is missed
    mongoose.connection.on("connected", () => console.log("MongoDB connected"));
    mongoose.connection.on("disconnected", () => console.log("MongoDB disconnected"));
    mongoose.connection.on("error", (err) => console.error("MongoDB error: " + err));

    await mongoose.connect(env.MONGODB_CONNECT);
}
