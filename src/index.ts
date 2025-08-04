// in your MySQL_MCP_Server/src/index.ts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import mysql from "mysql2/promise";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

// --- Connection Pool (Excellent for performance) ---
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

// --- MCP Server Setup ---
const server = new McpServer({
  name: "MySQL-MCP-Server",
  version: "1.1.0", 
});


// --- MCP Resource: Expose the full schema of ANY database ---
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
      // It's better to return a structured error in the tool if possible,
      // but for resources, throwing might be necessary.
      throw new Error(`Failed to fetch schemas: ${error.message}`);
    } finally {
      if (connection) connection.release();
    }
  }
);


// --- MCP Tool: A general-purpose, secure query tool ---
server.registerTool(
  "read_only_query",
  {
    title: "Read-Only SQL Query",
    description: "Executes a read-only SQL query (MUST start with 'SELECT') on the database.",
    inputSchema: {
      sql: z.string().describe("The SQL SELECT statement to execute."),
    },
  },
  async ({ sql }) => {
    // Security Check: Vital to prevent destructive actions
    if (!sql.trim().toLowerCase().startsWith("select")) {
      return {
        content: [{
          type: "text",
          text: "Error: Only SELECT queries are permitted for security reasons.",
        }],
        isError: true, // This is the correct way to report a tool error
      };
    }

    let connection;
    try {
      connection = await pool.getConnection();
      const [rows] = await connection.query(sql);
      return {
        content: [{ type: "text", text: JSON.stringify(rows) }],
      };
    } catch (error: any) {
      console.error("Database query failed:", error.message);
      return {
        content: [{
          type: "text",
          text: `Database query failed: ${error.message}`
        }],
        isError: true, // Report database errors back to the client
      };
    } finally {
      if (connection) connection.release(); // Always release the connection back to the pool
    }
  }
);

// --- Graceful Shutdown ---
// This is best practice to ensure the database pool closes cleanly when the app stops.
const signals = ["SIGINT", "SIGTERM", "SIGQUIT"];
signals.forEach((signal) => {
  process.on(signal, async () => {
    console.log("\nShutting down server...");
    await pool.end();
    console.log("Database pool closed.");
    process.exit(0);
  });
});

// --- Start the Server ---
async function startServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MySQL Gateway MCP Server running on stdio.");
}

startServer().catch((error) => {
  console.error("Server startup error:", error);
  process.exit(1);
});