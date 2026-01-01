"use client";

import { callEdgeFunction } from "./api";

export async function trackEvent(eventType: string, context: Record<string, unknown> = {}) {
  try {
    await callEdgeFunction("track-event", {
      body: {
        event_type: eventType,
        context,
      },
    });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("analytics event failed", error);
    }
  }
}
