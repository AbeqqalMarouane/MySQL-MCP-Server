import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import mysql from "mysql2/promise";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

// Initialize MySQL connection pool
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASS,
  database: process.env.MYSQL_DB,
  connectionLimit: 10,
});

// Create MCP server
const server = new McpServer({
  name: "eventscribe-mysql",
  version: "1.0.0",
});

// Register a tool to query events
server.registerTool(
  "query_events",
  {
    title: "Query Events",
    description: "Search events in the database by keyword",
    inputSchema: {
    keyword: z.string().describe("Keyword to search in event titles or descriptions"),
    },
  },
  async ({ keyword }) => {
    try {
      const [rows] = await pool.query(
        "SELECT * FROM events WHERE title LIKE ? OR description LIKE ?",
        [`%${keyword}%`, `%${keyword}%`]
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(rows),
          },
        ],
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Database query failed: ${error.message}`);
    } else {
        throw new Error("Database query failed due to an unknown error");
        }
    }
  }
);

// Start the server with STDIO transport
async function startServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

startServer().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});