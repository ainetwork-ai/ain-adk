#!/usr/bin/env ts-node
// @ts-nocheck
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const EXPORT_API_URL = process.env.EXPORT_API_URL!;
const EXPORT_API_KEY = process.env.EXPORT_API_KEY!;

const server = new McpServer({
  name: "walkerhillChatApi",
  description: "MCP server for Walkerhill Chat Export API",
  version: "0.0.1",
});

// Plain object 스키마만 넘기세요!
server.tool(
  "exportChats",
  {
    start_date: z.string(),
    end_date: z.string(),
    format: z.enum(["csv", "json"]).default("csv"),
  },
  async ({ start_date, end_date, format }) => {
    const res = await fetch(EXPORT_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${EXPORT_API_KEY}`,
      },
      body: JSON.stringify({ start_date, end_date, format }),
    });
    if (!res.ok) {
      throw new Error(`Export API error: ${res.status} ${res.statusText}`);
    }

    if (format === "csv") {
      const text = await res.text();
      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
      };
    } else {
      const json = await res.json();
      return {
        structuredContent: json,
      };
    }
  }
);

(async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("Walkerhill Chat MCP server started on stdio");
})();
