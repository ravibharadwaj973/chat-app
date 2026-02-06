import mongoose from "mongoose";
const {connection}=require("mongoose")
const callSchema = new mongoose.Schema(
  {
    callType: {
      type: String,
      enum: ["voice", "video"],
      required: true,
    },
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    initiator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
    },
    status: {
      type: String,
      enum: ["missed", "completed", "rejected", "cancelled"],
      default: "completed",
    },
    startTime: {
      type: Date,
      default: Date.now,
    },
    endTime: {
      type: Date,
    },
    duration: {
      type: Number,  
      default: 0,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } } 
);
export const Call =
  connection.models.callSchema ||
  connection.model("Conversation", callSchema);