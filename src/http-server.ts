// In MySQL-MCP-Server/src/http-server.ts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import mysql from "mysql2/promise";
import { z } from "zod";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";

dotenv.config();

// --- All your existing server logic remains the same ---
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 10,
  waitForConnections: true,
  queueLimit: 0,
});

const server = new McpServer({
  name: "MySQL-MCP-Server",
  version: "1.1.0",
});

// Your full, working registerResource function
server.registerResource(
  "schema",
  "mysql://schemas",
  {
    title: "Database Schemas",
    description: "Provides the `CREATE TABLE` statements for all tables in the connected database.",
    mimeType: "text/plain",
  },
  async (uri) => {
    let connection;
    try {
      connection = await pool.getConnection();
      const [tableRows] = await connection.query("SHOW TABLES;");
      const tables = tableRows as { [key: string]: string }[];
      let allSchemas = "";
      for (const table of tables) {
        const tableName = Object.values(table)[0];
        const [createTableRows] = await connection.query(`SHOW CREATE TABLE \`${tableName}\`;`);
        const createTableStatement = (createTableRows as any[])[0]["Create Table"];
        allSchemas += `${createTableStatement};\n\n`;
      }
      return { contents: [{ uri: uri.href, text: allSchemas }] };
    } catch (error: any) {
      console.error("Error fetching schemas:", error);
      throw new Error(`Failed to fetch schemas: ${error.message}`);
    } finally {
      if (connection) connection.release();
    }
  }
);

// Your full, working registerTool function
server.registerTool(
  "read_only_query",
  {
    title: "Read-Only SQL Query",
    description: "Executes a read-only SQL query (MUST start with 'SELECT') on the database.",
    inputSchema: { sql: z.string().describe("The SQL SELECT statement to execute.") },
  },
  async ({ sql }) => {
    if (!sql.trim().toLowerCase().startsWith("select")) {
      return { content: [{ type: "text", text: "Error: Only SELECT queries are permitted." }], isError: true };
    }
    let connection;
    try {
      connection = await pool.getConnection();
      const [rows] = await connection.query(sql);
      return { content: [{ type: "text", text: JSON.stringify(rows) }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `Database query failed: ${error.message}` }], isError: true };
    } finally {
      if (connection) connection.release();
    }
  }
);

// --- Web Server Setup ---
async function startHttpServer() {
  const app = express();
  const port = process.env.PORT || 8080;

  app.use(cors());
  app.use(express.json());

  // FIX: Provide the required 'options' object to the constructor.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(), // This tells the transport how to create a unique ID for each session.
    onsessioninitialized: (sessionId) => {
      console.error(`New HTTP session initialized: ${sessionId}`);
    },
  });
  
  await server.connect(transport);

  // A single endpoint at /mcp to handle all MCP requests
  app.all('/mcp', (req, res) => {
    transport.handleRequest(req, res, req.body);
  });

  app.listen(port, () => {
    console.error(`✅ MySQL Gateway MCP Server running on HTTP, listening on port ${port}`);
  });
}

startHttpServer().catch(error => {
  console.error("❌ Failed to start HTTP server:", error);
  process.exit(1);
});