// in MySQL-MCP-Server/src/http-server.ts

// --- Imports ---
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import mysql from "mysql2/promise";
import { z } from "zod";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";

// --- Main Application Logic in an Async IIFE ---
// This structure ensures all setup is completed before the server starts listening.
(async () => {
  try {
    // Load environment variables at the very beginning.
    dotenv.config();

    // --- Create ONE Database Connection Pool for the whole application ---
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
    
    // Test the connection on startup to fail fast if credentials are bad.
    const connection = await pool.getConnection();
    console.error("✅ Database connection successful.");
    connection.release();

    // --- Create ONE McpServer instance for the whole application ---
    const server = new McpServer({
      name: "mysql-gateway-server",
      version: "1.1.0",
    });

    // --- Register all resources and tools on this single server instance ---

    // MCP Resource: Expose the full schema of ANY database
    server.registerResource(
      "schema",
      "mysql://schemas",
      {
        title: "Database Schemas",
        description: "Provides the `CREATE TABLE` statements for all tables in the connected database.",
        mimeType: "text/plain",
      },
      async (uri) => {
        let conn;
        try {
          conn = await pool.getConnection();
          const [tableRows] = await conn.query("SHOW TABLES;");
          const tables = tableRows as { [key: string]: string }[];
          let allSchemas = "";

          for (const table of tables) {
            const tableName = Object.values(table)[0];
            const [createTableRows] = await conn.query(`SHOW CREATE TABLE \`${tableName}\`;`);
            const createTableStatement = (createTableRows as any[])[0]["Create Table"];
            allSchemas += `${createTableStatement};\n\n`;
          }

          return { contents: [{ uri: uri.href, text: allSchemas }] };
        } catch (error: any) {
          console.error("Error fetching schemas:", error);
          throw new Error(`Failed to fetch schemas: ${error.message}`);
        } finally {
          if (conn) conn.release();
        }
      }
    );

    // MCP Tool: A general-purpose, secure query tool
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
        if (!sql.trim().toLowerCase().startsWith("select")) {
          return {
            content: [{ type: "text", text: "Error: Only SELECT queries are permitted." }],
            isError: true,
          };
        }
        let conn;
        try {
          conn = await pool.getConnection();
          const [rows] = await conn.query(sql);
          return {
            content: [{ type: "text", text: JSON.stringify(rows) }],
          };
        } catch (error: any) {
          console.error("Database query failed:", error.message);
          return {
            content: [{ type: "text", text: `Database query failed: ${error.message}` }],
            isError: true,
          };
        } finally {
          if (conn) conn.release();
        }
      }
    );

    // --- Web Server Setup ---
    const app = express();
    const port = Number(process.env.PORT) || 8080;

    app.use(cors());
    app.use(express.json());

    // --- Create ONE Transport instance for the whole application ---
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        console.error(`New HTTP session initialized: ${sessionId}`);
      },
    });
    
    // Connect the single server to the single transport
    await server.connect(transport);

    // --- API Endpoints ---
    // The /mcp endpoint now simply passes all requests to the single, persistent transport instance.
    app.all('/mcp', (req, res) => {
      transport.handleRequest(req, res, req.body);
    });

    app.get('/', (req, res) => {
        res.status(200).send("MySQL MCP Server is running. The MCP endpoint is at /mcp.");
    });

    // --- Start the Server ---
    const httpServer = app.listen(port, '0.0.0.0', () => {
      console.error(`✅ MySQL Gateway MCP Server running on HTTP, listening on port ${port}`);
      console.error(`   - Local:            http://localhost:${port}/mcp`);
      console.error(`   - Press CTRL+C to stop the server`);
    });

    // --- Graceful Shutdown Logic ---
    const signals = ["SIGINT", "SIGTERM", "SIGQUIT"];
    signals.forEach((signal) => {
      process.on(signal, () => {
        console.error('\nGracefully shutting down server...');
        httpServer.close(async () => {
          await pool.end();
          console.error('Database pool closed. Server has been shut down.');
          process.exit(0);
        });
      });
    });

  } catch (error) {
    console.error("❌ Fatal error during server startup:", error);
    process.exit(1);
  }
})();