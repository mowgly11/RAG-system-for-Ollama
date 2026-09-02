import { connect, connection } from "mongoose";
import { env } from "../env";

export default async function connectMongoDB() {
    await connect(env.MONGODB_CONNECT);

    connection.on("connected", () => console.log("MongoDB connected"));
    connection.on("disconnected", () => console.log("MongoDB disconnected"));
    connection.on("error", (err) => console.error("MongoDB error: " + err));
}