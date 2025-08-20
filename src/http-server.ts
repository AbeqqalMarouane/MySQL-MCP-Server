// in MySQL-MCP-Server/src/http-server.ts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import mysql from "mysql2/promise";
import { z } from "zod";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";

// --- Main Application Logic in an Async IIFE ---
(async () => {
  try {
    dotenv.config();

    // --- Create ONE Database Connection Pool for the whole application ---
    const pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      connectionLimit: 10,
    });
    
    const connection = await pool.getConnection();
    console.error("✅ Database connection successful.");
    connection.release();

    // --- Create ONE McpServer instance for the whole application ---
    // The server holds the resource and tool definitions.
    const server = new McpServer({
      name: "mysql-gateway-server",
      version: "1.1.0",
    });

    // --- Register all resources and tools once on startup ---
    server.registerResource("schema", "mysql://schemas", {
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
      });
    server.registerTool("read_only_query", {
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
      });

    // --- THIS IS THE KEY FIX: A map to store active sessions ---
    const activeTransports = new Map<string, StreamableHTTPServerTransport>();

    // --- Web Server Setup ---
    const app = express();
    const port = Number(process.env.PORT) || 8080;

    app.use(cors());
    app.use(express.json());

    // --- The /mcp endpoint now uses the session map ---
    app.all('/mcp', async (req, res) => {
      // For MCP over HTTP, the client provides a session ID in the header for subsequent requests.
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      let transport: StreamableHTTPServerTransport | undefined = sessionId ? activeTransports.get(sessionId) : undefined;

      // If no transport exists for this session, it must be an initialize request.
      if (!transport) {
        // We create a new transport for this new session.
        const newSessionId = randomUUID();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => newSessionId,
          onsessioninitialized: (sid) => {
            console.error(`New HTTP session initialized: ${sid}`);
            activeTransports.set(sid, transport!);
          },
          onsessionclosed: (sid) => {
            console.error(`HTTP session closed: ${sid}`);
            activeTransports.delete(sid);
          }
        });
        
        // We connect our single, persistent server instance to this new transport.
        await server.connect(transport);
      }

      // Handle the request with the correct transport (either new or existing).
      transport.handleRequest(req, res, req.body);
    });

    // ... (Your other endpoints like '/' and '/health' remain the same) ...

    const httpServer = app.listen(port, '0.0.0.0', () => {
      console.error(`✅ MySQL Gateway MCP Server (Stateful) running on port ${port}`);
    });
    
    // ... (Your graceful shutdown logic remains the same) ...

  } catch (error) {
    console.error("❌ Fatal error during server startup:", error);
    process.exit(1);
  }
})();