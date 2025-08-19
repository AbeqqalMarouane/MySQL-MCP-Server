// in MySQL-MCP-Server/src/http-server.ts

// --- Imports ---
// We import all necessary libraries for the server.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import mysql from "mysql2/promise";
import { z } from "zod";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";

// --- Main Application Logic in an Async IIFE ---
// This structure is a robust way to initialize and run an async server,
// ensuring the process stays alive and handles errors correctly.
(async () => {
  try {
    // Load environment variables at the very beginning.
    dotenv.config();

    // --- Database Connection Pool ---
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

    // --- MCP Server Setup ---
    const server = new McpServer({
      name: "mysql-gateway-server",
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
            content: [{
              type: "text",
              text: `Database query failed: ${error.message}`
            }],
            isError: true,
          };
        } finally {
          if (conn) conn.release();
        }
      }
    );

    // --- Web Server Setup ---
    const app = express();
    // Correctly parse the port from environment variables as a number.
    const port = Number(process.env.PORT) || 8080;

    app.use(cors());
    app.use(express.json());

    // Correctly instantiate the transport with required options.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        console.error(`New HTTP session initialized: ${sessionId}`);
      },
    });
    
    await server.connect(transport);

    // A single endpoint at /mcp to handle all incoming MCP requests.
    app.all('/mcp', (req, res) => {
      transport.handleRequest(req, res, req.body);
    });

    // --- Server Listener Block (This is the final, robust version) ---
    // This starts the server and ensures the process stays alive.
    const httpServer = app.listen(port, '0.0.0.0', () => {
      console.error(`✅ MySQL Gateway MCP Server running on HTTP, listening on port ${port}`);
      console.error(`   - Local:            http://localhost:${port}/mcp`);
      console.error(`   - Press CTRL+C to stop the server`);
    });

    // --- Graceful Shutdown Logic ---
    // This listener ensures the database pool is closed cleanly when you stop the server.
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
})(); // The () here immediately invokes the function, starting the server.